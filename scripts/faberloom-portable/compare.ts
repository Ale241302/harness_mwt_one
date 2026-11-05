/**
 * Independent comparison for the portable harness: digests of expected and
 * actual bytes, so a changed file, a missing file, or an extra file fails the
 * run instead of being reported as a pass. The expected tree is prepared by QA,
 * never by the code under test (HAR-03, HAR-07).
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** One file whose bytes differ or whose presence differs. */
export interface TreeDifference {
  /** Path relative to the tree root, with forward slashes. */
  readonly path: string
  /** What the comparison observed. */
  readonly kind: 'changed' | 'missing' | 'extra'
  /** Digest of the expected bytes, or null when the file is extra. */
  readonly expectedSha256: string | null
  /** Digest of the actual bytes, or null when the file is missing. */
  readonly actualSha256: string | null
}

/** Result of comparing two trees. */
export interface TreeComparison {
  /** Whether every expected file exists with the expected bytes and no extra file appeared. */
  readonly ok: boolean
  /** Expected files compared. */
  readonly compared: number
  /** Differences, ordered by path. */
  readonly differences: readonly TreeDifference[]
}

/**
 * Hash one buffer.
 * @param bytes - content to hash.
 * @returns lowercase SHA-256.
 */
export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Read every file under one root, keyed by its POSIX relative path.
 * @param root - absolute directory.
 * @returns path to digest.
 */
function digestTree(root: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const absolute = join(entry.parentPath, entry.name)
    const key = relative(root, absolute).split(sep).join('/')
    out.set(key, sha256(readFileSync(absolute)))
  }
  return out
}

/**
 * Compare an expected tree against the produced tree.
 * @param expectedRoot - directory QA prepared.
 * @param actualRoot - directory the run produced.
 * @returns whether they match, how many files were compared, and every difference.
 */
export function compareTrees(expectedRoot: string, actualRoot: string): TreeComparison {
  const expected = digestTree(expectedRoot)
  const actual = digestTree(actualRoot)
  const differences: TreeDifference[] = []
  for (const [path, digest] of expected) {
    const produced = actual.get(path)
    if (produced === undefined) {
      differences.push({ path, kind: 'missing', expectedSha256: digest, actualSha256: null })
    } else if (produced !== digest) {
      differences.push({ path, kind: 'changed', expectedSha256: digest, actualSha256: produced })
    }
  }
  for (const [path, digest] of actual) {
    if (expected.has(path)) continue
    differences.push({ path, kind: 'extra', expectedSha256: null, actualSha256: digest })
  }
  differences.sort((left, right) => left.path.localeCompare(right.path))
  return { ok: differences.length === 0, compared: expected.size, differences }
}

/**
 * Compare one file's bytes with the expected digest.
 * @param path - file to read.
 * @param expectedSha256 - digest QA prepared.
 * @returns whether the bytes match and both digests, or null when the file is absent.
 */
export function compareFile(path: string, expectedSha256: string): {
  readonly ok: boolean
  readonly expectedSha256: string
  readonly actualSha256: string | null
} {
  try {
    if (!statSync(path).isFile()) return { ok: false, expectedSha256, actualSha256: null }
    const actual = sha256(readFileSync(path))
    return { ok: actual === expectedSha256, expectedSha256, actualSha256: actual }
  } catch {
    return { ok: false, expectedSha256, actualSha256: null }
  }
}
