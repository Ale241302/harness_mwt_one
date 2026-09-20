/**
 * Public type vocabulary of the native product board (work table): items with
 * their states, versioned revisions, evidence-gated submits, version-bound
 * approvals, revalidation, and authorization-gated effects. Types only — the
 * service and id factory live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-board/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one board item. */
export type FaberLoomBoardItemId = Branded<'FaberLoomBoardItemId'>

/** Board item lifecycle. */
export type BoardStatus =
  | 'in_progress' | 'waiting_data' | 'waiting_approval' | 'approved'
  | 'completed' | 'failed' | 'reopened' | 'needs_review'

/** One immutable revision of an item. */
export interface BoardRevision {
  /** Revision number; every correction increments it. */
  readonly version: number
  /** Summary of what the revision contains. */
  readonly summary: string
  /** Real evidence references; a revision requires at least one. */
  readonly evidence: readonly string[]
  /** Opaque document reference, or `null`. */
  readonly documentRef: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** One review decision over an exact revision. */
export interface BoardReview {
  /** Decision. */
  readonly decision: 'approve' | 'reject'
  /** The exact revision reviewed. */
  readonly version: number
  /** Optional note. */
  readonly note: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** One recorded external effect, gated by an explicit authorization. */
export interface BoardEffect {
  /** External reference the effect created. */
  readonly ref: string
  /** Detail for the effect. */
  readonly detail: string | null
  /** The explicit authorization that permitted it. */
  readonly authorization: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** One board item. */
export interface FaberLoomBoardItem {
  /** Stable item id. */
  readonly id: FaberLoomBoardItemId
  /** Owning identity. */
  readonly ownerId: string
  /** Optional owning space id. */
  readonly spaceId: string | null
  /** Display title. */
  readonly title: string
  /** Current status. */
  readonly status: BoardStatus
  /** Current revision number. */
  readonly version: number
  /** Every revision, ascending. */
  readonly revisions: readonly BoardRevision[]
  /** The revision currently approved, or `null`. */
  readonly approvedRevision: number | null
  /** Whether the item changed after its approval and must be revalidated. */
  readonly stale: boolean
  /** Why the item went stale, or `null`. */
  readonly staleReason: string | null
  /** Recorded effects; empty until an authorized effect runs. */
  readonly effects: readonly BoardEffect[]
  /** Review history. */
  readonly reviews: readonly BoardReview[]
  /** Originating execution id, when created from one. */
  readonly executionId: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Submit input for one revision. */
export interface BoardSubmitInput {
  /** Short summary of the prepared result. */
  readonly summary: string
  /** Real evidence references; at least one is required. */
  readonly evidence: readonly string[]
  /** Opaque document reference. */
  readonly documentRef?: string
}

/** Create input for an item. */
export interface BoardCreateInput extends BoardSubmitInput {
  /** Display title. */
  readonly title: string
  /** Optional owning space id. */
  readonly spaceId?: string
  /** Originating execution id. */
  readonly executionId?: string
}

/** Review input. */
export interface BoardReviewInput {
  /** Decision. */
  readonly decision: 'approve' | 'reject'
  /** The exact revision reviewed. */
  readonly version: number
  /** Optional note. */
  readonly note?: string
}

/** Effect input. */
export interface BoardEffectInput {
  /** External reference the effect created. */
  readonly ref: string
  /** Explicit authorization; required, since approval alone never sends. */
  readonly authorization?: string
  /** Detail for the effect. */
  readonly detail?: string
}
