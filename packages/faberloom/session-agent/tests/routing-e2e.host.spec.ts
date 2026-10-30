/**
 * Per-agent provider, model, and API-key routing, proved end to end.
 *
 * The composition boots from a test-only `cordis.yml` through the actual Loader
 * (see `routing-harness.ts`). Each provider endpoint is a local
 * OpenAI-compatible HTTP stub that records every `Authorization` header and
 * body, so the assertions read what the selected provider actually received.
 *
 * Covered: a keyed agent's turn reaches its own provider with its own key; an
 * unkeyed agent keeps the route's own `.env` credential; one session runs two
 * agents on two providers; a Space session runs its assigned agent while an
 * invoked agent's route wins; credit exhaustion is the typed `QUOTA` outcome
 * and the session continues; and the raw key never reaches the session log or
 * a failure payload.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { agentCredentialRef } from '@deepseek-ai/dsh-faberloom-agents'
import type { FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import { closeProviderStubs, providerStub } from './routing-provider.ts'
import type { ProviderStub, StubReply, StubRoute } from './routing-provider.ts'
import { bootRoutingHarness, cleanupRoutingHarness, driveTurn, turnEnds } from './routing-harness.ts'
import type { CatalogAgentSpec, RoutingHarness } from './routing-harness.ts'

/** Route-owned credential the deployment default authenticates with, read from the environment. */
const DEPLOYMENT_REF = credentialRef('DEEPSEEK_API_KEY')
/** Sentinel standing in for the deployment `.env` DeepSeek key. */
const ENV_KEY = 'sk-deepseek-env-7070'
/** The keyed agent's own API key; must never reach a log or a failure payload. */
const ALPHA_KEY = 'sk-agent-alpha-1111'
/** The second keyed agent's own API key. */
const BETA_KEY = 'sk-agent-beta-2222'

const DEPLOYMENT_PROVIDER = 'deepseek-official'
const ALPHA_PROVIDER = 'openai-compatible'
const BETA_PROVIDER = 'anthropic-compatible'

const ALPHA: CatalogAgentSpec = { id: 'alpha', name: 'Alpha', responsibility: 'Alpha duty', provider: ALPHA_PROVIDER, model: 'gpt-4o-mini', hasApiKey: true }
const BETA: CatalogAgentSpec = { id: 'beta', name: 'Beta', responsibility: 'Beta duty', provider: BETA_PROVIDER, model: 'claude-mini', hasApiKey: true }
const UNKEYED: CatalogAgentSpec = { id: 'unkeyed', name: 'Unkeyed', responsibility: 'Unkeyed duty', provider: ALPHA_PROVIDER, model: 'gpt-4o-mini', hasApiKey: false }

const AGENT_KEYS = new Map<string, string>([[ALPHA.id, ALPHA_KEY], [BETA.id, BETA_KEY]])
const WORKSPACE_PATH = '/workspace/alpha'

/** A booted composition plus the three provider stubs its routes talk to. */
interface StubbedHarness extends RoutingHarness {
  readonly stubs: Readonly<Record<'deployment' | 'alpha' | 'beta', ProviderStub>>
}

afterEach(async () => {
  await cleanupRoutingHarness()
  await closeProviderStubs()
})

/**
 * Boot the composition against three provider stubs.
 * @param deploymentScript - replies for the deployment route's endpoint.
 * @param alphaScript - replies for the Alpha agent's provider endpoint.
 * @param betaScript - replies for the Beta agent's provider endpoint.
 * @returns the harness, with the stubs it routes to.
 */
async function boot(
  deploymentScript: StubReply[],
  alphaScript: StubReply[] = [{ kind: 'text', text: 'alpha-ok' }],
  betaScript: StubReply[] = [{ kind: 'text', text: 'beta-ok' }],
): Promise<StubbedHarness> {
  const deployment = await providerStub(deploymentScript)
  const alpha = await providerStub(alphaScript)
  const beta = await providerStub(betaScript)
  const routes: StubRoute[] = [
    { provider: DEPLOYMENT_PROVIDER, baseURL: deployment.url, ownCredentialRef: DEPLOYMENT_REF },
    { provider: ALPHA_PROVIDER, baseURL: alpha.url },
    { provider: BETA_PROVIDER, baseURL: beta.url },
  ]
  const harness = await bootRoutingHarness(
    {
      agents: [ALPHA, BETA, UNKEYED],
      routes,
      keys: AGENT_KEYS,
      workspaces: [{ id: 'ws-alpha', path: WORKSPACE_PATH }],
      spaces: [{ workspaceId: 'ws-alpha', agentId: ALPHA.id, prompt: 'Mantén el foco.' }],
    },
    { DEEPSEEK_API_KEY: ENV_KEY },
  )
  return { ...harness, stubs: { deployment, alpha, beta } }
}

