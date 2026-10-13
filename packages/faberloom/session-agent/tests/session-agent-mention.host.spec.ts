/**
 * Per-turn `@Name` route: a turn whose latest user message opens with a catalog
 * agent's name runs on that agent's provider, model, and key reference, and the
 * next turn without a mention returns to the session's own route. An unknown
 * name, an agent without a complete keyed route, or a missing catalog leaves the
 * request untouched. The reference is request state and never appears in the log.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import FaberLoomSessionAgent from '../src/index.ts'

const REF_A = 'FABERLOOM_AGENT_API_KEY_41' as NonNullable<LlmCallConfig['credentialRef']>
const REF_B = 'FABERLOOM_AGENT_API_KEY_42' as NonNullable<LlmCallConfig['credentialRef']>

/** A catalog agent as the mention route reads it. */
interface CatalogAgent {
  readonly id: string
  readonly name: string
  readonly responsibility: string
  readonly provider: string | undefined
  readonly model: string | undefined
  readonly hasApiKey: boolean
}

const AGENT_A: CatalogAgent = { id: 'agent-a', name: 'AgentA', responsibility: 'A', provider: 'openai', model: 'gpt-4o', hasApiKey: true }
const AGENT_B: CatalogAgent = { id: 'agent-b', name: 'AgentB', responsibility: 'B', provider: 'anthropic', model: 'claude', hasApiKey: true }
const UNROUTED: CatalogAgent = { id: 'agent-u', name: 'Unrouted', responsibility: 'U', provider: undefined, model: undefined, hasApiKey: true }
const UNKEYED: CatalogAgent = { id: 'agent-k', name: 'Unkeyed', responsibility: 'K', provider: 'openai', model: 'gpt-4o', hasApiKey: false }

const ownedContexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...ownedContexts].map(ctx => ctx.fiber.dispose()))
  ownedContexts.clear()
})

/** The key reference each catalog agent's key is stored under. */
const refFor = (agent: CatalogAgent): NonNullable<LlmCallConfig['credentialRef']> | undefined =>
  agent.hasApiKey ? (agent.id === AGENT_A.id ? REF_A : REF_B) : undefined

/** The catalog fakes a harness provides, or none. */
interface Services {
  readonly agents?: readonly CatalogAgent[]
}

/** Mount the real loop, a recording adapter, and the session agent service. */
async function harness(
  services: Services,
  script: ConstructorParameters<typeof MockAdapter>[0],
  extras: { readonly reasoning?: LlmModelReasoningInfo; readonly agentOptions?: AgentOptions } = {},
): Promise<{ ctx: Context; adapter: MockAdapter; create: (id: string) => Promise<Agent> }> {
  const ctx = new Context()
  ownedContexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const adapter = new MockAdapter(script, extras.reasoning)
  ctx.llm.registerAdapter(['deployment', 'openai', 'anthropic'], adapter)
  if (services.agents !== undefined) {
    ctx.provide('faberloomAgents', { listAgents: async () => [...services.agents!] } as never)
    ctx.provide('faberloomAgentPlane', {
      resolve: (agent: CatalogAgent, _sources: unknown) => ({
        persona: agent.responsibility,
        toolFilter: undefined,
        provider: agent.provider,
        model: agent.model,
        credentialRef: refFor(agent),
        skills: [],
      }),
    } as never)
  }
  await ctx.plugin(FaberLoomSessionAgent as never, { ownerId: 'owner@test' } as never)
  const loop = await mountAgentLoopTestHarness(ctx)
  return {
    ctx,
    adapter,
    create: id => loop.create(
      SessionId(id),
      extras.agentOptions ?? { provider: 'deployment', model: 'default-model' },
    ),
  }
}

