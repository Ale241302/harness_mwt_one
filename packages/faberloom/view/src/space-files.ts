/**
 * One directory listing for the sidebar explorer.
 *
 * The product's Workspaces and Spaces are real folders: the harness projection
 * writes `.agents`, `.claude`, `AGENTS.md`, skills, agents, commands, and the
 * documents the operator drops there. The explorer lists one level at a time,
 * hidden entries included, and refuses any path that leaves the area it was
 * asked about.
 * @module @deepseek-ai/dsh-faberloom-view/src/space-files
 */
import { readdir, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** Most entries one listing returns. */
export const SPACE_FILES_LIMIT = 500

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
    // A directory carries no size; statting one only to discard the value would
    // double the syscalls of expanding a folder.
    const info = kind === 'directory' ? undefined : await stat(resolve(target, entry.name))
    rows.push({
      name: entry.name,
      kind,
      bytes: info?.size ?? 0,
      modifiedAt: info?.mtime.toISOString() ?? new Date(0).toISOString(),
    })
  }
  const rank = (row: SpaceFileEntry): number => row.kind === 'directory' ? 0 : row.kind === 'file' ? 1 : 2
  return rows.sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name, 'es'))
}
