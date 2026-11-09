/**
 * Staging writer. The plan is validated before a directory exists; the write
 * happens inside a fresh `mkdtemp` directory under the configured root, and a
 * failed write removes only that directory. Sources are never opened for
 * writing, and an invalid staging root never replaces a previous artifact.
 * @module @deepseek-ai/dsh-faberloom-portable/src/stage
 */

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { canonicalJson } from './canonical.ts'
import { portableError } from './errors.ts'
import { assertStagingRoot } from './paths.ts'
import { planPortable } from './plan.ts'
import { signPortableManifest } from './sign.ts'
import type { PortableRequest, PortableStageResult } from './types.ts'

/** Deployment wiring of the staging writer. */
export interface PortableStageConfig {
  /** Existing directory under which each run creates a new artifact directory. */
  readonly stagingRoot: string
  /** PKCS#8 Ed25519 private key in PEM form. */
  readonly signingKeyPem: string
  /** Trust-anchor key id written beside the signature. */
  readonly keyId: string
  /** Optional ceiling overriding the request's `maxBytes`. */
  readonly maxBytes?: number
}

/**
 * List every regular file under one directory as an artifact-relative path.
 * @param root - artifact directory.
 * @param current - directory being listed.
 * @returns relative paths with `/` separators.
 */
function listPaths(root: string, current = root): string[] {
  const out: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = join(current, entry.name)
    if (entry.isDirectory()) out.push(...listPaths(root, target))
    else out.push(relative(root, target).replaceAll('\\', '/'))
  }
  return out
}

/**
 * Remove only the directory this run created. A path that now resolves outside
 * the root is left alone: it is not this run's directory any more, and deleting
 * it would destroy someone else's tree.
 * @param created - the lexical path `mkdtemp` returned.
 * @param root - the validated staging root.
 */
function removeCreated(created: string, root: string): void {
  let entry
  try {
    entry = lstatSync(created)
  } catch {
    return
  }
  if (entry.isSymbolicLink()) {
    try {
      unlinkSync(created)
    } catch {
      // The link is already gone or cannot be removed; leave it alone.
    }
    return
  }
  let real: string
  try {
    real = realpathSync(created)
  } catch {
    return
  }
  const rel = relative(root, real)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return
  rmSync(created, { recursive: true, force: true })
}

/**
 * Plan, sign, and write one artifact into a new staging directory.
 * @param config - staging root and signing key.
 * @param request - identity, contributions, and fixed versions.
 * @returns the new directory, manifest, detached signature, and rejections.
 * @throws {Error} `PORTABLE_STAGING`, `PORTABLE_SYMLINK`, `PORTABLE_SIGNING`,
 * `PORTABLE_WRITE_FAILED`, or a planner refusal.
 */
export function stagePortable(config: PortableStageConfig, request: PortableRequest): PortableStageResult {
  if (config.signingKeyPem.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no signing key is configured')
  if (config.keyId.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no key id is configured')
  const root = assertStagingRoot(config.stagingRoot)
  const planned = planPortable({
    ...request,
    ...(config.maxBytes === undefined ? {} : { maxBytes: config.maxBytes }),
  })
  // Sign before a directory exists, so a bad key leaves no residue.
  const signature = signPortableManifest(planned.manifest, config.signingKeyPem, config.keyId)
  let created: string
  try {
    created = mkdtempSync(join(root, 'portable-'))
  } catch (error) {
    throw portableError('PORTABLE_STAGING', error instanceof Error ? error.message : String(error))
  }
  let directory = created
  try {
    directory = realpathSync(created)
    const rel = relative(root, directory)
    if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
      throw portableError('PORTABLE_STAGING', 'the staging directory escaped its root')
    }
    const written: string[] = []
    for (const file of planned.files) {
      const target = join(directory, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content, 'utf8')
      written.push(file.path)
    }
    const manifestPath = 'manifest.json'
    writeFileSync(join(directory, manifestPath), `${canonicalJson(planned.manifest)}\n`, 'utf8')
    written.push(manifestPath)
    // The directory is the authority after the write: every planned path must
    // exist as a single regular file, and nothing else may have appeared.
    const actual = listPaths(directory).sort()
    const expected = [...planned.files.map(file => file.path), manifestPath].sort()
    if (actual.join('\n') !== expected.join('\n')) {
      throw portableError('PORTABLE_WRITE_FAILED', 'the written paths do not match the plan')
    }
    for (const path of expected) {
      const stat = lstatSync(join(directory, path))
      if (!stat.isFile() || stat.nlink !== 1) {
        throw portableError('PORTABLE_WRITE_FAILED', `${path} is not a single regular file`)
      }
    }
    return {
      path: directory,
      manifest: planned.manifest,
      signature,
      digest: planned.digest,
      rejected: planned.rejected,
      written,
    }
  } catch (error) {
    removeCreated(created, root)
    if (error instanceof Error && error.message.startsWith('faberloom: PORTABLE_')) throw error
    throw portableError('PORTABLE_WRITE_FAILED', error instanceof Error ? error.message : String(error))
  }
}
