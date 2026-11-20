/**
 * O8B · an activation is a separate decision with its own evidence.
 */
import { describe, expect, it } from 'vitest'
import { validateRuleActivation, type RuleActivation } from '../src/index.ts'

const RECORD: RuleActivation = {
  ruleId: 'rule-1',
  ruleVersion: 3,
  spaceId: 'space-eguisa',
  mailbox: '506@muitowork.com',
  actionType: 'mail.label',
  window: { from: '2026-11-01T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' },
  authorizationId: 'AUTH-RULE-ACTIVATION-1',
  scope: 'space-eguisa · 506@muitowork.com · mail.label',
  validUntil: '2026-12-31T00:00:00.000Z',
  volume: { maxRuns: 50 },
  recovery: 'quitar la etiqueta con el mismo id de mensaje',
  suspension: 'desactivar la regla desde el panel; surte efecto en la siguiente ejecución',
  evidence: { realRuns: 12, approvalShare: 0.83, technicalFailures: 1 },
  approvedBy: 'ceo@muitowork.com',
  approvedAt: '2026-11-20T10:00:00.000Z',
}

describe('O8B rule activation', () => {
  it('accepts a complete activation with productive evidence', () => {
    expect(validateRuleActivation(RECORD)).toEqual({ ok: true, issues: [] })
  })

  it('refuses an incomplete record', () => {
    const check = validateRuleActivation({ ...RECORD, recovery: '', authorizationId: '' })
    expect(check.ok).toBe(false)
    expect(check.issues.some(issue => issue.startsWith('SCHEMA:recovery'))).toBe(true)
    expect(check.issues.some(issue => issue.startsWith('SCHEMA:authorizationId'))).toBe(true)
  })

  it('refuses an S4 action and evidence below the thresholds', () => {
    const s4 = validateRuleActivation({ ...RECORD, actionType: 'mail.send' })
    expect(s4.issues).toContain('S4_NOT_ACTIVATABLE:mail.send')
    const thin = validateRuleActivation({
      ...RECORD,
      evidence: { realRuns: 9, approvalShare: 0.6, technicalFailures: 0 },
    })
    expect(thin.ok).toBe(false)
    expect(thin.issues).toEqual([
      'REAL_RUNS_BELOW_MINIMUM:9/10',
      'APPROVAL_SHARE_BELOW_MINIMUM:0.60/0.7',
    ])
  })

  it('refuses an authorization that expires before it is approved', () => {
    const check = validateRuleActivation({ ...RECORD, validUntil: '2026-11-19T00:00:00.000Z' })
    expect(check.issues).toEqual(['AUTHORIZATION_ALREADY_EXPIRED'])
  })
})
