/**
 * The baseline agents between two homes of one owner: each home seeds the same
 * catalogue under its own ids, and the owner's edit of one of those agents on
 * either side reaches the other through the virtual `baseline` table — the
 * settings, the connected agents bound to the receiving home's ids, and the
 * provider key, which lands in the receiving home's credential seam.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BaselineAgentTable, baselineByName, isBaselineAgent, type BaselineSecrets } from '../src/baseline.ts'
import { MirrorHomeStore } from '../src/store.ts'
import { applyMirrorDocument, readMirrorDocument } from '../src/sync.ts'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** An in-memory credential seam. */
function secrets(initial: Record<string, string> = {}): BaselineSecrets & { stored: Map<string, string> } {
  const stored = new Map(Object.entries(initial))
  return {
    stored,
    read: async id => stored.get(id),
    write: async (id, key) => { stored.set(id, key) },
  }
}

/** One seeded baseline agent row as the agents service stores it. */
function agent(_id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, responsibility: `${name} base`, spaceId: null, detached: false, ownerId: '', seeded: true, origin: 'scratch',
    skills: [], tools: [], subagents: [], provider: 'deepseek-official', model: 'deepseek-flash',
    hasApiKey: false, apiKeyTail: null, webAccess: false, mwtMcp: true, sicopMcp: false, mailConnectionIds: [],
    active: true, version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
  }
}

/** A home whose agents document holds the given rows, and the store over it. */
async function home(rows: Record<string, unknown>, seam: BaselineSecrets): Promise<{ store: MirrorHomeStore; root: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'faberloom-mirror-baseline-'))
  homes.push(dir)
  const root = join(dir, 'storages')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'faberloom_agents.json'), JSON.stringify({
    unit: { name: 'faberloom_agents', version: 3 }, global: null,
    tables: { models: {}, agents: rows, selections: {}, outcomes: {} },
  }))
  const store = new MirrorHomeStore({ storagesRoot: root, secrets: seam })
  await store.load()
  return { store, root }
}

/** The agents table as the receiving home stored it on its medium. */
async function storedAgents(root: string): Promise<Record<string, Record<string, unknown>>> {
  const text = await readFile(join(root, 'faberloom_agents.json'), 'utf8')
  return (JSON.parse(text) as { tables: { agents: Record<string, Record<string, unknown>> } }).tables.agents
}

