import { describe, expect, it, vi } from 'vitest'
import type { SubagentCapabilities } from '@deepseek-ai/dsh-subagent'
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
    entries: [{ id: 'e1', title: 'Regla de plantilla', body: 'La plantilla mensual manda.', version: 3, authorId: 'compras2@sondelsa.com', updatedAt: '2026-10-03T00:00:00.000Z' }],
    files: [],
    agentId,
    workspaceId: undefined,
  }
}

/** A fake subagents runtime that records the start request and disposes on demand. */
function fakeSubagents(capabilities?: SubagentCapabilities, stopReason = 'completed') {
  const dispose = vi.fn(async () => {})
  const run = {
    id: 'child-session-1',
    result: Promise.resolve({
      output: [{ type: 'text', text: 'Usa la plantilla mensual.' }],
      stopReason,
    }),
    dispose,
  }
  const start = vi.fn(async () => run)
  const startContinuable = vi.fn(async () => ({ childId: 'child-cont', messageId: 'msg-cont' }))
  const sendMessage = vi.fn(async () => 'msg-1')
  return { start, dispose, service: { getProvider: vi.fn(() => ({ name: 'spawn', capabilities })), start, startContinuable, sendMessage } }
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
    expect(brief).toContain('Contexto curado: Regla de plantilla: La plantilla mensual manda.')
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

  it('fails loud when the delegated run does not complete', async () => {
    const subs = fakeSubagents(undefined, 'aborted')
    const tools = harness(CONFIG, { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('no completó la respuesta')
    expect(subs.dispose).toHaveBeenCalledTimes(1)
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
    const tools = harness(Object.assign({}, CONFIG, { askProvider: 'acp' }), { faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('"acp" is not registered')
  })

  it('starts a durable consultation and records it', async () => {
    const subs = fakeSubagents({ agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
    const runtime = { record: vi.fn(async () => ({})) }
    const tools = harness(CONFIG, {
      faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service, faberloomAgentRuntime: runtime,
    })
    const exec = { agent: { id: 'parent-agent', session: { id: 'sess-1' } }, signal: new AbortController().signal }
    const result = await tools.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x', continuable: true } as never, exec as never,
    ) as { childSessionId: string; stopReason: string }
    expect(result).toMatchObject({ childSessionId: 'child-cont', stopReason: 'continuable' })
    expect(runtime.record).toHaveBeenCalledWith('compras2@sondelsa.com', expect.objectContaining({
      spaceId: 'space-formats', callerSessionId: 'sess-1', childSessionId: 'child-cont',
    }))
    expect(subs.start).not.toHaveBeenCalled()
  })

  it('continues a recorded durable consultation', async () => {
    const subs = fakeSubagents()
    const runtime = { consultation: vi.fn(async () => ({ spaceId: 'space-formats', callerSessionId: 'sess-1', childSessionId: 'child-cont', label: 'L', createdAt: 'c', updatedAt: 'u' })) }
    const tools = harness(CONFIG, {
      faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service, faberloomAgentRuntime: runtime,
    })
    const exec = { agent: { id: 'parent-agent', session: { id: 'sess-1' } }, signal: new AbortController().signal }
    const result = await tools.get('faberloom_spaces_followup')!.execute({ spaceId: 'space-formats', question: 'y' } as never, exec as never)
    expect(result).toMatchObject({ childSessionId: 'child-cont', status: 'sent' })
    expect(subs.service.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('refuses a follow-up with no recorded consultation', async () => {
    const subs = fakeSubagents()
    const runtime = { consultation: vi.fn(async () => undefined) }
    const tools = harness(CONFIG, {
      faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service, faberloomAgentRuntime: runtime,
    })
    const exec = { agent: { id: 'parent-agent', session: { id: 'sess-1' } }, signal: new AbortController().signal }
    await expect(tools.get('faberloom_spaces_followup')!.execute({ spaceId: 'space-formats', question: 'y' } as never, exec as never))
      .rejects.toThrow('no hay una consulta continuable')
  })

  it('enforces the responsible agent capability plane on the child', async () => {
    const subs = fakeSubagents({ agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
    const plane = {
      resolve: vi.fn(() => ({
        persona: 'Mantener las plantillas',
        toolFilter: { deny: ['mcp__sicop__licitaciones'] },
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        skills: [],
      })),
      allowsSubagent: vi.fn(() => true),
    }
    const tools = { schemas: () => [{ name: 'mcp__sicop__licitaciones' }, { name: 'web_search' }, { name: 'read' }] }
    const registry = harness(CONFIG, {
      faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service, faberloomAgentPlane: plane, tools,
    })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await registry.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never)

    expect(plane.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-formatos' }),
      { mcp: { sicop: ['mcp__sicop__licitaciones'] }, web: ['web_search'] },
    )
    const call = subs.start.mock.calls[0] as unknown as [string, { toolFilter?: unknown; persona?: unknown; agentOptions?: unknown }]
    expect(call[1].toolFilter).toEqual({ deny: ['mcp__sicop__licitaciones'] })
    expect(call[1].persona).toBe('Mantener las plantillas')
    expect(call[1].agentOptions).toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro' })
  })

  it('fails loud when the provider cannot enforce a needed tool mask', async () => {
    const subs = fakeSubagents({ agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false })
    const plane = {
      resolve: () => ({ persona: 'x', toolFilter: { deny: ['mcp__sicop__licitaciones'] }, provider: undefined, model: undefined, skills: [] }),
      allowsSubagent: () => true,
    }
    const tools = { schemas: () => [{ name: 'mcp__sicop__licitaciones' }] }
    const registry = harness(CONFIG, {
      faberloomSpaces: SPACES, faberloomAgents: AGENTS, subagents: subs.service, faberloomAgentPlane: plane, tools,
    })
    const exec = { agent: { id: 'parent-agent' }, signal: new AbortController().signal }
    await expect(registry.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('cannot enforce the agent capability plane')
    expect(subs.start).not.toHaveBeenCalled()
  })

  it('refuses a consultation the caller agent does not allow', async () => {
    const subs = fakeSubagents({ agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
    const spaces = {
      reference: vi.fn(async () => fakeReference('agent-formatos')),
      list: vi.fn(async () => [{ workspaceId: 'ws-1', agentId: 'agent-caller' }]),
    }
    const plane = {
      resolve: vi.fn(() => ({ persona: 'x', toolFilter: undefined, provider: undefined, model: undefined, skills: [] })),
      allowsSubagent: vi.fn(() => false),
    }
    const agents = { getAgent: vi.fn(async (id: string) => ({ id, name: id === 'agent-formatos' ? 'Formatos' : 'Llamante', responsibility: 'r', skills: [], subagents: [] })) }
    const registry = { list: () => [{ id: 'ws-1', path: '/home/SICOP' }] }
    const ask = harness(CONFIG, {
      faberloomSpaces: spaces, faberloomAgents: agents, subagents: subs.service,
      faberloomAgentPlane: plane, workspaceRegistry: registry,
    })
    const exec = { agent: { id: 'parent-agent', session: { header: { cwd: '/home/SICOP' } } }, signal: new AbortController().signal }
    await expect(ask.get('faberloom_spaces_ask')!.execute({ spaceId: 'space-formats', question: 'x' } as never, exec as never))
      .rejects.toThrow('no tiene permitido consultar')
    expect(plane.allowsSubagent).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-caller' }), 'agent-formatos')
    expect(subs.start).not.toHaveBeenCalled()
  })

  it('allows a consultation the caller agent lists, and skips enforcement outside a mirrored Space', async () => {
    const subs = fakeSubagents({ agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
    const plane = {
      resolve: vi.fn(() => ({ persona: 'x', toolFilter: undefined, provider: undefined, model: undefined, skills: [] })),
      allowsSubagent: vi.fn(() => true),
    }
    const agents = { getAgent: vi.fn(async (id: string) => ({ id, name: 'N', responsibility: 'r', skills: [], subagents: [] })) }
    const ask = harness(CONFIG, {
      faberloomSpaces: { reference: vi.fn(async () => fakeReference('agent-formatos')), list: vi.fn(async () => [{ workspaceId: 'ws-1', agentId: 'agent-caller' }]) },
      faberloomAgents: agents,
      subagents: subs.service,
      faberloomAgentPlane: plane,
      workspaceRegistry: { list: () => [{ id: 'ws-1', path: '/home/SICOP' }] },
    })
    await ask.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x' } as never,
      { agent: { id: 'parent-agent', session: { header: { cwd: '/home/SICOP' } } }, signal: new AbortController().signal } as never,
    )
    expect(plane.allowsSubagent).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-caller' }), 'agent-formatos')
    expect(subs.start).toHaveBeenCalledTimes(1)

    // A caller whose session is not in a mirrored Space carries no identity.
    const outside = harness(CONFIG, {
      faberloomSpaces: { reference: vi.fn(async () => fakeReference('agent-formatos')), list: vi.fn(async () => [{ workspaceId: 'ws-1', agentId: 'agent-caller' }]) },
      faberloomAgents: agents,
      subagents: subs.service,
      faberloomAgentPlane: plane,
      workspaceRegistry: { list: () => [{ id: 'ws-2', path: '/home/OTRO' }] },
    })
    await outside.get('faberloom_spaces_ask')!.execute(
      { spaceId: 'space-formats', question: 'x' } as never,
      { agent: { id: 'parent-agent', session: { header: { cwd: '/home/SICOP' } } }, signal: new AbortController().signal } as never,
    )
    expect(plane.allowsSubagent).toHaveBeenCalledTimes(1)
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
