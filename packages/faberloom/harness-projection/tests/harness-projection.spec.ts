/**
 * The harness projection: what each product record shape contributes to one
 * scope's usage, what the generated files contain, and what a run writes,
 * prunes, and retires in the scope directory.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { FaberLoomSpaceId } from '@deepseek-ai/dsh-faberloom-spaces'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import FaberLoomHarnessProjection, { DEFAULT_SCOPE_RULES, INSTRUCTION_BLOCK_START, MANIFEST_PATH, mergeInstructions, planProjection, renderAgentDocument, renderAgentsIndex, renderInstructions, renderManifest, renderSettings, renderSkillDocument, readScopeUsage, resolveScopeSpace } from '../src/index.ts'
import type { Config, HarnessDomainSource, HarnessScope, HarnessSkillLookup, HarnessUsage } from '../src/index.ts'

/** ISO-8601 instant every hand-written record carries. */
const AT = '2026-01-01T00:00:00.000Z'

/** A Space scope whose Space record is seeded under the id `sp-1`. */
const SPACE_SCOPE: HarnessScope = { kind: 'space', id: brandString<FaberLoomSpaceId>('sp-1'), title: 'SICOP' }

/** A Workspace scope whose Workspace id is `ws-1`. */
const WORKSPACE_SCOPE: HarnessScope = { kind: 'workspace', id: brandString<WorkspaceId>('ws-1'), title: 'Formatos' }

/** One domain table's rows: key to stored record. */
type TableRows = Record<string, Record<string, unknown>>

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/**
 * A domain source over hand-written rows. `missingTables` names the tables a
 * domain exposes no handle for, so a build whose spec lacks one reads the same
 * as a domain nobody opened.
 * @param rows - domain name to table name to rows.
 * @param missingTables - `domain/table` names whose handle the domain refuses.
 * @returns the domain source the reader traverses.
 */
function fakeSource(rows: Record<string, TableRows>, missingTables: readonly string[] = []): HarnessDomainSource {
  return {
    get(name) {
      const tables = rows[name]
      if (tables === undefined) return undefined
      return {
        table(tableName) {
          if (missingTables.includes(`${name}/${tableName}`)) throw new Error(`domain '${name}' declares no table '${tableName}'`)
          return { entries: () => Object.entries(tables[tableName] ?? {})[Symbol.iterator]() }
        },
      }
    },
  }
}

/** One stored Space row. */
function spaceRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: 'SICOP', agentId: 'ag-1', workspaceId: null, createdAt: AT, ...over }
}

/** One stored catalog-agent row. */
function agentRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Compras',
    responsibility: 'Gestiona pedidos',
    spaceId: 'sp-1',
    active: true,
    provider: 'deepseek',
    model: 'deepseek-chat',
    skills: [],
    ...over,
  }
}

/** The six domains of one scope, with the named records seeded. */
function scopeRows(over: Partial<Record<string, TableRows>> = {}): Record<string, TableRows> {
  return {
    faberloom_spaces: { spaces: { 'sp-1': spaceRow() }, memory: {} },
    faberloom_agents: { agents: {} },
    faberloom_workflows: { workflows: {} },
    faberloom_routines: { routines: {} },
    faberloom_memory: { teachings: {} },
    faberloom_context: { entries: {} },
    ...over,
  }
}

/**
 * Boot the projection service over a provided domain source.
 * @param options - the config and the provided optional services.
 * @returns the booted context.
 */
async function harness(options: {
  config?: Config
  rows?: Record<string, TableRows>
  missingTables?: readonly string[]
  skills?: HarnessSkillLookup
  registry?: { get(id: WorkspaceId): { readonly path: string } | undefined }
} = {}): Promise<Context> {
  const ctx = new Context()
  ctx.provide('storageDomain', fakeSource(options.rows ?? scopeRows(), options.missingTables) as unknown as DomainFacility)
  if (options.skills !== undefined) ctx.provide('skills', options.skills as unknown as SkillRegistry)
  if (options.registry !== undefined) ctx.provide('workspaceRegistry', options.registry as never)
  await ctx.plugin(FaberLoomHarnessProjection, options.config ?? {})
  return ctx
}

