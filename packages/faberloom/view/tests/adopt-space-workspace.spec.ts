import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

afterEach(() => { vi.unstubAllEnvs() })

/** The minimal service graph `adoptSpaceWorkspace` touches. */
function harness(options: { registry?: boolean } = {}) {
  const entities: { id: string; path: string; title: string; sessionIds: string[] }[] = []
  const registry = {
    list: () => entities,
    create: vi.fn(async (dir: string, title?: string) => {
      const existing = entities.find(entity => entity.path === dir)
      if (existing !== undefined) return existing
      const entity = { id: `ws-${String(entities.length + 1)}`, path: dir, title: title ?? dir, sessionIds: [] as string[] }
      entities.push(entity)
      return entity
    }),
  }
  const space = {
    id: 'sp1',
    title: 'ACME',
    parentId: null,
    inheritContext: true,
    excluded: [],
    members: [],
    sources: [],
    context: {},
    agentId: null,
  }
  const spaces = {
    get: vi.fn(async () => space),
    update: vi.fn(async () => ({ ...space, workspaceId: 'ws-1' })),
  }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'workspaceRegistry' && options.registry !== false ? registry : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, spaces, registry, entities }
}

describe('adoptSpaceWorkspace', () => {
  it('registers the chosen folder and points the space at it', async () => {
    const { view, spaces, entities } = harness()

    const result = await view.adoptSpaceWorkspace('sp1', 'C:/Clientes/ACME')

    expect(result).toEqual({ registered: true, workspaceId: 'ws-1', title: 'ACME', sessions: 0 })
    expect(entities.map(entity => entity.path)).toEqual(['C:/Clientes/ACME'])
    expect(spaces.update).toHaveBeenCalledWith(expect.anything(), 'sp1', { workspaceId: 'ws-1' })
  })

  it('reuses a workspace already registered at that path', async () => {
    const { view, registry, spaces } = harness()
    await registry.create('C:/Clientes/ACME', 'Existing')
    const creates = registry.create.mock.calls.length

    const result = await view.adoptSpaceWorkspace('sp1', 'C:/Clientes/ACME')

    expect(registry.create.mock.calls.length).toBe(creates)
    expect(result.workspaceId).toBe('ws-1')
    expect(spaces.update).toHaveBeenCalledWith(expect.anything(), 'sp1', { workspaceId: 'ws-1' })
  })

  it('fails loud when the workspace registry is not mounted', async () => {
    const { view } = harness({ registry: false })

    await expect(view.adoptSpaceWorkspace('sp1', 'C:/Clientes/ACME')).rejects.toThrow(/workspace registry is not mounted/u)
  })
})
