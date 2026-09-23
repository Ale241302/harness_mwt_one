/**
 * Public type vocabulary of the native product agents: model-pool entries, the
 * versioned agent catalog, the versioned model policy, the shared resolver and
 * recommender results, execution selection records, and outcome evidence.
 * Types only — the id factories and the service live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-agents/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one model-pool entry. */
export type FaberLoomModelId = Branded<'FaberLoomModelId'>

/** Identifies one agent-catalog entry. */
export type FaberLoomAgentId = Branded<'FaberLoomAgentId'>

/** One accessible model with its verified capabilities, limits, and rates. */
export interface FaberLoomModel {
  /** Stable pool id. */
  readonly id: FaberLoomModelId
  /** Provider name (e.g. `deepseek`). */
  readonly provider: string
  /** Provider model id (e.g. `deepseek-chat`). */
  readonly model: string
  /** Verified capability tags (e.g. `text`, `vision`, `tools`). */
  readonly capabilities: readonly string[]
  /** Context window in tokens, when known. */
  readonly contextWindow: number | undefined
  /** Maximum output tokens, when known. */
  readonly maxOutput: number | undefined
  /** Input price per million tokens, when known. */
  readonly inputPerMillion: number | undefined
  /** Output price per million tokens, when known. */
  readonly outputPerMillion: number | undefined
  /** Currency of the rates, when known. */
  readonly currency: string | undefined
  /** Whether the provider is currently reachable. */
  readonly available: boolean
  /** ISO-8601 instant the facts were last checked. */
  readonly checkedAt: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Model-pool input; the pool assigns the id and timestamps. */
export interface ModelInput {
  /** Provider name. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
  /** Capability tags; empty means text-only, unverified. */
  readonly capabilities?: readonly string[]
  /** Context window in tokens. */
  readonly contextWindow?: number
  /** Maximum output tokens. */
  readonly maxOutput?: number
  /** Input price per million tokens. */
  readonly inputPerMillion?: number
  /** Output price per million tokens. */
  readonly outputPerMillion?: number
  /** Currency of the rates. */
  readonly currency?: string
  /** Whether the provider is currently reachable. */
  readonly available?: boolean
}

/** How a missing or failing primary model may be substituted. */
export interface EscalationPolicy {
  /** Models the user explicitly authorized for escalation, ordered. */
  readonly authorized: readonly FaberLoomModelId[]
  /** Conditions that justify escalating (matched against a requested condition). */
  readonly conditions: readonly string[]
  /** `auto` proceeds within the limits; `manual` asks the human first. */
  readonly mode: 'auto' | 'manual'
}

/** Per-execution budget and attempt limits shared with subagents. */
export interface BudgetPolicy {
  /** Maximum estimated cost for the whole execution. */
  readonly perExecution: number
  /** Currency of the budget. */
  readonly currency: string
  /** Maximum provider attempts, including fallbacks. */
  readonly maxAttempts: number
  /** Maximum escalations within the execution. */
  readonly maxEscalations: number
}

/** Versioned model policy of one agent. */
export interface ModelPolicy {
  /** Normal model used by the agent. */
  readonly primary: FaberLoomModelId | undefined
  /** When true, no skill or routine may substitute another model. */
  readonly exclusive: boolean
  /** Ordered fallbacks used when the provider is unavailable. */
  readonly fallbacks: readonly FaberLoomModelId[]
  /** Authorized difficulty escalation, when configured. */
  readonly escalation: EscalationPolicy | undefined
  /** Shared execution budget, when configured. */
  readonly budget: BudgetPolicy | undefined
}

/** Policy patch; absent fields keep the current value. */
export interface PolicyPatch {
  /** New primary model, or `null` to clear it. */
  readonly primary?: FaberLoomModelId | null
  /** New exclusivity switch. */
  readonly exclusive?: boolean
  /** New ordered fallbacks. */
  readonly fallbacks?: readonly FaberLoomModelId[]
  /** New escalation policy, or `null` to clear it. */
  readonly escalation?: EscalationPolicy | null
  /** New budget policy, or `null` to clear it. */
  readonly budget?: BudgetPolicy | null
}

/** One versioned agent of the catalog. */
export interface FaberLoomAgent {
  /** Stable agent id. */
  readonly id: FaberLoomAgentId
  /** Display name. */
  readonly name: string
  /** Responsibility statement. */
  readonly responsibility: string
  /** Optional owning space id. */
  readonly spaceId: string | undefined
  /** Creation route. */
  readonly origin: 'scratch' | 'pool' | 'task'
  /** Origin reference (template id, task id) when applicable. */
  readonly originRef: string | undefined
  /** Base agent this one specializes, when copied. */
  readonly baseAgentId: FaberLoomAgentId | undefined
  /** Skill names declared by the agent. */
  readonly skills: readonly string[]
  /** Tool names the agent may execute. */
  readonly tools: readonly string[]
  /** Named persistent subagents available to this agent. */
  readonly subagents: readonly { readonly name: string; readonly agentId: FaberLoomAgentId }[]
  /** Versioned model policy. */
  readonly policy: ModelPolicy
  /** Portable teachings selected when copying; never confidence. */
  readonly lessons: readonly string[]
  /** Whether the agent is active in the catalog. */
  readonly active: boolean
  /** Monotonic revision; every accepted mutation increments it. */
  readonly version: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Agent creation input; the catalog assigns the id, version, and timestamps. */
export interface AgentInput {
  /** Display name. */
  readonly name: string
  /** Responsibility statement. */
  readonly responsibility: string
  /** Creation route; defaults to `scratch`. */
  readonly origin?: 'scratch' | 'pool' | 'task'
  /** Origin reference for the route. */
  readonly originRef?: string
  /** Optional owning space id. */
  readonly spaceId?: string
  /** Skill names. */
  readonly skills?: readonly string[]
  /** Tool names the agent may execute. */
  readonly tools?: readonly string[]
  /** Initial model policy. */
  readonly policy?: PolicyPatch
}

/** Agent patch; absent fields keep the current value. */
export interface AgentPatch {
  /** New display name. */
  readonly name?: string
  /** New responsibility. */
  readonly responsibility?: string
  /** New owning space id, or `null` to clear the assignment. */
  readonly spaceId?: string | null
  /** New skill list. */
  readonly skills?: readonly string[]
  /** New tool list. */
  readonly tools?: readonly string[]
  /** New named subagents. */
  readonly subagents?: readonly { readonly name: string; readonly agentId: FaberLoomAgentId }[]
  /** New portable teachings. */
  readonly lessons?: readonly string[]
  /** Policy patch. */
  readonly policy?: PolicyPatch
}

/** Copy input for duplicating an agent. */
export interface DuplicateInput {
  /** Name for the copy. */
  readonly name: string
  /** Optional new owning space. */
  readonly spaceId?: string
  /** Portable teachings to copy into the duplicate (explicit selection). */
  readonly lessons?: readonly string[]
}

/** One attempt to resolve the effective model for a task. */
export interface ResolveRequest {
  /** Task label. */
  readonly task: string
  /** Whether the primary provider is currently unavailable. */
  readonly providerDown?: boolean
  /** A met escalation condition, when one applies. */
  readonly condition?: string
  /** Estimated cost already spent in this execution. */
  readonly spent?: number
  /** Provider attempts already made in this execution. */
  readonly attempted?: number
  /** Escalations already used in this execution. */
  readonly escalated?: number
}

/** Resolver outcome. */
export type ResolveStatus = 'selected' | 'denied' | 'needs_approval' | 'needs_decision'

/** Resolver result: the effective model or the reason to stop. */
export interface ResolveResult {
  /** Outcome status. */
  readonly status: ResolveStatus
  /** Effective model when `selected`. */
  readonly modelId: FaberLoomModelId | undefined
  /** Stable reason code. */
  readonly reason: string
  /** Agent policy version the decision used. */
  readonly policyVersion: number
  /** Estimated cost of the selected attempt, when known. */
  readonly estimatedCost: number | undefined
  /** Primary model this selection replaces, when substituted. */
  readonly fallbackOf: FaberLoomModelId | undefined
}

/** Recommender request derived from responsibility, skills, and constraints. */
export interface RecommendRequest {
  /** Required capability tags. */
  readonly capabilities?: readonly string[]
  /** Minimum context window required. */
  readonly minContextWindow?: number
  /** Task label used to weight evidence. */
  readonly task?: string
}

/** One ranked recommendation candidate. */
export interface RecommendCandidate {
  /** Candidate model. */
  readonly modelId: FaberLoomModelId
  /** Estimated cost for one useful result, when computable. */
  readonly costPerUsefulResult: number | undefined
  /** Evidence uses behind the estimate. */
  readonly uses: number
  /** True when the model has no evidence for this task yet. */
  readonly provisional: boolean
  /** Why this candidate is suggested or limited. */
  readonly reasons: readonly string[]
}

/** Recommender result. */
export interface RecommendResult {
  /** Best candidate, when one is admissible. */
  readonly recommended: FaberLoomModelId | undefined
  /** Ordered alternatives. */
  readonly alternatives: readonly RecommendCandidate[]
  /** Uncertainty statements (missing rates, no evidence). */
  readonly uncertainty: readonly string[]
}

/** One recorded model selection for an execution step. */
export interface Selection {
  /** Stable record id. */
  readonly id: string
  /** Agent that acted. */
  readonly agentId: FaberLoomAgentId
  /** Task label. */
  readonly task: string
  /** Task label requested. */
  readonly requestedModel: FaberLoomModelId | undefined
  /** Model actually used. */
  readonly effectiveModel: FaberLoomModelId | undefined
  /** Stable reason code for the selection or change. */
  readonly reason: string
  /** Estimated cost when known. */
  readonly cost: number | undefined
  /** ISO-8601 instant. */
  readonly at: string
}

/** Input for recording one selection; the service assigns id and instant. */
export interface SelectionInput {
  /** Agent that acted. */
  readonly agentId: FaberLoomAgentId
  /** Task label. */
  readonly task: string
  /** Model requested by the caller. */
  readonly requestedModel?: FaberLoomModelId
  /** Model actually used. */
  readonly effectiveModel?: FaberLoomModelId
  /** Stable reason code. */
  readonly reason: string
  /** Estimated cost when known. */
  readonly cost?: number
}

/** Input for recording one human outcome; the service assigns id and instant. */
export interface OutcomeInput {
  /** Agent that produced the result. */
  readonly agentId: FaberLoomAgentId
  /** Task label. */
  readonly task: string
  /** Model that produced the result. */
  readonly modelId: FaberLoomModelId
  /** Whether the result was approved unchanged or corrected. */
  readonly outcome: 'approved' | 'corrected'
  /** Real cost of the attempt, when known. */
  readonly cost?: number
}

/** One human outcome recorded for an agent/model/task. */
export interface Outcome {
  /** Stable record id. */
  readonly id: string
  /** Agent that produced the result. */
  readonly agentId: FaberLoomAgentId
  /** Task label. */
  readonly task: string
  /** Model that produced the result. */
  readonly modelId: FaberLoomModelId
  /** Whether the result was approved unchanged or corrected. */
  readonly outcome: 'approved' | 'corrected'
  /** Real cost of the attempt, when known. */
  readonly cost: number | undefined
  /** ISO-8601 instant. */
  readonly at: string
}

/** Aggregated contextual performance. */
export interface EvidenceSummary {
  /** Total recorded outcomes. */
  readonly uses: number
  /** Approved outcomes. */
  readonly approved: number
  /** Corrected outcomes. */
  readonly corrected: number
  /** Corrected / uses, or `undefined` with no uses. */
  readonly correctionRate: number | undefined
  /** Total known cost / approved, or `undefined` without cost or approvals. */
  readonly costPerUsefulResult: number | undefined
}

/** One grouped spend bucket of the per-user cost summary. */
export interface CostBucket {
  /** Group key: model id, agent id, or task label per the grouping dimension. */
  readonly key: string
  /** Grouping dimension of this bucket. */
  readonly by: 'model' | 'agent' | 'task'
  /** Known spend accumulated in this bucket. */
  readonly cost: number
  /** Selection records that contributed to this bucket. */
  readonly records: number
  /** True when some contributing record carried no cost. */
  readonly partial: boolean
}

/** Per-user spend summary derived from recorded selections. */
export interface CostSummary {
  /** Shared currency of the amounts, or undefined when mixed or unknown. */
  readonly currency: string | undefined
  /** Known spend over every selection considered. */
  readonly total: number
  /** Selection records considered. */
  readonly records: number
  /** True when at least one considered record carried no cost. */
  readonly partial: boolean
  /** ISO-8601 instant of the oldest considered selection. */
  readonly since: string | undefined
  /** ISO-8601 instant the summary was computed. */
  readonly at: string
  /** Spend grouped by effective model. */
  readonly byModel: readonly CostBucket[]
  /** Spend grouped by agent. */
  readonly byAgent: readonly CostBucket[]
  /** Spend grouped by task. */
  readonly byTask: readonly CostBucket[]
}

/** One-shot temporary subagent request; nothing is persisted in the catalog. */
export interface RunTemporarySubagentRequest {
  /** Subagent name used only for this run. */
  readonly name: string
  /** Responsibility statement for this run. */
  readonly responsibility: string
  /** Model the temporary subagent uses. */
  readonly primary: FaberLoomModelId
  /** Tool names the temporary subagent may use; must be a subset of the parent's. */
  readonly tools?: readonly string[]
  /** Task label. */
  readonly task: string
  /** Executable tool to run, when the run performs an action. */
  readonly tool?: string
  /** Arguments for the executed tool. */
  readonly args?: unknown
  /** Estimated cost already spent by the parent execution. */
  readonly spent?: number
}

/** Result of one temporary subagent run. */
export interface TemporarySubagentResult {
  /** Resolver outcome for the temporary subagent. */
  readonly status: ResolveStatus
  /** Effective model when selected. */
  readonly modelId: FaberLoomModelId | undefined
  /** Reason code. */
  readonly reason: string
  /** Estimated cost of the run, when known. */
  readonly cost: number | undefined
  /** Remaining parent budget after the run, when a budget exists. */
  readonly remainingBudget: number | undefined
  /** Tool result, when a tool ran. */
  readonly result?: unknown
}

/** Subagent delegation request sharing the parent execution budget. */
export interface DelegateRequest {
  /** Named subagent on the parent agent. */
  readonly subagent: string
  /** Task label. */
  readonly task: string
  /** Estimated cost already spent by the whole execution. */
  readonly spent?: number
  /** A met escalation condition, when one applies. */
  readonly condition?: string
}

/** Subagent delegation result. */
export interface DelegateResult {
  /** Resolver outcome for the subagent. */
  readonly status: ResolveStatus
  /** Effective subagent model when selected. */
  readonly modelId: FaberLoomModelId | undefined
  /** Reason code. */
  readonly reason: string
  /** Estimated cost of the delegated attempt, when known. */
  readonly cost: number | undefined
  /** Remaining parent budget after this delegation, when a budget exists. */
  readonly remainingBudget: number | undefined
}
