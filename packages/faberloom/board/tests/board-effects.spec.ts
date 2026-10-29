/**
 * E15 execution: the signed effect identity, the per-tenant reservation, the
 * outbox consumer, the reversal window, reconciliation, and the administrative
 * close. Every case names the acceptance criterion it proves and the case of
 * `CONTRATO_EFECTOS_MESA.md` §6 it covers.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ACTOR_A,
  ACTOR_A2,
  ACTOR_B,
  COMPANY_A,
  COMPANY_B,
  bootBoard,
  durableRows,
  rawBoardItem,
  seedRawEffectRow,
  seedRawItem,
  type BoardHarness,
} from './helpers/harness.ts'
import {
  effectKeyOf,
  normaliseDestination,
  type BoardActor,
  type BoardCheckFn,
  type BoardEffectAdapter,
  type BoardEffectDispatch,
  type BoardEffectExecution,
  type BoardEffectResult,
  type FaberLoomBoard,
  type FaberLoomBoardItem,
} from '../src/index.ts'
import type { EffectOutboxRecord, EffectReservationRecord } from '../src/spec.ts'

/** An adapter whose answer the test changes between attempts. */
interface MutableAdapter {
  /** Every dispatch the board handed over, in order. */
  readonly calls: BoardEffectDispatch[]
  /** The answer the next attempt returns. */
  response: BoardEffectResult
  /** The port itself. */
  readonly port: BoardEffectAdapter
}

/**
 * An adapter that records its calls and answers with `response`.
 * @param options - whether the destination dedupes a repeated key.
 * @returns the mutable adapter.
 */
function mutableAdapter(options: { readonly idempotent?: boolean } = {}): MutableAdapter {
  const calls: BoardEffectDispatch[] = []
  const mutable: MutableAdapter = {
    calls,
    response: { status: 'CONFIRMADO' },
    port: {
      idempotent: options.idempotent ?? false,
      async send(dispatch: BoardEffectDispatch): Promise<BoardEffectResult> {
        calls.push(dispatch)
        return mutable.response
      },
    },
  }
  return mutable
}

/**
 * Mount one effect adapter on the booted board, the way a deployment mounts it
 * from `ctx.effect`.
 * @param harness - the booted board.
 * @param actionType - action type the adapter emits.
 * @param adapter - the port.
 */
function mountAdapter(harness: BoardHarness, actionType: string, adapter: BoardEffectAdapter): void {
  harness.ctx.effect(
    () => harness.board.registerEffectAdapter(actionType, adapter),
    `test.adapter.${actionType}`,
  )
}

/**
 * Replace the proforma price control with one the test flips. The declared
 * control is blocking, so a failure makes approval or dispatch refuse.
 * @param harness - the booted board.
 * @param state - the flag the control reads.
 */
function mountPriceControl(harness: BoardHarness, state: { fail: boolean }): void {
  const check: BoardCheckFn = () => ({
    status: state.fail ? 'fail' : 'ok',
    source: 'test.price',
    sourceVersion: '1',
    checkedAt: new Date().toISOString(),
    fields: ['lines[0].unitPrice'],
    reason: state.fail ? 'PRICE_MISMATCH' : null,
  })
  harness.ctx.effect(
    () => harness.board.registerCheck('proforma', 'proforma.price', check, { class: 'bloqueante' }),
    'test.check.price',
  )
}

/** Wait for the server clock to pass a short window. */
async function settle(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Create one approvable item with a business identity. */
async function effectItem(
  harness: BoardHarness,
  options: {
    readonly businessKey?: string
    readonly summary?: string
    readonly evidence?: readonly string[]
    readonly actor?: BoardActor
  } = {},
): Promise<FaberLoomBoardItem> {
  const actor = options.actor ?? ACTOR_A
  const created = await harness.board.create(actor, {
    title: 'Respuesta a Eguisa',
    summary: options.summary ?? 'Respuesta al cliente con la proforma adjunta',
    evidence: [...(options.evidence ?? ['mail:thread-1'])],
    artifactType: 'proforma',
    businessKey: options.businessKey ?? 'mail-eguisa-1',
  })
  return await harness.board.setSeverity(actor, created.id, 'MEDIUM', 'HUMAN')
}

/** Accept one execution over the item as it is now. */
async function accept(
  board: FaberLoomBoard,
  item: FaberLoomBoardItem,
  options: {
    readonly executionId?: string
    readonly actionType?: string
    readonly destination?: string
    readonly authorization?: string
    readonly idempotencyKey?: string
  } = {},
  actor: BoardActor = ACTOR_A,
): Promise<BoardEffectExecution> {
  return await board.approveWithExecution(actor, item.id, {
    expectedRowVersion: item.rowVersion,
    expectedArtifactVersion: item.version,
    expectedArtifactHash: item.artifactHash ?? '',
    executionId: options.executionId ?? 'exec-1',
    actionType: options.actionType ?? 'mail.send',
    destination: options.destination ?? 'A@Eguisa.com, b@eguisa.com',
    authorization: options.authorization ?? 'grant:mail.send',
    ...options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey },
  })
}

