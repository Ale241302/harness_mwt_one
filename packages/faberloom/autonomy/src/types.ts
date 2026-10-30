/**
 * Public types of the autonomy service: the unit and its level, the outcome
 * read port, the promotion and suspension records, the sample reviews, and the
 * audit events (§7.2, §7.3, D-13).
 * @module @deepseek-ai/dsh-faberloom-autonomy/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Autonomy level of one unit (§7.1): `SHADOW` produces but holds no authority,
 * `SUPERVISADO` needs a human decision per item, and `DELEGADO` executes alone
 * with its reversal window.
 */
export type AutonomyLevel = 'SHADOW' | 'SUPERVISADO' | 'DELEGADO'

/**
 * Unit identity of §7.2: one tenant, one space, one agent, and one action type.
 * `spaceId` is the workspace of the specification.
 */
export interface AutonomyUnitRef {
  /** Tenant that owns the unit. */
  readonly tenantId: string
  /** Workspace the unit acts in. */
  readonly spaceId: string
  /** Catalog agent the unit delegates to. */
  readonly agentId: string
  /** Action type the unit runs, e.g. `mail.send`. */
  readonly actionType: string
}

/** Storage key of one unit, built from its four identity fields. */
export type FaberLoomAutonomyUnitId = Branded<'FaberLoomAutonomyUnitId'>

/**
 * Identity governing autonomy. Its `companyId` is the tenant and its `role` is
 * the console role the deployment resolved; this package maps neither from
 * another package's actor.
 */
export interface AutonomyActor {
  /** Authenticated identity. */
  readonly id: string
  /** Tenant the identity acts in. Autonomy belongs to one tenant, so a unit read requires it. */
  readonly companyId?: string | undefined
  /** Console role (`owner`, `admin`, `client_b2b`, ...), when the deployment carries one. */
  readonly role?: string | undefined
}

/** Window one evaluation covers. */
export interface AutonomyPeriod {
  /** Label the panel and the audit share, e.g. `2026-10`; the sample keys on it. */
  readonly label?: string | undefined
  /** Inclusive ISO-8601 lower bound. */
  readonly from: string
  /** Exclusive ISO-8601 upper bound. */
  readonly until: string
}

/** Numbers a promotion recorded (§7.2). */
export interface AutonomyThresholdNumbers {
  /** Items closed by human decision in the period, technical failures excluded. */
  readonly realRuns: number
  /** Real runs approved with no edit, iteration, or answered doubt. */
  readonly approvedWithoutIntervention: number
  /** Approved-without-intervention share of the real runs. */
  readonly approvalShare: number
  /** Technical failures the evaluation excluded and counted separately. */
  readonly technicalFailures: number
  /** Real runs the deployment requires; 10 as documented (§7.2). */
  readonly minimumRealRuns: number
  /** Share the deployment requires; 0.70 as documented (§7.2). */
  readonly minimumApprovalShare: number
  /** Statistical minimum in force, or `null` while it is unsigned. */
  readonly statisticalMinimum: number | null
  /** Label of the evaluated period, or `null` when no period is configured. */
  readonly period: string | null
}

/** Numbers a delegation-rate suspension recorded (§7.3, D-13). */
export interface AutonomyDelegationSuspensionNumbers {
  /** Delegations the window considered. */
  readonly delegations: number
  /** Reversals inside the window. */
  readonly reversed: number
  /** Failures inside the window. */
  readonly failed: number
  /** Technical failures excluded from the window and counted separately. */
  readonly technicalFailures: number
  /** Reversed-or-failed share of the window. */
  readonly rate: number
  /** Configured rate the unit exceeded. */
  readonly suspensionRate: number
  /** Label of the evaluated period, or `null`. */
  readonly period: string | null
}

/** Numbers a sample-rejection suspension recorded (D-13). */
export interface AutonomySampleSuspensionNumbers {
  /** Period key of the reviewed sample. */
  readonly period: string
  /** Items the sample of that period holds. */
  readonly sampleSize: number
  /** Rejected items of that sample. */
  readonly rejectedSampleItems: number
  /** Rejections the deployment tolerates; one as documented. */
  readonly sampleRejectionsToSuspend: number
}

/** One automatic return to `SUPERVISADO`, with its cause and numbers. */
export type AutonomySuspension =
  | { readonly at: string; readonly cause: 'delegation-rate'; readonly numbers: AutonomyDelegationSuspensionNumbers }
  | { readonly at: string; readonly cause: 'sample-rejected'; readonly numbers: AutonomySampleSuspensionNumbers }

