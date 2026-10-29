import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAutonomy, {
  autonomyUnitId,
  FaberLoomAutonomyRefusal,
  type AutonomyActor,
  type AutonomyOutcome,
  type AutonomyOutcomeKind,
  type AutonomyOutcomePort,
  type AutonomyOutcomeQuery,
  type AutonomyPeriod,
  type AutonomyUnitRef,
  type Config,
} from '../src/index.ts'

const TENANT = 'eguisa'
const OTHER_TENANT = 'sondel'
const UNIT: AutonomyUnitRef = { tenantId: TENANT, spaceId: 'compras', agentId: 'agent-proforma', actionType: 'mail.send' }

/** Tenant owner allowed to promote and review. */
const OWNER: AutonomyActor = { id: 'owner@eguisa.test', companyId: TENANT, role: 'owner' }

/** Tenant administrator, equally allowed. */
const ADMIN: AutonomyActor = { id: 'admin@eguisa.test', companyId: TENANT, role: 'admin' }

/** Tenant member with no governance role. */
const MEMBER: AutonomyActor = { id: 'member@eguisa.test', companyId: TENANT, role: 'client_b2b' }

/** Identity of another tenant. */
const FOREIGN: AutonomyActor = { id: 'owner@sondel.test', companyId: OTHER_TENANT, role: 'owner' }

/** October 2026 period the samples key on. */
const PERIOD: AutonomyPeriod = { label: '2026-10', from: '2026-10-01T00:00:00.000Z', until: '2026-11-01T00:00:00.000Z' }

/** In-memory outcome port the specs seed per unit. */
class SeededOutcomes implements AutonomyOutcomePort {
  private readonly byUnit = new Map<string, AutonomyOutcome[]>()

  /**
   * @param ref - unit the outcomes belong to.
   * @param outcomes - closed items the port answers with.
   */
  seed(ref: AutonomyUnitRef, outcomes: readonly AutonomyOutcome[]): void {
    const key = autonomyUnitId(ref)
    this.byUnit.set(key, [...(this.byUnit.get(key) ?? []), ...outcomes])
  }

  /**
   * @param query - unit identity and optional period window.
   * @returns the seeded outcomes inside the window.
   */
  async readOutcomes(query: AutonomyOutcomeQuery): Promise<readonly AutonomyOutcome[]> {
    const all = this.byUnit.get(autonomyUnitId(query)) ?? []
    return all.filter(outcome =>
      (query.from === undefined || outcome.at >= query.from)
      && (query.until === undefined || outcome.at < query.until))
  }
}

/** Boot the storage/domain composition, the outcome port, and the autonomy service. */
async function harness(config: Config = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const port = new SeededOutcomes()
  ctx.provide('faberloomAutonomyOutcomes', port)
  await ctx.plugin(FaberLoomAutonomy, config)
  return { ctx, autonomy: ctx.faberloomAutonomy, port }
}

/** ISO instant `minute` minutes after the start of the period. */
function instant(minute: number): string {
  return new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString()
}

/** Build `count` outcomes of one kind, one per minute. */
function run(kind: AutonomyOutcomeKind, count: number, startMinute = 0): AutonomyOutcome[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `${kind}-${String(startMinute + index)}`,
    at: instant(startMinute + index),
    kind,
  }))
}

/** Build technical failures, each with the reason §7.2 requires. */
function technicalFailures(count: number, startMinute = 0): AutonomyOutcome[] {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `technical-${String(startMinute + index)}`,
    at: instant(startMinute + index),
    kind: 'technical-failure' as const,
    reason: 'MCP read timed out',
  }))
}

/** Register one unit and promote it with ten approvals, the shortest eligible history. */
async function delegated(autonomy: FaberLoomAutonomy, port: SeededOutcomes) {
  port.seed(UNIT, run('approved', 10))
  await autonomy.ensureUnit(OWNER, UNIT)
  return autonomy.promote(OWNER, UNIT)
}

