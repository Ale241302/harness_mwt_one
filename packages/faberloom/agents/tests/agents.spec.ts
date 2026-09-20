import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAgents from '../src/index.ts'
import type { FaberLoomAgentId, FaberLoomModelId } from '../src/index.ts'

/** Boot the real storage/domain composition plus the agents service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAgents)
  return { ctx, agents: ctx.faberloomAgents }
}

/** Register the standard candidate models used across the cases. */
async function seedModels(agents: Awaited<ReturnType<typeof harness>>['agents']) {
  const cheap = await agents.registerModel({ provider: 'cheap', model: 'm', capabilities: ['text'], inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' })
  const mid = await agents.registerModel({ provider: 'mid', model: 'm', capabilities: ['text'], inputPerMillion: 5, outputPerMillion: 5, currency: 'USD' })
  const strong = await agents.registerModel({ provider: 'strong', model: 'm', capabilities: ['text', 'vision'], inputPerMillion: 20, outputPerMillion: 20, currency: 'USD' })
  const noPrice = await agents.registerModel({ provider: 'freeish', model: 'm', capabilities: ['text'] })
  return { cheap: cheap.id, mid: mid.id, strong: strong.id, noPrice: noPrice.id }
}

describe('FaberLoomAgents', () => {
  it('registers, lists, checks availability, and removes pool models', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    expect(await agents.listModels()).toHaveLength(4)
    expect((await agents.getModel(models.mid))?.provider).toBe('mid')
    const checked = await agents.setAvailability(models.mid, false)
    expect(checked.available).toBe(false)
    expect(await agents.removeModel(models.noPrice)).toBe(true)
    expect(await agents.removeModel(models.noPrice)).toBe(false)
    expect(await agents.getModel('missing' as FaberLoomModelId)).toBeUndefined()
    await expect(agents.setAvailability('missing' as FaberLoomModelId, true)).rejects.toThrow('not found')
  })

  it('F03 · duplicates configuration and selected lessons, never confidence', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const source = await agents.createAgent({ name: 'Proformas Eguisa', responsibility: 'Proformas', skills: ['pricing'], tools: ['echo'], policy: { primary: models.mid } })
    await agents.recordOutcome({ agentId: source.id, task: 'proforma', modelId: models.mid, outcome: 'approved', cost: 0.01 })
    expect((await agents.evidence({ agentId: source.id })).approved).toBe(1)

    const copy = await agents.duplicateAgent(source.id, { name: 'Proformas Sondel', spaceId: 'sp-2' })
    expect(copy.baseAgentId).toBe(source.id)
    expect(copy.skills).toEqual(['pricing'])
    expect(copy.tools).toEqual(['echo'])
    expect(copy.lessons).toEqual([])
    expect(copy.version).toBe(1)
    expect((await agents.evidence({ agentId: copy.id })).approved).toBe(0)
    await expect(agents.duplicateAgent('missing' as FaberLoomAgentId, { name: 'x' })).rejects.toThrow('not found')
  })

  it('F19 · provider fallback selects the fallback and records the effective model', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const agent = await agents.createAgent({ name: 'A', responsibility: 'r', policy: { primary: models.mid, fallbacks: [models.cheap] } })
    const result = await agents.resolveModel(agent.id, { task: 'proforma', providerDown: true })
    expect(result).toMatchObject({ status: 'selected', modelId: models.cheap, reason: 'PROVIDER_FALLBACK', fallbackOf: models.mid })
    await agents.recordSelection({
      agentId: agent.id,
      task: 'proforma',
      requestedModel: models.mid,
      reason: result.reason,
      ...result.modelId === undefined ? {} : { effectiveModel: result.modelId },
      ...result.estimatedCost === undefined ? {} : { cost: result.estimatedCost },
    })
    const selections = await agents.listSelections({ agentId: agent.id })
    expect(selections[0]).toMatchObject({ effectiveModel: models.cheap, reason: 'PROVIDER_FALLBACK' })
  })

  it('F23 · an exclusive model never substitutes when the provider is down', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const agent = await agents.createAgent({ name: 'Exclusive', responsibility: 'r', policy: { primary: models.mid, exclusive: true, fallbacks: [models.cheap] } })
    expect(await agents.resolveModel(agent.id, { task: 't', providerDown: true }))
      .toMatchObject({ status: 'denied', reason: 'EXCLUSIVE_PROVIDER_DOWN', modelId: undefined })
  })

  it('needs a decision when the primary is missing or out of the pool', async () => {
    const { agents } = await harness()
    await seedModels(agents)
    const empty = await agents.createAgent({ name: 'Empty', responsibility: 'r' })
    expect(await agents.resolveModel(empty.id, { task: 't' })).toMatchObject({ status: 'needs_decision', reason: 'NO_PRIMARY' })
    const ghost = await agents.createAgent({ name: 'Ghost', responsibility: 'r', policy: { primary: 'nope' as FaberLoomModelId } })
    expect(await agents.resolveModel(ghost.id, { task: 't' })).toMatchObject({ status: 'denied', reason: 'PRIMARY_NOT_IN_POOL' })
  })

  it('F24/F25/F30 · recommends by cost per useful result and shows uncertainty', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const cheapAgent = await agents.createAgent({ name: 'Cheap', responsibility: 'r', policy: { primary: models.cheap } })
    for (let index = 0; index < 9; index += 1) {
      await agents.recordOutcome({ agentId: cheapAgent.id, task: 'proforma', modelId: models.cheap, outcome: 'corrected' })
    }
    await agents.recordOutcome({ agentId: cheapAgent.id, task: 'proforma', modelId: models.cheap, outcome: 'approved', cost: 0.01 })

    const result = await agents.recommendModel({ capabilities: ['text'], task: 'proforma' })
    expect(result.recommended).toBe(models.mid)
    const cheapRow = result.alternatives.find(row => row.modelId === models.cheap)
    expect(cheapRow?.costPerUsefulResult).toBeCloseTo(0.02, 6)
    const midRow = result.alternatives.find(row => row.modelId === models.mid)
    expect(midRow?.costPerUsefulResult).toBeCloseTo(0.01, 6)
    const noPriceRow = result.alternatives.find(row => row.modelId === models.noPrice)
    expect(noPriceRow?.costPerUsefulResult).toBeUndefined()
    expect(noPriceRow?.provisional).toBe(true)
    expect(result.uncertainty.some(text => text.includes('sin tarifa'))).toBe(true)
    await expect(agents.evidence({ modelId: models.cheap, task: 'proforma' })).resolves.toMatchObject({ uses: 10, approved: 1, corrected: 9 })
  })

  it('recommends nothing when no candidate matches the requirements', async () => {
    const { agents } = await harness()
    await seedModels(agents)
    const result = await agents.recommendModel({ capabilities: ['audio'] })
    expect(result.recommended).toBeUndefined()
    expect(result.uncertainty).toContain('ningun modelo accesible cumple los requisitos')
  })

  it('F26 · escalation is authorized within limits and manual mode asks first', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const auto = await agents.createAgent({
      name: 'Auto', responsibility: 'r',
      policy: {
        primary: models.mid,
        escalation: { authorized: [models.strong], conditions: ['validation-failed'], mode: 'auto' },
        budget: { perExecution: 1, currency: 'USD', maxAttempts: 3, maxEscalations: 1 },
      },
    })
    expect(await agents.resolveModel(auto.id, { task: 't', condition: 'validation-failed' }))
      .toMatchObject({ status: 'selected', modelId: models.strong, reason: 'ESCALATED' })
    expect(await agents.resolveModel(auto.id, { task: 't', condition: 'other' }))
      .toMatchObject({ status: 'needs_decision', reason: 'CONDITION_NOT_AUTHORIZED' })
    expect(await agents.resolveModel(auto.id, { task: 't', condition: 'validation-failed', escalated: 1 }))
      .toMatchObject({ status: 'denied', reason: 'MAX_ESCALATIONS' })

    const manual = await agents.createAgent({
      name: 'Manual', responsibility: 'r',
      policy: { primary: models.mid, escalation: { authorized: [models.strong], conditions: ['validation-failed'], mode: 'manual' } },
    })
    expect(await agents.resolveModel(manual.id, { task: 't', condition: 'validation-failed' }))
      .toMatchObject({ status: 'needs_approval', reason: 'ESCALATION_APPROVAL' })
  })

  it('F27/F30 · a budget with unknown rates stops instead of inventing a cost', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const agent = await agents.createAgent({
      name: 'Budget', responsibility: 'r',
      policy: { primary: models.noPrice, budget: { perExecution: 1, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })
    expect(await agents.resolveModel(agent.id, { task: 't' })).toMatchObject({ status: 'needs_decision', reason: 'COST_UNKNOWN' })
    expect(await agents.resolveModel(agent.id, { task: 't', spent: 1 })).toMatchObject({ status: 'denied', reason: 'BUDGET_EXCEEDED' })
    expect(await agents.resolveModel(agent.id, { task: 't', attempted: 3 })).toMatchObject({ status: 'denied', reason: 'MAX_ATTEMPTS' })
  })

  it('stops when the fallback is missing or not in the pool', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const none = await agents.createAgent({ name: 'NoFallback', responsibility: 'r', policy: { primary: models.mid } })
    expect(await agents.resolveModel(none.id, { task: 't', providerDown: true })).toMatchObject({ status: 'denied', reason: 'NO_FALLBACK' })
    const ghost = await agents.createAgent({ name: 'GhostFallback', responsibility: 'r', policy: { primary: models.mid, fallbacks: ['nope' as FaberLoomModelId] } })
    expect(await agents.resolveModel(ghost.id, { task: 't', providerDown: true })).toMatchObject({ status: 'denied', reason: 'FALLBACK_NOT_IN_POOL' })
  })

  it('F28/F31 · delegation shares the parent budget and aggregates cost', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const child = await agents.createAgent({ name: 'Child', responsibility: 'review', policy: { primary: models.strong } })
    const parent = await agents.createAgent({
      name: 'Parent', responsibility: 'r',
      policy: { primary: models.mid, budget: { perExecution: 0.5, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })
    const wired = await agents.updateAgent(parent.id, { subagents: [{ name: 'review', agentId: child.id }] })
    expect(wired.version).toBe(2)

    const ok = await agents.delegate(parent.id, { subagent: 'review', task: 'review-tallas' })
    expect(ok.status).toBe('selected')
    expect(ok.modelId).toBe(models.strong)
    expect(ok.remainingBudget).toBeCloseTo(0.5 - (ok.cost ?? 0), 6)
    expect((await agents.listSelections({ agentId: child.id })).length).toBe(1)

    const exhausted = await agents.delegate(parent.id, { subagent: 'review', task: 'review-tallas', spent: 0.5 })
    expect(exhausted).toMatchObject({ status: 'denied', reason: 'BUDGET_EXCEEDED' })

    const unknown = await agents.delegate(parent.id, { subagent: 'nope', task: 't' })
    expect(unknown).toMatchObject({ status: 'denied', reason: 'SUBAGENT_NOT_FOUND' })
  })

  it('F29 · editing the policy bumps the version the resolver reads', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const agent = await agents.createAgent({ name: 'A', responsibility: 'r', policy: { primary: models.mid } })
    const edited = await agents.updateAgent(agent.id, { policy: { primary: models.cheap, exclusive: true } })
    expect(edited.version).toBe(2)
    expect(edited.policy).toMatchObject({ primary: models.cheap, exclusive: true })
    const resolved = await agents.resolveModel(agent.id, { task: 't' })
    expect(resolved).toMatchObject({ status: 'selected', modelId: models.cheap, policyVersion: 2 })
    const deactivated = await agents.deactivateAgent(agent.id)
    expect(deactivated).toMatchObject({ active: false, version: 3 })
    await expect(agents.updateAgent('missing' as FaberLoomAgentId, {})).rejects.toThrow('not found')
    await expect(agents.deactivateAgent('missing' as FaberLoomAgentId)).rejects.toThrow('not found')
    await expect(agents.getAgent('missing' as FaberLoomAgentId)).rejects.toThrow('not found')
  })

  it('connects the resolver and the pool to the live harness routes (ctx.llm)', async () => {
    const { ctx, agents } = await harness()
    const models = await seedModels(agents)
    expect(await agents.syncPool()).toEqual({ checked: 0, available: 0 })

    ctx.provide('llm', { listProviders: () => [{ id: 'mid', name: 'Mid' }] } as never)
    const live = await agents.createAgent({ name: 'Live', responsibility: 'r', policy: { primary: models.mid } })
    expect(await agents.resolveModel(live.id, { task: 't' })).toMatchObject({ status: 'selected', modelId: models.mid })
    const missing = await agents.createAgent({ name: 'Missing', responsibility: 'r', policy: { primary: models.cheap } })
    expect(await agents.resolveModel(missing.id, { task: 't' })).toMatchObject({ status: 'needs_decision', reason: 'MODEL_NOT_IN_LLM' })

    expect(await agents.syncPool()).toEqual({ checked: 4, available: 1 })
    expect((await agents.getModel(models.mid))?.available).toBe(true)
    expect((await agents.getModel(models.cheap))?.available).toBe(false)
  })

  it('executes registered tools only when the agent allows them, sync and async', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const agent = await agents.createAgent({ name: 'Echo', responsibility: 'r', tools: ['echo', 'upper'], policy: { primary: models.mid } })
    const dispose = agents.registerExecutableTool('echo', args => ({ echoed: (args as { text?: string }).text ?? '' }))
    agents.registerExecutableTool('upper', async args => String((args as { text?: string }).text ?? '').toUpperCase())
    expect(agents.listExecutableTools().sort()).toEqual(['echo', 'upper'])
    expect(await agents.executeTool(agent.id, 'echo', { text: 'hola' })).toEqual({ toolName: 'echo', result: { echoed: 'hola' } })
    expect((await agents.executeTool(agent.id, 'upper', { text: 'hola' })).result).toBe('HOLA')
    await expect(agents.executeTool(agent.id, 'not-allowed', {})).rejects.toThrow('not permitted')

    dispose()
    expect(agents.listExecutableTools()).toEqual(['upper'])
    const ghost = await agents.createAgent({ name: 'Ghost', responsibility: 'r', tools: ['ghost'], policy: { primary: models.mid } })
    await expect(agents.executeTool(ghost.id, 'ghost', {})).rejects.toThrow('not registered')
  })

  it('F35 · runs a temporary subagent inside the parent budget and never catalogues it', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    agents.registerExecutableTool('upper', args => String((args as { text?: string }).text ?? '').toUpperCase())
    const parent = await agents.createAgent({
      name: 'Parent', responsibility: 'r', tools: ['upper'],
      policy: { primary: models.mid, budget: { perExecution: 0.5, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })
    const before = (await agents.listAgents()).length
    const ok = await agents.runTemporarySubagent(parent.id, {
      name: 'temp', responsibility: 'step', primary: models.cheap, task: 't', tool: 'upper', args: { text: 'hola' },
    })
    expect(ok.status).toBe('selected')
    expect(ok.result).toBe('HOLA')
    expect(ok.remainingBudget).toBeCloseTo(0.5 - (ok.cost ?? 0), 6)
    expect((await agents.listAgents()).length).toBe(before)
    expect((await agents.listSelections({ agentId: parent.id })).some(row => row.reason === 'TEMPORARY_SUBAGENT')).toBe(true)

    expect(await agents.runTemporarySubagent(parent.id, { name: 'temp', responsibility: 's', primary: models.cheap, task: 't', tool: 'nope' }))
      .toMatchObject({ status: 'denied', reason: 'TOOL_NOT_PERMITTED' })
    expect(await agents.runTemporarySubagent(parent.id, { name: 'temp', responsibility: 's', primary: models.mid, task: 't', spent: 0.5 }))
      .toMatchObject({ status: 'denied', reason: 'BUDGET_EXCEEDED' })
    expect(await agents.runTemporarySubagent(parent.id, { name: 'temp', responsibility: 's', primary: 'nope' as FaberLoomModelId, task: 't' }))
      .toMatchObject({ status: 'denied', reason: 'MODEL_NOT_IN_POOL' })

    const ghostParent = await agents.createAgent({
      name: 'GhostParent', responsibility: 'r', tools: ['ghost'],
      policy: { primary: models.mid, budget: { perExecution: 0.5, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })
    expect(await agents.runTemporarySubagent(ghostParent.id, { name: 'temp', responsibility: 's', primary: models.mid, task: 't', tool: 'ghost' }))
      .toMatchObject({ status: 'denied', reason: 'TOOL_NOT_REGISTERED' })

    const unknownCost = await agents.createAgent({
      name: 'NoPrice', responsibility: 'r',
      policy: { primary: models.mid, budget: { perExecution: 0.5, currency: 'USD', maxAttempts: 3, maxEscalations: 1 } },
    })
    expect(await agents.runTemporarySubagent(unknownCost.id, { name: 'temp', responsibility: 's', primary: models.noPrice, task: 't' }))
      .toMatchObject({ status: 'needs_decision', reason: 'COST_UNKNOWN' })
  })
})