/** One explicit promotion to `DELEGADO`. */
export interface AutonomyPromotion {
  /** Identity that promoted the unit. */
  readonly by: string
  /** Instant of the promotion. */
  readonly at: string
  /** Numbers the promotion was decided on. */
  readonly numbers: AutonomyThresholdNumbers
}

/** One unit as the panel and the board adapter read it. */
export interface AutonomyUnit {
  /** Storage key of the unit. */
  readonly id: FaberLoomAutonomyUnitId
  /** Tenant that owns the unit. */
  readonly tenantId: string
  /** Workspace the unit acts in. */
  readonly spaceId: string
  /** Catalog agent the unit delegates to. */
  readonly agentId: string
  /** Action type the unit runs. */
  readonly actionType: string
  /** Current level. */
  readonly level: AutonomyLevel
  /** Instant the unit was registered. */
  readonly createdAt: string
  /** Instant of the last level change. */
  readonly updatedAt: string
  /** Promotion in force, or `null`. */
  readonly promotion: AutonomyPromotion | null
  /** Last automatic suspension, or `null`; a promotion clears it and the audit keeps it. */
  readonly suspension: AutonomySuspension | null
}

/** Filter the panel applies to its unit list. */
export interface AutonomyUnitFilter {
  /** Workspace to keep. */
  readonly spaceId?: string
  /** Agent to keep. */
  readonly agentId?: string
  /** Action type to keep. */
  readonly actionType?: string
  /** Level to keep. */
  readonly level?: AutonomyLevel
}

/**
 * What one closed item of the unit reports. `approved` is an approval with no
 * edit, iteration, or answered doubt; `technical-failure` is excluded from every
 * denominator and counted on its own (§7.2, W-80).
 */
export type AutonomyOutcomeKind =
  | 'approved'
  | 'approved-with-intervention'
  | 'discarded'
  | 'delegated-confirmed'
  | 'delegated-reversed'
  | 'delegated-failed'
  | 'technical-failure'

/** One closed item, as the outcome port reports it. */
export interface AutonomyOutcome {
  /** Item the outcome closes. */
  readonly itemId: string
  /** ISO-8601 instant of the closure. */
  readonly at: string
  /** What the closure was. */
  readonly kind: AutonomyOutcomeKind
  /** Why the item is a technical failure; required for that kind and ignored otherwise. */
  readonly reason?: string | undefined
}

/** Query the outcome port answers. `until` is exclusive. */
export interface AutonomyOutcomeQuery {
  /** Tenant of the unit; a port never answers across tenants. */
  readonly tenantId: string
  /** Workspace of the unit. */
  readonly spaceId: string
  /** Agent of the unit. */
  readonly agentId: string
  /** Action type of the unit. */
  readonly actionType: string
  /** Inclusive ISO-8601 lower bound, when a period applies. */
  readonly from?: string | undefined
  /** Exclusive ISO-8601 upper bound, when a period applies. */
  readonly until?: string | undefined
}

/**
 * Narrow read port over the work table. The board adapter implements it and the
 * composition provides it as `faberloomAutonomyOutcomes`; this package imports
 * nothing from the board.
 */
export interface AutonomyOutcomePort {
  /**
   * Read the closed items of one unit.
   * @param query - unit identity and the optional period window.
   * @returns one entry per closed item, in any order.
   */
  readOutcomes(query: AutonomyOutcomeQuery): Promise<readonly AutonomyOutcome[]>
}

/** Reversal and failure rate over the most recent delegations (§7.3). */
export interface AutonomyDelegationWindow {
  /** Delegations considered, at most the configured window. */
  readonly window: number
  /** Delegations that stood. */
  readonly confirmed: number
  /** Delegations reversed inside their window. */
  readonly reversed: number
  /** Delegations that failed. */
  readonly failed: number
  /** Reversed-or-failed share, or `undefined` when the window is empty. */
  readonly rate: number | undefined
}

/** Review state of one sample of one period. */
export interface AutonomySampleSummary {
  /** Period key of the sample. */
  readonly period: string
  /** Items the sample holds. */
  readonly planned: number
  /** Items already reviewed. */
  readonly reviewed: number
  /** Rejected items. */
  readonly rejected: number
  /** Items still waiting for review. */
  readonly pending: number
}

/** A value of §7.2 or §7.3 that has no business signature in this build. */
export type AutonomyUnsignedValue = 'period' | 'statistical-minimum'

