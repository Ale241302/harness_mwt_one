import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAgents from '../../agents/src/index.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomBackup from '../../backup/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomHandlers from '../../handlers/src/index.ts'
import FaberLoomDefaults, { type Config } from '../src/index.ts'
import { SEED_AGENTS, SEED_ROUTINES } from '../src/catalog.ts'

const OWNER = 'compras2@sondelsa.com'
const homes: string[] = []

/** The ten skills the Marluvas operator carries. */
const MARLUVAS_SKILLS = [
  'marluvas-operacion',
  'marluvas-correo',
  'marluvas-expediente',
  'marluvas-proforma',
  'marluvas-sap',
  'marluvas-estados',
  'marluvas-documentos',
  'marluvas-aduana',
  'marluvas-logistica',
  'marluvas-calidad',
] as const

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** One fake role catalogue shipping only the named skills. */
function roleCatalog(skills: readonly string[], role = 'compras'): string {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-catalog-'))
  homes.push(root)
  const dir = join(root, role)
  for (const skill of skills) {
    mkdirSync(join(dir, skill), { recursive: true })
    writeFileSync(join(dir, skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`, 'utf8')
  }
  return root
}

/** The catalogue agents one role receives. */
function agentsFor(role: string): string[] {
  return SEED_AGENTS
    .filter(seed => seed.roles === undefined || seed.roles.includes(role))
    .map(seed => seed.name)
}

/** Boot storage plus the product services over one owner home, without the seeder. */
async function services(home: string, skills: readonly string[], pool = new MemoryMediaPool(), role = 'compras') {
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAgents)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomBackup)
  await ctx.plugin(FaberLoomHandlers)
  return { ctx, catalog: roleCatalog(skills, role), pool }
}

/** Mount the seeder and wait for its activation pass. */
async function seedWith(ctx: Context, catalog: string, config: Partial<Config> = {}) {
  await ctx.plugin(FaberLoomDefaults, {
    ownerId: OWNER,
    role: 'compras',
    readOnly: false,
    skillsCatalogRoot: catalog,
    ...config,
  })
  return await ctx.faberloomDefaults.seed()
}

/** A throwaway owner home, reused across a simulated restart. */
function ownerHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-home-'))
  homes.push(home)
  return home
}

describe('FaberLoomDefaults', () => {
  it('collapses the baseline rows two installations seeded under different ids', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, [])
    await ctx.faberloomAgents.createAgent({ name: 'Recepción', responsibility: 'primera', seeded: true, skills: ['uno'] })
    await ctx.faberloomAgents.createAgent({ name: 'Recepción', responsibility: 'segunda', seeded: true, skills: ['dos'] })
    const own = await ctx.faberloomAgents.createAgent({ name: 'Recepción', responsibility: 'mía' })

    await seedWith(ctx, catalog)

    const rows = (await ctx.faberloomAgents.listAgents()).filter(agent => agent.name === 'Recepción')
    // The deployment's two rows become one, with both skill sets; the user's own
    // row with the same name is untouched.
    expect(rows.filter(agent => agent.seeded)).toHaveLength(1)
    expect([...(rows.find(agent => agent.seeded)?.skills ?? [])].sort()).toEqual(['dos', 'uno'])
    expect(rows.some(agent => agent.id === own.id)).toBe(true)
  })

  it('runs the deployment-wide edition pass only when the deployment names its file', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, ['mwt-compras-clientes-leer'])
    await seedWith(ctx, catalog)
    expect(await ctx.faberloomDefaults.syncGlobal()).toBeUndefined()

    const other = ownerHome()
    const second = await services(other, ['mwt-compras-clientes-leer'])
    const shared = join(other, 'global', 'agents.json')
    await seedWith(second.ctx, second.catalog, { role: 'admin', globalAgentsFile: shared, globalAgentsIntervalMs: 3_600_000 })
    expect(await second.ctx.faberloomDefaults.syncGlobal()).toEqual({ published: [], applied: [] })
    expect(existsSync(join(other, 'faberloom-global-agents.json'))).toBe(true)

    // A shared path that cannot be written fails the pass without throwing.
    const [first] = await second.ctx.faberloomAgents.listAgents()
    if (first === undefined) throw new Error('seeding created no agent')
    await second.ctx.faberloomAgents.updateAgent(first.id, { model: 'deepseek-pro' })
    writeFileSync(join(other, 'global-blocker'), 'x', 'utf8')
    const blocked = await services(other, ['mwt-compras-clientes-leer'], second.pool)
    await seedWith(blocked.ctx, blocked.catalog, { role: 'admin', globalAgentsFile: join(other, 'global-blocker', 'agents.json') })
    expect(await blocked.ctx.faberloomDefaults.syncGlobal()).toBeUndefined()
  })

  it('removes the copies of the baseline another home carried here, keeping same-name agents of its own', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, [])
    const seeded = await ctx.faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Prepara proformas.', seeded: true })
    const copy = await ctx.faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Prepara proformas.' })
    const own = await ctx.faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Mis proformas.' })
    const owned = await ctx.faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Prepara proformas.', ownerId: 'ana@muitowork.com' })
    const shared = await ctx.faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Prepara proformas.', originRef: 'share:ana@muitowork.com' })
    const unrelated = await ctx.faberloomAgents.createAgent({ name: 'Sin gemelo', responsibility: 'Prepara proformas.' })

    await seedWith(ctx, catalog)

    const ids = new Set((await ctx.faberloomAgents.listAgents()).map(agent => agent.id))
    expect(ids.has(copy.id)).toBe(false)
    for (const kept of [seeded, own, owned, shared, unrelated]) expect(ids.has(kept.id)).toBe(true)
  })

  it('F16 — seeds the plan agents and routine, keeping only the skills the role ships', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, ['mwt-compras-clientes-leer', 'mwt-compras-inventario-leer'])
    const report = await seedWith(ctx, catalog)
    expect(report).toMatchObject({ seeded: true, skipped: null })
    expect(report.agents).toEqual(agentsFor('compras'))
    expect(report.routines).toEqual(SEED_ROUTINES.map(routine => routine.name))

    const agents = await ctx.faberloomAgents.listAgents()
    expect(agents.map(agent => agent.name)).toEqual(agentsFor('compras'))
    expect(agents.find(agent => agent.name === 'Recepción')?.skills).toEqual(['mwt-compras-clientes-leer'])
    expect(agents.find(agent => agent.name === 'Proformas')?.skills).toEqual(['mwt-compras-clientes-leer', 'mwt-compras-inventario-leer'])

    const routines = await ctx.faberloomRoutines.listRoutines(OWNER)
    expect(routines).toHaveLength(SEED_ROUTINES.length)
    const [routine] = routines
    expect(routine?.status).toBe('draft')
    expect(routine?.definition.steps.map(step => step.handler)).toEqual(['agent', 'mcp', 'agent', 'wait'])
    expect(routine?.definition.steps.at(-1)?.waitFor).toBe('aprobacion')
    expect(routine?.definition.expectedResult).toBe('Proforma con precios correctos, lista para enviar.')
    expect(routine?.definition.triggers).toEqual([{
      kind: 'email',
      match: 'orden de compra',
      timezone: null,
      days: [],
      windowFrom: null,
      windowTo: null,
      businessDays: false,
    }])
    expect(existsSync(join(home, 'faberloom-defaults.json'))).toBe(true)
  })

  it('F16 — a restart does not duplicate, nor resurrect what the owner removed', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const first = await services(home, ['mwt-compras-clientes-leer'], pool)
    await seedWith(first.ctx, first.catalog)
    const [removed] = await first.ctx.faberloomAgents.listAgents()
    if (removed === undefined) throw new Error('seeding created no agent')
    await first.ctx.faberloomAgents.removeAgent(removed.id)

    const second = await services(home, ['mwt-compras-clientes-leer'], pool)
    const report = await seedWith(second.ctx, second.catalog)
    expect(report).toMatchObject({ seeded: false, skipped: 'already seeded' })
    const names = (await second.ctx.faberloomAgents.listAgents()).map(agent => agent.name)
    expect(names).not.toContain(removed.name)
    expect(names).toHaveLength(agentsFor('compras').length - 1)
    expect(await second.ctx.faberloomRoutines.listRoutines(OWNER)).toHaveLength(SEED_ROUTINES.length)
  })

  it('F16 — two processes starting at once seed once between them', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const first = await services(home, ['mwt-compras-clientes-leer'], pool)
    const second = await services(home, ['mwt-compras-clientes-leer'], pool)

    const reports = await Promise.all([
      seedWith(first.ctx, first.catalog),
      seedWith(second.ctx, second.catalog),
    ])
    const seeded = reports.filter(report => report.seeded)
    expect(seeded).toHaveLength(1)
    expect(reports.filter(report => report.skipped === 'another pass is seeding')).toHaveLength(1)
    expect(await second.ctx.faberloomRoutines.listRoutines(OWNER)).toHaveLength(SEED_ROUTINES.length)
    expect(await first.ctx.faberloomAgents.listAgents()).toHaveLength(agentsFor('compras').length)
  })

  it('F16 — re-syncs the shared agent presets on restart without duplicating them', async () => {
    const home = ownerHome()
    const shared = mkdtempSync(join(tmpdir(), 'faberloom-agents-'))
    homes.push(shared)
    mkdirSync(join(shared, 'architect'), { recursive: true })
    writeFileSync(join(shared, 'architect', 'preset.yml'), 'name: Architect\ndescription: "System design and scalability."\norder: 100\n', 'utf8')
    mkdirSync(join(shared, 'not-a-preset'), { recursive: true })
    const pool = new MemoryMediaPool()
    const first = await services(home, [], pool)
    const report = await seedWith(first.ctx, first.catalog, { agentsSharedRoot: shared })
    expect(report.agents).toContain('Architect')
    const agent = (await first.ctx.faberloomAgents.listAgents()).find(candidate => candidate.name === 'Architect')
    expect(agent?.responsibility).toBe('System design and scalability.')

    const second = await services(home, [], pool)
    const again = await seedWith(second.ctx, second.catalog, { agentsSharedRoot: shared })
    expect(again.seeded).toBe(false)
    expect((await second.ctx.faberloomAgents.listAgents()).filter(candidate => candidate.name === 'Architect')).toHaveLength(1)
  })

  it('F16 — seeds a curated preset with its skills and connected agents', async () => {
    const home = ownerHome()
    const shared = mkdtempSync(join(tmpdir(), 'faberloom-agents-'))
    homes.push(shared)
    mkdirSync(join(shared, 'code-reviewer'), { recursive: true })
    writeFileSync(join(shared, 'code-reviewer', 'preset.yml'), 'name: Code Reviewer\ndescription: "Reviews code."\norder: 107\n', 'utf8')
    mkdirSync(join(shared, 'security-reviewer'), { recursive: true })
    writeFileSync(join(shared, 'security-reviewer', 'preset.yml'), 'name: Security Reviewer\ndescription: "Finds vulnerabilities."\norder: 155\n', 'utf8')

    const sharedSkills = mkdtempSync(join(tmpdir(), 'faberloom-shared-skills-'))
    homes.push(sharedSkills)
    for (const name of ['coding-standards', 'security-review']) {
      mkdirSync(join(sharedSkills, name), { recursive: true })
      writeFileSync(join(sharedSkills, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`, 'utf8')
    }

    const pool = new MemoryMediaPool()
    const { ctx, catalog } = await services(home, [], pool)
    await seedWith(ctx, catalog, { agentsSharedRoot: shared, skillsSharedRoot: sharedSkills })

    const agents = await ctx.faberloomAgents.listAgents()
    const reviewer = agents.find(agent => agent.name === 'Code Reviewer')
    expect(reviewer?.skills).toEqual(['coding-standards', 'security-review'])
    expect(reviewer?.subagents.map(subagent => subagent.name)).toEqual(['Security Reviewer'])
  })

  it('F16 — converges baseline agents to the configured provider and model, replacing an earlier value', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const first = await services(home, ['mwt-compras-clientes-leer'], pool)
    await seedWith(first.ctx, first.catalog)
    const [reception] = await first.ctx.faberloomAgents.listAgents()
    if (reception === undefined) throw new Error('seeding created no agent')
    // An earlier deployment left a different model on this baseline agent.
    await first.ctx.faberloomAgents.updateAgent(reception.id, { model: 'stale-model' })

    process.env.FABERLOOM_TEST_AGENT_KEY = 'sk-test'
    try {
      const second = await services(home, ['mwt-compras-clientes-leer'], pool)
      await seedWith(second.ctx, second.catalog, {
        agentProvider: 'deepseek-official', agentModel: 'deepseek-flash', agentApiKeyEnv: 'FABERLOOM_TEST_AGENT_KEY',
      })
      const converged = (await second.ctx.faberloomAgents.listAgents()).find(candidate => candidate.id === reception.id)
      // The deployment owns the baseline: its provider and model replace the stale one.
      expect(converged).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash', hasApiKey: true })
    } finally {
      delete process.env.FABERLOOM_TEST_AGENT_KEY
    }
  })

  it('keeps the provider and model an owner chose for a baseline agent across restarts', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const config = { agentProvider: 'deepseek-official', agentModel: 'deepseek-flash' }
    const first = await services(home, ['mwt-compras-clientes-leer'], pool)
    await seedWith(first.ctx, first.catalog, config)
    const [reception] = await first.ctx.faberloomAgents.listAgents()
    if (reception === undefined) throw new Error('seeding created no agent')
    expect(reception).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-flash' })
    await first.ctx.faberloomAgents.updateAgent(reception.id, { provider: 'anthropic', model: 'claude-opus-5' })

    const second = await services(home, ['mwt-compras-clientes-leer'], pool)
    await seedWith(second.ctx, second.catalog, config)
    const kept = (await second.ctx.faberloomAgents.listAgents()).find(candidate => candidate.id === reception.id)
    expect(kept).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5' })
  })

  it('F16 — seeds nothing for a read-only identity, and a retry never duplicates what already landed', async () => {
    const readOnlyHome = ownerHome()
    const readOnly = await services(readOnlyHome, ['mwt-compras-clientes-leer'])
    expect(await seedWith(readOnly.ctx, readOnly.catalog, { readOnly: true })).toMatchObject({ seeded: false, skipped: 'read-only identity' })
    expect(await readOnly.ctx.faberloomAgents.listAgents()).toEqual([])

    const home = ownerHome()
    const { ctx, catalog } = await services(home, ['mwt-compras-clientes-leer'])
    await ctx.faberloomAgents.createAgent({ name: 'Recepción', responsibility: 'ya existía' })
    const report = await seedWith(ctx, catalog, { skillsCatalogRoot: catalog })
    expect(report.agents).toEqual(agentsFor('compras').filter(name => name !== 'Recepción'))
    const names = (await ctx.faberloomAgents.listAgents()).map(agent => agent.name)
    expect(names.filter(name => name === 'Recepción')).toHaveLength(1)
  })

  it('seeds the Marluvas operator for a privileged role with its ten skills', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, MARLUVAS_SKILLS, new MemoryMediaPool(), 'admin')

    const report = await seedWith(ctx, catalog, { role: 'admin' })

    expect(report.agents).toContain('Operador Marluvas')
    const agent = (await ctx.faberloomAgents.listAgents()).find(candidate => candidate.name === 'Operador Marluvas')
    expect(agent?.seeded).toBe(true)
    expect(agent?.ownerId).toBe('')
    expect(agent?.skills).toEqual([...MARLUVAS_SKILLS])
  })

  it('adds the Marluvas operator to an owner seeded before it existed, and never resurrects it after deletion', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const first = await services(home, MARLUVAS_SKILLS, pool, 'admin')
    writeFileSync(join(home, 'faberloom-defaults.json'), `${JSON.stringify({
      seededAt: '2026-01-01T00:00:00.000Z',
      role: 'admin',
      agents: agentsFor('admin').filter(name => name !== 'Operador Marluvas'),
      routines: [],
    }, null, 2)}\n`, 'utf8')

    const report = await seedWith(first.ctx, first.catalog, { role: 'admin' })
    expect(report).toMatchObject({ seeded: true, skipped: 'already seeded' })
    expect(report.agents).toEqual(['Operador Marluvas'])
    const created = (await first.ctx.faberloomAgents.listAgents()).find(candidate => candidate.name === 'Operador Marluvas')
    if (created === undefined) throw new Error('the upgrade did not create the Marluvas operator')
    expect(created.skills).toEqual([...MARLUVAS_SKILLS])

    await first.ctx.faberloomAgents.removeAgent(created.id)
    const second = await services(home, MARLUVAS_SKILLS, pool, 'admin')
    const again = await seedWith(second.ctx, second.catalog, { role: 'admin' })
    expect(again.agents).not.toContain('Operador Marluvas')
    expect((await second.ctx.faberloomAgents.listAgents()).map(candidate => candidate.name)).not.toContain('Operador Marluvas')
  })

  it('does not seed the Marluvas operator for a non-privileged role', async () => {
    const home = ownerHome()
    const pool = new MemoryMediaPool()
    const { ctx, catalog } = await services(home, MARLUVAS_SKILLS, pool, 'compras')
    writeFileSync(join(home, 'faberloom-defaults.json'), `${JSON.stringify({
      seededAt: '2026-01-01T00:00:00.000Z',
      role: 'compras',
      agents: agentsFor('compras'),
      routines: [],
    }, null, 2)}\n`, 'utf8')

    await seedWith(ctx, catalog)

    expect((await ctx.faberloomAgents.listAgents()).map(candidate => candidate.name)).not.toContain('Operador Marluvas')
  })
})
