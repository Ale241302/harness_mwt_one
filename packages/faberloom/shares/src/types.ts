/**
 * Public type vocabulary of the native product sharing: the resource a grant
 * names, the per-action permissions a grantee holds, the grant lifecycle, and
 * the grant row consumers read. Types only — the service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-shares/src/types
 */

/** What a share grants access to. */
export type FaberLoomShareResourceKind = 'space' | 'workflow'

/** One resource a grant names. */
export interface FaberLoomShareResource {
  /** Resource family. */
  readonly kind: FaberLoomShareResourceKind
  /** Stable resource id. */
  readonly id: string
}

/**
 * One action a grant may authorize. The set is closed: a grant carries a
 * stable subset and every check names one of these.
 */
export type FaberLoomSharePermission =
  | 'view'
  | 'run'
  | 'edit-graph'
  | 'add-nodes'
  | 'remove-nodes'
  | 'edit-agents'
  | 'manage-triggers'
  | 'manage-connections'
  | 'approve-effects'
  | 'share'
  | 'manage-members'

/** Every permission, in display order. */
export const SHARE_PERMISSIONS: readonly FaberLoomSharePermission[] = [
  'view', 'run', 'edit-graph', 'add-nodes', 'remove-nodes', 'edit-agents',
  'manage-triggers', 'manage-connections', 'approve-effects', 'share', 'manage-members',
]

/** Grant lifecycle: the grantee has not accepted yet, accepted, or revoked. */
export type FaberLoomShareStatus = 'pending' | 'active' | 'revoked'

/** One share grant as consumers read it. */
export interface FaberLoomShareGrant {
  /** Stable grant id. */
  readonly id: string
  /** Resource the grant names. */
  readonly resource: FaberLoomShareResource
  /** Display name of the resource, so a row renders without another read. */
  readonly resourceName: string
  /** Email of the identity that granted access. */
  readonly ownerId: string
  /** Email the grant is offered to. */
  readonly granteeEmail: string
  /** Actions the grantee may perform. */
  readonly permissions: readonly FaberLoomSharePermission[]
  /** Grant lifecycle. */
  readonly status: FaberLoomShareStatus
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 acceptance instant, or null while pending. */
  readonly acceptedAt: string | null
}

/** Input accepted when creating one grant; the grantor supplies ownership. */
export interface FaberLoomShareInput {
  /** Resource the grant names. */
  readonly resource: FaberLoomShareResource
  /** Display name of the resource. */
  readonly resourceName: string
  /** Email the grant is offered to. */
  readonly granteeEmail: string
  /** Actions to authorize; unknown values are dropped. */
  readonly permissions: readonly string[]
  /** Portable resource content that travels to the grantee, when any. */
  readonly snapshot?: Record<string, unknown> | undefined
}

/** One resource's grants, split by direction for the panel. */
export interface FaberLoomShareList {
  /** Grants the actor issued on resources it owns. */
  readonly outgoing: readonly FaberLoomShareGrant[]
  /** Grants other identities issued to the actor. */
  readonly incoming: readonly FaberLoomShareGrant[]
}
