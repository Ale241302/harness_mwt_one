/**
 * O8B · the S3 executor refuses S4, enforces the bounded authorization, records
 * one run per action, and undoes the effect on failure or on a suspension that
 * arrives while it runs.
 */
import { describe, expect, it, vi } from 'vitest'
import { S3Executor, type S3Action, type S3Authorization } from '../src/index.ts'

/** One action with its spies kept apart, so assertions never reference an interface method. */
function action(overrides: { run?: () => Promise<{ ref: string }> } = {}) {
  const run = vi.fn(overrides.run ?? (async () => ({ ref: 'label-1' })))
  const undo = vi.fn(async () => {})
  const value: S3Action = {
    id: 'run-1',
    ruleId: 'rule-1',
    ruleVersion: 3,
    description: 'Etiquetar la factura como revisada',
    run,
    undo,
  }
  return { value, run, undo }
}

const AUTH: S3Authorization = {
  id: 'AUTH-RULE-ACTIVATION-1',
  ruleId: 'rule-1',
  ruleVersion: 3,
  scope: 'space-eguisa · 506@muitowork.com · mail.label',
  expiresAt: '2026-12-31T00:00:00.000Z',
  maxRuns: 10,
  usedRuns: 0,
}

/** Executor over a ledger and a suspension switch the test moves. */
function executor(options: { suspended?: () => boolean; s4?: string[]; seen?: Set<string> } = {}) {
  const seen = options.seen ?? new Set<string>()
  return new S3Executor({
    suspended: options.suspended ?? (() => false),
    isS4: actionType => (options.s4 ?? ['mail.send', 'mwt.write', 'inventory.reserve']).includes(actionType),
    record: async (actionId) => {
      if (seen.has(actionId)) return false
      seen.add(actionId)
      return true
    },
    now: () => new Date('2026-11-20T10:00:00.000Z'),
  })
}

describe('O8B S3 executor', () => {
  it('runs one reversible action inside its authorization', async () => {
    const { value, run, undo } = action()
    const result = await executor().run(value, 'mail.label', AUTH)
    expect(result).toEqual({ status: 'done', ref: 'label-1' })
    expect(run).toHaveBeenCalledOnce()
    expect(undo).not.toHaveBeenCalled()
  })

  it('never runs an S4 action alone, even with an authorization', async () => {
    const { value, run } = action()
    const result = await executor().run(value, 'mail.send', AUTH)
    expect(result).toEqual({ status: 'refused', reason: 'S4_BLOCKED' })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses while the rules are globally suspended', async () => {
    const { value, run } = action()
    const result = await executor({ suspended: () => true }).run(value, 'mail.label', AUTH)
    expect(result).toEqual({ status: 'refused', reason: 'SUSPENDED' })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an expired authorization, a spent budget and another rule version', async () => {
    const { value, run } = action()
    const executorInstance = executor()
    await expect(executorInstance.run(value, 'mail.label', { ...AUTH, expiresAt: '2026-11-01T00:00:00.000Z' }))
      .resolves.toEqual({ status: 'refused', reason: 'AUTHORIZATION_EXPIRED' })
    await expect(executorInstance.run(value, 'mail.label', { ...AUTH, usedRuns: 10 }))
      .resolves.toEqual({ status: 'refused', reason: 'RUN_LIMIT_REACHED' })
    await expect(executorInstance.run(value, 'mail.label', { ...AUTH, ruleVersion: 4 }))
      .resolves.toEqual({ status: 'refused', reason: 'SCOPE_MISMATCH' })
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps one run per action id', async () => {
    const { value, run } = action()
    const executorInstance = executor({ seen: new Set<string>() })
    expect((await executorInstance.run(value, 'mail.label', AUTH)).status).toBe('done')
    expect(await executorInstance.run(value, 'mail.label', AUTH)).toEqual({ status: 'refused', reason: 'DUPLICATE' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('undoes the effect when the action fails', async () => {
    const { value, undo } = action({ run: async () => { throw new Error('destino caído') } })
    const result = await executor().run(value, 'mail.label', AUTH)
    expect(result).toEqual({ status: 'reverted', reason: 'EXECUTION_FAILED:destino caído' })
    expect(undo).toHaveBeenCalledOnce()
  })

  it('undoes the effect when a suspension arrives while it runs', async () => {
    let suspended = false
    const { value, undo } = action({
      run: async () => {
        suspended = true
        return { ref: 'label-1' }
      },
    })
    const result = await executor({ suspended: () => suspended }).run(value, 'mail.label', AUTH)
    expect(result).toEqual({ status: 'reverted', reason: 'SUSPENDED_DURING_RUN' })
    expect(undo).toHaveBeenCalledOnce()
  })
})
