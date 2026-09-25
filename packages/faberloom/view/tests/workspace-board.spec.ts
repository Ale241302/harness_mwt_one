import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** The minimal service graph the workspace and board remotes touch. */
function harness(options: { readOnly?: boolean; registry?: boolean } = {}) {
  const board = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: 'b1', version: 3 })),
    create: vi.fn(),
    submitRevision: vi.fn(async () => ({})),
    requestData: vi.fn(async () => ({})),
    fail: vi.fn(async () => ({})),
    complete: vi.fn(async () => ({})),
    review: vi.fn(async () => ({})),
    reopen: vi.fn(async () => ({})),
  }
  const entities: { id: string; path: string; title: string; sessionIds: string[] }[] = []
  const registry = {
    list: () => entities,
    create: vi.fn(async (dir: string, title?: string) => {
      const entity = { id: 'ws-1', path: dir, title: title ?? dir, sessionIds: [] as string[] }
      entities.push(entity)
      return entity
    }),
    delete: vi.fn(async () => true),
    archiveSessionsUnder: vi.fn(async () => 0),
  }
  let nextSpace = 0
  const spaces = {
    list: vi.fn(async (): Promise<readonly { id: string; title: string; parentId: string | null; agentId?: string }[]> => []),
    get: vi.fn(async (): Promise<{
      id: string
      title: string
      parentId: null
      inheritContext: boolean
      excluded: readonly string[]
      members: readonly string[]
      sources: readonly { kind: string; id: string }[]
      context: Record<string, string>
      agentId: string | null
    }> => ({ id: 'sp1', title: 'Eguisa', parentId: null, inheritContext: true, excluded: [], members: [], sources: [], context: {}, agentId: null })),
    create: vi.fn(async (
      _actor: unknown,
      input: { title: string; agentId?: string; parentId?: string },
    ): Promise<{ id: string; title: string }> => {
      nextSpace += 1
      return { id: `sp${String(nextSpace)}`, title: input.title }
    }),
    remove: vi.fn(async (): Promise<boolean> => true),
    update: vi.fn(async (): Promise<{ id: string; title: string }> => ({ id: 'sp1', title: 'Eguisa' })),
    resolveWorkdir: vi.fn(async (_actor?: unknown, _id?: string): Promise<{ kind: 'opaque'; ref: string }> => ({ kind: 'opaque', ref: 'fw_abc123' })),
    remember: vi.fn(async (): Promise<{ id: string; spaceIds: string[]; text: string; createdAt: string }> =>
      ({ id: 'm1', spaceIds: [], text: '', createdAt: '2026-01-01T00:00:00Z' })),
    listMemory: vi.fn(async (): Promise<readonly { id: string; spaceIds: string[]; text: string; createdAt: string }[]> => []),
    effectiveMemory: vi.fn(async (): Promise<readonly { id: string; spaceIds: string[]; text: string; createdAt: string }[]> => []),
  }
  const agents = {
    listAgents: vi.fn(async (): Promise<readonly {
      id: string
      name: string
      spaceId: string | undefined
      detached: boolean
      active: boolean
    }[]> => []),
    updateAgent: vi.fn(async () => ({})),
  }
  const ctx = {
    faberloomSpaces: spaces,
    faberloomAgents: agents,
    faberloomBoard: board,
    faberloomRoutines: { listRoutines: vi.fn(async () => []) },
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => (name === 'workspaceRegistry' && options.registry !== false ? registry : undefined),
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com',
    role: 'admin',
    readOnly: options.readOnly === true,
  })
  return { view, board, registry, spaces, agents, entities }
}

describe('FaberLoomViewService space workspace', () => {
  it('drops the space whose workspace was removed from the sidebar', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-ws-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness()
    spaces.list.mockResolvedValue([{ id: 'sp1', title: 'Eguisa', parentId: null }])
    await (view as unknown as { forgetSpacePath: (path: string) => Promise<void> }).forgetSpacePath(join(home, 'spaces', 'fw_abc123'))
    expect(spaces.remove).toHaveBeenCalledWith(expect.anything(), 'sp1')
  })

  it('marks the space agent unassigned once it leads no other space', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-ws-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, agents } = harness()
    const service = view as unknown as { detachAgentIfOrphan: (id: string) => Promise<void> }
    spaces.list.mockResolvedValue([{ id: 'sp2', title: 'Otra', parentId: null, agentId: 'a1' }])
    await service.detachAgentIfOrphan('a1')
    expect(agents.updateAgent).not.toHaveBeenCalled()

    spaces.list.mockResolvedValue([])
    await service.detachAgentIfOrphan('a1')
    expect(agents.updateAgent).toHaveBeenCalledWith('a1', { spaceId: null, detached: true })
  })

  it('keeps a deletion successful when the agent cannot be marked', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-ws-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, agents } = harness()
    spaces.list.mockResolvedValue([])
    agents.updateAgent.mockRejectedValue(new Error('no se pudo'))
    await expect((view as unknown as { detachAgentIfOrphan: (id: string) => Promise<void> }).detachAgentIfOrphan('a1')).resolves.toBeUndefined()
  })
  it('reads an unregistered area without creating it, then opens it titled after the space', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-ws-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, entities } = harness()

    const before = await view.spaceWorkspace('sp1')
    expect(before).toEqual({ registered: false, workspaceId: null, title: null, sessions: 0 })
    expect(entities).toHaveLength(0)

    const opened = await view.openSpaceWorkspace('sp1')
    expect(opened).toMatchObject({ registered: true, workspaceId: 'ws-1', title: 'Eguisa', sessions: 0 })
    expect(existsSync(join(home, 'spaces', 'fw_abc123'))).toBe(true)

    const after = await view.spaceWorkspace('sp1')
    expect(after).toMatchObject({ registered: true, workspaceId: 'ws-1', title: 'Eguisa' })
  })
})

