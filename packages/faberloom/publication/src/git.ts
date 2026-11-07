/**
 * The Git adapter: apply exactly one approved unified diff to one configured
 * work tree, commit it under a deterministic subject, and return the commit
 * and the committed bytes.
 *
 * The caller names a base commit, never a branch: the base must resolve to a
 * commit and must still be HEAD, so a diff approved against an older tree is
 * refused instead of applied to a newer one. Applying the same diff twice is
 * prevented by three checks in order: an existing commit with the expected
 * subject is reused, a patch already present in the index and work tree is not
 * applied again, and anything else is applied only to a clean work tree.
 * @module @deepseek-ai/dsh-faberloom-publication/src/git
 */

import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { sha256Of } from './bytes.ts'
import { publicationError } from './errors.ts'
import type { PublicationFile } from './types.ts'

/** Longest repository-relative path a publication accepts. */
export const MAX_PUBLICATION_PATH = 512

/** Longest stderr fragment carried into a refusal. */
const MAX_DETAIL = 400

/** Git output ceiling for revision and status commands. */
const SMALL_OUTPUT = 64 * 1024

/** Commit id shape accepted as a publication base. */
const COMMIT_ID = /^[0-9a-f]{7,40}$/u

/** Cross-process lock held around one apply-and-commit. */
const APPLY_LOCK = 'faberloom-apply.lock'

/** A file header of a unified diff, with an optional timestamp after a tab. */
const DIFF_FILE_HEADER = /^(?:---|\+\+\+) (.+)$/u

/** One applied publication: the commit and the bytes it fixed. */
export interface CommittedPublication {
  /** Full commit id. */
  readonly commit: string
  /** Committed file bytes. */
  readonly bytes: Buffer
  /** Lowercase SHA-256 of {@link bytes}. */
  readonly sha256: string
}

/** One multi-file application request. */
export interface CommitApplicationOptions {
  /** Configured work tree. */
  readonly root: string
  /** Base commit the diff was reviewed against. */
  readonly revision: string
  /** Unified diff. */
  readonly diff: string
  /** Board item the approval carries, used in the commit subject. */
  readonly itemId: string
  /** Version-bound artifact hash, used in the commit subject. */
  readonly artifactHash: string
  /** Server-owned paths this application may touch. */
  readonly inventory: readonly string[]
  /** Byte ceiling every committed file must respect. */
  readonly maxBytes: number
}

/** One applied multi-file approval: the commit and the files it changed. */
export interface CommittedApplication {
  /** Full commit id. */
  readonly commit: string
  /** Changed files with their committed bytes' digests. */
  readonly files: readonly PublicationFile[]
}

/** One application request the service resolves before touching the work tree. */
export interface CommitPublicationOptions {
  /** Configured work tree. */
  readonly root: string
  /** Base commit the diff was reviewed against. */
  readonly revision: string
  /** Repository-relative target path. */
  readonly path: string
  /** Unified diff. */
  readonly diff: string
  /** Board item the approval carries, used in the commit subject. */
  readonly itemId: string
  /** Version-bound artifact hash, used in the commit subject. */
  readonly artifactHash: string
  /** Byte ceiling the committed file must respect. */
  readonly maxBytes: number
}

/**
 * Run one Git command in a work tree.
 * @param root - work-tree root.
 * @param args - arguments after `git -C <root>`.
 * @param input - text written to the child's stdin.
 * @param maxBuffer - output ceiling in bytes.
 * @returns the child's stdout.
 */
function git(root: string, args: readonly string[], input?: string, maxBuffer: number = SMALL_OUTPUT): Buffer {
  return execFileSync('git', ['-C', root, ...args], {
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...input === undefined ? {} : { input },
  })
}

/**
 * Run one Git command and report whether it succeeded.
 * @param root - work-tree root.
 * @param args - arguments after `git -C <root>`.
 * @param input - text written to the child's stdin.
 * @returns true when the command exited zero.
 */
function gitSucceeds(root: string, args: readonly string[], input?: string): boolean {
  try {
    git(root, args, input)
    return true
  } catch (_refused) {
    return false
  }
}

/**
 * The operator detail of a failed Git command, bounded.
 * @param error - thrown child-process error.
 * @returns the stderr text, trimmed and truncated.
 */
