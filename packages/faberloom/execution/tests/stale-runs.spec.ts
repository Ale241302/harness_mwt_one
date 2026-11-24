/**
 * A running execution that outlives the stale timeout: the pass moves it to
 * review with `RUN_TIMEOUT`, reports it in `expiredRuns`, and leaves one durable
 * notice per routine and UTC day. No step runs again, so no effect repeats.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { FaberLoomRoutine, RoutineDefinitionInput } from '../../routines/src/index.ts'
import type { NoticeInput } from '../../notices/src/index.ts'
import FaberLoomExecutions from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'
const SIX_HOURS = 6 * 60 * 60 * 1000
const ONE_DAY = 24 * 60 * 60 * 1000

/** One manual routine whose only step blocks until the test releases it. */
const BLOCKING: RoutineDefinitionInput = {
  intent: 'procesar el caso',
  triggers: [{ kind: 'manual' }],
  steps: [{ id: 's1', instruction: 'haz el trabajo', handler: 'hang' }],
  expectedResult: 'resultado',
  permissions: ['mwt'],
  failurePolicy: 'stop',
}

/**
 * Boot storage, the routines engine with a handler that never returns, and the
 * dispatcher over a capturing notices port.
 */
async function harness(config: { readonly staleRunTimeoutMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  const calls: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  ctx.faberloomRoutines.registerHandler('hang', async () => {
    calls.push('hang')
    await gate
    return 'ok'
  })
  const routine = await ctx.faberloomRoutines.createRoutine(OWNER, { name: 'Colgada', definition: BLOCKING })
  await ctx.faberloomRoutines.activateRoutine(OWNER, routine.id)
  const published: NoticeInput[] = []
  ctx.provide('faberloomNotices', {
    publish: async (notice: NoticeInput) => { published.push(notice) },
  } as never)
  await ctx.plugin(FaberLoomExecutions, { ownerId: OWNER, enabled: false, intervalMs: 60_000, ...config })
  return { routines: ctx.faberloomRoutines, dispatcher: ctx.faberloomExecutions, routine, calls, published, release }
}

/** Start one execution and wait until its record is durably `running`. */
async function startHanging(routines: Context['faberloomRoutines'], routine: FaberLoomRoutine) {
  const pending = routines.startExecution({ routineId: routine.id, idempotencyKey: 'colgada-1', channel: 'manual' })
  await vi.waitFor(async () => {
    const [first] = await routines.listExecutions()
    expect(first?.status).toBe('running')
  })
  const [execution] = await routines.listExecutions()
  if (execution === undefined) throw new Error('the harness did not persist the execution')
  return { execution, pending }
}

describe('stale running executions', () => {
  it('moves a running execution older than the timeout to review and reports it', async () => {
    const { routines, dispatcher, routine, calls, published, release } = await harness()
    const { execution, pending } = await startHanging(routines, routine)
    const passAt = new Date(Date.parse(execution.createdAt) + SIX_HOURS + 60_000)

    const pass = await dispatcher.runOnce(passAt)
    expect(pass.expiredRuns).toEqual([String(execution.id)])
    expect(pass.expired).toEqual([])

    const expired = await routines.getExecution(execution.id)
    expect(expired).toMatchObject({ status: 'needs_review', reason: 'RUN_TIMEOUT' })
    expect(expired.steps['s1']).toMatchObject({ status: 'failed', reason: 'RUN_TIMEOUT' })

    const stale = published.filter(notice => notice.kind === 'stale-run')
    expect(stale).toHaveLength(1)
    expect(stale[0]?.dedupeKey).toBe(`stale-run:${String(routine.id)}:${passAt.toISOString().slice(0, 10)}`)
    expect(stale[0]?.source).toBe(`routine:${String(routine.id)}`)

    // The blocked handler ran once and nothing started it again.
    expect(calls).toEqual(['hang'])

    release()
    await pending
  })

  it('leaves a recent running execution alone', async () => {
    const { routines, dispatcher, routine, published, release } = await harness()
    const { execution, pending } = await startHanging(routines, routine)
    const passAt = new Date(Date.parse(execution.createdAt) + SIX_HOURS - 60_000)

    const pass = await dispatcher.runOnce(passAt)
    expect(pass.expiredRuns).toEqual([])
    expect((await routines.getExecution(execution.id)).status).toBe('running')
    expect(published.filter(notice => notice.kind === 'stale-run')).toHaveLength(0)

    release()
    await pending
  })

  it('does nothing when staleRunTimeoutMs is zero', async () => {
    const { routines, dispatcher, routine, published, release } = await harness({ staleRunTimeoutMs: 0 })
    const { execution, pending } = await startHanging(routines, routine)
    const passAt = new Date(Date.parse(execution.createdAt) + ONE_DAY)

    const pass = await dispatcher.runOnce(passAt)
    expect(pass.expiredRuns).toEqual([])
    expect((await routines.getExecution(execution.id)).status).toBe('running')
    expect(published.filter(notice => notice.kind === 'stale-run')).toHaveLength(0)

    release()
    await pending
  })

  it('a second pass neither expires the same execution again nor repeats the notice', async () => {
    const { routines, dispatcher, routine, published, release } = await harness()
    const { execution, pending } = await startHanging(routines, routine)
    const firstAt = new Date(Date.parse(execution.createdAt) + SIX_HOURS + 60_000)

    expect((await dispatcher.runOnce(firstAt)).expiredRuns).toEqual([String(execution.id)])
    expect((await dispatcher.runOnce(new Date(firstAt.getTime() + 60_000))).expiredRuns).toEqual([])

    expect(published.filter(notice => notice.kind === 'stale-run')).toHaveLength(1)
    expect((await routines.getExecution(execution.id)).status).toBe('needs_review')

    release()
    await pending
  })
})