describe('FaberLoomAutonomy promotion', () => {
  it('W-53 · a unit with fewer than ten real runs is not eligible', async () => {
    const { autonomy, port } = await harness()
    port.seed(UNIT, run('approved', 9))
    await autonomy.ensureUnit(OWNER, UNIT)
    const report = await autonomy.report(OWNER, UNIT)
    expect(report.realRuns).toBe(9)
    expect(report.approvalShare).toBe(1)
    expect(report.eligibility).toMatchObject({ realRunsMet: false, approvalShareMet: true, meetsThreshold: false })
    expect(report.eligibility.automaticPromotion).toBe('DISABLED')
    await expect(autonomy.promote(OWNER, UNIT)).rejects.toThrow('NOT_ELIGIBLE')
    expect((await autonomy.getUnit(OWNER, UNIT))?.level).toBe('SHADOW')
  })

  it('W-53 · 69 % is not eligible and 70 % is', async () => {
    const { autonomy, port } = await harness()
    const thin: AutonomyUnitRef = { ...UNIT, actionType: 'proforma.send' }
    port.seed(thin, [...run('approved', 9), ...run('approved-with-intervention', 4, 20)])
    port.seed(UNIT, [...run('approved', 7), ...run('approved-with-intervention', 3, 40)])
    await autonomy.ensureUnit(OWNER, thin)
    await autonomy.ensureUnit(OWNER, UNIT)

    const below = await autonomy.report(OWNER, thin)
    expect(below.realRuns).toBe(13)
    expect(below.approvalShare).toBeCloseTo(0.6923, 4)
    expect(below.eligibility.meetsThreshold).toBe(false)

    const exact = await autonomy.report(OWNER, UNIT)
    expect(exact.approvalShare).toBe(0.7)
    expect(exact.eligibility.meetsThreshold).toBe(true)

    const promoted = await autonomy.promote(OWNER, UNIT)
    expect(promoted.level).toBe('DELEGADO')
    expect(promoted.promotion).toMatchObject({
      by: OWNER.id,
      numbers: { realRuns: 10, approvedWithoutIntervention: 7, approvalShare: 0.7, minimumRealRuns: 10, minimumApprovalShare: 0.7 },
    })
    expect(Number.isNaN(Date.parse(promoted.promotion?.at ?? ''))).toBe(false)
  })

  it('W-64 · the service refuses to promote itself without an Owner or Admin', async () => {
    const { autonomy, port } = await harness()
    port.seed(UNIT, run('approved', 10))
    await autonomy.ensureUnit(OWNER, UNIT)
    const attempt = autonomy.promote(MEMBER, UNIT)
    await expect(attempt).rejects.toBeInstanceOf(FaberLoomAutonomyRefusal)
    await expect(attempt).rejects.toMatchObject({ code: 'GOVERNANCE_NOT_PERMITTED' })
    expect((await autonomy.getUnit(OWNER, UNIT))?.level).toBe('SHADOW')
    expect((await autonomy.listAudit(OWNER, UNIT)).map(entry => entry.event)).toEqual([])

    const promoted = await autonomy.promote(ADMIN, UNIT)
    expect(promoted.level).toBe('DELEGADO')
    expect((await autonomy.listAudit(OWNER, UNIT)).map(entry => entry.event)).toEqual(['promoted'])
  })

  it('refuses to evaluate or promote without a mounted outcome port', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomAutonomy)
    await ctx.faberloomAutonomy.ensureUnit(OWNER, UNIT)
    await expect(ctx.faberloomAutonomy.report(OWNER, UNIT)).rejects.toMatchObject({ code: 'OUTCOME_SOURCE_UNAVAILABLE' })
  })
})

