import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../src/index.ts'
import type { RoutineDefinitionInput, RoutineStepInput, RoutineTriggerInput } from '../src/index.ts'

/** Boot the storage/domain composition plus the routines service over one pool. */
async function harness(pool = new MemoryMediaPool(), config: { readonly waitTimeoutMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines, config)
  return { ctx, routines: ctx.faberloomRoutines, pool }
}

/** Build a definition input from steps and optional triggers. */
function definition(steps: RoutineStepInput[], triggers: RoutineTriggerInput[] = []): RoutineDefinitionInput {
  return { intent: 'procesar pedido', triggers, steps, expectedResult: 'proforma', permissions: ['mwt'], failurePolicy: 'stop' }
}

const OWNER = 'compras2@sondelsa.com'

describe('FaberLoomRoutines', () => {
  it('F04 · creates and edits a routine, keeping identity, version, and history', async () => {
    const { routines } = await harness()
    routines.registerHandler('receive', () => 'ok')
    const routine = await routines.createRoutine(OWNER, { name: 'Pedido → proforma', definition: definition([{ id: 's1', instruction: 'recibir', handler: 'receive' }]) })
    expect(routine).toMatchObject({ ownerId: OWNER, status: 'draft', version: 1, versions: [1] })
    const edited = await routines.updateRoutine(OWNER, routine.id, { name: 'Pedido → proforma v2', definition: definition([{ id: 's1', instruction: 'recibir', handler: 'receive' }, { id: 's2', instruction: 'revisar', handler: 'receive', dependsOn: ['s1'] }]) })
    expect(edited.id).toBe(routine.id)
    expect(edited).toMatchObject({ version: 2, versions: [1, 2] })
    expect((await routines.getRoutineVersion(routine.id, 1)).steps).toHaveLength(1)
    expect((await routines.listRoutines(OWNER))).toHaveLength(1)
    await expect(routines.updateRoutine('otro', routine.id, { name: 'x', definition: definition([]) })).rejects.toThrow('only the owner')
    await expect(routines.getRoutineVersion(routine.id, 9)).rejects.toThrow('not found')
  })

  it('F06 · refuses activation when a handler, dependency, or acyclic order is missing', async () => {
    const { routines } = await harness()
    const missingHandler = await routines.createRoutine(OWNER, { name: 'mh', definition: definition([{ id: 's1', instruction: 'x', handler: 'ghost' }]) })
    await expect(routines.activateRoutine(OWNER, missingHandler.id)).rejects.toThrow('MISSING_HANDLER:s1:ghost')

    routines.registerHandler('h', () => 'ok')
    const missingDep = await routines.createRoutine(OWNER, { name: 'md', definition: definition([{ id: 's1', instruction: 'x', handler: 'h', dependsOn: ['nope'] }]) })
    await expect(routines.activateRoutine(OWNER, missingDep.id)).rejects.toThrow('MISSING_DEPENDENCY:s1:nope')

    const cycle = await routines.createRoutine(OWNER, { name: 'cy', definition: definition([{ id: 'a', instruction: 'x', handler: 'h', dependsOn: ['b'] }, { id: 'b', instruction: 'y', handler: 'h', dependsOn: ['a'] }]) })
    await expect(routines.activateRoutine(OWNER, cycle.id)).rejects.toThrow('CYCLE:')

    const ok = await routines.createRoutine(OWNER, { name: 'ok', definition: definition([{ id: 's1', instruction: 'x', handler: 'h' }]) })
    expect((await routines.activateRoutine(OWNER, ok.id)).status).toBe('active')
    await expect(routines.pauseRoutine('otro', ok.id)).rejects.toThrow('only the owner')
    expect((await routines.pauseRoutine(OWNER, ok.id)).status).toBe('paused')
    await expect(routines.activateRoutine('otro', ok.id)).rejects.toThrow('only the owner')
  })

  it('F05 · an execution keeps its starting version when the routine is edited', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'r', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }, { id: 's2', instruction: 'wait', handler: 'step', dependsOn: ['s1'], waitFor: 'reply' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-5', channel: 'manual' })
    expect(started.execution).toMatchObject({ routineVersion: 1, status: 'waiting' })

    await routines.updateRoutine(OWNER, routine.id, { name: 'r2', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }, { id: 's2', instruction: 'wait', handler: 'step', dependsOn: ['s1'], waitFor: 'reply' }, { id: 's3', instruction: 'extra', handler: 'step', dependsOn: ['s2'] }]) })
    expect((await routines.getExecution(started.execution.id)).routineVersion).toBe(1)

    const plan = await routines.previewMigration(started.execution.id, 2)
    expect(plan).toMatchObject({ fromVersion: 1, toVersion: 2, preserved: ['s1'], added: ['s3'] })
    const migrated = await routines.migrate(started.execution.id, 2)
    expect(migrated.routineVersion).toBe(2)
    expect((await routines.countExecutionsAtVersion(routine.id, 2))).toBe(1)
  })

  it('F07 · the same case through two channels dedupes to one execution with both evidences', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'pedido', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }], [{ kind: 'email' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const first = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-77', channel: 'email' })
    const second = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-77', channel: 'mcp' })
    expect(first.deduped).toBe(false)
    expect(second.deduped).toBe(true)
    expect(second.execution.id).toBe(first.execution.id)
    expect(second.execution.evidence.map(entry => entry.channel)).toEqual(['email', 'mcp'])
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(1)
  })

  it('F10 · persistent state survives a restart and the dispatcher resumes the wait', async () => {
    const { routines, pool } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'seguimiento', definition: definition([{ id: 's1', instruction: 'send', handler: 'step' }, { id: 's2', instruction: 'wait', handler: 'step', dependsOn: ['s1'], waitFor: 'reply' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-10', channel: 'manual' })
    expect(started.execution.status).toBe('waiting')

    const reopened = await harness(pool)
    // Handlers are process-local: a restarted composition re-registers them.
    reopened.routines.registerHandler('step', () => 'done')
    expect((await reopened.routines.getExecution(started.execution.id)).status).toBe('waiting')
    const noMatch = await reopened.routines.tick({ events: [{ key: 'other', type: 'email' }] })
    expect(noMatch.resumed).toEqual([])
    const ticked = await reopened.routines.tick({ events: [{ key: 'reply', type: 'email', subject: 'RE: OC' }] })
    expect(ticked.resumed).toEqual([started.execution.id])
    expect((await reopened.routines.getExecution(started.execution.id)).status).toBe('completed')
  })

  it('F09 · a changed value on resume stops for review instead of applying the effect', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'precio', definition: definition([{ id: 's1', instruction: 'cotizar', handler: 'step', waitFor: 'reply', revalidateKey: 'price', revalidateExpect: '10' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-9', channel: 'manual' })
    expect(started.execution.status).toBe('waiting')
    await routines.tick({ events: [{ key: 'reply', type: 'email', data: { price: '12' } }] })
    const after = await routines.getExecution(started.execution.id)
    expect(after).toMatchObject({ status: 'needs_review', reason: 'REVALIDATION_CHANGED' })
  })

  it('F11/F12 · an uncertain effect reconciles for review and can be cancelled', async () => {
    const { ctx, routines } = await harness()
    routines.registerHandler('boom', () => { throw new Error('network down') })
    const routine = await routines.createRoutine(OWNER, { name: 'efecto', definition: definition([{ id: 's1', instruction: 'publicar', handler: 'boom', effect: true }]) })
    await routines.activateRoutine(OWNER, routine.id)
    await ctx.faberloomAccess.grant(OWNER, { action: 'mwt', context: String(routine.id) })
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-11', channel: 'manual' })
    expect(started.execution).toMatchObject({ status: 'needs_review', reason: 'EFFECT_UNCERTAIN' })
    expect((await routines.reconcile(started.execution.id)).reason).toBe('RECONCILE_REQUIRED')
    expect(await routines.cancelEffect(started.execution.id, 's1')).toBe(true)
    expect(await routines.cancelEffect(started.execution.id, 's1')).toBe(false)
  })

  it('runs a failing step without an effect as a failed execution', async () => {
    const { routines } = await harness()
    routines.registerHandler('boom', () => { throw new Error('nope') })
    const routine = await routines.createRoutine(OWNER, { name: 'fail', definition: definition([{ id: 's1', instruction: 'x', handler: 'boom' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'oc-f', channel: 'manual' })
    expect(started.execution.status).toBe('failed')
    expect((await routines.reconcile(started.execution.id)).status).toBe('failed')
  })

  it('ingests events through per-user sources with a token', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'correo', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }], [{ kind: 'email', match: 'orden de compra' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const source = await routines.registerSource(OWNER, 'email', 'buzon ventas')
    expect(source.token).toMatch(/[A-Za-z0-9_-]{20,}/)
    expect((await routines.listSources(OWNER)).map(entry => entry.id)).toEqual([source.id])

    const ignored = await routines.ingest(OWNER, { key: 'm1', type: 'email', subject: 'otra cosa' })
    expect(ignored).toEqual([])
    const started = await routines.ingestForToken(source.token, { key: 'm2', type: 'email', subject: 'Orden de Compra 123' })
    expect(started).toHaveLength(1)
    expect(started[0]?.deduped).toBe(false)
    const deduped = await routines.ingestForToken(source.token, { key: 'm2', type: 'email', subject: 'Orden de Compra 123' })
    expect(deduped[0]?.deduped).toBe(true)
    await expect(routines.ingestForToken('bad-token', { key: 'm3', type: 'email' })).rejects.toThrow('unknown source token')
    expect(await routines.removeSource('otro', source.id)).toBe(false)
    expect(await routines.removeSource(OWNER, source.id)).toBe(true)
  })

  it('F06 — removes a routine and its versions while its executions stay as history', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'borrar', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }]) })
    await routines.updateRoutine(OWNER, routine.id, { name: 'borrar v2', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }]) })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso', channel: 'manual' })

    await expect(routines.removeRoutine('otro', routine.id)).rejects.toThrow('only the owner')
    expect(await routines.removeRoutine(OWNER, routine.id)).toBe(true)
    expect(await routines.listRoutines(OWNER)).toEqual([])
    await expect(routines.getRoutine(routine.id)).rejects.toThrow('not found')
    await expect(routines.getRoutineVersion(routine.id, 1)).rejects.toThrow('not found')

    expect(await routines.getExecution(started.execution.id)).toMatchObject({ status: 'completed' })
    expect(await routines.removeRoutine(OWNER, routine.id)).toBe(false)
  })

  it('F11 — a wait carries a deadline, and a wait nobody answers needs review', async () => {
    const { routines } = await harness(new MemoryMediaPool(), { waitTimeoutMs: 60_000 })
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, {
      name: 'espera con plazo',
      definition: definition([
        { id: 's1', instruction: 'pide la confirmacion', handler: 'step', waitFor: 'confirmacion' },
      ]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-plazo', channel: 'manual' })
    const parked = started.execution
    expect(parked).toMatchObject({ status: 'waiting', waitingFor: 'confirmacion' })
    expect(parked.deadlineAt).not.toBeNull()
    expect(Date.parse(String(parked.deadlineAt)) - Date.parse(parked.updatedAt)).toBe(60_000)

    const early = await routines.expireWaits(new Date(Date.parse(String(parked.deadlineAt)) - 1))
    expect(early).toEqual([])
    expect((await routines.getExecution(parked.id)).status).toBe('waiting')

    const late = await routines.expireWaits(new Date(Date.parse(String(parked.deadlineAt)) + 1))
    expect(late).toEqual([parked.id])
    const expired = await routines.getExecution(parked.id)
    expect(expired).toMatchObject({ status: 'needs_review', reason: 'WAIT_TIMEOUT', waitingFor: null, deadlineAt: null })
    expect(expired.steps.s1).toMatchObject({ status: 'failed', reason: 'WAIT_TIMEOUT' })

    // A later pass must not expire it again.
    expect(await routines.expireWaits(new Date(Date.parse(String(parked.deadlineAt)) + 600_000))).toEqual([])
  })

  it('F12 — the reply clears the deadline and finishes the case', async () => {
    const { routines } = await harness(new MemoryMediaPool(), { waitTimeoutMs: 60_000 })
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, {
      name: 'espera resuelta',
      definition: definition([
        { id: 's1', instruction: 'pide la confirmacion', handler: 'step', waitFor: 'confirmacion' },
      ]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-resuelto', channel: 'manual' })
    expect(started.execution.deadlineAt).not.toBeNull()

    const resumed = await routines.tick({ events: [{ key: 'confirmacion-1', type: 'email', subject: 'Confirmacion' }] })
    expect(resumed.resumed).toEqual([started.execution.id])
    const done = await routines.getExecution(started.execution.id)
    expect(done).toMatchObject({ status: 'completed', waitingFor: null, deadlineAt: null })
    expect(await routines.expireWaits(new Date(Date.parse(String(started.execution.deadlineAt)) + 600_000))).toEqual([])
  })

  it('F16/F17 — an effectful step runs only under a grant, and a revocation stops the next one', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomAccess)
    await ctx.plugin(FaberLoomRoutines)
    const { faberloomRoutines: routines, faberloomAccess: access } = ctx
    let effects = 0
    routines.registerHandler('enviar', () => { effects += 1; return 'enviado' })
    const routine = await routines.createRoutine(OWNER, {
      name: 'con efecto',
      definition: {
        intent: 'enviar el documento',
        triggers: [],
        steps: [{ id: 's1', instruction: 'envia el documento', handler: 'enviar', effect: true }],
        expectedResult: 'enviado',
        permissions: ['documents.send'],
        failurePolicy: 'review',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    expect(ctx.get('faberloomAccess')).toBeDefined()

    const denied = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'sin-concesion', channel: 'manual' })
    expect(denied.execution).toMatchObject({ status: 'needs_review', reason: 'NOT_AUTHORIZED:NO_GRANT' })
    expect(denied.execution.steps.s1).toMatchObject({ status: 'failed', reason: 'NOT_AUTHORIZED:NO_GRANT' })
    expect(effects).toBe(0)

    await access.grant(OWNER, { action: 'documents.send', context: String(routine.id) })
    const allowed = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'con-concesion', channel: 'manual' })
    expect(allowed.execution.status).toBe('completed')
    expect(effects).toBe(1)

    const grants = await access.listGrants(OWNER)
    await access.revokeGrant(OWNER, grants[0]!.id)
    const revoked = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'tras-revocar', channel: 'manual' })
    expect(revoked.execution.reason).toBe('NOT_AUTHORIZED:REVOKED')
    expect(effects).toBe(1)
  })

  it('refuses to start a routine that is not active and guards the dispatcher lock', async () => {
    const { routines } = await harness()
    routines.registerHandler('step', () => 'done')
    const routine = await routines.createRoutine(OWNER, { name: 'draft', definition: definition([{ id: 's1', instruction: 'x', handler: 'step' }]) })
    await expect(routines.startExecution({ routineId: routine.id, idempotencyKey: 'x', channel: 'manual' })).rejects.toThrow('not active')
    await expect(routines.startExecution({ routineId: 'missing' as never, idempotencyKey: 'x', channel: 'manual' })).rejects.toThrow('not found')
    await expect(routines.getExecution('missing' as never)).rejects.toThrow('not found')
    await expect(routines.reconcile('missing' as never)).rejects.toThrow('not found')
    expect(routines.listHandlers()).toEqual(['step'])
    expect(routines.acquireLock()).toBe(true)
    expect(routines.acquireLock()).toBe(false)
    routines.releaseLock()
    expect(routines.acquireLock()).toBe(true)
  })
})
