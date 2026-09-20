/**
 * Public type vocabulary of native product access: elective, action-scoped
 * autonomy grants that the human revokes, checked before each effect. Types
 * only — the service lives in `index.ts`.
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