/** The effect key the signed formula produces for one item and destination. */
function keyOf(
  item: FaberLoomBoardItem,
  actionType = 'mail.send',
  destination = 'a@eguisa.com,b@eguisa.com',
): string {
  return effectKeyOf({
    tenantId: companyOf(item),
    actionType,
    destination,
    businessKey: item.businessKey ?? '',
    artifactHash: item.artifactHash ?? '',
  })
}

/** The tenant one item carries. */
function companyOf(item: FaberLoomBoardItem): string | null {
  return item.companyId
}

/** Every stored reservation row of the board's medium. */
function reservationRows(harness: BoardHarness): EffectReservationRecord[] {
  return [...durableRows(harness.pool, 'effect_reservations').values()] as EffectReservationRecord[]
}

/** Every stored outbox row of the board's medium. */
function messageRows(harness: BoardHarness): EffectOutboxRecord[] {
  return [...durableRows(harness.pool, 'effect_outbox').values()] as EffectOutboxRecord[]
}

/** The stored reservation of one effect, or undefined. */
function reservationOfKey(harness: BoardHarness, effectKey: string): EffectReservationRecord | undefined {
  return reservationRows(harness).find(row => row.effectKey === effectKey)
}

/** The stored message of one effect, or undefined. */
function messageOfKey(harness: BoardHarness, effectKey: string): EffectOutboxRecord | undefined {
  return messageRows(harness).find(row => row.effectKey === effectKey)
}

describe('FaberLoomBoard E15 effect identity', () => {
  it('hashes the signed formula and normalises a recipient list', () => {
    const destination = normaliseDestination('mail.send', ' B@Eguisa.com, a@eguisa.com ,a@eguisa.com;')
    expect(destination).toBe('a@eguisa.com,b@eguisa.com')
    expect(normaliseDestination('inventory.reserve', ' MWT-WH-1 ')).toBe('MWT-WH-1')

    const identity = {
      tenantId: 'co-sondel',
      actionType: 'mail.send',
      destination,
      businessKey: 'PF 2520-2026',
      artifactHash: 'hash-1',
    }
    const expected = createHash('sha256')
      .update('co-sondel:mail.send:a@eguisa.com,b@eguisa.com:PF 2520-2026:hash-1')
      .digest('hex')
    expect(effectKeyOf(identity)).toBe(expected)
    expect(effectKeyOf({ ...identity, tenantId: 'co-sonepar' })).not.toBe(expected)
    expect(effectKeyOf({ ...identity, artifactHash: 'hash-2' })).not.toBe(expected)
    expect(effectKeyOf({
      ...identity,
      destination: normaliseDestination('mail.send', 'a@eguisa.com,b@eguisa.com'),
    })).toBe(expected)
  })

  it('refuses an acceptance that cannot name the effect', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const created = await harness.board.create(ACTOR_A, {
      title: 'Correo sin identidad de negocio',
      summary: 'Correo sin identidad de negocio',
      evidence: ['mail:thread-1'],
      artifactType: 'proforma',
    })
    const withoutKey = await harness.board.setSeverity(ACTOR_A, created.id, 'MEDIUM', 'HUMAN')
    await expect(harness.board.approveWithExecution(ACTOR_A, withoutKey.id, {
      expectedRowVersion: withoutKey.rowVersion,
      expectedArtifactVersion: withoutKey.version,
      expectedArtifactHash: withoutKey.artifactHash ?? '',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: 'a@eguisa.com',
    })).rejects.toThrow('EFFECT_IDENTITY_INCOMPLETE')
    const item = await effectItem(harness, { businessKey: 'bk-1' })
    await expect(harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: '',
      actionType: 'mail.send',
      destination: 'a@eguisa.com',
    })).rejects.toThrow('EFFECT_IDENTITY_INCOMPLETE')
    await expect(harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: '   ',
    })).rejects.toThrow('EFFECT_IDENTITY_INCOMPLETE')
  })
})

