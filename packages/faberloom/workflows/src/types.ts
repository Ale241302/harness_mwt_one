/**
 * Public type vocabulary of the native product work flows: the branded ids, the
 * per-kind node configuration map, the discriminated node and edge unions, the
 * versioned definition and record, the scope, and the validation result. Types
 * only — the service and the compilation live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-workflows/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one work flow. */
export type WorkFlowId = Branded<'WorkFlowId'>

/** Identifies one node inside a work flow. */
export type WorkFlowNodeId = Branded<'WorkFlowNodeId'>

/** Identifies one edge inside a work flow. */
export type WorkFlowEdgeId = Branded<'WorkFlowEdgeId'>

/** Work flow lifecycle. */
export type WorkFlowStatus = 'draft' | 'active' | 'paused'

/** What happens to the run when a step fails. */
export type WorkFlowFailurePolicy = 'stop' | 'continue' | 'review'

/** Whether a work flow belongs to one Space or to the personal scope. */
export type WorkFlowScope =
  | { readonly kind: 'personal' }
  | { readonly kind: 'space'; readonly spaceId: string }

/**
 * Configuration carried by every node kind. A node's `config` is exactly the
 * entry its `kind` names, so the discriminated union stays exhaustive. Optional
 * fields carry an explicit `| undefined` so the zod-inferred durable record
 * stays assignable under `exactOptionalPropertyTypes`.
 */
export interface WorkFlowNodeConfigMap {
  /** Starts the flow by hand. */
  'trigger.manual': Record<string, never>
  /** Starts the flow on a recurrence or calendar cadence. */
  'trigger.schedule': {
    readonly recurrence: string
    /** IANA timezone the cadence is evaluated in; omitted means UTC. */
    readonly timezone?: string | undefined
    /** Allowed local weekdays (0 = Sunday … 6 = Saturday); omitted allows every day. */
    readonly days?: readonly number[] | undefined
    /** Allowed local hour window; omitted allows the whole day. */
    readonly window?: { readonly from: number; readonly to: number } | undefined
    /** When true, local Saturday and Sunday are skipped. */
    readonly businessDays?: boolean | undefined
  }
  /** Starts the flow for a new mailbox message. */
  'trigger.email': { readonly connectionId?: string | undefined; readonly mailbox?: string | undefined; readonly match?: string | undefined; readonly unseenOnly?: boolean | undefined }
  /** Starts the flow for a delivered event. */
  'trigger.event': { readonly sourceId?: string | undefined; readonly match?: string | undefined }
  /** Starts the flow when a board item reaches a status. */
  'trigger.board': { readonly itemId?: string | undefined; readonly status?: string | undefined }
  /** Runs one turn of a catalog agent. */
  'agent': { readonly agentId: string; readonly instruction: string; readonly useSpaceContext?: boolean | undefined }
  /** Invokes one skill in the turn. */
  'skill': { readonly skillName: string; readonly arguments?: string | undefined }
  /** Calls one MCP tool. */
  'mcp.call': { readonly server: string; readonly tool: string; readonly arguments?: Record<string, unknown> | undefined }
  /** Acts on the owner mailbox over IMAP. */
  'imap.action': { readonly connectionId?: string | undefined; readonly op: 'search' | 'read' | 'mark' | 'move' | 'delete' | 'flag'; readonly query?: string | undefined; readonly folder?: string | undefined }
  /** Sends a plain-text message over the owner SMTP connection. */
  'smtp.send': { readonly connectionId?: string | undefined; readonly to: readonly string[]; readonly subject: string; readonly template?: string | undefined }
  /** Attaches one memory entry to a Space. */
  'memory.remember': { readonly spaceId: string; readonly text: string }
  /** Records one versioned teaching. */
  'memory.teach': { readonly scope: 'case' | 'space' | 'agent' | 'skill' | 'global'; readonly text: string; readonly source: string; readonly active?: boolean | undefined }
  /** Creates one board item. */
  'board.create': { readonly title: string; readonly summary?: string | undefined; readonly evidence?: readonly string[] | undefined }
  /** Pulls another Space's context into the run. */
  'space.reference': { readonly spaceId: string }
  /** Invokes another routine. */
  'routine.invoke': { readonly routineId: string }
  /** Branches on an expression. */
  'condition': { readonly expression: string }
  /** Computes a value from an expression over prior results and the event. */
  'transform': { readonly expression: string }
  /** Parks the run for a time or an event. */
  'wait': { readonly seconds?: number | undefined; readonly waitFor?: string | undefined }
  /** Notifies the owner. */
  'notify': { readonly kind: 'email' | 'board'; readonly text?: string | undefined }
  /** Routes an exhausted failure to review. */
  'deadletter': { readonly destination?: string | undefined; readonly reason?: string | undefined }
}

/** Every node kind a work flow may declare. */
export type WorkFlowNodeKind = keyof WorkFlowNodeConfigMap

/** Fields shared by every node. */
export interface WorkFlowNodeBase {
  /** Stable node id within the work flow. */
  readonly id: WorkFlowNodeId
  /** Display title. */
  readonly title: string
  /** Canvas position. */
  readonly position: { readonly x: number; readonly y: number }
}

/** One node: shared fields plus the `kind`/`config` pair the kind selects. */
export type WorkFlowNode = WorkFlowNodeBase & {
  [K in WorkFlowNodeKind]: { readonly kind: K; readonly config: WorkFlowNodeConfigMap[K] }
}[WorkFlowNodeKind]

