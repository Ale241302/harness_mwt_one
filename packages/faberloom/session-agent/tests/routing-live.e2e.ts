/**
 * Live smoke for per-agent routing: a catalog agent's declared provider, model,
 * and own API key decide which real provider origin its turn reaches, and an
 * agent without a key keeps the deployment route's own credential.
 *
 * Each suite skips without the credential it needs, so the file is inert in
 * keyless CI. The provider double performs the real `/v1/chat/completions`
 * exchange and records the header and model it sent, so an assertion reads what
 * the selected origin actually received. Nothing here prints a key: the specs
 * compare booleans derived from the recorded header instead of the header.
 *
 * OpenAI holds a real key whose account has no credits, so its turn answers
 * with the provider's own credit-exhaustion body; that answer is the passing
 * evidence that the provider, model, and key were used.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { agentCredentialRef } from '@deepseek-ai/dsh-faberloom-agents'
import type { FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import { closeProviderStubs, providerStub } from './routing-provider.ts'
import type { ProviderCall, StubRoute } from './routing-provider.ts'
import { bootRoutingHarness, cleanupRoutingHarness, driveTurn, turnEnds } from './routing-harness.ts'
import type { CatalogAgentSpec } from './routing-harness.ts'

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const DEEPSEEK_MODEL = process.env.DEEPSEEK_E2E_MODEL ?? 'deepseek-flash'
const OPENAI_KEY = process.env.OPENAI_API_KEY
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'
const OPENAI_MODEL = process.env.OPENAI_E2E_MODEL ?? 'gpt-5-mini'

const DEPLOYMENT_PROVIDER = 'deepseek'
const OPENAI_PROVIDER = 'openai'

/**
 * The deployment environment key a turn must not use. It stands in for a real
 * `.env` DeepSeek key: it is deliberately not a valid credential, so a request
 * that reached the deployment route with it would fail differently, and the
 * recorded OpenAI header proves which credential the turn actually carried.
 */
const DEPLOYMENT_SENTINEL = 'sk-deployment-sentinel-not-a-real-key'

const OPENAI_AGENT: CatalogAgentSpec = {
  id: 'openai-live',
  name: 'OpenAILive',
  responsibility: 'OpenAI live routing smoke',
  provider: OPENAI_PROVIDER,
  model: OPENAI_MODEL,
  hasApiKey: true,
}

const UNKEYED_AGENT: CatalogAgentSpec = {
  id: 'unkeyed-live',
  name: 'UnkeyedLive',
  responsibility: 'Unkeyed live routing smoke',
  provider: DEPLOYMENT_PROVIDER,
  model: DEEPSEEK_MODEL,
  hasApiKey: false,
}

const KEYED_DEEPSEEK_AGENT: CatalogAgentSpec = {
  id: 'deepseek-live',
  name: 'DeepSeekLive',
  responsibility: 'DeepSeek live routing smoke',
  provider: DEPLOYMENT_PROVIDER,
  model: DEEPSEEK_MODEL,
  hasApiKey: true,
}

afterEach(async () => {
  await cleanupRoutingHarness()
  await closeProviderStubs()
})

describe.skipIf(OPENAI_KEY === undefined || OPENAI_KEY === '')('per-agent routing against real OpenAI', () => {
  it('runs a mentioned turn on the agent OpenAI route with the agent own key', async () => {
    const calls: ProviderCall[] = []
    // The deployment route is a local recorder standing for the deployment's
    // DeepSeek connection, so the spec can observe that this turn never used it.
    const deployment = await providerStub([{ kind: 'text', text: 'deployment-ok' }])
    const routes: StubRoute[] = [
      { provider: DEPLOYMENT_PROVIDER, baseURL: deployment.url, ownCredentialRef: credentialRef('DEEPSEEK_API_KEY') },
      { provider: OPENAI_PROVIDER, baseURL: OPENAI_BASE_URL },
    ]
    const { create } = await bootRoutingHarness(
      { agents: [OPENAI_AGENT], routes, keys: new Map([[OPENAI_AGENT.id, OPENAI_KEY as string]]) },
      { DEEPSEEK_API_KEY: DEPLOYMENT_SENTINEL },
      call => calls.push(call),
    )
    const agent = await create('openai-live', { provider: DEPLOYMENT_PROVIDER, model: DEEPSEEK_MODEL })

    await driveTurn(agent, '@OpenAILive responde solo con la palabra banana')

    // The turn left through the OpenAI origin, authenticated with the agent's own key.
    expect(calls.length).toBe(1)
    expect(calls[0]?.provider === OPENAI_PROVIDER).toBe(true)
    expect(calls[0]?.url.includes('api.openai.com') === true).toBe(true)
    expect(calls[0]?.model === OPENAI_MODEL).toBe(true)
    expect(calls[0]?.authorization === `Bearer ${OPENAI_KEY as string}`).toBe(true)
    expect(calls[0]?.authorization.includes(DEPLOYMENT_SENTINEL)).toBe(false)

    // Nothing reached the deployment route: no DeepSeek request was made for this turn.
    expect(deployment.requests.length).toBe(0)

    // OpenAI's own answer. A funded key completes the turn; an unfunded one
    // returns OpenAI's credit-exhaustion body, which is the passing evidence
    // that the provider, model, and key were used rather than a DeepSeek route.
    const end = turnEnds(agent).at(-1)
    if (end?.kind === 'error') {
      expect(end.error?.code).toBe(QUOTA_EXCEEDED_CODE)
      expect(/credit|quota|balance/i.test(end.error?.message ?? '')).toBe(true)
      expect(end.error?.message?.includes(`(provider "${OPENAI_PROVIDER}")`)).toBe(true)
    } else {
      expect(end?.kind).toBe('completed')
    }

    const log = JSON.stringify(agent.session.snapshotEvents())
    expect(log.includes(OPENAI_KEY as string)).toBe(false)
    expect(log.includes(DEPLOYMENT_SENTINEL)).toBe(false)
    expect(log.includes(agentCredentialRef(OPENAI_AGENT.id as FaberLoomAgentId))).toBe(false)
  })
})