describe('FaberLoomBoard E15 reservation', () => {
  it('W-96 / case 1: two concurrent approvals of one effect produce one reservation', async () => {
    const harness = await bootBoard()
    mountAdapter(harness, 'mail.send', mutableAdapter().port)
    const first = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    const second = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    expect(second.artifactHash).toBe(first.artifactHash)

    const outcomes = await Promise.allSettled([
      accept(harness.board, first, { executionId: 'exec-1' }),
      accept(harness.board, second, { executionId: 'exec-2' }),
    ])
    const rejected = outcomes.filter(entry => entry.status === 'rejected')
    expect(outcomes.filter(entry => entry.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain('EFFECT_TAKEN')
    expect(durableRows(harness.pool, 'effect_reservations').size).toBe(1)
    expect(durableRows(harness.pool, 'effect_outbox').size).toBe(1)

    const winner = outcomes[0]?.status === 'fulfilled'
      ? outcomes[0].value
      : (outcomes[1] as PromiseFulfilledResult<BoardEffectExecution>).value
    const loser = winner.item.id === first.id ? second : first
    const loserItem = await harness.board.get(ACTOR_A, loser.id)
    expect(loserItem.state).toBe('PENDIENTE_CRITERIO')
    expect(loserItem.effectKey).toBeNull()
  })

  it('W-84 / case 2: the owner retry keeps the key, the reservation, and the idempotency key', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'inventory.reserve', adapter.port)
    adapter.response = { status: 'FALLIDO', detail: 'warehouse refused' }

    const item = await effectItem(harness, { businessKey: 'oc-505288' })
    const accepted = await accept(harness.board, item, {
      actionType: 'inventory.reserve',
      destination: 'mwt-warehouse-1',
    })
    const key = accepted.item.effectKey ?? ''
    expect(key).toBe(keyOf(item, 'inventory.reserve', 'mwt-warehouse-1'))
    expect(accepted.item).toMatchObject({ state: 'EJECUCION_PENDIENTE', reversalDeadline: null })
    expect(accepted.reservation).toMatchObject({ status: 'RESERVADA', executionId: 'exec-1' })
    expect(accepted.message).toMatchObject({ status: 'PENDIENTE', dispatchable: true })

    const emitted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'FALLIDO' })
    const failed = await harness.board.get(ACTOR_A, item.id)
    expect(failed).toMatchObject({ state: 'ERROR_RECUPERABLE', executionOutcome: 'FALLIDO' })

    adapter.response = { status: 'CONFIRMADO', ref: 'wh-9' }
    const retried = await harness.board.retry(ACTOR_A, item.id)
    expect(retried.state).toBe('EJECUCION_PENDIENTE')
    expect(retried.executionId).toBe('exec-1')
    const status = await harness.board.effectStatus(ACTOR_A, item.id)
    expect(status?.reservation).toMatchObject({
      effectKey: key, status: 'RESERVADA', executionId: 'exec-1', idempotencyKey: `effect:${key}`,
    })
    expect(status?.message).toMatchObject({ effectKey: key, status: 'PENDIENTE', dispatchable: true })

    const confirmed = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(confirmed).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect(adapter.calls.map(call => call.idempotencyKey)).toEqual([`effect:${key}`, `effect:${key}`])
    expect(adapter.calls.map(call => call.executionId)).toEqual(['exec-1', 'exec-1'])
    expect(adapter.calls.map(call => call.attempt)).toEqual([1, 2])
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('EJECUTADO')
  })

  it('W-84 / case 3: a new artifact version has its own key and the old effect stays blocked', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 60_000 } } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)

    const first = await effectItem(harness, { businessKey: 'pf-2520' })
    const acceptedFirst = await accept(harness.board, first, { executionId: 'exec-a' })
    expect(acceptedFirst.item.state).toBe('DELEGADO_EN_VENTANA')

    const next = await effectItem(harness, { businessKey: 'pf-2520', summary: 'Proforma corregida' })
    expect(next.artifactHash).not.toBe(first.artifactHash)
    const acceptedNext = await accept(harness.board, next, { executionId: 'exec-b' })
    expect(acceptedNext.item.effectKey).not.toBe(acceptedFirst.item.effectKey)
    expect(acceptedNext.reservation.status).toBe('RESERVADA')

    const echo = await effectItem(harness, { businessKey: 'pf-2520' })
    expect(echo.artifactHash).toBe(first.artifactHash)
    await expect(accept(harness.board, echo, { executionId: 'exec-c' })).rejects.toThrow('EFFECT_TAKEN')
    expect(durableRows(harness.pool, 'effect_reservations').size).toBe(2)
    expect(adapter.calls).toHaveLength(0)
  })

  it('W-96 / case 9: two tenants with the same business keep independent reservations', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)

    const mine = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    const theirs = await effectItem(harness, { businessKey: 'mail-eguisa-1', actor: ACTOR_B })
    expect(theirs.artifactHash).toBe(mine.artifactHash)
    expect(theirs.companyId).toBe(COMPANY_B)

    const acceptedMine = await accept(harness.board, mine, { executionId: 'exec-a' })
    const acceptedTheirs = await accept(harness.board, theirs, { executionId: 'exec-b' }, ACTOR_B)
    expect(acceptedMine.item.effectKey).not.toBe(acceptedTheirs.item.effectKey)
    expect(durableRows(harness.pool, 'effect_reservations').size).toBe(2)

    const pendingMine = await harness.board.pendingEffects(ACTOR_A)
    expect(pendingMine.map(message => message.effectKey)).toEqual([acceptedMine.item.effectKey])
    const pendingTheirs = await harness.board.pendingEffects(ACTOR_B)
    expect(pendingTheirs.map(message => message.effectKey)).toEqual([acceptedTheirs.item.effectKey])
    await expect(harness.board.dispatchEffect(ACTOR_B, acceptedMine.item.effectKey ?? ''))
      .rejects.toThrow('NOT_FOUND')

    const emitted = await harness.board.dispatchEffect(ACTOR_B, acceptedTheirs.item.effectKey ?? '')
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect((await harness.board.get(ACTOR_A, mine.id)).state).toBe('EJECUCION_PENDIENTE')
    expect((await harness.board.get(ACTOR_B, theirs.id)).state).toBe('EJECUTADO')
  })
})

