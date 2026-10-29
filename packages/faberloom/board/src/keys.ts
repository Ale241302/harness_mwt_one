/**
 * The business identity of one board item (§2.1).
 *
 * The server derives it; a producer that names a key can only change it by
 * naming the source reference, because the hash covers tenant, space, account,
 * source, and artifact type. Every field is canonicalized and length-prefixed
 * before hashing: two nulls in one slot encode the same value, a value can never
 * collide with a reserved literal, and two field tuples can never concatenate to
 * the same byte string.
 * @module @deepseek-ai/dsh-faberloom-board/keys
 */

import { createHash } from 'node:crypto'

/**
 * Canonical form of one identity field: Unicode NFKC, trimmed, internal
 * whitespace collapsed, uppercased. An empty value is absent.
 * @param value - raw field, or null.
 * @returns the canonical value, or null.
 */
export function canonicalIdentityField(value: string | null | undefined): string | null {
  const text = (value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase()
  return text.length === 0 ? null : text
}

/** The five fields the key binds. */
export interface BusinessKeyInput {
  /** Tenant that owns the item. */
  readonly companyId: string | null
  /** Space the item belongs to, or null before assignment. */
  readonly spaceId: string | null
  /** Account/client reference, or null. */
  readonly accountRef: string | null
  /** Source reference: purchase order, mail thread, or order id. */
  readonly sourceRef: string
  /** Artifact type. */
  readonly artifactType: string
}

/**
 * Derive the canonical business key of one artifact.
 * @param input - tenant, space, account, source, and artifact type.
 * @returns lowercase hex sha256 over the five canonicalized fields.
 */
export function businessKeyOf(input: BusinessKeyInput): string {
  const source = canonicalIdentityField(input.sourceRef)
  if (source === null) throw new Error('faberloom: SOURCE_REQUIRED — a business key needs a source reference')
  const fields = [
    input.companyId,
    input.spaceId,
    input.accountRef,
    input.sourceRef,
    input.artifactType,
  ].map(field => canonicalIdentityField(field))
  return createHash('sha256')
    .update(fields.map(field => field === null ? 'n:' : `v:${String(field.length)}:${field}`).join('\u0000'))
    .digest('hex')
}

/**
 * The source reference one item records, or the best field it already carries.
 * A legacy item was created before the field existed; its producer-supplied key
 * was the business identity, and its last revision's first evidence reference is
 * the order or thread it came from.
 * @param item - the stored source reference, producer key, and evidence.
 * @returns the reference to hash.
 */
export function sourceRefOf(item: {
  readonly sourceRef?: string | null
  readonly businessKey?: string | null
  readonly evidence?: readonly string[]
  readonly revisions?: readonly { readonly evidence: readonly string[] }[]
}): string {
  const recorded = item.sourceRef?.trim() ?? ''
  if (recorded.length > 0) return recorded
  const producer = item.businessKey?.trim() ?? ''
  if (producer.length > 0) return producer
  const revision = item.revisions?.[item.revisions.length - 1]
  return item.evidence?.[0]?.trim() ?? revision?.evidence[0]?.trim() ?? ''
}
