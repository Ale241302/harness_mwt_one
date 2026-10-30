import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import FaberLoomAgents, { AGENT_CREDENTIAL_REF_PREFIX, agentCredentialRef } from '../src/index.ts'
import type { FaberLoomAgentId, FaberLoomModelId } from '../src/index.ts'
import type { AgentRecord } from '../src/spec.ts'

/** A store that refuses every write, so a key migration cannot land. */
class RejectingCredentials extends MemoryCredentials {
  override set(): Promise<void> {
    return Promise.reject(new Error('a read-only source shadows this reference'))
  }
}

/** Which credential provider a harness mounts, if any. */
interface HarnessOptions {
  /** Provider class to mount as `ctx.credentials`; omitted mounts none. */
  credentials?: typeof MemoryCredentials
}

/** Boot the real storage/domain composition plus the agents service over one medium. */
async function boot(
  pool: MemoryMediaPool,
  options: HarnessOptions = {},
): Promise<{ ctx: Context; agents: FaberLoomAgents; facility: DomainFacility; pool: MemoryMediaPool }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.credentials !== undefined) await ctx.plugin(options.credentials)
  await ctx.plugin(FaberLoomAgents)
  return { ctx, agents: ctx.faberloomAgents, facility, pool }
}

/** Boot the real storage/domain composition plus the agents service. */
async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  agents: FaberLoomAgents
  facility: DomainFacility
  pool: MemoryMediaPool
}> {
  return boot(new MemoryMediaPool(), options)
}

/** The already-open agents table, for fabricating durable record state. */
function agentTable(facility: DomainFacility): KvTable<string, unknown> {
  const domain = facility.get('faberloom_agents')
  if (domain === undefined) throw new Error('the agents domain is not open')
  return domain.table('agents')
}

/** Overwrite the key fields of one stored agent, as a pre-seam writer would have. */
async function writeStoredKey(
  facility: DomainFacility,
  id: FaberLoomAgentId,
  fields: Pick<AgentRecord, 'apiKey' | 'hasApiKey' | 'apiKeyTail'>,
): Promise<void> {
  const table = agentTable(facility)
  await table.put(id, { ...(table.get(id) as AgentRecord), ...fields })
}

/** Read one raw durable agent record, asserting it exists. */
function storedAgent(facility: DomainFacility, id: FaberLoomAgentId): AgentRecord {
  const record = agentTable(facility).get(id)
  if (record === undefined) throw new Error(`no stored agent ${id}`)
  return record as AgentRecord
}

