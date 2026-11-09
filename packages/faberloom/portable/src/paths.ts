/**
 * Artifact path rules. Every path is validated before the planner assigns it,
 * so an alias, a traversal, a reserved manifest name, or a file used as a
 * directory fails before the staging directory exists.
 * @module @deepseek-ai/dsh-faberloom-portable/src/paths
 */

import { lstatSync, realpathSync } from 'node:fs'
import { portableError } from './errors.ts'

/** Longest artifact-relative path accepted. */
export const MAX_ARTIFACT_PATH = 512

/** Names the artifact owns and no contribution may claim. */
const RESERVED = new Set(['manifest.json', 'manifest.sig.json'])

/** Windows device names a file may not use. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

/**
 * Validate and normalize one artifact-relative path.
 * @param value - the path a contribution proposes.
 * @returns the normalized path with `/` separators.
 * @throws {Error} `PORTABLE_PATH_INVALID` when the path can escape or alias.
 */
export function assertArtifactPath(value: string): string {
  const path = value.normalize('NFC')
  if (path.length === 0) throw portableError('PORTABLE_PATH_INVALID', 'a path is empty')
  if (path !== path.trim()) throw portableError('PORTABLE_PATH_INVALID', 'a path has leading or trailing whitespace')
  if (path.length > MAX_ARTIFACT_PATH) throw portableError('PORTABLE_PATH_INVALID', 'a path is too long')
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/u.test(path)) {
    throw portableError('PORTABLE_PATH_INVALID', `${path} is absolute`)
  }
  if (path.includes('\\')) throw portableError('PORTABLE_PATH_INVALID', `${path} uses a backslash`)
  if (/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/u.test(path)) {
    throw portableError('PORTABLE_PATH_INVALID', `${path} has a control or bidirectional character`)
  }
  for (const character of path) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw portableError('PORTABLE_PATH_INVALID', `${path} has an unpaired surrogate`)
    }
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw portableError('PORTABLE_PATH_INVALID', `${path} has an empty, dot, or parent segment`)
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw portableError('PORTABLE_PATH_INVALID', `${path} has a segment ending in a dot or space`)
    }
    if (/[<>:"|?*]/u.test(segment)) {
      throw portableError('PORTABLE_PATH_INVALID', `${path} has a character Windows refuses`)
    }
    if (WINDOWS_DEVICE.test(segment)) {
      throw portableError('PORTABLE_PATH_INVALID', `${path} is a Windows device name`)
    }
  }
  const normalized = segments.join('/')
  if (RESERVED.has(normalized.toLocaleLowerCase('en'))) {
    throw portableError('PORTABLE_PATH_INVALID', `${path} is reserved for the manifest`)
  }
  return normalized
}

/**
 * Fold one artifact path to the key that detects a case or Unicode alias.
 * @param path - a validated artifact path.
 * @returns the alias key.
 */
export function aliasKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en')
}

/**
 * Whether one file path would need the other to be a directory.
 * @param left - a validated artifact path.
 * @param right - another validated artifact path.
 * @returns true when the paths overlap.
 */
export function pathsOverlap(left: string, right: string): boolean {
  const leftKey = aliasKey(left)
  const rightKey = aliasKey(right)
  return leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`)
}

/**
 * Validate the configured staging root before a directory is created.
 * @param root - absolute staging root.
 * @returns the resolved root.
 * @throws {Error} `PORTABLE_STAGING` or `PORTABLE_SYMLINK`.
 */
export function assertStagingRoot(root: string): string {
  if (root.trim().length === 0) throw portableError('PORTABLE_STAGING', 'no staging root is configured')
  let stat
  try {
    stat = lstatSync(root)
  } catch {
    throw portableError('PORTABLE_STAGING', `${root} does not exist`)
  }
  if (stat.isSymbolicLink()) throw portableError('PORTABLE_SYMLINK', `${root} is a symbolic link or junction`)
  if (!stat.isDirectory()) throw portableError('PORTABLE_STAGING', `${root} is not a directory`)
  return realpathSync(root)
}
