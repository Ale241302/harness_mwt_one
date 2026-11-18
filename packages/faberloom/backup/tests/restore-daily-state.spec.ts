import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { memoryDomainSpec } from '../../learning/src/spec.ts'
import { planDailyRestore } from '../src/restore-plan.ts'
import FaberLoomBackup from '../src/index.ts'

/** Boot the storage/domain composition plus the backup service and both domains. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const memory = await facility.open(memoryDomainSpec)
  await ctx.plugin(FaberLoomBackup)
  return { ctx, backup: ctx.faberloomBackup, memory }
}

const OWNER = 'alvaro@muitowork.com'
const NOW = '2026-11-18T10:00:00.000Z'

/** One durable teaching record, the shape the memory domain validates. */
function teaching(status: 'candidate' | 'active' | 'revoked') {
  return {
    ownerId: OWNER,
    scope: 'global' as const,
    spaceId: null,
    agentId: null,
    skill: null,
    task: null,
    text: 'Cotizar en dólares.',
    source: 'capture:email',
    author: OWNER,
    status,
    version: 1,
    supersedes: null,
    uses: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('safe daily restore plan (O5-07A)', () => {
  it('pauses routines, detaches in-flight executions, and returns lessons as proposals', () => {
    const { payload, plan } = planDailyRestore({
      faberloom_routines: {
        routines: {
          r1: { ownerId: OWNER, name: 'Correo diario', status: 'active' },
          r2: { ownerId: OWNER, name: 'Informe', status: 'paused' },
        },
        executions: {
          e1: { ownerId: OWNER, status: 'running', waitingFor: null, deadlineAt: null },
          e2: { ownerId: OWNER, status: 'waiting', waitingFor: 'correo', deadlineAt: NOW },
          e3: { ownerId: OWNER, status: 'completed', waitingFor: null, deadlineAt: null },
        },
      },
      faberloom_memory: {
        teachings: {
          t1: teaching('active'),
          t2: teaching('revoked'),
        },
      },
      faberloom_grants: {
        grants: {
          g1: { ownerId: OWNER, action: 'mail.send', revoked: false },
          g2: { ownerId: OWNER, action: 'mail.read', revoked: true },
        },
      },
      faberloom_backup: { backups: { b1: { ownerId: OWNER } } },
    })

    expect(payload['faberloom_routines']?.['routines']?.['r1']).toMatchObject({ status: 'paused' })
    expect(payload['faberloom_routines']?.['routines']?.['r2']).toMatchObject({ status: 'paused' })
    expect(payload['faberloom_routines']?.['executions']?.['e1']).toMatchObject({ status: 'needs_review' })
    expect(payload['faberloom_routines']?.['executions']?.['e2']).toMatchObject({ status: 'needs_review', waitingFor: null, deadlineAt: null })
    expect(payload['faberloom_routines']?.['executions']?.['e3']).toMatchObject({ status: 'completed' })
    expect(payload['faberloom_memory']?.['teachings']?.['t1']).toMatchObject({ status: 'candidate' })
    expect(payload['faberloom_memory']?.['teachings']?.['t2']).toMatchObject({ status: 'revoked' })
    // A restore never duplicates or replicates the copies it came from.
    expect(payload['faberloom_backup']).toBeUndefined()

    expect(plan).toMatchObject({
      degraded: true,
      mode: 'read-only-until-review',
      review: ['ROUTINES_PAUSED', 'EXECUTIONS_DETACHED', 'TEACHINGS_REQUIRE_APPROVAL', 'ACCESS_RESTORED', 'COPIES_NOT_REPLICATED'],
      counts: { routinesPaused: 1, executionsDetached: 2, teachingsProposed: 1, accessRestored: 1, copiesWithheld: 1 },
    })
    expect(plan.changes.map(change => `${change.table}:${change.key}:${change.field}`)).toEqual([
      'routines:r1:status',
      'executions:e1:status',
      'executions:e2:status',
      'teachings:t1:status',
    ])
  })

  it('leaves the captured payload untouched', () => {
    const original = { faberloom_routines: { routines: { r1: { status: 'active' } } } }
    planDailyRestore(original)
    expect(original.faberloom_routines.routines.r1.status).toBe('active')
  })

  it('restores a captured medium without reviving a routine or a lesson', async () => {
    const { backup, memory } = await harness()
    await memory.table('teachings').put('t1', teaching('active'))
    const manifest = await backup.createBackup(OWNER)
    await memory.table('teachings').put('t1', teaching('revoked'))

    const restored = await backup.restoreBackup(OWNER, manifest.id, {})
    expect(restored.plan).toMatchObject({ degraded: true, mode: 'read-only-until-review' })
    expect(restored.plan.counts.teachingsProposed).toBe(1)
    // History and identity survive; the approval does not.
    expect(memory.table('teachings').get('t1')).toMatchObject({ text: 'Cotizar en dólares.', status: 'candidate' })
  })

  it('reports the plan on a dry run without writing', async () => {
    const { backup } = await harness()
    const manifest = await backup.createBackup(OWNER)
    const dry = await backup.restoreBackup(OWNER, manifest.id, { dryRun: true })
    expect(dry.dryRun).toBe(true)
    expect(dry.plan).toMatchObject({ degraded: false, review: ['COPIES_NOT_REPLICATED'] })
    expect(dry.plan.counts.accessRestored).toBe(0)
  })
})
