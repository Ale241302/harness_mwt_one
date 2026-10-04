import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(config: Config, services: Record<string, unknown> = {}): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

const OWNER = 'compras2@sondelsa.com'
const CONFIG: Config = { ownerId: OWNER, role: 'client_b2b', companyId: 'co-sondel', readOnly: false, contextTools: true }

/** One context entry the fake service returns. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1', spaceId: 'sp-1', title: 'Regla', body: 'x', version: 1, visibility: 'shared',
    authorId: OWNER, ownerId: OWNER, createdAt: 'c', updatedAt: 'u',
    ...overrides,
  }
}

/** A fake context service exposing the methods the tools call. */
function fakeContext() {
  return {
    list: vi.fn(async () => [entry()]),
    create: vi.fn(async () => entry({ visibility: 'pending' })),
    update: vi.fn(async () => entry({ version: 2 })),
    versions: vi.fn(async () => [{ version: 1, title: 'Regla', body: 'x', authorId: OWNER, createdAt: 'c' }]),
    restore: vi.fn(async () => entry({ version: 3 })),
    approve: vi.fn(async () => entry({ visibility: 'shared' })),
    reject: vi.fn(async () => entry({ visibility: 'local' })),
    remove: vi.fn(async () => true),
  }
}

const render = (tool: CapturedTool, value: Record<string, unknown>): string =>
  tool.output.render({} as never, value as never)[0]?.text ?? ''

describe('faberloom context tools', () => {
  it('does not register the context tools unless contextTools is enabled', () => {
    const tools = harness(Object.assign({}, CONFIG, { contextTools: false }), { faberloomContext: fakeContext() })
    expect(tools.get('faberloom_context_list')).toBeUndefined()
    expect(tools.get('faberloom_context_create')).toBeUndefined()
  })

  it('lists, creates, edits, versions, restores, approves, rejects, and removes context', async () => {
    const service = fakeContext()
    const tools = harness(CONFIG, { faberloomContext: service })
    const actor = { id: OWNER }

    const listed = await tools.get('faberloom_context_list')!.execute({} as never)
    expect(service.list).toHaveBeenCalledWith(actor)
    expect(render(tools.get('faberloom_context_list')!, listed as Record<string, unknown>)).toContain('1 context entry')

    const created = await tools.get('faberloom_context_create')!.execute({ title: 'Regla', body: 'x', spaceId: 'sp-1' } as never)
    expect(service.create).toHaveBeenCalledWith(actor, { title: 'Regla', body: 'x', spaceId: 'sp-1' })
    expect(created).toMatchObject({ entryId: 'c1', visibility: 'pending' })

    await tools.get('faberloom_context_update')!.execute({ entryId: 'c1', body: 'y' } as never)
    expect(service.update).toHaveBeenCalledWith(actor, 'c1', { body: 'y' })
    await tools.get('faberloom_context_update')!.execute({ entryId: 'c1', title: 'Otra' } as never)
    expect(service.update).toHaveBeenLastCalledWith(actor, 'c1', { title: 'Otra' })

    const versions = await tools.get('faberloom_context_versions')!.execute({ entryId: 'c1' } as never)
    expect(service.versions).toHaveBeenCalledWith(actor, 'c1')
    expect(render(tools.get('faberloom_context_versions')!, versions as Record<string, unknown>)).toContain('1 context entry')

    await tools.get('faberloom_context_restore')!.execute({ entryId: 'c1', version: 1 } as never)
    expect(service.restore).toHaveBeenCalledWith(actor, 'c1', 1)
    expect((await tools.get('faberloom_context_approve')!.execute({ entryId: 'c1' } as never))).toMatchObject({ visibility: 'shared' })
    expect((await tools.get('faberloom_context_reject')!.execute({ entryId: 'c1' } as never))).toMatchObject({ visibility: 'local' })
    expect(await tools.get('faberloom_context_remove')!.execute({ entryId: 'c1' } as never)).toMatchObject({ visibility: 'removed' })
    expect(service.remove).toHaveBeenCalledWith(actor, 'c1')
  })

  it('fails loud when the context service is not mounted', async () => {
    const tools = harness(CONFIG, {})
    await expect(tools.get('faberloom_context_list')!.execute({} as never)).rejects.toThrow('not mounted')
  })

  it('renders an empty list without entries', async () => {
    const service = fakeContext()
    service.list.mockResolvedValueOnce([])
    const tools = harness(CONFIG, { faberloomContext: service })
    const listed = await tools.get('faberloom_context_list')!.execute({} as never)
    expect(render(tools.get('faberloom_context_list')!, listed as Record<string, unknown>)).toBe('No context entries.')
  })
})
