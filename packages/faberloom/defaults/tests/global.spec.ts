import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FaberLoomAgent, FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import { syncGlobalAgents, type GlobalAgentPorts } from '../src/global.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One seeded baseline agent as the agents service lists it. */
function agent(id: string, name: string, extra: Partial<Record<string, unknown>> = {}): FaberLoomAgent {
  return {
    id, name, responsibility: `${name} base`, seeded: true, ownerId: '', skills: [], tools: [], subagents: [],
    provider: 'deepseek-official', model: 'deepseek-flash', hasApiKey: false, webAccess: false, mwtMcp: true,
    sicopMcp: false, mailConnectionIds: [], active: true, ...extra,
  } as unknown as FaberLoomAgent
}

/** One home: its agents, its credential seam, and the ports a pass uses. */
function home(rows: FaberLoomAgent[], keys: Record<string, string> = {}) {
  const agents = new Map(rows.map(row => [String(row.id), row]))
  const vault = new Map(Object.entries(keys))
  const ports: GlobalAgentPorts = {
    listAgents: async () => [...agents.values()],
    updateAgent: async (id, patch) => {
      const { apiKey, ...rest } = patch
      if (typeof apiKey === 'string') vault.set(String(id), apiKey)
      const next = { ...agents.get(String(id)), ...rest } as FaberLoomAgent
      agents.set(String(id), next)
      return next
    },
    readKey: async (id: FaberLoomAgentId) => vault.get(String(id)),
  }
  const dir = mkdtempSync(join(tmpdir(), 'faberloom-global-'))
  dirs.push(dir)
  return { agents, vault, ports, stateFile: join(dir, 'state.json') }
}

describe('deployment-wide baseline agents', () => {
  it('publishes an Admin edit and imposes it on another home, keeping each home its own mailboxes', async () => {
    const shared = join(mkdtempSync(join(tmpdir(), 'faberloom-global-shared-')), 'global.json')
    dirs.push(join(shared, '..'))
    const admin = home([agent('a-op', 'Operador Marluvas'), agent('a-rec', 'Recepción')], { 'a-op': 'sk-deepseek' })
    const user = home([
      agent('u-op', 'Operador Marluvas', { mailConnectionIds: ['buzon-del-usuario'] }),
      agent('u-rec', 'Recepción'),
    ])
    const pass = async (side: ReturnType<typeof home>, privileged: boolean) =>
      await syncGlobalAgents(side.ports, { sharedFile: shared, stateFile: side.stateFile, privileged, actor: privileged ? 'admin@muitowork.com' : 'user@muitowork.com' })

    // The first pass of every home records what it holds and publishes nothing.
    expect(await pass(admin, true)).toEqual({ published: [], applied: [] })
    expect(await pass(user, false)).toEqual({ published: [], applied: [] })

    // The Admin switches the operator to Anthropic with its key and connects Recepción.
    await admin.ports.updateAgent('a-op' as FaberLoomAgentId, {
      provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-ant-api03-admin', mailConnectionIds: ['buzon-del-admin'],
      subagents: [{ name: 'Recepción', agentId: 'a-rec' }],
    })
    expect(await pass(admin, true)).toEqual({ published: ['Operador Marluvas'], applied: [] })
    const file = JSON.parse(readFileSync(shared, 'utf8')) as { agents: Record<string, { revision: number; settings: Record<string, unknown> }> }
    expect(file.agents['Operador Marluvas']?.revision).toBe(1)
    expect(file.agents['Operador Marluvas']?.settings).not.toHaveProperty('mailConnectionIds')

    expect(await pass(user, false)).toEqual({ published: [], applied: ['Operador Marluvas'] })
    expect(user.agents.get('u-op')).toMatchObject({
      provider: 'anthropic', model: 'claude-opus-5', mailConnectionIds: ['buzon-del-usuario'],
      subagents: [{ name: 'Recepción', agentId: 'u-rec' }],
    })
    expect(user.vault.get('u-op')).toBe('sk-ant-api03-admin')

    // A settled deployment does nothing on the next passes.
    expect(await pass(admin, true)).toEqual({ published: [], applied: [] })
    expect(await pass(user, false)).toEqual({ published: [], applied: [] })
  })

  it('never publishes a non-privileged change, and the next edition replaces it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faberloom-global-shared-'))
    dirs.push(dir)
    const shared = join(dir, 'global.json')
    const admin = home([agent('a-op', 'Proformas')])
    const user = home([agent('u-op', 'Proformas')])
    const pass = async (side: ReturnType<typeof home>, privileged: boolean) =>
      await syncGlobalAgents(side.ports, { sharedFile: shared, stateFile: side.stateFile, privileged, actor: 'x' })
    await pass(admin, true)
    await pass(user, false)

    await user.ports.updateAgent('u-op' as FaberLoomAgentId, { model: 'del-usuario' })
    expect(await pass(user, false)).toEqual({ published: [], applied: [] })

    await admin.ports.updateAgent('a-op' as FaberLoomAgentId, { model: 'deepseek-pro' })
    await pass(admin, true)
    expect(await pass(user, false)).toEqual({ published: [], applied: ['Proformas'] })
    expect(user.agents.get('u-op')).toMatchObject({ model: 'deepseek-pro' })
  })

  it('reads a malformed shared file as empty, and skips owned and unseeded agents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'faberloom-global-shared-'))
    dirs.push(dir)
    const shared = join(dir, 'global.json')
    writeFileSync(shared, '{ no es json', 'utf8')
    const side = home([
      agent('mine', 'Mi agente', { seeded: false, ownerId: 'ana@muitowork.com' }),
      agent('one', 'Doble'),
      agent('two', 'Doble', { hasApiKey: true }),
    ])
    writeFileSync(side.stateFile, '[]', 'utf8')
    expect(await syncGlobalAgents(side.ports, { sharedFile: shared, stateFile: side.stateFile, privileged: true, actor: 'x' }))
      .toEqual({ published: [], applied: [] })
    expect(Object.keys(JSON.parse(readFileSync(side.stateFile, 'utf8')) as object)).toEqual(['Doble'])
  })
})
