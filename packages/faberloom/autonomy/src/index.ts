/**
 * Native autonomy (`ctx.faberloomAutonomy`): one level per unit
 * `(tenant, space, agent, actionType)` — `SHADOW`, `SUPERVISADO`, or
 * `DELEGADO` — with the promotion report of §7.2, the later human review of a
 * sample of delegated items, and the automatic return to `SUPERVISADO` of
 * §7.3 (D-13). Outcomes arrive through a narrow read port, so this package
 * imports nothing from the board; records are durable through
 * `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-autonomy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { autonomyDomainSpec, type AuditRecord, type SampleReviewRecord, type UnitRecord } from './spec.ts'
import { FaberLoomAutonomyRefusal } from './refusal.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  AutonomyActor,
  AutonomyAuditEvent,
  AutonomyAuditEventKind,
  AutonomyDelegationSuspensionNumbers,
  AutonomyDelegationWindow,
  AutonomyEligibility,
  AutonomyOutcome,
  AutonomyOutcomeKind,
  AutonomyOutcomePort,
  AutonomyOutcomeQuery,
  AutonomyPeriod,
  AutonomyPromotion,
  AutonomyReportOptions,
  AutonomySamplePlan,
  AutonomySampleReview,
  AutonomySampleSummary,
  AutonomySampleSuspensionNumbers,
  AutonomySampleVerdict,
  AutonomySampleVerdictInput,
  AutonomySuspension,
  AutonomyThresholdNumbers,
  AutonomyUnit,
  AutonomyUnitFilter,
  AutonomyUnitRef,
  AutonomyUnitReport,
  AutonomyUnsignedValue,
  FaberLoomAutonomyUnitId,
} from './types.ts'

export type * from './types.ts'
export { FaberLoomAutonomyRefusal } from './refusal.ts'
export type { AutonomyRefusalCode } from './refusal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAutonomy: FaberLoomAutonomy
    /**
     * Outcome read port the board adapter provides. Optional: without it, the
     * service reports that it cannot evaluate instead of reading an empty
     * history.
     */
    faberloomAutonomyOutcomes?: AutonomyOutcomePort
  }
}

/** Identity the audit records when the service decides without a human command. */
const AUTOMATIC = 'automatic'

/** Autonomy configuration accepted by the plugin row. */
export interface Config {
  /**
   * Items closed by human decision a unit needs before promotion. Ten, as
   * documented in §7.2.
   */
  readonly minimumRealRuns?: number
  /**
   * Approved-without-intervention share of those runs that promotion needs.
   * 0.70, as documented in §7.2.
   */
  readonly minimumApprovalShare?: number
  /**
   * Additional statistical minimum of §7.2. `null` means the business value is
   * unsigned: the report says the requirement is unknown instead of inventing
   * one, and nothing in this package supplies a substitute.
   */
  readonly statisticalMinimum?: number | null
  /**
   * Share of the delegated items of one period that enters later human review.
   * 0.10, as documented in D-13.
   */
  readonly sampleFraction?: number
  /** Fewest items one period's sample holds. One, as documented in D-13. */
  readonly sampleMinimum?: number
  /** Rejected sample items that suspend a unit. One, as documented in D-13. */
  readonly sampleRejectionsToSuspend?: number
  /** Delegations the suspension rate looks at. Twenty, as documented in D-13. */
  readonly monitoringWindow?: number
  /** Reversed-or-failed share that suspends a unit. 0.10, as documented in D-13. */
  readonly suspensionRate?: number
  /**
   * Console roles that may promote a unit, return it to `SUPERVISADO`, or
   * record a sample verdict. Owner and Admin by default; the deployment maps
   * its roles to these names.
   */
  readonly governanceRoles?: readonly string[]
  /**
   * Period the evaluation counts. `null` while the business period is unsigned;
   * an evaluation then covers every outcome the port reports for the unit, and
   * the report names the period as unsigned.
   */
  readonly period?: AutonomyPeriod | null
}

/** Validated autonomy configuration. */
export const Config = z.object({
  minimumRealRuns: z.number().int().positive().default(10),
  minimumApprovalShare: z.number().min(0).max(1).default(0.7),
  statisticalMinimum: z.number().int().positive().nullable().default(null),
  sampleFraction: z.number().positive().max(1).default(0.1),
  sampleMinimum: z.number().int().positive().default(1),
  sampleRejectionsToSuspend: z.number().int().positive().default(1),
  monitoringWindow: z.number().int().positive().default(20),
  suspensionRate: z.number().positive().max(1).default(0.1),
  governanceRoles: z.array(z.string().min(1)).default(['owner', 'admin']),
  period: z
    .object({ label: z.string().min(1).optional(), from: z.string().min(1), until: z.string().min(1) })
    .nullable()
    .default(null),
})

