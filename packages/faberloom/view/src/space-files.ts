/**
 * The explorer's view of a Space's folder.
 *
 * The product's Workspaces and Spaces are real folders: the harness projection
 * writes `.agents`, `.claude`, `AGENTS.md`, skills, agents, commands, and the
 * documents the operator drops there. The explorer lists one level at a time,
 * can read the whole tree for search and session grouping, and refuses any path
 * that leaves the area it was asked about.
 * @module @deepseek-ai/dsh-faberloom-view/src/space-files
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Stats } from 'node:fs'

/** Most entries one directory listing returns. */
export const SPACE_FILES_LIMIT = 500

/** Most entries one whole-tree read returns. */
export const SPACE_TREE_LIMIT = 5000

/** Deepest folder the whole-tree read descends. */
export const SPACE_TREE_DEPTH = 12

/** What kind of entry one row names. */
export type SpaceFileKind = 'directory' | 'file' | 'other'

/** One row the explorer draws. */
export interface SpaceFileEntry {
  /** Entry name, exactly as the filesystem reports it. */
  readonly name: string
  /** Entry kind the explorer draws differently. */
  readonly kind: SpaceFileKind
  /** Size in bytes; zero for a directory. */
  readonly bytes: number
  /** Last modification, ISO-8601. */
  readonly modifiedAt: string
  /** Creation time, ISO-8601; the modification time when the filesystem has no birth time. */
  readonly createdAt: string
}

/** One row of a whole-tree read, rooted at the area. */
export interface SpaceTreeEntry extends SpaceFileEntry {
  /** Area-relative path, always with `/` separators. */
  readonly path: string
}

/**
 * Resolve one workspace-relative path inside an area, refusing an escape.
 * @param root - the area's absolute path.
 * @param path - the workspace-relative path.
 * @returns the absolute path inside the area.
 * @throws when the path leaves the area.
 */
export function resolveSpacePath(root: string, path: string): string {
  const base = resolve(root)
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('faberloom: la ruta queda fuera de la carpeta del espacio')
  }
  return target
}

/** Compare two absolute paths under the platform's own case rules. */
function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** True when `target` is `root` or one of its descendants. */
function insideRoot(root: string, target: string): boolean {
  return samePath(target, root) || (process.platform === 'win32'
    ? target.toLowerCase().startsWith(`${root.toLowerCase()}${sep}`)
    : target.startsWith(`${root}${sep}`))
}

/**
 * Confirm that a resolved path really lives inside the area once every symbolic
 * link is followed. The lexical check in {@link resolveSpacePath} cannot see a
 * link inside the area that points outside it.
 * @param root - the area's absolute path.
 * @param target - an absolute path already returned by {@link resolveSpacePath}.
 * @returns nothing; the path is safe.
 * @throws when the path or one of its links resolves outside the area.
 */
export async function assertSpaceRealPath(root: string, target: string): Promise<void> {
  if (!insideRoot(await realpath(resolve(root)), await realpath(target))) {
    throw new Error('faberloom: la ruta resuelve fuera de la carpeta del espacio')
  }
}

/**
 * Confirm that the parent of a target that may not exist yet is really inside
 * the area, so a rename cannot land through a linked directory.
 * @param root - the area's absolute path.
 * @param target - an absolute path already returned by {@link resolveSpacePath}.
 * @returns nothing; the parent is safe.
 * @throws when the parent resolves outside the area.
 */
export async function assertSpaceParentRealPath(root: string, target: string): Promise<void> {
  if (!insideRoot(await realpath(resolve(root)), await realpath(dirname(target)))) {
    throw new Error('faberloom: la ruta resuelve fuera de la carpeta del espacio')
  }
}

/**
 * Report whether one entry is itself a symbolic link or sits behind one.
 * @param target - absolute path inside an area.
 * @returns true when the entry must not be opened, renamed, or deleted through this API.
 */
export async function isLinkedSpaceEntry(target: string): Promise<boolean> {
  const info = await lstat(target).catch(() => undefined)
  return info?.isSymbolicLink() === true
}

/**
 * Describe one filesystem entry.
 * @param name - the entry name.
 * @param kind - the entry kind.
 * @param info - its stat, when the caller already read one.
 * @returns the row the explorer draws.
 */
function describe(name: string, kind: SpaceFileKind, info: Stats | undefined): SpaceFileEntry {
  const born = info === undefined || !(info.birthtimeMs > 0) ? info?.mtimeMs : info.birthtimeMs
  return {
    name,
    kind,
    bytes: kind === 'directory' ? 0 : info?.size ?? 0,
    modifiedAt: info === undefined ? new Date(0).toISOString() : info.mtime.toISOString(),
    createdAt: born === undefined ? new Date(0).toISOString() : new Date(born).toISOString(),
  }
}

/** Directories first, then files, then anything else, each by name. */
function rank(kind: SpaceFileKind): number {
  return kind === 'directory' ? 0 : kind === 'file' ? 1 : 2
}

/**
 * List one directory inside a workspace area.
 * @param root - the area's absolute path.
 * @param path - the workspace-relative directory to list.
 * @returns directories first, then files, each by name.
 * @throws when the path leaves the area or the directory cannot be read.
 */
export async function listSpaceDirectory(root: string, path: string): Promise<readonly SpaceFileEntry[]> {
  const target = resolveSpacePath(root, path)
  const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
    // A Space that mirrors no Workspace yet points at its deterministic area,
    // which the first conversation creates; an absent folder is an empty one.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const rows: SpaceFileEntry[] = []
  for (const entry of entries.slice(0, SPACE_FILES_LIMIT)) {
    const kind: SpaceFileKind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    const info = await stat(resolve(target, entry.name))
    rows.push(describe(entry.name, kind, info))
  }
  return rows.sort((left, right) => rank(left.kind) - rank(right.kind) || left.name.localeCompare(right.name, 'es'))
}

/**
 * Read the whole area once, for search and session grouping. Hidden entries are
 * included; the read stops at {@link SPACE_TREE_LIMIT} entries and
 * {@link SPACE_TREE_DEPTH} levels so one enormous folder cannot stall the panel.
 * @param root - the area's absolute path.
 * @returns every entry, each with its area-relative path.
 */
export async function readSpaceTree(root: string): Promise<readonly SpaceTreeEntry[]> {
  const out: SpaceTreeEntry[] = []
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth >= SPACE_TREE_DEPTH || out.length >= SPACE_TREE_LIMIT) return
    const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (out.length >= SPACE_TREE_LIMIT) return
      const kind: SpaceFileKind = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const info = await stat(resolve(dir, entry.name))
      out.push({ ...describe(entry.name, kind, info), path })
      if (kind === 'directory') await walk(resolve(dir, entry.name), path, depth + 1)
    }
  }
  await walk(resolve(root), '', 0)
  return out.sort((left, right) => rank(left.kind) - rank(right.kind) || left.path.localeCompare(right.path, 'es'))
}
