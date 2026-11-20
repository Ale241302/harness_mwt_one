/**
 * O8B · integration: the real autonomy service and the S3 executor together.
 *
 * Ten real outcomes promote the unit, an authorized reversible action runs, a
 * manual supervision suspends it, and the next action is refused. This is the
 * mechanism end to end, without a browser.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAutonomy, { S3Executor, type AutonomyOutcome, type S3Action, type S3Authorization } from '../src/index.ts'

const OWNER = { id: 'ceo@muitowork.com', companyId: 'mwt', role: 'owner' }
const REF = { tenantId: 'mwt', spaceId: 'space-eguisa', agentId: 'agent-mail', actionType: 'mail.label' }

/** Ten approved closures inside the evaluation window. */
const OUTCOMES: AutonomyOutcome[] = Array.from({ length: 10 }, (_value, index) => ({
  itemId: `item-${String(index)}`,
  at: `2026-11-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
  kind: 'approved' as const,
}))

/** Boot the autonomy service over one outcome port. */
async function harness(outcomes: readonly AutonomyOutcome[]) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('faberloomAutonomyOutcomes', { readOutcomes: async () => outcomes })
  await ctx.plugin(FaberLoomAutonomy, { statisticalMinimum: 10, period: null })
  return ctx.faberloomAutonomy
}

/** One reversible action with its spies. */
function action() {
  const run = vi.fn(async () => ({ ref: 'label-1' }))
  const undo = vi.fn(async () => {})
  const value: S3Action = { id: 'run-1', ruleId: 'rule-1', ruleVersion: 1, description: 'etiquetar', run, undo }
  return { value, run, undo }
}

const AUTH: S3Authorization = {
  id: 'AUTH-RULE-ACTIVATION-1',
  ruleId: 'rule-1',
  ruleVersion: 1,
  scope: 'space-eguisa · 506@muitowork.com · mail.label',
  expiresAt: '2026-12-31T00:00:00.000Z',
  maxRuns: 10,
  usedRuns: 0,
}

describe('O8B integration', () => {
  it('promotes on ten real approvals, then refuses to act once suspended', async () => {
    const autonomy = await harness(OUTCOMES)
    await autonomy.ensureUnit(OWNER, REF)
    const promoted = await autonomy.promote(OWNER, REF)
    expect(promoted.level).toBe('DELEGADO')

    let suspended = false
    const executor = new S3Executor({
      suspended: () => suspended,
      isS4: actionType => actionType === 'mail.send' || actionType === 'mwt.write',
      record: async () => true,
      now: () => new Date('2026-11-20T10:00:00.000Z'),
    })
    const first = action()
    expect((await executor.run(first.value, 'mail.label', AUTH)).status).toBe('done')

    // A person supervises the unit; the executor stops acting.
    const supervised = await autonomy.supervise(OWNER, REF, 'revisión manual')
    expect(supervised.level).toBe('SUPERVISADO')
    suspended = true
    const second = action()
    expect(await executor.run(second.value, 'mail.label', AUTH)).toEqual({ status: 'refused', reason: 'SUSPENDED' })
    expect(second.run).not.toHaveBeenCalled()
  })

  it('refuses promotion with nine approvals', async () => {
    const autonomy = await harness(OUTCOMES.slice(0, 9))
    await autonomy.ensureUnit(OWNER, REF)
    await expect(autonomy.promote(OWNER, REF)).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
  })
})
