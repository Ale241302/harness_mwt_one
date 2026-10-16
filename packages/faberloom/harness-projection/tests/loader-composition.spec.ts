/**
 * The projection through the real Loader: a package-owned `cordis.yml` boots
 * the storage hub, the domain form, the six product domains, the workspace
 * registry, the skill registry, and the projection row. A Workspace registered
 * in that composition, carrying a mirrored Space with an agent, a routine, a
 * work flow, memory, and context, is projected into its own directory; the
 * second run retires what stopped belonging to the scope.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as skillPlugin from '@deepseek-ai/dsh-skill'
import * as storagePlugin from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as workspacePlugin from '@deepseek-ai/dsh-workspace'
import * as projectionPlugin from '../src/index.ts'
import * as memoryStoragePlugin from './fixtures/memory-storage.ts'
import * as productDomainsPlugin from './fixtures/product-domains.ts'
import * as sessionPersistencePlugin from './fixtures/session-persistence.ts'

/** ISO-8601 instant every seeded record carries. */
const AT = '2026-01-01T00:00:00.000Z'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write one record into one open product domain table. */
async function put(ctx: Context, domain: string, table: string, key: string, record: unknown): Promise<void> {
  const live = ctx.storageDomain.get(domain)
  if (live === undefined) throw new Error(`domain ${domain} is not open`)
  await live.table(table).put(key, record)
}

/** The Space the composition's Workspace mirrors, with the agents and records of the scope. */
function spaceRecord(workspaceId: string | null): Record<string, unknown> {
  return {
    ownerId: 'compras@sondelsa.com',
    companyId: null,
    title: 'SICOP',
    parentId: null,
    inheritContext: true,
    excluded: [],
    members: [],
    context: { area: 'compras' },
    prompt: '',
    sources: [],
    agentId: 'ag-compras',
    workspaceId,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
  }
}

/** The catalog agent in charge of the Space. */
function agentRecord(active: boolean): Record<string, unknown> {
  return {
    name: 'Compras',
    responsibility: 'Gestiona pedidos y proformas',
    spaceId: 'sp-sicop',
    detached: false,
    ownerId: 'compras@sondelsa.com',
    seeded: false,
    origin: 'scratch',
    originRef: null,
    baseAgentId: null,
    skills: ['informe-diario'],
    tools: [],
    subagents: [],
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKey: null,
    hasApiKey: false,
    apiKeyTail: null,
    webAccess: false,
    mwtMcp: true,
    sicopMcp: true,
    mailConnectionIds: [],
    policy: { primary: null, exclusive: false, fallbacks: [], escalation: null, budget: null },
    lessons: [],
    active,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  }
}

