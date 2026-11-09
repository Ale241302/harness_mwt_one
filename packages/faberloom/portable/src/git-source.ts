/**
 * Read documents from the authorized Git commit, never from the work tree. The
 * commit id comes from the 3A.1 approval; a path that is absent at that commit
 * or exceeds the ceiling is refused before planning.
 * @module @deepseek-ai/dsh-faberloom-portable/src/git-source
 */

import { execFileSync } from 'node:child_process'
import { portableError } from './errors.ts'
import { assertArtifactPath } from './paths.ts'
import type { PortableContribution } from './types.ts'

/** Commit id shape accepted as the source revision: full SHA-1 or SHA-256. */
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

/** Environment that disables replace refs for every read. */
function gitEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' }
}

/**
 * Prove the supplied revision names the same commit git resolves, with replace
 * refs disabled. A branch or tag named like a hash cannot pass.
 * @param repo - absolute work-tree path.
 * @param revision - full commit id.
 * @returns nothing.
 * @throws {Error} `PORTABLE_SOURCE` when the revision is not a commit id or resolves elsewhere.
 */
function assertRevision(repo: string, revision: string): void {
  if (!REVISION.test(revision)) throw portableError('PORTABLE_SOURCE', 'revision is not a full commit id')
  let resolved: string
  try {
    resolved = execFileSync(
      'git',
      ['-C', repo, '--no-replace-objects', 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnvironment() },
    ).trim().toLocaleLowerCase('en')
  } catch {
    throw portableError('PORTABLE_SOURCE', `${revision} is not a commit`)
  }
  if (resolved !== revision) throw portableError('PORTABLE_SOURCE', `${revision} resolves to ${resolved}`)
}

/** Options for one committed read. */
export interface CommittedReadOptions {
  /** Absolute Git work-tree path. */
  readonly repo: string
  /** Commit id the approval fixed. */
  readonly revision: string
  /** Repository-relative path. */
  readonly path: string
  /** Byte ceiling. */
  readonly maxBytes: number
}

/**
 * Read one file at one commit.
 * @param options - repository, revision, path, and ceiling.
 * @returns the UTF-8 content.
 * @throws {Error} `PORTABLE_SOURCE` when the path is absent, binary, or oversized.
 */
export function readCommittedContent(options: CommittedReadOptions): string {
  assertRevision(options.repo, options.revision)
  const path = assertArtifactPath(options.path)
  let content: string
  try {
    content = execFileSync(
      'git',
      ['-C', options.repo, '--no-replace-objects', 'cat-file', 'blob', `${options.revision}:${path}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: options.maxBytes + 1,
        env: gitEnvironment(),
      },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOBUFS') {
      throw portableError('PORTABLE_TOO_LARGE', `${path} exceeds ${String(options.maxBytes)} bytes`)
    }
    throw portableError('PORTABLE_SOURCE', `${path} is not available at ${options.revision}`)
  }
  if (content.includes('\u0000')) throw portableError('PORTABLE_SOURCE', `${path} is binary`)
  if (Buffer.byteLength(content, 'utf8') > options.maxBytes) {
    throw portableError('PORTABLE_TOO_LARGE', `${path} exceeds ${String(options.maxBytes)} bytes`)
  }
  return content
}

/** Options for reading a document set. */
export interface CommittedDocumentsOptions {
  /** Absolute Git work-tree path. */
  readonly repo: string
  /** Commit id the approval fixed. */
  readonly revision: string
  /** Repository-relative document paths. */
  readonly paths: readonly string[]
  /** Classification per path. A path without one is denied by the planner. */
  readonly classifications: Readonly<Record<string, string>>
  /** Dependencies per path, by contribution id. */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>
  /** Byte ceiling per file; defaults to 1 MiB. */
  readonly maxBytes?: number
}

/**
 * Read a document set at one commit and turn it into contributions.
 * @param options - repository, revision, paths, and classifications.
 * @returns one `document` contribution per path, ordered by path.
 */
export function committedDocuments(options: CommittedDocumentsOptions): PortableContribution[] {
  const maxBytes = options.maxBytes ?? 1024 * 1024
  return [...options.paths]
    .map(path => assertArtifactPath(path))
    .sort()
    .map((path) => {
      const title = path.split('/').at(-1) ?? path
      const classification = options.classifications[path]
      return {
        id: `document:${path}`,
        kind: 'document' as const,
        path,
        title,
        content: readCommittedContent({ repo: options.repo, revision: options.revision, path, maxBytes }),
        ...(classification === undefined ? {} : { classification }),
        dependsOn: options.dependencies?.[path] ?? [],
      }
    })
}
