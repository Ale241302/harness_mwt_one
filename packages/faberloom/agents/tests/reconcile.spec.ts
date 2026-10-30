/**
 * Behavior of `reconcileModels`: discovery through `ctx.faberloomModelCatalog`
 * creates, refreshes, and retires pool entries, and the recognized model
 * metadata lands on the pool record. The mock endpoint records the discovery
 * request so the credential transport is asserted on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ModelCatalog from '@deepseek-ai/dsh-faberloom-model-catalog'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAgents from '../src/index.ts'
import { closeModelsEndpoints, modelsEndpoint } from './mock-server.ts'

/** Credential value every discovery resolves; never a real key. */
const KEY = 'agents-reconcile-marker-4c1'

/** A models body matching the verified DeepSeek reply: a rich row and a spare one. */
const DEEPSEEK_BODY = JSON.stringify({
  object: 'list',
  data: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      context_window: 1_048_576,
      max_output_tokens: 393_216,
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
    },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ],
})

beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY', KEY)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeModelsEndpoints()
})

/**
 * Boot the real storage/domain composition plus the agents service and, when an
 * origin is given, the model catalog redirected at the mock endpoint.
 * @param origin - the mock models endpoint origin, or undefined to mount no catalog.
 * @returns the mounted context and the agents service.
 */
async function boot(origin?: string): Promise<{ ctx: Context; agents: FaberLoomAgents }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (origin !== undefined) await ctx.plugin(ModelCatalog, { origins: { deepseek: origin } })
  await ctx.plugin(FaberLoomAgents)
  return { ctx, agents: ctx.faberloomAgents }
}

