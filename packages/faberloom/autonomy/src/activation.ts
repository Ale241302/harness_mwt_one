/**
 * O8B · the activation record of one rule.
 *
 * Activating a rule is a separate, explicit decision. The record states the
 * exact cohort it rests on, the bounded authorization, the volume, how the
 * effect is recovered, how it is suspended, and the evidence that met the
 * thresholds. An activation without any of those fields, or whose evidence is
 * below ten real runs at 70 %, is refused.
 */

import { z } from 'zod'
import { MINIMUM_APPROVAL_SHARE, MINIMUM_REAL_RUNS } from './cohort.ts'

/** One rule activation, as the deployment records it. */
export const ruleActivationSchema = z.object({
  /** Rule activated. */
  ruleId: z.string().min(1),
  /** Version of the rule. */
  ruleVersion: z.number().int().positive(),
  /** Space the rule acts in. */
  spaceId: z.string().min(1),
  /** Mailbox the rule reads. */
  mailbox: z.string().min(1),
  /** Reversible action type; S4 types are not activatable. */
  actionType: z.string().min(1),
  /** Window the evidence covers. */
  window: z.object({ from: z.string().min(1), until: z.string().min(1) }),
  /** `AUTH-RULE-ACTIVATION` the CEO signed. */
  authorizationId: z.string().min(1),
  /** Scope the authorization states. */
  scope: z.string().min(1),
  /** Instant the authorization stops being usable. */
  validUntil: z.string().min(1),
  /** Runs the authorization allows. */
  volume: z.object({ maxRuns: z.number().int().positive() }),
  /** How a produced effect is undone. */
  recovery: z.string().min(1),
  /** How the rule is suspended, and by whom. */
  suspension: z.string().min(1),
  /** Productive evidence the activation rests on. */
  evidence: z.object({
    /** Runs that count, after excluding fixtures and duplicates. */
    realRuns: z.number().int().nonnegative(),
    /** Approved-without-correction share. */
    approvalShare: z.number().min(0).max(1),
    /** Technical failures, reported apart. */
    technicalFailures: z.number().int().nonnegative(),
  }),
  /** Identity that approved it. */
  approvedBy: z.string().min(1),
  /** Instant of the approval, ISO-8601. */
  approvedAt: z.string().min(1),
})

/** One activation record, inferred from {@link ruleActivationSchema}. */
export type RuleActivation = z.infer<typeof ruleActivationSchema>

/** Outcome of validating one activation. */
export interface ActivationCheck {
  /** Whether it may activate. */
  readonly ok: boolean
  /** Stable reasons it may not, empty when it may. */
  readonly issues: readonly string[]
}

/** Action types that never activate alone. */
const S4_ACTION_TYPES = /^(mail\.send|mwt\.write|inventory\.|shipment\.|money\.)/u

/**
 * Validate one activation record against the schema and the signed thresholds.
 * @param input - the record as the deployment stored or received it.
 * @returns whether it may activate, with the reasons when it may not.
 */
export function validateRuleActivation(input: unknown): ActivationCheck {
  const parsed = ruleActivationSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map(issue => `SCHEMA:${issue.path.join('.')}:${issue.code}`) }
  }
  const record = parsed.data
  const issues: string[] = []
  if (S4_ACTION_TYPES.test(record.actionType)) issues.push(`S4_NOT_ACTIVATABLE:${record.actionType}`)
  if (record.evidence.realRuns < MINIMUM_REAL_RUNS) issues.push(`REAL_RUNS_BELOW_MINIMUM:${String(record.evidence.realRuns)}/${String(MINIMUM_REAL_RUNS)}`)
  if (record.evidence.approvalShare < MINIMUM_APPROVAL_SHARE) {
    issues.push(`APPROVAL_SHARE_BELOW_MINIMUM:${record.evidence.approvalShare.toFixed(2)}/${String(MINIMUM_APPROVAL_SHARE)}`)
  }
  if (Date.parse(record.validUntil) <= Date.parse(record.approvedAt)) issues.push('AUTHORIZATION_ALREADY_EXPIRED')
  return { ok: issues.length === 0, issues }
}
