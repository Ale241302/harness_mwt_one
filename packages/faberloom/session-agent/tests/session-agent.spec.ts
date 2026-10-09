import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FaberLoomSessionAgent from '../src/index.ts'

/** The install callback the fake agent captures. */
interface Captured {
  cb?: (scope: unknown) => void
}

/** Every service the composition reads, all present by default. */
const BASE_SERVICES: Record<string, unknown> = {
  workspaceRegistry: { list: () => [{ id: 'ws-1', path: '/home/SICOP' }] },
  faberloomSpaces: { list: async () => [{ workspaceId: 'ws-1', agentId: 'agent-sicop' }] },
  faberloomAgents: { getAgent: async () => ({ responsibility: 'Mantener las reglas', skills: ['docx'], mwtMcp: true, sicopMcp: false, webAccess: false, subagents: [] }) },
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
  const sections: { name: string; order: number; text: string }[] = []
  const restrict = vi.fn()
  return {
    systemPrompt: {
      getSectionOrder: (name: string) => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 5 : 0),
      section: (input: { name: string; order: number; text: string }) => { sections.push(input); return () => {} },
    },
    tools: { restrict },
    sections,
    restrict,
  }
}

/** Boot the composition service over fakes and return the captured install callback. */
async function harness(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
  cwd: string | undefined,
  parentSession?: string,
): Promise<Captured> {
  const captured: Captured = {}
  const agent = {
    session: { header: { cwd, parentSession } },
    ctx: {
      inject: vi.fn((_names: string[], cb: (scope: unknown) => void) => {
        captured.cb = cb
        return { dispose: vi.fn(async () => {}) }
      }),
    },
  }
  const ctx = new Context()
  const provide = (name: string, value: unknown): void => { (ctx.provide as (n: string, v: unknown) => void)(name, value) }
  for (const [name, value] of Object.entries(services(patch))) provide(name, value)
  provide('agents', { list: () => [agent] })
  await ctx.plugin(FaberLoomSessionAgent as never, config as never)
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  return captured
}

describe('FaberLoomSessionAgent composition', () => {
  it('installs the persona, tool mask, and skills of the Space agent', async () => {
    const captured = await harness({ ownerId: 'owner@test', role: 'client_b2b', readOnly: false }, {}, '/home/SICOP')
    expect(captured.cb).toBeDefined()
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections[0]).toMatchObject({ name: 'deployment:persona-prefix', order: 5, text: 'Mantener las reglas' })
    expect(installed.sections[1]?.text).toContain('Skills asignadas: docx')
    expect(installed.restrict).toHaveBeenCalledWith({ deny: ['mcp__sicop__x'] })
  })

  it('installs only the persona when nothing is masked and no skills are declared', async () => {
    const captured = await harness({ ownerId: 'owner@test' }, {
      faberloomAgentPlane: { resolve: () => ({ persona: 'Solo persona', toolFilter: undefined, provider: undefined, model: undefined, skills: [] }) },
    }, '/home/SICOP')
    const installed = scope()
    captured.cb!(installed)
    expect(installed.sections).toHaveLength(1)
    expect(installed.restrict).not.toHaveBeenCalled()
  })

  it('does not compose without an owner identity', async () => {
    expect((await harness({}, {}, '/home/SICOP')).cb).toBeUndefined()
  })

  it('does not compose a session without a working directory', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, undefined)).cb).toBeUndefined()
  })

  it('does not re-compose a delegated child that inherits its parent agent', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, '/home/SICOP', 'parent-s')).cb).toBeUndefined()
  })

  it('does not compose when a required service is absent', async () => {
    for (const missing of ['workspaceRegistry', 'faberloomSpaces', 'faberloomAgents', 'faberloomAgentPlane']) {
      expect((await harness({ ownerId: 'owner@test' }, { [missing]: undefined }, '/home/SICOP')).cb, missing).toBeUndefined()
    }
  })

  it('does not compose a session outside a mirrored Space', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {}, '/home/OTRO')).cb).toBeUndefined()
  })

  it('does not compose a Space without a responsible agent', async () => {
    expect((await harness({ ownerId: 'owner@test' }, {
      faberloomSpaces: { list: async () => [{ workspaceId: 'ws-1', agentId: undefined }] },
    }, '/home/SICOP')).cb).toBeUndefined()
  })
})
