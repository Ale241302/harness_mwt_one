import { describe, expect, it } from 'vitest'
import type { AgentPlane } from '@deepseek-ai/dsh-faberloom-agent-plane'
import { planeStartFields, resolveCallerAgentId, toolSourcesOf } from '../src/plane.ts'

/** A resolved plane with nothing masked and no key reference unless overridden. */
function plane(patch: Partial<AgentPlane> = {}): AgentPlane {
  return {
    persona: 'Mantener las reglas', toolFilter: undefined, provider: undefined, model: undefined,
    credentialRef: undefined, skills: [], ...patch,
  }
}

describe('toolSourcesOf', () => {
  it('groups MCP tools by server and collects the open-web tools', () => {
    expect(toolSourcesOf([
      { name: 'mcp__sicop__licitaciones' },
      { name: 'mcp__mwt__precio' },
      { name: 'mcp__sicop__proveedores' },
      { name: 'web_search' },
      { name: 'web_fetch' },
      { name: 'read' },
    ])).toEqual({
      mcp: { sicop: ['mcp__sicop__licitaciones', 'mcp__sicop__proveedores'], mwt: ['mcp__mwt__precio'] },
      web: ['web_search', 'web_fetch'],
    })
  })

  it('returns empty sources for a registry with no MCP or web tools', () => {
    expect(toolSourcesOf([{ name: 'read' }])).toEqual({ mcp: {}, web: [] })
  })
})

describe('planeStartFields', () => {
  it('carries the tool mask, persona, and model route as a child composition', () => {
    const fields = planeStartFields(
      plane({ toolFilter: { deny: ['mcp__sicop__licitaciones'] }, provider: 'deepseek', model: 'deepseek-v4-pro' }),
    )
    expect(fields).toEqual({
      composition: {
        toolFilter: { deny: ['mcp__sicop__licitaciones'] },
        persona: 'Mantener las reglas',
      },
      agentOptions: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    })
  })

  it('omits the model route when the agent declares no provider or model', () => {
    expect(planeStartFields(plane({ provider: 'deepseek' })))
      .toEqual({ composition: { persona: 'Mantener las reglas' } })
  })

  it('contributes nothing for a plane with no persona and no mask', () => {
    expect(planeStartFields(plane({ persona: '' }))).toEqual({})
  })

  it('keeps the mask even when the route is absent, because the manager fences it', () => {
    expect(planeStartFields(plane({ persona: '', toolFilter: { allow: ['read'] } })))
      .toEqual({ composition: { toolFilter: { allow: ['read'] } } })
  })
})

describe('resolveCallerAgentId', () => {
  const spaces = [{ workspaceId: 'ws-1', agentId: 'agent-sicop' }]
  const workspaces = [{ id: 'ws-1', path: '/home/SICOP' }]

  it('resolves the Space agent that owns the session working directory', () => {
    expect(resolveCallerAgentId(spaces, workspaces, '/home/SICOP')).toBe('agent-sicop')
  })

  it('returns undefined when the directory, workspace, or agent is missing', () => {
    expect(resolveCallerAgentId(spaces, workspaces, undefined)).toBeUndefined()
    expect(resolveCallerAgentId(spaces, workspaces, '/home/OTRO')).toBeUndefined()
    expect(resolveCallerAgentId([{ workspaceId: undefined, agentId: 'x' }], workspaces, '/home/SICOP')).toBeUndefined()
    expect(resolveCallerAgentId([{ workspaceId: 'ws-1', agentId: undefined }], workspaces, '/home/SICOP')).toBeUndefined()
  })
})
