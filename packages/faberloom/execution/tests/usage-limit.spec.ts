/**
 * The dispatcher's daily ceiling: it stops starting work by itself, keeps the
 * count across a restart, writes the state where the gateway reads it, and
 * leaves one durable notice instead of an email.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput } from '../../routines/src/index.ts'
import FaberLoomExecutions from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  delete process.env['DSH_HOME']
})

/** Boot routines plus the dispatcher with a daily ceiling over a temporary home. */
async function harness(maxRunsPerDay: number) {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-usage-'))
  homes.push(home)
  process.env['DSH_HOME'] = home
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('step', () => 'ok')
  await ctx.plugin(FaberLoomExecutions, { ownerId: OWNER, enabled: false, intervalMs: 60_000, maxRunsPerDay })
  const published: unknown[] = []
  ctx.provide('faberloomNotices', { publish: async (notice: unknown) => { published.push(notice) } } as never)
  return { ctx, routines: ctx.faberloomRoutines, dispatcher: ctx.faberloomExecutions, published, home }
}

/** An active routine that matches once per local minute. */
async function minuteRoutine(routines: Context['faberloomRoutines'], name: string) {
  const definition: RoutineDefinitionInput = {
    intent: 'procesar el caso',
    triggers: [{ kind: 'recurrence', match: '* * * * *' }],
    steps: [{ id: 's1', instruction: 'haz el trabajo', handler: 'step' }],
    expectedResult: 'resultado',
    permissions: ['mwt'],
    failurePolicy: 'stop',
  }
  const routine = await routines.createRoutine(OWNER, { name, definition })
  await routines.activateRoutine(OWNER, routine.id)
  return routine
}

describe('daily execution limit', () => {
  it('stops starting work once the ceiling is spent and leaves one notice', async () => {
    const { routines, dispatcher, published, home } = await harness(2)
    await minuteRoutine(routines, 'Informe por minuto')

    const first = await dispatcher.runOnce(new Date('2026-11-24T10:00:10.000Z'))
    expect(first.skipped).toBeNull()
    expect(first.started).toHaveLength(1)

    const second = await dispatcher.runOnce(new Date('2026-11-24T10:01:10.000Z'))
    expect(second.started).toHaveLength(1)

    const stopped = await dispatcher.runOnce(new Date('2026-11-24T10:02:10.000Z'))
    expect(stopped.skipped).toBe('daily execution limit reached (2/2)')
    expect(stopped.started).toEqual([])
    expect(published).toHaveLength(1)
    expect((published[0] as { kind: string }).kind).toBe('usage-limit')

    const metrics = JSON.parse(readFileSync(join(home, 'faberloom-metrics.json'), 'utf8')) as {
      usage: { day: string; runs: number; maxRunsPerDay: number; atLimit: boolean }
      denominators: { autonomyRuns: number }
    }
    expect(metrics.usage).toEqual({ day: '2026-11-24', runs: 2, maxRunsPerDay: 2, atLimit: true })
    expect(metrics.denominators.autonomyRuns).toBe(2)
  })

  it('persists the count for the day and resets on the next day', async () => {
    const { routines, dispatcher, home } = await harness(1)
    await minuteRoutine(routines, 'Informe por minuto')
    await dispatcher.runOnce(new Date('2026-11-24T10:00:10.000Z'))

    expect(JSON.parse(readFileSync(join(home, 'faberloom-usage.json'), 'utf8')))
      .toEqual({ day: '2026-11-24', runs: 1 })

    const stopped = await dispatcher.runOnce(new Date('2026-11-24T10:05:10.000Z'))
    expect(stopped.skipped).toBe('daily execution limit reached (1/1)')

    const nextDay = await dispatcher.runOnce(new Date('2026-11-25T00:01:10.000Z'))
    expect(nextDay.skipped).toBeNull()
    expect(dispatcher.usageState(new Date('2026-11-25T00:01:10.000Z')))
      .toEqual({ day: '2026-11-25', runs: 1, maxRunsPerDay: 1, atLimit: true })
  })

  it('does not limit a pass when no ceiling is configured', async () => {
    const { routines, dispatcher, published } = await harness(0)
    await minuteRoutine(routines, 'Informe por minuto')
    for (const minute of [0, 1, 2, 3]) {
      const pass = await dispatcher.runOnce(new Date(`2026-11-24T10:0${String(minute)}:10.000Z`))
      expect(pass.skipped).toBeNull()
    }
    expect(published).toHaveLength(0)
    expect(dispatcher.usageState(new Date('2026-11-24T10:03:10.000Z')).atLimit).toBe(false)
  })
})