describe('per-agent provider and credential routing', () => {
  it('runs a keyed agent turn through its own provider and key', async () => {
    const { create, stubs } = await boot([{ kind: 'text', text: 'deployment-ok' }])
    const agent = await create('keyed-route', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })
    await driveTurn(agent, 'hola')

    // A turn without a mention stays on the session's own route and credential.
    expect(stubs.deployment.requests).toHaveLength(1)
    expect(stubs.deployment.requests[0]?.authorization).toBe(`Bearer ${ENV_KEY}`)

    await driveTurn(agent, '@Alpha hola')
    expect(stubs.alpha.requests).toHaveLength(1)
    expect(stubs.alpha.requests[0]?.authorization).toBe(`Bearer ${ALPHA_KEY}`)
    expect(stubs.alpha.requests[0]?.body.model).toBe('gpt-4o-mini')
    expect(JSON.stringify(stubs.alpha.requests[0]?.body.messages)).toContain('@Alpha hola')
    // The named provider answered; the deployment endpoint saw nothing new, and
    // no request ever authenticated with the deployment environment key.
    expect(stubs.deployment.requests).toHaveLength(1)
    expect(stubs.alpha.requests[0]?.authorization).not.toBe(`Bearer ${ENV_KEY}`)
  })

  it('keeps the route own .env credential for an agent without a key', async () => {
    const { create, stubs } = await boot([{ kind: 'text', text: 'deployment-ok' }])
    const agent = await create('unkeyed-agent', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })
    await driveTurn(agent, '@Unkeyed hola')

    expect(stubs.deployment.requests).toHaveLength(1)
    expect(stubs.deployment.requests[0]?.authorization).toBe(`Bearer ${ENV_KEY}`)
    expect(stubs.deployment.requests[0]?.body.model).toBe('deepseek-chat')
    expect(stubs.alpha.requests).toHaveLength(0)
  })

  it('runs two agents of different providers on their own routes in one session', async () => {
    const { create, stubs } = await boot([{ kind: 'text', text: 'deployment-ok' }])
    const agent = await create('two-agents', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })

    await driveTurn(agent, '@Alpha hola')
    await driveTurn(agent, '@Beta hola')

    expect(stubs.alpha.requests).toHaveLength(1)
    expect(stubs.beta.requests).toHaveLength(1)
    expect(stubs.alpha.requests[0]?.authorization).toBe(`Bearer ${ALPHA_KEY}`)
    expect(stubs.beta.requests[0]?.authorization).toBe(`Bearer ${BETA_KEY}`)
    expect(stubs.alpha.requests[0]?.body.model).toBe('gpt-4o-mini')
    expect(stubs.beta.requests[0]?.body.model).toBe('claude-mini')
    // Neither agent's turn touched the deployment route.
    expect(stubs.deployment.requests).toHaveLength(0)
  })

  it('uses the Space agent route for a Space session, and the invoked agent route for a mention', async () => {
    const { ctx, create, stubs } = await boot([{ kind: 'text', text: 'deployment-ok' }])
    // No explicit route: the Space session's own agent supplies it.
    const agent = await create('space-session', {}, { cwd: WORKSPACE_PATH })
    await vi.waitFor(() => {
      expect(ctx.get('faberloomSessionAgent')?.routeFor(agent)).toEqual({
        provider: ALPHA_PROVIDER,
        model: 'gpt-4o-mini',
        credentialRef: agentCredentialRef(ALPHA.id as FaberLoomAgentId),
      })
    })

    await driveTurn(agent, 'tarea del espacio')
    expect(stubs.alpha.requests).toHaveLength(1)
    expect(stubs.alpha.requests[0]?.authorization).toBe(`Bearer ${ALPHA_KEY}`)

    await driveTurn(agent, '@Beta hola')
    expect(stubs.beta.requests).toHaveLength(1)
    expect(stubs.beta.requests[0]?.authorization).toBe(`Bearer ${BETA_KEY}`)
    expect(stubs.alpha.requests).toHaveLength(1)
  })

  it('reports credit exhaustion as the typed QUOTA outcome and continues after the account recovers', async () => {
    const { create, stubs } = await boot(
      [{ kind: 'text', text: 'deployment-ok' }],
      [
        { kind: 'http-error', status: 402, body: { error: { message: 'Insufficient Balance', code: 'insufficient_balance', type: 'insufficient_quota' } } },
        { kind: 'text', text: 'after-topup-ok' },
      ],
    )
    const agent = await create('quota-then-recovery', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })

    await driveTurn(agent, '@Alpha hola')
    const failed = turnEnds(agent).at(-1)
    expect(failed?.kind).toBe('error')
    expect(failed?.error?.code).toBe(QUOTA_EXCEEDED_CODE)
    // Distinct from a generic failure, and the route suffix the Chat client reads
    // to name the account is present.
    expect(failed?.error?.code).not.toBe('UNKNOWN')
    expect(failed?.error?.code).not.toBe('HTTP_ERROR')
    expect(failed?.error?.message).toContain('Insufficient Balance')
    expect(failed?.error?.message).toContain(`(provider "${ALPHA_PROVIDER}")`)

    // The session keeps working: the next turn reaches the same provider and succeeds.
    await driveTurn(agent, '@Alpha otra vez')
    expect(turnEnds(agent).at(-1)?.kind).toBe('completed')
    expect(JSON.stringify(agent.session.snapshotEvents())).toContain('after-topup-ok')
    expect(stubs.alpha.requests).toHaveLength(2)
  })

  it('never writes an agent API key or its reference into the session log or a failure payload', async () => {
    const { create } = await boot(
      [{ kind: 'text', text: 'deployment-ok' }],
      [
        { kind: 'http-error', status: 402, body: { message: 'out of credits' } },
        { kind: 'text', text: 'ok' },
      ],
      [{ kind: 'text', text: 'beta-ok' }],
    )
    const agent = await create('secret-hygiene', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })
    await driveTurn(agent, '@Alpha hola')
    await driveTurn(agent, '@Beta hola')

    const log = JSON.stringify(agent.session.snapshotEvents())
    for (const secret of [ALPHA_KEY, BETA_KEY, ENV_KEY]) expect(log).not.toContain(secret)
    for (const id of [ALPHA.id, BETA.id]) {
      expect(log).not.toContain(agentCredentialRef(id as FaberLoomAgentId))
    }
    expect(log).not.toContain('credentialRef')
    // The failure payload the user-facing surface reads carries the route, not the key.
    const failure = turnEnds(agent).find(reason => reason.kind === 'error')
    expect(failure?.error?.message).toContain(`(provider "${ALPHA_PROVIDER}")`)
    expect(JSON.stringify(failure)).not.toContain(ALPHA_KEY)
  })

  it('answers a field instruction from the chat without calling any provider', async () => {
    const { ctx, create, stubs } = await boot([{ kind: 'text', text: 'deployment-ok' }])
    const applyIterationInstruction = vi.fn(async () => ({
      applied: true,
      changes: [{ field: 'summary', value: 'Listo' }],
    }))
    ;(ctx.provide as (name: string, value: unknown) => void)('faberloomBoard', { applyIterationInstruction })

    const agent = await create('instruction-chat', { provider: DEPLOYMENT_PROVIDER, model: 'deepseek-chat' })
    await driveTurn(agent, '@summary = Listo')

    expect(applyIterationInstruction).toHaveBeenCalledWith('instruction-chat', '@summary = Listo')
    // The deterministic answer owns the turn: no provider request at all.
    expect(stubs.deployment.requests).toHaveLength(0)
    const replies = agent.session.snapshotEvents()
      .filter(event => event.type === 'assistant/message')
    expect(replies).toHaveLength(1)
    expect(JSON.stringify(replies)).toContain('router determinista')
    expect(turnEnds(agent).at(-1)?.kind).toBe('completed')

    // A sentence the board does not route reaches the model as usual.
    applyIterationInstruction.mockResolvedValueOnce(undefined as never)
    await driveTurn(agent, 'resumí la cuenta')
    expect(stubs.deployment.requests).toHaveLength(1)
  })
})
