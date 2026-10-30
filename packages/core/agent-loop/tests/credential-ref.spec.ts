/**
 * Per-call credential reference through the loop: an agent's own
 * `credentialRef` reaches every dispatched request while the logged request
 * header omits it, so the reference is reconstructable request state rather
 * than a durable fact.
 * @module dsh-agent-loop/tests/credential-ref
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const REF = 'FABERLOOM_AGENT_API_KEY_41' as NonNullable<GenerateOptions['credentialRef']>

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('agent credential reference', () => {
  it('dispatches every request with the agent reference and logs a header without it', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('credential-ref'), {
      provider: 'mock', model: 'mock', credentialRef: REF,
    })

    send(agent, 'one')
    await agent.whenIdle()
    expect(adapter.requests[0]?.credentialRef).toBe(REF)

    // A later turn re-derives the reference from the agent options because the
    // logged header never carried it.
    send(agent, 'two')
    await agent.whenIdle()
    expect(adapter.requests[1]?.credentialRef).toBe(REF)

    const headers = agent.session.snapshotEvents().filter(event => event.type === 'request/header')
    expect(headers.length).toBeGreaterThan(0)
    expect(JSON.stringify(headers)).not.toContain('credentialRef')
    await ctx.fiber.dispose()
  })

  it('leaves the reference absent when the agent declares none', async () => {
    const adapter = new MockAdapter([textResponse('one')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('no-credential-ref'), { provider: 'mock', model: 'mock' })

    send(agent, 'one')
    await agent.whenIdle()
    expect(adapter.requests[0]?.credentialRef).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
