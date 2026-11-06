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
import { brandString } from '@deepseek-ai/dsh-brand'
import type { FaberLoomBoardItemId } from './types.ts'

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

/** Namespace one proposal binds: tenant, owner, space, and the client key. */
export interface ProposalIdentityInput {
  /** Tenant that owns the proposal. */
  readonly companyId: string | null
  /** Authenticated owner that submitted it. */
  readonly ownerId: string
  /** Space the proposal belongs to, or null before assignment. */
  readonly spaceId: string | null
  /** Client key, unique per owner and space. */
  readonly claveCliente: string
}

/**
 * Canonical, readable source reference of one proposal. Each namespace slot is
 * URI-encoded, so a value containing the separator cannot forge another slot.
 * @param input - tenant, owner, space, and client key.
 * @returns `PROPUESTA:<company>:<owner>:<space>:<key>`.
 * @throws {Error} `SOURCE_REQUIRED` when the client key is empty.
 */
export function proposalSourceRef(input: ProposalIdentityInput): string {
  const clave = canonicalIdentityField(input.claveCliente)
  if (clave === null) throw new Error('faberloom: SOURCE_REQUIRED — a proposal needs a client key')
  const slot = (value: string | null): string => encodeURIComponent(canonicalIdentityField(value) ?? '-')
  return `PROPUESTA:${slot(input.companyId)}:${slot(input.ownerId)}:${slot(input.spaceId)}:${slot(clave)}`
}

/**
 * Stable hash of the four namespace slots, used as the durable idempotency key.
 * @param input - tenant, owner, space, and client key.
 * @returns lowercase hex sha256.
 */
export function proposalKeyHash(input: ProposalIdentityInput): string {
  const fields = [input.companyId, input.ownerId, input.spaceId, input.claveCliente]
    .map(field => canonicalIdentityField(field))
  return createHash('sha256')
    .update(fields.map(field => field === null ? 'n:' : `v:${String(field.length)}:${field}`).join('\u0000'))
    .digest('hex')
}

/**
 * Deterministic item id of one proposal. Two processes that receive the same
 * namespace write the same row instead of two, so the id is the first
 * deduplication step and the stored claims are the second.
 * @param input - tenant, owner, space, and client key.
 * @returns a branded UUID-shaped id.
 */
export function proposalItemId(input: ProposalIdentityInput): FaberLoomBoardItemId {
  const digest = createHash('sha256').update(`propuesta\u0000${proposalKeyHash(input)}`).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6)
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8)
  const hex = bytes.toString('hex')
  return brandString<FaberLoomBoardItemId>(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`)
}