describe('FaberLoomBoard E15 reversal window', () => {
  it('W-17: a delegated item without a reversal deadline is refused', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({
      state: 'DELEGADO_EN_VENTANA',
      reversalDeadline: null,
      effectKey: 'delegated-without-deadline',
    }))
    const harness = await bootBoard({ pool })
    await expect(harness.board.revert(ACTOR_A, id)).rejects.toThrow('EFFECT_NO_DEADLINE')
    await expect(harness.board.expireWindow(ACTOR_A, id)).rejects.toThrow('EFFECT_NO_DEADLINE')
    expect((await harness.board.get(ACTOR_A, id)).state).toBe('DELEGADO_EN_VENTANA')
  })

  it('W-19 / case 4: no effect leaves before the deadline, and a revert cancels it', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 200 } } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''
    expect(accepted.item.state).toBe('DELEGADO_EN_VENTANA')
    expect(accepted.item.reversalDeadline).not.toBeNull()

    const blocked = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(blocked).toMatchObject({ dispatched: false, code: 'WINDOW_OPEN' })
    expect(adapter.calls).toHaveLength(0)
    expect((await harness.board.pendingEffects(ACTOR_A)).map(message => message.status)).toEqual(['PENDIENTE'])

    await settle(240)
    const emitted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect(adapter.calls).toHaveLength(1)
    const served = await harness.board.get(ACTOR_A, item.id)
    expect(served.state).toBe('EJECUTADO')
    expect(served.events.filter(event => event.command === 'window.expired')).toHaveLength(1)
  })

  it('W-18 / case 4: a revert inside the window guarantees no effect', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 60_000 } } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''

    const reverted = await harness.board.revert(ACTOR_A, item.id, { reason: 'cliente canceló' })
    expect(reverted).toMatchObject({
      state: 'PENDIENTE_CRITERIO', effectKey: null, reversalDeadline: null,
    })
    expect(reservationOfKey(harness, key)).toMatchObject({ status: 'LIBERADA', releaseReason: 'reverted' })
    expect(messageOfKey(harness, key)).toMatchObject({ status: 'CANCELADO', dispatchable: false })

    const attempted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(attempted).toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
    expect(adapter.calls).toHaveLength(0)
    expect(reverted.events.at(-1)).toMatchObject({ command: 'revert', reason: 'cliente canceló' })
  })

  it('W-18 / case 5: a revert after the deadline is refused and exactly one transition happens', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 60 } } })
    const item = await effectItem(harness)
    await accept(harness.board, item)
    await settle(90)

    await expect(harness.board.revert(ACTOR_A, item.id)).rejects.toThrow('WINDOW_EXPIRED')
    const outcomes = await Promise.allSettled([
      harness.board.revert(ACTOR_A, item.id),
      harness.board.expireWindow(ACTOR_A, item.id),
    ])
    expect(outcomes.filter(entry => entry.status === 'fulfilled')).toHaveLength(1)
    const expired = await harness.board.get(ACTOR_A, item.id)
    expect(expired.state).toBe('EJECUCION_PENDIENTE')
    expect(expired.events.filter(event => event.command === 'window.expired')).toHaveLength(1)
    expect(expired.events.filter(event => event.command === 'revert')).toHaveLength(0)
  })

  it('W-56: substituting a delegated item cancels its scheduled execution', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 60_000 } } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, { businessKey: 'pf-2520' })
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''

    const replacement = await harness.board.submit(ACTOR_A, {
      runId: 'run-2',
      idempotencyKey: 'idem-2',
      businessKey: 'pf-2520',
      title: 'Proforma corregida',
      summary: 'Proforma corregida',
      evidence: ['oc:505288', 'fx:USD'],
      artifactType: 'proforma',
    })
    expect(replacement.id).not.toBe(item.id)
    expect(replacement.supersedesItemId).toBe(item.id)
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('SUSTITUIDO')

    const status = await harness.board.effectStatus(ACTOR_A, item.id)
    expect(status?.reservation?.status).toBe('LIBERADA')
    expect(status?.message?.status).toBe('CANCELADO')
    const attempted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(attempted).toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
    expect(adapter.calls).toHaveLength(0)
  })
})

