import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

function controllerAgents(overrides: object = {}): ApiSessionAgentController {
  return {
    ensureSession: () => Promise.resolve(),
    composeAgent: () => Promise.resolve({ setup: () => {} }),
    presetForSession: () => undefined,
    presetForObservation: () => undefined,
    ...overrides,
  } as unknown as ApiSessionAgentController
}

interface FakePersistence {
  readonly deleted: SessionId[]
  readonly list: () => Promise<readonly { readonly header: SessionHeader }[]>
  readonly delete: (id: SessionId) => Promise<boolean>
}

function fakePersistence(headers: readonly Partial<SessionHeader>[]): FakePersistence {
  const deleted: SessionId[] = []
  return {
    deleted,
    list: () => Promise.resolve(headers.map(header => ({ header: header as SessionHeader }))),
    delete: (id) => {
      deleted.push(id)
      return Promise.resolve(true)
    },
  }
}

async function baseContext(
  persistence: FakePersistence,
  resolveByPath: (path: string) => Promise<unknown> = vi.fn(async () => undefined),
  forgetSession: (id: SessionId) => void = vi.fn(),
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.provide('sessionPersistence', persistence as never)
  ctx.provide('workspaceRegistry', { resolveByPath, forgetSession } as never)
  return ctx
}

describe('Session deletion', () => {
  it('cascades a parent delete through its forked children, children first', async () => {
    const persistence = fakePersistence([
      { id: SessionId('parent'), cwd: '/w' },
      { id: SessionId('child'), cwd: '/w', parentSession: SessionId('parent') },
      { id: SessionId('grandchild'), cwd: '/w', parentSession: SessionId('child') },
      { id: SessionId('other'), cwd: '/w' },
    ])
    const forgetSession = vi.fn<(id: SessionId) => void>()
    const ctx = await baseContext(persistence, vi.fn(async () => undefined), forgetSession)
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default')

    const result = await controller.delete({ sessionId: SessionId('parent') })

    expect(result.deleted).toEqual([SessionId('grandchild'), SessionId('child'), SessionId('parent')])
    expect(persistence.deleted).toEqual([SessionId('grandchild'), SessionId('child'), SessionId('parent')])
    expect(forgetSession.mock.calls.map(([id]) => id)).toEqual(result.deleted)
    await ctx.fiber.dispose()
  })

  it('refuses a live session before removing any storage', async () => {
    const persistence = fakePersistence([
      { id: SessionId('live'), cwd: '/w' },
      { id: SessionId('child'), cwd: '/w', parentSession: SessionId('live') },
    ])
    const ctx = await baseContext(persistence)
    ctx.sessions.create(SessionId('live'), { meta: { cwd: '/w' } })
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default')

    await expect(controller.delete({ sessionId: SessionId('live') }))
      .rejects.toMatchObject({ code: 'session/busy' })
    expect(persistence.deleted).toEqual([])
    await ctx.fiber.dispose()
  })

  it('deletes only unowned sessions, skipping workspaces and live sessions', async () => {
    const persistence = fakePersistence([
      { id: SessionId('owned'), cwd: '/workspace' },
      { id: SessionId('orphan'), cwd: '/loose' },
      { id: SessionId('homeless') },
    ])
    const ctx = await baseContext(persistence, vi.fn(async (path: string) => (
      path === '/workspace' ? ({} as never) : undefined
    )))
    ctx.sessions.create(SessionId('homeless'), { meta: { cwd: '/loose' } })
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default')

    const result = await controller.deleteOrphans()

    expect(result.deleted).toEqual([SessionId('orphan')])
    expect(persistence.deleted).toEqual([SessionId('orphan')])
    await ctx.fiber.dispose()
  })

  it('fails loud when the deployment mounts no persistence service', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('workspaceRegistry', { resolveByPath: vi.fn(), forgetSession: vi.fn() } as never)
    const controller = new SessionCommandController(ctx, controllerAgents(), '/default')

    await expect(controller.delete({ sessionId: SessionId('any') }))
      .rejects.toMatchObject({ code: 'gateway/internal' })
    await ctx.fiber.dispose()
  })
})
