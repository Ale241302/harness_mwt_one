/**
 * Public type vocabulary of native product memory: versioned teachings with
 * scope and source, usage traceability, contextual performance with
 * correction causes, late errors, a portable knowledge snapshot, the
 * correction registry with its scope taxonomy, learning candidates with
 * lineage and allowed destination, and maturity metrics. Types only — the
 * service and id factories live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-memory/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one teaching. */
export type FaberLoomTeachingId = Branded<'FaberLoomTeachingId'>

/** How wide a teaching applies. */
export type TeachingScope = 'case' | 'space' | 'agent' | 'skill' | 'global'

/** Teaching lifecycle. `candidate` is an unconfirmed inference. */
export type TeachingStatus = 'candidate' | 'active' | 'superseded' | 'revoked'

/** One versioned teaching. */
export interface FaberLoomTeaching {
  /** Stable teaching id (shared by every version). */
  readonly id: FaberLoomTeachingId
  /** Owning identity. */
  readonly ownerId: string
  /** Application scope. */
  readonly scope: TeachingScope
  /** Space this teaching belongs to, or `null`. */
  readonly spaceId: string | null
  /** Agent this teaching belongs to, or `null`. */
  readonly agentId: string | null
  /** Skill this teaching belongs to, or `null`. */
  readonly skill: string | null
  /** Task label this teaching applies to, or `null`. */
  readonly task: string | null
  /** The teaching text. */
  readonly text: string
  /** Where the teaching came from (case reference, user, document). */
  readonly source: string
  /** Who stated it. */
  readonly author: string
  /** Lifecycle status. */
  readonly status: TeachingStatus
  /** Monotonic version; a supersession increments it. */
  readonly version: number
  /** Version this one replaced, or `null`. */
  readonly supersedes: number | null
  /** References (case ids) where the teaching was recovered and used. */
  readonly uses: readonly string[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Teaching creation input. */
export interface TeachingInput {
  /** Application scope. */
  readonly scope: TeachingScope
  /** The teaching text. */
  readonly text: string
  /** Source (case reference, user, document). */
  readonly source: string
  /** Author identity. */
  readonly author: string
  /** Owning space, when scoped. */
  readonly spaceId?: string
  /** Owning agent, when scoped. */
  readonly agentId?: string
  /** Skill, when scoped. */
  readonly skill?: string
  /** Task label, when scoped. */
  readonly task?: string
  /** Whether an explicit instruction is remembered active; default `candidate`. */
  readonly active?: boolean
  /** First use reference, when the teaching comes from a case. */
  readonly caseRef?: string
}

/** Teaching supersession input (an edit that keeps the previous version). */
export interface TeachingEditInput {
  /** The new text. */
  readonly text: string
  /** Why it changed. */
  readonly reason: string
  /** Author of the correction. */
  readonly author: string
}

/** Retrieval filter. */
export interface TeachingFilter {
  /** Restrict to a scope. */
  readonly scope?: TeachingScope
  /** Restrict to a space. */
  readonly spaceId?: string
  /** Restrict to an agent. */
  readonly agentId?: string
  /** Restrict to a skill. */
  readonly skill?: string
  /** Restrict to a task. */
  readonly task?: string
  /** Include unconfirmed candidates too. */
  readonly includeCandidates?: boolean
  /** Case reference recorded as a use when the teachings are recovered. */
  readonly caseRef?: string
}

/** Cause of a correction; requirement changes are not agent failures. */
export type PerformanceCause = 'error' | 'preference' | 'requirement-change'

/** Performance input. */
export interface PerformanceInput {
  /** Agent that produced the result. */
  readonly agentId?: string
  /** Model that produced the result. */
  readonly modelId?: string
  /** Task label. */
  readonly task: string
  /** Optional space context. */
  readonly spaceId?: string
  /** Outcome. */
  readonly outcome: 'approved' | 'corrected'
  /** Correction cause; `error` is the only one counted as an agent failure. */
  readonly cause?: PerformanceCause
  /** Real cost of the attempt, when known. */
  readonly cost?: number
}

/** Contextual performance summary. */
export interface PerformanceSummary {
  /** Total recorded outcomes. */
  readonly uses: number
  /** Approved outcomes. */
  readonly approved: number
  /** Corrected outcomes. */
  readonly corrected: number
  /** Corrections caused by an error (agent failures); requirement changes excluded. */
  readonly agentFailures: number
  /** Corrections by cause. */
  readonly correctionsByCause: Readonly<Record<string, number>>
  /** Corrected / uses, or `undefined` with no uses. */
  readonly correctionRate: number | undefined
}

/** A late error discovered after approval. */
export interface LateErrorInput {
  /** The case the error belongs to. */
  readonly caseRef: string
  /** What was discovered. */
  readonly detail: string
  /** Teaching to correct, when the error updates one. */
  readonly teachingId?: FaberLoomTeachingId
  /** Author of the correction. */
  readonly author: string
}

/** Portable knowledge snapshot; credentials are never included. */
export interface KnowledgeSnapshot {
  /** Teaching records, exactly as stored. */
  readonly teachings: readonly unknown[]
  /** Performance records. */
  readonly performance: readonly unknown[]
  /** Late-error records. */
  readonly lateErrors: readonly unknown[]
}

/** Identifies one recorded human correction. */
export type FaberLoomCorrectionId = Branded<'FaberLoomCorrectionId'>

/** Identifies one learning candidate. */
export type FaberLoomCandidateId = Branded<'FaberLoomCandidateId'>

/**
 * Data classification of an origin (§5.2). A candidate inherits the highest
 * class of its origin, so `N4` outranks `N0`.
 */
export type LearningDataClass = 'N0' | 'N1' | 'N2' | 'N3' | 'N4'

/** A place a learning candidate can be applied: account data, space rule, or agent adjustment. */
export type LearningDestination = 'cuenta' | 'espacio' | 'agente'

/**
 * How wide a correction teaches (§6.3). `puntual` is recorded and teaches
 * nothing; the other three become a candidate whose allowed destination is the
 * chosen scope.
 */
export type LearningScope = 'puntual' | LearningDestination

/** How the human corrected the artifact. */
export type CorrectionOrigin = 'edit' | 'answer_doubt' | 'iterate'

/** Inline edit of one field: the value before and after. */
export interface CorrectionEditDetail {
  /** Discriminant of the correction origin. */
  readonly origin: 'edit'
  /** Field path inside the artifact, e.g. `lines[0].unitPrice`. */
  readonly field: string
  /** Value before the edit, or `null` when the field had none. */
  readonly previous: string | null
  /** Value after the edit, or `null` when the edit cleared it. */
  readonly next: string | null
}

/** One doubt the agent asked and the answer the human chose. */
export interface CorrectionDoubtDetail {
  /** Discriminant of the correction origin. */
  readonly origin: 'answer_doubt'
  /** Question the agent asked. */
  readonly question: string
  /** Answer the human chose. */
  readonly answer: string
}

/** One applied iteration: the instruction, the resulting diffs, and its rounds. */
export interface CorrectionIterationDetail {
  /** Discriminant of the correction origin. */
  readonly origin: 'iterate'
  /** What the human asked the agent to change. */
  readonly instructions: string
  /** Diffs between the artifact and the applied version, oldest first. */
  readonly diffs: readonly string[]
  /** Iteration rounds the attempt needed; at least one. */
  readonly rounds: number
}

/** Payload of one correction, discriminated by its origin. */
export type CorrectionDetail = CorrectionEditDetail | CorrectionDoubtDetail | CorrectionIterationDetail

/**
 * Lineage every correction and candidate carries (§6.3, W-46): the tenant, the
 * space, the account, and the agent that produced the origin item.
 */
export interface LearningOrigin {
  /** Tenant that owns the origin, or `null` when the deployment has none. */
  readonly tenantId: string | null
  /** Space of the origin item, or `null` while it is unassigned. */
  readonly spaceId: string | null
  /** Account the origin item belongs to, or `null`. */
  readonly accountRef: string | null
  /** Agent that produced the artifact, or `null`. */
  readonly agentId: string | null
}

/** One recorded correction, whatever produced it (§6.3). */
export interface FaberLoomCorrection extends LearningOrigin {
  /** Stable correction id. */
  readonly id: FaberLoomCorrectionId
  /** Origin item this correction belongs to. */
  readonly itemId: string
  /** Identity of the human who corrected. */
  readonly actor: string
  /** Scope the human classified the correction with; `puntual` teaches nothing. */
  readonly scope: LearningScope
  /** Classifications the correction touched, as declared by its origin. */
  readonly dataClasses: readonly LearningDataClass[]
  /** Field paths the correction used. */
  readonly fieldsUsed: readonly string[]
  /** Origin discriminant plus its payload. */
  readonly origin: CorrectionOrigin
  /** Payload of the correction. */
  readonly detail: CorrectionDetail
  /** ISO-8601 instant of the correction. */
  readonly at: string
}

/** Lifecycle of a learning candidate. Promotion is the only way out of `candidate`. */
export type CandidateStatus = 'candidate' | 'promoted'

/**
 * One learning candidate: a correction whose scope is not `puntual`, its
 * lineage, and the single destination it may be promoted to (§6.3).
 */
export interface FaberLoomCandidate extends LearningOrigin {
  /** Stable candidate id. */
  readonly id: FaberLoomCandidateId
  /** Origin item this candidate came from. */
  readonly itemId: string
  /** Correction that produced it. */
  readonly correctionId: FaberLoomCorrectionId
  /** Highest classification of its origin; the candidate never lowers it. */
  readonly dataClass: LearningDataClass
  /** Every classification of its origin, as inherited. */
  readonly originDataClasses: readonly LearningDataClass[]
  /** Field paths the candidate was derived from. */
  readonly fieldsUsed: readonly string[]
  /** Scope the human chose; also the allowed destination. */
  readonly scope: LearningDestination
  /** Destination the candidate may be promoted to; wider targets need a widening. */
  readonly allowedDestination: LearningDestination
  /** Rule or knowledge the candidate proposes. */
  readonly text: string
  /** Lifecycle status. */
  readonly status: CandidateStatus
  /** Candidate this one widens, or `null` for a candidate born from a correction. */
  readonly derivedFrom: FaberLoomCandidateId | null
  /** Identity that created it. */
  readonly createdBy: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** Identity that promoted it, or `null`. */
  readonly promotedBy: string | null
  /** ISO-8601 promotion instant, or `null`. */
  readonly promotedAt: string | null
  /** Classifications the destination accepted at promotion, or `null` before it. */
  readonly promotionDataClasses: readonly LearningDataClass[] | null
}

/**
 * The identity reading or writing learning data. The caller resolves these
 * lists from its authorization model; the service never widens them and never
 * reads an origin whose space, account, or agent the identity does not hold.
 */
export interface LearningActor {
  /** Authenticated identity. */
  readonly id: string
  /** Tenant scope; `null` reads only origins that carry no tenant. */
  readonly tenantId: string | null
  /** Spaces the identity holds scope over. */
  readonly spaceIds?: readonly string[]
  /** Accounts the identity holds scope over. */
  readonly accountRefs?: readonly string[]
  /** Agents the identity holds scope over. */
  readonly agentIds?: readonly string[]
}

/** Input of one correction. */
export interface CorrectionInput {
  /** Payload, discriminated by origin. */
  readonly detail: CorrectionDetail
  /** Origin item the correction belongs to. */
  readonly itemId: string
  /** Identity of the human who corrected. */
  readonly actor: string
  /** Tenant of the origin, or `null`. */
  readonly tenantId?: string | null
  /** Space of the origin, when assigned. */
  readonly spaceId?: string
  /** Account of the origin, when known. */
  readonly accountRef?: string
  /** Agent that produced the artifact, when known. */
  readonly agentId?: string
  /** Every classification the origin touched; the candidate inherits the highest (W-46). */
  readonly dataClasses: readonly LearningDataClass[]
  /** Field paths the correction used. */
  readonly fieldsUsed?: readonly string[]
  /**
   * True while the origin is N2 provisional (D-7). Such an origin records the
   * correction but yields no candidate: provisional data feeds no derived
   * product (D-10, W-93).
   */
  readonly dataClassProvisional?: boolean
  /**
   * Scope the human chose (§6.3). Defaults to `puntual`; required for an
   * applied iteration, which always closes with a scope classification (W-34).
   */
  readonly scope?: LearningScope
  /** Rule the candidate carries; required whenever the scope is not `puntual`. */
  readonly text?: string
}

/** Answer of one correction: the registry record and the candidate it produced, if any. */
export interface CorrectionOutcome {
  /** The recorded correction. */
  readonly correction: FaberLoomCorrection
  /** Candidate created for a non-`puntual` scope; `undefined` for `puntual` or a provisional origin (W-34). */
  readonly candidate: FaberLoomCandidate | undefined
}

/** Filter over the correction registry. */
export interface CorrectionFilter {
  /** Restrict to one origin item. */
  readonly itemId?: string
  /** Restrict to one space. */
  readonly spaceId?: string
  /** Restrict to one account. */
  readonly accountRef?: string
  /** Restrict to one agent. */
  readonly agentId?: string
}

/** Filter over learning candidates. */
export interface CandidateFilter extends CorrectionFilter {
  /** Restrict to one lifecycle status. */
  readonly status?: CandidateStatus
}

/** One explicit promotion of a candidate. */
export interface CandidatePromotionInput {
  /** Destination to promote to; must equal the allowed destination (W-60). */
  readonly destination: LearningDestination
  /**
   * Classifications the destination accepts, from the signed classification
   * policy (§8.4). A promotion never assumes a ceiling of its own.
   */
  readonly acceptedDataClasses: readonly LearningDataClass[]
}

/** One widening of a candidate to a wider destination: a new candidate and a new promotion. */
export interface CandidateWideningInput extends CandidatePromotionInput {
  /** Reviewed content for the wider destination, with case-specific data removed (§6.3). */
  readonly text: string
}

/** Result of one item decision that the maturity metrics consume. */
export type LearningOutcomeResult = 'approved' | 'discarded' | 'skipped' | 'delegated' | 'delegated-reversed'

/** Input of one item outcome. */
export interface LearningOutcomeInput {
  /** Item the outcome belongs to. */
  readonly itemId: string
  /** Artifact type of the item (`proforma`, `respuesta`, ...). */
  readonly artifactType: string
  /** Action type the item belongs to. */
  readonly actionType: string
  /** What happened to the item. */
  readonly result: LearningOutcomeResult
  /** Tenant of the item, or `null`. */
  readonly tenantId?: string | null
  /** Space of the item, when assigned. */
  readonly spaceId?: string
}

/** Identity of one task type: the unit the maturity metrics are reported per (§10.2). */
export interface MaturityTaskType {
  /** Space of the items, or `null` for items without a space. */
  readonly spaceId: string | null
  /** Artifact type of the items. */
  readonly artifactType: string
  /** Action type of the items. */
  readonly actionType: string
}

/** Filter over the maturity metrics. */
export interface MaturityFilter {
  /** Restrict to one space. */
  readonly spaceId?: string
  /** Restrict to one artifact type. */
  readonly artifactType?: string
  /** Restrict to one action type. */
  readonly actionType?: string
  /** Inclusive lower bound on the outcome instant (ISO-8601). */
  readonly from?: string
  /** Inclusive upper bound on the outcome instant (ISO-8601). */
  readonly until?: string
}

/** Correction load of one task type, split by the origin of each correction. */
export interface MaturityCorrectionLoad {
  /** Applied iterations. */
  readonly iterations: number
  /** Edited fields, one per inline edit. */
  readonly editedFields: number
  /** Answered doubts. */
  readonly answeredDoubts: number
  /** Sum of the three origins. */
  readonly total: number
  /** Corrections per observed item, or `undefined` with no items. */
  readonly perItem: number | undefined
}

/** Share of items approved without any correction. */
export interface MaturityShare {
  /** Items that satisfy the rule. */
  readonly count: number
  /** Share of the stated denominator, or `undefined` when it is empty. */
  readonly rate: number | undefined
}

/** Delegation outcomes of one task type. */
export interface MaturityDelegation {
  /** Delegated outcomes observed in the period. */
  readonly count: number
  /** Delegations reversed in the period. */
  readonly reversals: number
  /** Reversals over delegations, or `undefined` with no delegations. */
  readonly reversalRate: number | undefined
}

/**
 * Maturity metrics of one task type. Every metric is reported on its own;
 * there is no composite index and no threshold, because the cohort definition
 * and the alert threshold are unsigned (§10.2).
 */
export interface MaturityTaskTypeMetrics extends MaturityTaskType {
  /** Items observed in the period, by the task type of their latest outcome. */
  readonly volume: number
  /** Items whose latest outcome closed them (`approved` or `discarded`); the §7.2 denominator. */
  readonly closed: number
  /** Human correction load, split into iterations, edited fields, and answered doubts. */
  readonly correctionLoad: MaturityCorrectionLoad
  /** Approved with no correction of any origin; share of `closed` (W-80). */
  readonly resolvedWithoutIntervention: MaturityShare
  /** Discarded items; share of `closed`. */
  readonly discarded: MaturityShare
  /** Items skipped at least once; share of `volume`. */
  readonly skipped: MaturityShare
  /** Delegated outcomes and their reversals. */
  readonly delegated: MaturityDelegation
}
