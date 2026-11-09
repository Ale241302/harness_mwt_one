/**
 * Offline verification of one staged artifact: every inventory file must exist
 * with its exact bytes and digest, no extra file may appear, the content
 * version and manifest digest must recompute, and the detached signature must
 * verify against the caller's trust anchor.
 * @module @deepseek-ai/dsh-faberloom-portable/src/verify
 */

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { sha256OfBytes, sha256OfCanonical } from './canonical.ts'
import { assertArtifactPath } from './paths.ts'
import { verifyPortableSignature } from './sign.ts'
import type { PortableManifest, PortableSignature, PortableVerification } from './types.ts'

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a parsed inventory row is complete enough to verify. */
function isFileEntry(value: unknown): value is { path: string; bytes: number; sha256: string } {
  return isRecord(value)
    && typeof value['path'] === 'string'
    && typeof value['bytes'] === 'number'
    && typeof value['sha256'] === 'string'
}

/**
 * List every regular file under one directory, refusing a symbolic link.
 * @param root - artifact directory.
 * @param current - directory being listed.
 * @returns artifact-relative paths.
 * @throws {Error} `PORTABLE_SYMLINK` when an entry is a symbolic link.
 */
function listFiles(root: string, current = root): string[] {
  const out: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error('PORTABLE_SYMLINK')
    if (entry.isDirectory()) out.push(...listFiles(root, target))
    else if (entry.isFile()) out.push(relative(root, target).replaceAll('\\', '/'))
  }
  return out
}

/**
 * Verify one staged artifact.
 * @param directory - the staging directory returned by the writer.
 * @param signature - the detached signature returned beside it.
 * @param publicKeyPem - SPKI Ed25519 public key, the out-of-band trust anchor.
 * @returns whether the artifact is intact, with named reasons.
 */
export function verifyPortableArtifact(
  directory: string,
  signature: PortableSignature,
  publicKeyPem: string,
  expectedKeyId?: string,
): PortableVerification {
  const reasons: string[] = []
  let manifest: PortableManifest
  try {
    const stat = lstatSync(join(directory, 'manifest.json'))
    if (stat.isSymbolicLink()) return { ok: false, reasons: ['manifest-symlink'] }
    const parsed: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed['files'])) return { ok: false, reasons: ['manifest-invalid'] }
    if (!parsed['files'].every(isFileEntry)) return { ok: false, reasons: ['manifest-invalid'] }
    if (typeof parsed['contentVersion'] !== 'string' || typeof parsed['digest'] !== 'string') {
      return { ok: false, reasons: ['manifest-invalid'] }
    }
    manifest = parsed as unknown as PortableManifest
  } catch {
    return { ok: false, reasons: ['manifest-missing'] }
  }

  let listed: string[]
  try {
    listed = listFiles(directory).sort()
  } catch (error) {
    return { ok: false, reasons: [error instanceof Error ? error.message : 'artifact-unreadable'] }
  }
  const expected = ['manifest.json', ...manifest.files.map(file => file.path)].sort()
  if (listed.join('\n') !== expected.join('\n')) reasons.push('inventory-file-set')

  for (const file of manifest.files) {
    let path: string
    try {
      path = assertArtifactPath(file.path)
    } catch {
      reasons.push(`path-invalid:${file.path}`)
      continue
    }
    let bytes: Buffer
    try {
      const stat = lstatSync(join(directory, path))
      if (!stat.isFile() || stat.nlink !== 1) {
        reasons.push(`file-kind:${path}`)
        continue
      }
      bytes = readFileSync(join(directory, path))
    } catch {
      reasons.push(`file-missing:${path}`)
      continue
    }
    if (bytes.length !== file.bytes) reasons.push(`bytes:${path}`)
    if (sha256OfBytes(bytes) !== file.sha256) reasons.push(`sha256:${path}`)
  }

  if (`sha256:${sha256OfCanonical(manifest.files)}` !== manifest.contentVersion) reasons.push('content-version')
  const { digest: _digest, ...unsigned } = manifest
  if (sha256OfCanonical(unsigned) !== manifest.digest) reasons.push('manifest-digest')
  if (!verifyPortableSignature(manifest, signature, publicKeyPem, expectedKeyId)) reasons.push('signature')
  return { ok: reasons.length === 0, reasons }
}