/** Configuration after validation, with every default resolved. */
type ResolvedConfig = z.infer<typeof Config>

/** Totals one outcome read produces. */
interface OutcomeTally {
  /** Items closed by human decision, technical failures excluded. */
  realRuns: number
  /** Real runs approved with no intervention. */
  approved: number
  /** Real runs approved after an intervention. */
  approvedWithIntervention: number
  /** Real runs discarded. */
  discarded: number
  /** Technical failures, excluded from every denominator. */
  technicalFailures: number
  /** One entry per delegation, technical failures excluded. */
  delegations: AutonomyOutcome[]
}

/** One audit entry as the service writes it. */
interface AuditInput {
  /** Unit the entry belongs to. */
  readonly unitId: string
  /** Tenant of the unit. */
  readonly tenantId: string
  /** What happened. */
  readonly event: AutonomyAuditEventKind
  /** Identity that acted, or {@link AUTOMATIC}. */
  readonly actor: string
  /** Cause, when the operation records one. */
  readonly cause?: string | null
  /** Item or period the operation names. */
  readonly detail?: string | null
  /** Numbers the operation was decided on. */
  readonly numbers?: Readonly<Record<string, number>>
}

/**
 * Storage key of one unit: its four §7.2 fields joined by NUL separators, so no
 * pair of distinct units collides.
 * @param ref - tenant, space, agent, and action type of the unit.
 * @returns the branded key the store and the consumers share.
 */
export function autonomyUnitId(ref: AutonomyUnitRef): FaberLoomAutonomyUnitId {
  return brandString<FaberLoomAutonomyUnitId>([ref.tenantId, ref.spaceId, ref.agentId, ref.actionType].join('\u0000'))
}

/** Key of one sample review: unit, period, and item. */
function sampleKey(unitId: string, period: string, itemId: string): string {
  return [unitId, period, itemId].join('\u0000')
}

/** Period identity the sample and the audit share: its label, or its bounds. */
function periodKey(period: AutonomyPeriod): string {
  return period.label ?? `${period.from}/${period.until}`
}

/** Label an audit entry records for an evaluated period. */
function periodDetail(period: AutonomyPeriod | null): string | null {
  return period === null ? null : periodKey(period)
}

/** Tenant of the acting identity, or refuse: autonomy belongs to one tenant. */
function requireTenant(actor: AutonomyActor): string {
  if (actor.companyId === undefined || actor.companyId.length === 0) {
    throw new FaberLoomAutonomyRefusal('TENANT_REQUIRED', 'the acting identity carries no companyId')
  }
  return actor.companyId
}

/** Refuse a unit reference that names no field, because its key would collide. */
function validateRef(ref: AutonomyUnitRef): void {
  const fields = [ref.tenantId, ref.spaceId, ref.agentId, ref.actionType]
  if (fields.some(value => value.trim().length === 0)) {
    throw new FaberLoomAutonomyRefusal('UNIT_REFERENCE_INVALID', 'a unit names its tenant, space, agent, and action type')
  }
}

/** Refuse a period whose bounds are inverted; ISO-8601 instants compare as strings. */
function validatePeriod(period: AutonomyPeriod): void {
  if (period.from >= period.until) {
    throw new FaberLoomAutonomyRefusal('PERIOD_INVALID', `the period starts at or after its end (${period.from} .. ${period.until})`)
  }
}

/** Whether one outcome is a delegation rather than a human decision. */
function isDelegation(kind: AutonomyOutcomeKind): boolean {
  return kind === 'delegated-confirmed' || kind === 'delegated-reversed' || kind === 'delegated-failed'
}

/** Order outcomes by instant, then by item, so a window is reproducible. */
function byInstant(left: AutonomyOutcome, right: AutonomyOutcome): number {
  if (left.at !== right.at) return left.at.localeCompare(right.at)
  return left.itemId.localeCompare(right.itemId)
}

/**
 * Add up one outcome read. A technical failure without its reason is refused:
 * §7.2 excludes them from the evaluation only when the reason is recorded.
 * @param outcomes - every outcome the port reported for the unit.
 * @returns the denominators and the delegations the monitoring window needs.
 */
