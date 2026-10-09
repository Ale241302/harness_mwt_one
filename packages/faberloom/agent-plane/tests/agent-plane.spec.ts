import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { FaberLoomAgent } from '@deepseek-ai/dsh-faberloom-agents'
import FaberLoomAgentPlane from '../src/index.ts'
import type { AgentToolSources } from '../src/index.ts'

/** A catalog agent with every capability enabled unless overridden. */
function agent(patch: Partial<FaberLoomAgent> = {}): FaberLoomAgent {
  return {
    id: 'agent-1',
    name: 'Agente',
    responsibility: 'Mantener las reglas',
    spaceId: undefined,
    detached: false,
    ownerId: 'owner@test',
    seeded: false,
    origin: 'scratch',
    originRef: undefined,
    baseAgentId: undefined,
    skills: ['reportes'],
    tools: [],
    subagents: [],
    provider: undefined,
    model: undefined,
    webAccess: true,
    mwtMcp: true,
    sicopMcp: true,
    hasApiKey: false,
    mailConnectionIds: [],
    policy: { primary: undefined, exclusive: false, fallbacks: [], escalation: undefined, budget: undefined },
    lessons: [],
    active: true,
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    ...patch,
  } as unknown as FaberLoomAgent
}

/** The registered tool names a plane masks, grouped by source. */
const SOURCES: AgentToolSources = {
  mcp: {
    mwt: ['mcp__mwt__whoami', 'mcp__mwt__precio'],
    sicop: ['mcp__sicop__licitaciones'],
  },
  web: ['web_fetch', 'web_search'],
}

/** Boot the plane service. */
async function harness(config: { enforceSources?: boolean } = {}): Promise<FaberLoomAgentPlane> {
  const ctx = new Context()
  await ctx.plugin(FaberLoomAgentPlane, config)
  return ctx.faberloomAgentPlane
}

describe('FaberLoomAgentPlane resolve', () => {
  it('masks nothing when every source is allowed and carries the agent identity', async () => {
    const plane = await harness()
    const resolved = plane.resolve(agent({ provider: 'deepseek', model: 'deepseek-v4-pro', skills: ['a', 'b'] }), SOURCES)
    expect(resolved).toEqual({
      persona: 'Mantener las reglas',
      toolFilter: undefined,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      skills: ['a', 'b'],
    })
  })

  it('denies exactly the disabled MCP server tools', async () => {
    const plane = await harness()
    const resolved = plane.resolve(agent({ sicopMcp: false }), SOURCES)
    expect(resolved.toolFilter).toEqual({ deny: ['mcp__sicop__licitaciones'] })
  })

  it('unions and sorts the denied sources, without duplicates', async () => {
    const plane = await harness()
    const resolved = plane.resolve(agent({ mwtMcp: false, webAccess: false }), SOURCES)
    expect(resolved.toolFilter).toEqual({
      deny: ['mcp__mwt__precio', 'mcp__mwt__whoami', 'web_fetch', 'web_search'],
    })
  })

  it('omits the mask for a source with no registered tool names', async () => {
    const plane = await harness()
    const resolved = plane.resolve(agent({ sicopMcp: false, webAccess: false }), { mcp: { mwt: ['mcp__mwt__whoami'] }, web: [] })
    expect(resolved.toolFilter).toBeUndefined()
  })

  it('keeps the flags declarative when enforcement is off', async () => {
    const plane = await harness({ enforceSources: false })
    const resolved = plane.resolve(agent({ mwtMcp: false, sicopMcp: false, webAccess: false }), SOURCES)
    expect(resolved.toolFilter).toBeUndefined()
  })
})

describe('FaberLoomAgentPlane allowsSubagent', () => {
  it('authorizes any target when the allowlist is empty', async () => {
    const plane = await harness()
    expect(plane.allowsSubagent(agent(), 'agent-x')).toBe(true)
  })

  it('authorizes only the listed agent ids', async () => {
    const plane = await harness()
    const listed = agent({ subagents: [{ name: 'SICOP', agentId: 'agent-sicop' as FaberLoomAgent['id'] }] })
    expect(plane.allowsSubagent(listed, 'agent-sicop')).toBe(true)
    expect(plane.allowsSubagent(listed, 'agent-otro')).toBe(false)
  })
})
