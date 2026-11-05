/**
 * Remote-mode suite: `off` never touches the adapter, `shadow` compares both
 * stores and reports what diverges while answering from SQLite, and `on`
 * reads and writes the remote and never falls back to local storage when the
 * remote fails.
 * @module @deepseek-ai/dsh-faberloom-board/tests/remote-mode
 */

import { describe, expect, it } from 'vitest'
import { boardRemoteConfigFromEnv } from '../src/remote-port.ts'
import type {
  BoardRemoteAdapter,
  BoardRemoteDivergence,
  BoardRemoteSettings,
} from '../src/index.ts'
import type { BoardIterationStatus, FaberLoomBoardItem, FaberLoomBoardItemId } from '../src/types.ts'
import type { BoardItemRecord } from '../src/spec.ts'
import type { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { ACTOR_A, COMPANY_A, OWNER_A, bootBoard, durableRows, seedProforma, seedSpace } from './helpers/harness.ts'

/** The attempt a fake remote answers with. */
const RUNNING: BoardIterationStatus = {
  phase: 'active',
  iterationId: 'att-remote',
  generation: 1,
  baseVersion: 1,
  lockUntil: null,
  lockBy: 'tab-remote',
  renewalSeconds: 30,
  rounds: 0,
  roundLimit: 5,
  suggestRewrite: false,
  draft: null,
  draftLinked: false,
  draftOutdated: false,
  candidatePending: false,
}

/** A remote board whose answers and calls the test controls. */
interface FakeRemote {
  readonly port: BoardRemoteAdapter
  readonly calls: string[]
  readonly items: Map<string, FaberLoomBoardItem>
  readonly accessCalls: { id: FaberLoomBoardItemId; detail: string }[]
}

/**
 * Build a fake remote.
 * @param options - command names that fail with a transport error.
 * @returns the port, the calls it received, and the rows it serves.
 */
function fakeRemote(options: { failing?: readonly string[] } = {}): FakeRemote {
  const calls: string[] = []
  const items = new Map<string, FaberLoomBoardItem>()
  const accessCalls: { id: FaberLoomBoardItemId; detail: string }[] = []
  const failing = new Set(options.failing ?? [])
  const answer = (command: string, id: FaberLoomBoardItemId): FaberLoomBoardItem => {
    calls.push(command)
    if (failing.has(command)) throw new Error('socket hang up')
    const item = items.get(id)
    if (item === undefined) throw new Error(`faberloom: NOT_FOUND â€” board item ${id} not found`)
    return item
  }
  const port: BoardRemoteAdapter = {
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
      if (!items.has(id)) throw new Error(`faberloom: NOT_FOUND — board item ${id} not found`)
      accessCalls.push({ id, detail })
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
      const next: FaberLoomBoardItem = { ...input.record }
      items.set(id, next)
      return next
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
      return { item: answer('iterate', id), status: RUNNING }
    },
  }
  return { port, calls, items, accessCalls }
}

/** The durable row of one item, as a second process would load it. */
function localRow(pool: MemoryMediaPool, id: string): BoardItemRecord {
  const row = durableRows(pool, 'items').get(id)
  expect(row).toBeDefined()
  return row as BoardItemRecord
}

