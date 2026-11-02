/**
 * P3 suite: the effect outbox and the N3/N4 access audit in `on` mode. The
 * outbox stays a lease queue of the process that holds the adapter, so the item
 * it touches is the only shared state: every read and every write of an item
 * goes to the Mesa, and the local SQLite copy never decides. The same suite
 * proves the access audit leaves the Mesa through a route that derives the
 * actor from the credential and keeps one event per actor and hour.
 * @module @deepseek-ai/dsh-faberloom-board/tests/remote-outbox
 */

import { describe, expect, it } from 'vitest'
import type { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { BoardItemRecord } from '../src/spec.ts'
import type {
  BoardActor,
  BoardEffectAdapter,
  BoardEffectDispatch,
  BoardEffectResult,
  BoardRemoteAdapter,
  Config as BoardConfig,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from '../src/index.ts'
import {
  ACTOR_A,
  COMPANY_A,
  OWNER_A,
  OWNER_A2,
  bootBoard,
  durableRows,
  seedProforma,
  type BoardHarness,
} from './helpers/harness.ts'

/** One access row the fake Mesa stores. */
interface FakeAccessEvent {
  readonly itemId: string
  readonly actor: string
  readonly detail: string | null
  readonly at: string
}

/** A fake Mesa that keeps the rows and the access audit the board asks for. */
interface FakeRemote {
  readonly port: BoardRemoteAdapter
  readonly calls: string[]
  readonly items: Map<string, FaberLoomBoardItem>
  readonly access: FakeAccessEvent[]
  /** Actor the per-user credential names; the board never sends one. */
  currentActor: string
}

/**
 * Build a fake Mesa. Access recording mirrors the API: the actor comes from the
 * credential and one event per actor, item, and hour survives.
 * @param options - command names that fail with a transport error.
 * @returns the port, its calls, its rows, its access audit, and the current credential.
 */
function fakeRemote(options: { failing?: readonly string[] } = {}): FakeRemote {
  const calls: string[] = []
  const items = new Map<string, FaberLoomBoardItem>()
  const access: FakeAccessEvent[] = []
  const failing = new Set(options.failing ?? [])
  const answer = (command: string, id: FaberLoomBoardItemId): FaberLoomBoardItem => {
    calls.push(command)
    if (failing.has(command)) throw new Error('socket hang up')
    const item = items.get(id)
    if (item === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} not found`)
    return item
  }
  const fake: FakeRemote = {
    currentActor: OWNER_A,
    calls,
    items,
    access,
    port: {
      async list() {
        calls.push('list')
        if (failing.has('list')) throw new Error('socket hang up')
        return [...items.values()]
      },
      async get(_actor, id) {
        return answer('get', id)
      },
      async noteAccess(_actor, id, detail) {
        calls.push('noteAccess')
        if (failing.has('noteAccess')) throw new Error('socket hang up')
        const item = items.get(id)
        if (item === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} not found`)
        const hourAgo = Date.now() - 3_600_000
        const recent = access.some(entry =>
          entry.itemId === id && entry.actor === fake.currentActor && Date.parse(entry.at) >= hourAgo)
        if (recent) return
        access.push({
          itemId: id,
          actor: fake.currentActor,
          detail: detail.length === 0 ? null : detail,
          at: new Date().toISOString(),
        })
      },
      async create(_writer, item) {
        calls.push('create')
        if (failing.has('create')) throw new Error('socket hang up')
        items.set(item.id, item)
        return item
      },
      async commit(_writer, id, input) {
        calls.push('commit')
        if (failing.has('commit')) throw new Error('socket hang up')
        items.set(id, { ...input.record })
        return { ...input.record }
      },
      async setSeverity(_writer, id) {
        return answer('setSeverity', id)
      },
      async approve(_writer, id) {
        return answer('approve', id)
      },
      async discard(_writer, id) {
        return answer('discard', id)
      },
      async saveEdits(_writer, id) {
        return answer('saveEdits', id)
      },
      async assignWorkspace(_writer, id, workspaceId: string) {
        const current = answer('assignWorkspace', id)
        const next: FaberLoomBoardItem = { ...current, spaceId: workspaceId }
        items.set(id, next)
        return { item: next, transferredDrafts: [] }
      },
      async iterate(_writer, id) {
        return { item: answer('iterate', id), status: {} as never }
      },
    },
  }
  return fake
}

/** The booted harness of one `on` deployment with a fake Mesa behind it. */
interface RemoteHarness {
  readonly harness: BoardHarness
  readonly fake: FakeRemote
}

/**
 * Boot one board in `on` mode over a fake Mesa.
 * @param board - extra board configuration (effect windows, for example).
 * @returns the harness and the fake.
 */
async function bootRemote(board: BoardConfig = {}): Promise<RemoteHarness> {
  const harness = await bootBoard({
    board: { ...board, remote: { mode: 'on', baseUrl: 'https://mesa.test', token: 'secret' } },
  })
  const fake = fakeRemote()
  harness.board.useRemote(() => fake.port)
  return { harness, fake }
}