describe('FaberLoomAutonomy monitoring', () => {
  it('W-64 · three reversals in the last twenty delegations return the unit to SUPERVISADO', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, [...run('delegated-confirmed', 17, 100), ...run('delegated-reversed', 3, 200)])

    const report = await autonomy.assess(OWNER, UNIT)
    expect(report.delegations).toMatchObject({ window: 20, confirmed: 17, reversed: 3, failed: 0 })
    expect(report.delegations.rate).toBeCloseTo(0.15, 6)
    expect(report.unit.level).toBe('SUPERVISADO')
    expect(report.suspension).toMatchObject({
      cause: 'delegation-rate',
      numbers: { delegations: 20, reversed: 3, failed: 0, rate: 0.15, suspensionRate: 0.1 },
    })

    const audit = await autonomy.listAudit(OWNER, UNIT)
    expect(audit.map(entry => entry.event)).toEqual(['promoted', 'suspended'])
    expect(audit[1]).toMatchObject({ actor: 'automatic', cause: 'delegation-rate', numbers: { reversed: 3 } })
  })

  it('keeps a unit delegated when the rate does not exceed ten percent', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, [...run('delegated-confirmed', 18, 100), ...run('delegated-reversed', 2, 200)])
    const report = await autonomy.assess(OWNER, UNIT)
    expect(report.delegations.rate).toBe(0.1)
    expect(report.unit.level).toBe('DELEGADO')
    expect(report.suspension).toBeNull()
  })

  it('W-64 · a technical failure alone does not suspend', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, technicalFailures(20, 100))
    const report = await autonomy.assess(OWNER, UNIT)
    expect(report.technicalFailures).toBe(20)
    expect(report.delegations).toMatchObject({ window: 0 })
    expect(report.delegations.rate).toBeUndefined()
    expect(report.unit.level).toBe('DELEGADO')
    expect((await autonomy.listAudit(OWNER, UNIT)).map(entry => entry.event)).toEqual(['promoted'])
  })

  it('W-64 · one rejected sample item returns the unit to SUPERVISADO', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, run('delegated-confirmed', 20, 100))
    const plan = await autonomy.planSample(OWNER, UNIT, PERIOD)
    expect(plan.target).toBe(2)
    expect(plan.selected).toHaveLength(2)
    expect(plan.pending.map(entry => entry.itemId)).toEqual(plan.selected.map(entry => entry.itemId))

    const [first, second] = plan.selected
    const accepted = await autonomy.reviewSample(OWNER, UNIT, {
      period: '2026-10', itemId: first!.itemId, verdict: 'accepted',
    })
    expect(accepted.suspension).toBeNull()
    expect(accepted.review.verdict).toBe('accepted')

    const rejected = await autonomy.reviewSample(ADMIN, UNIT, {
      period: '2026-10', itemId: second!.itemId, verdict: 'rejected', note: 'monto equivocado',
    })
    expect(rejected.suspension).toMatchObject({
      cause: 'sample-rejected',
      numbers: { period: '2026-10', sampleSize: 2, rejectedSampleItems: 1, sampleRejectionsToSuspend: 1 },
    })
    expect((await autonomy.getUnit(OWNER, UNIT))?.level).toBe('SUPERVISADO')

    const audit = await autonomy.listAudit(OWNER, UNIT)
    expect(audit.map(entry => entry.event)).toEqual(['promoted', 'sample-planned', 'sample-reviewed', 'sample-reviewed', 'suspended'])
    expect(audit[4]).toMatchObject({ actor: 'automatic', cause: 'sample-rejected', detail: '2026-10/delegated-confirmed-101' })
    await expect(autonomy.reviewSample(OWNER, UNIT, {
      period: '2026-10', itemId: second!.itemId, verdict: 'accepted',
    })).rejects.toMatchObject({ code: 'SAMPLE_ALREADY_REVIEWED' })
  })

  it('D-13 · the sample is ten percent with a minimum of one per period', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, run('delegated-confirmed', 4, 100))
    const small = await autonomy.planSample(OWNER, UNIT, PERIOD)
    expect(small.target).toBe(1)
    expect(small.selected).toHaveLength(1)

    port.seed(UNIT, run('delegated-confirmed', 16, 200))
    const grown = await autonomy.planSample(OWNER, UNIT, PERIOD)
    expect(grown.target).toBe(2)
    expect(grown.selected).toHaveLength(1)
    expect(grown.pending).toHaveLength(2)
  })

  it('W-64 · reactivation needs a new promotion and a fresh Owner/Admin gate', async () => {
    const { autonomy, port } = await harness()
    await delegated(autonomy, port)
    port.seed(UNIT, run('delegated-reversed', 3, 100))
    await autonomy.assess(OWNER, UNIT)
    expect((await autonomy.getUnit(OWNER, UNIT))?.level).toBe('SUPERVISADO')

    await expect(autonomy.promote(MEMBER, UNIT)).rejects.toMatchObject({ code: 'GOVERNANCE_NOT_PERMITTED' })
    const promoted = await autonomy.promote(OWNER, UNIT)
    expect(promoted.level).toBe('DELEGADO')
    expect(promoted.suspension).toBeNull()
    expect(promoted.promotion?.by).toBe(OWNER.id)
    expect((await autonomy.listAudit(OWNER, UNIT)).map(entry => entry.event)).toEqual(['promoted', 'suspended', 'promoted'])
  })

  it('requires the period to be a real window and the unit to be delegated', async () => {
    const { autonomy, port } = await harness()
    port.seed(UNIT, run('approved', 10))
    await autonomy.ensureUnit(OWNER, UNIT)
    await expect(autonomy.planSample(OWNER, UNIT, PERIOD)).rejects.toMatchObject({ code: 'NOT_DELEGATED' })
    await autonomy.promote(OWNER, UNIT)
    await expect(autonomy.planSample(OWNER, UNIT, { from: PERIOD.until, until: PERIOD.from }))
      .rejects.toMatchObject({ code: 'PERIOD_INVALID' })
  })
})

