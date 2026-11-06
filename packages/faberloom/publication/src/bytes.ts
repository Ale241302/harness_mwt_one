/**
 * Byte identity: the SHA-256 and length every publication effect is checked
 * against, shared by the object stores, the Git adapter, and the service.
 * @module @deepseek-ai/dsh-faberloom-publication/src/bytes
 */

import { createHash } from 'node:crypto'
import { publicationError } from './errors.ts'

/**
 * Lowercase SHA-256 of one byte sequence.
 * @param bytes - bytes to hash.
 * @returns lowercase hex digest.
 */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Lowercase SHA-256 of one text, hashed as UTF-8.
 * @param value - text to hash.
 * @returns lowercase hex digest.
 */
export function sha256OfText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Refuse bytes that are not the published object: wrong length, above the
 * configured ceiling, or a different digest. Used before activation and on
 * every read, so a truncated or altered object never reaches a caller.
 * @param bytes - bytes read back from the store.
 * @param expected - recorded digest and length, and the configured ceiling.
 * @returns nothing.
 * @throws {Error} `PUBLICATION_TOO_LARGE` or `PUBLICATION_DIGEST_MISMATCH`.
 */
export function verifyObject(
  bytes: Uint8Array,
  expected: { readonly sha256: string; readonly bytes: number; readonly maxBytes: number },
): void {
  if (bytes.length > expected.maxBytes) {
    throw publicationError('PUBLICATION_TOO_LARGE', `the published object exceeds ${String(expected.maxBytes)} bytes`)
  }
  const actual = sha256Of(bytes)
  if (bytes.length !== expected.bytes || actual !== expected.sha256) {
    throw publicationError(
      'PUBLICATION_DIGEST_MISMATCH',
      `the stored object has ${String(bytes.length)} bytes and sha256 ${actual}; ${String(expected.bytes)} and ${expected.sha256} were recorded`,
    )
  }
}
