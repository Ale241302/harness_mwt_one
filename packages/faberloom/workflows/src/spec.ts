/**
 * The work flows domain declaration: the zod schema for one versioned work flow
 * and the `defineDomain` spec the service opens. The schema validates the
 * shipped format at the durability boundary.
 * @module @deepseek-ai/dsh-faberloom-workflows/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkFlowEdgeId, WorkFlowId, WorkFlowNodeId, WorkFlowRecord } from './types.ts'

/** Branded ids have no runtime representation; the boundary only types them. */
const nodeId = z.string().transform(value => value as WorkFlowNodeId)
const edgeId = z.string().transform(value => value as WorkFlowEdgeId)

/** Canvas position of one node. */
const position = z.object({ x: z.number(), y: z.number() })

/** Stable fields every node carries. */
const nodeBase = { id: nodeId, title: z.string(), position }

/** The discriminated node union: one member per kind. */
const workFlowNode = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase, kind: z.literal('trigger.manual'), config: z.object({}) }),
  z.object({ ...nodeBase, kind: z.literal('trigger.schedule'), config: z.object({ recurrence: z.string(), timezone: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('trigger.email'), config: z.object({ connectionId: z.string().optional(), mailbox: z.string().optional(), match: z.string().optional(), unseenOnly: z.boolean().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('trigger.event'), config: z.object({ sourceId: z.string().optional(), match: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('trigger.board'), config: z.object({ itemId: z.string().optional(), status: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('agent'), config: z.object({ agentId: z.string(), instruction: z.string(), useSpaceContext: z.boolean().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('skill'), config: z.object({ skillName: z.string(), arguments: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('mcp.call'), config: z.object({ server: z.string(), tool: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('imap.action'), config: z.object({ connectionId: z.string().optional(), op: z.enum(['search', 'read', 'mark', 'move', 'delete', 'flag']), query: z.string().optional(), folder: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('smtp.send'), config: z.object({ connectionId: z.string().optional(), to: z.array(z.string()), subject: z.string(), template: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('memory.remember'), config: z.object({ spaceId: z.string(), text: z.string() }) }),
  z.object({ ...nodeBase, kind: z.literal('memory.teach'), config: z.object({ scope: z.enum(['case', 'space', 'agent', 'skill', 'global']), text: z.string(), source: z.string(), active: z.boolean().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('board.create'), config: z.object({ title: z.string(), summary: z.string().optional(), evidence: z.array(z.string()).optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('space.reference'), config: z.object({ spaceId: z.string() }) }),
  z.object({ ...nodeBase, kind: z.literal('routine.invoke'), config: z.object({ routineId: z.string() }) }),
  z.object({ ...nodeBase, kind: z.literal('condition'), config: z.object({ expression: z.string() }) }),
  z.object({ ...nodeBase, kind: z.literal('wait'), config: z.object({ seconds: z.number().optional(), waitFor: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('notify'), config: z.object({ kind: z.enum(['email', 'board']), text: z.string().optional() }) }),
  z.object({ ...nodeBase, kind: z.literal('deadletter'), config: z.object({ destination: z.string().optional(), reason: z.string().optional() }) }),
])

/** One directed edge. */
const workFlowEdge = z.object({
  id: edgeId,
  from: nodeId,
  to: nodeId,
  condition: z.string().optional(),
})

/** The stored content of one version. */
const workFlowDefinition = z.object({
  intent: z.string(),
  nodes: z.array(workFlowNode),
  edges: z.array(workFlowEdge),
  permissions: z.array(z.string()),
  failurePolicy: z.enum(['stop', 'continue', 'review']),
})

/** Personal or Space scope. */
const workFlowScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal') }),
  z.object({ kind: z.literal('space'), spaceId: z.string() }),
])

/**
 * Durable shape of one work flow record. `routineId` is `null` (not absent)
 * until the flow is activated so the stored value stays JSON-faithful;
 * timestamps are ISO-8601. Annotated with {@link WorkFlowRecord} so the
 * service reads read-only definition arrays.
 */
export const workFlowRecord: z.ZodType<WorkFlowRecord> = z.object({
  ownerId: z.string(),
  scope: workFlowScope,
  name: z.string(),
  status: z.enum(['draft', 'active', 'paused']),
  version: z.number(),
  definition: workFlowDefinition,
  routineId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * The work flows domain spec: one `workflows` table keyed by
 * {@link WorkFlowId}. The service opens this through `ctx.storageDomain`.
 */
export const workflowsDomainSpec = defineDomain({
  name: 'faberloom_workflows',
  version: 1,
  tables: {
    workflows: domainTable<WorkFlowId, WorkFlowRecord>(workFlowRecord),
  },
})