/** The durable row of one item, as a second process would load it. */
function localRow(pool: MemoryMediaPool, id: string): BoardItemRecord | undefined {
  return durableRows(pool, 'items').get(id) as BoardItemRecord | undefined
}

/** Forget the local backup of one item, so only the Mesa keeps the row. */
function forgetLocalRow(pool: MemoryMediaPool, id: string): void {
  durableRows(pool, 'items').delete(id)
}

/** An adapter that records its calls and always confirms. */
function confirmingAdapter(): { readonly calls: BoardEffectDispatch[]; readonly port: BoardEffectAdapter } {
  const calls: BoardEffectDispatch[] = []
  return {
    calls,
    port: {
      idempotent: false,
      async send(dispatch: BoardEffectDispatch): Promise<BoardEffectResult> {
        calls.push(dispatch)
        return { status: 'CONFIRMADO', ref: 'mesa-1' }
      },
    },
  }
}

/**
 * Mount one effect adapter, the way a deployment mounts it from `ctx.effect`.
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

/** Create one item with a severity and a business identity. */
async function effectItem(harness: BoardHarness, businessKey: string): Promise<FaberLoomBoardItem> {
  const created = await harness.board.create(ACTOR_A, {
    title: 'Respuesta a Eguisa',
    summary: 'Respuesta al cliente con la proforma adjunta',
    evidence: ['mail:thread-1'],
    artifactType: 'proforma',
    businessKey,
  })
  return await harness.board.setSeverity(ACTOR_A, created.id, 'MEDIUM', 'HUMAN')
}