describe('FaberLoomBoard E15 outbox consumer', () => {
  it('W-95 / case 6: a failed revalidation releases the effect and accepts a new approval', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const control = { fail: false }
    mountPriceControl(harness, control)
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)

    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''
    expect((await harness.board.revalidateEffect(ACTOR_A, item.id)).ok).toBe(true)
    control.fail = true

    const refused = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(refused).toMatchObject({ dispatched: false, code: 'REVALIDATION_FAILED' })
    expect(adapter.calls).toHaveLength(0)
    const after = await harness.board.get(ACTOR_A, item.id)
    expect(after).toMatchObject({ state: 'PENDIENTE_CRITERIO', effectKey: null })
    expect(reservationOfKey(harness, key)).toMatchObject({
      status: 'LIBERADA', releaseReason: 'revalidation-failed',
    })
    expect(messageOfKey(harness, key)).toMatchObject({ status: 'CANCELADO', reason: 'REVALIDATION_FAILED' })

    control.fail = false
    const again = await accept(harness.board, after)
    expect(again.item.effectKey).toBe(key)
    expect(again.reservation.status).toBe('RESERVADA')
    expect(again.message.status).toBe('PENDIENTE')
    const emitted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('EJECUTADO')
  })

  it('W-102 / case 7: a released reservation is never emitted by the consumer', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: { 'mail.send': 60_000 } } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)

    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''
    await harness.board.revert(ACTOR_A, item.id)

    expect(reservationOfKey(harness, key)?.status).toBe('LIBERADA')
    expect(messageOfKey(harness, key)).toMatchObject({ status: 'CANCELADO', dispatchable: false })
    expect(await harness.board.pendingEffects(ACTOR_A)).toHaveLength(0)

    const first = await harness.board.dispatchEffect(ACTOR_A, key)
    const replay = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(first).toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
    expect(replay).toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
    expect(adapter.calls).toHaveLength(0)
  })

  it('W-102: a failed revalidation racing the consumer never emits', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const control = { fail: false }
    mountPriceControl(harness, control)
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)

    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''
    control.fail = true

    await Promise.allSettled([
      harness.board.dispatchEffect(ACTOR_A, key),
      harness.board.revalidateEffect(ACTOR_A, item.id),
    ])
    expect(adapter.calls).toHaveLength(0)
    expect(reservationOfKey(harness, key)?.status).toBe('LIBERADA')
    expect(messageOfKey(harness, key)).toMatchObject({ status: 'CANCELADO', dispatchable: false })
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('refuses an unknown result after the dispatch timeout and when no adapter is mounted', async () => {
    const harness = await bootBoard({
      board: { effectReversalWindowMs: {}, effectDispatchTimeoutMs: 15 },
    })
    const hanging: BoardEffectAdapter = {
      idempotent: false,
      async send(): Promise<BoardEffectResult> {
        await settle(80)
        return { status: 'CONFIRMADO' }
      },
    }
    mountAdapter(harness, 'mail.send', hanging)
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const emitted = await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'DESCONOCIDO' })
    expect((await harness.board.get(ACTOR_A, item.id)).state).toBe('DESCONOCIDO')
    expect((await harness.board.effectStatus(ACTOR_A, item.id))?.message)
      .toMatchObject({ status: 'DESPACHADO', reason: 'OUTCOME_UNKNOWN', dispatchable: false })

    const other = await effectItem(harness, { businessKey: 'mail-eguisa-2' })
    const acceptedOther = await accept(harness.board, other, {
      executionId: 'exec-2',
      actionType: 'shipment.create',
      destination: 'mwt-ship-1',
    })
    const noAdapter = await harness.board.dispatchEffect(ACTOR_A, acceptedOther.item.effectKey ?? '')
    expect(noAdapter).toMatchObject({ dispatched: false, code: 'EFFECT_NO_ADAPTER' })
    expect((await harness.board.effectStatus(ACTOR_A, other.id))?.message?.status).toBe('PENDIENTE')
  })
})

