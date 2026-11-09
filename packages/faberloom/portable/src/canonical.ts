/**
 * Canonical JSON and SHA-256 for the portable manifest. Canonical means sorted
 * object keys, retained array order, no undefined members, and no whitespace;
 * two equal values always produce the same bytes, so a replay produces the
 * same digest.
 * @module @deepseek-ai/dsh-faberloom-portable/src/canonical
 */

import { createHash } from 'node:crypto'
import { portableError } from './errors.ts'

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recursively order object keys and drop undefined members. */
function order(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw portableError('PORTABLE_CANONICAL_INVALID', 'a number is not finite')
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
  throw portableError('PORTABLE_CANONICAL_INVALID', `a ${typeof value} value is not canonical JSON`)
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
 * Hash one UTF-8 text.
 * @param text - the text to hash.
 * @returns lowercase SHA-256.
 */
export function sha256OfText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Hash raw bytes.
 * @param bytes - the bytes to hash.
 * @returns lowercase SHA-256.
 */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Hash one value through its canonical JSON.
 * @param value - the value to hash.
 * @returns lowercase SHA-256.
 */
export function sha256OfCanonical(value: unknown): string {
  return sha256OfText(canonicalJson(value))
}