/** A temporary scope directory the run writes into. */
async function scopeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'faberloom-projection-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('readScopeUsage', () => {
  it('reads the records of one Space and sorts them', async () => {
    const rows = scopeRows({
      faberloom_spaces: { spaces: { 'sp-1': spaceRow() }, memory: { 'm-2': { spaceIds: ['sp-1'], text: 'Segunda' }, 'm-1': { spaceIds: ['sp-1'], text: 'Primera' } } },
      faberloom_agents: {
        agents: {
          'ag-2': agentRow({ name: 'Ventas', skills: ['informe-diario'] }),
          'ag-1': agentRow({ name: 'Compras', skills: ['informe-diario', 'alta-cliente'] }),
          'ag-3': agentRow({ name: 'Compras' }),
          'ag-9': agentRow({ name: 'Otro espacio', spaceId: 'sp-9' }),
        },
      },
      faberloom_workflows: { workflows: { 'wf-2': { name: 'Zeta', status: 'active', scope: { kind: 'space', spaceId: 'sp-1' } }, 'wf-1': { name: 'Alta', status: 'draft', scope: { kind: 'space', spaceId: 'sp-1' } }, 'wf-3': { name: 'Alta', status: 'draft', scope: { kind: 'space', spaceId: 'sp-1' } } } },
      faberloom_routines: { routines: { 'rt-1': { name: 'Pedido', status: 'active', spaceId: 'sp-1' }, 'rt-2': { name: 'Pedido', status: 'paused', spaceId: 'sp-1' } } },
      faberloom_memory: { teachings: { 't-1': { scope: 'space', spaceId: 'sp-1', status: 'active', text: 'Tarifa' } } },
      faberloom_context: { entries: { 'ce-1': { spaceId: 'sp-1', title: 'Tarifas' }, 'ce-2': { spaceId: 'sp-1', title: 'Tarifas' } } },
    })
    const usage = await readScopeUsage(fakeSource(rows), SPACE_SCOPE, {
      get: name => Promise.resolve(name === 'alta-cliente' ? undefined : { name, description: `Para ${name}`, content: `Cuerpo de ${name}` }),
    })

    expect(usage.spaceId).toBe('sp-1')
    expect(usage.agents.map(agent => agent.id)).toEqual(['ag-1', 'ag-3', 'ag-2'])
    expect(usage.agents[0]).toMatchObject({ id: 'ag-1', name: 'Compras', provider: 'deepseek', model: 'deepseek-chat' })
    expect(usage.skills).toEqual([{ name: 'informe-diario', description: 'Para informe-diario', content: 'Cuerpo de informe-diario' }])
    expect(usage.unresolvedSkills).toEqual(['alta-cliente'])
    expect(usage.workflows.map(entry => entry.id)).toEqual(['wf-1', 'wf-3', 'wf-2'])
    expect(usage.routines.map(entry => entry.id)).toEqual(['rt-1', 'rt-2'])
    expect(usage.memory.map(entry => entry.id)).toEqual(['m-1', 'm-2', 't-1'])
    expect(usage.context.map(entry => entry.id)).toEqual(['ce-1', 'ce-2'])
    expect(usage.unreadableDomains).toEqual([])
  })

  it('reads a Workspace scope through the Space mirroring it, oldest first', async () => {
    const rows = scopeRows({
      faberloom_spaces: {
        spaces: {
          'sp-young': spaceRow({ title: 'Joven', createdAt: '2026-02-01T00:00:00.000Z', workspaceId: 'ws-1', agentId: null }),
          'sp-old': spaceRow({ title: 'Viejo', createdAt: '2026-01-01T00:00:00.000Z', workspaceId: 'ws-1' }),
          'sp-tie-b': spaceRow({ title: 'Empate B', createdAt: '2026-01-01T00:00:00.000Z', workspaceId: 'ws-1' }),
        },
      },
      faberloom_agents: { agents: { 'ag-1': agentRow({ spaceId: null }) } },
    })
    const usage = await readScopeUsage(fakeSource(rows), WORKSPACE_SCOPE)
    expect(usage.spaceId).toBe('sp-old')
    const resolved = resolveScopeSpace(fakeSource(rows), WORKSPACE_SCOPE)
    expect(resolved.kind).toBe('found')
    expect(resolved.kind === 'found' ? resolved.space.title : undefined).toBe('Viejo')

    const tied = await readScopeUsage(fakeSource(scopeRows({
      faberloom_spaces: { spaces: { 'sp-old': spaceRow({ workspaceId: 'ws-1' }), 'sp-young': spaceRow({ title: 'Joven', workspaceId: 'ws-1' }), 'sp-tie-b': spaceRow({ title: 'Empate B', workspaceId: 'ws-1' }) } },
    })), WORKSPACE_SCOPE)
    expect(tied.spaceId).toBe('sp-old')
    // The responsible agent is included even when it is stored under another Space.
    expect((await readScopeUsage(fakeSource(scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow({ spaceId: null }) } } })), SPACE_SCOPE)).agents.map(agent => agent.id)).toEqual(['ag-1'])
  })

  it('reports a Workspace no Space mirrors and an unreadable spaces domain as empty scopes', async () => {
    const projectionless = await readScopeUsage(fakeSource(scopeRows()), WORKSPACE_SCOPE)
    expect(projectionless).toMatchObject({ spaceId: undefined, agents: [], unreadableDomains: [] })
    expect(resolveScopeSpace(fakeSource(scopeRows()), WORKSPACE_SCOPE)).toEqual({ kind: 'projectionless' })

    const unreadable = await readScopeUsage(fakeSource({}), SPACE_SCOPE)
    expect(unreadable).toMatchObject({ spaceId: undefined, agents: [], unreadableDomains: ['faberloom_spaces'] })
    expect(resolveScopeSpace(fakeSource({}), SPACE_SCOPE)).toEqual({ kind: 'unreadable' })
  })

  it('refuses a Space scope whose Space the open spaces domain does not hold', async () => {
    await expect(readScopeUsage(fakeSource(scopeRows({ faberloom_spaces: { spaces: {}, memory: {} } })), SPACE_SCOPE))
      .rejects.toThrow('faberloom: space sp-1 is not registered')
    expect(resolveScopeSpace(fakeSource(scopeRows({ faberloom_spaces: { spaces: {}, memory: {} } })), SPACE_SCOPE)).toEqual({ kind: 'absent' })
  })

  it('names every domain it cannot read instead of reading it as empty', async () => {
    const usage = await readScopeUsage(fakeSource({ faberloom_spaces: { spaces: { 'sp-1': spaceRow() }, memory: {} } }), SPACE_SCOPE)
    expect(usage.unreadableDomains).toEqual([
      'faberloom_agents',
      'faberloom_workflows',
      'faberloom_routines',
      'faberloom_memory',
      'faberloom_context',
    ])
  })

  it('reports a declared table a domain refuses', async () => {
    const usage = await readScopeUsage(
      fakeSource(scopeRows({ faberloom_agents: { agents: {} } }), ['faberloom_spaces/memory', 'faberloom_agents/agents']),
      SPACE_SCOPE,
    )
    expect(usage.unreadableDomains).toEqual(['faberloom_agents', 'faberloom_spaces.memory'])
  })

  it('reads a record whose fields are absent or mistyped without inventing values', async () => {
    const rows = scopeRows({
      faberloom_spaces: {
        spaces: { 'sp-1': { title: 7, agentId: 3, workspaceId: 5, createdAt: 1 } },
        memory: { 'm-1': { spaceIds: 'sp-1', text: 9 } },
      },
      faberloom_agents: { agents: { 'ag-1': { active: true, spaceId: 'sp-1' }, 'ag-2': null, 'ag-3': 'no-objeto' } },
      faberloom_context: { entries: { 'ce-1': { spaceId: 'sp-1' }, 'ce-2': { spaceId: null, title: 'Personal' } } },
    })
    const usage = await readScopeUsage(fakeSource(rows), SPACE_SCOPE)

    expect(usage.spaceId).toBe('sp-1')
    expect(usage.agents).toEqual([{ id: 'ag-1', name: 'ag-1', responsibility: '', provider: undefined, model: undefined, skills: [] }])
    expect(usage.memory).toEqual([])
    expect(usage.context).toEqual([{ id: 'ce-1', title: 'ce-1' }])
  })

  it('leaves every declared skill unresolved when no provider is mounted', async () => {
    const usage = await readScopeUsage(
      fakeSource(scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow({ skills: ['sin-proveedor'] }) } } })),
      SPACE_SCOPE,
    )
    expect(usage.skills).toEqual([])
    expect(usage.unresolvedSkills).toEqual(['sin-proveedor'])
  })

  it('refuses a declared skill name the shipped grammar does not accept', async () => {
    const usage = await readScopeUsage(
      fakeSource(scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow({ skills: ['../../escape'] }) } } })),
      SPACE_SCOPE,
      { get: () => Promise.resolve({ name: '../../escape', description: 'x', content: 'y' }) },
    )
    expect(usage.skills).toEqual([])
    expect(usage.unresolvedSkills).toEqual(['../../escape'])
  })

  it('excludes records whose scope belongs elsewhere', async () => {
    const rows = scopeRows({
      faberloom_agents: { agents: { 'ag-1': agentRow({ active: false }), 'ag-2': agentRow({ name: 'Inactivo', active: 'si' }) } },
      faberloom_workflows: { workflows: { 'wf-1': { name: 'Personal', status: 'draft', scope: { kind: 'personal' } }, 'wf-2': { name: 'Otro', status: 'draft', scope: { kind: 'space', spaceId: 'sp-9' } }, 'wf-3': { name: 'Sin alcance', status: 'draft' } } },
      faberloom_routines: { routines: { 'rt-1': { name: 'Personal', status: 'active', spaceId: null }, 'rt-2': { name: 'Otro', status: 'active' } } },
      faberloom_memory: { teachings: { 't-global': { scope: 'global', spaceId: null, status: 'active', text: 'Global' }, 't-draft': { scope: 'space', spaceId: 'sp-1', status: 'candidate', text: 'Candidata' } } },
    })
    const usage = await readScopeUsage(fakeSource(rows), SPACE_SCOPE)
    expect(usage.agents).toEqual([])
    expect(usage.workflows).toEqual([])
    expect(usage.routines).toEqual([])
    expect(usage.memory).toEqual([])
  })
})

