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
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { sha256Of } from './bytes.ts'
import { publicationError } from './errors.ts'

/** Longest repository-relative path a publication accepts. */
export const MAX_PUBLICATION_PATH = 512

/** Longest stderr fragment carried into a refusal. */
const MAX_DETAIL = 400

/** Git output ceiling for revision and status commands. */
const SMALL_OUTPUT = 64 * 1024

/** Commit id shape accepted as a publication base. */
const COMMIT_ID = /^[0-9a-f]{7,40}$/u

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
  const text = Buffer.isBuffer(stderr)
    ? stderr.toString('utf8')
    : typeof stderr === 'string' ? stderr : ''
  const trimmed = text.trim()
  return trimmed.length === 0 ? 'git exited non-zero' : trimmed.slice(0, MAX_DETAIL)
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

/**
 * Refuse a diff that touches any path other than the approved one, so one
 * publication cannot carry a second file past the approval. Binary patches and
 * empty diffs are refused because they carry no text file headers.
 * @param diff - unified diff text.
 * @param path - approved repository-relative path.
 * @returns nothing.
 * @throws {Error} `PUBLICATION_PATCH_INVALID` or `PUBLICATION_PATCH_PATH`.
 */
export function assertDiffTouchesOnly(diff: string, path: string): void {
  const seen = new Set<string>()
  for (const line of diff.split('\n')) {
    const match = DIFF_FILE_HEADER.exec(line.replace(/\r$/u, ''))
    if (match === null) continue
    let value = (match[1] ?? '').trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value === '/dev/null') continue
    // `diff -u` appends a tab and a timestamp after the path; `git diff` does not.
    seen.add((value.split('\t')[0] ?? '').replace(/^[ab]\//u, ''))
  }
  if (seen.size === 0) {
    throw publicationError('PUBLICATION_PATCH_INVALID', 'the diff carries no text file header')
  }
  for (const touched of seen) {
    if (touched !== path) {
      throw publicationError('PUBLICATION_PATCH_PATH', `the diff touches ${touched}, not the approved ${path}`)
    }
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

/**
 * Apply the diff and commit it, or reuse the commit an earlier attempt made.
 * @param root - work-tree root.
 * @param base - resolved base commit.
 * @param subject - deterministic commit subject.
 * @param options - diff, path, and identity for the message body.
 * @returns the commit id.
 */
function commitDiff(root: string, base: string, subject: string, options: CommitPublicationOptions): string {
  const head = resolveCommit(root, 'HEAD')
  if (head !== base) {
    throw publicationError('PUBLICATION_BASE_STALE', `HEAD is ${head}, not the approved base ${base}`)
  }
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
  // The ceiling is checked on the applied file before the commit, so an
  // oversized artifact is refused without leaving a commit behind. Reversing
  // our own patch restores the tree the refusal promises to leave untouched.
  const applied = resolve(root, options.path)
  let size: number
  try {
    size = statSync(applied).size
  } catch (_missing) {
    gitSucceeds(root, ['apply', '--index', '--reverse'], options.diff)
    throw publicationError('PUBLICATION_NOT_FOUND', `${options.path} is not available in the work tree`)
  }
  if (size > options.maxBytes) {
    gitSucceeds(root, ['apply', '--index', '--reverse'], options.diff)
    throw publicationError('PUBLICATION_TOO_LARGE', `the published file exceeds ${String(options.maxBytes)} bytes`)
  }
  const message = [
    subject,
    '',
    `Artifact-SHA256: ${options.artifactHash}`,
    `Publication-Revision: ${options.revision}`,
    `Publication-Path: ${options.path}`,
  ].join('\n')
  try {
    git(
      root,
      ['-c', 'user.name=FaberLoom Publication', '-c', 'user.email=publication@faberloom.invalid', 'commit', '--no-gpg-sign', '-F', '-'],
      `${message}\n`,
    )
  } catch (error) {
    throw publicationError('PUBLICATION_COMMIT_FAILED', gitDetail(error))
  }
  return resolveCommit(root, 'HEAD')
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
  const base = resolveCommit(root, revision)
  const subject = publicationCommitSubject({
    itemId: options.itemId,
    revision,
    artifactHash: options.artifactHash,
  })
  const reused = findCommit(root, base, subject)
  if (reused !== undefined) {
    const bytes = committedBytes(root, reused, path, options.maxBytes)
    return { commit: reused, bytes, sha256: sha256Of(bytes) }
  }
  const commit = commitDiff(root, base, subject, { ...options, path, revision })
  const bytes = committedBytes(root, commit, path, options.maxBytes)
  return { commit, bytes, sha256: sha256Of(bytes) }
}
