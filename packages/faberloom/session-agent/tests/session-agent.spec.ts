import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import FaberLoomSessionAgent from '../src/index.ts'

/** The install callback the fake agent captures, plus the service and agent under test. */
interface Captured {
  cb?: (scope: unknown) => void
  ctx: Context
  agent: {
    session: {
      id: string
      header: { cwd: string | undefined; parentSession: string | undefined }
      append: (type: string, data: { spaceId: string }) => unknown
    }
  }
}

/** One Space record with the fields the scope reads. */
function space(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'sp-1',
    ownerId: 'owner@test',
    companyId: undefined,
    title: 'Espacio',
    parentId: undefined,
    inheritContext: true,
    excluded: [],
    members: [],
    context: {},
    prompt: '',
    sources: [],
    agentId: undefined,
    workspaceId: undefined,
    archived: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

/** The default Space tree: Marluvas > Costa Rica > (Sondel, Muitowork) and Colombia. */
const SPACES = [
  space({ id: 'sp-marluvas', workspaceId: 'ws-1', title: 'Marluvas', agentId: 'agent-sicop', prompt: 'Mantén el foco en SICOP.' }),
  space({ id: 'sp-costa', workspaceId: 'ws-2', parentId: 'sp-marluvas', title: 'Costa Rica' }),
  space({ id: 'sp-colombia', workspaceId: 'ws-3', parentId: 'sp-marluvas', title: 'Colombia' }),
  space({ id: 'sp-sondel', workspaceId: 'ws-4', parentId: 'sp-costa', title: 'Sondel' }),
  space({ id: 'sp-muitowork', workspaceId: 'ws-5', parentId: 'sp-costa', title: 'Muitowork Limitada' }),
]

/** Every service the composition reads, all present by default. */
const BASE_SERVICES: Record<string, unknown> = {
  workspaceRegistry: {
    list: () => [
      { id: 'ws-1', path: '/home/SICOP' },
      { id: 'ws-2', path: '/home/CR' },
      { id: 'ws-3', path: '/home/CO' },
      { id: 'ws-4', path: '/home/SD' },
      { id: 'ws-5', path: '/home/MW' },
    ],
  },
  faberloomSpaces: {
    list: async () => SPACES,
    get: async (_actor: unknown, id: string) => SPACES.find(candidate => candidate.id === id),
    effectiveMemory: async () => [],
    listMemory: async () => [],
    effectiveContext: async () => ({ resolved: {}, conflicts: [], sources: [], excluded: [], dataSources: [], directives: [] }),
    resolveWorkdir: async () => ({ kind: 'opaque', ref: 'fw_ref' }),
  },
  faberloomAgents: {
    listAgents: async () => [{ id: 'agent-sicop', name: 'SICOP', responsibility: 'Mantener las reglas', skills: ['docx'] }],
    getAgent: async () => ({ responsibility: 'Mantener las reglas', skills: ['docx'], mwtMcp: true, sicopMcp: false, webAccess: false, subagents: [] }),
  },
  faberloomAgentPlane: { resolve: () => ({ persona: 'Mantener las reglas', toolFilter: { deny: ['mcp__sicop__x'] }, provider: undefined, model: undefined, skills: ['docx'] }) },
  tools: { schemas: () => [{ name: 'mcp__sicop__x' }] },
  // Scope classifier double: the guard asks this port for the turns its
  // vocabulary fast path did not recognize. It reads the same text the model
  // would and answers one strict object, like the real classifier.
  llm: {
    stream: async function* (options: { messages: { content: { text?: string }[] }[] }) {
      const last = options.messages[options.messages.length - 1]
      const text = (last?.content ?? []).map(block => block.text ?? '').join('\n')
      const personal = /regalo|presentaci[oó]n|receta|chiste/iu.test(text)
      yield { type: 'text-delta', index: 0, text: JSON.stringify({ scope: personal ? 'personal' : 'work', confidence: 0.9 }) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
}

/** The default services with the patch applied; an `undefined` value removes the key. */
function services(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries({ ...BASE_SERVICES, ...patch })) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/** The scope the install callback registers against, recording sections and marks. */
function scope() {
  const sections: { name: string; order: number; text: string | (() => string) }[] = []
  const restrict = vi.fn()
  return {
    systemPrompt: {
      getSectionOrder: (name: string) => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 5 : 0),
      section: (input: { name: string; order: number; text: string | (() => string) }) => { sections.push(input); return () => {} },
    },
    tools: { restrict },
    sections,
    restrict,
  }
}

/** The resolved text of one recorded prompt section. */
function sectionText(installed: ReturnType<typeof scope>, name: string): string {
  const section = installed.sections.find(candidate => candidate.name === name)
  if (section === undefined) return ''
  return typeof section.text === 'function' ? section.text() : section.text
}

/** Boot the composition service over fakes and return the captured install callback. */
async function harness(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
  cwd: string | undefined,
  parentSession?: string,
): Promise<Captured> {
  const grants: string[] = []
  const agent = {
    session: {
      id: 'session-1',
      header: { cwd, parentSession },
      append: (type: string, data: { spaceId: string }) => {
        if (type === 'faberloom/space-read-grant' && !grants.includes(data.spaceId)) grants.push(data.spaceId)
        return { type, data }
      },
    },
    ctx: {
      on: vi.fn(() => vi.fn()),
      inject: vi.fn((_names: string[], cb: (scope: unknown) => void) => {
        captured.cb = cb
        return { dispose: vi.fn(async () => {}) }
      }),
    },
  }
  const ctx = new Context()
  const captured: Captured = { ctx, agent }
  const provide = (name: string, value: unknown): void => { (ctx.provide as (n: string, v: unknown) => void)(name, value) }
  for (const [name, value] of Object.entries(services(patch))) provide(name, value)
  provide('sessionProjections', {
    register: () => () => {},
    stateOf: (_session: unknown, key: string) => key === 'faberloomSpaceReads' ? { spaces: grants } : undefined,
  })
  provide('agents', { list: () => [agent] })
  await ctx.plugin(FaberLoomSessionAgent as never, config as never)
  // Installation now reads the Space subtree (product records plus harness
  // files), so the captured callback arrives after several asynchronous steps.
  await new Promise<void>((resolve) => { setTimeout(resolve, 250) })
  return captured
}

describe('FaberLoomSessionAgent composition', () => {
  it('installs the persona, tool mask, and skills of the Space agent', async () => {
    const captured = await harness({ ownerId: 'owner@test', role: 'client_b2b', readOnly: false }, {}, '/home/SICOP')
    expect(captured.cb).toBeDefined()
    const installed = scope()
    captured.cb!(installed)
    expect(sectionText(installed, 'deployment:persona-prefix')).toBe('Mantener las reglas')
    expect(sectionText(installed, 'faberloom:space-directive')).toBe('Mantén el foco en SICOP.')
    expect(sectionText(installed, 'faberloom:session-agent')).toContain('Skills asignadas: docx')
    expect(installed.sections.find(section => section.name === 'faberloom:usage-policy')).toMatchObject({ order: 8 })
    expect(sectionText(installed, 'faberloom:usage-policy')).toContain('SICOP es solo contratación pública')
    expect(installed.restrict).toHaveBeenCalledWith({ allow: ['mcp__sicop__x'], deny: ['mcp__sicop__x'] })
  })

  it('installs only the persona and the Space scope when nothing is masked and no skills are declared', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: { resolve: () => ({ persona: 'Solo persona', toolFilter: undefined, provider: undefined, model: undefined, skills: [] }) },
      faberloomSpaces: {
        ...BASE_SERVICES.faberloomSpaces as object,
        list: async () => [space({ id: 'sp-1', workspaceId: 'ws-1', title: 'SICOP', agentId: 'agent-sicop' })],
      },
    }, '/home/SICOP')
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections.map(section => section.name)).toEqual([
      'faberloom:usage-policy', 'deployment:persona-prefix', 'faberloom:space-scope',
    ])
    expect(installed.restrict).toHaveBeenCalledWith({ allow: ['mcp__sicop__x'] })
  })

  it('does not compose without an owner identity', async () => {
    expect((await harness({}, {}, '/home/SICOP')).cb).toBeUndefined()
  })

  it('does not compose a session without a working directory', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, undefined)).cb).toBeUndefined()
  })

  it('gives a delegated child the Space scope but not a second persona', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {}, '/home/SICOP', 'parent-s')
    expect(captured.cb).toBeDefined()
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections.map(section => section.name)).toEqual(['faberloom:usage-policy', 'faberloom:space-scope'])
  })

  it('does not resolve a Space when the registry or the spaces service is absent', async () => {
    for (const missing of ['workspaceRegistry', 'faberloomSpaces']) {
      expect((await harness({ ownerId: 'owner@test' }, { [missing]: undefined }, '/home/SICOP')).cb, missing).toBeUndefined()
    }
  })

  it('keeps the Space scope when the agent catalog or plane is absent', async () => {
    for (const missing of ['faberloomAgents', 'faberloomAgentPlane']) {
      const captured = await harness({ ownerId: 'owner@test' }, { [missing]: undefined }, '/home/SICOP')
      expect(captured.cb, missing).toBeDefined()
      const installed = scope()
      captured.cb!(installed)
      expect(installed.sections.map(section => section.name), missing).toEqual(['faberloom:usage-policy', 'faberloom:space-scope'])
    }
  })

  it('does not compose a session outside a mirrored Space', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, '/home/OTRO')).cb).toBeUndefined()
  })

  it('gives a Space without a responsible agent the product composition under a restricted role', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {
      faberloomSpaces: {
        ...BASE_SERVICES.faberloomSpaces as object,
        list: async () => [space({ id: 'sp-1', workspaceId: 'ws-1', title: 'Sin agente' })],
      },
    }, '/home/SICOP')
    expect(captured.cb).toBeDefined()
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections.map(section => section.name)).toEqual([
      'faberloom:usage-policy', 'deployment:persona-prefix', 'faberloom:space-scope',
    ])
    expect(sectionText(installed, 'deployment:persona-prefix')).toContain('MWT.ONE')
    expect(installed.restrict).toHaveBeenCalledWith({ allow: ['mcp__sicop__x'] })
  })

  it('keeps the deployment composition for a Space without an agent under a staff role', async () => {
    const captured = await harness({ ownerId: 'owner@test', role: 'admin' }, {
      faberloomSpaces: {
        ...BASE_SERVICES.faberloomSpaces as object,
        list: async () => [space({ id: 'sp-1', workspaceId: 'ws-1', title: 'Sin agente' })],
      },
    }, '/home/SICOP')
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections.map(section => section.name)).toEqual(['faberloom:space-scope'])
    expect(installed.restrict).not.toHaveBeenCalled()
  })

  it('publishes the agent model route when the agent is routed and keyed', async () => {
    const { ctx, agent } = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: {
        resolve: () => ({
          persona: 'P', toolFilter: undefined, provider: 'openai', model: 'gpt-4o',
          credentialRef: 'FABERLOOM_AGENT_API_KEY_41', skills: [],
        }),
      },
    }, '/home/SICOP')
    expect(ctx.faberloomSessionAgent.routeFor(agent as never)).toEqual({
      provider: 'openai', model: 'gpt-4o', credentialRef: 'FABERLOOM_AGENT_API_KEY_41',
    })
  })

  it('publishes no route for an unrouted or unkeyed agent', async () => {
    const unrouted = await harness({ ownerId: 'owner@test' }, {}, '/home/SICOP')
    expect(unrouted.ctx.faberloomSessionAgent.routeFor(unrouted.agent as never)).toBeUndefined()
    const unkeyed = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: {
        resolve: () => ({ persona: 'P', toolFilter: undefined, provider: 'openai', model: 'gpt-4o', credentialRef: undefined, skills: [] }),
      },
    }, '/home/SICOP')
    expect(unkeyed.ctx.faberloomSessionAgent.routeFor(unkeyed.agent as never)).toBeUndefined()
  })

  it('drops the published route when the composed agent is disposed', async () => {
    const { ctx, agent } = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: {
        resolve: () => ({
          persona: 'P', toolFilter: undefined, provider: 'openai', model: 'gpt-4o',
          credentialRef: 'FABERLOOM_AGENT_API_KEY_41', skills: [],
        }),
      },
    }, '/home/SICOP')
    ctx.emit('agent/disposed', { agent: agent as never })
    expect(ctx.faberloomSessionAgent.routeFor(agent as never)).toBeUndefined()
  })

  it('tears down every composed fiber and route with the plugin', async () => {
    const { ctx } = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: {
        resolve: () => ({
          persona: 'P', toolFilter: undefined, provider: 'openai', model: 'gpt-4o',
          credentialRef: 'FABERLOOM_AGENT_API_KEY_41', skills: [],
        }),
      },
    }, '/home/SICOP')
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })

  it('composes a session created after mount and ignores an overlapping install', async () => {
    const { ctx, agent } = await harness({ ownerId: 'owner@test' }, {}, '/home/SICOP')
    // Already composed through `ctx.agents.list()`: a later create event is a no-op.
    ctx.emit('agent/created', { agent: agent as never, source: 'startup' })
    const late = {
      session: { header: { cwd: '/home/SICOP', parentSession: undefined } },
      ctx: { on: vi.fn(() => vi.fn()), inject: vi.fn(() => ({ dispose: vi.fn(async () => {}) })) },
    }
    ctx.emit('agent/created', { agent: late as never, source: 'startup' })
    ctx.emit('agent/created', { agent: late as never, source: 'startup' })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(ctx.faberloomSessionAgent.routeFor(late as never)).toBeUndefined()
  })

  it('composes without a tools registry', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {
      tools: undefined,
      faberloomAgentPlane: {
        resolve: () => ({ persona: 'P', toolFilter: undefined, provider: undefined, model: undefined, credentialRef: undefined, skills: [] }),
      },
    }, '/home/SICOP')
    expect(captured.cb).toBeDefined()
  })
})

