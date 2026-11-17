/**
 * O5-02A · assignment rules: an exact criterion decides, a conflict is
 * reported instead of guessed, and a revocation stops classification without
 * deleting the rule.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAssignment, { criterionMatches } from '../src/index.ts'
import type { AssignmentRuleInput } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'
const OTHER = 'otro@sondelsa.com'

/** Boot storage plus the assignment service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAssignment)
  return ctx.faberloomAssignment
}

/** A rule that sends Eguisa mail to one Space. */
function eguisa(spaceId = 'sp-eguisa'): AssignmentRuleInput {
  return { criterion: { field: 'from', operator: 'contains', value: 'eguisa' }, target: { spaceId, agentId: null } }
}

describe('O5-02A · assignment rules', () => {
  it('assigns on the exact criterion and reports every matching rule', async () => {
    const rules = await harness()
    const rule = await rules.createRule(OWNER, eguisa())

    const decision = await rules.evaluate(OWNER, { from: 'Compras@EGUISA.example', subject: 'OC 4711' })

    expect(decision.status).toBe('assigned')
    expect(decision.target).toEqual({ spaceId: 'sp-eguisa', agentId: null })
    expect(decision.matches).toEqual([{ ruleId: rule.id, version: 1, target: { spaceId: 'sp-eguisa', agentId: null } }])
    expect(decision.conflicts).toEqual([])
    expect(rule.origin).toMatchObject({ kind: 'human', by: OWNER })
    expect(rule.origin.itemId).toBeNull()
  })

  it('does not match a different field value or a missing field', async () => {
    const rules = await harness()
    await rules.createRule(OWNER, eguisa())

    expect((await rules.evaluate(OWNER, { from: 'otro@sonepar.example', subject: 'OC 4711' })).status).toBe('none')
    expect((await rules.evaluate(OWNER, { subject: 'OC 4711' })).status).toBe('none')
    expect(criterionMatches({ field: 'subject', operator: 'startsWith', value: 'OC' }, { subject: 'OC 4711' })).toBe(true)
    expect(criterionMatches({ field: 'subject', operator: 'equals', value: 'OC' }, { subject: 'OC 4711' })).toBe(false)
  })

  it('keeps the decision assigned when two rules name the same target', async () => {
    const rules = await harness()
    const first = await rules.createRule(OWNER, eguisa())
    const second = await rules.createRule(OWNER, {
      criterion: { field: 'subject', operator: 'startsWith', value: 'OC' },
      target: { spaceId: 'sp-eguisa', agentId: null },
    })

    const decision = await rules.evaluate(OWNER, { from: 'compras@eguisa.example', subject: 'OC 4711' })

    expect(decision.status).toBe('assigned')
    expect(decision.matches.map(match => match.ruleId).sort()).toEqual([first.id, second.id].sort())
    expect(decision.conflicts).toEqual([])
  })

  it('reports a conflict instead of picking a side or widening the scope', async () => {
    const rules = await harness()
    await rules.createRule(OWNER, eguisa('sp-eguisa'))
    await rules.createRule(OWNER, {
      criterion: { field: 'subject', operator: 'contains', value: '4711' },
      target: { spaceId: 'sp-sonepar', agentId: null },
    })

    const decision = await rules.evaluate(OWNER, { from: 'compras@eguisa.example', subject: 'OC 4711' })

    expect(decision.status).toBe('conflict')
    expect(decision.target).toBeNull()
    expect(decision.conflicts).toEqual([
      { spaceId: 'sp-eguisa', agentId: null },
      { spaceId: 'sp-sonepar', agentId: null },
    ])
  })

  it('stops classifying after a revocation and keeps the rule listed', async () => {
    const rules = await harness()
    const rule = await rules.createRule(OWNER, eguisa())

    const revoked = await rules.revokeRule(OWNER, rule.id)
    expect(revoked.revokedAt).not.toBeNull()
    expect(revoked.version).toBe(2)
    expect((await rules.evaluate(OWNER, { from: 'compras@eguisa.example' })).status).toBe('none')
    expect((await rules.listRules(OWNER)).map(entry => entry.id)).toEqual([rule.id])
    // Revoking twice is idempotent, not a second transition.
    expect((await rules.revokeRule(OWNER, rule.id)).version).toBe(2)
  })

  it('bumps the version on edit and decides with the new criterion', async () => {
    const rules = await harness()
    const rule = await rules.createRule(OWNER, eguisa())

    const updated = await rules.updateRule(OWNER, rule.id, {
      criterion: { field: 'from', operator: 'contains', value: 'sonepar' },
    })

    expect(updated.version).toBe(2)
    expect(updated.origin).toEqual(rule.origin)
    expect((await rules.evaluate(OWNER, { from: 'compras@eguisa.example' })).status).toBe('none')
    expect((await rules.evaluate(OWNER, { from: 'compras@sonepar.example' })).status).toBe('assigned')
  })

  it('refuses an empty criterion, an empty target, and another owner', async () => {
    const rules = await harness()

    await expect(rules.createRule(OWNER, { criterion: { field: 'from', operator: 'contains', value: '  ' }, target: { spaceId: 'sp-a', agentId: null } }))
      .rejects.toThrow('needs a value')
    await expect(rules.createRule(OWNER, { criterion: { field: 'from', operator: 'contains', value: 'x' }, target: { spaceId: null, agentId: null } }))
      .rejects.toThrow('needs a space or an agent')

    const rule = await rules.createRule(OWNER, eguisa())
    await expect(rules.updateRule(OTHER, rule.id, { target: { spaceId: 'sp-x', agentId: null } }))
      .rejects.toThrow('only the owner')
    await expect(rules.revokeRule(OTHER, rule.id)).rejects.toThrow('only the owner')
  })

  it('decides without writing: evaluating leaves versions and revocation untouched', async () => {
    const rules = await harness()
    const rule = await rules.createRule(OWNER, eguisa())
    await rules.evaluate(OWNER, { from: 'compras@eguisa.example' })
    await rules.evaluate(OWNER, { from: 'compras@eguisa.example' })

    const [after] = await rules.listRules(OWNER)
    expect(after?.version).toBe(rule.version)
    expect(after?.revokedAt).toBeNull()
  })
})
