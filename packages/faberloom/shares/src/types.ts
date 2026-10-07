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
  | 'create-context'
  | 'index-context'
  | 'share'
  | 'manage-members'
  | 'view-memory'
  | 'create-memory'
  | 'edit-memory'
  | 'delete-memory'
  | 'view-context'
  | 'edit-context'
  | 'delete-context'
  | 'view-workflows'
  | 'create-workflows'
  | 'edit-workflows'
  | 'delete-workflows'
  | 'view-routines'
  | 'create-routines'
  | 'edit-routines'
  | 'delete-routines'

/** Every permission, in display order. */
export const SHARE_PERMISSIONS: readonly FaberLoomSharePermission[] = [
  'view', 'run', 'edit-graph', 'add-nodes', 'remove-nodes', 'edit-agents',
  'manage-triggers', 'manage-connections', 'approve-effects', 'create-context', 'index-context', 'share', 'manage-members',
  'view-memory', 'create-memory', 'edit-memory', 'delete-memory',
  'view-context', 'edit-context', 'delete-context',
  'view-workflows', 'create-workflows', 'edit-workflows', 'delete-workflows',
  'view-routines', 'create-routines', 'edit-routines', 'delete-routines',
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

/**
 * Input accepted when replacing the portable snapshot one resource's grants
 * carry, so a grantee's next sync reads current content. The grant lifecycle
 * and permissions are untouched: this only refreshes what travels.
 */
export interface FaberLoomShareRepublishInput {
  /** Resource the grant names. */
  readonly resource: FaberLoomShareResource
  /** Display name of the resource. */
  readonly resourceName: string
  /** Portable resource content that replaces what the console holds. */
  readonly snapshot?: Record<string, unknown> | undefined
}

/** One resource's grants, split by direction for the panel. */
export interface FaberLoomShareList {
  /** Grants the actor issued on resources it owns. */
  readonly outgoing: readonly FaberLoomShareGrant[]
  /** Grants other identities issued to the actor. */
  readonly incoming: readonly FaberLoomShareGrant[]
}

/** Which Space resource a shared-content item carries. */
export type FaberLoomSharedContentKind = 'memory' | 'context' | 'workflow' | 'routine'

/** One item a Space member publishes for the other members to see. */
export interface FaberLoomSharedContentInput {
  /** Resource family. */
  readonly kind: FaberLoomSharedContentKind
  /** Stable key within its family (memory text, context title, flow/routine name). */
  readonly itemKey: string
  /** Portable content the other members materialize. */
  readonly payload: Record<string, unknown>
}

/** One stored shared-content item as consumers read it. */
export interface FaberLoomSharedContentRow extends FaberLoomSharedContentInput {
  /** Space the item belongs to. */
  readonly spaceId: string
  /** Email of the member that authored it. */
  readonly authorId: string
  /** Whether this host published it or imported it from the console. */
  readonly origin: 'owner' | 'console'
  /** Console-side row id, when published to the console. */
  readonly consoleId: string | null
  /** Id of the local copy a member materialized here, or null when none yet. */
  readonly localId: string | null
}
