import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput, RoutineStepInput, RoutineTriggerInput } from '../../routines/src/index.ts'
import FaberLoomExecutions, { localParts, MIN_INTERVAL_MS, parseCron, parseInterval } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot storage, the domain, and the routines engine over one owner pool. */
async function bootRoutines(pool = new MemoryMediaPool(), waitTimeoutMs?: number) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines, waitTimeoutMs === undefined ? {} : { waitTimeoutMs })
  ctx.faberloomRoutines.registerHandler('step', () => 'ok')
  ctx.faberloomRoutines.registerHandler('parar', () => 'ok')
  return { ctx, routines: ctx.faberloomRoutines, pool }
}

/** Boot the routines engine plus the dispatcher. */
async function harness(
  config: {
    readonly enabled?: boolean
    readonly intervalMs?: number
    readonly ownerId?: string
    readonly waitTimeoutMs?: number
  } = {},
  pool = new MemoryMediaPool(),
) {
  const { ctx, routines } = await bootRoutines(pool, config.waitTimeoutMs)
  await ctx.plugin(FaberLoomExecutions, {
    ownerId: config.ownerId ?? OWNER,
    enabled: config.enabled ?? false,
    intervalMs: config.intervalMs ?? 60_000,
  })
  return { ctx, routines, dispatcher: ctx.faberloomExecutions, pool }
}

/** Build a definition from steps and triggers. */
function definition(steps: RoutineStepInput[], triggers: RoutineTriggerInput[] = []): RoutineDefinitionInput {
  return { intent: 'procesar el caso', triggers, steps, expectedResult: 'resultado', permissions: ['mwt'], failurePolicy: 'stop' }
}

/** Create an active routine with the given triggers and one step. */
async function activeRoutine(routines: Context['faberloomRoutines'], name: string, triggers: RoutineTriggerInput[], steps: RoutineStepInput[] = [{ id: 's1', instruction: 'haz el trabajo', handler: 'step' }]) {
  const routine = await routines.createRoutine(OWNER, { name, definition: definition(steps, triggers) })
  await routines.activateRoutine(OWNER, routine.id)
  return routine
}