describe('FaberLoomBoard E15 reconciliation and administrative close', () => {
  it('W-21: retrying an unknown outcome needs an idempotent destination', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'DESCONOCIDO', detail: 'gateway timeout' }
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    const key = accepted.item.effectKey ?? ''
    await harness.board.dispatchEffect(ACTOR_A, key)

    await expect(harness.board.retry(ACTOR_A, item.id)).rejects.toThrow('OUTCOME_UNKNOWN')
    const reconciled = await harness.board.reconcile(ACTOR_A, item.id, {
      outcome: 'FALLIDO',
      detail: 'the gateway rejected it',
    })
    expect(reconciled).toMatchObject({ state: 'ERROR_RECUPERABLE', executionOutcome: 'FALLIDO' })
    const retried = await harness.board.retry(ACTOR_A, item.id)
    expect(retried).toMatchObject({ state: 'EJECUCION_PENDIENTE', executionOutcome: null })
    expect((await harness.board.effectStatus(ACTOR_A, item.id))?.reservation)
      .toMatchObject({ effectKey: key, status: 'RESERVADA', executionId: 'exec-1' })

    const tolerant = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const idempotent = mutableAdapter({ idempotent: true })
    mountAdapter(tolerant, 'mail.send', idempotent.port)
    idempotent.response = { status: 'DESCONOCIDO' }
    const other = await effectItem(tolerant)
    const otherAccepted = await accept(tolerant.board, other)
    await tolerant.board.dispatchEffect(ACTOR_A, otherAccepted.item.effectKey ?? '')
    const otherRetried = await tolerant.board.retry(ACTOR_A, other.id)
    expect(otherRetried.state).toBe('EJECUCION_PENDIENTE')
  })

  it('W-76: an unknown outcome blocks correction, discard, and substitution', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'DESCONOCIDO' }
    const item = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    const accepted = await accept(harness.board, item)
    await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    const unknown = await harness.board.get(ACTOR_A, item.id)
    expect(unknown.state).toBe('DESCONOCIDO')

    await expect(harness.board.submitRevision(ACTOR_A, item.id, {
      summary: 'corregido', evidence: ['mail:thread-1'],
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: unknown.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('NO_ACCESS')

    const candidate = await harness.board.submit(ACTOR_A, {
      runId: 'run-2',
      idempotencyKey: 'idem-2',
      businessKey: 'mail-eguisa-1',
      title: 'Correo corregido',
      summary: 'Correo corregido',
      evidence: ['mail:thread-2'],
      artifactType: 'proforma',
    })
    expect(candidate.id).toBe(item.id)
    expect(candidate.state).toBe('DESCONOCIDO')
    expect(candidate.pendingCandidate).not.toBeNull()

    const reconciled = await harness.board.reconcile(ACTOR_A, item.id, {
      outcome: 'DESCONOCIDO',
      detail: 'the destination did not answer',
    })
    expect(reconciled.state).toBe('DESCONOCIDO')
    expect(reconciled.events.at(-1)).toMatchObject({
      command: 'effect.reconciled',
      data: { outcome: 'DESCONOCIDO', detail: 'the destination did not answer' },
    })
  })

  it('W-65 / W-85 / case 8: an administrative close keeps reconciliation open and a late confirmation alerts', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'DESCONOCIDO', detail: 'no answer' }
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    const unknown = await harness.board.get(ACTOR_A, item.id)
    expect(unknown).toMatchObject({ state: 'DESCONOCIDO', executionOutcome: 'DESCONOCIDO' })

    await expect(harness.board.adminClose(ACTOR_A2, item.id, { reason: 'destino caído' }))
      .rejects.toThrow('NO_ACCESS')
    const admin: BoardActor = { id: 'admin@sondelsa.com', companyId: COMPANY_A, role: 'admin' }
    await expect(harness.board.adminClose(admin, item.id, { reason: '   ' }))
      .rejects.toThrow('REASON_REQUIRED')
    const closed = await harness.board.adminClose(admin, item.id, { reason: 'destino caído' })
    expect(closed.item).toMatchObject({ state: 'DESCARTADO', status: 'completed' })
    expect(closed.created).toBeNull()

    const open = await harness.board.effectStatus(ACTOR_A, item.id)
    expect(open?.reservation).toMatchObject({
      status: 'DESPACHADA', closedBy: admin.id, closeReason: 'destino caído',
    })
    expect(open?.reconciliationOpen).toBe(true)
    expect(open?.message?.status).toBe('DESPACHADO')

    // A competing execution is refused while the reservation is DESPACHADA,
    // including after the administrative close (W-65, W-84).
    const competitor = await effectItem(harness)
    expect(competitor.artifactHash).toBe(item.artifactHash)
    await expect(accept(harness.board, competitor, { executionId: 'exec-competitor' }))
      .rejects.toThrow('EFFECT_TAKEN')

    const late = await harness.board.reconcile(admin, item.id, {
      outcome: 'CONFIRMADO',
      ref: 'mail-9',
      detail: 'the gateway confirmed it late',
    })
    expect(late).toMatchObject({ state: 'DESCARTADO', executionOutcome: 'CONFIRMADO' })
    expect(late.events.at(-1)).toMatchObject({ command: 'effect.late_confirmation' })
    const alerts = await harness.board.alerts(ACTOR_A)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      kind: 'LATE_CONFIRMATION',
      outcome: 'CONFIRMADO',
      itemId: item.id,
      executionId: 'exec-1',
      companyId: COMPANY_A,
    })
    const settled = await harness.board.effectStatus(ACTOR_A, item.id)
    expect(settled?.reservation?.status).toBe('CONCILIADA')
    expect(settled?.message).toMatchObject({ status: 'CONFIRMADO', ref: 'mail-9' })
    expect(settled?.reconciliationOpen).toBe(false)

    // The closed item stays closed: nothing reopens it.
    await expect(harness.board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: late.rowVersion, baseVersion: late.version, changes: { summary: 'tarde' },
    })).rejects.toThrow('NO_ACCESS')
    expect(await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? ''))
      .toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
  })

  it('refuses window, retry, reconciliation, and close commands outside their state', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness)

    await expect(harness.board.revert(ACTOR_A, item.id)).rejects.toThrow('NOT_DELEGATED')
    await expect(harness.board.expireWindow(ACTOR_A, item.id)).rejects.toThrow('NOT_DELEGATED')
    await expect(harness.board.revalidateEffect(ACTOR_A, item.id)).rejects.toThrow('NO_EFFECT')
    await expect(harness.board.retry(ACTOR_A, item.id)).rejects.toThrow('NO_EFFECT')
    await expect(harness.board.reconcile(ACTOR_A, item.id, { outcome: 'CONFIRMADO' }))
      .rejects.toThrow('NO_EFFECT')
    await expect(harness.board.adminClose(ACTOR_A, item.id, { reason: 'sin efecto' }))
      .rejects.toThrow('OUTCOME_KNOWN')
    expect(await harness.board.effectStatus(ACTOR_A, item.id)).toBeNull()
    expect(await harness.board.pendingEffects(ACTOR_A)).toHaveLength(0)
  })

  it('refuses a revert whose effect already left the reservation', async () => {
    const pool = new MemoryMediaPool()
    const id = await seedRawItem(pool, rawBoardItem({
      state: 'DELEGADO_EN_VENTANA',
      reversalDeadline: new Date(Date.now() + 60_000).toISOString(),
      effectKey: 'manual-effect',
    }))
    await seedRawEffectRow(pool, 'effect_reservations', `${COMPANY_A}:manual-effect`, {
      companyId: COMPANY_A,
      effectKey: 'manual-effect',
      actionType: 'mail.send',
      destination: 'a@eguisa.com',
      businessKey: 'mail-manual',
      artifactHash: 'hash-manual',
      executionId: 'exec-manual',
      itemId: id,
      idempotencyKey: 'effect:manual-effect',
      authorization: null,
      status: 'DESPACHADA',
      outcome: null,
      reversalDeadline: null,
      dispatchedAt: new Date().toISOString(),
      releasedAt: null,
      releaseReason: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      settledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      retainUntil: null,
    })
    const harness = await bootBoard({ pool })
    await expect(harness.board.revert(ACTOR_A, id)).rejects.toThrow('EFFECT_DISPATCHED')
  })

  it('refuses a dispatch whose item moved while its controls ran', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)

    const shifting: BoardCheckFn = async ({ item: under }) => {
      await harness.board.setSeverity(ACTOR_A, under.id, 'HIGH', 'HUMAN')
      return {
        status: 'ok', source: 'test.shifting', sourceVersion: null, checkedAt: new Date().toISOString(), fields: [],
      }
    }
    harness.ctx.effect(
      () => harness.board.registerCheck('proforma', 'proforma.price', shifting, { class: 'bloqueante' }),
      'test.check.shifting',
    )

    const refused = await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    expect(refused).toMatchObject({ dispatched: false, code: 'STALE_REVALIDATION' })
    expect(adapter.calls).toHaveLength(0)
    expect((await harness.board.effectStatus(ACTOR_A, item.id))?.message?.status).toBe('PENDIENTE')
  })

  it('W-65: an administrative close of a known outcome is refused', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'FALLIDO' }
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    await expect(harness.board.adminClose(ACTOR_A, item.id, { reason: 'no aplica' }))
      .rejects.toThrow('OUTCOME_KNOWN')
  })

  it('W-86: an administrative close turns the pending candidate into a linked item', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'DESCONOCIDO' }
    const item = await effectItem(harness, { businessKey: 'mail-eguisa-1' })
    const accepted = await accept(harness.board, item)
    await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')

    const withCandidate = await harness.board.submit(ACTOR_A, {
      runId: 'run-2',
      idempotencyKey: 'idem-2',
      businessKey: 'mail-eguisa-1',
      title: 'Correo corregido',
      summary: 'Correo corregido',
      evidence: ['mail:thread-2'],
      artifactType: 'proforma',
    })
    const candidate = withCandidate.pendingCandidate
    expect(candidate).not.toBeNull()

    const closed = await harness.board.adminClose(ACTOR_A, item.id, {
      reason: 'cierro y abro el candidato',
      expectedRowVersion: withCandidate.rowVersion,
    })
    expect(closed.item.pendingCandidate).toBeNull()
    expect(closed.created).not.toBeNull()
    const created = closed.created as FaberLoomBoardItem
    expect(created).toMatchObject({
      supersedesItemId: item.id,
      artifactHash: candidate?.hash,
      businessKey: 'mail-eguisa-1',
      companyId: COMPANY_A,
      state: 'PENDIENTE_CRITERIO',
      severity: 'MEDIUM',
    })
    expect(created.id).not.toBe(item.id)
    expect((await harness.board.get(ACTOR_A, created.id)).id).toBe(created.id)
    expect((await harness.board.list(ACTOR_A, { state: 'PENDIENTE_CRITERIO' }))
      .some(entry => entry.id === created.id)).toBe(true)
  })

  it('W-89: a confirmed reconciliation leaves the item read-only', async () => {
    const harness = await bootBoard({ board: { effectReversalWindowMs: {} } })
    const adapter = mutableAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    adapter.response = { status: 'DESCONOCIDO' }
    const item = await effectItem(harness)
    const accepted = await accept(harness.board, item)
    await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')

    const settled = await harness.board.reconcile(ACTOR_A, item.id, { outcome: 'CONFIRMADO', ref: 'mail-77' })
    expect(settled).toMatchObject({
      state: 'EJECUTADO', column: 'CERRADO', executionOutcome: 'CONFIRMADO',
    })
    await expect(harness.board.discard(ACTOR_A, item.id, {
      expectedRowVersion: settled.rowVersion, reason: 'DUPLICADO',
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.saveEdits(ACTOR_A, item.id, {
      expectedRowVersion: settled.rowVersion, baseVersion: settled.version, changes: { summary: 'tarde' },
    })).rejects.toThrow('NO_ACCESS')
    await expect(harness.board.approve(ACTOR_A, item.id, {
      expectedRowVersion: settled.rowVersion,
      expectedArtifactVersion: settled.version,
      expectedArtifactHash: settled.artifactHash ?? '',
    })).rejects.toThrow('NO_ACCESS')

    const status = await harness.board.effectStatus(ACTOR_A, item.id)
    expect(status).toMatchObject({ reconciliationOpen: false, executionOutcome: 'CONFIRMADO' })
    expect(status?.reservation?.status).toBe('CONCILIADA')
    expect(status?.message).toMatchObject({ status: 'CONFIRMADO', ref: 'mail-77' })
  })

  it('prunes settled effect records only after their retention window', async () => {
    const pool = new MemoryMediaPool()
    const settleAt = '2020-01-01T00:00:00.000Z'
    const settled: EffectReservationRecord = {
      companyId: COMPANY_A,
      effectKey: 'old-effect',
      actionType: 'mail.send',
      destination: 'a@eguisa.com',
      businessKey: 'mail-old',
      artifactHash: 'hash-old',
      executionId: 'exec-old',
      itemId: 'item-old',
      idempotencyKey: 'effect:old-effect',
      authorization: null,
      status: 'LIBERADA',
      outcome: null,
      reversalDeadline: null,
      dispatchedAt: null,
      releasedAt: settleAt,
      releaseReason: 'reverted',
      closedAt: null,
      closedBy: null,
      closeReason: null,
      settledAt: settleAt,
      createdAt: settleAt,
      updatedAt: settleAt,
      retainUntil: '2020-02-01T00:00:00.000Z',
    }
    await seedRawEffectRow(pool, 'effect_reservations', `${COMPANY_A}:old-effect`, settled)
    const harness = await bootBoard({ pool })
    expect(await harness.board.pruneEffects(ACTOR_B)).toBe(0)
    expect(await harness.board.pruneEffects(ACTOR_A)).toBe(1)
    expect(durableRows(pool, 'effect_reservations').size).toBe(0)
  })
})