describe('generated files', () => {
  const usage: HarnessUsage = {
    spaceId: 'sp-1',
    agents: [
      { id: 'ag-1', name: 'Compras', responsibility: 'Gestiona pedidos\ny proformas', provider: 'deepseek', model: 'deepseek-chat', skills: ['informe-diario'] },
      { id: 'ag-2', name: 'VENTAS', responsibility: 'Atiende clientes', provider: undefined, model: undefined, skills: [] },
      { id: 'ag-3', name: 'compras', responsibility: 'Duplicado', provider: undefined, model: undefined, skills: [] },
    ],
    skills: [{ name: 'informe-diario', description: 'Redacta el informe', content: 'Resume los pedidos.\n' }],
    unresolvedSkills: ['sin-catalogo'],
    workflows: [{ id: 'wf-1', name: 'Alta de | cliente', status: 'draft' }],
    routines: [{ id: 'rt-1', name: 'Pedido', status: 'active' }],
    memory: [{ id: 'm-1', text: 'El descuento\nse consulta', source: 'space' }],
    context: [{ id: 'ce-1', title: 'Tarifas' }],
    unreadableDomains: ['faberloom_memory'],
  }

  it('renders the instructions with every section, folding and capping the lists', () => {
    const text = renderInstructions({ scope: SPACE_SCOPE, root: '/tmp/sicop', generatedAt: AT, usage, maxListEntries: 2 })
    expect(text).toContain('# Harness de Space: SICOP')
    expect(text).toContain('- `compras` — Gestiona pedidos y proformas (modelo: `deepseek/deepseek-chat`)')
    expect(text).toContain('- `ventas` — Atiende clientes')
    expect(text).toContain('- … y 1 más.')
    expect(text).toContain('- `informe-diario` — Redacta el informe')
    expect(text).toContain('- `Alta de | cliente` (draft)')
    expect(text).toContain('- `Pedido` (active)')
    expect(text).toContain('- El descuento se consulta')
    expect(text).toContain('- `Tarifas`')
    expect(text).toContain('Skills declaradas sin definición cargable: `sin-catalogo`.')
    expect(text).toContain('Registros no leídos (dominio no abierto en este proceso): `faberloom_memory`.')
    expect(text).toContain('## Reglas por defecto del ámbito')
    expect(text).toContain('- Antes de leer código para responder o cambiar algo, consulta el grafo del proyecto')
    expect(text).toContain('`graphify-out/GRAPH_REPORT.md` queda para revisar la arquitectura de conjunto.')
    expect(text).toContain('ejecuta `graphify update .`')
    expect(text).toContain('dibuja con la skill `archify`')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('carries the default rules into every projection, even one with no record', () => {
    const empty: HarnessUsage = {
      spaceId: undefined,
      agents: [],
      skills: [],
      unresolvedSkills: [],
      workflows: [],
      routines: [],
      memory: [],
      context: [],
      unreadableDomains: [],
    }
    const instructions = renderInstructions({ scope: WORKSPACE_SCOPE, root: '/tmp/formatos', generatedAt: AT, usage: empty, maxListEntries: 1 })

    // The two knowledge tools the product ships are the scope's own default: a
    // fresh folder reaches for its graph before reading files, without anybody
    // writing that rule into its instructions by hand.
    expect(DEFAULT_SCOPE_RULES).toHaveLength(4)
    for (const rule of DEFAULT_SCOPE_RULES) expect(instructions).toContain(rule)
    expect(instructions.indexOf('## Reglas por defecto del ámbito')).toBeLessThan(instructions.indexOf('## Cómo trabajar en este ámbito'))
  })

  it('omits the sections a scope has nothing for', () => {
    const empty: HarnessUsage = {
      spaceId: undefined,
      agents: [],
      skills: [],
      unresolvedSkills: [],
      workflows: [],
      routines: [],
      memory: [],
      context: [],
      unreadableDomains: [],
    }
    const text = renderInstructions({ scope: WORKSPACE_SCOPE, root: '/tmp/formatos', generatedAt: AT, usage: empty, maxListEntries: 1 })
    expect(text).toContain('# Harness de Workspace: Formatos')
    expect(text).not.toContain('## Agentes del ámbito')
    expect(text).not.toContain('## Skills del ámbito')
    expect(text).toContain('## Cómo trabajar en este ámbito')
    expect(text).not.toContain('sin definición cargable')
    expect(text).not.toContain('no leídos')
  })

  it('replaces only its own block and keeps the notes written around it', () => {
    const empty: HarnessUsage = {
      spaceId: undefined, agents: [], skills: [], unresolvedSkills: [], workflows: [], routines: [],
      memory: [], context: [], unreadableDomains: [],
    }
    const generated = renderInstructions({ scope: WORKSPACE_SCOPE, root: '/tmp/formatos', generatedAt: AT, usage: empty, maxListEntries: 1 })
    // A file that never carried the markers and is not a previous projection is
    // the operator's own: its text stays and the block lands after it.
    const handwritten = mergeInstructions('# Mis notas\n\nNo toques la carpeta de clientes.\n', generated)
    expect(handwritten.startsWith('# Mis notas\n\nNo toques la carpeta de clientes.\n\n')).toBe(true)
    expect(handwritten).toContain(INSTRUCTION_BLOCK_START)
    // A second pass replaces the block in place instead of appending another.
    const replaced = mergeInstructions(handwritten.replace('Formatos', 'Otro'), generated)
    expect(replaced.match(/faberloom:begin/gu)).toHaveLength(1)
    expect(replaced).toContain('Mis notas')
    expect(replaced).toContain('Formatos')
    expect(replaced).not.toContain('Otro')
    // A full projection written before the markers existed is replaced whole.
    const legacy = '# Harness de Workspace: Formatos\n\nTexto viejo.\n'
    expect(mergeInstructions(legacy, generated)).toBe(generated)
  })

  it('renders one agent definition per client and the agents index', () => {
    const withModel = renderAgentDocument(usage.agents[0] as (typeof usage.agents)[number], 'compras')
    expect(withModel).toBe([
      '---',
      'name: "compras"',
      'description: "Gestiona pedidos y proformas"',
      'model: "deepseek/deepseek-chat"',
      '---',
      '',
      'Gestiona pedidos y proformas',
      '',
      '## Skills declaradas',
      '',
      '- `informe-diario`',
      '',
    ].join('\n'))
    const withoutModel = renderAgentDocument(usage.agents[1] as (typeof usage.agents)[number], 'ventas')
    expect(withoutModel).not.toContain('model:')
    expect(withoutModel).not.toContain('## Skills declaradas')
    expect(renderAgentsIndex({ scope: SPACE_SCOPE, root: '/tmp/sicop', generatedAt: AT, usage, maxListEntries: 5 }))
      .toContain('- `compras` → `.agents/compras.md` — Gestiona pedidos y proformas')
    const empty = renderAgentsIndex({
      scope: SPACE_SCOPE,
      root: '/tmp/sicop',
      generatedAt: AT,
      usage: { ...usage, agents: [] },
      maxListEntries: 5,
    })
    expect(empty).toContain('Este ámbito no tiene agentes registrados.')
  })

  it('renders a skill document, the settings file, and one manifest', () => {
    expect(renderSkillDocument(usage.skills[0] as (typeof usage.skills)[number])).toBe([
      '---',
      'name: "informe-diario"',
      'description: "Redacta el informe"',
      '---',
      '',
      'Resume los pedidos.',
      '',
    ].join('\n'))
    expect(JSON.parse(renderSettings())).toEqual({ permissions: { allow: [], deny: [] } })
    const plan = planProjection({ scope: SPACE_SCOPE, root: '/tmp/sicop', generatedAt: AT, usage, maxListEntries: 2 })
    expect(plan.files.map(file => file.path)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
      '.gemini/AGENTS.md',
      '.gemini/GEMINI.md',
      '.kimi/AGENTS.md',
      '.kimi-code/AGENTS.md',
      '.agents/README.md',
      '.agents/workflows/README.md',
      '.claude/settings.json',
      '.agents/compras.md',
      '.agents/subagents/compras.md',
      '.claude/agents/compras.md',
      '.kimi/agents/compras.md',
      '.kimi-code/agents/compras.md',
      '.agents/ventas.md',
      '.agents/subagents/ventas.md',
      '.claude/agents/ventas.md',
      '.kimi/agents/ventas.md',
      '.kimi-code/agents/ventas.md',
      '.agents/compras-2.md',
      '.agents/subagents/compras-2.md',
      '.claude/agents/compras-2.md',
      '.kimi/agents/compras-2.md',
      '.kimi-code/agents/compras-2.md',
      '.claude/skills/informe-diario/SKILL.md',
      '.agents/skills/informe-diario/SKILL.md',
      '.kimi/skills/informe-diario/SKILL.md',
      '.kimi-code/skills/informe-diario/SKILL.md',
    ])
    expect(plan.manifest).toMatchObject({
      version: 1,
      scope: { kind: 'space', id: 'sp-1', title: 'SICOP' },
      generatedAt: AT,
      agents: [{ id: 'ag-1', name: 'Compras', file: 'compras.md' }, { id: 'ag-2', name: 'VENTAS', file: 'ventas.md' }, { id: 'ag-3', name: 'compras', file: 'compras-2.md' }],
      skills: [{ name: 'informe-diario', file: '.claude/skills/informe-diario/SKILL.md' }],
      routines: usage.routines,
    })
    expect(JSON.parse(renderManifest(plan.manifest))).toEqual(plan.manifest)
  })

  it('folds a name with no usable character and one longer than a file name should be', () => {
    const long = 'Á'.repeat(80)
    const oddUsage: HarnessUsage = {
      ...usage,
      agents: [
        { id: 'ag-1', name: '😀', responsibility: 'Sin nombre', provider: undefined, model: undefined, skills: [] },
        { id: 'ag-2', name: long, responsibility: 'Largo', provider: undefined, model: undefined, skills: [] },
      ],
    }
    const plan = planProjection({ scope: SPACE_SCOPE, root: '/tmp/sicop', generatedAt: AT, usage: oddUsage, maxListEntries: 5 })
    expect(plan.files.map(file => file.path)).toContain('.agents/agente.md')
    expect(plan.files.some(file => file.path === `.agents/${'a'.repeat(60)}.md`)).toBe(true)
  })
})

describe('FaberLoomHarnessProjection', () => {
  it('validates the rendered-list bound at construction', async () => {
    const ctx = await harness({ config: { maxListEntries: 2 } })
    expect(ctx.faberloomHarnessProjection).toBeDefined()
    await expect(harness({ config: { maxListEntries: 0 } })).rejects.toThrow('maxListEntries must be an integer')
    await expect(harness({ config: { maxListEntries: 1.5 } })).rejects.toThrow('maxListEntries must be an integer')
  })

  it('reads the usage of one scope and writes every generated file', async () => {
    const root = await scopeDirectory()
    const ctx = await harness({
      rows: scopeRows({
        faberloom_agents: { agents: { 'ag-1': agentRow({ skills: ['informe-diario'] }) } },
        faberloom_routines: { routines: { 'rt-1': { name: 'Pedido', status: 'active', spaceId: 'sp-1' } } },
      }),
      skills: { get: () => Promise.resolve({ name: 'informe-diario', description: 'Redacta el informe', content: 'Resume los pedidos.' }) },
    })
    expect((await ctx.faberloomHarnessProjection.readUsage(SPACE_SCOPE)).agents.map(agent => agent.id)).toEqual(['ag-1'])

    const report = await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    expect(report.version).toBe(1)
    expect(report.root).toBe(root)
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.pruned).toEqual([])
    expect(report.written).toContain('.claude/skills/informe-diario/SKILL.md')
    expect(await readFile(join(root, '.faberloom/harness.json'), 'utf8')).toContain('"scope": {\n    "kind": "space",')
    const manifest = JSON.parse(await readFile(join(root, '.faberloom/harness.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toEqual(report.written)
  })

  it('prunes what the previous manifest declared and now leaves the scope', async () => {
    const root = await scopeDirectory()
    const first = await harness({ rows: scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow() } } }) })
    await first.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    expect(await readFile(join(root, '.agents/compras.md'), 'utf8')).toContain('name: "compras"')
    // A declared file the user already removed is not a removal this run made.
    await rm(join(root, '.agents/compras.md'))

    const second = await harness({ rows: scopeRows() })
    const report = await second.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    expect(report.pruned).toEqual(['.agents/subagents/compras.md', '.claude/agents/compras.md', '.kimi/agents/compras.md', '.kimi-code/agents/compras.md'])
    await expect(readFile(join(root, '.claude/agents/compras.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, '.agents/README.md'), 'utf8')).toContain('no tiene agentes registrados')
  })

  it('keeps a foreign file and a directory that still holds one', async () => {
    const root = await scopeDirectory()
    const ctx = await harness({ rows: scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow() } } }) })
    await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    await writeFile(join(root, '.agents', 'propio.md'), 'archivo del usuario', 'utf8')

    const second = await harness({ rows: scopeRows() })
    const report = await second.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    expect(report.pruned).toEqual(['.agents/compras.md', '.agents/subagents/compras.md', '.claude/agents/compras.md', '.kimi/agents/compras.md', '.kimi-code/agents/compras.md'])
    expect(await readFile(join(root, '.agents/propio.md'), 'utf8')).toBe('archivo del usuario')
  })

  it('refuses to prune on a manifest it cannot trust', async () => {
    const root = await scopeDirectory()
    await writeFile(join(root, 'AGENTS.md'), 'anterior', 'utf8')
    await mkdir(join(root, '.faberloom'), { recursive: true })
    const ctx = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)

    await writeFile(join(root, MANIFEST_PATH), 'no es json', 'utf8')
    expect((await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)).pruned).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a readable projection manifest'))

    await writeFile(join(root, MANIFEST_PATH), '[]', 'utf8')
    expect((await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)).pruned).toEqual([])

    await writeFile(join(root, MANIFEST_PATH), '{"files": [7]}', 'utf8')
    expect((await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)).pruned).toEqual([])

    await writeFile(join(root, MANIFEST_PATH), '{"files": ["AGENTS.md"]}', 'utf8')
    expect((await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)).pruned).toEqual([])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('# Harness de Space')
  })

  it('refuses a manifest path that could leave the scope directory', async () => {
    const root = await scopeDirectory()
    await writeFile(join(root, 'escape.md'), 'archivo del usuario', 'utf8')
    const ctx = await harness()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)

    await writeFile(join(root, MANIFEST_PATH), JSON.stringify({ files: ['../escape.md', '/escape.md', 'sin/../escape.md', 'sub\\escape.md'] }), 'utf8')
    const report = await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    expect(report.pruned).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('which is not a path inside the scope'))
    expect(await readFile(join(root, 'escape.md'), 'utf8')).toBe('archivo del usuario')

    await writeFile(join(root, MANIFEST_PATH), JSON.stringify({ files: ['../escape.md', '/escape.md', 'sin/../escape.md', 'sub\\escape.md'] }), 'utf8')
    await expect(ctx.faberloomHarnessProjection.clean(root)).resolves.toEqual([])
    expect(await readFile(join(root, 'escape.md'), 'utf8')).toBe('archivo del usuario')
  })

  it('resolves the scope folder through the workspace registry', async () => {
    const root = await scopeDirectory()
    const registered = new Map<string, { readonly path: string }>([['ws-1', { path: root }]])
    const ctx = await harness({
      config: { enabled: true },
      rows: scopeRows({ faberloom_spaces: { spaces: { 'sp-1': spaceRow({ workspaceId: 'ws-1' }) }, memory: {} } }),
      registry: { get: id => registered.get(String(id)) },
    })
    const report = await ctx.faberloomHarnessProjection.refresh({ kind: 'workspace', id: WORKSPACE_SCOPE.id, title: 'Formatos' })
    expect(report?.root).toBe(root)
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toContain('# Harness de Workspace: Formatos')
    expect((await ctx.faberloomHarnessProjection.refresh(SPACE_SCOPE))?.usage.spaceId).toBe('sp-1')
  })

  it('reports no folder instead of writing when the scope has none', async () => {
    const root = await scopeDirectory()
    const disabled = await harness({ config: { enabled: false }, registry: { get: () => ({ path: root }) } })
    expect(await disabled.faberloomHarnessProjection.refresh(SPACE_SCOPE)).toBeUndefined()

    const unwired = await harness({ config: { enabled: true } })
    expect(await unwired.faberloomHarnessProjection.refresh(SPACE_SCOPE)).toBeUndefined()

    const unregistered = await harness({ config: { enabled: true }, registry: { get: () => undefined } })
    expect(await unregistered.faberloomHarnessProjection.refresh(SPACE_SCOPE)).toBeUndefined()
    expect(await unregistered.faberloomHarnessProjection.refresh(WORKSPACE_SCOPE)).toBeUndefined()

    // A Workspace with no Space mirroring it still has a folder: its usage is empty.
    const projectionless = await harness({ config: { enabled: true }, registry: { get: () => ({ path: root }) } })
    const projected = await projectionless.faberloomHarnessProjection.refresh(WORKSPACE_SCOPE)
    expect(projected?.usage).toMatchObject({ spaceId: undefined, agents: [] })

    const mirrored = await harness({
      config: { enabled: true },
      rows: scopeRows({ faberloom_spaces: { spaces: { 'sp-1': spaceRow() }, memory: {} } }),
      registry: { get: () => undefined },
    })
    expect(await mirrored.faberloomHarnessProjection.refresh(SPACE_SCOPE)).toBeUndefined()

    const absent = await harness({
      config: { enabled: true },
      rows: scopeRows({ faberloom_spaces: { spaces: {}, memory: {} } }),
      registry: { get: () => ({ path: root }) },
    })
    // A Space the open spaces domain does not hold has no folder either, so
    // refresh reports none; the explicit project and readUsage calls refuse it.
    expect(await absent.faberloomHarnessProjection.refresh(SPACE_SCOPE)).toBeUndefined()
    await expect(absent.faberloomHarnessProjection.project(SPACE_SCOPE, root)).rejects.toThrow('is not registered')
  })

  it('retires every declared file and the directories one removal empties', async () => {
    const root = await scopeDirectory()
    const ctx = await harness({
      rows: scopeRows({ faberloom_agents: { agents: { 'ag-1': agentRow({ skills: ['informe-diario'] }) } } }),
      skills: { get: () => Promise.resolve({ name: 'informe-diario', description: 'Redacta el informe', content: 'Resume los pedidos.' }) },
    })
    await ctx.faberloomHarnessProjection.project(SPACE_SCOPE, root)
    await writeFile(join(root, 'CLAUDE.md'), '', 'utf8')
    await rm(join(root, 'GEMINI.md'))

    const removed = await ctx.faberloomHarnessProjection.clean(`${root}${sep}`)
    expect(removed).toContain('.claude/skills/informe-diario/SKILL.md')
    expect(removed).toContain('CLAUDE.md')
    expect(removed).not.toContain('GEMINI.md')
    await expect(readFile(join(root, '.claude/settings.json'), 'utf8')).rejects.toThrow()
    // The manifest stays as the record of what the projection owned.
    expect(await readFile(join(root, MANIFEST_PATH), 'utf8')).toContain('"version": 1')
    // Nothing is left to clean, and a folder that was never projected has nothing either.
    expect(await ctx.faberloomHarnessProjection.clean(root)).toEqual([])
    expect(await ctx.faberloomHarnessProjection.clean(await scopeDirectory())).toEqual([])
  })

  it('refuses to clean a folder whose manifest is unreadable', async () => {
    const root = await scopeDirectory()
    await mkdir(join(root, '.faberloom'), { recursive: true })
    await writeFile(join(root, MANIFEST_PATH), '{"files": "AGENTS.md"}', 'utf8')
    const ctx = await harness()
    await expect(ctx.faberloomHarnessProjection.clean(root)).rejects.toThrow('is not a readable projection manifest: the file declares no string file list')
  })
})
