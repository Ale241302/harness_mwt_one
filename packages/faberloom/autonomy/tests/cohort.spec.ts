/**
 * O8B · cohort evidence for one rule version.
 *
 * Only the cohort's own runs count: same rule version, space, mailbox, action
 * type and window. Fixtures and duplicates never count, technical failures are
 * reported apart from the denominator, and ten real runs at 70 % are the gate.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateCohort,
  isMaterialChange,
  MINIMUM_APPROVAL_SHARE,
  MINIMUM_REAL_RUNS,
  type AutonomyCohort,
  type AutonomyRule,
  type CohortOutcome,
} from '../src/index.ts'

const COHORT: AutonomyCohort = {
  ruleId: 'rule-1',
  ruleVersion: 3,
  spaceId: 'space-eguisa',
  mailbox: '506@muitowork.com',
  actionType: 'mail.label',
  from: '2026-11-01T00:00:00.000Z',
  until: '2026-12-01T00:00:00.000Z',
}

/** N runs at a fixed instant inside the window. */
function runs(count: number, kind: CohortOutcome['kind'], extra: Partial<CohortOutcome> = {}): CohortOutcome[] {
  return Array.from({ length: count }, (_value, index) => ({
    kind,
    at: `2026-11-${String(10 + (index % 15)).padStart(2, '0')}T10:00:00.000Z`,
    ...extra,
  }))
}

describe('O8B cohort', () => {
  it('is eligible at ten real runs and 70 % approved', () => {
    const report = evaluateCohort(COHORT, [...runs(7, 'approved'), ...runs(3, 'intervened')])
    expect(report.realRuns).toBe(MINIMUM_REAL_RUNS)
    expect(report.approvalShare).toBeCloseTo(MINIMUM_APPROVAL_SHARE)
    expect(report.eligible).toBe(true)
    expect(report.reasons).toEqual([])
  })

  it('refuses nine real runs even when every one was approved', () => {
    const report = evaluateCohort(COHORT, runs(9, 'approved'))
    expect(report.realRuns).toBe(9)
    expect(report.eligible).toBe(false)
    expect(report.reasons).toEqual(['REAL_RUNS_BELOW_MINIMUM:9/10'])
  })

  it('never counts fixtures or duplicates', () => {
    const report = evaluateCohort(COHORT, [
      ...runs(10, 'approved'),
      ...runs(3, 'approved', { fixture: true }),
      ...runs(2, 'approved', { duplicate: true }),
    ])
    expect(report.realRuns).toBe(10)
    expect(report.discarded).toBe(5)
    expect(report.eligible).toBe(true)
  })

  it('reports technical failures apart from the denominator', () => {
    const report = evaluateCohort(COHORT, [...runs(9, 'approved'), ...runs(1, 'technical-failure')])
    expect(report.realRuns).toBe(9)
    expect(report.technicalFailures).toBe(1)
    expect(report.eligible).toBe(false)
    expect(report.reasons).toEqual(['REAL_RUNS_BELOW_MINIMUM:9/10'])
  })

  it('ignores runs outside the declared window', () => {
    const outside: CohortOutcome[] = [
      { kind: 'approved', at: '2026-10-31T23:59:59.000Z' },
      { kind: 'approved', at: '2026-12-01T00:00:00.000Z' },
    ]
    const report = evaluateCohort(COHORT, [...runs(10, 'approved'), ...outside])
    expect(report.realRuns).toBe(10)
    expect(report.eligible).toBe(true)
  })

  it('restarts the cohort when the rule changes materially', () => {
    const base: AutonomyRule = {
      id: 'rule-1',
      version: 3,
      spaceId: COHORT.spaceId,
      mailbox: COHORT.mailbox,
      actionType: COHORT.actionType,
      condition: 'factura de proveedor',
      status: 'approved',
      from: COHORT.from,
      until: COHORT.until,
    }
    expect(isMaterialChange(base, { ...base, version: 4 })).toBe(true)
    expect(isMaterialChange(base, { ...base, mailbox: 'otra@muitowork.com' })).toBe(true)
    expect(isMaterialChange(base, { ...base, condition: 'factura de flete' })).toBe(true)
    expect(isMaterialChange(base, { ...base })).toBe(false)
  })
})
