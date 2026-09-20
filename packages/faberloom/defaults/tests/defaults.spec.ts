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

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** One fake role catalogue shipping only the named skills. */
function roleCatalog(skills: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-catalog-'))
  homes.push(root)
  const dir = join(root, 'compras')
  for (const skill of skills) {
    mkdirSync(join(dir, skill), { recursive: true })
    writeFileSync(join(dir, skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`, 'utf8')
  }
  return root
}

/** Boot storage plus the product services over one owner home, without the seeder. */
async function services(home: string, skills: readonly string[], pool = new MemoryMediaPool()) {
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
  return { ctx, catalog: roleCatalog(skills), pool }
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
  it('F16 — seeds the plan agents and routine, keeping only the skills the role ships', async () => {
    const home = ownerHome()
    const { ctx, catalog } = await services(home, ['mwt-compras-clientes-leer', 'mwt-compras-inventario-leer'])
    const report = await seedWith(ctx, catalog)
    expect(report).toMatchObject({ seeded: true, skipped: null })
    expect(report.agents).toEqual(SEED_AGENTS.map(agent => agent.name))
    expect(report.routines).toEqual(SEED_ROUTINES.map(routine => routine.name))

    const agents = await ctx.faberloomAgents.listAgents()
    expect(agents.map(agent => agent.name)).toEqual(SEED_AGENTS.map(agent => agent.name))
    expect(agents.find(agent => agent.name === 'Recepción')?.skills).toEqual(['mwt-compras-clientes-leer'])
    expect(agents.find(agent => agent.name === 'Proformas')?.skills).toEqual(['mwt-compras-clientes-leer', 'mwt-compras-inventario-leer'])

    const routines = await ctx.faberloomRoutines.listRoutines(OWNER)
    expect(routines).toHaveLength(SEED_ROUTINES.length)
    const [routine] = routines
    expect(routine?.status).toBe('draft')
    expect(routine?.definition.steps.map(step => step.handler)).toEqual(['agent', 'mcp', 'agent', 'wait'])
    expect(routine?.definition.steps.at(-1)?.waitFor).toBe('aprobacion')
    expect(routine?.definition.expectedResult).toBe('Proforma con precios correctos, lista para enviar.')
    expect(routine?.definition.triggers).toEqual([{ kind: 'email', match: 'orden de compra' }])
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
    expect(names).toHaveLength(SEED_AGENTS.length - 1)
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
    expect(await first.ctx.faberloomAgents.listAgents()).toHaveLength(SEED_AGENTS.length)
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
    expect(report.agents).toEqual(SEED_AGENTS.map(agent => agent.name).filter(name => name !== 'Recepción'))
    const names = (await ctx.faberloomAgents.listAgents()).map(agent => agent.name)
    expect(names.filter(name => name === 'Recepción')).toHaveLength(1)
  })
})
