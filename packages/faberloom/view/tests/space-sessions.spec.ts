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
function harness(options: {
  query?: boolean
  workspaceId?: string | null
  foreignWorkspace?: boolean
  noRegistry?: boolean
  liveSessionIds?: readonly string[]
  storedSessionIds?: readonly string[]
} = {}) {
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
    id: 'ws-1',
    title: 'SICOP',
    sessionIds: ['s1'],
    path: '/data/owner/spaces/shared/3a4d6839',
    attachSession: vi.fn(async (_id: string) => {}),
    detachSession: vi.fn(async (_id: string) => {}),
  }
  const registry = {
    get: vi.fn((id: string) => id === 'ws-1' ? workspaceEntity : undefined),
    list: vi.fn(() => [workspaceEntity]),
  }
  const persistence = {
    // The area's own Session exists; a not-yet-materialized shared one does not.
    stat: vi.fn(async (id: string) => (options.storedSessionIds ?? ['s1']).includes(id) ? { id } : undefined as unknown),
    delete: vi.fn(async (_id: string) => true),
    create: vi.fn(async (_header: Record<string, unknown>) => ({
      append: vi.fn(async (_events: unknown) => {}),
      close: vi.fn(async () => {}),
    })),
  }
  const emit = vi.fn()
  const ctx = {
    faberloomSpaces: {
      get: vi.fn(async () => ({
        id: 'sp-1',
        title: 'SICOP',
        ownerId: 'owner@muitowork.com',
        workspaceId: options.foreignWorkspace === true
          ? 'otro-host'
          : options.workspaceId === undefined ? 'ws-1' : options.workspaceId,
      })),
      listMemory: vi.fn(async () => [] as unknown[]),
    },
    faberloomShares: shares,
    provide: () => {},
    reflect: { provide: () => {} },
    on: vi.fn(() => () => {}),
    effect: (run: () => unknown) => { run(); return () => {} },
    emit,
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomSessionShares') return catalog
      if (name === 'sessionQuery') return options.query === false ? undefined : query
      if (name === 'faberloomShares') return shares
      if (name === 'faberloomWorkflows') return workflows
      if (name === 'workspaceRegistry') return options.noRegistry === true ? undefined : registry
      if (name === 'sessionPersistence') return persistence
      if (name === 'sessions') {
        const live = new Set(options.liveSessionIds ?? [])
        return { get: (id: string) => live.has(id) ? { id } : undefined }
      }
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, catalog, query, shares, registry, persistence, emit, detachSession: workspaceEntity.detachSession }
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

    // Sin registro de Workspaces no hay área que resolver, y la fila se publica
    // sin `workspaceId`: el despliegue sigue funcionando igual.
    const noWorkspace = harness({ noRegistry: true })
    await noWorkspace.view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'X' }])
    expect(noWorkspace.catalog.capture.mock.calls[0]?.[1]).toMatchObject({ workspaceId: null })
  })

  it('publishes the area Sessions when the Space is shared, so the member reads them', async () => {
    const { view, catalog, shares } = harness()
    catalog.list.mockResolvedValue([])
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    expect(shares.create).toHaveBeenCalledWith('owner@muitowork.com', expect.objectContaining({ resource: { kind: 'space', id: 'sp-1' } }))
    await vi.waitFor(() => {
      expect(catalog.capture).toHaveBeenCalledWith(
        { id: 'owner@muitowork.com' },
        expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1', workspaceId: 'ws-1' }),
      )
    })
  })

  it('sincroniza en las dos direcciones: al listar publica la sesión del área que el catálogo no lleva', async () => {
    // El espejo es quien transporta el catálogo entre las máquinas del propio
    // dueño, así que la sesión de la web llega al escritorio sin que el Space
    // esté compartido con nadie.
    const { view, catalog } = harness()
    catalog.list.mockResolvedValue([])

    await view.spaceSessions('sp-1')

    expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1', workspaceId: 'ws-1', messageCount: 2, title: 'Título del log' }),
    )
  })

  it('no republica una sesión importada de otro miembro, y refresca la propia', async () => {
    const imported = harness()
    imported.catalog.list.mockResolvedValue([row({ ownerId: 'guest@x', sessionId: 's1' })])
    await imported.view.spaceSessions('sp-1')
    expect(imported.catalog.capture).not.toHaveBeenCalled()

    // Una fila propia se vuelve a publicar: es como la copia sigue el ritmo de
    // una conversación que sigue creciendo.
    const ours = harness()
    ours.catalog.list.mockResolvedValue([row({ ownerId: 'owner@muitowork.com', sessionId: 's1' })])
    await ours.view.spaceSessions('sp-1')
    expect(ours.catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1' }),
    )
  })

  it('no publica una sesión del área que no tiene ningún turno completado', async () => {
    const { view, catalog, query } = harness()
    catalog.list.mockResolvedValue([])
    query.readSession.mockResolvedValue({ session: { id: 's1' }, events: [{ type: 'permission/preset' }] })

    await view.spaceSessions('sp-1')

    expect(catalog.capture).not.toHaveBeenCalled()
  })

  it('resuelve el área por nombre cuando el id del Space es de otra máquina', async () => {
    // El espejo lleva las filas del Space con el id de Workspace del host que las
    // creó: en esta máquina ese id no existe, y el área es el Workspace del mismo
    // nombre, que es donde vive la conversación que hay que publicar.
    const { view, catalog } = harness({ foreignWorkspace: true })
    catalog.list.mockResolvedValue([])

    await view.spaceSessions('sp-1')

    expect(catalog.capture).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com' },
      expect.objectContaining({ spaceId: 'sp-1', sessionId: 's1', workspaceId: 'ws-1' }),
    )
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
    await vi.waitFor(() => {
      expect(catalog.remove).toHaveBeenCalledWith(
        { id: 'owner@muitowork.com' }, 'sp-1', 'owner@muitowork.com', 's2',
      )
    })
  })

  it('keeps a just-created draft in its Space while its log has not been written yet', async () => {
    const { view, catalog, registry, detachSession } = harness({ liveSessionIds: ['s2'] })
    const entity = registry.get('ws-1') as unknown as { sessionIds: string[] }
    // s1 is stored, s2 is the blank chat just opened (live, no log yet), and s3
    // is a dangling slot whose Session is gone.
    entity.sessionIds = ['s1', 's2', 's3']
    catalog.list.mockResolvedValue([row({ ownerId: 'owner@muitowork.com', sessionId: 's1' })])

    await view.spaceSessions('sp-1')

    expect(detachSession).not.toHaveBeenCalledWith('s2')
    expect(detachSession).toHaveBeenCalledWith('s3')
  })

  it('does not delete a live draft the catalog has not captured yet', async () => {
    const { view, catalog, registry, persistence, detachSession } = harness({
      liveSessionIds: ['s2'], storedSessionIds: ['s1', 's2'],
    })
    const entity = registry.get('ws-1') as unknown as { sessionIds: string[] }
    // s2 is the chat just created: its header is already stored, but it has no
    // turn, so publishSpaceSessions has not captured it in the catalog.
    entity.sessionIds = ['s1', 's2']
    catalog.list.mockResolvedValue([row({ ownerId: 'owner@muitowork.com', sessionId: 's1' })])

    await view.spaceSessions('sp-1')

    expect(persistence.delete).not.toHaveBeenCalledWith('s2')
    expect(detachSession).not.toHaveBeenCalledWith('s2')
  })

  it('materializa una sesión propia que llega de otra de mis máquinas', async () => {
    // El dueño es el mismo en sus dos máquinas, así que la fila que el espejo
    // trae lleva su identidad: sin esta materialización la conversación del web
    // se queda en el catálogo y nunca aparece en la barra lateral del escritorio.
    const { view, catalog, persistence } = harness()
    const mine = row({ ownerId: 'owner@muitowork.com', sessionId: 'sess-otra-maquina' })
    catalog.list.mockResolvedValue([mine])
    catalog.content.mockResolvedValue({
      ...mine,
      content: JSON.stringify({
        session: { version: 3, id: 'sess-otra-maquina', createdAt: 1, cwd: '/root/SICOP', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' },
        events: [
          { type: 'turn/start', seq: 1, time: 1, data: {} },
          { type: 'user/message', seq: 2, time: 2, data: {} },
        ],
      }),
    })

    await view.spaceSessions('sp-1')

    await vi.waitFor(() => { expect(persistence.create).toHaveBeenCalled() })
    expect(persistence.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sess-otra-maquina',
      cwd: '/data/owner/spaces/shared/3a4d6839',
    }))
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
    await vi.waitFor(() => { expect(persistence.create).toHaveBeenCalled() })
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
    query.readSession.mockResolvedValue({ session: { id: 's1' }, events: [{ type: 'permission/preset' }] })
    await view.captureSpaceSessions('sp-1', [{ id: 's1', title: 'X' }])
    expect(catalog.capture).not.toHaveBeenCalled()

    // The owner's sweep retires a member's imported row that carries no turn.
    const empty = row({ ownerId: 'guest@x', sessionId: 's-empty', messageCount: 4 })
    catalog.list.mockResolvedValue([empty])
    catalog.content.mockResolvedValue({ ...empty, content: JSON.stringify({ events: [{ type: 'session/end-seed' }] }) })
    await view.shareSpace('sp-1', ['guest@x'], ['view'])
    await vi.waitFor(() => {
      expect(catalog.remove).toHaveBeenCalledWith(
        { id: 'owner@muitowork.com' }, 'sp-1', 'guest@x', 's-empty',
      )
    })
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