describe('FaberLoomAutonomy isolation', () => {
  it('never shows one tenant the unit of another with the same name', async () => {
    const { autonomy, port } = await harness()
    const foreignUnit: AutonomyUnitRef = { ...UNIT, tenantId: OTHER_TENANT }
    port.seed(UNIT, run('approved', 10))
    port.seed(foreignUnit, [...run('discarded', 9)])
    await autonomy.ensureUnit(OWNER, UNIT)
    await autonomy.ensureUnit(FOREIGN, foreignUnit)
    await autonomy.promote(OWNER, UNIT)

    const local = await autonomy.getUnit(OWNER, UNIT)
    const other = await autonomy.getUnit(FOREIGN, foreignUnit)
    expect(local?.level).toBe('DELEGADO')
    expect(other?.level).toBe('SHADOW')
    await expect(autonomy.getUnit(FOREIGN, UNIT)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
    await expect(autonomy.report(FOREIGN, UNIT)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })

    expect((await autonomy.listUnits(OWNER)).map(unit => unit.tenantId)).toEqual([TENANT])
    expect((await autonomy.listUnits(FOREIGN)).map(unit => unit.tenantId)).toEqual([OTHER_TENANT])
    expect((await autonomy.report(OWNER, UNIT)).realRuns).toBe(10)
    expect((await autonomy.report(FOREIGN, foreignUnit)).realRuns).toBe(9)
    expect((await autonomy.listAudit(FOREIGN, foreignUnit)).map(entry => entry.event)).toEqual([])
  })

  it('refuses a reference with an empty field and an actor without a tenant', async () => {
    const { autonomy } = await harness()
    const empty: AutonomyUnitRef = { ...UNIT, agentId: ' ' }
    await expect(autonomy.ensureUnit(OWNER, empty)).rejects.toMatchObject({ code: 'UNIT_REFERENCE_INVALID' })
    await expect(autonomy.ensureUnit({ id: 'nobody', role: 'owner' }, UNIT)).rejects.toMatchObject({ code: 'TENANT_REQUIRED' })
  })
})