describe('baseline agents between two homes', () => {
  it('carries an edited baseline agent by name, binding its partners to local ids and its key to the local seam', async () => {
    const webSecrets = secrets({ 'w-op': 'sk-ant-api03-web-key-YgAA' })
    const web = await home({
      'w-op': agent('w-op', 'Operador Marluvas', {
        provider: 'anthropic', model: 'claude-opus-5', mailConnectionIds: ['92a6d8b3'], skills: ['marluvas-correo'],
        subagents: [{ name: 'Recepción', agentId: 'w-rec' }], hasApiKey: true, apiKeyTail: 'YgAA',
      }),
      'w-rec': agent('w-rec', 'Recepción'),
      'w-own': { ...agent('w-own', 'Mi agente'), seeded: false, ownerId: 'alejandro@muitowork.com' },
    }, webSecrets)
    const deskSecrets = secrets({ 'd-op': 'sk-deepseek-desk-51b4' })
    const desk = await home({
      'd-op': agent('d-op', 'Operador Marluvas', { hasApiKey: true, apiKeyTail: '51b4' }),
      'd-rec': agent('d-rec', 'Recepción'),
    }, deskSecrets)

    const { document } = readMirrorDocument(web.store, 'web')
    const agentsDomain = document.domains['faberloom_agents']
    // The baseline rows stay home-local by id; the owner's own agent travels by id.
    expect(Object.keys(agentsDomain?.tables['agents'] ?? {})).toEqual(['w-own'])
    expect(agentsDomain?.tables['baseline']?.['Operador Marluvas']?.value).toMatchObject({
      provider: 'anthropic', model: 'claude-opus-5', subagents: ['Recepción'], apiKey: 'sk-ant-api03-web-key-YgAA',
    })

    await applyMirrorDocument(desk.store, document)
    const rows = await storedAgents(desk.root)
    expect(rows['d-op']).toMatchObject({
      provider: 'anthropic', model: 'claude-opus-5', mailConnectionIds: ['92a6d8b3'], skills: ['marluvas-correo'],
      subagents: [{ name: 'Recepción', agentId: 'd-rec' }], hasApiKey: true, apiKeyTail: 'YgAA', version: 2,
    })
    expect(rows['d-op']?.['apiKey']).toBeUndefined()
    expect(deskSecrets.stored.get('d-op')).toBe('sk-ant-api03-web-key-YgAA')
    // The receiving home now projects the same settings, so the journal sees agreement.
    const echoed = desk.store.get('faberloom_agents')?.table('baseline').get('Operador Marluvas')
    expect(echoed).toEqual(agentsDomain?.tables['baseline']?.['Operador Marluvas']?.value)
  })

  it('ignores a name the home has not seeded, and never deletes a baseline agent', async () => {
    const desk = await home({ 'd-rec': agent('d-rec', 'Recepción') }, secrets())
    await applyMirrorDocument(desk.store, {
      version: 1, platform: 'web', skills: {},
      domains: { faberloom_agents: { tables: { baseline: {
        'Operador Marluvas': { deleted: false, value: { provider: 'anthropic' } },
        'Recepción': { deleted: true },
      } } } },
    })
    const rows = await storedAgents(desk.root)
    expect(Object.keys(rows)).toEqual(['d-rec'])
    expect(rows['d-rec']).toMatchObject({ provider: 'deepseek-official', version: 1 })
  })

  it('answers for one name with the row holding a key, then the oldest, and ignores malformed rows', async () => {
    const desk = await home({
      a: agent('a', 'Recepción', { createdAt: '2026-10-02T00:00:00.000Z' }),
      b: agent('b', 'Recepción', { createdAt: '2026-10-01T00:00:00.000Z' }),
      c: agent('c', 'Proformas', { createdAt: '2026-10-03T00:00:00.000Z' }),
      d: agent('d', 'Proformas', { createdAt: '2026-10-01T00:00:00.000Z', hasApiKey: false }),
      e: agent('e', 'Proformas', { createdAt: '2026-10-05T00:00:00.000Z', hasApiKey: true }),
      f: agent('f', ''),
      g: 'no es un objeto',
    }, secrets())
    const table = desk.store.get('faberloom_agents')?.table('baseline')
    expect([...table?.keys() ?? []].sort()).toEqual(['Proformas', 'Recepción'])
    expect(table?.size).toBe(2)
    const raw = desk.store.get('faberloom_agents')?.table('agents')
    if (raw === undefined) throw new Error('agents table missing')
    expect(baselineByName(raw).get('Recepción')?.[0]).toBe('b')
    expect(baselineByName(raw).get('Proformas')?.[0]).toBe('e')
    expect(isBaselineAgent([])).toBe(false)
    await table?.put('Recepción', 'no es un objeto')
    expect(await table?.delete('Recepción')).toBe(false)
    const updated = await table?.update('Recepción', current => ({ ...(current as object), model: 'deepseek-pro' }))
    expect(updated).toMatchObject({ model: 'deepseek-pro' })
  })

  it('keeps the settings travelling when the credential seam cannot answer', async () => {
    const failing: BaselineSecrets = {
      read: async () => { throw new Error('vault locked') },
      write: async () => {},
    }
    const dir = await mkdtemp(join(tmpdir(), 'faberloom-mirror-baseline-'))
    homes.push(dir)
    const root = join(dir, 'storages')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'faberloom_agents.json'), JSON.stringify({
      unit: { name: 'faberloom_agents', version: 3 }, global: null, tables: { agents: { a: agent('a', 'Recepción') } },
    }))
    const store = new MirrorHomeStore({ storagesRoot: root, secrets: failing })
    const skipped = await store.load()
    expect(skipped).toEqual([{ domain: 'faberloom_agents', table: 'baseline', reason: 'keys-unreadable: Error: vault locked' }])
    expect(store.get('faberloom_agents')?.table('baseline').get('Recepción')).toMatchObject({ provider: 'deepseek-official' })
    expect(store.get('faberloom_agents')?.table('baseline').get('Nadie')).toBeUndefined()
  })

  it('lands the settings when the credential seam refuses the key', async () => {
    const refusing: BaselineSecrets = {
      read: async () => undefined,
      write: async () => { throw new Error('seam refused') },
    }
    const desk = await home({ 'd-op': agent('d-op', 'Operador Marluvas') }, refusing)
    await desk.store.get('faberloom_agents')?.table('baseline').put('Operador Marluvas', { provider: 'anthropic', apiKey: 'sk-ant-nueva' })
    const rows = await storedAgents(desk.root)
    expect(rows['d-op']).toMatchObject({ provider: 'anthropic', hasApiKey: false })
  })

  it('reads the table without a credential seam, and a seam-less put leaves the key alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'faberloom-mirror-baseline-'))
    homes.push(dir)
    const agents = new Map<string, unknown>([['a', agent('a', 'Recepción')]])
    const raw = {
      get: (key: string) => agents.get(key),
      entries: () => new Map(agents).entries(),
      keys: () => new Map(agents).keys(),
      get size() { return agents.size },
      put: async (key: string, value: unknown) => { agents.set(key, value) },
      delete: async (key: string) => agents.delete(key),
      update: async () => undefined,
    }
    const table = new BaselineAgentTable(raw, new Map(), undefined)
    await table.put('Recepción', { apiKey: 'sk-otro', subagents: ['Nadie', 3] })
    expect(agents.get('a')).toMatchObject({ hasApiKey: false, subagents: [] })
  })
})
