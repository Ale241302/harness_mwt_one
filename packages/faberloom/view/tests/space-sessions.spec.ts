import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** One shared-Session row the fake catalog returns. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1', ownerId: 'owner@muitowork.com', spaceId: 'sp-1', title: 'Consulta',
    workspaceId: 'ws-1', createdAt: 'c', updatedAt: 'u', messageCount: 2, origin: 'owner',
    ...overrides,
  }
}

/** Boot the view over fake spaces, shares, shared-Session catalog, and query. */
function harness(options: { query?: boolean; workspaceId?: string | null } = {}) {
  const catalog = {
    capture: vi.fn(async (_actor: { id: string }, _input: Record<string, unknown>) => row()),
    list: vi.fn(async (_actor: { id: string }, _spaceId: string) => [row()]),
    content: vi.fn(async (_actor: { id: string }, _spaceId: string, _ownerId: string, _sessionId: string) => ({ ...row(), content: '{"events":[1]}' })),
    remove: vi.fn(async (_actor: { id: string }, _spaceId: string, _ownerId: string, _sessionId: string) => true),
    sync: vi.fn(async (_readerId: string) => undefined),
  }
  const query = { readSession: vi.fn(async () => ({ session: { id: 's1' }, events: [{ type: 'turn/start' }, { type: 'user/message' }] })), readTitle: vi.fn(async () => ({ title: 'Título del log' })) }
  const shares = {
    list: vi.fn(async () => ({ outgoing: [] as unknown[], incoming: [] as unknown[] })),
    create: vi.fn(async () => ({})),
    can: vi.fn(async () => true),
  }
  const workflows = { list: vi.fn(async () => [] as unknown[]) }
  const workspaceEntity = {
    sessionIds: ['s1'],
    path: '/data/owner/spaces/shared/3a4d6839',
    attachSession: vi.fn(async (_id: string) => {}),
    detachSession: vi.fn(async (_id: string) => {}),
  }
  const registry = { get: vi.fn((id: string) => id === 'ws-1' ? workspaceEntity : undefined) }
  const persistence = {
    // The area's own Session exists; a not-yet-materialized shared one does not.
    stat: vi.fn(async (id: string) => id === 's1' ? { id } : undefined as unknown),
    create: vi.fn(async (_header: Record<string, unknown>) => ({
      append: vi.fn(async (_events: unknown) => {}),
      close: vi.fn(async () => {}),
    })),
  }
  const ctx = {
    faberloomSpaces: {
      get: vi.fn(async () => ({ id: 'sp-1', title: 'SICOP', ownerId: 'owner@muitowork.com', workspaceId: options.workspaceId === undefined ? 'ws-1' : options.workspaceId })),
      listMemory: vi.fn(async () => [] as unknown[]),
    },
    faberloomShares: shares,
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    emit: vi.fn(),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomSessionShares') return catalog
      if (name === 'sessionQuery') return options.query === false ? undefined : query
      if (name === 'faberloomShares') return shares
      if (name === 'faberloomWorkflows') return workflows
      if (name === 'workspaceRegistry') return registry
      if (name === 'sessionPersistence') return persistence
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, catalog, query, shares, registry, persistence, emit: ctx.emit as unknown as ReturnType<typeof vi.fn> }
}