/** Send one user prompt and wait for the turn to settle. */
async function drive(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** The route fields of the most recent request. */
function lastRequest(adapter: MockAdapter): { provider: string; model: string; credentialRef: unknown } {
  const request = adapter.requests.at(-1)
  if (request === undefined) throw new Error('no request recorded')
  return { provider: request.provider, model: request.model, credentialRef: request.credentialRef }
}

describe('per-turn @Name route', () => {
  it('runs a mentioned turn on the agent route and reference, never logging the reference', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok')])
    const agent = await create('mention-route')
    await drive(agent, '@AgentA hola')

    expect(lastRequest(adapter)).toEqual({ provider: 'openai', model: 'gpt-4o', credentialRef: REF_A })
    const log = JSON.stringify(agent.session.snapshotEvents())
    expect(log).toContain('@AgentA')
    expect(log).not.toContain(REF_A)
    expect(log).not.toContain('credentialRef')
  })

  it('keeps the session own route for a turn without a mention', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok')])
    const agent = await create('no-mention')
    await drive(agent, 'hola')

    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('returns to the session route on the next turn without a mention', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok'), textResponse('ok')])
    const agent = await create('mention-then-plain')
    await drive(agent, '@AgentA hola')
    expect(lastRequest(adapter)).toEqual({ provider: 'openai', model: 'gpt-4o', credentialRef: REF_A })
    await drive(agent, 'ahora sin mención')
    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('runs consecutive mentions on each named agent and then restores the session route', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A, AGENT_B] }, [textResponse('ok'), textResponse('ok'), textResponse('ok')])
    const agent = await create('consecutive')
    await drive(agent, '@AgentA hola')
    await drive(agent, '@AgentB hola')
    expect(lastRequest(adapter)).toEqual({ provider: 'anthropic', model: 'claude', credentialRef: REF_B })
    await drive(agent, 'hola')
    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('leaves a route the session changed after a mentioned turn in force', async () => {
    const { ctx, adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok'), textResponse('ok')])
    const agent = await create('changed-after-mention')
    await drive(agent, '@AgentA hola')
    // Stand in for an explicit selection: the session's own route moves on
    // before the next mention-free turn, so the captured restore must not win.
    ctx.on('agent/request', async (_payload, next) => {
      const config = await next()
      return { ...config, provider: 'anthropic', model: 'claude' }
    })
    await drive(agent, 'hola')

    expect(lastRequest(adapter)).toEqual({ provider: 'anthropic', model: 'claude', credentialRef: undefined })
  })

  it('restores the session route reasoning effort after a mentioned turn', async () => {
    const reasoning: LlmModelReasoningInfo = {
      efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
      defaultEffort: ReasoningEffortId('high'),
    }
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok'), textResponse('ok')], {
      reasoning,
      agentOptions: { provider: 'deployment', model: 'default-model', reasoningEffort: ReasoningEffortId('high') },
    })
    const agent = await create('effort-restore')
    await drive(agent, '@AgentA hola')
    await drive(agent, 'hola')

    const request = adapter.requests.at(-1)
    expect(request?.provider).toBe('deployment')
    expect(request?.reasoningEffort).toBe(ReasoningEffortId('high'))
  })

  it('keeps the route across the steps of a mentioned turn', async () => {
    const { ctx, adapter, create } = await harness({ agents: [AGENT_A] }, [
      toolCallResponse('c1', 'echo', {}, 'go'),
      textResponse('done'),
    ])
    ctx.tools.register(defineContentToolFixture({
      name: 'echo', description: 'echo', parameters: {},
      async execute() { return [{ type: 'text', text: 'echoed' }] },
    }))
    const agent = await create('multi-step')
    await drive(agent, '@AgentA go')

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.map(request => request.provider)).toEqual(['openai', 'openai'])
    expect(adapter.requests.map(request => request.model)).toEqual(['gpt-4o', 'gpt-4o'])
  })

  it('changes nothing for an unrouted or unkeyed agent', async () => {
    const { adapter, create } = await harness({ agents: [UNROUTED, UNKEYED] }, [textResponse('ok'), textResponse('ok')])
    const agent = await create('incomplete-route')
    await drive(agent, '@Unrouted hola')
    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
    await drive(agent, '@Unkeyed hola')
    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('changes nothing and still runs for an unknown name', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok')])
    const agent = await create('unknown-name')
    await drive(agent, '@Nadie hola')

    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
    expect(adapter.requests).toHaveLength(1)
  })

  it('changes nothing without a catalog or plane', async () => {
    const { adapter, create } = await harness({}, [textResponse('ok')])
    const agent = await create('no-catalog')
    await drive(agent, '@AgentA hola')

    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('reads the mention from the user message, not from injected context', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok')])
    const agent = await create('injected-context')
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: '@AgentA hola' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))
    await drive(agent, 'real prompt')

    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })

  it('changes nothing for a step that carries no user text', async () => {
    const { adapter, create } = await harness({ agents: [AGENT_A] }, [textResponse('ok')])
    const agent = await create('no-user-text')
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: '@AgentA hola' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))
    await agent.whenIdle()

    expect(lastRequest(adapter)).toEqual({ provider: 'deployment', model: 'default-model', credentialRef: undefined })
  })
})
