import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomExecutions from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot routines + the dispatcher with a fake board and mail transport. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  const createBoard = vi.fn(async () => ({ id: 'b1' }))
  const sendMail = vi.fn(async (_ownerId: string, _message: { to: readonly string[]; subject: string; text: string }) => ({ messageId: 'm1' }))
  ctx.provide('faberloomBoard', { create: createBoard } as never)
  ctx.provide('faberloomConnections', { sendMail } as never)
  await ctx.plugin(FaberLoomExecutions, { ownerId: OWNER, enabled: false, intervalMs: 60_000 })
  return { ctx, routines: ctx.faberloomRoutines, dispatcher: ctx.faberloomExecutions, createBoard, sendMail }
}

describe('FaberLoomExecutions liveness', () => {
  it('F8 — a failure retries, then dead-letters to the board with an owner alert', async () => {
    const { routines, dispatcher, createBoard, sendMail } = await harness()
    let calls = 0
    routines.registerHandler('boom', () => { calls += 1; throw new Error('explota') })
    const routine = await routines.createRoutine(OWNER, {
      name: 'anti-spam roto',
      definition: {
        intent: 'clasificar correo',
        triggers: [{ kind: 'manual' }],
        steps: [{ id: 's1', instruction: 'clasifica', handler: 'boom', maxAttempts: 3 }],
        expectedResult: 'correo clasificado',
        permissions: [],
        failurePolicy: 'continue',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'k', channel: 'ui' })

    expect(calls).toBe(3)
    expect(started.execution.status).toBe('needs_review')
    expect(started.execution.steps['s1']?.attempts).toBe(3)
    expect(started.execution.steps['s1']?.reason).toBe('explota')

    await vi.waitFor(() => { expect(createBoard).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(sendMail).toHaveBeenCalledTimes(1) })
    expect(createBoard).toHaveBeenCalledWith(OWNER, expect.objectContaining({
      title: 'Dead letter: s1',
      summary: 'explota',
      routineId: String(routine.id),
      executionId: started.execution.id,
    }))
    expect(sendMail).toHaveBeenCalledWith(OWNER, expect.objectContaining({ to: [OWNER] }))

    const health = await dispatcher.health()
    expect(health.totals).toMatchObject({ runs: 1, needsReview: 1, retries: 2, deadLettered: 1, alerts: 1, failures: 0 })
    expect(health.routines[0]).toMatchObject({ routineId: String(routine.id), name: 'anti-spam roto', lastStatus: 'needs_review', failures: 0 })
  })

  it('F8 — a pass publishes the workflow metrics file for the gateway', async () => {
    const home = mkdtempSync(join(tmpdir(), 'faberloom-metrics-'))
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      const { dispatcher } = await harness()
      await dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))
      const raw = readFileSync(join(home, 'faberloom-metrics.json'), 'utf8')
      const metrics = JSON.parse(raw) as { ownerId: string; totals: { runs: number; alerts: number }; updatedAt: string }
      expect(metrics.ownerId).toBe(OWNER)
      expect(metrics.totals).toMatchObject({ runs: 0, alerts: 0 })
      expect(typeof metrics.updatedAt).toBe('string')
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('F8 — a wait that expires is dead-lettered and alerted too', async () => {
    const { routines, dispatcher, createBoard, sendMail } = await harness()
    routines.registerHandler('step', () => 'ok')
    const routine = await routines.createRoutine(OWNER, {
      name: 'espera',
      definition: {
        intent: 'pedir confirmación',
        triggers: [{ kind: 'manual' }],
        steps: [{ id: 's1', instruction: 'pide', handler: 'step', waitFor: 'responde' }],
        expectedResult: '',
        permissions: [],
        failurePolicy: 'continue',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'w', channel: 'ui' })
    await routines.expireWaits(new Date(Date.parse(String(started.execution.deadlineAt)) + 1))
    await vi.waitFor(() => { expect(createBoard).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(sendMail).toHaveBeenCalledTimes(1) })
    expect((await dispatcher.health()).totals.needsReview).toBe(1)
  })

  it('F8 — a step with no retries budget fails on the first error', async () => {
    const { routines, dispatcher } = await harness()
    let calls = 0
    routines.registerHandler('once', () => { calls += 1; throw new Error('una vez') })
    const routine = await routines.createRoutine(OWNER, {
      name: 'sin reintentos',
      definition: {
        intent: 'x',
        triggers: [{ kind: 'manual' }],
        steps: [{ id: 's1', instruction: 'x', handler: 'once' }],
        expectedResult: '',
        permissions: [],
        failurePolicy: 'continue',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'o', channel: 'ui' })
    expect(calls).toBe(1)
    expect(started.execution.steps['s1']?.attempts).toBe(1)
    expect((await dispatcher.health()).totals.retries).toBe(0)
  })

  it('F8 — a board or mail failure is warned, not thrown, and never loses the case', async () => {
    const { routines, dispatcher, createBoard, sendMail } = await harness()
    createBoard.mockRejectedValueOnce(new Error('board down'))
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    routines.registerHandler('boom', () => { throw new Error('explota') })
    const routine = await routines.createRoutine(OWNER, {
      name: 'sin salida',
      definition: {
        intent: 'x',
        triggers: [{ kind: 'manual' }],
        steps: [{ id: 's1', instruction: 'x', handler: 'boom' }],
        expectedResult: '',
        permissions: [],
        failurePolicy: 'continue',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'd', channel: 'ui' })
    expect(started.execution.status).toBe('needs_review')
    await vi.waitFor(() => { expect(createBoard).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(sendMail).toHaveBeenCalledTimes(1) })
    // The case is still in review; only the counters stay at zero.
    expect(await dispatcher.health()).toMatchObject({
      totals: { needsReview: 1, deadLettered: 0, alerts: 0 },
    })
  })

  it('F8 — health reports a routine that never ran', async () => {
    const { routines, dispatcher } = await harness()
    await routines.createRoutine(OWNER, {
      name: 'nunca',
      definition: { intent: '', triggers: [], steps: [], expectedResult: '', permissions: [], failurePolicy: 'stop' },
    })
    const health = await dispatcher.health()
    expect(health.routines[0]).toMatchObject({ name: 'nunca', lastStatus: null, lastAt: null, runs: 0, retries: 0, deadlineAt: null })
  })

  it('F8 — a metrics write failure is warned, not thrown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faberloom-metrics-bad-'))
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x')
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = join(blocker, 'home')
    try {
      const { dispatcher } = await harness()
      await expect(dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))).resolves.toBeDefined()
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })
})