/** One directed edge between two nodes, with an optional branch condition. */
export interface WorkFlowEdge {
  /** Stable edge id. */
  readonly id: WorkFlowEdgeId
  /** Source node id. */
  readonly from: WorkFlowNodeId
  /** Target node id. */
  readonly to: WorkFlowNodeId
  /** Branch condition, or `undefined` for an unconditional edge. */
  readonly condition?: string | undefined
}

/** The stored content of one work flow version. */
export interface WorkFlowDefinition {
  /** What the flow is for. */
  readonly intent: string
  /** Declared nodes. */
  readonly nodes: readonly WorkFlowNode[]
  /** Declared edges. */
  readonly edges: readonly WorkFlowEdge[]
  /** Permissions the flow may use. */
  readonly permissions: readonly string[]
  /** What to do when a node fails. */
  readonly failurePolicy: WorkFlowFailurePolicy
  /**
   * Most executions of the compiled routine the dispatcher lets run or wait at
   * the same time, or `undefined` for no limit.
   */
  readonly maxConcurrency?: number | undefined
}

/** One versioned work flow as consumers read it. */
export interface WorkFlow {
  /** Stable work flow id. */
  readonly id: WorkFlowId
  /** Owning identity. */
  readonly ownerId: string
  /** Personal or Space scope. */
  readonly scope: WorkFlowScope
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: WorkFlowStatus
  /** Monotonic version; every accepted mutation increments it. */
  readonly version: number
  /** The current definition. */
  readonly definition: WorkFlowDefinition
  /** The compiled routine id, or `undefined` until the flow is activated. */
  readonly routineId: string | undefined
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/**
 * The stored content of one work flow record, as the domain persists it. The
 * arrays are read-only views over data the service treats as immutable;
 * `routineId` is `null` (not absent) so the stored value stays JSON-faithful.
 */
export interface WorkFlowRecord {
  /** Owning identity. */
  readonly ownerId: string
  /** Personal or Space scope. */
  readonly scope: WorkFlowScope
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: WorkFlowStatus
  /** Monotonic version. */
  readonly version: number
  /** The current definition. */
  readonly definition: WorkFlowDefinition
  /** Compiled routine id, or `null` until the flow is activated. */
  readonly routineId: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** One stored, immutable version of a work flow, keyed by `${id}:${version}`. */
export interface WorkFlowVersionRecord {
  /** Owning work flow id. */
  readonly workflowId: string
  /** Version number. */
  readonly version: number
  /** Display name at that version. */
  readonly name: string
  /** Scope at that version. */
  readonly scope: WorkFlowScope
  /** Graph at that version. */
  readonly definition: WorkFlowDefinition
  /** ISO-8601 instant that version was written. */
  readonly createdAt: string
}

/** One staged work flow revision as stored. */
export interface WorkFlowPendingRecord {
  /** Work flow the proposal targets. */
  readonly workflowId: string
  /** Owner who decides. */
  readonly ownerId: string
  /** Member who proposed the change. */
  readonly proposerId: string
  /** Proposed display name. */
  readonly name: string
  /** Proposed scope. */
  readonly scope: WorkFlowScope
  /** Proposed graph. */
  readonly definition: WorkFlowDefinition
  /** Version the proposal was based on. */
  readonly baseVersion: number
  /** ISO-8601 instant the proposal was staged. */
  readonly createdAt: string
}

/** One staged work flow revision awaiting the owner's accept or reject. */
export interface WorkFlowPendingChange {
  /** Work flow the proposal targets. */
  readonly workflowId: string
  /** Owner who decides. */
  readonly ownerId: string
  /** Member who proposed the change. */
  readonly proposerId: string
  /** Proposed display name. */
  readonly name: string
  /** Proposed scope. */
  readonly scope: WorkFlowScope
  /** Version the proposal was based on. */
  readonly baseVersion: number
  /** ISO-8601 instant the proposal was staged. */
  readonly createdAt: string
  /** The live graph the proposal is compared against. */
  readonly base: WorkFlowDefinition
  /** The proposed graph. */
  readonly proposed: WorkFlowDefinition
}

/** Input accepted when creating one work flow; the actor supplies ownership. */
export interface CreateWorkFlowInput {
  /** Display name. */
  readonly name: string
  /** Personal or Space scope; defaults to personal. */
  readonly scope?: WorkFlowScope | undefined
  /** The initial definition. */
  readonly definition: WorkFlowDefinition
}

/**
 * Input accepted when importing a Work Flow another identity shared. The
 * imported record keeps the remote id so the share grant authorizes it, and is
 * owned by the publisher so the member can never manage or delete it.
 */
export interface ImportSharedWorkFlowInput {
  /** Remote resource id; the imported record keeps it so grants resolve. */
  readonly id: string
  /** Email of the identity that owns the shared Work Flow. */
  readonly ownerId: string
  /** Display name. */
  readonly name: string
  /** Scope the owner published with the share, when any. */
  readonly scope?: WorkFlowScope | undefined
  /** Graph the owner published with the share. */
  readonly definition: WorkFlowDefinition
}

/** Mutable fields of a work flow. Absent fields stay unchanged. */
export interface UpdateWorkFlowInput {
  /** New display name. */
  readonly name?: string | undefined
  /** New scope. */
  readonly scope?: WorkFlowScope | undefined
  /** New definition, replaced wholesale. */
  readonly definition?: WorkFlowDefinition | undefined
}

/** The acting identity for one operation. */
export interface WorkFlowActor {
  /** The authenticated identity (user email). */
  readonly id: string
}

/** The structural verdict of one graph validation. */
export interface WorkFlowValidation {
  /** True when no problem was found. */
  readonly ok: boolean
  /** One stable, human-readable statement per problem, in check order. */
  readonly problems: readonly string[]
}