describe('reconcileModels', () => {
  it('creates a pool entry per listed model, filling the provider metadata', async () => {
    const endpoint = await modelsEndpoint([{ body: DEEPSEEK_BODY }])
    const { agents } = await boot(endpoint.origin)

    const result = await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(result).toEqual({ provider: 'deepseek', created: 2, refreshed: 0, unavailable: 0 })
    expect(endpoint.paths).toEqual(['/models'])
    const models = await agents.listModels()
    expect(models).toHaveLength(2)
    const flash = models.find(model => model.model === 'deepseek-flash')
    expect(flash).toMatchObject({
      provider: 'deepseek',
      capabilities: ['text', 'image'],
      contextWindow: 1_048_576,
      maxOutput: 393_216,
      available: true,
    })
    // The provider's answer carries no rates: the pool keeps them unknown.
    expect(flash?.inputPerMillion).toBeUndefined()
    expect(flash?.outputPerMillion).toBeUndefined()
    expect(flash?.currency).toBeUndefined()
    const pro = models.find(model => model.model === 'deepseek-v4-pro')
    expect(pro?.contextWindow).toBeUndefined()
    expect(pro?.maxOutput).toBeUndefined()
    expect(pro?.capabilities).toEqual([])
  })

  it('refreshes a second discovery in place instead of duplicating entries', async () => {
    const endpoint = await modelsEndpoint([{ body: DEEPSEEK_BODY }, { body: DEEPSEEK_BODY }])
    const { agents } = await boot(endpoint.origin)

    expect(await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY')))
      .toEqual({ provider: 'deepseek', created: 2, refreshed: 0, unavailable: 0 })
    expect(await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY')))
      .toEqual({ provider: 'deepseek', created: 0, refreshed: 2, unavailable: 0 })

    const models = await agents.listModels()
    expect(models).toHaveLength(2)
    expect(new Set(models.map(model => model.model)).size).toBe(2)
  })

  it('refreshes every pool entry already registered for one provider model', async () => {
    const endpoint = await modelsEndpoint([{ body: DEEPSEEK_BODY }])
    const { agents } = await boot(endpoint.origin)
    await agents.registerModel({ provider: 'deepseek', model: 'deepseek-flash', capabilities: ['text'], contextWindow: 1_000 })
    await agents.registerModel({ provider: 'deepseek', model: 'deepseek-flash' })

    const result = await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(result).toEqual({ provider: 'deepseek', created: 1, refreshed: 2, unavailable: 0 })
    expect(await agents.listModels()).toHaveLength(3)
  })

  it('keeps a recorded rate and a field the provider omitted when refreshing', async () => {
    const endpoint = await modelsEndpoint([
      { body: JSON.stringify({ data: [{ id: 'deepseek-flash', context_window: 1_000, max_output_tokens: 100, input_modalities: ['text'] }] }) },
      { body: JSON.stringify({ data: [{ id: 'deepseek-flash' }] }) },
    ])
    const { agents } = await boot(endpoint.origin)
    await agents.registerModel({
      provider: 'deepseek',
      model: 'deepseek-flash',
      inputPerMillion: 0.28,
      outputPerMillion: 0.42,
      currency: 'USD',
    })

    await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))
    const first = (await agents.listModels())[0]
    expect(first).toMatchObject({ contextWindow: 1_000, maxOutput: 100, capabilities: ['text'] })
    expect(first?.inputPerMillion).toBe(0.28)

    const result = await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))
    expect(result).toEqual({ provider: 'deepseek', created: 0, refreshed: 1, unavailable: 0 })
    const refreshed = first === undefined ? undefined : await agents.getModel(first.id)
    // The provider declared nothing on the second answer, so the pool keeps what
    // it recorded, and the rate a models response never carries survives.
    expect(refreshed).toMatchObject({
      contextWindow: 1_000,
      maxOutput: 100,
      capabilities: ['text'],
      inputPerMillion: 0.28,
      outputPerMillion: 0.42,
      currency: 'USD',
    })
  })

  it('marks a dropped model unavailable without removing it or a recorded selection', async () => {
    const endpoint = await modelsEndpoint([
      { body: DEEPSEEK_BODY },
      { body: JSON.stringify({ data: [{ id: 'deepseek-flash' }] }) },
      { body: DEEPSEEK_BODY },
    ])
    const { agents } = await boot(endpoint.origin)
    await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))
    const dropped = (await agents.listModels()).find(model => model.model === 'deepseek-v4-pro')
    if (dropped === undefined) throw new Error('deepseek-v4-pro was not reconciled')
    const agent = await agents.createAgent({ name: 'Referrer', responsibility: 'r' })
    await agents.recordSelection({ agentId: agent.id, task: 't', effectiveModel: dropped.id, reason: 'PRIMARY' })

    const result = await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(result).toEqual({ provider: 'deepseek', created: 0, refreshed: 1, unavailable: 1 })
    expect(await agents.getModel(dropped.id)).toMatchObject({ model: 'deepseek-v4-pro', available: false })
    expect((await agents.listSelections())[0]?.effectiveModel).toBe(dropped.id)
    expect((await agents.listModels()).map(model => model.model)).toContain('deepseek-v4-pro')

    // A later listing restores the same entry rather than adding a second one.
    expect(await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY')))
      .toEqual({ provider: 'deepseek', created: 0, refreshed: 2, unavailable: 0 })
    expect(await agents.getModel(dropped.id)).toMatchObject({ available: true })
    expect((await agents.listModels()).filter(model => model.model === 'deepseek-v4-pro')).toHaveLength(1)
  })

  it('leaves the entries of another provider untouched', async () => {
    const endpoint = await modelsEndpoint([{ body: DEEPSEEK_BODY }])
    const { agents } = await boot(endpoint.origin)
    const other = await agents.registerModel({ provider: 'openai', model: 'gpt-x', inputPerMillion: 1 })

    const result = await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(result).toEqual({ provider: 'deepseek', created: 2, refreshed: 0, unavailable: 0 })
    expect(await agents.getModel(other.id)).toMatchObject({ provider: 'openai', available: true, inputPerMillion: 1 })
  })

  it('leaves a discovered model with no rate at an unknown cost, not zero', async () => {
    const endpoint = await modelsEndpoint([{ body: DEEPSEEK_BODY }])
    const { agents } = await boot(endpoint.origin)
    await agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY'))
    const flash = (await agents.listModels()).find(model => model.model === 'deepseek-flash')
    if (flash === undefined) throw new Error('deepseek-flash was not reconciled')
    const agent = await agents.createAgent({
      name: 'Cost-aware',
      responsibility: 'r',
      policy: { primary: flash.id, budget: { perExecution: 1, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })

    // resolveModel fails closed on an unknown cost instead of pricing it at zero.
    expect(await agents.resolveModel(agent.id, { task: 't' }))
      .toMatchObject({ status: 'needs_decision', reason: 'COST_UNKNOWN' })
  })

  it('fails loud when no model catalog is mounted', async () => {
    const { agents } = await boot()

    await expect(agents.reconcileModels('deepseek', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toThrow(/no model catalog is mounted/)
  })

  it('reports the catalog error for a provider outside its table', async () => {
    const { agents } = await boot('http://127.0.0.1:1')

    await expect(agents.reconcileModels('unknown-provider', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER' })
  })
})
