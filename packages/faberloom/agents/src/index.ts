/**
 * Native product agents (`ctx.faberloomAgents`): the model pool with its
 * provider-discovery reconciliation, the versioned agent catalog with its three
 * creation routes, the versioned model policy, the shared resolver and
 * recommender, per-execution selection records, contextual outcome evidence, and
 * subagent delegation under a shared budget. Records are durable through
 * `ctx.storageDomain`; an agent's API key lives in the credential seam
 * (`ctx.credentials`), named by {@link agentCredentialRef}.
 * @module @deepseek-ai/dsh-faberloom-agents
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { agentsDomainSpec, type AgentRecord, type ModelRecord, type OutcomeRecord, type SelectionRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: resolves the optional ctx.llm declaration used to verify live routes.
import type {} from '@deepseek-ai/dsh-llm'
// Type-only: the discovered row shape, and the optional ctx.faberloomModelCatalog
// declaration discovery goes through.
import type { DiscoveredModel } from '@deepseek-ai/dsh-faberloom-model-catalog'
import type {
  AgentInput,
  AgentPatch,
  BudgetPolicy,
  CostBucket,
  CostSummary,
  DelegateRequest,
  DelegateResult,
  DuplicateInput,
  EvidenceSummary,
  FaberLoomAgent,
  FaberLoomAgentId,
  FaberLoomModel,
  FaberLoomModelId,
  ModelInput,
  ModelPolicy,
  ModelReconciliation,
  Outcome,
  OutcomeInput,
  PolicyPatch,
  SelectionInput,
  RecommendCandidate,
  RecommendRequest,
  RecommendResult,
  ResolveRequest,
  ResolveResult,
  RunTemporarySubagentRequest,
  Selection,
  TemporarySubagentResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAgents: FaberLoomAgents
  }
}

/** Assumed tokens per attempt used only to compare models; never a billing figure. */
const ASSUMED_TOKENS_PER_ATTEMPT = 2000

/**
 * Scheme prefix of the credential reference derived from one agent id
 * ({@link agentCredentialRef}): the prefix followed by the uppercase
 * hexadecimal UTF-8 encoding of the id. Exported so a consumer can recognize
 * the references this package owns.
 */
export const AGENT_CREDENTIAL_REF_PREFIX = 'FABERLOOM_AGENT_API_KEY_'

const HEX = '0123456789ABCDEF'

/**
 * Encode one string's UTF-8 bytes as uppercase hexadecimal — the injective
 * payload of {@link agentCredentialRef}, so no two ids can name one reference.
 * @param value - the string to encode.
 * @returns its uppercase hexadecimal encoding.
 */
function hexOf(value: string): string {
  let encoded = ''
  for (const byte of new TextEncoder().encode(value)) encoded += `${HEX[byte >> 4]}${HEX[byte & 0x0f]}`
  return encoded
}

/**
 * The credential reference under which one agent's API key is stored in
 * `ctx.credentials`. The reference is derived solely from the agent id and is
 * always a valid POSIX environment-variable name ({@link AGENT_CREDENTIAL_REF_PREFIX}
 * plus the id's hexadecimal UTF-8 encoding), so a route can name it without
 * reading the record, and distinct ids can never collide on one reference.
 * @param id - the agent whose key reference to derive.
 * @returns the branded reference.
 */
export function agentCredentialRef(id: FaberLoomAgentId): CredentialRef {
  return credentialRef(`${AGENT_CREDENTIAL_REF_PREFIX}${hexOf(id)}`)
}

/** Presence and non-secret tail of one agent's key, safe to publish. */
interface AgentKeyState {
  /** Whether the agent's key currently resolves. */
  hasApiKey: boolean
  /** Stored tail of the key, when the record carries one. */
  apiKeyTail?: string
}

/** Fold a stored tail into the published key facts. */
function keyFacts(tail: string | null): AgentKeyState {
  return tail === null ? { hasApiKey: true } : { hasApiKey: true, apiKeyTail: tail }
}