/** Whether one unit may be promoted, and what stops it. */
export interface AutonomyEligibility {
  /** Real runs the deployment requires. */
  readonly minimumRealRuns: number
  /** Share the deployment requires. */
  readonly minimumApprovalShare: number
  /** Statistical minimum in force, or `null` while it is unsigned. */
  readonly statisticalMinimum: number | null
  /** Whether the real-run requirement is met. */
  readonly realRunsMet: boolean
  /** Whether the approval-share requirement is met. */
  readonly approvalShareMet: boolean
  /** Whether the statistical minimum is met, or `null` when none is signed. */
  readonly statisticalMinimumMet: boolean | null
  /** Whether every signed requirement is met. */
  readonly meetsThreshold: boolean
  /** Automatic promotion never runs in this build (W-53). */
  readonly automaticPromotion: 'DISABLED'
  /** Values a business signature is still missing. */
  readonly unsignedValues: readonly AutonomyUnsignedValue[]
}

/** Everything the panel and the board adapter read about one unit. */
export interface AutonomyUnitReport {
  /** The unit and its current level. */
  readonly unit: AutonomyUnit
  /** Period the numbers cover, or `null` when none is configured. */
  readonly period: AutonomyPeriod | null
  /** Items closed by human decision, technical failures excluded. */
  readonly realRuns: number
  /** Real runs approved with no intervention. */
  readonly approvedWithoutIntervention: number
  /** Real runs approved after an edit, an iteration, or an answered doubt. */
  readonly approvedWithIntervention: number
  /** Real runs discarded. */
  readonly discarded: number
  /** Approved-without-intervention share, or `undefined` with no real runs. */
  readonly approvalShare: number | undefined
  /** Technical failures excluded from every denominator. */
  readonly technicalFailures: number
  /** Reversal and failure rate over the recent delegations. */
  readonly delegations: AutonomyDelegationWindow
  /** One entry per sample period that holds items. */
  readonly samples: readonly AutonomySampleSummary[]
  /** Promotion eligibility. */
  readonly eligibility: AutonomyEligibility
  /** Last automatic suspension, or `null`. */
  readonly suspension: AutonomySuspension | null
}

/** Options of a report or an assessment. */
export interface AutonomyReportOptions {
  /** Period to evaluate instead of the configured one. */
  readonly period?: AutonomyPeriod | undefined
}

/** One item selected for later human review. */
export interface AutonomySampleReview {
  /** Unit the item was delegated by. */
  readonly unitId: FaberLoomAutonomyUnitId
  /** Period key of the sample. */
  readonly period: string
  /** Delegated item. */
  readonly itemId: string
  /** Instant the item was delegated. */
  readonly delegatedAt: string
  /** Instant the item entered the sample. */
  readonly selectedAt: string
  /** Review state. */
  readonly verdict: 'pending' | 'accepted' | 'rejected'
  /** Identity that reviewed it, or `null`. */
  readonly reviewedBy: string | null
  /** Instant of the review, or `null`. */
  readonly reviewedAt: string | null
  /** Reviewer note, or `null`. */
  readonly note: string | null
}

/** The sample of one period and what planning selected. */
export interface AutonomySamplePlan {
  /** Period the sample covers. */
  readonly period: AutonomyPeriod
  /** Items the sample must hold: the configured share of the delegations, at least the minimum. */
  readonly target: number
  /** Items this call added. */
  readonly selected: readonly AutonomySampleReview[]
  /** Every item of the sample that still waits for review. */
  readonly pending: readonly AutonomySampleReview[]
}

/** Verdict a reviewer records on one sampled item. */
export interface AutonomySampleVerdictInput {
  /** Period key of the sample. */
  readonly period: string
  /** Sampled item. */
  readonly itemId: string
  /** Verdict; a rejection suspends a delegated unit. */
  readonly verdict: 'accepted' | 'rejected'
  /** Reviewer note. */
  readonly note?: string | undefined
}

/** Result of recording one sample verdict. */
export interface AutonomySampleVerdict {
  /** The reviewed item. */
  readonly review: AutonomySampleReview
  /** Suspension the verdict caused, or `null`. */
  readonly suspension: AutonomySuspension | null
}

/** What one audit entry records. */
export type AutonomyAuditEventKind = 'promoted' | 'supervised' | 'suspended' | 'sample-planned' | 'sample-reviewed'

/** One append-only autonomy audit entry. */
export interface AutonomyAuditEvent {
  /** Entry id. */
  readonly id: string
  /** Unit the entry belongs to. */
  readonly unitId: string
  /** Tenant of the unit. */
  readonly tenantId: string
  /** Instant of the entry. */
  readonly at: string
  /** What happened. */
  readonly event: AutonomyAuditEventKind
  /** Identity that acted, or `automatic` when the service decided. */
  readonly actor: string
  /** Cause the operation recorded, or `null`. */
  readonly cause: string | null
  /** Item or period the operation names, or `null`. */
  readonly detail: string | null
  /** Numbers the operation was decided on. */
  readonly numbers: Readonly<Record<string, number>>
}
