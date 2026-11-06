/**
 * Work references: the opaque handle one conversation presents on every call.
 *
 * A reference is fixed when the OAuth code is exchanged, to the token's
 * connection, the authorized Space, and the revision the user saw. The token
 * record names the reference; a call must present it, and the reference must
 * still match the same connection and Space. Nothing stores an "active Space"
 * on the process, so two conversations cannot change each other's target.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/work-reference
 */

import type { WorkReferenceRecord } from './spec.ts'

/** The identities a reference must still match at call time. */
export interface ReferenceExpectation {
  /** Owner the token acts for. */
  readonly ownerId: string
  /** Fingerprint of the connection (token) that owns the reference. */
  readonly connectionId: string
  /** Space the token is filed in, or null for an owner-wide connection. */
  readonly spaceId: string | null
}

/**
 * Whether one stored reference still authorizes the call.
 * @param reference - stored reference.
 * @param expected - owner, connection, and Space the call presents.
 * @returns whether the reference is live and matches.
 */
export function referenceMatches(reference: WorkReferenceRecord, expected: ReferenceExpectation): boolean {
  return reference.revokedAt === null
    && reference.ownerId === expected.ownerId
    && reference.connectionId === expected.connectionId
    && reference.spaceId === expected.spaceId
}