describe('harness projection real Loader composition', () => {
  it('projects a registered Workspace from cordis.yml and retires what left the scope', async () => {
    root = await mkdtemp(join(tmpdir(), 'faberloom-projection-loader-'))
    const ctx = context = new Context()
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', storagePlugin],
      ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
      ['@deepseek-ai/dsh-workspace', workspacePlugin],
      ['@deepseek-ai/dsh-skill', skillPlugin],
      ['@deepseek-ai/dsh-faberloom-harness-projection', projectionPlugin],
      ['./memory-storage.ts', memoryStoragePlugin],
      ['./product-domains.ts', productDomainsPlugin],
      ['./session-persistence.ts', sessionPersistencePlugin],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const workspace = await ctx.workspaceRegistry.create(root)
    await put(ctx, 'faberloom_spaces', 'spaces', 'sp-sicop', spaceRecord(String(workspace.id)))
    await put(ctx, 'faberloom_agents', 'agents', 'ag-compras', agentRecord(true))
    await put(ctx, 'faberloom_agents', 'agents', 'ag-otro', { ...agentRecord(true), name: 'Ventas', spaceId: 'sp-otro' })
    await put(ctx, 'faberloom_routines', 'routines', 'rt-1', {
      ownerId: 'compras@sondelsa.com',
      name: 'Pedido a proforma',
      status: 'active',
      version: 1,
      definition: {
        intent: 'emitir la proforma',
        triggers: [],
        steps: [],
        expectedResult: 'proforma',
        permissions: [],
        failurePolicy: 'stop',
        maxConcurrency: null,
      },
      spaceId: 'sp-sicop',
      visibility: 'shared',
      createdAt: AT,
      updatedAt: AT,
    })
    await put(ctx, 'faberloom_workflows', 'workflows', 'wf-1', {
      ownerId: 'compras@sondelsa.com',
      scope: { kind: 'space', spaceId: 'sp-sicop' },
      name: 'Alta de cliente',
      status: 'draft',
      version: 1,
      definition: { intent: 'alta', nodes: [], edges: [], permissions: [], failurePolicy: 'stop' },
      routineId: null,
      visibility: 'shared',
      createdAt: AT,
      updatedAt: AT,
    })
    await put(ctx, 'faberloom_memory', 'teachings', 't-1', {
      ownerId: 'compras@sondelsa.com',
      scope: 'space',
      spaceId: 'sp-sicop',
      agentId: null,
      skill: null,
      task: null,
      text: 'El descuento de cliente se consulta en MWT.ONE',
      source: 'manual',
      author: 'compras@sondelsa.com',
      status: 'active',
      version: 1,
      supersedes: null,
      uses: [],
      createdAt: AT,
      updatedAt: AT,
    })
    await put(ctx, 'faberloom_context', 'entries', 'ce-1', {
      spaceId: 'sp-sicop',
      title: 'Tarifas',
      body: 'El catálogo vigente vive en MWT.ONE.',
      version: 1,
      visibility: 'shared',
      authorId: 'compras@sondelsa.com',
      ownerId: 'compras@sondelsa.com',
      createdAt: AT,
      updatedAt: AT,
      origin: 'local',
      consoleId: null,
    })
    ctx.skills.register({
      name: 'informe-diario',
      description: 'Redacta el informe diario de compras',
      content: 'Resume los pedidos del día.',
      source: 'user-dsh',
    })
    await writeFile(join(root, 'notas.md'), 'archivo del usuario', 'utf8')

    const projection = ctx.faberloomHarnessProjection
    expect(projection).toBeDefined()
    const report = await projection.refresh({ kind: 'workspace', id: workspace.id, title: workspace.title })
    expect(report?.written).toContain('AGENTS.md')
    expect(report?.usage.agents.map(agent => agent.name)).toEqual(['Compras'])
    expect(report?.usage.unreadableDomains).toEqual([])

    const instructions = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(instructions).toContain('# Harness de Workspace: ')
    expect(instructions).toContain('- `compras` — Gestiona pedidos y proformas (modelo: `deepseek/deepseek-chat`)')
    expect(instructions).toContain('- `informe-diario` — Redacta el informe diario de compras')
    expect(instructions).toContain('Pedido a proforma')
    expect(instructions).toContain('Alta de cliente')
    expect(instructions).toContain('El descuento de cliente se consulta en MWT.ONE')
    expect(instructions).toContain('`Tarifas`')
    expect(instructions).not.toContain('Ventas')
    expect(await readFile(join(root, '.kimi/AGENTS.md'), 'utf8')).toBe(instructions)
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe(instructions)
    expect(await readFile(join(root, 'GEMINI.md'), 'utf8')).toBe(instructions)
    expect(await readFile(join(root, '.gemini/AGENTS.md'), 'utf8')).toBe(instructions)
    expect(await readFile(join(root, '.agents/compras.md'), 'utf8')).toContain('name: "compras"')
    expect(await readFile(join(root, '.agents/compras.md'), 'utf8')).toContain('description: "Gestiona pedidos y proformas"')
    expect(await readFile(join(root, '.claude/agents/compras.md'), 'utf8')).toContain('model: "deepseek/deepseek-chat"')
    expect(await readFile(join(root, '.kimi/agents/compras.md'), 'utf8')).toContain('## Skills declaradas')
    expect(await readFile(join(root, '.claude/skills/informe-diario/SKILL.md'), 'utf8')).toContain('Resume los pedidos del día.')
    expect(JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'))).toEqual({ permissions: { allow: [], deny: [] } })
    const manifest = JSON.parse(await readFile(join(root, '.faberloom/harness.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('.claude/skills/informe-diario/SKILL.md')
    expect(manifest.files).not.toContain('.faberloom/harness.json')

    // The agent leaves the scope, so its definition stops belonging to it.
    await put(ctx, 'faberloom_agents', 'agents', 'ag-compras', agentRecord(false))
    const second = await projection.refresh({ kind: 'workspace', id: workspace.id, title: workspace.title })
    expect(second?.pruned).toEqual(expect.arrayContaining([
      '.agents/compras.md',
      '.claude/agents/compras.md',
      '.kimi/agents/compras.md',
    ]))
    await expect(readFile(join(root, '.agents/compras.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'notas.md'), 'utf8')).toBe('archivo del usuario')
    expect(await readFile(join(root, '.claude/settings.json'), 'utf8')).toContain('permissions')
  }, 30_000)
})