/** Seed one legacy agent record into the medium before the service opens, as a pre-seam build wrote it. */
function seedLegacyAgent(pool: MemoryMediaPool, id: string, record: Record<string, unknown>): void {
  pool.media.set('faberloom_agents', { tables: new Map([['agents', new Map([[id, record]])]]), global: null })
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

  it('defaults MWT.ONE and SICOP MCP access on and toggles SICOP alone', async () => {
    const { agents } = await harness()
    const agent = await agents.createAgent({ name: 'A', responsibility: 'r' })
    expect(agent.mwtMcp).toBe(true)
    expect(agent.sicopMcp).toBe(true)

    const updated = await agents.updateAgent(agent.id, { sicopMcp: false })
    expect(updated.sicopMcp).toBe(false)
    expect(updated.mwtMcp).toBe(true)
    expect((await agents.getAgent(agent.id)).sicopMcp).toBe(false)
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
    agents.registerExecutableTool('upper', async args => ((args as { text?: string }).text ?? '').toUpperCase())
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
    agents.registerExecutableTool('upper', args => ((args as { text?: string }).text ?? '').toUpperCase())
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

  it('M5 · aggregates recorded spend by model, agent, and task, flagging unknown costs', async () => {
    const { agents } = await harness()
    const models = await seedModels(agents)
    const first = await agents.createAgent({ name: 'Uno', responsibility: 'r', policy: { primary: models.mid } })
    const second = await agents.createAgent({ name: 'Dos', responsibility: 'r', policy: { primary: models.cheap } })
    await agents.recordSelection({ agentId: first.id, task: 'proforma', effectiveModel: models.mid, reason: 'PRIMARY', cost: 0.02 })
    await agents.recordSelection({ agentId: first.id, task: 'proforma', effectiveModel: models.mid, reason: 'PRIMARY', cost: 0.03 })
    await agents.recordSelection({ agentId: second.id, task: 'pedido', effectiveModel: models.cheap, reason: 'PRIMARY', cost: 0.01 })
    await agents.recordSelection({ agentId: second.id, task: 'pedido', effectiveModel: models.noPrice, reason: 'PRIMARY' })

    const all = await agents.costs()
    expect(all.currency).toBe('USD')
    expect(all.records).toBe(4)
    expect(all.partial).toBe(true)
    expect(all.total).toBeCloseTo(0.06, 6)
    expect(all.byModel[0]).toMatchObject({ by: 'model', key: models.mid, cost: expect.closeTo(0.05, 6) as number, records: 2, partial: false })
    expect(all.byModel.some(bucket => bucket.key === 'unknown')).toBe(false)
    expect(all.byAgent.map(bucket => bucket.records)).toEqual([2, 2])
    expect(all.byTask.find(bucket => bucket.key === 'proforma')).toMatchObject({ by: 'task', records: 2 })
    expect(all.since).toBeDefined()

    const filtered = await agents.costs({ agentId: second.id, task: 'pedido', since: '2999-01-01T00:00:00.000Z' })
    expect(filtered.records).toBe(0)
    expect(filtered.total).toBe(0)
    expect(filtered.partial).toBe(false)
    expect(filtered.since).toBeUndefined()
    expect(filtered.byModel).toEqual([])
  })
})

describe('FaberLoomAgents API keys in the credential seam', () => {
  it('derives a legal, collision-free credential reference from every id shape', async () => {
    const { agents } = await harness()
    const ids = new Set<string>()
    for (let index = 0; index < 200; index += 1) ids.add(randomUUID())
    // Adversarial shapes a mangling derivation would fold together.
    for (const id of ['a-b', 'a_b', 'ab', 'A-B', 'a--b', '', 'á', 'x'.repeat(300)]) ids.add(id)
    // Ids the service itself mints.
    for (let index = 0; index < 5; index += 1) {
      ids.add((await agents.createAgent({ name: `id-${String(index)}`, responsibility: 'r' })).id)
    }

    const refs = new Set<string>()
    for (const id of ids) {
      const ref = agentCredentialRef(id as FaberLoomAgentId)
      expect(isCredentialRefName(ref)).toBe(true)
      expect(ref.startsWith(AGENT_CREDENTIAL_REF_PREFIX)).toBe(true)
      refs.add(ref)
    }
    expect(refs.size).toBe(ids.size)
  })

  it('stores a created key in the seam, leaving only a tail and flag in the record', async () => {
    const { ctx, agents, facility } = await harness({ credentials: MemoryCredentials })
    const agent = await agents.createAgent({ name: 'Con clave', responsibility: 'r', apiKey: 'sk-test-create-1234' })

    expect(agent).toMatchObject({ hasApiKey: true, apiKeyTail: '1234' })
    expect(storedAgent(facility, agent.id)).toMatchObject({ apiKey: null, hasApiKey: true, apiKeyTail: '1234' })
    expect((await ctx.credentials.resolve(agentCredentialRef(agent.id)))?.value).toBe('sk-test-create-1234')
  })

  it('carries the original key into a duplicate, and leaves a keyless original keyless', async () => {
    const { ctx, agents, facility } = await harness({ credentials: MemoryCredentials })
    const source = await agents.createAgent({ name: 'Origen', responsibility: 'r', apiKey: 'sk-copy-9999' })

    const copy = await agents.duplicateAgent(source.id, { name: 'Copia' })
    expect(agentCredentialRef(copy.id)).not.toBe(agentCredentialRef(source.id))
    expect((await ctx.credentials.resolve(agentCredentialRef(copy.id)))?.value).toBe('sk-copy-9999')
    expect(copy).toMatchObject({ hasApiKey: true, apiKeyTail: '9999' })
    expect(storedAgent(facility, copy.id)).toMatchObject({ apiKey: null, hasApiKey: true, apiKeyTail: '9999' })

    const bare = await agents.createAgent({ name: 'Sin clave', responsibility: 'r' })
    const bareCopy = await agents.duplicateAgent(bare.id, { name: 'Copia sin clave' })
    expect(await ctx.credentials.resolve(agentCredentialRef(bareCopy.id))).toBeUndefined()
    expect(bareCopy.hasApiKey).toBe(false)
    expect(bareCopy.apiKeyTail).toBeUndefined()
  })

  it('replaces, keeps, and clears the key across updates', async () => {
    const { ctx, agents, facility } = await harness({ credentials: MemoryCredentials })
    const created = await agents.createAgent({ name: 'Rotación', responsibility: 'r', apiKey: 'sk-old-abcd' })

    const replaced = await agents.updateAgent(created.id, { apiKey: 'sk-new-wxyz' })
    expect(replaced).toMatchObject({ hasApiKey: true, apiKeyTail: 'wxyz' })
    expect((await ctx.credentials.resolve(agentCredentialRef(created.id)))?.value).toBe('sk-new-wxyz')
    expect(storedAgent(facility, created.id).apiKey).toBeNull()

    const kept = await agents.updateAgent(created.id, { responsibility: 'otra' })
    expect(kept).toMatchObject({ hasApiKey: true, apiKeyTail: 'wxyz' })
    expect((await ctx.credentials.resolve(agentCredentialRef(created.id)))?.value).toBe('sk-new-wxyz')

    const cleared = await agents.updateAgent(created.id, { apiKey: null })
    expect(cleared.hasApiKey).toBe(false)
    expect(cleared.apiKeyTail).toBeUndefined()
    expect(await ctx.credentials.resolve(agentCredentialRef(created.id))).toBeUndefined()
    expect(storedAgent(facility, created.id)).toMatchObject({ apiKey: null, hasApiKey: false, apiKeyTail: null })

    // An empty string carries the same meaning as null.
    await agents.updateAgent(created.id, { apiKey: 'sk-again-4321' })
    const emptied = await agents.updateAgent(created.id, { apiKey: '' })
    expect(emptied.hasApiKey).toBe(false)
    expect(await ctx.credentials.resolve(agentCredentialRef(created.id))).toBeUndefined()
  })

  it('follows the seam: presence tracks a key set or removed directly on the store', async () => {
    const { ctx, agents, facility } = await harness({ credentials: MemoryCredentials })
    const bare = await agents.createAgent({ name: 'Externo', responsibility: 'r' })
    await ctx.credentials.set(agentCredentialRef(bare.id), 'sk-external-2222')
    const external = await agents.getAgent(bare.id)
    expect(external.hasApiKey).toBe(true)
    expect(external.apiKeyTail).toBeUndefined()
    expect(storedAgent(facility, bare.id).apiKey).toBeNull()

    const managed = await agents.createAgent({ name: 'Gestionado', responsibility: 'r', apiKey: 'sk-managed-0001' })
    await ctx.credentials.unset(agentCredentialRef(managed.id))
    const removed = await agents.getAgent(managed.id)
    expect(removed.hasApiKey).toBe(false)
    expect(removed.apiKeyTail).toBeUndefined()
  })

  it('migrates a legacy raw key into the seam on read, clearing the field, idempotently', async () => {
    const { ctx, agents, facility } = await harness({ credentials: MemoryCredentials })
    const created = await agents.createAgent({ name: 'Legacy', responsibility: 'r' })
    await writeStoredKey(facility, created.id, { apiKey: 'sk-legacy-9999', hasApiKey: false, apiKeyTail: null })

    const first = await agents.getAgent(created.id)
    expect(first).toMatchObject({ hasApiKey: true, apiKeyTail: '9999' })
    expect(storedAgent(facility, created.id)).toMatchObject({ apiKey: null, hasApiKey: true, apiKeyTail: '9999' })
    expect((await ctx.credentials.resolve(agentCredentialRef(created.id)))?.value).toBe('sk-legacy-9999')

    const second = await agents.getAgent(created.id)
    expect(second).toMatchObject({ hasApiKey: true, apiKeyTail: '9999' })
    expect(storedAgent(facility, created.id).apiKey).toBeNull()
  })

  it('migrates a legacy raw key through listAgents as well', async () => {
    const { agents, facility } = await harness({ credentials: MemoryCredentials })
    const created = await agents.createAgent({ name: 'Legacy listado', responsibility: 'r' })
    await writeStoredKey(facility, created.id, { apiKey: 'sk-legacy-list-0002', hasApiKey: false, apiKeyTail: null })

    const [listed] = await agents.listAgents()
    expect(listed).toMatchObject({ id: created.id, hasApiKey: true, apiKeyTail: '0002' })
    expect(storedAgent(facility, created.id).apiKey).toBeNull()
  })

  it('migrates a record written before the seam, defaulting the new fields', async () => {
    const id = 'legacy-raw-1'
    const pool = new MemoryMediaPool()
    seedLegacyAgent(pool, id, {
      name: 'Legacy bruto',
      responsibility: 'r',
      spaceId: null,
      origin: 'scratch',
      originRef: null,
      baseAgentId: 'agent-base',
      skills: [],
      tools: [],
      subagents: [{ name: 'sub', agentId: 'agent-sub' }],
      policy: { primary: 'model-1', exclusive: false, fallbacks: ['model-2'], escalation: null, budget: null },
      lessons: [],
      active: true,
      version: 3,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      apiKey: 'sk-legacy-raw-5555',
    })

    const { ctx, agents, facility } = await boot(pool, { credentials: MemoryCredentials })
    const read = await agents.getAgent(id as FaberLoomAgentId)
    expect(read).toMatchObject({ id, baseAgentId: 'agent-base', hasApiKey: true, apiKeyTail: '5555' })
    expect(read.policy).toMatchObject({ primary: 'model-1', fallbacks: ['model-2'] })
    expect((await ctx.credentials.resolve(agentCredentialRef(id as FaberLoomAgentId)))?.value).toBe('sk-legacy-raw-5555')
    expect(storedAgent(facility, id as FaberLoomAgentId).apiKey).toBeNull()
  })

  it('treats a legacy empty stored value as no key', async () => {
    const { agents, facility } = await harness({ credentials: MemoryCredentials })
    const created = await agents.createAgent({ name: 'Vacío', responsibility: 'r' })
    await writeStoredKey(facility, created.id, { apiKey: '', hasApiKey: false, apiKeyTail: null })

    const read = await agents.getAgent(created.id)
    expect(read.hasApiKey).toBe(false)
    expect(storedAgent(facility, created.id)).toMatchObject({ apiKey: null, hasApiKey: false, apiKeyTail: null })
  })

  it('keeps a legacy key in the record and reports when the seam refuses the write', async () => {
    const { agents, facility } = await harness({ credentials: RejectingCredentials })
    const created = await agents.createAgent({ name: 'Rechazado', responsibility: 'r' })
    await writeStoredKey(facility, created.id, { apiKey: 'sk-refused-0000', hasApiKey: false, apiKeyTail: null })

    const read = await agents.getAgent(created.id)
    // The seam never received the value, so presence follows it as absent...
    expect(read.hasApiKey).toBe(false)
    // ...but the secret stays in the record for a later, successful migration.
    expect(storedAgent(facility, created.id).apiKey).toBe('sk-refused-0000')
  })

  it('works without a credential provider: the record is the only store and the fallback', async () => {
    const { agents, facility } = await harness()
    const created = await agents.createAgent({ name: 'Sin costura', responsibility: 'r', apiKey: 'sk-noseam-7788' })
    expect(created).toMatchObject({ hasApiKey: true, apiKeyTail: '7788' })
    // Degraded composition: no managed store exists, so the record keeps the value.
    expect(storedAgent(facility, created.id).apiKey).toBe('sk-noseam-7788')

    const kept = await agents.updateAgent(created.id, { responsibility: 'otra' })
    expect(kept).toMatchObject({ hasApiKey: true, apiKeyTail: '7788' })

    const cleared = await agents.updateAgent(created.id, { apiKey: null })
    expect(cleared.hasApiKey).toBe(false)
    expect(storedAgent(facility, created.id)).toMatchObject({ apiKey: null, hasApiKey: false, apiKeyTail: null })
  })

  it('reads every record fallback combination while no credential provider is mounted', async () => {
    const { agents, facility } = await harness()
    const created = await agents.createAgent({ name: 'Tabla', responsibility: 'r' })
    const cases: Array<{
      fields: Pick<AgentRecord, 'apiKey' | 'hasApiKey' | 'apiKeyTail'>
      hasApiKey: boolean
      apiKeyTail?: string
    }> = [
      { fields: { apiKey: 'sk-raw-7777', hasApiKey: false, apiKeyTail: null }, hasApiKey: true, apiKeyTail: '7777' },
      { fields: { apiKey: '', hasApiKey: false, apiKeyTail: null }, hasApiKey: false },
      { fields: { apiKey: null, hasApiKey: true, apiKeyTail: null }, hasApiKey: true },
      { fields: { apiKey: null, hasApiKey: true, apiKeyTail: '8888' }, hasApiKey: true, apiKeyTail: '8888' },
      { fields: { apiKey: null, hasApiKey: false, apiKeyTail: null }, hasApiKey: false },
    ]
    for (const { fields, hasApiKey, apiKeyTail } of cases) {
      await writeStoredKey(facility, created.id, fields)
      const read = await agents.getAgent(created.id)
      expect(read.hasApiKey).toBe(hasApiKey)
      expect(read.apiKeyTail).toBe(apiKeyTail)
    }
  })

  it('falls back to the stored flag and tail when a seam-created record is read with no seam', async () => {
    const pool = new MemoryMediaPool()
    const first = await boot(pool, { credentials: MemoryCredentials })
    const created = await first.agents.createAgent({ name: 'Puente', responsibility: 'r', apiKey: 'sk-bridge-1234' })

    const second = await boot(pool)
    const read = await second.agents.getAgent(created.id)
    expect(read).toMatchObject({ hasApiKey: true, apiKeyTail: '1234' })
  })

  it('never returns the key value from a public read', async () => {
    const { agents } = await harness({ credentials: MemoryCredentials })
    const agent = await agents.createAgent({ name: 'Secreta', responsibility: 'r', apiKey: 'sk-never-expose-4242' })
    const surfaces: unknown[] = [
      agent,
      await agents.getAgent(agent.id),
      await agents.listAgents(),
      await agents.updateAgent(agent.id, { responsibility: 'otra' }),
      await agents.duplicateAgent(agent.id, { name: 'Copia' }),
      await agents.deactivateAgent(agent.id),
    ]
    for (const surface of surfaces) expect(JSON.stringify(surface)).not.toContain('sk-never-expose-4242')
    expect(Object.keys(agent)).not.toContain('apiKey')
  })
})