function gitDetail(error: unknown): string {
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error
    ? (error as { stderr?: unknown }).stderr
    : undefined
  const stdout = typeof error === 'object' && error !== null && 'stdout' in error
    ? (error as { stdout?: unknown }).stdout
    : undefined
  const text = Buffer.isBuffer(stderr)
    ? stderr.toString('utf8')
    : typeof stderr === 'string' ? stderr : ''
  const output = Buffer.isBuffer(stdout)
    ? stdout.toString('utf8')
    : typeof stdout === 'string' ? stdout : ''
  const trimmed = text.trim()
  if (trimmed.length > 0) return trimmed.slice(0, MAX_DETAIL)
  const fallback = output.trim()
  return fallback.length === 0 ? 'git exited non-zero' : fallback.slice(0, MAX_DETAIL)
}

/**
 * Resolve the configured repository to its real root and refuse a path that is
 * not a Git work tree.
 * @param repo - configured repository path.
 * @returns the real absolute root.
 * @throws {Error} `PUBLICATION_UNAVAILABLE` when the path is missing or is not a work tree.
 */
export function openWorkTree(repo: string): string {
  let root: string
  try {
    root = realpathSync(resolve(repo))
  } catch (_missing) {
    throw publicationError('PUBLICATION_UNAVAILABLE', `${repo} does not exist`)
  }
  let top: string
  try {
    top = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim()
  } catch (_notGit) {
    throw publicationError('PUBLICATION_UNAVAILABLE', `${root} is not a Git work tree`)
  }
  if (realpathSync(top) !== root) {
    throw publicationError('PUBLICATION_UNAVAILABLE', `${root} is not the repository root`)
  }
  return root
}

/**
 * Validate one publication base: a commit id, never a branch, tag, or option.
 * @param revision - the caller's value.
 * @returns the normalized commit id.
 * @throws {Error} `PUBLICATION_REVISION_INVALID`.
 */
export function assertCommitId(revision: string): string {
  const value = revision.trim()
  if (!COMMIT_ID.test(value)) {
    throw publicationError('PUBLICATION_REVISION_INVALID', 'a publication revision must be a commit id')
  }
  return value
}

/**
 * Validate one repository-relative path and refuse traversal, absolute paths,
 * Windows separators, and non-canonical segments.
 * @param path - the caller's value.
 * @returns the normalized repository-relative path.
 * @throws {Error} `PUBLICATION_PATH_INVALID`.
 */
export function assertSafePath(path: string): string {
  const value = path.trim()
  const segments = value.split('/')
  const unsafe = value.length === 0
    || value.length > MAX_PUBLICATION_PATH
    || isAbsolute(value)
    || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')
  if (unsafe) {
    throw publicationError('PUBLICATION_PATH_INVALID', 'the publication path must be repository-relative')
  }
  return value
}

/** Diff sections the applier cannot inventory, because they carry no text path header. */
const UNSUPPORTED_SECTION = new RegExp(
  '^(GIT binary patch|rename from |rename to |copy from |copy to |old mode |new mode |'
  + 'new file mode |deleted file mode |dissimilarity index |Binary files )',
  'u',
)

/**
 * Read every repository-relative path a unified diff changes. Rename, copy,
 * mode-only, and binary sections are refused: they write paths that carry no
 * `---`/`+++` header, so an inventory check would miss them.
 * @param diff - unified diff text.
 * @returns the paths in first-seen order, without duplicates.
 * @throws {Error} `PUBLICATION_PATCH_INVALID` when no text path header exists or the diff carries an unsupported section.
 */
export function diffPaths(diff: string): readonly string[] {
  const seen: string[] = []
  for (const line of diff.split('\n')) {
    const text = line.replace(/\r$/u, '')
    if (UNSUPPORTED_SECTION.test(text)) {
      throw publicationError('PUBLICATION_PATCH_INVALID', 'the diff carries a rename, copy, mode, or binary section')
    }
    const match = DIFF_FILE_HEADER.exec(text)
    if (match === null) continue
    let value = (match[1] ?? '').trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value === '/dev/null') continue
    // `diff -u` appends a tab and a timestamp after the path; `git diff` does not.
    const path = (value.split('\t')[0] ?? '').replace(/^[ab]\//u, '')
    if (!seen.includes(path)) seen.push(path)
  }
  if (seen.length === 0) {
    throw publicationError('PUBLICATION_PATCH_INVALID', 'the diff carries no text file header')
  }
  return seen
}

/**
 * Refuse a diff that touches any path other than the approved one, so one
 * publication cannot carry a second file past the approval.
 * @param diff - unified diff text.
 * @param path - approved repository-relative path.
 * @returns nothing.
 * @throws {Error} `PUBLICATION_PATCH_INVALID` or `PUBLICATION_PATCH_PATH`.
 */