/** Wait for the server clock to pass a short window. */
async function settle(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('P3 access audit on the Mesa', () => {
  it('records an N3 read through the Mesa and leaves no local-only event', async () => {
    const { harness, fake } = await bootRemote()
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const restricted = await harness.board.reclassify(ACTOR_A, item.id, 'N3')
    expect(restricted.dataClass).toBe('N3')

    await harness.board.noteAccess(ACTOR_A, item.id, 'zona:N3')
    await harness.board.noteAccess(ACTOR_A, item.id, 'zona:N3')

    // El actor no viaja en la llamada: la credencial del proceso lo resuelve.
    expect(fake.access).toHaveLength(1)
    expect(fake.access[0]).toMatchObject({ itemId: item.id, actor: OWNER_A, detail: 'zona:N3' })
    // La copia local se queda con el último commit, sin el evento de acceso.
    const backup = localRow(harness.pool, item.id)
    expect(backup).toBeDefined()
    expect((backup as BoardItemRecord).events.filter(event => event.command === 'access')).toEqual([])
    // Un acceso no es un comando: la versión del ítem no se mueve.
    expect(fake.items.get(item.id)?.rowVersion).toBe((restricted as FaberLoomBoardItem).rowVersion)
  })

  it('keeps one access event per actor and hour for two users of the tenant', async () => {
    const { harness, fake } = await bootRemote()
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    await harness.board.reclassify(ACTOR_A, item.id, 'N4')
    const admin: BoardActor = { id: 'admin@sondelsa.com', companyId: COMPANY_A, role: 'admin' }

    fake.currentActor = OWNER_A
    await harness.board.noteAccess(ACTOR_A, item.id, 'zona:N4')
    await harness.board.noteAccess(ACTOR_A, item.id, 'zona:N4')
    fake.currentActor = 'admin@sondelsa.com'
    await harness.board.noteAccess(admin, item.id, 'zona:N4')

    expect(fake.access.map(entry => entry.actor).sort()).toEqual([OWNER_A, 'admin@sondelsa.com'].sort())
  })

  it('does not audit an item below N3 and refuses a reader without access', async () => {
    const { harness, fake } = await bootRemote()
    const item = await seedProforma(harness.board, OWNER_A, COMPANY_A)

    await harness.board.noteAccess(ACTOR_A, item.id, 'zona:N2')
    expect(fake.access).toEqual([])

    await harness.board.reclassify(ACTOR_A, item.id, 'N3')
    await expect(harness.board.noteAccess({ id: OWNER_A2, companyId: COMPANY_A }, item.id, 'zona:N3'))
      .rejects.toThrow(/NO_ACCESS/u)
    expect(fake.access).toEqual([])
  })
})

describe('P3 effect outbox against the Mesa', () => {
  it('dispatches an effect whose item exists only in the Mesa, exactly once', async () => {
    const { harness, fake } = await bootRemote({ effectReversalWindowMs: {} })
    const adapter = confirmingAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, 'mail-eguisa-1')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-1',
      actionType: 'mail.send',
      destination: 'A@Eguisa.com',
      authorization: 'grant:mail.send',
    })
    const key = accepted.item.effectKey ?? ''

    // El respaldo local se pierde antes del despacho; la Mesa sigue teniendo la fila.
    forgetLocalRow(harness.pool, item.id)
    expect(localRow(harness.pool, item.id)).toBeUndefined()

    const emitted = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect(fake.items.get(item.id)?.state).toBe('EJECUTADO')
    expect(adapter.calls).toHaveLength(1)

    const replay = await harness.board.dispatchEffect(ACTOR_A, key)
    expect(replay).toMatchObject({ dispatched: false, code: 'OUTBOX_NOT_PENDING' })
    expect(adapter.calls).toHaveLength(1)
  })

  it('never lets a stale local backup decide the dispatch', async () => {
    const { harness, fake } = await bootRemote({ effectReversalWindowMs: {} })
    const adapter = confirmingAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, 'mail-eguisa-2')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-2',
      actionType: 'mail.send',
      destination: 'a@eguisa.com',
      authorization: 'grant:mail.send',
    })

    // Copia local atrasada: sin efecto aceptado. La Mesa sí lo tiene.
    const backup = localRow(harness.pool, item.id) as BoardItemRecord
    durableRows(harness.pool, 'items').set(item.id, {
      ...backup,
      state: 'PENDIENTE_CRITERIO',
      effectKey: null,
      reversalDeadline: null,
    })

    const emitted = await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    expect(adapter.calls).toHaveLength(1)
    expect(fake.items.get(item.id)?.state).toBe('EJECUTADO')
  })

  it('expires the reversal window on the Mesa before emitting', async () => {
    const { harness, fake } = await bootRemote({ effectReversalWindowMs: { 'mail.send': 40 } })
    const adapter = confirmingAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, 'mail-eguisa-3')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-3',
      actionType: 'mail.send',
      destination: 'b@eguisa.com',
      authorization: 'grant:mail.send',
    })
    expect(accepted.item.state).toBe('DELEGADO_EN_VENTANA')
    forgetLocalRow(harness.pool, item.id)
    await settle(60)

    const emitted = await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    expect(emitted).toMatchObject({ dispatched: true, outcome: 'CONFIRMADO' })
    const stored = fake.items.get(item.id) as FaberLoomBoardItem
    expect(stored.state).toBe('EJECUTADO')
    expect(stored.events.filter(event => event.command === 'window.expired')).toHaveLength(1)
    // La copia local solo recibe el espejo del commit; no decide el despacho.
    expect(localRow(harness.pool, item.id)?.state).toBe('EJECUTADO')
  })

  it('emits once when two consumer calls race for the same effect', async () => {
    const { harness, fake } = await bootRemote({ effectReversalWindowMs: {} })
    const adapter = confirmingAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, 'mail-eguisa-5')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-5',
      actionType: 'mail.send',
      destination: 'd@eguisa.com',
      authorization: 'grant:mail.send',
    })
    const key = accepted.item.effectKey ?? ''

    const outcomes = await Promise.all([
      harness.board.dispatchEffect(ACTOR_A, key),
      harness.board.dispatchEffect(ACTOR_A, key),
    ])

    expect(adapter.calls).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.dispatched)).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.code === 'OUTBOX_NOT_PENDING')).toHaveLength(1)
    expect(fake.items.get(item.id)?.state).toBe('EJECUTADO')
  })

  it('does not orphan a reservation the Mesa still records', async () => {
    const { harness } = await bootRemote({ effectReversalWindowMs: {} })
    mountAdapter(harness, 'mail.send', confirmingAdapter().port)
    const item = await effectItem(harness, 'mail-eguisa-6')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-6',
      actionType: 'mail.send',
      destination: 'e@eguisa.com',
      authorization: 'grant:mail.send',
    })
    const key = accepted.item.effectKey ?? ''

    // La reserva parece huérfana para cualquiera que mire solo el respaldo.
    forgetLocalRow(harness.pool, item.id)
    const reservations = durableRows(harness.pool, 'effect_reservations')
    const held = reservations.get(`${COMPANY_A}:${key}`) as Record<string, unknown>
    reservations.set(`${COMPANY_A}:${key}`, { ...held, createdAt: '2020-01-01T00:00:00.000Z' })

    const recovery = await harness.board.recoverOrphanedReservations(ACTOR_A)
    expect(recovery.released).toEqual([])
    expect(durableRows(harness.pool, 'effect_reservations').get(`${COMPANY_A}:${key}`)).toMatchObject({
      status: 'RESERVADA',
    })
  })

  it('reports REMOTE_UNAVAILABLE instead of emitting when the Mesa read fails', async () => {
    const { harness, fake } = await bootRemote({ effectReversalWindowMs: {} })
    const adapter = confirmingAdapter()
    mountAdapter(harness, 'mail.send', adapter.port)
    const item = await effectItem(harness, 'mail-eguisa-4')
    const accepted = await harness.board.approveWithExecution(ACTOR_A, item.id, {
      expectedRowVersion: item.rowVersion,
      expectedArtifactVersion: item.version,
      expectedArtifactHash: item.artifactHash ?? '',
      executionId: 'exec-4',
      actionType: 'mail.send',
      destination: 'c@eguisa.com',
      authorization: 'grant:mail.send',
    })

    // Un ítem que la Mesa ya no tiene no se puede autorizar desde el respaldo.
    fake.items.delete(item.id)
    const outcome = await harness.board.dispatchEffect(ACTOR_A, accepted.item.effectKey ?? '')
    expect(outcome).toMatchObject({ dispatched: false, code: 'ITEM_MISSING' })
    expect(adapter.calls).toHaveLength(0)
  })
})
