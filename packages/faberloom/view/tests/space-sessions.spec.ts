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
  const query = { readSession: vi.fn(async () => ({ session: { id: 's1' }, events: [{ type: 'user/message' }] })), readTitle: vi.fn(async () => ({ title: 'Título del log' })) }
  const shares = {
    list: vi.fn(async () => ({ outgoing: [] as unknown[], incoming: [] as unknown[] })),
    create: vi.fn(async () => ({})),
    can: vi.fn(async () => true),
  }
  const workflows = { list: vi.fn(async () => [] as unknown[]) }
  const registry = { get: vi.fn((id: string) => id === 'ws-1' ? { sessionIds: ['s1'] } : undefined) }
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
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomSessionShares') return catalog
      if (name === 'sessionQuery') return options.query === false ? undefined : query
      if (name === 'faberloomShares') return shares
      if (name === 'faberloomWorkflows') return workflows
      if (name === 'workspaceRegistry') return registry
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, catalog, query, shares, registry }
}

describe('FaberLoomViewService shared Sessions', () => {
  it('captures the offered Sessions with their titles and portable snapshots', async () => {
    const { view, catalog } = harness()
    const rows = await view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'Preliminar' }])
    expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({
        spaceId: 'sp-1', sessionId: 's1', title: 'Título del log', workspaceId: 'ws-1', messageCount: 1,
      }),
    )
    expect(String(catalog.capture.mock.calls[0]?.[1]?.['content'])).toContain('user/message')
    expect(catalog.sync).toHaveBeenCalledWith('owner@muitowork.com')
    expect(rows).toEqual([expect.objectContaining({ sessionId: 's1' })])
  })

  it('falls back to the offered title when the query service or its title is absent', async () => {
    const noQuery = harness({ query: false })
    await noQuery.view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'Preliminar' }])
    expect(noQuery.catalog.capture.mock.calls[0]?.[1]).toMatchObject({ title: 'Preliminar', messageCount: 0, content: '' })

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
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    expect(shares.create).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ resource: { kind: 'space', id: 'sp-1' } }))
    await vi.waitFor(() => expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1', workspaceId: 'ws-1' }),
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