export function assertDiffTouchesOnly(diff: string, path: string): void {
  const paths = diffPaths(diff)
  if (paths.length !== 1 || paths[0] !== path) {
    throw publicationError('PUBLICATION_PATCH_PATH', `the diff touches ${paths.join(', ')}, not only the approved ${path}`)
  }
}

/**
 * The deterministic commit subject for one publication identity. A retry that
 * finds this subject in the range base..HEAD reuses that commit.
 * @param options - approval identity and base revision.
 * @returns the subject line.
 */
export function publicationCommitSubject(options: {
  readonly itemId: string
  readonly revision: string
  readonly artifactHash: string
}): string {
  return `faberloom: publish ${options.itemId} ${options.revision.slice(0, 12)} ${options.artifactHash.slice(0, 12)}`
}

/**
 * Resolve one commit id in the work tree.
 * @param root - work-tree root.
 * @param revision - commit id or `HEAD`.
 * @returns the full commit id.
 * @throws {Error} `PUBLICATION_REVISION_INVALID` when it does not resolve to a commit.
 */
function resolveCommit(root: string, revision: string): string {
  try {
    return git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).toString('utf8').trim()
  } catch (_unknown) {
    throw publicationError('PUBLICATION_REVISION_INVALID', `${revision} is not a commit in this repository`)
  }
}

/**
 * Find a commit this publication identity already produced.
 * @param root - work-tree root.
 * @param base - base commit.
 * @param subject - deterministic subject.
 * @returns the commit id, or undefined when the range holds no such commit.
 */
function findCommit(root: string, base: string, subject: string): string | undefined {
  const log = git(root, ['log', '--format=%H%x00%s', `${base}..HEAD`], undefined, 4 * 1024 * 1024).toString('utf8')
  for (const line of log.split('\n')) {
    const [commit, message] = line.split('\u0000')
    if (commit !== undefined && commit.length > 0 && message === subject) return commit
  }
  return undefined
}

/**
 * Read one committed file, enforcing the byte ceiling.
 * @param root - work-tree root.
 * @param commit - commit id.
 * @param path - repository-relative path.
 * @param maxBytes - byte ceiling.
 * @returns the blob's exact bytes.
 * @throws {Error} `PUBLICATION_NOT_FOUND` or `PUBLICATION_TOO_LARGE`.
 */
export function committedBytes(root: string, commit: string, path: string, maxBytes: number): Buffer {
  let bytes: Buffer
  try {
    bytes = git(root, ['show', `${commit}:${path}`], undefined, maxBytes + 1)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOBUFS') {
      throw publicationError('PUBLICATION_TOO_LARGE', `the published file exceeds ${String(maxBytes)} bytes`)
    }
    throw publicationError('PUBLICATION_NOT_FOUND', `${path} is not available at ${commit}`)
  }
  if (bytes.length > maxBytes) {
    throw publicationError('PUBLICATION_TOO_LARGE', `the published file exceeds ${String(maxBytes)} bytes`)
  }
  return bytes
}

/**
 * Refuse a work tree whose tracked files differ from HEAD. Untracked files are
 * outside the check because an apply of this publication never touches them;
 * a collision with the target path fails in `git apply` instead.
 * @param root - work-tree root.
 * @returns nothing.
 * @throws {Error} `PUBLICATION_WORKTREE_DIRTY`.
 */
function assertCleanWorkTree(root: string): void {
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']).toString('utf8').trim()
  if (status.length > 0) {
    throw publicationError('PUBLICATION_WORKTREE_DIRTY', 'the work tree has changes that are not part of this publication')
  }
}

/** The Git directory of a work tree, resolved. */
function gitDir(root: string): string {
  return resolve(root, git(root, ['rev-parse', '--git-dir']).toString('utf8').trim())
}

/** Whether a process id is still alive. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A lock directory younger than this may still be acquiring its owner file. */
const LOCK_STALE_MS = 30_000

/** Whether a lock directory has no owner because its creator died mid-acquisition. */
function lockIsStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return true
  }
}