describe('FaberLoomViewService space lifecycle', () => {
  it('creates a space with a responsible agent and registers its workspace', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, entities, spaces } = harness()

    await view.createSpace('Marluvas', 'a1')
    expect(spaces.create).toHaveBeenCalledWith(
      { id: 'owner@muitowork.com', role: 'admin', companyId: undefined, readOnly: false },
      { title: 'Marluvas', agentId: 'a1' },
    )
    expect(entities).toHaveLength(1)
    expect(existsSync(join(home, 'spaces', 'fw_abc123'))).toBe(true)
  })

  it('creates a sub-space under a parent, sharing or changing the agent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness()

    await view.createSpace('Hijo', 'a1', 'sp1')
    expect(spaces.create).toHaveBeenLastCalledWith(
      expect.anything(),
      { title: 'Hijo', agentId: 'a1', parentId: 'sp1' },
    )
  })

  it('keeps creating a space when no workspace registry is mounted', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view } = harness({ registry: false })

    await expect(view.createSpace('Solo')).resolves.toBeDefined()
    await expect(view.openSpaceWorkspace('sp1')).rejects.toThrow('workspace registry is not mounted')
  })

  it('creates a space without assigning an agent when none is chosen', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness()

    await view.createSpace('Solo')
    await view.createSpace('Vacio', '')
    expect(spaces.create).toHaveBeenNthCalledWith(1, expect.anything(), { title: 'Solo' })
    expect(spaces.create).toHaveBeenNthCalledWith(2, expect.anything(), { title: 'Vacio' })
  })

  it('deletes a space with its workspace', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, entities, registry, spaces } = harness()
    const dir = join(home, 'spaces', 'fw_abc123')
    entities.push({ id: 'ws-1', path: dir, title: 'Eguisa', sessionIds: [] })
    mkdirSync(dir, { recursive: true })

    await view.deleteSpace('sp1')
    expect(registry.delete).toHaveBeenCalledWith('ws-1')
    expect(existsSync(dir)).toBe(false)
    expect(spaces.remove).toHaveBeenCalled()
  })

  it('deletes a space without a mounted registry or a registered workspace', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view } = harness({ registry: false })

    await view.deleteSpace('sp1')
    expect(existsSync(join(home, 'spaces', 'fw_abc123'))).toBe(false)
  })

  it('projects the responsible agent and workspace into the overview rows', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, agents, entities } = harness()
    entities.push({ id: 'ws-1', path: join(home, 'spaces', 'fw_abc123'), title: 'Marluvas', sessionIds: [] })
    spaces.list.mockResolvedValue([
      { id: 'sp1', title: 'Marluvas', parentId: null, agentId: 'a1' },
      { id: 'sp2', title: 'Otra', parentId: null },
    ])
    spaces.resolveWorkdir.mockImplementation(async (_actor?: unknown, id?: string) => ({ kind: 'opaque', ref: id === 'sp1' ? 'fw_abc123' : 'fw_other' }))
    agents.listAgents.mockResolvedValue([{ id: 'a1', name: 'Recepción', spaceId: undefined, detached: false, active: true }])

    const overview = await view.overview()
    expect(overview.spaces).toEqual([
      { id: 'sp1', title: 'Marluvas', parentId: null, agentId: 'a1', agentName: 'Recepción', workspaceId: 'ws-1' },
      { id: 'sp2', title: 'Otra', parentId: null, agentId: null, agentName: null, workspaceId: null },
    ])
    // The Agents panel's Space column derives from the space's responsible agent.
    expect(overview.agents).toEqual([{ id: 'a1', name: 'Recepción', spaceIds: ['sp1'], detached: false, active: true }])
  })

  it('reads the responsible agent from the space and saves it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, agents } = harness()
    spaces.list.mockResolvedValue([{ id: 'sp1', title: 'Eguisa', parentId: null }])
    spaces.get.mockResolvedValue({
      id: 'sp1', title: 'Eguisa', parentId: null, inheritContext: true,
      excluded: [], members: [], sources: [], context: {}, agentId: 'a1',
    })

    expect((await view.spaceDetail('sp1'))?.agentId).toBe('a1')

    await view.saveSpace('sp1', { agentId: 'a2' })
    expect(spaces.update).toHaveBeenCalledWith(expect.anything(), 'sp1', expect.objectContaining({ agentId: 'a2' }))

    await view.saveSpace('sp1', { agentId: null })
    expect(spaces.update).toHaveBeenLastCalledWith(expect.anything(), 'sp1', expect.objectContaining({ agentId: null }))
    expect(agents.updateAgent).toHaveBeenCalledTimes(1)
    expect(agents.updateAgent).toHaveBeenCalledWith('a2', { spaceId: 'sp1', detached: false })
  })

  it('reports no responsible agent when the space has none', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness()
    spaces.list.mockResolvedValue([{ id: 'sp1', title: 'Eguisa', parentId: null }])

    expect((await view.spaceDetail('sp1'))?.agentId).toBeNull()
    expect(await view.spaceDetail('missing')).toBeUndefined()
  })

  it('remembers into a space and reads its effective memory', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness()
    spaces.effectiveMemory.mockResolvedValue([
      { id: 'm1', spaceIds: ['sp1'], text: 'dato', createdAt: '2026-01-01T00:00:00Z' },
    ])

    expect(await view.spaceMemory('sp1')).toEqual([
      { id: 'm1', text: 'dato', spaceIds: ['sp1'], createdAt: '2026-01-01T00:00:00Z' },
    ])
    expect(spaces.effectiveMemory).toHaveBeenCalledWith(expect.anything(), 'sp1')

    spaces.listMemory.mockResolvedValue([])
    expect(await view.spaceMemory()).toEqual([])

    await view.remember('nuevo', 'sp1')
    expect(spaces.remember).toHaveBeenCalledWith(expect.anything(), 'nuevo', ['sp1'])
    await view.remember('global')
    expect(spaces.remember).toHaveBeenLastCalledWith(expect.anything(), 'global', [])
  })

  it('saves provider, model, web access, mail, subagents, and a write-only key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, agents } = harness()
    agents.listAgents.mockResolvedValue([{ id: 'a2', name: 'Otro', spaceId: undefined, detached: true, active: true }])

    await view.saveAgent('a1', {
      provider: 'openai', model: 'gpt-4o', webAccess: true, mailConnectionIds: ['c1'],
      subagentIds: ['a2'], apiKey: 'sk-secret',
    })
    expect(agents.updateAgent).toHaveBeenCalledWith('a1', expect.objectContaining({
      provider: 'openai', model: 'gpt-4o', webAccess: true, mailConnectionIds: ['c1'],
      subagents: [{ name: 'Otro', agentId: 'a2' }], apiKey: 'sk-secret',
    }))

    // An empty key clears the stored secret.
    await view.saveAgent('a1', { apiKey: '' })
    expect(agents.updateAgent).toHaveBeenLastCalledWith('a1', expect.objectContaining({ apiKey: null }))
  })

  it('omits the workspace in the overview when no registry is mounted', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces } = harness({ registry: false })
    spaces.list.mockResolvedValue([{ id: 'sp1', title: 'Marluvas', parentId: null }])

    const overview = await view.overview()
    expect(overview.spaces[0]).toMatchObject({ agentId: null, workspaceId: null })
  })
})