/** Map one durable model record to the consumer-facing model. */
function toModel(id: FaberLoomModelId, record: ModelRecord): FaberLoomModel {
  return {
    id,
    provider: record.provider,
    model: record.model,
    capabilities: record.capabilities,
    contextWindow: record.contextWindow ?? undefined,
    maxOutput: record.maxOutput ?? undefined,
    inputPerMillion: record.inputPerMillion ?? undefined,
    outputPerMillion: record.outputPerMillion ?? undefined,
    currency: record.currency ?? undefined,
    available: record.available,
    checkedAt: record.checkedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Capability tags from the modalities one provider declared for a model: the
 * provider's own modality names, in declaration order, without inventing an
 * alias. `input_modalities: ["text","image"]` yields `["text","image"]`.
 * @param row - the discovered model.
 * @returns the deduplicated modality names, empty when the provider declared none.
 */
function modalityCapabilities(row: DiscoveredModel): string[] {
  const tags = new Set<string>()
  if (row.inputModalities !== undefined) for (const modality of row.inputModalities) tags.add(modality)
  if (row.outputModalities !== undefined) for (const modality of row.outputModalities) tags.add(modality)
  return [...tags]
}

/**
 * Fold one discovered model into a pool record. The provider's context window,
 * output limit, and modalities replace the stored values, while a field the
 * provider omitted keeps what the pool already recorded. A models response
 * carries no rates, so a stored rate survives and a new entry starts unknown:
 * the pool treats an unknown cost as uncertainty rather than zero.
 * @param provider - the provider id the discovery asked.
 * @param row - the discovered model.
 * @param existing - the pool entry being refreshed, or undefined when creating one.
 * @param now - ISO-8601 instant of this reconciliation.
 * @returns the record to persist.
 */
function discoveredRecord(provider: string, row: DiscoveredModel, existing: ModelRecord | undefined, now: string): ModelRecord {
  const capabilities = modalityCapabilities(row)
  return {
    provider,
    model: row.id,
    capabilities: capabilities.length > 0 ? capabilities : (existing?.capabilities ?? []),
    contextWindow: row.contextWindow ?? existing?.contextWindow ?? null,
    maxOutput: row.maxOutputTokens ?? existing?.maxOutput ?? null,
    inputPerMillion: existing?.inputPerMillion ?? null,
    outputPerMillion: existing?.outputPerMillion ?? null,
    currency: existing?.currency ?? null,
    available: true,
    checkedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** Read the model policy from a durable agent record. */
function policyFromRecord(record: AgentRecord): ModelPolicy {
  return {
    primary: record.policy.primary ?? undefined,
    exclusive: record.policy.exclusive,
    fallbacks: record.policy.fallbacks,
    escalation: record.policy.escalation ?? undefined,
    budget: record.policy.budget ?? undefined,
  }
}

/** Map one durable agent record and its resolved key state to the consumer-facing agent. */
function toAgent(id: FaberLoomAgentId, record: AgentRecord, key: AgentKeyState): FaberLoomAgent {
  return {
    id,
    name: record.name,
    responsibility: record.responsibility,
    spaceId: record.spaceId ?? undefined,
    detached: record.detached,
    ownerId: record.ownerId,
    seeded: record.seeded,
    origin: record.origin,
    originRef: record.originRef ?? undefined,
    baseAgentId: record.baseAgentId ?? undefined,
    skills: record.skills,
    tools: record.tools,
    subagents: record.subagents,
    provider: record.provider ?? undefined,
    model: record.model ?? undefined,
    webAccess: record.webAccess,
    mwtMcp: record.mwtMcp,
    sicopMcp: record.sicopMcp,
    hasApiKey: key.hasApiKey,
    ...key.apiKeyTail === undefined ? {} : { apiKeyTail: key.apiKeyTail },
    mailConnectionIds: record.mailConnectionIds,
    policy: policyFromRecord(record),
    lessons: record.lessons,
    active: record.active,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** The empty policy a new agent starts from. */
function emptyPolicy(): ModelPolicy {
  return { primary: undefined, exclusive: false, fallbacks: [], escalation: undefined, budget: undefined }
}

/** Apply a policy patch over the current policy. */
function applyPolicyPatch(current: ModelPolicy, patch: PolicyPatch | undefined): ModelPolicy {
  if (patch === undefined) return current
  return {
    primary: patch.primary === undefined ? current.primary : patch.primary === null ? undefined : patch.primary,
    exclusive: patch.exclusive ?? current.exclusive,
    fallbacks: patch.fallbacks !== undefined ? [...patch.fallbacks] : current.fallbacks,
    escalation: patch.escalation === undefined ? current.escalation : patch.escalation === null ? undefined : patch.escalation,
    budget: patch.budget === undefined ? current.budget : patch.budget === null ? undefined : patch.budget,
  }
}

/** Project a policy to its durable record shape. */
function policyToRecord(policy: ModelPolicy): AgentRecord['policy'] {
  return {
    primary: policy.primary ?? null,
    exclusive: policy.exclusive,
    fallbacks: [...policy.fallbacks],
    escalation: policy.escalation === undefined
      ? null
      : { authorized: [...policy.escalation.authorized], conditions: [...policy.escalation.conditions], mode: policy.escalation.mode },
    budget: policy.budget === undefined ? null : { ...policy.budget },
  }
}

/** Estimated cost of one attempt, or `undefined` when no rate is known. */
function estimateAttemptCost(model: FaberLoomModel): number | undefined {
  if (model.inputPerMillion === undefined && model.outputPerMillion === undefined) return undefined
  const half = ASSUMED_TOKENS_PER_ATTEMPT / 2
  const input = (model.inputPerMillion ?? 0) * half / 1_000_000
  const output = (model.outputPerMillion ?? 0) * half / 1_000_000
  return input + output
}

/** Fallback model key when a selection names no effective model. */
const UNKNOWN_MODEL_KEY = 'unknown'

/** Running total of one cost-grouping bucket. */
interface CostAccumulator {
  cost: number
  records: number
  partial: boolean
}

/** Fold one selection into a grouping accumulator. */
function foldCost(buckets: Map<string, CostAccumulator>, key: string, cost: number | undefined): void {
  const current = buckets.get(key) ?? { cost: 0, records: 0, partial: false }
  buckets.set(key, {
    cost: current.cost + (cost ?? 0),
    records: current.records + 1,
    partial: current.partial || cost === undefined,
  })
}

/** Project one accumulator map to cost buckets, priciest first. */
function toCostBuckets(by: CostBucket['by'], buckets: Map<string, CostAccumulator>): CostBucket[] {
  return [...buckets.entries()]
    .map(([key, value]) => ({ key, by, cost: value.cost, records: value.records, partial: value.partial }))
    .sort((left, right) => right.cost - left.cost || left.key.localeCompare(right.key))
}

/**
 * The product agents service: model pool, agent catalog, model policy resolver
 * and recommender, selection records, contextual evidence, and delegation.
 */
export class FaberLoomAgents extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof agentsDomainSpec>> | undefined

  /** Executable tool handlers registered in this process (not durable). */
  private readonly executables = new Map<string, (args: unknown) => unknown>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomAgents')
  }

  /** Open the agents domain once and keep its handle. */
  private domain(): Promise<Domain<typeof agentsDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(agentsDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.agentsDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async models(): Promise<KvTable<FaberLoomModelId, ModelRecord>> {
    return (await this.domain()).table('models')
  }

  private async agents(): Promise<KvTable<FaberLoomAgentId, AgentRecord>> {
    return (await this.domain()).table('agents')
  }

  private async selections(): Promise<KvTable<string, SelectionRecord>> {
    return (await this.domain()).table('selections')
  }

  private async outcomes(): Promise<KvTable<string, OutcomeRecord>> {
    return (await this.domain()).table('outcomes')
  }

  /** The credential seam when the composition mounts one, or undefined. */
  private credentials(): CredentialProvider | undefined {
    return this.ctx.get('credentials')
  }

  /**
   * Presence and tail of one agent's key. With a seam mounted, `describe` is
   * the whole fact — so a key rotated or removed outside the app stops
   * reporting as present. Without the seam, the record is the fallback: the
   * legacy stored value first, then the flag and tail a seam-mounted write left
   * behind.
   */
  private async keyStateOf(id: FaberLoomAgentId, record: AgentRecord): Promise<AgentKeyState> {
    const credentials = this.credentials()
    if (credentials !== undefined) {
      const info = await credentials.describe(agentCredentialRef(id))
      return info.configured ? keyFacts(record.apiKeyTail) : { hasApiKey: false }
    }
    if (record.apiKey !== null) return { hasApiKey: true, apiKeyTail: record.apiKey.slice(-4) }
    return record.hasApiKey ? keyFacts(record.apiKeyTail) : { hasApiKey: false }
  }

  /**
   * Move one record's legacy raw key into the credential seam and clear the
   * stored value. Idempotent: a record with no raw key is returned unchanged.
   * Without a mounted seam, or when the seam refuses the write, the stored
   * value stays so the secret is never lost, and a refusal is logged; the next
   * read retries.
   */
  private async migrateKey(
    id: FaberLoomAgentId,
    table: KvTable<FaberLoomAgentId, AgentRecord>,
    record: AgentRecord,
  ): Promise<AgentRecord> {
    const raw = record.apiKey
    if (raw === null) return record
    if (raw.length === 0) {
      // An empty stored value was never a usable key; clear it without a seam write.
      const next: AgentRecord = { ...record, apiKey: null, hasApiKey: false, apiKeyTail: null }
      await table.update(id, () => next)
      return next
    }
    const credentials = this.credentials()
    if (credentials === undefined) return record
    try {
      await credentials.set(agentCredentialRef(id), raw)
    } catch (error) {
      this.ctx.logger.warn('faberloom: migrating the API key of agent %s into the credential seam failed; keeping the stored value', id)
      this.ctx.logger.warn(error)
      return record
    }
    const next: AgentRecord = { ...record, apiKey: null, hasApiKey: true, apiKeyTail: raw.slice(-4) }
    await table.update(id, () => next)
    return next
  }

  /**
   * Read one agent record, completing any pending key migration.
   * @param id - the agent to read.
   * @returns the resolved table and the migrated record.
   * @throws Error when the agent does not exist.
   */
  private async loadRecord(id: FaberLoomAgentId): Promise<{ table: KvTable<FaberLoomAgentId, AgentRecord>; record: AgentRecord }> {
    const table = await this.agents()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: agent ${id} not found`)
    return { table, record: await this.migrateKey(id, table, record) }
  }

  /**
   * Store one agent's key: through the credential seam when mounted, and in a
   * composition without the seam in the record itself, the only store there.
   * Never returns or logs the value.
   * @param id - the agent the key belongs to.
   * @param value - the non-empty key.
   * @returns the record fields describing the stored key.
   */
  private async storeKey(
    id: FaberLoomAgentId,
    value: string,
  ): Promise<Pick<AgentRecord, 'apiKey' | 'hasApiKey' | 'apiKeyTail'>> {
    const credentials = this.credentials()
    if (credentials === undefined) return { apiKey: value, hasApiKey: true, apiKeyTail: value.slice(-4) }
    await credentials.set(agentCredentialRef(id), value)
    return { apiKey: null, hasApiKey: true, apiKeyTail: value.slice(-4) }
  }

  /**
   * Remove one agent's key from the seam when mounted and clear the record's
   * non-secret facts. Without a seam there is nothing managed to remove; the
   * explicit clear drops whatever the degraded record held.
   * @param id - the agent whose key to clear.
   * @returns the cleared record fields.
   */
  private async clearKey(id: FaberLoomAgentId): Promise<Pick<AgentRecord, 'apiKey' | 'hasApiKey' | 'apiKeyTail'>> {
    const credentials = this.credentials()
    if (credentials !== undefined) await credentials.unset(agentCredentialRef(id))
    return { apiKey: null, hasApiKey: false, apiKeyTail: null }
  }

  /** Live harness provider routes, or undefined when `ctx.llm` is not mounted. */
  private liveProviders(): string[] | undefined {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return undefined
    return llm.listProviders().map(provider => provider.id)
  }

  /** Wrap a selected model, refusing one the live harness does not serve. */
  private async selectResult(
    policyVersion: number,
    modelId: FaberLoomModelId,
    reason: string,
    estimatedCost: number | undefined,
    fallbackOf: FaberLoomModelId | undefined,
  ): Promise<ResolveResult> {
    const model = await this.getModel(modelId)
    if (model === undefined) {
      return { status: 'denied', modelId: undefined, reason: 'MODEL_NOT_IN_POOL', policyVersion, estimatedCost: undefined, fallbackOf: undefined }
    }
    const live = this.liveProviders()
    if (live !== undefined && live.length > 0 && !live.includes(model.provider)) {
      return { status: 'needs_decision', modelId: undefined, reason: 'MODEL_NOT_IN_LLM', policyVersion, estimatedCost, fallbackOf: undefined }
    }
    return { status: 'selected', modelId, reason, policyVersion, estimatedCost, fallbackOf }
  }

  /**
   * Fold the shared per-execution cost checks into one stop result. Unknown cost
   * under a budget never assumes zero, and a cost that would exceed the remaining
   * budget stops the attempt.
   * @param cost - estimated attempt cost, or undefined when no rate is known.
   * @param spent - budget already spent this execution.
   * @param budget - the policy's execution budget, when configured.
   * @param policyVersion - agent policy version the decision uses.
   * @returns the stop result, or undefined when the attempt may proceed.
   */
  private budgetStop(
    cost: number | undefined,
    spent: number,
    budget: BudgetPolicy | undefined,
    policyVersion: number,
  ): ResolveResult | undefined {
    if (budget !== undefined && cost === undefined) {
      return { status: 'needs_decision', modelId: undefined, reason: 'COST_UNKNOWN', policyVersion, estimatedCost: undefined, fallbackOf: undefined }
    }
    if (budget !== undefined && cost !== undefined && spent + cost > budget.perExecution) {
      return { status: 'needs_decision', modelId: undefined, reason: 'BUDGET_INSUFFICIENT', policyVersion, estimatedCost: cost, fallbackOf: undefined }
    }
    return undefined
  }

  // ── Model pool ──────────────────────────────────────────────────────

  /**
   * Register one accessible model in the pool.
   * @param input - provider, model, capabilities, limits, and rates.
   * @returns the registered model.
   */
  async registerModel(input: ModelInput): Promise<FaberLoomModel> {
    const table = await this.models()
    const now = new Date().toISOString()
    const id = brandString<FaberLoomModelId>(randomUUID())
    const record: ModelRecord = {
      provider: input.provider,
      model: input.model,
      capabilities: input.capabilities !== undefined ? [...input.capabilities] : [],
      contextWindow: input.contextWindow ?? null,
      maxOutput: input.maxOutput ?? null,
      inputPerMillion: input.inputPerMillion ?? null,
      outputPerMillion: input.outputPerMillion ?? null,
      currency: input.currency ?? null,
      available: input.available ?? true,
      checkedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(id, record)
    return toModel(id, record)
  }

  /**
   * List the accessible models.
   * @returns the pool entries.
   */
  async listModels(): Promise<FaberLoomModel[]> {
    const out: FaberLoomModel[] = []
    for (const [id, record] of (await this.models()).entries()) out.push(toModel(id, record))
    return out
  }

  /**
   * Read one model.
   * @param id - pool id.
   * @returns the model, or undefined.
   */
  async getModel(id: FaberLoomModelId): Promise<FaberLoomModel | undefined> {
    const record = (await this.models()).get(id)
    return record === undefined ? undefined : toModel(id, record)
  }

  /**
   * Set a model's availability after a checked probe.
   * @param id - pool id.
   * @param available - the new availability.
   * @returns the updated model.
   */
  async setAvailability(id: FaberLoomModelId, available: boolean): Promise<FaberLoomModel> {
    const table = await this.models()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: model ${id} not found`)
    const next: ModelRecord = { ...record, available, checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return toModel(id, next)
  }

  /**
   * Remove one model from the pool.
   * @param id - pool id.
   * @returns true when it existed.
   */
  async removeModel(id: FaberLoomModelId): Promise<boolean> {
    return (await this.models()).delete(id)
  }

  /**
   * Reconcile pool availability with the live harness routes from `ctx.llm`.
   * @returns how many entries were checked and how many are now available.
   */
  async syncPool(): Promise<{ checked: number; available: number }> {
    const live = this.liveProviders()
    if (live === undefined) return { checked: 0, available: 0 }
    const table = await this.models()
    const now = new Date().toISOString()
    let available = 0
    for (const id of [...table.keys()]) {
      const record = table.get(id)
      if (record === undefined) continue
      const next: ModelRecord = { ...record, available: live.includes(record.provider), checkedAt: now, updatedAt: now }
      await table.update(id, () => next)
      if (next.available) available += 1
    }
    return { checked: table.size, available }
  }

  /**
   * Reconcile the model pool with the models one provider currently serves.
   * Discovery runs through `ctx.faberloomModelCatalog`, which resolves the named
   * credential reference through the credentials seam, per call and like the
   * catalog itself. Every discovered model becomes a pool entry: an unlisted id
   * is created, an already-registered one is refreshed from the provider's
   * fields, and a pool entry of this provider that discovery no longer lists is
   * marked unavailable rather than deleted, so a recorded selection never points
   * at a missing row. A models response carries no rates, so a refreshed entry
   * keeps its recorded rate and a created entry starts with an unknown cost.
   * @param providerId - the provider whose served models to reconcile.
   * @param credentialRef - the credential reference discovery authenticates with.
   * @returns how many entries this call created, refreshed, and marked unavailable.
   * @throws Error when no model catalog is mounted; the catalog's own errors
   * otherwise (unknown provider, unresolvable credential, transport, or rejection).
   */
  async reconcileModels(providerId: string, credentialRef: CredentialRef): Promise<ModelReconciliation> {
    const catalog = this.ctx.get('faberloomModelCatalog')
    if (catalog === undefined) {
      throw new Error('faberloom: no model catalog is mounted; mount faberloom-model-catalog to discover provider models')
    }
    const discovered = await catalog.discover(providerId, credentialRef)
    const table = await this.models()
    const now = new Date().toISOString()
    const listed = new Set(discovered.map(row => row.id))
    // One pool entry per id, so a provider+model registered more than once is
    // refreshed in place instead of gaining a duplicate.
    const registered = new Map<string, Array<{ id: FaberLoomModelId; record: ModelRecord }>>()
    for (const [id, record] of table.entries()) {
      if (record.provider !== providerId) continue
      const entries = registered.get(record.model)
      if (entries === undefined) registered.set(record.model, [{ id, record }])
      else entries.push({ id, record })
    }

    let created = 0
    let refreshed = 0
    for (const row of discovered) {
      const entries = registered.get(row.id)
      if (entries === undefined) {
        await table.put(brandString<FaberLoomModelId>(randomUUID()), discoveredRecord(providerId, row, undefined, now))
        created += 1
        continue
      }
      for (const { id, record } of entries) {
        await table.update(id, () => discoveredRecord(providerId, row, record, now))
        refreshed += 1
      }
    }

    let unavailable = 0
    for (const [model, entries] of registered) {
      if (listed.has(model)) continue
      for (const { id, record } of entries) {
        await table.update(id, () => ({ ...record, available: false, checkedAt: now, updatedAt: now }))
        unavailable += 1
      }
    }
    return { provider: providerId, created, refreshed, unavailable }
  }

  // ── Executable tools ────────────────────────────────────────────────

  /**
   * Register one executable tool handler in this process.
   * @param name - tool name referenced by an agent's `tools` list.
   * @param handler - sync or async handler over the call arguments.
   * @returns the disposer removing the handler.
   */
  registerExecutableTool(name: string, handler: (args: unknown) => unknown): () => void {
    this.executables.set(name, handler)
    return () => {
      if (this.executables.get(name) === handler) this.executables.delete(name)
    }
  }

  /**
   * List the executable tools registered in this process.
   * @returns the tool names.
   */
  listExecutableTools(): string[] {
    return [...this.executables.keys()]
  }

  /**
   * Execute one registered tool for an agent, enforcing the agent's tool allowlist.
   * @param agentId - the agent that acts.
   * @param toolName - the tool to run.
   * @param args - handler arguments.
   * @returns the tool name and its result.
   */
  async executeTool(agentId: FaberLoomAgentId, toolName: string, args: unknown): Promise<{ toolName: string; result: unknown }> {
    const agent = await this.getAgent(agentId)
    if (!agent.tools.includes(toolName)) throw new Error(`faberloom: tool ${toolName} is not permitted for agent ${agent.name}`)
    const handler = this.executables.get(toolName)
    if (handler === undefined) throw new Error(`faberloom: tool ${toolName} is not registered`)
    const result = await handler(args)
    return { toolName, result }
  }

  // ── Temporary subagents ─────────────────────────────────────────────

  /**
   * Run a one-shot temporary subagent: it shares the parent budget, may use only
   * tools the parent already allows, executes one tool, and is never added to
   * the catalog.
   * @param parentAgentId - the parent agent.
   * @param request - name, responsibility, model, task, and optional tool call.
   * @returns the run outcome and the remaining parent budget.
   */
  async runTemporarySubagent(parentAgentId: FaberLoomAgentId, request: RunTemporarySubagentRequest): Promise<TemporarySubagentResult> {
    const parent = await this.getAgent(parentAgentId)
    const budget = parent.policy.budget
    const spent = request.spent ?? 0
    const remaining = budget === undefined ? undefined : budget.perExecution - spent
    if (budget !== undefined && spent >= budget.perExecution) {
      return { status: 'denied', modelId: undefined, reason: 'BUDGET_EXCEEDED', cost: undefined, remainingBudget: remaining }
    }
    const model = await this.getModel(request.primary)
    if (model === undefined) {
      return { status: 'denied', modelId: undefined, reason: 'MODEL_NOT_IN_POOL', cost: undefined, remainingBudget: remaining }
    }
    const live = this.liveProviders()
    if (live !== undefined && live.length > 0 && !live.includes(model.provider)) {
      return { status: 'needs_decision', modelId: undefined, reason: 'MODEL_NOT_IN_LLM', cost: undefined, remainingBudget: remaining }
    }
    const cost = estimateAttemptCost(model)
    if (budget !== undefined && cost === undefined) {
      return { status: 'needs_decision', modelId: undefined, reason: 'COST_UNKNOWN', cost: undefined, remainingBudget: remaining }
    }
    if (budget !== undefined && cost !== undefined && spent + cost > budget.perExecution) {
      return { status: 'needs_decision', modelId: undefined, reason: 'BUDGET_INSUFFICIENT', cost, remainingBudget: remaining }
    }
    let result: unknown
    if (request.tool !== undefined) {
      const allowed = request.tools === undefined ? parent.tools : request.tools.filter(tool => parent.tools.includes(tool))
      if (!allowed.includes(request.tool)) {
        return { status: 'denied', modelId: request.primary, reason: 'TOOL_NOT_PERMITTED', cost, remainingBudget: remaining }
      }
      const handler = this.executables.get(request.tool)
      if (handler === undefined) {
        return { status: 'denied', modelId: request.primary, reason: 'TOOL_NOT_REGISTERED', cost, remainingBudget: remaining }
      }
      result = await handler(request.args)
    }
    await this.recordSelection({
      agentId: parent.id,
      task: request.task,
      effectiveModel: request.primary,
      reason: 'TEMPORARY_SUBAGENT',
      ...cost === undefined ? {} : { cost },
    })
    return {
      status: 'selected',
      modelId: request.primary,
      reason: 'TEMPORARY_SUBAGENT',
      cost,
      remainingBudget: budget === undefined ? undefined : budget.perExecution - (spent + (cost ?? 0)),
      ...result === undefined ? {} : { result },
    }
  }

  // ── Agent catalog ───────────────────────────────────────────────────

  /**
   * Create one agent through any of the three routes.
   * @param input - name, responsibility, route, and initial policy.
   * @returns the created agent.
   */
  async createAgent(input: AgentInput): Promise<FaberLoomAgent> {
    const table = await this.agents()
    const now = new Date().toISOString()
    const id = brandString<FaberLoomAgentId>(randomUUID())
    const policy = applyPolicyPatch(emptyPolicy(), input.policy)
    const key = input.apiKey !== undefined && input.apiKey.length > 0
      ? await this.storeKey(id, input.apiKey)
      : { apiKey: null, hasApiKey: false, apiKeyTail: null }
    const record: AgentRecord = {
      name: input.name,
      responsibility: input.responsibility,
      spaceId: input.spaceId ?? null,
      detached: false,
      ownerId: input.ownerId ?? '',
      seeded: input.seeded ?? false,
      origin: input.origin ?? 'scratch',
      originRef: input.originRef ?? null,
      baseAgentId: null,
      skills: input.skills !== undefined ? [...input.skills] : [],
      tools: input.tools !== undefined ? [...input.tools] : [],
      subagents: [],
      provider: input.provider ?? null,
      model: input.model ?? null,
      ...key,
      webAccess: input.webAccess ?? false,
      mwtMcp: input.mwtMcp ?? true,
      sicopMcp: input.sicopMcp ?? true,
      mailConnectionIds: input.mailConnectionIds !== undefined ? [...input.mailConnectionIds] : [],
      policy: policyToRecord(policy),
      lessons: [],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(id, record)
    return toAgent(id, record, await this.keyStateOf(id, record))
  }

  /**
   * List the catalog.
   * @returns agents oldest first.
   */
  async listAgents(): Promise<FaberLoomAgent[]> {
    const table = await this.agents()
    const out: FaberLoomAgent[] = []
    for (const [id, raw] of table.entries()) {
      const record = await this.migrateKey(id, table, raw)
      out.push(toAgent(id, record, await this.keyStateOf(id, record)))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Read one agent.
   * @param id - agent id.
   * @returns the agent.
   */
  async getAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent> {
    const { record } = await this.loadRecord(id)
    return toAgent(id, record, await this.keyStateOf(id, record))
  }

  /**
   * Apply a patch to one agent, bumping its version. A key the patch omits
   * stays as it was; `null` or an empty string clears it.
   * @param id - agent id.
   * @param patch - fields to change.
   * @returns the updated agent.
   */
  async updateAgent(id: FaberLoomAgentId, patch: AgentPatch): Promise<FaberLoomAgent> {
    const { table, record } = await this.loadRecord(id)
    const policy = applyPolicyPatch(policyFromRecord(record), patch.policy)
    const key = patch.apiKey === undefined
      ? { apiKey: record.apiKey, hasApiKey: record.hasApiKey, apiKeyTail: record.apiKeyTail }
      : patch.apiKey === null || patch.apiKey.length === 0
        ? await this.clearKey(id)
        : await this.storeKey(id, patch.apiKey)
    const next: AgentRecord = {
      ...record,
      name: patch.name ?? record.name,
      responsibility: patch.responsibility ?? record.responsibility,
      spaceId: patch.spaceId !== undefined ? patch.spaceId : record.spaceId,
      detached: patch.detached ?? record.detached,
      skills: patch.skills !== undefined ? [...patch.skills] : record.skills,
      tools: patch.tools !== undefined ? [...patch.tools] : record.tools,
      subagents: patch.subagents !== undefined ? patch.subagents.map(entry => ({ ...entry })) : record.subagents,
      provider: patch.provider !== undefined ? patch.provider : record.provider,
      model: patch.model !== undefined ? patch.model : record.model,
      ...key,
      webAccess: patch.webAccess ?? record.webAccess,
      mwtMcp: patch.mwtMcp ?? record.mwtMcp,
      sicopMcp: patch.sicopMcp ?? record.sicopMcp,
      mailConnectionIds: patch.mailConnectionIds !== undefined ? [...patch.mailConnectionIds] : record.mailConnectionIds,
      lessons: patch.lessons !== undefined ? [...patch.lessons] : record.lessons,
      policy: policyToRecord(policy),
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await table.update(id, () => next)
    return toAgent(id, next, await this.keyStateOf(id, next))
  }

  /**
   * Duplicate one agent: copies configuration and explicitly selected lessons,
   * never the source's evidence (confidence is not transferred) and never its
   * key — a credential is not readable, so the copy starts without one.
   * @param id - source agent id.
   * @param input - name, optional space, and selected lessons for the copy.
   * @returns the created duplicate.
   */
  async duplicateAgent(id: FaberLoomAgentId, input: DuplicateInput): Promise<FaberLoomAgent> {
    const { table, record: source } = await this.loadRecord(id)
    const now = new Date().toISOString()
    const copyId = brandString<FaberLoomAgentId>(randomUUID())
    const record: AgentRecord = {
      ...source,
      name: input.name,
      spaceId: input.spaceId ?? source.spaceId,
      baseAgentId: id,
      apiKey: null,
      hasApiKey: false,
      apiKeyTail: null,
      lessons: input.lessons !== undefined ? [...input.lessons] : [],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(copyId, record)
    return toAgent(copyId, record, await this.keyStateOf(copyId, record))
  }

  /**
   * Deactivate one agent; the record stays in the catalog.
   * @param id - agent id.
   * @returns the deactivated agent.
   */
  async deactivateAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent> {
    const { table, record } = await this.loadRecord(id)
    const next: AgentRecord = { ...record, active: false, version: record.version + 1, updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return toAgent(id, next, await this.keyStateOf(id, next))
  }

  // ── Shared resolver ─────────────────────────────────────────────────

  /**
   * Remove one agent from the catalog.
   * @param id - agent id.
   * @returns true when it existed.
   */
  async removeAgent(id: FaberLoomAgentId): Promise<boolean> {
    return (await this.agents()).delete(id)
  }

  /**
   * Resolve the effective model for one task attempt under the agent policy and
   * shared budget. Fails closed: exclusive providers never substitute, unknown
   * cost under a budget never assumes zero.
   * @param agentId - the agent to resolve for.
   * @param request - task, provider state, met condition, and spent budget.
   * @returns the selection or the reason to stop.
   */
  async resolveModel(agentId: FaberLoomAgentId, request: ResolveRequest): Promise<ResolveResult> {
    const agent = await this.getAgent(agentId)
    const policy = agent.policy
    if (policy.primary === undefined) {
      return { status: 'needs_decision', modelId: undefined, reason: 'NO_PRIMARY', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }
    const budget = policy.budget
    const spent = request.spent ?? 0
    const attempted = request.attempted ?? 0
    const escalated = request.escalated ?? 0
    if (budget !== undefined && spent >= budget.perExecution) {
      return { status: 'denied', modelId: undefined, reason: 'BUDGET_EXCEEDED', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }
    if (budget !== undefined && attempted >= budget.maxAttempts) {
      return { status: 'denied', modelId: undefined, reason: 'MAX_ATTEMPTS', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }

    if (request.providerDown === true) {
      if (policy.exclusive) {
        return { status: 'denied', modelId: undefined, reason: 'EXCLUSIVE_PROVIDER_DOWN', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const fallbackId = policy.fallbacks[0]
      if (fallbackId === undefined) {
        return { status: 'denied', modelId: undefined, reason: 'NO_FALLBACK', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const fallback = await this.getModel(fallbackId)
      if (fallback === undefined) {
        return { status: 'denied', modelId: undefined, reason: 'FALLBACK_NOT_IN_POOL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const cost = estimateAttemptCost(fallback)
      const stop = this.budgetStop(cost, spent, budget, agent.version)
      if (stop !== undefined) return stop
      return this.selectResult(agent.version, fallbackId, 'PROVIDER_FALLBACK', cost, policy.primary)
    }

    if (request.condition !== undefined) {
      const escalation = policy.escalation
      if (escalation === undefined) {
        return { status: 'needs_decision', modelId: undefined, reason: 'NO_ESCALATION_POLICY', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      if (!escalation.conditions.includes(request.condition)) {
        return { status: 'needs_decision', modelId: undefined, reason: 'CONDITION_NOT_AUTHORIZED', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      if (escalation.mode === 'manual') {
        return { status: 'needs_approval', modelId: undefined, reason: 'ESCALATION_APPROVAL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      if (budget !== undefined && escalated >= budget.maxEscalations) {
        return { status: 'denied', modelId: undefined, reason: 'MAX_ESCALATIONS', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const authorized = escalation.authorized[0]
      if (authorized === undefined) {
        return { status: 'needs_decision', modelId: undefined, reason: 'NO_AUTHORIZED_MODEL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const model = await this.getModel(authorized)
      if (model === undefined) {
        return { status: 'denied', modelId: undefined, reason: 'ESCALATION_MODEL_NOT_IN_POOL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      const cost = estimateAttemptCost(model)
      const stop = this.budgetStop(cost, spent, budget, agent.version)
      if (stop !== undefined) return stop
      return this.selectResult(agent.version, authorized, 'ESCALATED', cost, policy.primary)
    }

    const primary = await this.getModel(policy.primary)
    if (primary === undefined) {
      return { status: 'denied', modelId: undefined, reason: 'PRIMARY_NOT_IN_POOL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }
    const cost = estimateAttemptCost(primary)
    const stop = this.budgetStop(cost, spent, budget, agent.version)
    if (stop !== undefined) return stop
    return this.selectResult(agent.version, policy.primary, 'PRIMARY', cost, undefined)
  }

  /**
   * Recommend models for a task by cost per useful result over accessible,
   * capable candidates, exposing uncertainty instead of guessing.
   * @param request - required capabilities, context floor, and task label.
   * @returns the recommended model, ranked alternatives, and uncertainty.
   */
  async recommendModel(request: RecommendRequest): Promise<RecommendResult> {
    const required = request.capabilities ?? []
    const candidates: RecommendCandidate[] = []
    const uncertainty: string[] = []
    for (const model of await this.listModels()) {
      if (!model.available) continue
      if (!required.every(capability => model.capabilities.includes(capability))) continue
      if (request.minContextWindow !== undefined
        && (model.contextWindow === undefined || model.contextWindow < request.minContextWindow)) continue
      const summary = await this.evidence({ modelId: model.id, ...(request.task === undefined ? {} : { task: request.task }) })
      const provisional = summary.uses === 0
      const usefulRate = summary.approved === 0 && summary.corrected === 0 ? 1 : summary.approved / summary.uses
      const attempts = usefulRate > 0 ? 1 / usefulRate : undefined
      const attemptCost = estimateAttemptCost(model)
      const costPerUsefulResult = attemptCost === undefined || attempts === undefined ? undefined : attemptCost * attempts
      const reasons: string[] = []
      if (attemptCost === undefined) uncertainty.push(`sin tarifa para ${model.provider}/${model.model}`)
      if (provisional) reasons.push('sin evidencia para esta tarea')
      if (summary.correctionRate !== undefined && summary.correctionRate > 0) {
        reasons.push(`correcciones ${String(Math.round(summary.correctionRate * 100))}%`)
      }
      candidates.push({ modelId: model.id, costPerUsefulResult, uses: summary.uses, provisional, reasons })
    }
    candidates.sort((left, right) => {
      const leftCost = left.costPerUsefulResult
      const rightCost = right.costPerUsefulResult
      if (leftCost === undefined && rightCost === undefined) return right.uses - left.uses
      if (leftCost === undefined) return 1
      if (rightCost === undefined) return -1
      return leftCost - rightCost
    })
    if (candidates.length === 0) uncertainty.push('ningun modelo accesible cumple los requisitos')
    return { recommended: candidates[0]?.modelId, alternatives: candidates, uncertainty }
  }

  // ── Records and evidence ────────────────────────────────────────────

  /**
   * Record one model selection for an execution step.
   * @param entry - the selection facts (id and instant are assigned).
   * @returns the stored selection.
   */
  async recordSelection(entry: SelectionInput): Promise<Selection> {
    const id = randomUUID()
    const at = new Date().toISOString()
    const record: SelectionRecord = {
      agentId: entry.agentId,
      task: entry.task,
      requestedModel: entry.requestedModel ?? null,
      effectiveModel: entry.effectiveModel ?? null,
      reason: entry.reason,
      cost: entry.cost ?? null,
      at,
    }
    await (await this.selections()).put(id, record)
    return {
      id,
      agentId: entry.agentId,
      task: entry.task,
      requestedModel: entry.requestedModel,
      effectiveModel: entry.effectiveModel,
      reason: entry.reason,
      cost: entry.cost,
      at,
    }
  }

  /**
   * List recorded selections.
   * @param filter - optional agent and task filters.
   * @returns selections oldest first.
   */
  async listSelections(filter: { agentId?: FaberLoomAgentId; task?: string } = {}): Promise<Selection[]> {
    const out: Selection[] = []
    for (const [id, record] of (await this.selections()).entries()) {
      if (filter.agentId !== undefined && record.agentId !== filter.agentId) continue
      if (filter.task !== undefined && record.task !== filter.task) continue
      out.push({
        id,
        agentId: record.agentId,
        task: record.task,
        requestedModel: record.requestedModel ?? undefined,
        effectiveModel: record.effectiveModel ?? undefined,
        reason: record.reason,
        cost: record.cost ?? undefined,
        at: record.at,
      })
    }
    out.sort((left, right) => left.at.localeCompare(right.at))
    return out
  }

  /**
   * Record one human outcome for an agent/model/task.
   * @param entry - the outcome facts (id and instant are assigned).
   * @returns the stored outcome.
   */
  async recordOutcome(entry: OutcomeInput): Promise<Outcome> {
    const id = randomUUID()
    const at = new Date().toISOString()
    const record: OutcomeRecord = {
      agentId: entry.agentId,
      task: entry.task,
      modelId: entry.modelId,
      outcome: entry.outcome,
      cost: entry.cost ?? null,
      at,
    }
    await (await this.outcomes()).put(id, record)
    return { id, agentId: entry.agentId, task: entry.task, modelId: entry.modelId, outcome: entry.outcome, cost: entry.cost, at }
  }

  /**
   * Aggregate contextual performance for a filter.
   * @param filter - optional agent, task, and model filters.
   * @returns uses, approvals, corrections, correction rate, and cost per useful result.
   */
  async evidence(filter: { agentId?: FaberLoomAgentId; task?: string; modelId?: FaberLoomModelId } = {}): Promise<EvidenceSummary> {
    let uses = 0
    let approved = 0
    let corrected = 0
    let costSum = 0
    let costKnown = true
    for (const [, record] of (await this.outcomes()).entries()) {
      if (filter.agentId !== undefined && record.agentId !== filter.agentId) continue
      if (filter.task !== undefined && record.task !== filter.task) continue
      if (filter.modelId !== undefined && record.modelId !== filter.modelId) continue
      uses += 1
      if (record.outcome === 'approved') approved += 1
      else corrected += 1
      if (record.cost === null) costKnown = false
      else costSum += record.cost
    }
    return {
      uses,
      approved,
      corrected,
      correctionRate: uses === 0 ? undefined : corrected / uses,
      costPerUsefulResult: uses === 0 || approved === 0 || !costKnown ? undefined : costSum / approved,
    }
  }

  /**
   * Aggregate the user's recorded spend, grouped by effective model, agent, and
   * task. A selection recorded without a cost makes the summary partial rather
   * than contributing zero; the currency is reported only when the models behind
   * the selections agree on one.
   * @param filter - optional agent, task, and inclusive lower time bound.
   * @returns totals, shared currency, and the three groupings.
   */
  async costs(filter: { agentId?: FaberLoomAgentId; task?: string; since?: string } = {}): Promise<CostSummary> {
    const currencyOf = new Map<string, string | undefined>()
    for (const model of await this.listModels()) currencyOf.set(model.id, model.currency)
    const byModel = new Map<string, CostAccumulator>()
    const byAgent = new Map<string, CostAccumulator>()
    const byTask = new Map<string, CostAccumulator>()
    const currencies = new Set<string>()
    let total = 0
    let records = 0
    let partial = false
    let since: string | undefined
    const selections = await this.listSelections(filter.agentId === undefined ? {} : { agentId: filter.agentId })
    for (const selection of selections) {
      if (filter.task !== undefined && selection.task !== filter.task) continue
      if (filter.since !== undefined && selection.at < filter.since) continue
      records += 1
      if (since === undefined || selection.at < since) since = selection.at
      const known = selection.cost
      if (known === undefined) partial = true
      else total += known
      if (selection.effectiveModel !== undefined) {
        const currency = currencyOf.get(selection.effectiveModel)
        if (currency !== undefined) currencies.add(currency)
      }
      foldCost(byModel, selection.effectiveModel === undefined ? UNKNOWN_MODEL_KEY : String(selection.effectiveModel), known)
      foldCost(byAgent, String(selection.agentId), known)
      foldCost(byTask, selection.task, known)
    }
    return {
      currency: currencies.size === 1 ? [...currencies][0] : undefined,
      total,
      records,
      partial,
      since,
      at: new Date().toISOString(),
      byModel: toCostBuckets('model', byModel),
      byAgent: toCostBuckets('agent', byAgent),
      byTask: toCostBuckets('task', byTask),
    }
  }

  // ── Delegation ──────────────────────────────────────────────────────
  /**
   * Delegate one task to a named subagent, resolving its policy inside the
   * parent's shared budget and recording the selection.
   * @param parentAgentId - the parent agent.
   * @param request - subagent name, task, spent budget, and met condition.
   * @returns the subagent result and the remaining parent budget.
   */
  async delegate(parentAgentId: FaberLoomAgentId, request: DelegateRequest): Promise<DelegateResult> {
    const parent = await this.getAgent(parentAgentId)
    const budget = parent.policy.budget
    const spent = request.spent ?? 0
    const link = parent.subagents.find(entry => entry.name === request.subagent)
    if (link === undefined) {
      return {
        status: 'denied',
        modelId: undefined,
        reason: 'SUBAGENT_NOT_FOUND',
        cost: undefined,
        remainingBudget: budget === undefined ? undefined : budget.perExecution - spent,
      }
    }
    if (budget !== undefined && spent >= budget.perExecution) {
      return {
        status: 'denied',
        modelId: undefined,
        reason: 'BUDGET_EXCEEDED',
        cost: undefined,
        remainingBudget: budget.perExecution - spent,
      }
    }
    const resolved = await this.resolveModel(link.agentId, {
      task: request.task,
      spent,
      ...(request.condition === undefined ? {} : { condition: request.condition }),
    })
    const cost = resolved.estimatedCost
    if (budget !== undefined && resolved.status === 'selected' && cost !== undefined && spent + cost > budget.perExecution) {
      return { status: 'denied', modelId: resolved.modelId, reason: 'BUDGET_EXCEEDED', cost, remainingBudget: budget.perExecution - spent }
    }
    if (resolved.modelId !== undefined) {
      await this.recordSelection({
        agentId: link.agentId,
        task: request.task,
        effectiveModel: resolved.modelId,
        reason: resolved.reason,
        ...cost === undefined ? {} : { cost },
      })
    }
    return {
      status: resolved.status,
      modelId: resolved.modelId,
      reason: resolved.reason,
      cost,
      remainingBudget: budget === undefined ? undefined : budget.perExecution - (spent + (cost ?? 0)),
    }
  }
}

export default FaberLoomAgents
