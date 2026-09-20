/**
 * The agents domain declaration: model-pool, agent-catalog, selection, and
 * outcome record schemas plus the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-agents/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomAgentId, FaberLoomModelId } from './types.ts'

/** Model id at the durable boundary; branding has no runtime representation. */
const modelId = z.string().transform(value => value as FaberLoomModelId)
/** Agent id at the durable boundary. */
const agentId = z.string().transform(value => value as FaberLoomAgentId)

/** Durable escalation policy. */
const escalationRecord = z.object({
  authorized: z.array(modelId),
  conditions: z.array(z.string()),
  mode: z.union([z.literal('auto'), z.literal('manual')]),
})

/** Durable budget policy. */
const budgetRecord = z.object({
  perExecution: z.number(),
  currency: z.string(),
  maxAttempts: z.number(),
  maxEscalations: z.number(),
})

/** Durable model policy. */
const policyRecord = z.object({
  primary: modelId.nullable(),
  exclusive: z.boolean(),
  fallbacks: z.array(modelId),
  escalation: escalationRecord.nullable(),
  budget: budgetRecord.nullable(),
})

/** Durable shape of one model-pool entry. */
export const modelRecord = z.object({
  provider: z.string(),
  model: z.string(),
  capabilities: z.array(z.string()),
  contextWindow: z.number().nullable(),
  maxOutput: z.number().nullable(),
  inputPerMillion: z.number().nullable(),
  outputPerMillion: z.number().nullable(),
  currency: z.string().nullable(),
  available: z.boolean(),
  checkedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored model-pool entry, inferred from {@link modelRecord}. */
export type ModelRecord = z.infer<typeof modelRecord>

/** Durable shape of one agent-catalog entry. */
export const agentRecord = z.object({
  name: z.string(),
  responsibility: z.string(),
  spaceId: z.string().nullable(),
  origin: z.union([z.literal('scratch'), z.literal('pool'), z.literal('task')]),
  originRef: z.string().nullable(),
  baseAgentId: agentId.nullable(),
  skills: z.array(z.string()),
  tools: z.array(z.string()),
  subagents: z.array(z.object({ name: z.string(), agentId })),
  policy: policyRecord,
  lessons: z.array(z.string()),
  active: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored agent-catalog entry, inferred from {@link agentRecord}. */
export type AgentRecord = z.infer<typeof agentRecord>

/** Durable shape of one recorded selection. */
export const selectionRecord = z.object({
  agentId,
  task: z.string(),
  requestedModel: modelId.nullable(),
  effectiveModel: modelId.nullable(),
  reason: z.string(),
  cost: z.number().nullable(),
  at: z.string(),
})

/** One stored selection, inferred from {@link selectionRecord}. */
export type SelectionRecord = z.infer<typeof selectionRecord>

/** Durable shape of one recorded outcome. */
export const outcomeRecord = z.object({
  agentId,
  task: z.string(),
  modelId,
  outcome: z.union([z.literal('approved'), z.literal('corrected')]),
  cost: z.number().nullable(),
  at: z.string(),
})

/** One stored outcome, inferred from {@link outcomeRecord}. */
export type OutcomeRecord = z.infer<typeof outcomeRecord>

/**
 * The agents domain spec: models, agents, selections, and outcomes. The service
 * opens this through `ctx.storageDomain`.
 */
export const agentsDomainSpec = defineDomain({
  name: 'faberloom_agents',
  version: 1,
  tables: {
    models: domainTable<FaberLoomModelId, ModelRecord>(modelRecord),
    agents: domainTable<FaberLoomAgentId, AgentRecord>(agentRecord),
    selections: domainTable<string, SelectionRecord>(selectionRecord),
    outcomes: domainTable<string, OutcomeRecord>(outcomeRecord),
  },
})
