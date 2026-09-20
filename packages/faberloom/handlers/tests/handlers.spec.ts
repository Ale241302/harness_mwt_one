import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomBackup from '../../backup/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput, RoutineStepInput } from '../../routines/src/index.ts'
import FaberLoomHandlers from '../src/index.ts'

/** Boot storage plus the routines service, leaving the handlers to each case. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomBackup)
  return { ctx, routines: ctx.faberloomRoutines, pool }
}

/** Build a definition from steps. */
function definition(steps: RoutineStepInput[]): RoutineDefinitionInput {
  return { intent: 'esperar la confirmacion del cliente', triggers: [], steps, expectedResult: 'confirmacion', permissions: ['mwt'], failurePolicy: 'stop' }
}

const OWNER = 'compras2@sondelsa.com'

describe('FaberLoomHandlers', () => {
  it('F14 — registers the wait handler and removes it with its own fiber', async () => {
    const { ctx, routines } = await harness()
    expect(routines.listHandlers()).not.toContain('wait')
    const fiber = await ctx.plugin(FaberLoomHandlers)
    expect(routines.listHandlers()).toContain('wait')
    await fiber.dispose()
    expect(routines.listHandlers()).not.toContain('wait')
  })

  it('F14 — parks a wait step until its event arrives, then settles it with that event', async () => {
    const { ctx, routines } = await harness()
    await ctx.plugin(FaberLoomHandlers)
    const routine = await routines.createRoutine(OWNER, {
      name: 'Confirmacion de cliente',
      definition: definition([{ id: 's1', instruction: 'esperar la confirmacion', handler: 'wait', waitFor: 'confirmacion' }]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-1', channel: 'ui' })
    expect(started.execution).toMatchObject({ status: 'waiting', waitingFor: 'confirmacion' })
    expect(started.execution.steps.s1).toMatchObject({ status: 'waiting' })

    const delayed = await routines.tick({ events: [{ key: 'otro', type: 'event', subject: 'pedido sin relacion' }] })
    expect(delayed.resumed).toEqual([])
    expect((await routines.getExecution(started.execution.id)).status).toBe('waiting')

    const resumed = await routines.tick({ events: [{ key: 'confirmacion-1', type: 'email', subject: 'Confirmacion del cliente' }] })
    expect(resumed.resumed).toEqual([started.execution.id])
    const settled = await routines.getExecution(started.execution.id)
    expect(settled).toMatchObject({ status: 'completed', waitingFor: null })
    expect(settled.steps.s1).toMatchObject({ status: 'completed', result: { handler: 'wait', matched: 'confirmacion-1' } })
  })
})