describe('FaberLoomBoard remote mode', () => {
  it('off keeps every read and write local and never builds the adapter', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'off' } }, checks: 'none' })
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const fake = fakeRemote()
    let built = 0
    harness.board.useRemote((_settings: BoardRemoteSettings) => {
      built += 1
      return fake.port
    })
    fake.items.set(seeded.id, { ...seeded, title: 'respuesta remota' })

    const got = await harness.board.get(ACTOR_A, seeded.id)
    const listed = await harness.board.list(ACTOR_A)

    expect(got.title).toBe(seeded.title)
    expect(listed.map(item => item.id)).toEqual([seeded.id])
    expect(fake.calls).toEqual([])
    expect(built).toBe(0)
  })

  it('shadow returns the SQLite answer, compares both stores, and reports the divergence', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'shadow' } }, checks: 'none' })
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const fake = fakeRemote()
    harness.board.useRemote(() => fake.port)
    fake.items.set(seeded.id, {
      ...seeded,
      state: 'APROBADO',
      rowVersion: seeded.rowVersion + 1,
      artifactHash: 'hash-remoto',
    })
    const divergences: BoardRemoteDivergence[] = []
    harness.ctx.effect(() => harness.board.onRemoteDivergence((divergence) => { divergences.push(divergence) }), 'test.remote')

    const got = await harness.board.get(ACTOR_A, seeded.id)

    expect(got.state).toBe(seeded.state)
    expect(divergences).toHaveLength(1)
    expect(divergences[0]?.itemId).toBe(seeded.id)
    expect(divergences[0]?.fields).toEqual([
      { field: 'state', local: seeded.state, remote: 'APROBADO' },
      { field: 'rowVersion', local: seeded.rowVersion, remote: seeded.rowVersion + 1 },
      { field: 'artifactHash', local: seeded.artifactHash ?? null, remote: 'hash-remoto' },
    ])
    expect(fake.calls).toEqual(['get'])
  })

  it('shadow refuses to run without an adapter instead of silently never comparing', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'shadow' } }, checks: 'none' })
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)

    await expect(harness.board.get(ACTOR_A, seeded.id))
      .rejects.toThrow(/faberloom: REMOTE_UNAVAILABLE/u)
  })

  it('shadow reports a row that exists on one side only and never writes remote', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'shadow' } }, checks: 'none' })
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const fake = fakeRemote()
    harness.board.useRemote(() => fake.port)
    const divergences: BoardRemoteDivergence[] = []
    harness.ctx.effect(() => harness.board.onRemoteDivergence((divergence) => { divergences.push(divergence) }), 'test.remote')

    await harness.board.list(ACTOR_A)
    await harness.board.get(ACTOR_A, seeded.id)

    expect(fake.calls).toEqual(['list', 'get'])
    expect(divergences.map(divergence => divergence.fields)).toEqual([
      [{ field: 'id', local: seeded.id, remote: null }],
      [{ field: 'id', local: seeded.id, remote: null }],
    ])
  })

  it('on runs the state machine over the remote row and persists every command', async () => {
    const harness = await bootBoard({
      board: { remote: { mode: 'on', baseUrl: 'https://mesa.test', token: 'secret' } },
      checks: 'none',
    })
    const fake = fakeRemote()
    const settings: BoardRemoteSettings[] = []
    harness.board.useRemote((resolved) => {
      settings.push(resolved)
      return fake.port
    })
    const approveItem = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const discardItem = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const editItem = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const assignItem = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    const spaceId = await seedSpace(harness, ACTOR_A, 'Intentos')
    const iterateItem = await seedProforma(harness.board, OWNER_A, COMPANY_A, spaceId)

    const got = await harness.board.get(ACTOR_A, approveItem.id)
    const listed = await harness.board.list(ACTOR_A)

    const severe = await harness.board.setSeverity(ACTOR_A, approveItem.id, 'LOW')
    const approved = await harness.board.approve(ACTOR_A, approveItem.id, {
      expectedRowVersion: severe.rowVersion,
      expectedArtifactVersion: approveItem.version,
      expectedArtifactHash: approveItem.artifactHash ?? 'hash',
    })
    await harness.board.setSeverity(ACTOR_A, discardItem.id, 'LOW')
    const discarded = await harness.board.discard(ACTOR_A, discardItem.id, {
      expectedRowVersion: discardItem.rowVersion + 1,
      reason: 'DUPLICADO',
    })
    const edited = await harness.board.saveEdits(ACTOR_A, editItem.id, {
      expectedRowVersion: editItem.rowVersion,
      baseVersion: editItem.version,
      changes: { summary: 'editado' },
    })
    const assigned = await harness.board.assignWorkspace(ACTOR_A, assignItem.id, spaceId)
    const iterating = await harness.board.iterate(ACTOR_A, iterateItem.id, {
      baseVersion: iterateItem.version,
      actorSession: 'tab-remote',
    })

    expect(got.title).toBe(approveItem.title)
    expect(listed.map(item => item.id).sort()).toEqual(
      [approveItem.id, discardItem.id, editItem.id, assignItem.id, iterateItem.id].sort(),
    )
    expect(settings).toEqual([{ baseUrl: 'https://mesa.test', token: 'secret', tenant: undefined }])
    expect(approved.state).toBe('APROBADO')
    expect(discarded.state).toBe('DESCARTADO')
    expect(edited.version).toBe(editItem.version + 1)
    expect(assigned.item.spaceId).toBe(spaceId)
    expect(iterating.item.state).toBe('ITERANDO')
    expect(fake.calls).toContain('commit')
    expect(fake.calls).toContain('create')
    // El respaldo local refleja el commit remoto; nunca es la fuente en `on`.
    const row = localRow(harness.pool, approveItem.id)
    expect(row.severity).toBe('LOW')
    expect(row.rowVersion).toBe(approved.rowVersion)
    expect(row.events.length).toBeGreaterThan(approveItem.events.length)
  })

  it('on reports REMOTE_UNAVAILABLE on a transport failure and writes nothing local', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'on' } }, checks: 'none' })
    const fake = fakeRemote({ failing: ['commit'] })
    harness.board.useRemote(() => fake.port)
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)

    await expect(harness.board.setSeverity(ACTOR_A, seeded.id, 'LOW'))
      .rejects.toThrow(/faberloom: REMOTE_UNAVAILABLE/u)

    const row = localRow(harness.pool, seeded.id)
    expect(row.severity).toBe(seeded.severity)
    expect(row.rowVersion).toBe(seeded.rowVersion)
    expect(row.events).toHaveLength(seeded.events.length)
  })

  it('on refuses a read when no adapter is mounted instead of answering from SQLite', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'on' } }, checks: 'none' })
    const fake = fakeRemote()
    const dispose = harness.board.useRemote(() => fake.port)
    const seeded = await seedProforma(harness.board, OWNER_A, COMPANY_A)
    dispose()

    await expect(harness.board.get(ACTOR_A, seeded.id))
      .rejects.toThrow(/faberloom: REMOTE_UNAVAILABLE/u)
  })

  it('on keeps the adapter code when the refusal is a coded one, so the panel can ask for a new session', async () => {
    const harness = await bootBoard({ board: { remote: { mode: 'on' } }, checks: 'none' })
    harness.board.useRemote(() => ({
      ...fakeRemote().port,
      async list() {
        throw new Error('faberloom: UNAUTHENTICATED — la sesión no identifica email y tenant')
      },
    }))

    await expect(harness.board.list(ACTOR_A))
      .rejects.toThrow(/faberloom: UNAUTHENTICATED/u)
  })
})