describe('FaberLoomViewService board actions', () => {
  it('submits a revision, moves exceptions, and reviews with a note', async () => {
    const { view, board } = harness()
    await view.submitBoardRevision('b1', { summary: 'proforma lista', evidence: ['doc-1'] })
    expect(board.submitRevision).toHaveBeenCalledWith('owner@muitowork.com', 'b1', { summary: 'proforma lista', evidence: ['doc-1'] })

    await view.boardException('b1', 'request_data')
    expect(board.requestData).toHaveBeenCalledWith('owner@muitowork.com', 'b1')
    await view.boardException('b1', 'fail')
    expect(board.fail).toHaveBeenCalledWith('owner@muitowork.com', 'b1')
    await view.boardException('b1', 'complete')
    expect(board.complete).toHaveBeenCalledWith('owner@muitowork.com', 'b1')

    await view.reviewBoardItem('b1', true, 'revisado contra MWT')
    expect(board.review).toHaveBeenCalledWith('owner@muitowork.com', 'b1', { decision: 'approve', version: 3, note: 'revisado contra MWT' })
    await view.reviewBoardItem('b1', false)
    expect(board.review).toHaveBeenLastCalledWith('owner@muitowork.com', 'b1', { decision: 'reject', version: 3 })
  })

  it('refuses every board write for a read-only identity', async () => {
    const { view, board } = harness({ readOnly: true })
    await expect(view.submitBoardRevision('b1', { summary: 's', evidence: ['e'] })).rejects.toThrow('read-only')
    await expect(view.boardException('b1', 'fail')).rejects.toThrow('read-only')
    await expect(view.reviewBoardItem('b1', true)).rejects.toThrow('read-only')
    expect(board.submitRevision).not.toHaveBeenCalled()
    expect(board.review).not.toHaveBeenCalled()
  })
})