function tallyOutcomes(outcomes: readonly AutonomyOutcome[]): OutcomeTally {
  const tally: OutcomeTally = {
    realRuns: 0,
    approved: 0,
    approvedWithIntervention: 0,
    discarded: 0,
    technicalFailures: 0,
    delegations: [],
  }
  for (const outcome of outcomes) {
    if (outcome.kind === 'technical-failure') {
      if (outcome.reason === undefined || outcome.reason.trim().length === 0) {
        throw new FaberLoomAutonomyRefusal(
          'TECHNICAL_FAILURE_REASON_REQUIRED',
          `item ${outcome.itemId} is excluded as a technical failure and must record its reason (§7.2)`,
        )
      }
      tally.technicalFailures += 1
      continue
    }
    if (isDelegation(outcome.kind)) {
      tally.delegations.push(outcome)
      continue
    }
    tally.realRuns += 1
    if (outcome.kind === 'approved') tally.approved += 1
    else if (outcome.kind === 'approved-with-intervention') tally.approvedWithIntervention += 1
    else tally.discarded += 1
  }
  return tally
}

/**
 * Reversal and failure rate over the most recent delegations of one unit.
 * @param delegations - delegations of the unit, technical failures excluded.
 * @param size - how many delegations the window keeps.
 * @returns the window and its rate; the rate is `undefined` when empty.
 */
function delegationWindow(delegations: readonly AutonomyOutcome[], size: number): AutonomyDelegationWindow {
  const ordered = [...delegations].sort(byInstant)
  const window = ordered.slice(Math.max(0, ordered.length - size))
  let confirmed = 0
  let reversed = 0
  let failed = 0
  for (const outcome of window) {
    if (outcome.kind === 'delegated-confirmed') confirmed += 1
    else if (outcome.kind === 'delegated-reversed') reversed += 1
    else failed += 1
  }
  const rate = window.length === 0 ? undefined : (reversed + failed) / window.length
  return { window: window.length, confirmed, reversed, failed, rate }
}

/** Map one durable unit to the consumer-facing unit. */
function toUnit(id: FaberLoomAutonomyUnitId, record: UnitRecord): AutonomyUnit {
  return { id, ...record }
}

/** Map one durable sample review to the consumer-facing review. */
function toSampleReview(record: SampleReviewRecord): AutonomySampleReview {
  return { ...record, unitId: brandString<FaberLoomAutonomyUnitId>(record.unitId) }
}

/** Order units for display: space, then agent, then action type. */
function byUnitIdentity(left: AutonomyUnit, right: AutonomyUnit): number {
  const scope = left.spaceId.localeCompare(right.spaceId)
  if (scope !== 0) return scope
  const agent = left.agentId.localeCompare(right.agentId)
  if (agent !== 0) return agent
  return left.actionType.localeCompare(right.actionType)
}

/**
 * The autonomy service: the level of every unit, the promotion report, the
 * sample of delegated items, and the automatic suspension of §7.3.
 */
export class FaberLoomAutonomy extends Service {
  static inject = ['storageDomain']

