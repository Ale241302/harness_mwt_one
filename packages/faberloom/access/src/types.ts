/**
 * Public type vocabulary of native product access: elective, action-scoped
 * autonomy grants that the human revokes, checked before each effect, and the
 * CEO signatures that protected action types require (§7.4, W-16). Types only —
 * the service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-access/src/types
 */

/** Identifies one grant. */
export type FaberLoomGrantId = string

/** One elective autonomy grant for one action and context. */
export interface FaberLoomGrant {
  /** Stable grant id. */
  readonly id: FaberLoomGrantId
  /** Owning identity that granted it. */
  readonly ownerId: string
  /** The action the grant authorizes (e.g. `mail.send`). */
  readonly action: string
  /** Agent the grant is scoped to, or `null` for any agent. */
  readonly agentId: string | null
  /** Context the grant is scoped to, or `null` for any context. */
  readonly context: string | null
  /** Optional note. */
  readonly note: string | null
  /** ISO-8601 instant the grant was issued. */
  readonly grantedAt: string
  /** ISO-8601 expiry, or `null` for no expiry. */
  readonly expiresAt: string | null
  /** Whether the grant was revoked. */
  readonly revoked: boolean
}

/** Grant creation input. */
export interface GrantInput {
  /** The action to authorize. */
  readonly action: string
  /** Optional agent scope. */
  readonly agentId?: string
  /** Optional context scope. */
  readonly context?: string
  /** Optional note. */
  readonly note?: string
  /** Optional ISO-8601 expiry. */
  readonly expiresAt?: string
}

/** Permission check. */
export interface GrantCheck {
  /** Owning identity whose grants are consulted. */
  readonly ownerId: string
  /** The action about to run. */
  readonly action: string
  /** Agent about to act, when known. */
  readonly agentId?: string
  /** Context of the action, when known. */
  readonly context?: string
  /** Current instant; defaults to now. */
  readonly now?: string
}

/** Permission decision. */
export interface GrantDecision {
  /** Whether the action is authorized. */
  readonly allowed: boolean
  /** Stable reason code. */
  readonly reason: 'GRANTED' | 'NO_GRANT' | 'REVOKED' | 'EXPIRED'
  /** The grant that decided it, when one applied. */
  readonly grantId: FaberLoomGrantId | null
}

/** Identifies one CEO signature. */
export type FaberLoomSignatureId = string

/**
 * The identity a signature check reads. Structurally the board's `BoardActor`,
 * so a caller passes its actor without importing another package; `companyId`
 * is the tenant the deployment resolved, absent only when it knows none.
 */
export interface SignatureActor {
  /** Authenticated identity. */
  readonly id: string
  /** Tenant scope, when the deployment knows it. */
  readonly companyId?: string | undefined
}

/**
 * One signature a CEO issued for the tenant: the action types it covers, who
 * signed, when, and whether it is still active. A signature covers every
 * approval of a covered action type until it expires or is revoked; the access
 * contract states no single use, so repeatable use is the chosen default.
 */
export interface FaberLoomSignature {
  /** Stable signature id. */
  readonly id: FaberLoomSignatureId
  /** Tenant the signature belongs to, or `null` for an unscoped deployment. */
  readonly tenantId: string | null
  /** Identity that signed. */
  readonly signedBy: string
  /** ISO-8601 instant the signature was issued. */
  readonly signedAt: string
  /** `false` once revoked; expiry is evaluated against the instant of each check. */
  readonly active: boolean
  /** ISO-8601 expiry, or `null` for a signature that stays valid until revoked. */
  readonly expiresAt: string | null
  /** Action types the signature covers; empty when it is a wildcard. */
  readonly actionTypes: readonly string[]
  /** Whether the signature covers every protected action type. */
  readonly wildcard: boolean
  /** Identity that revoked the signature, or `null` while it is active. */
  readonly revokedBy: string | null
  /** ISO-8601 instant of revocation, or `null` while it is active. */
  readonly revokedAt: string | null
}

/**
 * Signature issue input. The signer and the tenant come from the acting
 * {@link SignatureActor}, so a caller cannot sign for another identity or tenant.
 */
export interface SignatureInput {
  /** Action types the signature covers. Required unless `wildcard` is true. */
  readonly actionTypes?: readonly string[]
  /** Cover every protected action type. Refused unless the deployment allows it. */
  readonly wildcard?: boolean
  /**
   * ISO-8601 expiry; defaults to the configured validity window. `null` requests
   * no expiry even when a window is configured, so the signature lasts until revoked.
   */
  readonly expiresAt?: string | null
}

/** Instant a signature check evaluates against. */
export interface SignatureCheckOptions {
  /** ISO-8601 instant; defaults to now. */
  readonly now?: string
}

/** Whether an action type is protected and what signature state it carries. */
export type SignatureState = 'NOT_REQUIRED' | 'ACTIVE' | 'MISSING' | 'REVOKED' | 'EXPIRED'

/**
 * What a reader may know about the signature covering one action type. The
 * signer identity appears only for a reader entitled to it, so a panel or tool
 * can show that a signature exists without exposing who signed.
 */
export interface SignatureStatus {
  /** Action type that was checked. */
  readonly actionType: string
  /** Whether the deployment protects this action type. */
  readonly protected: boolean
  /** Signature state for the reader's tenant. */
  readonly state: SignatureState
  /** The signature that decided the state, when one matched. */
  readonly signatureId: FaberLoomSignatureId | null
  /** ISO-8601 instant the matching signature was issued. */
  readonly signedAt: string | null
  /** ISO-8601 expiry of the matching signature. */
  readonly expiresAt: string | null
  /** Signer identity when the reader may see it, otherwise `null`. */
  readonly signedBy: string | null
}