describe('board remote activation contract', () => {
  it('reads the mode, URL, and token from the environment', () => {
    expect(boardRemoteConfigFromEnv({
      FABERLOOM_BOARD_REMOTE: 'shadow',
      FABERLOOM_BOARD_REMOTE_URL: 'https://mesa.test',
      FABERLOOM_BOARD_REMOTE_TOKEN: 'secret',
    })).toEqual({ mode: 'shadow', baseUrl: 'https://mesa.test', token: 'secret' })
  })

  it('names the token file the gateway rewrites, so the process can pick up a rotated token', () => {
    expect(boardRemoteConfigFromEnv({
      FABERLOOM_BOARD_REMOTE: 'on',
      FABERLOOM_BOARD_REMOTE_URL: 'https://mesa.test',
      FABERLOOM_BOARD_REMOTE_TOKEN: 'secret',
      FABERLOOM_BOARD_REMOTE_TOKEN_FILE: '/data/users/u1/.board-token',
    })).toEqual({
      mode: 'on',
      baseUrl: 'https://mesa.test',
      token: 'secret',
      tokenFile: '/data/users/u1/.board-token',
    })
  })

  it('defaults to off when the mode variable is absent and refuses an unknown mode', () => {
    expect(boardRemoteConfigFromEnv({})).toBeUndefined()
    expect(() => boardRemoteConfigFromEnv({ FABERLOOM_BOARD_REMOTE: 'sombra' }))
      .toThrow(/faberloom: REMOTE_CONFIG_INVALID/u)
  })
})