describe('FaberLoomViewService shared Sessions', () => {
  it('captures the offered Sessions with their titles and portable snapshots', async () => {
    const { view, catalog } = harness()
    const rows = await view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'Preliminar' }])
    expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({
        spaceId: 'sp-1', sessionId: 's1', title: 'Título del log', workspaceId: 'ws-1', messageCount: 2,
      }),
    )
    expect(String(catalog.capture.mock.calls[0]?.[1]?.['content'])).toContain('user/message')
    expect(catalog.sync).toHaveBeenCalledWith('owner@muitowork.com')
    expect(rows).toEqual([expect.objectContaining({ sessionId: 's1' })])
  })

  it('falla en silencio cuando falta el servicio de consulta, y usa el título ofrecido si falta el del log', async () => {
    // Sin servicio de consulta no se puede leer el log, así que no se comparte.
    const noQuery = harness({ query: false })
    await noQuery.view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'Preliminar' }])
    expect(noQuery.catalog.capture).not.toHaveBeenCalled()

    const noTitle = harness()
    noTitle.query.readTitle.mockResolvedValue(undefined as never)
    await noTitle.view.captureSpaceSessions('sp-1', [{ id: 's1', title: '' }])
    expect(noTitle.catalog.capture.mock.calls[0]?.[1]).toMatchObject({ title: 's1' })
  })

  it('lists and reads one shared Session', async () => {
    const { view } = harness()
    expect(await view.spaceSessions('sp-1')).toEqual([expect.objectContaining({ sessionId: 's1', title: 'Consulta' })])
    expect(await view.spaceSessionContent('sp-1', 'owner@muitowork.com', 's1')).toMatchObject({ content: '{"events":[1]}' })
  })

  it('removes one shared Session and returns the refreshed list', async () => {
    const { view, catalog } = harness()
    const rows = await view.removeSpaceSession('sp-1', 'guest@x', 's9')
    expect(catalog.remove).toHaveBeenCalledWith({ id: 'owner@muitowork.com' }, 'sp-1', 'guest@x', 's9')
    expect(rows).toEqual([expect.objectContaining({ sessionId: 's1' })])
  })

  it('falls back to the offered title when the query title rejects, and captures without a workspace', async () => {
    const rejected = harness()
    rejected.query.readTitle.mockRejectedValue(new Error('sin título'))
    await rejected.view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'Respaldo' }])
    expect(rejected.catalog.capture.mock.calls[0]?.[1]).toMatchObject({ title: 'Respaldo' })

    const noWorkspace = harness({ workspaceId: null })
    await noWorkspace.view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'X' }])
    expect(noWorkspace.catalog.capture.mock.calls[0]?.[1]).toMatchObject({ workspaceId: null })
  })

  it('publishes the area Sessions when the Space is shared, so the member reads them', async () => {
    const { view, catalog, shares } = harness()
    catalog.list.mockResolvedValue([])
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    expect(shares.create).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ resource: { kind: 'space', id: 'sp-1' } }))
    await vi.waitFor(() => expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1', workspaceId: 'ws-1' }),
    ))
  })

  it('retires a captured Session whose log is gone and drops its dangling area slot', async () => {
    const { view, catalog, registry } = harness()
    // The area lists two Sessions, but only s1 still has a log; s2 was deleted.
    const entity = registry.get('ws-1') as unknown as { sessionIds: string[] }
    entity.sessionIds = ['s1', 's2']
    catalog.list.mockResolvedValue([
      row({ ownerId: 'owner@muitowork.com', sessionId: 's1' }),
      row({ ownerId: 'owner@muitowork.com', sessionId: 's2' }),
    ])
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    await vi.waitFor(() => expect(catalog.remove).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' }, 'sp-1', 'owner@muitowork.com', 's2',
    ))
  })

  it('materializes a shared Session as the member own Session under the area', async () => {
    const { view, catalog, persistence, emit } = harness()
    const shared = row({ ownerId: 'publisher@muitowork.com', sessionId: 'sess-remote' })
    catalog.list.mockResolvedValue([shared])
    catalog.content.mockResolvedValue({
      ...shared,
      content: JSON.stringify({
        session: { version: 3, id: 'sess-remote', createdAt: 1, cwd: '/root/SICOP', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' },
        events: [
          { type: 'turn/start', seq: 1, time: 1, data: {} },
          { type: 'user/message', seq: 2, time: 2, data: {} },
        ],
      }),
    })
    await view.spaceSessions('sp-1')
    await vi.waitFor(() => expect(persistence.create).toHaveBeenCalled())
    expect(persistence.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-remote', cwd: '/data/owner/spaces/shared/3a4d6839' }))
    // The copy is announced to the client's Session list with its title and a
    // non-blank marker, so a reload that fetched the list before this mirror
    // still shows it under its area.
    expect(emit).toHaveBeenCalledWith('api-session/added', expect.objectContaining({
      sessionId: 'sess-remote', blank: false, cwd: '/data/owner/spaces/shared/3a4d6839',
      projections: { values: { title: 'Consulta' }, asOfSeq: 2 },
    }))
  })

  it('skips a Session with no turn and lets the owner drop a member empty row', async () => {
    const { view, catalog, query } = harness()
    query.readSession.mockResolvedValue({ session: { id: 's1' }, events: [{ type: 'permission/preset' }] } as never)
    await view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'X' }])
    expect(catalog.capture).not.toHaveBeenCalled()

    // The owner's sweep retires a member's imported row that carries no turn.
    const empty = row({ ownerId: 'guest@x', sessionId: 's-empty', messageCount: 4 })
    catalog.list.mockResolvedValue([empty])
    catalog.content.mockResolvedValue({ ...empty, content: JSON.stringify({ events: [{ type: 'session/end-seed' }] }) })
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    await vi.waitFor(() => expect(catalog.remove).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' }, 'sp-1', 'guest@x', 's-empty',
    ))
  })

  it('fails loud when the shared-Session catalog is not mounted', async () => {    const ctx = {
    provide: () => {}, reflect: { provide: () => {} }, on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} }, logger: { warn: vi.fn(), info: vi.fn() },
    get: () => undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  await expect(view.spaceSessions('sp-1')).rejects.toThrow('no está montado')
  })
})
