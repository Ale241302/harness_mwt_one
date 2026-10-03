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

const CONFIG: Config = { ownerId: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

/** A deterministic space reference the ask tool composes its brief from. */
function fakeReference(agentId: string | undefined) {
  return {
    space: { id: 'space-formats', title: 'Formatos de documentos' },
    context: {
      resolved: { plantilla: 'informe mensual', tono: 'formal' },
      conflicts: [],
      sources: ['space-formats'],
      excluded: [],
      dataSources: [],
      directives: ['Directiva MWT: consulta el MCP de MWT.ONE para la empresa co-sondel.'],
    },
    memory: [{ id: 'm1', spaceIds: ['space-formats'], text: 'usar encabezado institucional', createdAt: '2026-10-03T00:00:00.000Z' }],
    files: [],
    agentId,
    workspaceId: undefined,
  }
}

/** A fake subagents runtime that records the start request and disposes on demand. */
function fakeSubagents() {
  const dispose = vi.fn(async () => {})
  const run = {
    id: 'child-session-1',
    result: Promise.resolve({
      output: [{ type: 'text', text: 'Usa la plantilla mensual.' }],
      stopReason: 'completed',
    }),
    dispose,
  }
  const start = vi.fn(async () => run)
  return { start, dispose, service: { getProvider: vi.fn(() => ({ name: 'spawn' })), start } }
}

const SPACES = { reference: vi.fn(async () => fakeReference('agent-formatos')) }
const AGENTS = {
  getAgent: vi.fn(async () => ({
    id: 'agent-formatos',
    name: 'Agente de formatos',
    responsibility: 'Mantener las plantillas de reportes',
    skills: ['reportes'],
  })),
}

describe('faberloom_spaces_ask', () => {
  it('briefs and delegates to the responsible agent, then returns its answer', async () => {
    const subs = fakeSubagents()
    const tools = harness(CONFIG, { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service })
    const ask = tools.get('faberloom_spaces_ask')!
    const agent = { id: 'parent-agent' }
    const exec = { agent, signal: new AbortController().signal }

    const result = await ask.execute({ spaceId: 'space-formats', question: '¿qué plantilla uso?' } as never, exec as never)

    expect(subs.start).toHaveBeenCalledTimes(1)
    const call = subs.start.mock.calls[0] as unknown as [string, { prompt: { text: string }[]; parent: unknown; signal: unknown }]
    expect(call[0]).toBe('spawn')
    expect(call[1].parent).toBe(agent)
    expect(call[1].signal).toBe(exec.signal)
    const brief = call[1].prompt[0]!.text
    expect(brief).toContain('Mantener las plantillas de reportes')
    expect(brief).toContain('reportes')
    expect(brief).toContain('plantilla=informe mensual')
    expect(brief).toContain('usar encabezado institucional')
    expect(brief).toContain('Otro agente te consulta: ¿qué plantilla uso?')
    expect(subs.dispose).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      spaceId: 'space-formats',
      agentId: 'agent-formatos',
      answer: 'Usa la plantilla mensual.',
      childSessionId: 'child-session-1',
      stopReason: 'completed',
    })

    const text = ask.output.render({} as never, result as never)[0]?.text ?? ''
    expect(text).toContain('agent-formatos')
    expect(text).toContain('Usa la plantilla mensual.')
  })

  it('uses an explicit agent override when the space has none responsible', async () => {
    const subs = fakeSubagents()
    const agents = { getAgent: vi.fn(async () => ({ id: 'agent-x', name: 'Otro', responsibility: 'Otra cosa', skills: [] })) }
    const spaces = { reference: vi.fn(async () => fakeReference(undefined)) }
    const tools = harness(CONFIG, { faberloomSpaces: spaces, faberloomAgents: agents, subagents: subs.service })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }

    const result = await tools.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x', agentId: 'agent-x' } as never,
      exec as never,
    ) as { agentId: string }
    expect(agents.getAgent).toHaveBeenCalledWith('agent-x')
    expect(result.agentId).toBe('agent-x')
  })

  it('fails loud when the space has no responsible agent', async () => {
    const subs = fakeSubagents()
    const spaces = { reference: vi.fn(async () => fakeReference(undefined)) }
    const tools = harness(CONFIG, { faberloomSpaces: spaces, faberloomAgents: AGENTS, subagents: subs.service })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('no tiene un agente responsable')
    expect(subs.start).not.toHaveBeenCalled()
  })

  it('surfaces the space access denial before delegating', async () => {
    const subs = fakeSubagents()
    const spaces = { reference: vi.fn(async () => { throw new Error('faberloom: space access denied') }) }
    const tools = harness(CONFIG, { faberloomSpaces: spaces, faberloomAgents: AGENTS, subagents: subs.service })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-x', question: 'x' } as never, exec as never))
      .rejects.toThrow('space access denied')
    expect(subs.start).not.toHaveBeenCalled()
  })

  it('fails loud when the configured provider is not registered', async () => {
    const subs = { getProvider: vi.fn(() => undefined), start: vi.fn() }
    const tools = harness({ ...CONFIG, askProvider: 'acp' }, { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('"acp" is not registered')
  })

  it('rejects a continuable consultation as deferred', async () => {
    const subs = fakeSubagents()
    const tools = harness(CONFIG, { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x', continuable: true } as never, exec as never))
      .rejects.toThrow('continuable consultations are deferred')
  })

  it('fails loud without a calling agent or a mounted subagents service', async () => {
    const subs = fakeSubagents()
    const tools = harness(CONFIG, { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service })
    await expect(tools.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x' } as never,
      { agent: undefined, signal: new AbortController().signal } as never,
    )).rejects.toThrow('requires a calling agent')

    const noSubs = harness(CONFIG, { faberloomSpaces: SPACES, faberloomAgents: AGENTS })
    await expect(noSubs.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x' } as never,
      { agent: { id: 'parent-agent' }, signal: new AbortController().signal } as never,
    )).rejects.toThrow('subagents service is not mounted')
  })
})
