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

const CONFIG: Config = { ownerId: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false, memoryTools: true }

/** A fake spaces service exposing the memory methods the tools call. */
function fakeSpaces() {
  return {
    remember: vi.fn(async (_actor: unknown, text: string, ids: string[]) => ({ id: 'm-new', spaceIds: ids, text, createdAt: '2026-10-03T00:00:00.000Z' })),
    listMemory: vi.fn(async () => [{ id: 'm1', spaceIds: ['sp-1'], text: 'dato propio', createdAt: '2026-10-03T00:00:00.000Z' }]),
    effectiveMemory: vi.fn(async () => [{ id: 'm2', spaceIds: ['sp-1'], text: 'dato heredado', createdAt: '2026-10-03T00:00:00.000Z' }]),
    forgetMemory: vi.fn(async () => true),
  }
}

/** A fake memory service exposing the teaching methods the tools call. */
function fakeMemory() {
  return {
    createTeaching: vi.fn(async (_owner: string, input: { active?: boolean }) => ({ id: 't1', status: input.active === true ? 'active' : 'candidate', version: 1 })),
    listTeachings: vi.fn(async () => [{ id: 't1', scope: 'space', text: 'usar plantilla', status: 'active', version: 1, updatedAt: '2026-10-03T00:00:00.000Z' }]),
    revokeTeaching: vi.fn(async () => ({ id: 't1', status: 'revoked', version: 1 })),
    retrieve: vi.fn(async () => [{ id: 't1', scope: 'case', text: 'usar plantilla', status: 'active', version: 1, updatedAt: '2026-10-03T00:00:00.000Z' }]),
  }
}

describe('faberloom memory tools', () => {
  it('does not register the memory tools unless memoryTools is enabled', () => {
    const tools = harness({ ...CONFIG, memoryTools: false }, { faberloomSpaces: fakeSpaces(), faberloomMemory: fakeMemory() })
    expect(tools.get('faberloom_spaces_remember')).toBeUndefined()
    expect(tools.get('faberloom_memory_teach')).toBeUndefined()
  })

  it('remembers on a space and lists its effective memory', async () => {
    const spaces = fakeSpaces()
    const tools = harness(CONFIG, { faberloomSpaces: spaces, faberloomMemory: fakeMemory() })

    const remembered = await tools.get('faberloom_spaces_remember')!.execute({ id: 'sp-1', text: 'usar encabezado' } as never)
    expect(spaces.remember).toHaveBeenCalledWith(expect.objectContaining({ id: 'compras2@sondelsa.com' }), 'usar encabezado', ['sp-1'])
    expect(remembered).toEqual({ id: 'm-new', text: 'usar encabezado' })

    await tools.get('faberloom_spaces_memory_list')!.execute({ id: 'sp-1' } as never)
    expect(spaces.effectiveMemory).toHaveBeenCalledWith(expect.anything(), 'sp-1')
    await tools.get('faberloom_spaces_memory_list')!.execute({} as never)
    expect(spaces.listMemory).toHaveBeenCalledTimes(1)

    const text = tools.get('faberloom_spaces_memory_list')!.output.render({} as never, { entries: [{ id: 'm2', text: 'dato heredado', spaceIds: ['sp-1'] }] } as never)[0]?.text ?? ''
    expect(text).toContain('dato heredado')
  })

  it('forgets one memory entry and reports the outcome', async () => {
    const spaces = fakeSpaces()
    const tools = harness(CONFIG, { faberloomSpaces: spaces, faberloomMemory: fakeMemory() })
    const forget = tools.get('faberloom_spaces_forget')!
    expect(await forget.execute({ memoryId: 'm1' } as never)).toEqual({ removed: true })
    spaces.forgetMemory.mockResolvedValueOnce(false)
    expect(forget.output.render({} as never, { removed: false } as never)[0]?.text).toContain('not found')
  })

  it('records a teaching as active for an explicit instruction and candidate otherwise', async () => {
    const mem = fakeMemory()
    const tools = harness(CONFIG, { faberloomSpaces: fakeSpaces(), faberloomMemory: mem })
    const teach = tools.get('faberloom_memory_teach')!

    const active = await teach.execute({ scope: 'space', text: 'siempre tono formal', source: 'user', active: true, spaceId: 'sp-1' } as never)
    expect(mem.createTeaching).toHaveBeenCalledWith('compras2@sondelsa.com', expect.objectContaining({ scope: 'space', text: 'siempre tono formal', source: 'user', author: 'compras2@sondelsa.com', active: true, spaceId: 'sp-1' }))
    expect(active).toEqual({ id: 't1', status: 'active', version: 1 })

    const inferred = await teach.execute({ scope: 'case', text: 'quizá use A4', source: 'case:4711' } as never)
    expect(inferred).toEqual({ id: 't1', status: 'candidate', version: 1 })
  })

  it('rejects an unsupported teaching scope at the schema boundary', async () => {
    const tools = harness(CONFIG, { faberloomSpaces: fakeSpaces(), faberloomMemory: fakeMemory() })
    await expect(tools.get('faberloom_memory_teach')!.execute({ scope: 'bogus', text: 'x', source: 'user' } as never))
      .rejects.toThrow()
  })

  it('lists teachings with a filter and revokes one', async () => {
    const mem = fakeMemory()
    const tools = harness(CONFIG, { faberloomSpaces: fakeSpaces(), faberloomMemory: mem })

    const listed = await tools.get('faberloom_memory_teachings')!.execute({ scope: 'space', spaceId: 'sp-1' } as never) as { teachings: { text: string }[] }
    expect(mem.listTeachings).toHaveBeenCalledWith('compras2@sondelsa.com', { scope: 'space', spaceId: 'sp-1' })
    expect(listed.teachings[0]?.text).toBe('usar plantilla')

    expect(await tools.get('faberloom_memory_revoke')!.execute({ id: 't1' } as never)).toEqual({ id: 't1', status: 'revoked' })
  })

  it('retrieves teachings and records the case reference as a use', async () => {
    const mem = fakeMemory()
    const tools = harness(CONFIG, { faberloomSpaces: fakeSpaces(), faberloomMemory: mem })
    const retrieved = await tools.get('faberloom_memory_retrieve')!.execute({ scope: 'case', caseRef: 'case:4711' } as never) as { teachings: { text: string }[] }
    expect(mem.retrieve).toHaveBeenCalledWith('compras2@sondelsa.com', { scope: 'case', caseRef: 'case:4711' })
    expect(retrieved.teachings[0]?.text).toBe('usar plantilla')
  })
})
