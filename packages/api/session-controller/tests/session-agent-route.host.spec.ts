/**
 * Space session model route: a session in a Space whose responsible agent
 * declares a provider, model, and key runs on that route and authenticates with
 * that agent's credential reference, while an unrouted or unkeyed agent leaves
 * the session on the deployment default. The reference is request state and
 * never appears in the session log.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { ApiSessionAgentController } from '../src/agent.ts'
import { installModelSelectionProjection } from '../src/model-selection-projection.ts'

const REF = 'FABERLOOM_AGENT_API_KEY_41' as NonNullable<LlmCallConfig['credentialRef']>

const ownedContexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...ownedContexts].map(ctx => ctx.fiber.dispose()))
  ownedContexts.clear()
})

/** Send one user prompt and wait for the turn to settle. */
async function drive(agent: Agent): Promise<void> {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'hola' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

/** One Space agent route as the composition service publishes it, or none. */
type SpaceRoute = { provider: string; model: string; credentialRef: NonNullable<LlmCallConfig['credentialRef']> } | undefined

/** Mount the real loop, a recording adapter, and the session agent controller. */
async function harness(spaceRoute: SpaceRoute): Promise<{
  ctx: Context
  controller: ApiSessionAgentController
  adapter: MockAdapter
  create: (id: string) => Promise<Agent>
}> {
  const ctx = new Context()
  ownedContexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  installModelSelectionProjection(ctx)
  const adapter = new MockAdapter([textResponse('ok'), textResponse('ok'), textResponse('ok')])
  ctx.llm.registerAdapter(['deepseek-official', 'openai'], adapter)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    saveSelection: async () => {},
  } as never)
  ctx.provide('faberloomSessionAgent', { routeFor: () => spaceRoute } as never)
  const controller = new ApiSessionAgentController(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  return {
    ctx,
    controller,
    adapter,
    create: id => loop.create(SessionId(id), { provider: 'deepseek-official', model: 'deepseek-chat' }, { cwd: '/workspace' }),
  }
}

describe('Space session model route', () => {
  it('runs the session on the agent route and authenticates with its reference, never logging it', async () => {
    const { controller, adapter, create } = await harness({ provider: 'openai', model: 'gpt-4o', credentialRef: REF })
    const agent = await create('space-route')
    controller.selectionFor(agent)
    await drive(agent)

    expect(adapter.requests[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o', credentialRef: REF })
    const log = JSON.stringify(agent.session.snapshotEvents())
    expect(log).not.toContain(REF)
    expect(log).not.toContain('credentialRef')
  })

  it('leaves the session on the deployment default when the agent is unrouted or unkeyed', async () => {
    const { controller, adapter, create } = await harness(undefined)
    const agent = await create('deployment-default')
    controller.selectionFor(agent)
    await drive(agent)

    expect(adapter.requests[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(adapter.requests[0]?.credentialRef).toBeUndefined()
  })

  it('lets an explicit user selection win over the agent route and its reference', async () => {
    const { controller, adapter, create } = await harness({ provider: 'openai', model: 'gpt-4o', credentialRef: REF })
    const agent = await create('explicit-selection')
    controller.selectForNextRequest(agent, { provider: 'deepseek-official', model: 'deepseek-chat' })
    await drive(agent)

    expect(adapter.requests[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect(adapter.requests[0]?.credentialRef).toBeUndefined()
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain(REF)
  })

  it('keeps the reference out of the durable model-selection event a user choice records', async () => {
    const { ctx, controller, create } = await harness({ provider: 'openai', model: 'gpt-4o', credentialRef: REF })
    const agent = await create('selection-event')
    controller.selectForNextRequest(agent, { provider: 'openai', model: 'gpt-4o' })
    const events = agent.session.snapshotEvents()
    const selection = events.find(event => event.type === 'model/selection')
    expect(selection).toBeDefined()
    expect(JSON.stringify(selection)).not.toContain(REF)
    await ctx.fiber.dispose()
  })
})
