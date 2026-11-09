/**
 * Publication manifest authenticity: one canonical JSON document per revision,
 * its digest, and a detached Ed25519 signature. The digest excludes itself; the
 * signature covers the canonical manifest including the digest, so the trust
 * anchor never lives inside the object it authenticates.
 * @module @deepseek-ai/dsh-faberloom-publication/src/manifest
 */

import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { publicationError } from './errors.ts'
import type { PublicationManifest, PublicationSignature } from './types.ts'

/** Format version of the publication manifest. */
export const PUBLICATION_MANIFEST_VERSION = 1

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively order object keys and drop undefined members. */
function order(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw publicationError('PUBLICATION_MANIFEST_INVALID', 'a number is not finite')
    return value
  }
  if (Array.isArray(value)) return value.map(entry => order(entry))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = value[key]
      if (entry !== undefined) out[key] = order(entry)
    }
    return out
  }
  throw publicationError('PUBLICATION_MANIFEST_INVALID', `a ${typeof value} value is not canonical JSON`)
}

/**
 * Serialize a value as canonical JSON.
 * @param value - a JSON-compatible value.
 * @returns the canonical text.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(order(value))
}

/**
 * Hash one text.
 * @param text - UTF-8 text.
 * @returns lowercase SHA-256.
 */
function sha256OfText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Compute the manifest digest over the document without `digest`.
 * @param manifest - the manifest, with or without its digest.
 * @returns lowercase SHA-256.
 */
export function manifestDigest(manifest: Omit<PublicationManifest, 'digest'> | PublicationManifest): string {
  const { digest: _digest, ...unsigned } = manifest as PublicationManifest
  return sha256OfText(canonicalJson(unsigned))
}

/**
 * Sign one canonical manifest.
 * @param manifest - the manifest, including its digest.
 * @param privateKeyPem - PKCS#8 Ed25519 private key in PEM form.
 * @param keyId - trust-anchor key id selected by the deployment.
 * @returns the detached signature.
 * @throws {Error} `PUBLICATION_SIGNING` when the key cannot sign.
 */
export function signPublicationManifest(
  manifest: PublicationManifest,
  privateKeyPem: string,
  keyId: string,
): PublicationSignature {
  try {
    const value = cryptoSign(null, Buffer.from(canonicalJson(manifest), 'utf8'), privateKeyPem).toString('base64')
    return { algorithm: 'ed25519', keyId, value }
  } catch (error) {
    throw publicationError('PUBLICATION_SIGNING', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Verify one detached signature against the canonical manifest.
 * @param manifest - the manifest, including its digest.
 * @param signature - the detached signature.
 * @param publicKeyPem - SPKI Ed25519 public key in PEM form.
 * @returns true when the signature is valid.
 */
export function verifyPublicationSignature(
  manifest: PublicationManifest,
  signature: PublicationSignature,
  publicKeyPem: string,
): boolean {
  const runtime = signature as { readonly algorithm?: string }
  if (runtime.algorithm !== 'ed25519') return false
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(manifest), 'utf8'),
      publicKeyPem,
      Buffer.from(signature.value, 'base64'),
    )
  } catch {
    return false
  }
}

/**
 * Parse and validate one stored manifest document.
 * @param text - canonical manifest text.
 * @returns the manifest.
 * @throws {Error} `PUBLICATION_MANIFEST_INVALID` when a field is missing or the digest does not match.
 */
export function parsePublicationManifest(text: string): PublicationManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw publicationError('PUBLICATION_MANIFEST_INVALID', 'the manifest is not JSON')
  }
  if (!isRecord(parsed)) throw publicationError('PUBLICATION_MANIFEST_INVALID', 'the manifest is not an object')
  const fields = ['itemId', 'baseRevision', 'commit', 'path', 'sha256', 'artifactHash', 'publisherId', 'generatedAt', 'digest'] as const
  for (const field of fields) {
    if (typeof parsed[field] !== 'string') throw publicationError('PUBLICATION_MANIFEST_INVALID', `${field} is missing`)
  }
  if (typeof parsed['bytes'] !== 'number' || !Number.isInteger(parsed['bytes'])) {
    throw publicationError('PUBLICATION_MANIFEST_INVALID', 'bytes is missing')
  }
  if (typeof parsed['generatedAt'] !== 'string' || Number.isNaN(Date.parse(parsed['generatedAt']))) {
    throw publicationError('PUBLICATION_MANIFEST_INVALID', 'generatedAt is not a date')
  }
  if (parsed['formatVersion'] !== PUBLICATION_MANIFEST_VERSION) {
    throw publicationError('PUBLICATION_MANIFEST_INVALID', 'the format version is not supported')
  }
  const manifest = parsed as unknown as PublicationManifest
  if (manifestDigest(manifest) !== manifest.digest) {
    throw publicationError('PUBLICATION_MANIFEST_INVALID', 'the manifest digest does not match')
  }
  return manifest
}