  private readonly policy: ResolvedConfig
  private domainPromise: Promise<Domain<typeof autonomyDomainSpec>> | undefined
  /** Tie-breaker for audit entries written in the same millisecond. */
  private auditSequence = 0

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - thresholds of §7.2 and D-13, the roles that govern
   * autonomy, and the period the evaluation counts.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomAutonomy')
    this.policy = Config.parse(config)
    if (this.policy.statisticalMinimum === null) {
      this.ctx.logger.warn(
        'faberloom: faberloom-autonomy has no statisticalMinimum; a unit reports whether it meets the signed thresholds, '
        + 'and only an explicit Owner or Admin promotion delegates it (W-53)',
      )
    }
    if (this.policy.period === null) {
      this.ctx.logger.warn(
        'faberloom: faberloom-autonomy has no period; an evaluation covers every outcome the port reports for the unit '
        + 'and the report names the period as unsigned (§7.2)',
      )
    }
  }

  private domain(): Promise<Domain<typeof autonomyDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(autonomyDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.autonomyDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async units(): Promise<KvTable<string, UnitRecord>> {
    return (await this.domain()).table('units')
  }

  private async samples(): Promise<KvTable<string, SampleReviewRecord>> {
    return (await this.domain()).table('sample_reviews')
  }

  private async auditTable(): Promise<KvTable<string, AuditRecord>> {
    return (await this.domain()).table('audit')
  }

  /** Check the actor tenant against the unit and validate its reference. */
  private scopeOf(actor: AutonomyActor, ref: AutonomyUnitRef): string {
    const tenantId = requireTenant(actor)
    validateRef(ref)
    if (tenantId !== ref.tenantId) {
      throw new FaberLoomAutonomyRefusal('TENANT_MISMATCH', 'a unit never crosses tenants')
    }
    return tenantId
  }

  /** Refuse a command the acting identity holds no governance role for. */
  private requireGovernance(actor: AutonomyActor): void {
    if (actor.role === undefined || !this.policy.governanceRoles.includes(actor.role)) {
      throw new FaberLoomAutonomyRefusal(
        'GOVERNANCE_NOT_PERMITTED',
        `${actor.id} holds none of the roles ${this.policy.governanceRoles.join(', ')}`,
      )
    }
  }

  /** Read the stored unit one reference names, or refuse `UNIT_NOT_FOUND`. */
  private async storedUnit(ref: AutonomyUnitRef): Promise<{ id: FaberLoomAutonomyUnitId; record: UnitRecord }> {
    const id = autonomyUnitId(ref)
    const record = (await this.units()).get(id)
    if (record === undefined) {
      throw new FaberLoomAutonomyRefusal(
        'UNIT_NOT_FOUND',
        `no unit covers '${ref.actionType}' for agent ${ref.agentId} in space ${ref.spaceId}`,
      )
    }
    return { id, record }
  }

  /**
   * Read the closed items of one unit through the outcome port. Without a
   * mounted port the service refuses instead of reporting an empty history.
   * @param ref - the unit.
   * @param period - window to read, or `null` for everything the port reports.
   * @returns the outcomes the port answered.
   */
  private async readOutcomes(ref: AutonomyUnitRef, period: AutonomyPeriod | null): Promise<readonly AutonomyOutcome[]> {
    const port = this.ctx.get('faberloomAutonomyOutcomes')
    if (port === undefined) {
      throw new FaberLoomAutonomyRefusal(
        'OUTCOME_SOURCE_UNAVAILABLE',
        'no faberloomAutonomyOutcomes port is mounted, so closed items cannot be read',
      )
    }
    const query: AutonomyOutcomeQuery = {
      tenantId: ref.tenantId,
      spaceId: ref.spaceId,
      agentId: ref.agentId,
      actionType: ref.actionType,
      ...(period === null ? {} : { from: period.from, until: period.until }),
    }
    return port.readOutcomes(query)
  }

  /**
   * Append one audit entry; the table is the durable record of every decision.
   * The key starts with the instant and adds a per-process sequence, so entries
   * of the same millisecond still read back in the order they were written.
   */
  private async writeAudit(input: AuditInput): Promise<void> {
    const at = new Date().toISOString()
    const record: AuditRecord = {
      unitId: input.unitId,
      tenantId: input.tenantId,
      at,
      event: input.event,
      actor: input.actor,
      cause: input.cause ?? null,
      detail: input.detail ?? null,
      numbers: input.numbers === undefined ? {} : { ...input.numbers },
    }
    const key = `${at}\u0000${String(this.auditSequence).padStart(10, '0')}`
    this.auditSequence += 1
    await (await this.auditTable()).put(key, record)
  }

  /** Count the sample reviews of one unit, grouped by period. */
  private async sampleSummaries(tenantId: string, unitId: string): Promise<AutonomySampleSummary[]> {
    const groups = new Map<string, { planned: number; reviewed: number; rejected: number }>()
    for (const [, record] of (await this.samples()).entries()) {
      if (record.tenantId !== tenantId || record.unitId !== unitId) continue
      const group = groups.get(record.period) ?? { planned: 0, reviewed: 0, rejected: 0 }
      group.planned += 1
      if (record.verdict !== 'pending') group.reviewed += 1
      if (record.verdict === 'rejected') group.rejected += 1
      groups.set(record.period, group)
    }
    const out = [...groups.entries()]
      .map(([period, group]) => ({ period, ...group, pending: group.planned - group.reviewed }))
      .sort((left, right) => left.period.localeCompare(right.period))
    return out
  }

  /** Project one tally and its sample counts onto the report consumers read. */
  private composeReport(
    id: FaberLoomAutonomyUnitId,
    record: UnitRecord,
    period: AutonomyPeriod | null,
    tally: OutcomeTally,
    samples: readonly AutonomySampleSummary[],
  ): AutonomyUnitReport {
    const approvalShare = tally.realRuns === 0 ? undefined : tally.approved / tally.realRuns
    const realRunsMet = tally.realRuns >= this.policy.minimumRealRuns
    const approvalShareMet = approvalShare !== undefined && approvalShare >= this.policy.minimumApprovalShare
    const statisticalMinimumMet = this.policy.statisticalMinimum === null
      ? null
      : tally.realRuns >= this.policy.statisticalMinimum
    const unsignedValues: AutonomyUnsignedValue[] = []
    if (period === null) unsignedValues.push('period')
    if (this.policy.statisticalMinimum === null) unsignedValues.push('statistical-minimum')
    const eligibility: AutonomyEligibility = {
      minimumRealRuns: this.policy.minimumRealRuns,
      minimumApprovalShare: this.policy.minimumApprovalShare,
      statisticalMinimum: this.policy.statisticalMinimum,
      realRunsMet,
      approvalShareMet,
      statisticalMinimumMet,
      meetsThreshold: realRunsMet && approvalShareMet && statisticalMinimumMet !== false,
      automaticPromotion: 'DISABLED',
      unsignedValues,
    }
    return {
      unit: toUnit(id, record),
      period,
      realRuns: tally.realRuns,
      approvedWithoutIntervention: tally.approved,
      approvedWithIntervention: tally.approvedWithIntervention,
      discarded: tally.discarded,
      approvalShare,
      technicalFailures: tally.technicalFailures,
      delegations: delegationWindow(tally.delegations, this.policy.monitoringWindow),
      samples,
      eligibility,
      suspension: record.suspension,
    }
  }

  /**
   * Register one unit at `SHADOW` if it has none, and return it otherwise.
   * Registration is idempotent and records no level change.
   * @param actor - identity supplying the tenant.
   * @param ref - tenant, space, agent, and action type of the unit.
   * @returns the stored unit.
   */
  async ensureUnit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit> {
    const tenantId = this.scopeOf(actor, ref)
    const id = autonomyUnitId(ref)
    const table = await this.units()
    const existing = table.get(id)
    if (existing !== undefined) return toUnit(id, existing)
    const now = new Date().toISOString()
    const record: UnitRecord = {
      tenantId,
      spaceId: ref.spaceId,
      agentId: ref.agentId,
      actionType: ref.actionType,
      level: 'SHADOW',
      createdAt: now,
      updatedAt: now,
      promotion: null,
      suspension: null,
    }
    await table.put(id, record)
    return toUnit(id, record)
  }

  /**
   * Read one unit. Another tenant's unit is refused before the store is read.
   * @param actor - reading identity and its tenant.
   * @param ref - unit to read.
   * @returns the unit, or `undefined` when it is not registered.
   */
  async getUnit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit | undefined> {
    this.scopeOf(actor, ref)
    const id = autonomyUnitId(ref)
    const record = (await this.units()).get(id)
    return record === undefined ? undefined : toUnit(id, record)
  }

  /**
   * List the units of the actor's tenant, optionally filtered. Units of other
   * tenants are never read.
   * @param actor - reading identity and its tenant.
   * @param filter - space, agent, action type, and level to keep.
   * @returns the units, ordered by space, agent, and action type.
   */
  async listUnits(actor: AutonomyActor, filter: AutonomyUnitFilter = {}): Promise<AutonomyUnit[]> {
    const tenantId = requireTenant(actor)
    const out: AutonomyUnit[] = []
    for (const [key, record] of (await this.units()).entries()) {
      if (record.tenantId !== tenantId) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      if (filter.agentId !== undefined && record.agentId !== filter.agentId) continue
      if (filter.actionType !== undefined && record.actionType !== filter.actionType) continue
      if (filter.level !== undefined && record.level !== filter.level) continue
      out.push(toUnit(brandString<FaberLoomAutonomyUnitId>(key), record))
    }
    out.sort(byUnitIdentity)
    return out
  }

  /**
   * Report the numbers of one unit without changing its level. The report
   * states whether the signed thresholds are met and which values are still
   * unsigned; it never promotes (W-53).
   * @param actor - reading identity and its tenant.
   * @param ref - unit to report.
   * @param options - period to evaluate instead of the configured one.
   * @returns the numbers, the eligibility, and the last suspension.
   */
  async report(
    actor: AutonomyActor,
    ref: AutonomyUnitRef,
    options: AutonomyReportOptions = {},
  ): Promise<AutonomyUnitReport> {
    const tenantId = this.scopeOf(actor, ref)
    const { id, record } = await this.storedUnit(ref)
    const period = options.period ?? this.policy.period
    const tally = tallyOutcomes(await this.readOutcomes(ref, period))
    return this.composeReport(id, record, period, tally, await this.sampleSummaries(tenantId, id))
  }

  /**
   * Apply the monitoring rule of §7.3 to one unit: while it is `DELEGADO`, a
   * reversal-or-failure rate above the configured threshold returns it to
   * `SUPERVISADO` with an audit entry. The decision needs no human command;
   * the caller that records delegated outcomes calls this after them, because
   * the package owns no scheduler.
   * @param actor - identity supplying the tenant.
   * @param ref - unit to assess.
   * @param options - period to evaluate instead of the configured one.
   * @returns the report after the assessment, with the level it now holds.
   */
  async assess(
    actor: AutonomyActor,
    ref: AutonomyUnitRef,
    options: AutonomyReportOptions = {},
  ): Promise<AutonomyUnitReport> {
    const tenantId = this.scopeOf(actor, ref)
    const { id, record } = await this.storedUnit(ref)
    const period = options.period ?? this.policy.period
    const tally = tallyOutcomes(await this.readOutcomes(ref, period))
    const samples = await this.sampleSummaries(tenantId, id)
    if (record.level !== 'DELEGADO') return this.composeReport(id, record, period, tally, samples)
    const window = delegationWindow(tally.delegations, this.policy.monitoringWindow)
    if (window.rate === undefined || window.rate <= this.policy.suspensionRate) {
      return this.composeReport(id, record, period, tally, samples)
    }
    const suspension = await this.suspendByDelegations(id, record, window, tally.technicalFailures, period)
    const suspended: UnitRecord = {
      ...record,
      level: 'SUPERVISADO',
      updatedAt: suspension.at,
      promotion: null,
      suspension,
    }
    return this.composeReport(id, suspended, period, tally, samples)
  }

  /**
   * Promote one unit to `DELEGADO`. The command is explicit and gated: the
   * identity must hold a governance role of the tenant, and the unit must meet
   * the signed thresholds. The promotion records who promoted it, when, and on
   * which numbers. No automatic path exists (W-53, W-64).
   * @param actor - promoting identity and its tenant.
   * @param ref - unit to promote.
   * @returns the promoted unit with its promotion record.
   */
  async promote(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyUnit> {
    this.scopeOf(actor, ref)
    this.requireGovernance(actor)
    const { id, record } = await this.storedUnit(ref)
    if (record.level === 'DELEGADO') {
      throw new FaberLoomAutonomyRefusal('ALREADY_DELEGATED', 'the unit already executes alone')
    }
    const period = this.policy.period
    const tally = tallyOutcomes(await this.readOutcomes(ref, period))
    const report = this.composeReport(id, record, period, tally, await this.sampleSummaries(record.tenantId, id))
    if (!report.eligibility.meetsThreshold) {
      throw new FaberLoomAutonomyRefusal(
        'NOT_ELIGIBLE',
        `${report.realRuns} real runs at share ${report.approvalShare ?? 0} do not reach `
        + `${this.policy.minimumRealRuns} runs at ${this.policy.minimumApprovalShare}`,
      )
    }
    const numbers: AutonomyThresholdNumbers = {
      realRuns: report.realRuns,
      approvedWithoutIntervention: report.approvedWithoutIntervention,
      approvalShare: report.approvalShare ?? 0,
      technicalFailures: report.technicalFailures,
      minimumRealRuns: this.policy.minimumRealRuns,
      minimumApprovalShare: this.policy.minimumApprovalShare,
      statisticalMinimum: this.policy.statisticalMinimum,
      period: periodDetail(period),
    }
    const now = new Date().toISOString()
    const promotion: AutonomyPromotion = { by: actor.id, at: now, numbers }
    const next: UnitRecord = { ...record, level: 'DELEGADO', updatedAt: now, promotion, suspension: null }
    await (await this.units()).update(id, () => next)
    await this.writeAudit({
      unitId: id,
      tenantId: record.tenantId,
      event: 'promoted',
      actor: actor.id,
      detail: numbers.period,
      numbers: {
        realRuns: numbers.realRuns,
        approvedWithoutIntervention: numbers.approvedWithoutIntervention,
        approvalShare: numbers.approvalShare,
        technicalFailures: numbers.technicalFailures,
        minimumRealRuns: numbers.minimumRealRuns,
        minimumApprovalShare: numbers.minimumApprovalShare,
        ...(numbers.statisticalMinimum === null ? {} : { statisticalMinimum: numbers.statisticalMinimum }),
      },
    })
    return toUnit(id, next)
  }

  /**
   * Return one unit to `SUPERVISADO` at a human's request. The audit keeps the
   * cause, and delegating again needs a new promotion.
   * @param actor - identity narrowing the unit.
   * @param ref - unit to supervise.
   * @param cause - why the unit loses its delegation.
   * @returns the supervised unit.
   */
  async supervise(actor: AutonomyActor, ref: AutonomyUnitRef, cause: string): Promise<AutonomyUnit> {
    this.scopeOf(actor, ref)
    this.requireGovernance(actor)
    if (cause.trim().length === 0) {
      throw new FaberLoomAutonomyRefusal('CAUSE_REQUIRED', 'returning a unit to SUPERVISADO records its cause')
    }
    const { id, record } = await this.storedUnit(ref)
    if (record.level === 'SUPERVISADO') return toUnit(id, record)
    const now = new Date().toISOString()
    const next: UnitRecord = { ...record, level: 'SUPERVISADO', updatedAt: now, promotion: null, suspension: null }
    await (await this.units()).update(id, () => next)
    await this.writeAudit({ unitId: id, tenantId: record.tenantId, event: 'supervised', actor: actor.id, cause })
    return toUnit(id, next)
  }

  /**
   * Plan the sample of one period: the configured share of the delegated items,
   * at least the configured minimum, chosen from the earliest delegations that
   * are not in the sample yet. Planning only selects; execution is never
   * blocked (D-13).
   * @param actor - identity supplying the tenant.
   * @param ref - delegated unit.
   * @param period - period the sample covers.
   * @returns the target, the items this call added, and what still waits.
   */
  async planSample(actor: AutonomyActor, ref: AutonomyUnitRef, period: AutonomyPeriod): Promise<AutonomySamplePlan> {
    const tenantId = this.scopeOf(actor, ref)
    validatePeriod(period)
    const { id, record } = await this.storedUnit(ref)
    if (record.level !== 'DELEGADO') {
      throw new FaberLoomAutonomyRefusal('NOT_DELEGATED', 'a sample reviews delegation output, and the unit is not delegated')
    }
    const key = periodKey(period)
    const delegated = (await this.readOutcomes(ref, period)).filter(outcome => isDelegation(outcome.kind))
    const target = Math.max(this.policy.sampleMinimum, Math.ceil(delegated.length * this.policy.sampleFraction))
    const table = await this.samples()
    const chosen = new Set<string>()
    for (const [, entry] of table.entries()) {
      if (entry.tenantId !== tenantId || entry.unitId !== id || entry.period !== key) continue
      chosen.add(entry.itemId)
    }
    const needed = Math.max(0, target - chosen.size)
    const additions = [...delegated].sort(byInstant)
      .filter(outcome => !chosen.has(outcome.itemId))
      .slice(0, needed)
    const now = new Date().toISOString()
    const selected: AutonomySampleReview[] = []
    for (const outcome of additions) {
      const entry: SampleReviewRecord = {
        unitId: id,
        tenantId,
        period: key,
        itemId: outcome.itemId,
        delegatedAt: outcome.at,
        selectedAt: now,
        verdict: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        note: null,
      }
      await table.put(sampleKey(id, key, outcome.itemId), entry)
      selected.push(toSampleReview(entry))
    }
    await this.writeAudit({
      unitId: id,
      tenantId,
      event: 'sample-planned',
      actor: actor.id,
      detail: key,
      numbers: { delegations: delegated.length, target, selected: selected.length },
    })
    return { period, target, selected, pending: await this.pendingSample(tenantId, id, key) }
  }

  /** Read the pending reviews of one unit and period. */
  private async pendingSample(tenantId: string, unitId: string, period: string): Promise<AutonomySampleReview[]> {
    const out: AutonomySampleReview[] = []
    for (const [, entry] of (await this.samples()).entries()) {
      if (entry.tenantId !== tenantId || entry.unitId !== unitId || entry.period !== period) continue
      if (entry.verdict !== 'pending') continue
      out.push(toSampleReview(entry))
    }
    out.sort((left, right) => left.itemId.localeCompare(right.itemId))
    return out
  }

  /**
   * Record the human verdict on one sampled item. A rejection suspends a
   * delegated unit on the spot, with the cause and the numbers in the audit
   * (D-13). A verdict is recorded once.
   * @param actor - reviewing identity; it must hold a governance role.
   * @param ref - unit the item belongs to.
   * @param input - period, item, verdict, and optional note.
   * @returns the reviewed item and the suspension the verdict caused.
   */
  async reviewSample(
    actor: AutonomyActor,
    ref: AutonomyUnitRef,
    input: AutonomySampleVerdictInput,
  ): Promise<AutonomySampleVerdict> {
    const tenantId = this.scopeOf(actor, ref)
    this.requireGovernance(actor)
    const { id, record } = await this.storedUnit(ref)
    const table = await this.samples()
    const key = sampleKey(id, input.period, input.itemId)
    const entry = table.get(key)
    if (entry === undefined || entry.tenantId !== tenantId) {
      throw new FaberLoomAutonomyRefusal('SAMPLE_NOT_FOUND', `item ${input.itemId} is not in the ${input.period} sample`)
    }
    if (entry.verdict !== 'pending') {
      throw new FaberLoomAutonomyRefusal('SAMPLE_ALREADY_REVIEWED', `item ${input.itemId} already holds a verdict`)
    }
    const now = new Date().toISOString()
    const next: SampleReviewRecord = {
      ...entry,
      verdict: input.verdict,
      reviewedBy: actor.id,
      reviewedAt: now,
      note: input.note ?? null,
    }
    await table.update(key, () => next)
    let sampleSize = 0
    let rejected = 0
    for (const [, reviewer] of (await this.samples()).entries()) {
      if (reviewer.tenantId !== tenantId || reviewer.unitId !== id || reviewer.period !== input.period) continue
      sampleSize += 1
      if (reviewer.verdict === 'rejected') rejected += 1
    }
    await this.writeAudit({
      unitId: id,
      tenantId,
      event: 'sample-reviewed',
      actor: actor.id,
      cause: input.verdict,
      detail: `${input.period}/${input.itemId}`,
      numbers: { sampleSize, rejectedSampleItems: rejected },
    })
    let suspension: AutonomySuspension | null = null
    if (input.verdict === 'rejected' && record.level === 'DELEGADO' && rejected >= this.policy.sampleRejectionsToSuspend) {
      suspension = await this.suspendBySample(id, record, input.period, sampleSize, rejected, input.itemId)
    }
    return { review: toSampleReview(next), suspension }
  }

  /**
   * List the audit entries of one unit, oldest first.
   * @param actor - reading identity and its tenant.
   * @param ref - unit to read.
   * @returns the audit entries.
   */
  async listAudit(actor: AutonomyActor, ref: AutonomyUnitRef): Promise<AutonomyAuditEvent[]> {
    const tenantId = this.scopeOf(actor, ref)
    const { id } = await this.storedUnit(ref)
    const out: AutonomyAuditEvent[] = []
    for (const [key, record] of (await this.auditTable()).entries()) {
      if (record.tenantId !== tenantId || record.unitId !== id) continue
      out.push({ id: key, ...record })
    }
    out.sort((left, right) => (left.at === right.at ? left.id.localeCompare(right.id) : left.at.localeCompare(right.at)))
    return out
  }

  /** Suspend one delegated unit because its recent delegations reversed or failed. */
  private async suspendByDelegations(
    id: FaberLoomAutonomyUnitId,
    record: UnitRecord,
    window: AutonomyDelegationWindow,
    technicalFailures: number,
    period: AutonomyPeriod | null,
  ): Promise<AutonomySuspension> {
    const numbers: AutonomyDelegationSuspensionNumbers = {
      delegations: window.window,
      reversed: window.reversed,
      failed: window.failed,
      technicalFailures,
      rate: window.rate ?? 0,
      suspensionRate: this.policy.suspensionRate,
      period: periodDetail(period),
    }
    const now = new Date().toISOString()
    const suspension: AutonomySuspension = { at: now, cause: 'delegation-rate', numbers }
    const next: UnitRecord = { ...record, level: 'SUPERVISADO', updatedAt: now, promotion: null, suspension }
    await (await this.units()).update(id, () => next)
    await this.writeAudit({
      unitId: id,
      tenantId: record.tenantId,
      event: 'suspended',
      actor: AUTOMATIC,
      cause: 'delegation-rate',
      detail: numbers.period,
      numbers: {
        delegations: numbers.delegations,
        reversed: numbers.reversed,
        failed: numbers.failed,
        technicalFailures: numbers.technicalFailures,
        rate: numbers.rate,
        suspensionRate: numbers.suspensionRate,
      },
    })
    return suspension
  }

  /** Suspend one delegated unit because a reviewed sample item was rejected. */
  private async suspendBySample(
    id: FaberLoomAutonomyUnitId,
    record: UnitRecord,
    period: string,
    sampleSize: number,
    rejected: number,
    itemId: string,
  ): Promise<AutonomySuspension> {
    const now = new Date().toISOString()
    const numbers: AutonomySampleSuspensionNumbers = {
      period,
      sampleSize,
      rejectedSampleItems: rejected,
      sampleRejectionsToSuspend: this.policy.sampleRejectionsToSuspend,
    }
    const suspension: AutonomySuspension = { at: now, cause: 'sample-rejected', numbers }
    const next: UnitRecord = { ...record, level: 'SUPERVISADO', updatedAt: now, promotion: null, suspension }
    await (await this.units()).update(id, () => next)
    await this.writeAudit({
      unitId: id,
      tenantId: record.tenantId,
      event: 'suspended',
      actor: AUTOMATIC,
      cause: 'sample-rejected',
      detail: `${period}/${itemId}`,
      numbers: {
        sampleSize: numbers.sampleSize,
        rejectedSampleItems: numbers.rejectedSampleItems,
        sampleRejectionsToSuspend: numbers.sampleRejectionsToSuspend,
      },
    })
    return suspension
  }
}

export default FaberLoomAutonomy