/** Create the lock directory atomically; every filesystem supports that. */
function tryLock(lock: string, token: string): boolean {
  try {
    mkdirSync(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw publicationError('PUBLICATION_LOCKED', error instanceof Error ? error.message : String(error))
  }
  try {
    writeFileSync(join(lock, 'owner'), token)
  } catch (error) {
    rmSync(lock, { recursive: true, force: true })
    throw publicationError('PUBLICATION_LOCKED', error instanceof Error ? error.message : String(error))
  }
  return true
}

/** Read the lock owner token, empty while the creator has not written it yet. */
function lockOwner(lock: string): string {
  try {
    return readFileSync(join(lock, 'owner'), 'utf8')
  } catch {
    return ''
  }
}

/** Run one application under a cross-process lock; a live holder is a conflict. */
function withApplyLock<T>(root: string, job: () => T): T {
  const lock = join(gitDir(root), APPLY_LOCK)
  // A per-acquisition nonce distinguishes two appliers in one process.
  const token = `${String(process.pid)}:${Math.random().toString(36).slice(2)}`
  if (!tryLock(lock, token)) {
    const owner = lockOwner(lock)
    const holder = Number(owner.split(':')[0] ?? '')
    if (owner.length === 0 && !lockIsStale(lock)) {
      throw publicationError('PUBLICATION_LOCKED', 'another application is acquiring the lock')
    }
    if (holder > 0 && processAlive(holder)) {
      throw publicationError('PUBLICATION_LOCKED', `another application holds the lock (pid ${String(holder)})`)
    }
    rmSync(lock, { recursive: true, force: true })
    if (!tryLock(lock, token)) throw publicationError('PUBLICATION_LOCKED', 'the application lock could not be acquired')
  }
  try {
    return job()
  } finally {
    // Remove only the lock this acquisition created; a stale holder may have
    // been replaced while this process was working.
    if (lockOwner(lock) === token) rmSync(lock, { recursive: true, force: true })
  }
}

/** Refuse a path any of whose existing components is a symbolic link. */
function assertNoSymlink(root: string, path: string): void {
  const segments = path.split('/')
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw publicationError('PUBLICATION_PATH_INVALID', `cannot inspect ${path}`)
    }
    if (stat.isSymbolicLink()) {
      throw publicationError('PUBLICATION_SYMLINK', `${path} is a symbolic link`)
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw publicationError('PUBLICATION_PATH_INVALID', `${path} has a non-directory parent`)
    }
  }
}

/** Resolve every diff path against the server inventory; empty inventory fails closed. */
function validateInventory(diff: string, inventory: readonly string[]): readonly string[] {
  const paths = diffPaths(diff).map(path => assertSafePath(path))
  const allowed = new Set(inventory.map(path => assertSafePath(path)))
  if (allowed.size === 0) {
    throw publicationError('PUBLICATION_INVENTORY', 'no authorized inventory is configured')
  }
  for (const path of paths) {
    if (!allowed.has(path)) {
      throw publicationError('PUBLICATION_INVENTORY', `${path} is not in the authorized inventory`)
    }
  }
  return paths
}

/**
 * Apply the whole diff and commit it, or reuse the commit an earlier attempt
 * made. The caller holds the application lock and has already checked the base.
 * @param root - work-tree root.
 * @param base - resolved base commit.
 * @param subject - deterministic commit subject.
 * @param options - diff, paths, and identity for the message body.
 * @param paths - validated inventory paths the diff touches.
 * @returns the commit id.
 */
