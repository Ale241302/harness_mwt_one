/**
 * Native product agents (`ctx.faberloomAgents`): the model pool, the versioned
 * agent catalog with its three creation routes, the versioned model policy, the
 * shared resolver and recommender, per-execution selection records, contextual
 * outcome evidence, and subagent delegation under a shared budget. Records are
 * durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-agents
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { agentsDomainSpec, type AgentRecord, type ModelRecord, type OutcomeRecord, type SelectionRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: resolves the optional ctx.llm declaration used to verify live routes.
import type {} from '@deepseek-ai/dsh-llm'
import type {
  AgentInput,
  AgentPatch,
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

/** Map one durable agent record to the consumer-facing agent. */
function toAgent(id: FaberLoomAgentId, record: AgentRecord): FaberLoomAgent {
  return {
    id,
    name: record.name,
    responsibility: record.responsibility,
    spaceId: record.spaceId ?? undefined,
    origin: record.origin,
    originRef: record.originRef ?? undefined,
    baseAgentId: record.baseAgentId ?? undefined,
    skills: record.skills,
    tools: record.tools,
    subagents: record.subagents,
    provider: record.provider ?? undefined,
    model: record.model ?? undefined,
    webAccess: record.webAccess,
    hasApiKey: record.apiKey !== null,
    mailConnectionIds: record.mailConnectionIds,
    policy: {
      primary: record.policy.primary ?? undefined,
      exclusive: record.policy.exclusive,
      fallbacks: record.policy.fallbacks,
      escalation: record.policy.escalation ?? undefined,
      budget: record.policy.budget ?? undefined,
    },
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
  private readonly executables = new Map<string, (args: unknown) => unknown | Promise<unknown>>()

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

  // ── Executable tools ────────────────────────────────────────────────

  /**
   * Register one executable tool handler in this process.
   * @param name - tool name referenced by an agent's `tools` list.
   * @param handler - sync or async handler over the call arguments.
   * @returns the disposer removing the handler.
   */
  registerExecutableTool(name: string, handler: (args: unknown) => unknown | Promise<unknown>): () => void {
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
    const record: AgentRecord = {
      name: input.name,
      responsibility: input.responsibility,
      spaceId: input.spaceId ?? null,
      origin: input.origin ?? 'scratch',
      originRef: input.originRef ?? null,
      baseAgentId: null,
      skills: input.skills !== undefined ? [...input.skills] : [],
      tools: input.tools !== undefined ? [...input.tools] : [],
      subagents: [],
      provider: input.provider ?? null,
      model: input.model ?? null,
      apiKey: input.apiKey ?? null,
      webAccess: input.webAccess ?? false,
      mailConnectionIds: input.mailConnectionIds !== undefined ? [...input.mailConnectionIds] : [],
      policy: policyToRecord(policy),
      lessons: [],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(id, record)
    return toAgent(id, record)
  }

  /**
   * List the catalog.
   * @returns agents oldest first.
   */
  async listAgents(): Promise<FaberLoomAgent[]> {
    const out: FaberLoomAgent[] = []
    for (const [id, record] of (await this.agents()).entries()) out.push(toAgent(id, record))
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Read one agent.
   * @param id - agent id.
   * @returns the agent.
   */
  async getAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent> {
    const record = (await this.agents()).get(id)
    if (record === undefined) throw new Error(`faberloom: agent ${id} not found`)
    return toAgent(id, record)
  }

  /**
   * Apply a patch to one agent, bumping its version.
   * @param id - agent id.
   * @param patch - fields to change.
   * @returns the updated agent.
   */
  async updateAgent(id: FaberLoomAgentId, patch: AgentPatch): Promise<FaberLoomAgent> {
    const table = await this.agents()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: agent ${id} not found`)
    const policy = applyPolicyPatch(toAgent(id, record).policy, patch.policy)
    const next: AgentRecord = {
      ...record,
      name: patch.name ?? record.name,
      responsibility: patch.responsibility ?? record.responsibility,
      spaceId: patch.spaceId !== undefined ? patch.spaceId : record.spaceId,
      skills: patch.skills !== undefined ? [...patch.skills] : record.skills,
      tools: patch.tools !== undefined ? [...patch.tools] : record.tools,
      subagents: patch.subagents !== undefined ? patch.subagents.map(entry => ({ ...entry })) : record.subagents,
      provider: patch.provider !== undefined ? patch.provider : record.provider,
      model: patch.model !== undefined ? patch.model : record.model,
      apiKey: patch.apiKey === undefined
        ? record.apiKey
        : patch.apiKey === null || patch.apiKey.length === 0 ? null : patch.apiKey,
      webAccess: patch.webAccess ?? record.webAccess,
      mailConnectionIds: patch.mailConnectionIds !== undefined ? [...patch.mailConnectionIds] : record.mailConnectionIds,
      lessons: patch.lessons !== undefined ? [...patch.lessons] : record.lessons,
      policy: policyToRecord(policy),
      version: record.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await table.update(id, () => next)
    return toAgent(id, next)
  }

  /**
   * Duplicate one agent: copies configuration and explicitly selected lessons,
   * never the source's evidence (confidence is not transferred).
   * @param id - source agent id.
   * @param input - name, optional space, and selected lessons for the copy.
   * @returns the created duplicate.
   */
  async duplicateAgent(id: FaberLoomAgentId, input: DuplicateInput): Promise<FaberLoomAgent> {
    const table = await this.agents()
    const source = table.get(id)
    if (source === undefined) throw new Error(`faberloom: agent ${id} not found`)
    const now = new Date().toISOString()
    const copyId = brandString<FaberLoomAgentId>(randomUUID())
    const record: AgentRecord = {
      ...source,
      name: input.name,
      spaceId: input.spaceId ?? source.spaceId,
      baseAgentId: id,
      lessons: input.lessons !== undefined ? [...input.lessons] : [],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(copyId, record)
    return toAgent(copyId, record)
  }

  /**
   * Deactivate one agent; the record stays in the catalog.
   * @param id - agent id.
   * @returns the deactivated agent.
   */
  async deactivateAgent(id: FaberLoomAgentId): Promise<FaberLoomAgent> {
    const table = await this.agents()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: agent ${id} not found`)
    const next: AgentRecord = { ...record, active: false, version: record.version + 1, updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return toAgent(id, next)
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
      if (budget !== undefined && cost === undefined) {
        return { status: 'needs_decision', modelId: undefined, reason: 'COST_UNKNOWN', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      if (budget !== undefined && cost !== undefined && spent + cost > budget.perExecution) {
        return { status: 'needs_decision', modelId: undefined, reason: 'BUDGET_INSUFFICIENT', policyVersion: agent.version, estimatedCost: cost, fallbackOf: undefined }
      }
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
      if (budget !== undefined && cost === undefined) {
        return { status: 'needs_decision', modelId: undefined, reason: 'COST_UNKNOWN', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
      }
      if (budget !== undefined && cost !== undefined && spent + cost > budget.perExecution) {
        return { status: 'needs_decision', modelId: undefined, reason: 'BUDGET_INSUFFICIENT', policyVersion: agent.version, estimatedCost: cost, fallbackOf: undefined }
      }
      return this.selectResult(agent.version, authorized, 'ESCALATED', cost, policy.primary)
    }

    const primary = await this.getModel(policy.primary)
    if (primary === undefined) {
      return { status: 'denied', modelId: undefined, reason: 'PRIMARY_NOT_IN_POOL', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }
    const cost = estimateAttemptCost(primary)
    if (budget !== undefined && cost === undefined) {
      return { status: 'needs_decision', modelId: undefined, reason: 'COST_UNKNOWN', policyVersion: agent.version, estimatedCost: undefined, fallbackOf: undefined }
    }
    if (budget !== undefined && cost !== undefined && spent + cost > budget.perExecution) {
      return { status: 'needs_decision', modelId: undefined, reason: 'BUDGET_INSUFFICIENT', policyVersion: agent.version, estimatedCost: cost, fallbackOf: undefined }
    }
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
