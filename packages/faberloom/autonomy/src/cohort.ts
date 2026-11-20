/**
 * O8B · the cohort of one rule.
 *
 * A rule is eligible only on evidence from its own cohort: the same rule
 * version, space, mailbox, action type and declared window. Simulated runs and
 * duplicates never count. Technical failures are counted apart from the
 * denominator. Ten real runs and 70 % approved-without-correction are the
 * signed thresholds (§7.2).
 */

/** The exact population one activation is evaluated on. */
export interface AutonomyCohort {
  /** Rule the cohort belongs to. */
  readonly ruleId: string
  /** Version of the rule; a new version starts a new cohort. */
  readonly ruleVersion: number
  /** Space the rule acts in. */
  readonly spaceId: string
  /** Mailbox the rule reads, as the account spells it. */
  readonly mailbox: string
  /** Action type the rule performs. */
  readonly actionType: string
  /** Inclusive lower bound of the evaluation window. */
  readonly from: string
  /** Exclusive upper bound of the evaluation window. */
  readonly until: string
}

/** How one run ended, from the owner's point of view. */
export type CohortOutcomeKind = 'approved' | 'intervened' | 'rejected' | 'technical-failure'

/** One run inside the cohort. */
export interface CohortOutcome {
  /** Owner's decision, or the technical failure the executor recorded. */
  readonly kind: CohortOutcomeKind
  /** Instant the run settled, ISO-8601. */
  readonly at: string
  /** Simulated or fixture run: never counts as productive evidence. */
  readonly fixture?: boolean
  /** Retry of a run already counted: never counts twice. */
  readonly duplicate?: boolean
  /** `AUTH-RULE-ACTIVATION` that covered the run, when the deployment records it. */
  readonly authorizationId?: string
}

/** Numbers the activation gate reads. */
export interface CohortReport {
  /** Cohort the report covers. */
  readonly cohort: AutonomyCohort
  /** Runs that count, after excluding fixtures and duplicates. */
  readonly realRuns: number
  /** Real runs approved with no correction. */
  readonly approved: number
  /** Real runs the owner intervened or rejected. */
  readonly notApproved: number
  /** Share of approved runs over real runs, `0` when there are none. */
  readonly approvalShare: number
  /** Technical failures, excluded from the denominator and reported apart. */
  readonly technicalFailures: number
  /** Fixtures and duplicates the report discarded. */
  readonly discarded: number
  /** Whether the signed thresholds hold. */
  readonly eligible: boolean
  /** Why it is not eligible yet, in panel-readable codes. */
  readonly reasons: readonly string[]
}

/** Real runs a rule needs before activation (§7.2). */
export const MINIMUM_REAL_RUNS = 10

/** Minimum share of approved-without-correction real runs (§7.2). */
export const MINIMUM_APPROVAL_SHARE = 0.7

/** Whether one run sits inside the cohort window. */
function inWindow(cohort: AutonomyCohort, at: string): boolean {
  const time = Date.parse(at)
  return time >= Date.parse(cohort.from) && time < Date.parse(cohort.until)
}

/**
 * Evaluate one cohort against the runs recorded for it.
 * @param cohort - rule version, space, mailbox, action type and window.
 * @param outcomes - every run the deployment recorded for that rule.
 * @returns the numbers and the eligibility decision.
 */
export function evaluateCohort(cohort: AutonomyCohort, outcomes: readonly CohortOutcome[]): CohortReport {
  let realRuns = 0
  let approved = 0
  let notApproved = 0
  let technicalFailures = 0
  let discarded = 0
  const seen = new Set<string>()
  for (const outcome of outcomes) {
    if (!inWindow(cohort, outcome.at)) continue
    if (outcome.fixture === true || outcome.duplicate === true) {
      discarded += 1
      continue
    }
    const key = `${outcome.at}|${outcome.kind}|${outcome.authorizationId ?? ''}`
    if (seen.has(key)) {
      discarded += 1
      continue
    }
    seen.add(key)
    if (outcome.kind === 'technical-failure') {
      technicalFailures += 1
      continue
    }
    realRuns += 1
    if (outcome.kind === 'approved') approved += 1
    else notApproved += 1
  }
  const approvalShare = realRuns === 0 ? 0 : approved / realRuns
  const reasons: string[] = []
  if (realRuns < MINIMUM_REAL_RUNS) reasons.push(`REAL_RUNS_BELOW_MINIMUM:${String(realRuns)}/${String(MINIMUM_REAL_RUNS)}`)
  if (approvalShare < MINIMUM_APPROVAL_SHARE) {
    reasons.push(`APPROVAL_SHARE_BELOW_MINIMUM:${approvalShare.toFixed(2)}/${String(MINIMUM_APPROVAL_SHARE)}`)
  }
  return {
    cohort,
    realRuns,
    approved,
    notApproved,
    approvalShare,
    technicalFailures,
    discarded,
    eligible: reasons.length === 0,
    reasons,
  }
}

/** One stored rule version. */
export interface AutonomyRule {
  /** Rule id, stable across versions. */
  readonly id: string
  /** Newest version of the rule. */
  readonly version: number
  /** Space the rule acts in. */
  readonly spaceId: string
  /** Mailbox the rule reads. */
  readonly mailbox: string
  /** Action type the rule performs; only reversible S3 actions are accepted. */
  readonly actionType: string
  /** Condition the model or the classifier evaluates. */
  readonly condition: string
  /** Whether the rule may run, is only proposed, or is suspended. */
  readonly status: 'proposed' | 'approved' | 'suspended'
  /** Declared evaluation window. */
  readonly from: string
  /** Declared evaluation window end. */
  readonly until: string
}

/**
 * Whether a change to a rule is material, so its cohort evidence starts again.
 * @param before - the active rule.
 * @param after - the proposed rule.
 * @returns true when version, scope or action changed.
 */
export function isMaterialChange(before: AutonomyRule, after: AutonomyRule): boolean {
  return before.version !== after.version
    || before.spaceId !== after.spaceId
    || before.mailbox !== after.mailbox
    || before.actionType !== after.actionType
    || before.condition !== after.condition
    || before.from !== after.from
    || before.until !== after.until
}
