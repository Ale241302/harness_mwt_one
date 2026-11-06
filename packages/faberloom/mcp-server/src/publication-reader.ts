/**
 * Read one file from a local Git publication at the revision a work reference
 * fixed. This is the real local reader 1.5 demonstrates; the MinIO-backed
 * retrieval of 3A.3/3A.4 remains a separate adapter.
 *
 * The caller never supplies the revision: it comes from the authorized work
 * reference, so a conversation cannot read a newer commit than the one the
 * person approved. The path is repository-relative and resolved by `git show`,
 * not by the filesystem, so a symlink or a working-tree change cannot escape it.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/publication-reader
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { McpToolDefinition } from './protocol.ts'
import { PUBLICATION_READ_TOOL } from './protocol.ts'

/** Largest file the reader returns. */
export const MAX_PUBLICATION_BYTES = 1024 * 1024

/** The tool definition, in the order the catalogue advertises it. */
export const PUBLICATION_READ_TOOL_DEFINITION: McpToolDefinition = {
  name: PUBLICATION_READ_TOOL,
  description: 'Lee un archivo de la publicación fijada por la referencia de trabajo autorizada. Devuelve revisión, ruta, tamaño, SHA-256 y texto; nunca acepta otra revisión.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description: 'Ruta relativa del archivo dentro de la publicación.',
      },
    },
  },
}

/** One published file at one revision. */
export interface PublicationRead {
  /** Commit the bytes were read from. */
  readonly revision: string
  /** Repository-relative path. */
  readonly path: string
  /** Lowercase SHA-256 of the bytes. */
  readonly sha256: string
  /** Byte length. */
  readonly bytes: number
  /** UTF-8 text. */
  readonly text: string
}

/**
 * Resolve the configured repository and refuse one that is not a Git work tree.
 * @param repo - configured repository path.
 * @returns the real absolute root.
 * @throws {Error} `PUBLICATION_UNAVAILABLE` when the path is not a Git work tree.
 */
export function publicationRoot(repo: string): string {
  let root: string
  try {
    root = realpathSync(resolve(repo))
  } catch {
    throw new Error(`faberloom: PUBLICATION_UNAVAILABLE — ${repo} does not exist`)
  }
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (realpathSync(top) !== root) {
      throw new Error('the configured path is not the repository root')
    }
  } catch {
    throw new Error(`faberloom: PUBLICATION_UNAVAILABLE — ${root} is not a Git work tree`)
  }
  return root
}

/**
 * Read one file at one commit. The revision is a commit id, not a branch, so a
 * moving branch cannot change the bytes behind an approved reference.
 * @param options - repository, commit, path, and optional byte ceiling.
 * @returns the bytes and their digest.
 * @throws {Error} `PUBLICATION_PATH_INVALID`, `PUBLICATION_NOT_FOUND`, or `PUBLICATION_TOO_LARGE`.
 */
export function readPublication(options: {
  readonly repo: string
  readonly revision: string
  readonly path: string
  readonly maxBytes?: number
}): PublicationRead {
  const root = publicationRoot(options.repo)
  const revision = options.revision.trim()
  if (!/^[0-9a-f]{7,40}$/u.test(revision)) {
    throw new Error('faberloom: PUBLICATION_REVISION_INVALID — a publication reference needs a commit id')
  }
  const path = options.path.trim().replaceAll('\\', '/')
  if (path.length === 0 || isAbsolute(path) || path.split('/').includes('..')) {
    throw new Error('faberloom: PUBLICATION_PATH_INVALID — the publication path must be repository-relative')
  }
  const absolute = resolve(root, path)
  const relativePath = relative(root, absolute)
  if (relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    throw new Error('faberloom: PUBLICATION_PATH_INVALID — the publication path escapes the repository')
  }
  let bytes: Buffer
  const limit = options.maxBytes ?? MAX_PUBLICATION_BYTES
  try {
    bytes = execFileSync('git', ['-C', root, 'show', `${revision}:${path}`], {
      maxBuffer: limit + 1,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOBUFS') {
      throw new Error('faberloom: PUBLICATION_TOO_LARGE — the published file exceeds the reader ceiling')
    }
    throw new Error(`faberloom: PUBLICATION_NOT_FOUND — ${path} is not available at ${revision}`)
  }
  if (bytes.length > limit) {
    throw new Error('faberloom: PUBLICATION_TOO_LARGE — the published file exceeds the reader ceiling')
  }
  return {
    revision,
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    text: bytes.toString('utf8'),
  }
}