describe('FaberLoomSessionAgent Space scope', () => {
  it('gives a parent Space session its whole descendant subtree', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {}, '/home/SICOP')
    const installed = scope()
    captured.cb!(installed)
    const text = sectionText(installed, 'faberloom:space-scope')
    expect(text).toContain('Space actual: Marluvas')
    expect(text).toContain('Sub Space: Costa Rica')
    expect(text).toContain('Sub Space: Colombia')
    expect(text).toContain('Sub Space: Sondel')
    expect(text).toContain('Sub Space: Muitowork Limitada')
    expect(text).toContain('/home/CR')
    expect(text).toContain('/home/SD')
  })

  it('gives a sub-Space session its own descendants and leaves siblings for a grant', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {}, '/home/CR')
    const installed = scope()
    captured.cb!(installed)
    const text = sectionText(installed, 'faberloom:space-scope')
    expect(text).toContain('Space actual: Costa Rica')
    expect(text).toContain('Sub Space: Sondel')
    expect(text).toContain('Sub Space: Muitowork Limitada')
    expect(text).not.toContain('Sub Space: Colombia')
    expect(text).toContain('Otros Spaces fuera del ámbito')
    expect(text).toContain('Colombia (id: `sp-colombia`)')
  })

  it('covers the subtree and refuses a sibling until the session grants it', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {}, '/home/CR')
    const service = captured.ctx.faberloomSessionAgent
    expect(service.coversSpace(captured.agent as never, 'sp-sondel')).toBe(true)
    expect(service.coversSpace(captured.agent as never, 'sp-colombia')).toBe(false)
    await service.grantRead(captured.agent as never, 'sp-colombia')
    expect(service.coversSpace(captured.agent as never, 'sp-colombia')).toBe(true)
    const installed = scope()
    captured.cb!(installed)
    expect(sectionText(installed, 'faberloom:space-scope')).toContain('Sub Space: Colombia')
  })

  it('refuses file-tool reads of a sibling Space until the session grants it', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {}, '/home/CR')
    const service = captured.ctx.faberloomSessionAgent
    const agent = captured.agent as never
    expect(service.denyForeignRead(agent, 'read', { file_path: '/home/SD/nota.txt' })).toBeUndefined()
    expect(service.denyForeignRead(agent, 'read', { file_path: '/home/CO/nota.txt' })).toContain('Colombia')
    expect(service.denyForeignRead(agent, 'read', { file_path: '../CO/nota.txt' })).toContain('Colombia')
    expect(service.denyForeignRead(agent, 'glob', { path: '/home/CO' })).toContain('Colombia')
    expect(service.denyForeignRead(agent, 'grep', { path: '/home/SD' })).toBeUndefined()
    expect(service.denyForeignRead(agent, 'pwsh', { command: 'Get-ChildItem /home/CO' })).toContain('Colombia')
    expect(service.denyForeignRead(agent, 'bash', { command: 'cat ../CO/nota.txt' })).toContain('Colombia')
    expect(service.denyForeignRead(agent, 'bash', { command: 'cat ../SD/nota.txt' })).toBeUndefined()
    expect(service.denyForeignRead(agent, 'read', { file_path: '/tmp/attachment.txt' })).toBeUndefined()
    await service.grantRead(agent, 'sp-colombia')
    expect(service.denyForeignRead(agent, 'read', { file_path: '/home/CO/nota.txt' })).toBeUndefined()
    expect(service.denyForeignRead(agent, 'write', { file_path: '/home/CO/nota.txt' })).toContain('solo lectura')
    expect(service.denyForeignRead(agent, 'edit', { file_path: '/home/CO/nota.txt' })).toContain('solo lectura')
    expect(service.denyForeignRead(agent, 'bash', { command: 'cat /home/CO/nota.txt' })).toContain('solo lectura')
    expect(service.denyForeignRead(agent, 'write', { file_path: '/home/SD/nota.txt' })).toBeUndefined()
  })

  it('does not treat the folder above the session Space as foreign', async () => {
    const root = '/repo/Marluvas'
    const costa = `${root}/Costa Rica`
    const captured = await harness({ ownerId: 'owner@test' }, {
      workspaceRegistry: {
        list: () => [
          { id: 'ws-1', path: root },
          { id: 'ws-2', path: costa },
          { id: 'ws-3', path: `${root}/Colombia` },
        ],
      },
      faberloomSpaces: {
        ...BASE_SERVICES.faberloomSpaces as object,
        list: async () => [
          space({ id: 'sp-marluvas', workspaceId: 'ws-1', title: 'Marluvas' }),
          space({ id: 'sp-costa', workspaceId: 'ws-2', parentId: 'sp-marluvas', title: 'Costa Rica' }),
          space({ id: 'sp-colombia', workspaceId: 'ws-3', parentId: 'sp-marluvas', title: 'Colombia' }),
        ],
      },
    }, costa)
    const service = captured.ctx.faberloomSessionAgent
    const agent = captured.agent as never
    expect(service.denyForeignRead(agent, 'read', { file_path: `${costa}/nota.txt` })).toBeUndefined()
    expect(service.denyForeignRead(agent, 'read', { file_path: `${root}/Colombia/nota.txt` })).toContain('Colombia')
  })

  it('reads the harness files of a descendant into the scope text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-scope-'))
    const child = join(root, 'Costa Rica')
    mkdirSync(join(child, '.agents'), { recursive: true })
    writeFileSync(join(child, 'AGENTS.md'), '# Costa Rica\n\nUsar la plantilla mensual.', 'utf8')
    try {
      const captured = await harness({ ownerId: 'owner@test' }, {
        workspaceRegistry: {
          list: () => [
            { id: 'ws-1', path: root },
            { id: 'ws-2', path: child },
            { id: 'ws-3', path: '/home/CO' },
            { id: 'ws-4', path: '/home/SD' },
            { id: 'ws-5', path: '/home/MW' },
          ],
        },
        faberloomSpaces: {
          ...BASE_SERVICES.faberloomSpaces as object,
          list: async () => [
            space({ id: 'sp-marluvas', workspaceId: 'ws-1', title: 'Marluvas' }),
            space({ id: 'sp-costa', workspaceId: 'ws-2', parentId: 'sp-marluvas', title: 'Costa Rica' }),
          ],
        },
      }, root)
      const installed = scope()
      captured.cb!(installed)
      const text = sectionText(installed, 'faberloom:space-scope')
      expect(text).toContain('Usar la plantilla mensual.')
      expect(text).toContain('AGENTS.md')
      expect(text).toContain('.agents/')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('shared-key usage guard', () => {
  /** The key value the deployment supplies in these cases. */
  const DEPLOYMENT_KEY = 'sk-deployment-owned'

  /** One launch environment carrying a deployment key in the inherited layer. */
  function deploymentEnvironment(values: Record<string, string> = { DEEPSEEK_API_KEY: DEPLOYMENT_KEY }): never {
    return createLaunchEnvironmentSnapshot([{ source: 'process', values }]) as never
  }

  /** One human message as the loop assembles it. */
  function human(text: string): never {
    return {
      id: `m-${text.length}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    } as never
  }

  /** One request the agent loop would send. */
  function request(text: string, credentialRef?: string): never {
    return {
      provider: 'deepseek', model: 'deepseek-chat', sessionId: 'session-1',
      messages: [human(text)],
      ...credentialRef === undefined ? {} : { credentialRef },
    } as never
  }

  /** Drain one streamed answer. */
  async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const chunks: unknown[] = []
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }

  /** The text of the first chunk of a drained answer. */
  function firstText(chunks: unknown[]): string {
    const first = chunks[0] as { text?: string } | undefined
    return first?.text ?? ''
  }

  it('refuses a personal request and lets a work request through', async () => {
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const refused = await drain(ctx.waterfall('llm/stream', request('resumime esta presentación y hacé un resumen'), next as never))
    expect(firstText(refused)).toContain('llave compartida')
    expect(next).not.toHaveBeenCalled()

    const allowed = await drain(ctx.waterfall('llm/stream', request('decime en qué estado está el pedido 505244'), next as never))
    expect(next).toHaveBeenCalledTimes(1)
    expect(allowed).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('lets a personal request through when the account stored its own key', async () => {
    const credentials = { resolve: async () => ({ value: 'sk-account-owned', source: 'file' }) }
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { credentials, launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    await drain(ctx.waterfall('llm/stream', request('resumime esta presentación personal'), next as never))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('lets a business question that names the product instead of the tool', async () => {
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    // The exact turn a client sent: no product name, no tool name, and still a
    // work request about a supplier's purchases.
    await drain(ctx.waterfall(
      'llm/stream',
      request('Dime cual es el calzado que más ha comprado Sondel este año 2026.'),
      next as never,
    ))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('still refuses a personal errand phrased as a purchase', async () => {
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const refused = await drain(ctx.waterfall(
      'llm/stream',
      request('compré un regalo para mi mamá y quiero ideas'),
      next as never,
    ))
    expect(firstText(refused)).toContain('llave compartida')
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps the policy when the store holds a copy of the deployment key', async () => {
    const credentials = { resolve: async () => ({ value: DEPLOYMENT_KEY, source: 'file' }) }
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { credentials, launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const refused = await drain(ctx.waterfall('llm/stream', request('resumime esta presentación personal'), next as never))
    expect(firstText(refused)).toContain('llave compartida')
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps the policy for a provider the deployment supplies', async () => {
    const credentials = { resolve: async () => ({ value: 'sk-deployment-openai', source: 'env' }) }
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      {
        credentials,
        launchEnvironment: deploymentEnvironment({ DEEPSEEK_API_KEY: DEPLOYMENT_KEY, OPENAI_API_KEY: 'sk-deployment-openai' }),
      },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const refused = await drain(ctx.waterfall('llm/stream', request('resumime esta presentación personal', 'OPENAI_API_KEY'), next as never))
    expect(firstText(refused)).toContain('llave compartida')
    expect(next).not.toHaveBeenCalled()
  })

  it('lets another provider through when the account stored its own key there', async () => {
    const credentials = { resolve: async () => ({ value: 'sk-account-anthropic', source: 'file' }) }
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      {
        credentials,
        launchEnvironment: deploymentEnvironment({ DEEPSEEK_API_KEY: DEPLOYMENT_KEY, ANTHROPIC_API_KEY: 'sk-deployment-anthropic' }),
      },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    await drain(ctx.waterfall('llm/stream', request('resumime esta presentación personal', 'ANTHROPIC_API_KEY'), next as never))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('denies a non-product tool for a shared-key session and allows it with the account key', async () => {
    const credentials = { resolve: async () => ({ value: 'shared', source: 'env' }) }
    const { ctx, agent } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { credentials, launchEnvironment: deploymentEnvironment() },
      '/home/CR',
    )
    const next = vi.fn(async () => ({ kind: 'allow' }))
    await expect(ctx.waterfall('tools/pre-execute', { name: 'bash', agent } as never, next as never)).resolves.toMatchObject({ kind: 'deny' })
    // Search tools read inside the session's readable roots without a shell.
    await expect(ctx.waterfall('tools/pre-execute', { name: 'grep', agent, arguments: { path: '/home/CR' } } as never, next as never))
      .resolves.toEqual({ kind: 'allow' })
    await expect(ctx.waterfall('tools/pre-execute', { name: 'glob', agent, arguments: { path: '/home/CR' } } as never, next as never))
      .resolves.toEqual({ kind: 'allow' })
    // A sibling Space stays refused until the session records a read grant.
    await expect(ctx.waterfall('tools/pre-execute', { name: 'grep', agent, arguments: { path: '/home/CO' } } as never, next as never))
      .resolves.toMatchObject({ kind: 'deny' })
    await expect(ctx.waterfall('tools/pre-execute', { name: 'mcp__mwt__expediente_listar', agent } as never, next as never))
      .resolves.toEqual({ kind: 'allow' })

    // The same session switches to the account's own key: its tools open up.
    credentials.resolve = async () => ({ value: 'own', source: 'file' })
    const stream = vi.fn(async function* () { yield { type: 'finish', reason: { kind: 'stop' as const } } })
    await drain(ctx.waterfall('llm/stream', request('resumime esta presentación personal'), stream as never))
    await expect(ctx.waterfall('tools/pre-execute', { name: 'bash', agent } as never, next as never)).resolves.toEqual({ kind: 'allow' })
  })

  it('continues a work turn after a tool result and never limits internal calls', async () => {
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const continued = {
      provider: 'deepseek', model: 'deepseek-chat', sessionId: 'session-1',
      messages: [
        human('decime el estado del pedido 505244'),
        {
          id: 'm-tool', role: 'user', content: [{ type: 'text', text: 'EN_DESTINO' }],
          source: { kind: 'tool', callId: 'call-1' },
        },
      ],
    } as never
    await drain(ctx.waterfall('llm/stream', continued, next as never))
    expect(next).toHaveBeenCalledTimes(1)

    // A short follow-up with no work word left is the classifier's call now.
    await drain(ctx.waterfall('llm/stream', request('hacé un resumen'), next as never))
    expect(next).toHaveBeenCalledTimes(2)

    const internal = {
      provider: 'deepseek', model: 'deepseek-chat',
      messages: [human('hacé un resumen')],
    } as never
    await drain(ctx.waterfall('llm/stream', internal, next as never))
    expect(next).toHaveBeenCalledTimes(3)
  })

  it('understands a paraphrase the vocabulary does not contain', async () => {
    const { ctx } = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment() },
      '/home/SICOP',
    )
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    // No work term at all: the classifier reads the intent.
    await drain(ctx.waterfall('llm/stream', request('armame un informe trimestral de lo que le mandamos a Sondel'), next as never))
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('follows the declared fallback when the classifier cannot answer', async () => {
    const broken = {
      stream: async function* () {
        throw new Error('classifier unavailable')
      },
    }
    const allowed = await harness(
      { ownerId: 'owner@test', role: 'client_b2b' },
      { launchEnvironment: deploymentEnvironment(), llm: broken },
      '/home/SICOP',
    )
    const allowNext = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    await drain(allowed.ctx.waterfall('llm/stream', request('dame una mano con esto'), allowNext as never))
    expect(allowNext).toHaveBeenCalledTimes(1)

    const refused = await harness(
      { ownerId: 'owner@test', role: 'client_b2b', scopeFallback: 'refuse' },
      { launchEnvironment: deploymentEnvironment(), llm: broken },
      '/home/SICOP',
    )
    const refuseNext = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' as const } }
    })
    const chunks = await drain(refused.ctx.waterfall('llm/stream', request('dame una mano con esto'), refuseNext as never))
    expect(firstText(chunks)).toContain('llave compartida')
    expect(refuseNext).not.toHaveBeenCalled()
  })
})