describe('FaberLoomExecutions dispatcher', () => {
  it('F22 — starts a due date routine once, and never twice for the same instant', async () => {
    const { routines, dispatcher } = await harness()
    const at = new Date('2026-09-18T10:00:00.000Z')
    const routine = await activeRoutine(routines, 'Informe diario', [{ kind: 'date', match: at.toISOString() }])

    const first = await dispatcher.runOnce(new Date('2026-09-18T10:00:30.000Z'))
    expect(first.skipped).toBeNull()
    expect(first.started).toEqual([`${String(routine.id)}:date:${String(routine.id)}:${at.toISOString()}`])
    expect(await routines.listExecutions()).toHaveLength(1)

    const second = await dispatcher.runOnce(new Date('2026-09-18T11:00:00.000Z'))
    expect(second.started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(1)
  })

  it('F22 — a further instant of the same routine starts its own run', async () => {
    const { routines, dispatcher } = await harness()
    const routine = await activeRoutine(routines, 'Informe puntual', [{ kind: 'date', match: '2026-09-18T10:00:00.000Z' }])
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:00:01.000Z'))).started).toHaveLength(1)
    await routines.updateRoutine(OWNER, routine.id, {
      name: 'Informe puntual',
      definition: definition([{ id: 's1', instruction: 'haz el trabajo', handler: 'step' }], [{ kind: 'date', match: '2026-09-18T10:05:00.000Z' }]),
    })
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:05:01.000Z'))).started).toHaveLength(1)
    expect(await routines.listExecutions()).toHaveLength(2)
  })

  it('F22 — a recurrence runs once per slot and again in the next one', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Seguimiento', [{ kind: 'recurrence', match: 'every:15' }])
    const base = Date.parse('2026-09-18T10:00:00.000Z')

    expect((await dispatcher.runOnce(new Date(base + 60_000))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date(base + 5 * 60_000))).started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(1)

    expect((await dispatcher.runOnce(new Date(base + 16 * 60_000))).started).toHaveLength(1)
    expect(await routines.listExecutions()).toHaveLength(2)
  })

  it('F22 — skips what is not due, not active, or not a schedulable trigger', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Futuro', [{ kind: 'date', match: '2030-01-01T00:00:00.000Z' }])
    const draft = await routines.createRoutine(OWNER, { name: 'Borrador', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }], [{ kind: 'date', match: '2026-09-18T09:00:00.000Z' }]) })
    await activeRoutine(routines, 'Correo', [{ kind: 'email', match: 'orden de compra' }])
    await activeRoutine(routines, 'Manual', [{ kind: 'manual' }])

    const pass = await dispatcher.runOnce(new Date('2026-09-18T12:00:00.000Z'))
    expect(pass.started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(0)
    expect(draft.status).toBe('draft')
  })

  it('F22 — reports an unusable recurrence match once and keeps working', async () => {
    const { ctx, routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Cadencia rota', [{ kind: 'recurrence', match: 'todos los lunes' }])
    await activeRoutine(routines, 'Cadencia buena', [{ kind: 'recurrence', match: '30m' }])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    expect((await dispatcher.runOnce(new Date('2026-09-18T12:00:00.000Z'))).started).toHaveLength(1)
    await dispatcher.runOnce(new Date('2026-09-18T12:10:00.000Z'))
    expect(warn.mock.calls.filter(call => String(call[0]).includes('todos los lunes'))).toHaveLength(1)
    expect(await routines.listExecutions()).toHaveLength(1)
    warn.mockRestore()
  })

  it('F22 — a second pass, or a second process, never starts the same occurrence twice', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({}, pool)
    const routine = await activeRoutine(first.routines, 'Seguimiento', [{ kind: 'recurrence', match: 'every:15' }])
    const at = new Date('2026-09-18T10:01:00.000Z')
    expect((await first.dispatcher.runOnce(at)).started).toHaveLength(1)

    const second = await harness({}, pool)
    const pass = await second.dispatcher.runOnce(new Date('2026-09-18T10:02:00.000Z'))
    expect(pass.started).toEqual([])
    expect(await second.routines.listExecutions()).toHaveLength(1)
    expect(await second.routines.listRoutines(OWNER)).toHaveLength(1)
    expect(String((await second.routines.listRoutines(OWNER))[0]?.id)).toBe(String(routine.id))
  })

  it('F22 — one pass at a time: a pass that cannot take the lock reports it', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Seguimiento', [{ kind: 'recurrence', match: 'every:15' }])
    expect(routines.acquireLock()).toBe(true)
    const pass = await dispatcher.runOnce(new Date('2026-09-18T10:01:00.000Z'))
    expect(pass).toMatchObject({ skipped: 'another pass is running', started: [] })
    expect(await routines.listExecutions()).toHaveLength(0)
    routines.releaseLock()
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:01:00.000Z'))).started).toHaveLength(1)
  })

  it('F22 — a parked execution stays parked and one timer per owner is a configurable choice', async () => {
    const { routines, dispatcher } = await harness({ enabled: true, intervalMs: MIN_INTERVAL_MS })
    await activeRoutine(routines, 'Espera', [{ kind: 'date', match: '2026-09-18T09:00:00.000Z' }], [
      { id: 's1', instruction: 'haz el trabajo', handler: 'step' },
      { id: 's2', instruction: 'espera la respuesta', handler: 'parar', dependsOn: ['s1'], waitFor: 'respuesta del cliente' },
    ])
    const pass = await dispatcher.runOnce(new Date('2026-09-18T12:00:00.000Z'))
    expect(pass.started).toHaveLength(1)
    expect(pass.advanced).toEqual([])
    const [execution] = await routines.listExecutions()
    expect(execution?.status).toBe('waiting')
    expect(execution?.waitingFor).toBe('respuesta del cliente')
  })

  it('F11 — a pass expires a wait nobody answered and reports it', async () => {
    const { routines, dispatcher } = await harness({ waitTimeoutMs: 60_000 })
    await activeRoutine(routines, 'Espera con plazo', [{ kind: 'manual' }], [
      { id: 's1', instruction: 'pide la confirmacion', handler: 'step', waitFor: 'confirmacion' },
    ])
    const started = await routines.startExecution({ routineId: (await routines.listRoutines(OWNER))[0]!.id, idempotencyKey: 'caso-plazo', channel: 'manual' })
    expect(started.execution.status).toBe('waiting')

    const early = await dispatcher.runOnce(new Date(Date.parse(String(started.execution.deadlineAt)) - 1))
    expect(early.expired).toEqual([])
    expect((await routines.getExecution(started.execution.id)).status).toBe('waiting')

    const late = await dispatcher.runOnce(new Date(Date.parse(String(started.execution.deadlineAt)) + 1))
    expect(late.expired).toEqual([String(started.execution.id)])
    expect(await routines.getExecution(started.execution.id)).toMatchObject({ status: 'needs_review', reason: 'WAIT_TIMEOUT' })
  })

  it('F22 — an empty owner or a malformed interval is refused where it can be seen', async () => {
    expect(parseInterval('every:15')).toBe(15 * 60_000)
    expect(parseInterval('every:12h')).toBe(12 * 3_600_000)
    expect(parseInterval('every:90m')).toBe(90 * 60_000)
    expect(parseInterval('every:2d')).toBe(2 * 86_400_000)
    expect(parseInterval('30m')).toBe(30 * 60_000)
    expect(parseInterval('2h')).toBe(2 * 3_600_000)
    expect(parseInterval('1d')).toBe(24 * 3_600_000)
    expect(parseInterval('every:0')).toBeNull()
    expect(parseInterval('every:999999')).toBeNull()
    expect(parseInterval('todos los lunes')).toBeNull()
    expect(parseInterval(null)).toBeNull()

    const bad = await bootRoutines()
    const failure = await bad.ctx.plugin(FaberLoomExecutions, { ownerId: OWNER, intervalMs: 10 })
      .then(() => null, (error: unknown) => String(error))
    expect(failure).toContain('intervalMs')

    const noOwner = await harness({ ownerId: '' })
    expect(await noOwner.dispatcher.runOnce()).toMatchObject({ skipped: 'no owner configured', started: [] })
  })

  it('F6 — an every:12h flow starts exactly once per slot and survives a restart', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({}, pool)
    await activeRoutine(first.routines, 'Correo 12h', [{ kind: 'recurrence', match: 'every:12h' }])

    expect((await first.dispatcher.runOnce(new Date('2026-09-18T01:00:00.000Z'))).started).toHaveLength(1)
    expect((await first.dispatcher.runOnce(new Date('2026-09-18T11:00:00.000Z'))).started).toEqual([])
    expect(await first.routines.listExecutions()).toHaveLength(1)

    // A fresh process over the same pool replays the same slot: no second run.
    const second = await harness({}, pool)
    expect((await second.dispatcher.runOnce(new Date('2026-09-18T05:30:00.000Z'))).started).toEqual([])
    expect(await second.routines.listExecutions()).toHaveLength(1)

    // The next 12h slot starts its own run.
    expect((await second.dispatcher.runOnce(new Date('2026-09-18T13:00:00.000Z'))).started).toHaveLength(1)
    expect(await second.routines.listExecutions()).toHaveLength(2)
  })

  it('F6 — a basic cron fires once at its local minute and again the next day', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Diario 7:00', [{ kind: 'recurrence', match: '0 7 * * *' }])

    expect((await dispatcher.runOnce(new Date('2026-09-18T07:00:20.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-18T07:00:50.000Z'))).started).toEqual([])
    expect((await dispatcher.runOnce(new Date('2026-09-18T07:01:00.000Z'))).started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(1)

    expect((await dispatcher.runOnce(new Date('2026-09-19T07:00:00.000Z'))).started).toHaveLength(1)
    expect(await routines.listExecutions()).toHaveLength(2)
  })

  it('F6 — a timezone window keeps a cadence inside its local hours', async () => {
    const { routines, dispatcher } = await harness()
    // Europe/Madrid is UTC+2 in September: 09:00-11:00 local is 07:00-09:00Z.
    await activeRoutine(routines, 'Ventana', [{ kind: 'recurrence', match: 'every:1h', timezone: 'Europe/Madrid', window: { from: 9, to: 11 } }])

    expect((await dispatcher.runOnce(new Date('2026-09-18T07:30:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-18T11:30:00.000Z'))).started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(1)
  })

  it('F6 — the business-day skip drops the local weekend', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Laborable', [{ kind: 'recurrence', match: 'every:1h', timezone: 'UTC', businessDays: true }])

    // 2026-09-19 is a Saturday; 2026-09-18 is a Friday.
    expect((await dispatcher.runOnce(new Date('2026-09-19T10:00:00.000Z'))).started).toEqual([])
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))).started).toHaveLength(1)
  })

  it('F6 — an invalid timezone is reported and skipped, like a bad cadence', async () => {
    const { ctx, routines, dispatcher } = await harness()
    await activeRoutine(routines, 'TZ rota', [{ kind: 'recurrence', match: 'every:1h', timezone: 'Mars/Olympus' }])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))).started).toEqual([])
    expect(warn.mock.calls.some(call => String(call[0]).includes('timezone:Mars/Olympus'))).toBe(true)
    warn.mockRestore()
  })

  it('F6 — a routine at its concurrency cap skips the next slot until a run finishes', async () => {
    const { routines, dispatcher } = await harness()
    const routine = await routines.createRoutine(OWNER, {
      name: 'Limitada',
      definition: {
        ...definition([{ id: 's1', instruction: 'espera', handler: 'parar', waitFor: 'respuesta' }], [{ kind: 'recurrence', match: 'every:1h' }]),
        maxConcurrency: 1,
      },
    })
    await routines.activateRoutine(OWNER, routine.id)

    expect((await dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))).started).toHaveLength(1)
    expect((await routines.listExecutions())[0]?.status).toBe('waiting')
    // The next slot arrives while the first run is still waiting: the cap holds.
    expect((await dispatcher.runOnce(new Date('2026-09-18T11:00:00.000Z'))).started).toEqual([])
    expect(await routines.listExecutions()).toHaveLength(1)
  })

  it('F6 — refuses a routine whose concurrency cap is not a positive integer', async () => {
    const { routines } = await harness()
    const routine = await routines.createRoutine(OWNER, {
      name: 'Mala',
      definition: { ...definition([{ id: 's1', instruction: 'x', handler: 'step' }]), maxConcurrency: 0 },
    })
    await expect(routines.activateRoutine(OWNER, routine.id)).rejects.toThrow('BAD_MAX_CONCURRENCY')
  })

  it('F6 — parses basic cron fields and rejects a malformed expression', () => {
    const cron = parseCron('30 8,18 1 12 1-5')
    expect(cron?.minute.values.has(30)).toBe(true)
    expect(cron?.hour.values.has(18)).toBe(true)
    expect(cron?.dayOfMonth.values.has(1)).toBe(true)
    expect(cron?.dayOfWeek.values.has(3)).toBe(true)
    expect(parseCron('* * * * *')?.minute.any).toBe(true)
    expect(parseCron('0 7')).toBeNull()
    expect(parseCron('99 7 * * *')).toBeNull()
    expect(parseCron('0 24 * * *')).toBeNull()
    expect(parseCron('10-5 * * * *')).toBeNull()
    expect(parseCron('0 0 0 * *')).toBeNull()
    expect(parseCron('0 0 32 * *')).toBeNull()
    expect(parseCron('0 * * * 8')).toBeNull()
    expect(parseCron('a * * * *')).toBeNull()
    expect(parseCron(null)).toBeNull()
  })

  it('F6 — resolves an instant into local wall-clock fields', () => {
    expect(localParts(new Date('2026-09-18T07:30:00.000Z'), null))
      .toEqual({ year: 2026, month: 9, day: 18, hour: 7, minute: 30, weekday: 5 })
    expect(localParts(new Date('2026-09-18T07:30:00.000Z'), 'Europe/Madrid')).toMatchObject({ hour: 9, weekday: 5 })
    expect(localParts(new Date('2026-09-20T00:00:00.000Z'), null)).toMatchObject({ hour: 0, weekday: 0 })
  })

  it('F6 — a cron restricted to a weekday runs only on that weekday', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Lunes a viernes', [{ kind: 'recurrence', match: '0 7 * * 1-5' }])
    expect((await dispatcher.runOnce(new Date('2026-09-18T07:00:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-18T08:00:00.000Z'))).started).toEqual([])
    expect((await dispatcher.runOnce(new Date('2026-09-20T07:00:00.000Z'))).started).toEqual([])
  })

  it('F6 — a cron restricted to a day of month runs only on that day', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Día 1', [{ kind: 'recurrence', match: '0 0 1 * *' }])
    expect((await dispatcher.runOnce(new Date('2026-09-01T00:00:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-02T00:00:00.000Z'))).started).toEqual([])
  })

  it('F6 — a cron restricted to both day and weekday matches either, and a month filter gates it', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Uno o martes', [{ kind: 'recurrence', match: '0 0 1 * 2' }])
    // 2026-09-01 is a Tuesday (both match); 2026-09-08 is a Tuesday (weekday only).
    expect((await dispatcher.runOnce(new Date('2026-09-01T00:00:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-08T00:00:00.000Z'))).started).toHaveLength(1)
    // 2026-09-09 is a Wednesday, day 9: neither matches.
    expect((await dispatcher.runOnce(new Date('2026-09-09T00:00:00.000Z'))).started).toEqual([])
  })

  it('F6 — a cron month filter skips the other months', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Diciembre', [{ kind: 'recurrence', match: '0 0 1 12 *' }])
    expect((await dispatcher.runOnce(new Date('2026-09-01T00:00:00.000Z'))).started).toEqual([])
    expect((await dispatcher.runOnce(new Date('2026-12-01T00:00:00.000Z'))).started).toHaveLength(1)
  })

  it('F6 — an hour window that crosses midnight keeps its inside hours', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Nocturna', [{ kind: 'recurrence', match: 'every:1h', window: { from: 22, to: 6 } }])
    expect((await dispatcher.runOnce(new Date('2026-09-18T23:00:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-18T12:00:00.000Z'))).started).toEqual([])
  })

  it('F6 — an allowed-weekday list drops the other weekdays', async () => {
    const { routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Solo lunes', [{ kind: 'recurrence', match: 'every:1h', days: [1] }])
    // 2026-09-21 is a Monday; 2026-09-18 is a Friday.
    expect((await dispatcher.runOnce(new Date('2026-09-21T10:00:00.000Z'))).started).toHaveLength(1)
    expect((await dispatcher.runOnce(new Date('2026-09-18T10:00:00.000Z'))).started).toEqual([])
  })

  it('F6 — a malformed cron is reported like a malformed interval', async () => {
    const { ctx, routines, dispatcher } = await harness()
    await activeRoutine(routines, 'Cron rota', [{ kind: 'recurrence', match: '99 7 * * *' }])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    expect((await dispatcher.runOnce(new Date('2026-09-18T07:00:00.000Z'))).started).toEqual([])
    expect(warn.mock.calls.some(call => String(call[0]).includes('99 7 * * *'))).toBe(true)
    warn.mockRestore()
  })
})
