/**
 * The business identity of one board item (§2.1).
 *
 * The server derives it; a producer that names a key can only change it by
 * naming the source reference, because the hash covers tenant, space, account,
 * source, and artifact type. Two nulls in the same slot encode the same
 * reserved value, so "no space" and "no account" are equal inside the key.
 * @module @deepseek-ai/dsh-faberloom-board/keys
 */

import { createHash } from 'node:crypto'

/** Reserved encoding of a null space. */
const NO_SPACE = 'sin-espacio'
/** Reserved encoding of a null account. */
const NO_ACCOUNT = 'sin-cuenta'
/** Reserved encoding of a null tenant. */
const NO_TENANT = 'sin-empresa'

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
 * @returns lowercase hex sha256 over the five normalized fields.
 */
export function businessKeyOf(input: BusinessKeyInput): string {
  const source = input.sourceRef.trim()
  if (source.length === 0) throw new Error('faberloom: SOURCE_REQUIRED — a business key needs a source reference')
  return createHash('sha256')
    .update([
      input.companyId ?? NO_TENANT,
      input.spaceId ?? NO_SPACE,
      input.accountRef ?? NO_ACCOUNT,
      source,
      input.artifactType.trim(),
    ].join('\u0000'))
    .digest('hex')
}

/**
 * The source reference one item records, or the best field it already carries.
 * A legacy item was created before the field existed; its producer-supplied key
 * was the business identity, and its first evidence reference is the order or
 * thread it came from.
 * @param item - the stored source reference, producer key, and evidence.
 * @returns the reference to hash.
 */
export function sourceRefOf(item: {
  readonly sourceRef?: string | null
  readonly businessKey?: string | null
  readonly evidence?: readonly string[]
}): string {
  const recorded = item.sourceRef?.trim() ?? ''
  if (recorded.length > 0) return recorded
  const producer = item.businessKey?.trim() ?? ''
  if (producer.length > 0) return producer
  return item.evidence?.[0]?.trim() ?? ''
}