describe.skipIf(DEEPSEEK_KEY === undefined || DEEPSEEK_KEY === '')('per-agent routing against real DeepSeek', () => {
  it('keeps the deployment DeepSeek route for an agent without a key', async () => {
    const calls: ProviderCall[] = []
    const routes: StubRoute[] = [
      { provider: DEPLOYMENT_PROVIDER, baseURL: DEEPSEEK_BASE_URL, ownCredentialRef: credentialRef('DEEPSEEK_API_KEY') },
    ]
    const { create } = await bootRoutingHarness(
      { agents: [UNKEYED_AGENT], routes, keys: new Map() },
      { DEEPSEEK_API_KEY: DEEPSEEK_KEY as string },
      call => calls.push(call),
    )
    const agent = await create('unkeyed-live', { provider: DEPLOYMENT_PROVIDER, model: DEEPSEEK_MODEL })

    // The unkeyed agent resolves no route, so the message's mention is ignored
    // and the turn runs on the deployment route with its own `.env` credential.
    await driveTurn(agent, '@UnkeyedLive responde solo con la palabra banana')

    expect(calls.length).toBe(1)
    expect(calls[0]?.provider === DEPLOYMENT_PROVIDER).toBe(true)
    expect(calls[0]?.url.includes('api.deepseek.com') === true).toBe(true)
    expect(calls[0]?.model === DEEPSEEK_MODEL).toBe(true)
    expect(calls[0]?.authorization === `Bearer ${DEEPSEEK_KEY as string}`).toBe(true)
    expect(turnEnds(agent).at(-1)?.kind).toBe('completed')

    const log = JSON.stringify(agent.session.snapshotEvents())
    expect(log.includes('banana')).toBe(true)
    expect(log.includes(DEEPSEEK_KEY as string)).toBe(false)
  })

  it('runs a mentioned turn on the agent DeepSeek route with the agent own key', async () => {
    const calls: ProviderCall[] = []
    const routes: StubRoute[] = [
      // The route's own credential is empty, so only the agent's key can work.
      { provider: DEPLOYMENT_PROVIDER, baseURL: DEEPSEEK_BASE_URL, ownCredentialRef: credentialRef('DEEPSEEK_API_KEY') },
    ]
    const { create } = await bootRoutingHarness(
      { agents: [KEYED_DEEPSEEK_AGENT], routes, keys: new Map([[KEYED_DEEPSEEK_AGENT.id, DEEPSEEK_KEY as string]]) },
      { DEEPSEEK_API_KEY: '' },
      call => calls.push(call),
    )
    const agent = await create('deepseek-keyed-live', { provider: DEPLOYMENT_PROVIDER, model: DEEPSEEK_MODEL })

    await driveTurn(agent, '@DeepSeekLive responde solo con la palabra banana')

    expect(calls.length).toBe(1)
    expect(calls[0]?.authorization === `Bearer ${DEEPSEEK_KEY as string}`).toBe(true)
    expect(turnEnds(agent).at(-1)?.kind).toBe('completed')

    const log = JSON.stringify(agent.session.snapshotEvents())
    expect(log.includes('banana')).toBe(true)
    expect(log.includes(DEEPSEEK_KEY as string)).toBe(false)
    expect(log.includes(agentCredentialRef(KEYED_DEEPSEEK_AGENT.id as FaberLoomAgentId))).toBe(false)
  })
})