function commitDiffMulti(
  root: string,
  base: string,
  subject: string,
  options: CommitApplicationOptions,
  paths: readonly string[],
): string {
  const head = resolveCommit(root, 'HEAD')
  if (head !== base) {
    throw publicationError('PUBLICATION_BASE_STALE', `HEAD is ${head}, not the approved base ${base}`)
  }
  for (const path of paths) assertNoSymlink(root, path)
  // A crash between `git apply --index` and `git commit` leaves the patch in
  // the index and the work tree. Reverse-checking first resumes that attempt
  // instead of refusing it as a dirty tree or applying the patch twice.
  if (!gitSucceeds(root, ['apply', '--index', '--reverse', '--check'], options.diff)) {
    assertCleanWorkTree(root)
    if (!gitSucceeds(root, ['apply', '--index', '--check'], options.diff)) {
      throw publicationError('PUBLICATION_PATCH_REJECTED', 'the approved diff does not apply to the approved base')
    }
    try {
      git(root, ['apply', '--index', '--whitespace=nowarn'], options.diff)
    } catch (error) {
      throw publicationError('PUBLICATION_PATCH_REJECTED', gitDetail(error))
    }
  }
  // The reverse-check proved the patch's own content is what is staged, so
  // reversing it cannot touch a foreign change.
  const undo = (): void => {
    gitSucceeds(root, ['apply', '--index', '--reverse'], options.diff)
  }
  // The index is the authority for what the commit will contain. It must be
  // exactly the inventory paths, so a section the text parser missed cannot
  // reach the commit.
  let staged: string[]
  try {
    const listing = git(
      root,
      ['diff', '--cached', '--name-only', '-z'],
      undefined,
      Math.max(SMALL_OUTPUT, options.diff.length + 4096),
    )
    staged = listing.toString('utf8').split('\u0000').filter(Boolean)
  } catch (error) {
    undo()
    throw publicationError('PUBLICATION_PATCH_REJECTED', gitDetail(error))
  }
  if (staged.length !== paths.length || !paths.every(path => staged.includes(path))) {
    undo()
    throw publicationError('PUBLICATION_PATCH_PATH', `the staged paths are ${staged.join(', ')}, not ${paths.join(', ')}`)
  }
  // Recheck the real destination after applying: a junction swapped into a
  // parent between the pre-check and `git apply` would otherwise escape.
  const realRoot = realpathSync(root)
  for (const path of paths) {
    let target: string
    try {
      target = realpathSync(resolve(root, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      undo()
      throw publicationError('PUBLICATION_NOT_FOUND', `${path} is not available in the work tree`)
    }
    if (target !== realRoot && !target.startsWith(realRoot + sep)) {
      undo()
      throw publicationError('PUBLICATION_SYMLINK', `${path} resolves outside the work tree`)
    }
    let stat
    try {
      stat = statSync(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      undo()
      throw publicationError('PUBLICATION_NOT_FOUND', `${path} is not available in the work tree`)
    }
    if (!stat.isFile()) {
      undo()
      throw publicationError('PUBLICATION_PATH_INVALID', `${path} is not a regular file`)
    }
    // A hardlink is not a symbolic link, but writing it changes a file outside
    // the work tree; the applier refuses it like a symlink.
    if (stat.nlink > 1) {
      undo()
      throw publicationError('PUBLICATION_SYMLINK', `${path} is a hard link`)
    }
    if (stat.size > options.maxBytes) {
      undo()
      throw publicationError('PUBLICATION_TOO_LARGE', `the published file exceeds ${String(options.maxBytes)} bytes`)
    }
  }
  // The staged blob is what Git will commit, and it can differ from the work
  // tree under a filter. Checking it here keeps an oversized commit out.
  for (const path of paths) {
    let size: number
    try {
      size = Number(git(root, ['cat-file', '-s', `:${path}`]).toString('utf8').trim())
    } catch {
      // A deletion has no staged blob.
      continue
    }
    if (!Number.isFinite(size)) {
      undo()
      throw publicationError('PUBLICATION_PATH_INVALID', `${path} has no staged blob`)
    }
    if (size > options.maxBytes) {
      undo()
      throw publicationError('PUBLICATION_TOO_LARGE', `the published file exceeds ${String(options.maxBytes)} bytes`)
    }
  }
  const message = [
    subject,
    '',
    `Artifact-SHA256: ${options.artifactHash}`,
    `Publication-Revision: ${options.revision}`,
    `Publication-Paths: ${paths.join(', ')}`,
  ].join('\n')
  try {
    // An empty hooks path keeps `post-commit` and every other hook from running
    // on content this service just wrote; `--no-verify` alone skips only some.
    git(
      root,
      [
        '-c', 'user.name=FaberLoom Publication',
        '-c', 'user.email=publication@faberloom.invalid',
        '-c', `core.hooksPath=${join(gitDir(root), 'faberloom-no-hooks')}`,
        'commit', '--no-gpg-sign', '--no-verify', '-F', '-',
      ],
      `${message}\n`,
    )
  } catch (error) {
    undo()
    throw publicationError('PUBLICATION_COMMIT_FAILED', gitDetail(error))
  }
  return resolveCommit(root, 'HEAD')
}

/** Read the files one application commit changed, in the requested order. */
function committedFiles(
  root: string,
  commit: string,
  paths: readonly string[],
  maxBytes: number,
): readonly PublicationFile[] {
  const output = git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', '-z', commit]).toString('utf8')
  const tokens = output.split('\u0000')
  const status = new Map<string, PublicationFile['status']>()
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const letter = tokens[index] ?? ''
    const path = tokens[index + 1] ?? ''
    if (path.length === 0) continue
    status.set(path, letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified')
  }
  // A reused commit is identified by subject; refuse one that carries a file
  // this approval never named, or omits one it did.
  if (status.size !== paths.length) {
    throw publicationError('PUBLICATION_PATCH_PATH', `commit ${commit} changed ${String(status.size)} files, not ${String(paths.length)}`)
  }
  for (const path of status.keys()) {
    if (!paths.includes(path)) {
      throw publicationError('PUBLICATION_PATCH_PATH', `commit ${commit} changed ${path}, which the approval never named`)
    }
  }
  return paths.map((path) => {
    const changed = status.get(path) ?? 'modified'
    if (changed === 'deleted') return { path, status: 'deleted', sha256: null, bytes: null }
    const bytes = committedBytes(root, commit, path, maxBytes)
    return { path, status: changed, sha256: sha256Of(bytes), bytes: bytes.length }
  })
}

/**
 * Apply one approved multi-file diff, commit it, and return the commit and its
 * files. The inventory, base, paths, and symlinks are revalidated under a
 * cross-process lock immediately before writing.
 * @param options - work tree, base, diff, identity, inventory, and ceiling.
 * @returns the commit and the files it changed.
 * @throws {Error} `PUBLICATION_UNAVAILABLE`, `PUBLICATION_REVISION_INVALID`,
 * `PUBLICATION_PATH_INVALID`, `PUBLICATION_PATCH_INVALID`,
 * `PUBLICATION_INVENTORY`, `PUBLICATION_SYMLINK`, `PUBLICATION_BASE_STALE`,
 * `PUBLICATION_WORKTREE_DIRTY`, `PUBLICATION_PATCH_REJECTED`,
 * `PUBLICATION_TOO_LARGE`, `PUBLICATION_COMMIT_FAILED`,
 * `PUBLICATION_LOCKED`, or `PUBLICATION_NOT_FOUND`.
 */
export function commitApplication(options: CommitApplicationOptions): CommittedApplication {
  const root = openWorkTree(options.root)
  const revision = assertCommitId(options.revision)
  const paths = validateInventory(options.diff, options.inventory)
  const base = resolveCommit(root, revision)
  const subject = publicationCommitSubject({
    itemId: options.itemId,
    revision,
    artifactHash: options.artifactHash,
  })
  const reused = findCommit(root, base, subject)
  if (reused !== undefined) {
    return { commit: reused, files: committedFiles(root, reused, paths, options.maxBytes) }
  }
  return withApplyLock(root, () => {
    // Another process may have committed this identity while this one waited
    // for the lock; reconcile before revalidating or writing.
    const reusedNow = findCommit(root, base, subject)
    if (reusedNow !== undefined) {
      return { commit: reusedNow, files: committedFiles(root, reusedNow, paths, options.maxBytes) }
    }
    // Revalidate immediately before writing: the inventory may have changed,
    // a symlink may have appeared, or another process may have moved HEAD.
    validateInventory(options.diff, options.inventory)
    for (const path of paths) assertNoSymlink(root, path)
    const commit = commitDiffMulti(root, base, subject, options, paths)
    return { commit, files: committedFiles(root, commit, paths, options.maxBytes) }
  })
}

/**
 * Apply one approved diff, commit it, and return the committed bytes. An
 * existing commit with this publication's deterministic subject is reused
 * instead of applying the diff again.
 * @param options - work tree, base commit, path, diff, identity, and ceiling.
 * @returns the commit and the committed bytes.
 * @throws {Error} `PUBLICATION_UNAVAILABLE`, `PUBLICATION_REVISION_INVALID`,
 * `PUBLICATION_PATH_INVALID`, `PUBLICATION_PATCH_INVALID`,
 * `PUBLICATION_PATCH_PATH`, `PUBLICATION_BASE_STALE`,
 * `PUBLICATION_WORKTREE_DIRTY`, `PUBLICATION_PATCH_REJECTED`,
 * `PUBLICATION_TOO_LARGE`, `PUBLICATION_COMMIT_FAILED`, or
 * `PUBLICATION_NOT_FOUND`.
 */
export function commitPublication(options: CommitPublicationOptions): CommittedPublication {
  const root = openWorkTree(options.root)
  const path = assertSafePath(options.path)
  const revision = assertCommitId(options.revision)
  assertDiffTouchesOnly(options.diff, path)
  const application = commitApplication({
    root,
    revision,
    diff: options.diff,
    itemId: options.itemId,
    artifactHash: options.artifactHash,
    inventory: [path],
    maxBytes: options.maxBytes,
  })
  const bytes = committedBytes(root, application.commit, path, options.maxBytes)
  return { commit: application.commit, bytes, sha256: sha256Of(bytes) }
}
