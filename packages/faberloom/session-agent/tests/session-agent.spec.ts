import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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
    expect(installed.sections[0]).toMatchObject({ name: 'deployment:persona-prefix', order: 5, text: 'Mantener las reglas' })
    expect(installed.sections[1]).toMatchObject({ name: 'faberloom:space-directive', text: 'Mantén el foco en SICOP.' })
    expect(installed.sections[2]?.text).toContain('Skills asignadas: docx')
    expect(installed.restrict).toHaveBeenCalledWith({ deny: ['mcp__sicop__x'] })
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
    expect(installed.sections.map(section => section.name)).toEqual(['deployment:persona-prefix', 'faberloom:space-scope'])
    expect(installed.restrict).not.toHaveBeenCalled()
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
    expect(installed.sections.map(section => section.name)).toEqual(['faberloom:space-scope'])
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
      expect(installed.sections.map(section => section.name), missing).toEqual(['faberloom:space-scope'])
    }
  })

  it('does not compose a session outside a mirrored Space', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, '/home/OTRO')).cb).toBeUndefined()
  })

  it('still reads the Space scope when the Space has no responsible agent', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {
      faberloomSpaces: {
        ...BASE_SERVICES.faberloomSpaces as object,
        list: async () => [space({ id: 'sp-1', workspaceId: 'ws-1', title: 'Sin agente' })],
      },
    }, '/home/SICOP')
    expect(captured.cb).toBeDefined()
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections.map(section => section.name)).toEqual(['faberloom:space-scope'])
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
