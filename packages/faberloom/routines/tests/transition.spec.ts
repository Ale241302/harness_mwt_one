/**
 * O3-05 transition: routines inherited from a previous run are classified once,
 * the ones this build cannot execute truthfully are paused, and neither a
 * restart nor a second pass reactivates them or repeats the notice.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomNotices from '../../notices/src/index.ts'
import FaberLoomRoutines from '../src/index.ts'
import type { RoutineDefinitionInput, RoutineStepInput } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot storage, access, notices and routines over one pool. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomNotices)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('agent', () => 'ok')
  ctx.faberloomRoutines.registerHandler('smtp', () => 'ok')
  return { ctx, routines: ctx.faberloomRoutines, notices: ctx.faberloomNotices, pool }
}

/** A one-step definition. */
function definition(handler: string): RoutineDefinitionInput {
  const steps: RoutineStepInput[] = [{ id: 's1', instruction: 'hazlo', handler }]
  return { intent: 'x', triggers: [{ kind: 'manual' }], steps, expectedResult: '', permissions: [], failurePolicy: 'stop' }
}

describe('routine transition', () => {
  it('pauses an active routine whose step sends mail, and keeps a runnable one', async () => {
    const { routines, notices } = await harness()
    const sender = await routines.createRoutine(OWNER, { name: 'Responde solo', definition: definition('smtp') })
    await routines.activateRoutine(OWNER, sender.id)
    const reader = await routines.createRoutine(OWNER, { name: 'Lee y clasifica', definition: definition('agent') })
    await routines.activateRoutine(OWNER, reader.id)

    const report = await routines.classifyInherited()

    expect(report.scanned).toBe(2)
    expect(report.kept).toBe(1)
    expect(report.paused.map(entry => entry.name)).toEqual(['Responde solo'])
    expect((await routines.getRoutine(sender.id)).status).toBe('paused')
    expect((await routines.getRoutine(reader.id)).status).toBe('active')

    const published = await notices.list(OWNER)
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ kind: 'routine-transition' })
    expect(published[0]?.body).toContain('smtp')
  })

  it('pauses a routine whose handler this build no longer registers', async () => {
    const { routines } = await harness()
    // The handler exists when the routine is activated and disappears afterwards,
    // which is what an upgrade that drops a step kind looks like.
    const dispose = routines.registerHandler('temporal', () => 'ok')
    const routine = await routines.createRoutine(OWNER, { name: 'Handler perdido', definition: definition('temporal') })
    await routines.activateRoutine(OWNER, routine.id)
    dispose()

    const report = await routines.classifyInherited()

    expect(report.paused).toHaveLength(1)
    expect(report.paused[0]?.reason).toContain('no registra')
    expect((await routines.getRoutine(routine.id)).status).toBe('paused')
  })

  it('is idempotent across a restart and does not repeat the notice', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const routine = await first.routines.createRoutine(OWNER, { name: 'Responde solo', definition: definition('smtp') })
    await first.routines.activateRoutine(OWNER, routine.id)
    expect((await first.routines.classifyInherited()).paused).toHaveLength(1)

    // A second process over the same storage: the routine is already paused.
    const second = await harness(pool)
    const again = await second.routines.classifyInherited()
    expect(again.scanned).toBe(0)
    expect(again.paused).toHaveLength(0)
    expect((await second.routines.getRoutine(routine.id)).status).toBe('paused')
    expect(await second.notices.list(OWNER)).toHaveLength(1)
  })

  it('leaves inherited executions where they are: nothing is lost or resent', async () => {
    const { routines } = await harness()
    const routine = await routines.createRoutine(OWNER, { name: 'Responde solo', definition: definition('smtp') })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'k1', channel: 'ui' })

    await routines.classifyInherited()

    const execution = await routines.getExecution(started.execution.id)
    expect(execution).toBeDefined()
    expect(execution?.routineId).toBe(String(routine.id))
    // The execution is not deleted, and the paused routine is not wiped.
    expect((await routines.listExecutions({ routineId: routine.id })).length).toBeGreaterThan(0)
  })
})
