/**
 * Assignment rule vocabulary.
 *
 * A rule reads one exact field and assigns the match to one target. Nothing
 * here reaches a mailbox, a Space or an agent: the service decides, and the
 * consumer acts. `origin` records who made the rule and from which item; the
 * version changes whenever the rule changes; `revokedAt` is permanent.
 * @module @deepseek-ai/dsh-faberloom-assignment/types
 */

/** One item field an assignment rule may read. */
export type AssignmentField = 'from' | 'subject' | 'account' | 'company'

/** How a rule compares the field. No wildcard and no regular expression. */
export type AssignmentOperator = 'equals' | 'contains' | 'startsWith'

/** One exact criterion: field, operator, value. */
export interface AssignmentCriterion {
  /** Item field the rule reads. */
  readonly field: AssignmentField
  /** Comparison applied to the field. */
  readonly operator: AssignmentOperator
  /** Text compared against the field; never empty. */
  readonly value: string
}

/** What the rule assigns. At least one side is set. */
export interface AssignmentTarget {
  /** Space the match belongs to, or null. */
  readonly spaceId: string | null
  /** Agent responsible for the match, or null. */
  readonly agentId: string | null
}

/** Where a rule came from, so the panel can label it. */
export interface AssignmentOrigin {
  /** Whether a person wrote it or an accepted correction taught it. */
  readonly kind: 'human' | 'learned'
  /** Identity that created the rule. */
  readonly by: string
  /** ISO-8601 instant the rule was created. */
  readonly at: string
  /** Item the rule was learned from, or null when written by hand. */
  readonly itemId: string | null
}

/** One stored assignment rule. */
export interface AssignmentRule {
  /** Rule id. */
  readonly id: string
  /** Owner whose items the rule classifies. */
  readonly ownerId: string
  /** Exact criterion. */
  readonly criterion: AssignmentCriterion
  /** Target the match goes to. */
  readonly target: AssignmentTarget
  /** Who wrote it and from where. */
  readonly origin: AssignmentOrigin
  /** Monotonic version; changes on every edit. */
  readonly version: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-edit instant. */
  readonly updatedAt: string
  /** When a person revoked it, or null while active. Revocation is permanent. */
  readonly revokedAt: string | null
}

/** Authoring input for one rule. */
export interface AssignmentRuleInput {
  /** Exact criterion. */
  readonly criterion: AssignmentCriterion
  /** Target the match goes to. */
  readonly target: AssignmentTarget
  /** Origin kind; defaults to `human`. */
  readonly kind?: 'human' | 'learned'
  /** Item the rule came from, or null. */
  readonly itemId?: string | null
}

/** The item fields a decision reads. */
export interface AssignmentSubject {
  /** `From` header or sender line. */
  readonly from?: string | null
  /** Subject line. */
  readonly subject?: string | null
  /** Account that received the item. */
  readonly account?: string | null
  /** Company the item belongs to. */
  readonly company?: string | null
}

/** One rule that matched, kept as evidence for the label. */
export interface AssignmentMatch {
  /** Rule id. */
  readonly ruleId: string
  /** Rule version that decided. */
  readonly version: number
  /** Target the rule names. */
  readonly target: AssignmentTarget
}

/** The decision for one item. */
export interface AssignmentDecision {
  /** `none` when nothing matched, `assigned` when the targets agree, `conflict` otherwise. */
  readonly status: 'none' | 'assigned' | 'conflict'
  /** The agreed target, or null when nothing matched or the rules conflict. */
  readonly target: AssignmentTarget | null
  /** Rules that matched, in creation order. */
  readonly matches: readonly AssignmentMatch[]
  /** Distinct targets offered by conflicting rules; empty when they agree. */
  readonly conflicts: readonly AssignmentTarget[]
}
