/**
 * Workspace file service: read-only file previews, workspace directory
 * listings, the filesystem-observation change feed, and the workspace-confined
 * mutation verbs, exposed as `workspaceFiles`.
 *
 * File reads follow the composed filesystem's read access, including paths
 * outside the workspace. The selected Session header supplies the base for
 * relative paths, with the sandbox policy root as its no-cwd fallback, not a
 * read-containment restriction. Directory listings, change observations, and
 * every mutation remain workspace-scoped: `createFile`, `createDirectory`,
 * `move`, and `remove` resolve each path through the same filesystem the reads
 * use and refuse it before touching anything unless the resolved target is
 * inside the Session's workspace root. File-kind checks and configured read
 * caps apply to every preview.
 *
 * The reads use `fs.read*` and `fs.listDir`; the mutations use `fs.writeText`
 * for a file's content and, because the filesystem Service Definition exposes
 * no directory, rename, or delete operation, the host's own filesystem for the
 * other three. That last fact confines those three verbs to a backend that
 * shares the harness host, which they check through `processPathFromHostPath`;
 * a backend that does not (an SSH filesystem) is refused rather than handed a
 * guessed host path.
 *
 * A page is cut from `streamText`, which decodes and rejects non-UTF-8 as it
 * goes, so the file is read only up to the first character past the page and
 * never held whole in memory; the NUL scan runs on the page itself.
 *
 * This is NOT modelled on `session.openWorkspacePath`. That endpoint hands a
 * path to the local opener and leaves the effect on the machine; this one sends
 * file content across the wire, which is a different level of exposure.
 */

import { mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsInfo, FsPathInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, RemoteError, TypertRemoteService, type TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceChangeFeed } from './changes.ts'
import type {
  WorkspaceByteRange,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryListing,
  WorkspaceFileBytes,
  WorkspaceFileMoveOptions,
  WorkspaceFileMutation,
  WorkspaceFileRange,
  WorkspaceFileRemoveOptions,
  WorkspaceFileStat,
  WorkspaceFileText,
  WorkspaceFileWatchFrame,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceFiles` Remote namespace. */
    workspaceFiles: WorkspaceFiles
  }
}

/** Header-derived file resolution context for one Session identity. */
export interface WorkspaceFileScope {
  /** Session identity received on the wire. */
  readonly sessionId: SessionId
  /** Session workspace root, or the deployment fallback when its header has no cwd. */
  readonly workspaceRoot: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    /** Resolve a Session id to its workspace root without loading its event body or activating an Agent. */
    workspaceFileScope: TypertLookup<WorkspaceFileScope, SessionId>
  }
}

/** Deployment caps on one page or one listing. */
export interface Config {
  /**
   * Inclusive byte cap on one page's text and on one byte window.
   *
   * A page above this fails; it is not shortened, because a silently cut page
   * reads as the whole page. A byte window asking for more is refused the same
   * way. The file itself has no size cap: a caller pages through it.
   */
  readonly maxBytes: number
  /** Inclusive byte cap on a complete-file read; larger files are refused, never truncated. */
  readonly maxFileBytes: number
  /** Default and largest page size in lines; a request asking for more is refused. */
  readonly maxLines: number
  /** Cap on returned directory entries; the rest is dropped and reported cut. */
  readonly maxEntries: number
}

/** One page cut from a decoded text stream. */
interface Page {
  readonly text: string
  /** Lines in `text`; `0` for a page past the last line. */
  readonly lines: number
  readonly eof: boolean
}

/** The byte text never carries: its presence marks a page as binary. */
const NUL = String.fromCharCode(0)

/** Refuse anything the wire schema admits as a number but a window cannot use: only safe integers index a file. */
function integerAtLeast(value: number, min: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RemoteError('gateway/bad-request', `${name} must be a safe integer of at least ${min}`, {})
  }
  return value
}

/**
 * Cut lines `offset` through `offset + limit - 1` from decoded chunks, stopping
 * at the first character past the page so the rest of the file is never read.
 * Lines before the page are counted, not kept, and the page is refused the
 * moment its bytes exceed `maxBytes`, so one giant line cannot grow memory past
 * the cap either.
 */
async function cutPage(
  chunks: AsyncIterable<string>,
  offset: number,
  limit: number,
  maxBytes: number,
  path: string,
): Promise<Page> {
  const last = offset + limit - 1
  const lines: string[] = []
  let current = ''
  let bytes = 0
  let lineNumber = 1
  const admit = (size: number): void => {
    bytes += size
    if (bytes > maxBytes) {
      throw new RemoteError(
        'workspace-file/too-large',
        `lines ${offset}-${last} of "${path}" exceed the ${maxBytes} byte cap`,
        { path, limit: maxBytes },
      )
    }
  }
  const complete = (): void => {
    if (lines.length > 0) admit(1)
    lines.push(current)
    current = ''
  }
  for await (const chunk of chunks) {
    let position = 0
    while (position < chunk.length) {
      if (lineNumber > last) return { text: lines.join('\n'), lines: lines.length, eof: false }
      const newline = chunk.indexOf('\n', position)
      const segment = newline === -1 ? chunk.slice(position) : chunk.slice(position, newline)
      if (lineNumber >= offset) {
        admit(Buffer.byteLength(segment, 'utf8'))
        current += segment
      }
      if (newline === -1) break
      if (lineNumber >= offset) complete()
      lineNumber += 1
      position = newline + 1
    }
  }
  // Only an in-page line can be pending here: earlier lines were never kept,
  // and a character past the page returned above.
  if (current.length > 0) complete()
  return { text: lines.join('\n'), lines: lines.length, eof: true }
}

/**
 * Workspace path of `target` relative to `root`, derived from the two canonical
 * `file:` URIs so the answer is `/`-joined on every platform. Empty for the root.
 */
function workspacePathOf(rootUrl: string, targetUrl: string): string {
  const root = new URL(rootUrl).pathname.replace(/\/+$/, '')
  const target = new URL(targetUrl).pathname
  if (target === root) return ''
  return target.slice(root.length + 1).split('/').map(decodeURIComponent).join('/')
}

/** Strip the resolved child target: the wire carries names and metadata only. */
function directoryEntry(child: FsDirEntry): WorkspaceDirectoryEntry {
  return {
    name: child.name,
    type: child.type,
    ...child.size === undefined ? {} : { size: child.size },
  }
}

/** Host Remote file reads and workspace directory observations over the composed filesystem. */
export class WorkspaceFiles extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy', 'sessions', 'typert']

  static Config: z<Config> = z.object({
    maxBytes: z.number().step(1).min(1).default(2 * 1024 * 1024),
    maxFileBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(32 * 1024 * 1024),
    maxLines: z.number().step(1).min(1).default(5000),
    maxEntries: z.number().step(1).min(1).default(2000),
  })

  private readonly feed: WorkspaceChangeFeed

  /**
   * @param ctx - Host context carrying the filesystem and the sandbox policy.
   * @param config - deployment caps on one page or one listing.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFiles')
    this.feed = new WorkspaceChangeFeed(ctx)
    ctx.inject(['sessions', 'typert'], (scope) => {
      scope.typert.lookups.register('workspaceFileScope', {
        parameter: 'workspaceFileScope',
        wire: 'workspaceFileScopeId',
        hostTypeSymbol: '@deepseek-ai/dsh-api-workspace-files#WorkspaceFileScope',
        wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
        resolve: async (sessionId) => {
          const live = scope.sessions.get(sessionId)?.header
          const stored = live === undefined
            ? await scope.get('sessionPersistence')?.stat(sessionId)
            : undefined
          const header = live ?? stored?.header
          if (header === undefined) return undefined
          return {
            sessionId,
            workspaceRoot: header.cwd ?? scope.sandboxPolicy.workspaceRoot,
          }
        },
      })
    })
  }

  /**
   * Read one page of lines from a UTF-8 file readable by the filesystem backend.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param range - the line window; omitted fields take the page defaults.
   * @param signal - caller cancellation.
   * @returns the page, the file's version at the stat before it, and whether it reaches the last line.
   */
  @Remote
  async read(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    range: WorkspaceFileRange,
    signal: AbortSignal,
  ): Promise<WorkspaceFileText> {
    const { offset, limit } = this.resolvePage(range)
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const page = await this.cutPage(target, offset, limit, signal, path)
    if (page.text.includes(NUL)) {
      throw new RemoteError('workspace-file/not-text', `"${path}" contains NUL bytes`, { path })
    }
    return { ...this.statOf(target, info), offset, text: page.text, lines: page.lines, eof: page.eof }
  }

  /**
   * Read one byte window of a regular file readable by the filesystem backend: raw
   * bytes, no text decoding and no binary rejection.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param range - the byte window; omitted fields take the window defaults.
   * @param signal - caller cancellation.
   * @returns the window in base64, the file's version and size at the stat before it, and whether it reaches the last byte.
   */
  @Remote
  async readBytes(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    range: WorkspaceByteRange,
    signal: AbortSignal,
  ): Promise<WorkspaceFileBytes> {
    const { offset, length } = this.resolveWindow(range, path)
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const data = await this.ctx.fs.readByteRange(target, { offset, length }, signal)
    const eof = info.size === undefined ? data.length < length : offset + data.length >= info.size
    return { ...this.statOf(target, info), offset, data: Buffer.from(data).toString('base64'), eof }
  }

  /**
   * Read a complete regular file as bytes, subject to the configured full-file cap.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute or workspace-relative file path.
   * @param signal - caller cancellation.
   * @returns one complete base64 window with offset zero and eof true; oversized files fail with too-large.
   */
  @Remote
  async readAll(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileBytes> {
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    const limit = this.config.maxFileBytes
    if (info.size !== undefined && info.size > limit) {
      throw new RemoteError('workspace-file/too-large', `"${path}" exceeds the ${limit} byte full-file cap`, { path, limit })
    }
    const data = await this.ctx.fs.readByteRange(target, { offset: 0, length: limit + 1 }, signal)
    if (data.length > limit) {
      throw new RemoteError('workspace-file/too-large', `"${path}" exceeds the ${limit} byte full-file cap`, { path, limit })
    }
    return { ...this.statOf(target, info), offset: 0, data: Buffer.from(data).toString('base64'), eof: true }
  }

  /**
   * Read a complete file relative to another file's directory, including outside the workspace.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - base file, absolute or workspace-relative.
   * @param relativePath - relative filesystem path, not a URL or absolute path.
   * @param signal - caller cancellation.
   * @returns the complete related file using the ordinary file-size and access checks.
   */
  @Remote
  async readRelated(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    relativePath: string,
    signal: AbortSignal,
  ): Promise<WorkspaceFileBytes> {
    const relative = relativePath.replace(/\\/g, '/')
    if (relative.length === 0 || relative.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(relative) || relative.includes(NUL)) {
      throw new RemoteError('gateway/bad-request', 'relativePath must be a relative filesystem path', {})
    }
    const { target } = await this.locateFile(workspaceFileScope, path, signal)
    const absolute = this.ctx.fs.processPath(target)
    const paths = absolute.startsWith('/') ? posix : win32
    return this.readAll(workspaceFileScope, paths.resolve(paths.dirname(absolute), relative), signal)
  }

  /**
   * Report one regular file's identity, version, and size without its content.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - absolute path or path relative to the workspace root; files outside it are allowed.
   * @param signal - caller cancellation.
   * @returns the file's absolute path, current version, and byte size.
   */
  @Remote
  async stat(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileStat> {
    const { target, info } = await this.locateFile(workspaceFileScope, path, signal)
    return this.statOf(target, info)
  }

  /**
   * List the direct children of one directory inside the Session's workspace.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - workspace path, absolute or relative to the workspace root.
   * @param signal - caller cancellation.
   * @returns the directory's children in the backend's stable name order, bounded by the entry cap.
   */
  @Remote
  async list(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing> {
    const { root, workspaceRoot, entry } = await this.inspect(workspaceFileScope, path, signal)
    if (entry.type !== 'directory') {
      throw new RemoteError(
        'workspace-file/not-directory',
        `"${path}" is a ${entry.type}`,
        { path, kind: entry.type },
      )
    }
    const target = await this.confine(root, workspaceRoot, path, signal)
    const children = await this.ctx.fs.listDir(target, signal)
    return {
      path: workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target)),
      entries: children.slice(0, this.config.maxEntries).map(directoryEntry),
      truncated: children.length > this.config.maxEntries,
    }
  }

  /**
   * Stream every `fs/observed` observation of a file inside the Session's
   * workspace. Only instrumented filesystem operations report here; the OS is
   * not watched.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param signal - generation cancellation.
   * @returns `ready` once the Host observation queue is active and the workspace
   *   root is resolved, then queued and live observations in emission order.
   */
  @Remote({ mode: 'stream' })
  changes(workspaceFileScope: WorkspaceFileScope, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame> {
    return this.feed.follow(workspaceFileScope.workspaceRoot, signal)
  }

  /**
   * Create one UTF-8 text file inside the Session's workspace. The write is
   * atomic and refuses an occupied destination: this verb only creates.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - the new file's workspace path, absolute or relative to the workspace root.
   * @param content - the complete file content; above the configured full-file cap the call is refused.
   * @param signal - caller cancellation.
   * @returns the created file's workspace path and absolute path.
   */
  @Remote
  async createFile(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    content: string,
    signal: AbortSignal,
  ): Promise<WorkspaceFileMutation> {
    const limit = this.config.maxFileBytes
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > limit) {
      throw new RemoteError('workspace-file/too-large', `"${path}" is ${bytes} bytes; the cap is ${limit}`, { path, limit })
    }
    const { root, target, entry } = await this.resolveMutationTarget(workspaceFileScope, path, signal)
    this.refuseOccupied(entry, path)
    await this.ctx.fs.writeText(target, content, { kind: 'createIfAbsent' }, signal)
    return this.mutationOf('created-file', root, target)
  }

  /**
   * Create one directory inside the Session's workspace, with any missing
   * parent directory.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - the new directory's workspace path, absolute or relative to the workspace root.
   * @param signal - caller cancellation.
   * @returns the created directory's workspace path and absolute path.
   */
  @Remote
  async createDirectory(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<WorkspaceFileMutation> {
    const { root, target, entry } = await this.resolveMutationTarget(workspaceFileScope, path, signal)
    this.refuseOccupied(entry, path)
    await mkdir(this.hostPath(target, path), { recursive: true })
    return this.mutationOf('created-directory', root, target)
  }

  /**
   * Move one entry inside the Session's workspace: a rename when both paths
   * share a parent, a move otherwise. Both paths are resolved and confined
   * before anything is touched, and an occupied destination is refused unless
   * the call allows the replacement.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param from - the entry's current workspace path.
   * @param to - the entry's new workspace path.
   * @param options - whether an occupied destination is replaced; omitted refuses it.
   * @param signal - caller cancellation.
   * @returns the entry's new workspace path and absolute path, with its previous workspace path.
   */
  @Remote
  async move(
    workspaceFileScope: WorkspaceFileScope,
    from: string,
    to: string,
    options: WorkspaceFileMoveOptions,
    signal: AbortSignal,
  ): Promise<WorkspaceFileMutation> {
    if (to.length === 0) throw new RemoteError('gateway/bad-request', 'to is required', {})
    const { root, target } = await this.locateMutableEntry(workspaceFileScope, from, signal)
    const destination = await this.resolveMutationTarget(workspaceFileScope, to, signal)
    // A rename onto itself or into a descendant has no filesystem meaning; the
    // check also covers `to === from`, whose only effect would be a busy loop.
    if (this.ctx.fs.contains(target, destination.target)) {
      throw new RemoteError('workspace-file/bad-target', `"${to}" is inside "${from}"`, { path: from, target: to })
    }
    this.refuseRoot(destination.root, destination.target, to)
    if (destination.entry !== undefined) {
      if (destination.entry.type === 'symlink') throw this.refuseSymlink(to)
      if (options.overwrite !== true) {
        throw new RemoteError('workspace-file/already-exists', `"${to}" already exists`, { path: to })
      }
      await rm(this.hostPath(destination.target, to), { recursive: true, force: true })
    }
    await rename(this.hostPath(target, from), this.hostPath(destination.target, to))
    return this.mutationOf('moved', root, destination.target, this.relativePath(root, target))
  }

  /**
   * Remove one entry inside the Session's workspace: a file, a symbolic link is
   * refused, or a directory. A directory is removed only when it is empty,
   * unless the call asks for its contents too.
   * @param workspaceFileScope - header-derived workspace root for the Session identity on the wire.
   * @param path - the entry's workspace path.
   * @param options - whether a directory's contents go with it; omitted refuses a non-empty one.
   * @param signal - caller cancellation.
   * @returns the removed entry's workspace path and absolute path.
   */
  @Remote
  async remove(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    options: WorkspaceFileRemoveOptions,
    signal: AbortSignal,
  ): Promise<WorkspaceFileMutation> {
    const { root, target, entry } = await this.locateMutableEntry(workspaceFileScope, path, signal)
    const absolute = this.hostPath(target, path)
    if (entry.type === 'directory') {
      const children = await readdir(absolute)
      if (children.length > 0 && options.recursive !== true) {
        throw new RemoteError(
          'workspace-file/directory-not-empty',
          `"${path}" still has ${children.length} entries; nothing was removed`,
          { path },
        )
      }
      if (options.recursive === true) await rm(absolute, { recursive: true })
      else await rmdir(absolute)
    } else {
      await rm(absolute)
    }
    return this.mutationOf('removed', root, target)
  }

  /** Apply the page defaults and caps here, so the request never carries them implicitly. */
  private resolvePage(range: WorkspaceFileRange): { offset: number; limit: number } {
    const offset = range.offset === undefined ? 1 : integerAtLeast(range.offset, 1, 'offset')
    const limit = range.limit === undefined ? this.config.maxLines : integerAtLeast(range.limit, 1, 'limit')
    if (limit > this.config.maxLines) {
      throw new RemoteError('gateway/bad-request', `limit must be at most ${this.config.maxLines}`, {})
    }
    return { offset, limit }
  }

  /** Apply the byte-window defaults and cap; a window above the cap is refused, not shortened. */
  private resolveWindow(range: WorkspaceByteRange, path: string): { offset: number; length: number } {
    const offset = range.offset === undefined ? 0 : integerAtLeast(range.offset, 0, 'offset')
    const length = range.length === undefined ? this.config.maxBytes : integerAtLeast(range.length, 1, 'length')
    if (offset + length > Number.MAX_SAFE_INTEGER) {
      throw new RemoteError('gateway/bad-request', 'offset plus length must stay a safe integer', {})
    }
    if (length > this.config.maxBytes) {
      throw new RemoteError(
        'workspace-file/too-large',
        `${length} bytes of "${path}" exceed the ${this.config.maxBytes} byte cap`,
        { path, limit: this.config.maxBytes },
      )
    }
    return { offset, length }
  }

  /**
   * Inspect the requested path itself before resolution follows its final
   * component. Directory containment is checked separately by `list`.
   */
  private async inspect(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ root: FsTarget; workspaceRoot: string; entry: FsPathInfo }> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'path is required', {})
    const { workspaceRoot } = workspaceFileScope
    const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
    // Gate on the path itself before anything follows it.
    const entry = await this.ctx.fs.lstat(path, { cwd: workspaceRoot }, signal)
    if (entry === undefined) {
      throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    }
    return { root, workspaceRoot, entry }
  }

  /** Resolve an inspected path and refuse it unless the workspace contains it. */
  private async confine(root: FsTarget, workspaceRoot: string, path: string, signal: AbortSignal): Promise<FsTarget> {
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return target
  }

  /**
   * Resolve one mutation path and confine it to the workspace before anything
   * is touched. Unlike {@link inspect} this admits a path that does not exist
   * yet, which a create needs; `entry` is the path's own metadata when it does.
   */
  private async resolveMutationTarget(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ root: FsTarget; target: FsTarget; entry: FsPathInfo | undefined }> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'path is required', {})
    const { workspaceRoot } = workspaceFileScope
    const root = await this.ctx.fs.resolve(workspaceRoot, { signal })
    // Gate on the path itself before anything follows it; a missing final
    // component resolves through its nearest existing ancestor.
    const entry = await this.ctx.fs.lstat(path, { cwd: workspaceRoot }, signal)
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    if (!this.ctx.fs.contains(root, target)) {
      throw new RemoteError('workspace-file/outside-workspace', `"${path}" is outside the workspace`, { path })
    }
    return { root, target, entry }
  }

  /**
   * All gates for one entry a mutation changes: it must exist, must not be a
   * symbolic link, and must not be the workspace root itself. The verbs resolve
   * the path before touching it, so a link is refused rather than followed into
   * its destination.
   */
  private async locateMutableEntry(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ root: FsTarget; target: FsTarget; entry: FsPathInfo }> {
    const { root, workspaceRoot, entry } = await this.inspect(workspaceFileScope, path, signal)
    if (entry.type === 'symlink') throw this.refuseSymlink(path)
    const target = await this.confine(root, workspaceRoot, path, signal)
    this.refuseRoot(root, target, path)
    return { root, target, entry }
  }

  /** Refuse a create whose destination is taken, or whose name is a symbolic link. */
  private refuseOccupied(entry: FsPathInfo | undefined, path: string): void {
    if (entry === undefined) return
    if (entry.type === 'symlink') throw this.refuseSymlink(path)
    throw new RemoteError('workspace-file/already-exists', `"${path}" already exists`, { path })
  }

  /** Refuse a mutation that named the workspace root, which no verb changes. */
  private refuseRoot(root: FsTarget, target: FsTarget, path: string): void {
    if (this.relativePath(root, target) === '') {
      throw new RemoteError('workspace-file/root-refused', `"${path}" is the workspace root`, { path })
    }
  }

  /** The refusal for a mutation aimed at a symbolic link. */
  private refuseSymlink(path: string): RemoteError<'workspace-file/symlink-refused'> {
    return new RemoteError(
      'workspace-file/symlink-refused',
      `"${path}" is a symbolic link, so the workspace file verbs do not follow it`,
      { path },
    )
  }

  /**
   * The host path a mutation acts on, or the refusal for a backend that does
   * not share the harness host. `processPathFromHostPath` is the backend's own
   * answer to "is this path in your execution world the one this process can
   * open": a backend that cannot map it back has no host path to mutate.
   */
  private hostPath(target: FsTarget, path: string): string {
    const absolute = this.ctx.fs.processPath(target)
    if (this.ctx.fs.processPathFromHostPath(absolute) === undefined) {
      throw new RemoteError(
        'workspace-file/unsupported-backend',
        `"${path}" cannot be changed: the mounted filesystem does not share the harness host`,
        { path },
      )
    }
    return absolute
  }

  /** The entry's workspace path relative to the workspace root; empty for the root. */
  private relativePath(root: FsTarget, target: FsTarget): string {
    return workspacePathOf(this.ctx.fs.fileUrl(root), this.ctx.fs.fileUrl(target))
  }

  /**
   * One mutation's answer: what the call did, the entry's workspace path after
   * it, and its absolute path. `from` names the previous workspace path of a move.
   */
  private mutationOf(
    operation: WorkspaceFileMutation['operation'],
    root: FsTarget,
    target: FsTarget,
    from?: string,
  ): WorkspaceFileMutation {
    return {
      operation,
      path: this.relativePath(root, target),
      absolutePath: this.ctx.fs.processPath(target),
      ...from === undefined ? {} : { from },
    }
  }

  /**
   * All gates for a regular file, ending in the one stat that names its version
   * and size. The stat re-checks what `lstat` saw: the file may have gone or
   * changed kind in between.
   */
  private async locateFile(
    workspaceFileScope: WorkspaceFileScope,
    path: string,
    signal: AbortSignal,
  ): Promise<{ target: FsTarget; info: FsInfo }> {
    const { workspaceRoot, entry } = await this.inspect(workspaceFileScope, path, signal)
    if (entry.type !== 'file') {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is a ${entry.type}`, { path, kind: entry.type })
    }
    const target = await this.ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) {
      throw new RemoteError('workspace-file/not-found', `no entry at "${path}"`, { path })
    }
    if (info.type !== 'file') {
      throw new RemoteError('workspace-file/not-regular-file', `"${path}" is a ${info.type}`, { path, kind: info.type })
    }
    return { target, info }
  }

  private statOf(target: FsTarget, info: FsInfo): WorkspaceFileStat {
    return {
      absolutePath: this.ctx.fs.processPath(target),
      version: info.version,
      ...info.size === undefined ? {} : { bytes: info.size },
    }
  }

  /** Stream the file as text and cut the page, classifying the backend's non-text refusal. */
  private async cutPage(target: FsTarget, offset: number, limit: number, signal: AbortSignal, path: string): Promise<Page> {
    try {
      return await cutPage(await this.ctx.fs.streamText(target, signal), offset, limit, this.config.maxBytes, path)
    } catch (error: unknown) {
      if (isNotTextRefusal(error)) {
        throw new RemoteError('workspace-file/not-text', `"${path}" is not UTF-8 text`, { path }, { cause: error })
      }
      throw error
    }
  }
}

/**
 * The backend's non-text refusal, recognized by its code alone: the error class
 * belongs to whichever `dsh-fs` instance the provider loaded, so no class
 * identity is shared across the package boundary.
 */
function isNotTextRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FS_NOT_TEXT'
}

export default WorkspaceFiles
