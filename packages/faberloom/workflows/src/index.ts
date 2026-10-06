/**
 * Native product work flows (`ctx.faberloomWorkflows`): versioned graphs of
 * triggers and actions, scoped to a Space or the personal scope, with durable
 * records through the storage domain, graph validation, and compilation to a
 * routine definition. Reads are synchronous from memory; writes resolve after
 * durability.
 * @module @deepseek-ai/dsh-faberloom-workflows
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { workflowsDomainSpec } from './spec.ts'
import { getTemplate, WORKFLOW_TEMPLATES, type WorkFlowTemplate } from './templates.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { RoutineDefinitionInput, RoutineStepInput, RoutineTriggerInput, FaberLoomRoutineId, Execution } from '@deepseek-ai/dsh-faberloom-routines'
// Type-only: pulls the shares service's Context merge and the permission union.
import type { FaberLoomSharePermission } from '@deepseek-ai/dsh-faberloom-shares'
import type {
  CreateWorkFlowInput,
  ImportSharedWorkFlowInput,
  UpdateWorkFlowInput,
  WorkFlow,
  WorkFlowActor,
  WorkFlowDefinition,
  WorkFlowEdge,
  WorkFlowEdgeId,
  WorkFlowId,
  WorkFlowNode,
  WorkFlowNodeId,
  WorkFlowNodeKind,
  WorkFlowRecord,
  WorkFlowVersionRecord,
  WorkFlowPendingChange,
  WorkFlowPendingRecord,
  WorkFlowScope,
  WorkFlowStatus,
  WorkFlowValidation,
} from './types.ts'

export type * from './types.ts'
export * from './templates.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomWorkflows: FaberLoomWorkflows
  }
}

/** Map one durable record to the consumer-facing work flow. */
function toWorkFlow(id: WorkFlowId, record: WorkFlowRecord): WorkFlow {
  return {
    id,
    ownerId: record.ownerId,
    scope: record.scope,
    name: record.name,
    status: record.status,
    version: record.version,
    definition: record.definition,
    routineId: record.routineId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Node kinds that start a run rather than execute a step. */
const TRIGGER_KINDS = new Set(['trigger.manual', 'trigger.schedule', 'trigger.email', 'trigger.event', 'trigger.board'])

/** A node that starts a run. */
type TriggerNode = Extract<WorkFlowNode, { kind: 'trigger.manual' | 'trigger.schedule' | 'trigger.email' | 'trigger.event' | 'trigger.board' }>

/** A node that executes a step. */
type ActionNode = Exclude<WorkFlowNode, TriggerNode>

/** The step handler each action kind compiles to. */
const HANDLER_BY_KIND: Record<ActionNode['kind'], string> = {
  'agent': 'agent',
  'skill': 'agent',
  'mcp.call': 'mcp.call',
  'imap.action': 'imap',
  'smtp.send': 'smtp',
  'memory.remember': 'memory.remember',
  'memory.teach': 'memory.teach',
  'board.create': 'board.create',
  'space.reference': 'reference',
  'routine.invoke': 'subroutine',
  'condition': 'condition',
  'transform': 'transform',
  'wait': 'delay',
  'notify': 'notify',
  'deadletter': 'deadletter',
}

/** Action kinds that perform a real external effect. */
const EFFECT_KINDS = new Set<string>(['mcp.call', 'imap.action', 'smtp.send', 'board.create'])

/** Whether one node starts a run. */
function isTriggerNode(node: WorkFlowNode): node is TriggerNode {
  return TRIGGER_KINDS.has(node.kind)
}

/** Compile one trigger node to a routine trigger input. */
function triggerFor(node: TriggerNode): RoutineTriggerInput {
  switch (node.kind) {
    case 'trigger.manual': return { kind: 'manual' }
    case 'trigger.schedule': return {
      kind: 'recurrence',
      match: node.config.recurrence,
      ...node.config.timezone === undefined ? {} : { timezone: node.config.timezone },
      ...node.config.days === undefined ? {} : { days: node.config.days },
      ...node.config.window === undefined ? {} : { window: node.config.window },
      ...node.config.businessDays === undefined ? {} : { businessDays: node.config.businessDays },
    }
    case 'trigger.email': return node.config.match === undefined ? { kind: 'email' } : { kind: 'email', match: node.config.match }
    case 'trigger.event': return node.config.match === undefined ? { kind: 'event' } : { kind: 'event', match: node.config.match }
    case 'trigger.board': return { kind: 'event', match: `${node.config.itemId ?? ''}@${node.config.status ?? ''}` }
  }
}

/** Compile one action node to a routine step input. */
function stepFor(
  node: ActionNode,
  edges: readonly WorkFlowEdge[],
  triggerIds: ReadonlySet<WorkFlowNodeId>,
  nodeById: ReadonlyMap<string, WorkFlowNode>,
): RoutineStepInput {
  const dependsOn = edges.filter(edge => edge.to === node.id && !triggerIds.has(edge.from)).map(edge => edge.from)
  const gate = gateFor(node, edges, nodeById)
  const step: RoutineStepInput = {
    id: node.id,
    instruction: node.title,
    handler: HANDLER_BY_KIND[node.kind],
    dependsOn,
    config: node.config,
    ...gate === undefined ? {} : { gate },
    effect: EFFECT_KINDS.has(node.kind),
  }
  if (node.kind !== 'wait') return step
  const waitFor = node.config.waitFor ?? (node.config.seconds === undefined ? undefined : `@delay:${String(node.config.seconds)}`)
  return waitFor === undefined ? step : { ...step, waitFor }
}

/**
 * Derive a step's gate from an incoming edge whose source is a condition node
 * and whose branch condition names `== true` or `== false`.
 * @param node - the target action node.
 * @param edges - every declared edge.
 * @param nodeById - every declared node by id, to read the source kind.
 * @returns the gate, or undefined when no condition edge gates this step.
 */
function gateFor(
  node: ActionNode,
  edges: readonly WorkFlowEdge[],
  nodeById: ReadonlyMap<string, WorkFlowNode>,
): { readonly stepId: string; readonly expect: boolean } | undefined {
  for (const edge of edges) {
    if (edge.to !== node.id || edge.condition === undefined) continue
    const source = nodeById.get(edge.from)
    if (source === undefined || source.kind !== 'condition') continue
    const match = /==\s*(true|false)\s*$/i.exec(edge.condition)
    if (match === null) continue
    return { stepId: edge.from, expect: match[1]?.toLowerCase() === 'true' }
  }
  return undefined
}

/** Whether a graph has a directed cycle, via a topological count. */
function hasCycle(nodes: readonly WorkFlowNode[], edges: readonly WorkFlowEdge[]): boolean {
  const indegree = new Map<WorkFlowNodeId, number>(nodes.map(node => [node.id, 0]))
  const outgoing = new Map<WorkFlowNodeId, WorkFlowNodeId[]>(nodes.map(node => [node.id, []]))
  for (const edge of edges) {
    const targets = outgoing.get(edge.from)
    const current = indegree.get(edge.to)
    if (targets === undefined || current === undefined) continue
    targets.push(edge.to)
    indegree.set(edge.to, current + 1)
  }
  const queue = nodes.map(node => node.id).filter(id => indegree.get(id) === 0)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift() as WorkFlowNodeId
    visited += 1
    for (const next of outgoing.get(id) as WorkFlowNodeId[]) {
      const remaining = (indegree.get(next) as number) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  return visited !== nodes.length
}

/** The set of nodes reachable from any root node over the edges. */
function reachableNodes(
  nodes: readonly WorkFlowNode[],
  edges: readonly WorkFlowEdge[],
  roots: readonly WorkFlowNodeId[],
): Set<WorkFlowNodeId> {
  const outgoing = new Map<WorkFlowNodeId, WorkFlowNodeId[]>(nodes.map(node => [node.id, []]))
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to)
  const seen = new Set<WorkFlowNodeId>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.shift() as WorkFlowNodeId
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of outgoing.get(id) ?? []) queue.push(next)
  }
  return seen
}

/**
 * Validate one graph: unique ids, edges that reference existing nodes, at least
 * one trigger, no cycle, and every node reachable from a trigger.
 * @param definition - the graph to validate.
 * @returns the verdict and one statement per problem, in check order.
 */
export function validateWorkFlow(definition: WorkFlowDefinition): WorkFlowValidation {
  const problems: string[] = []
  const nodeIds = new Set<WorkFlowNodeId>()
  for (const node of definition.nodes) {
    if (nodeIds.has(node.id)) problems.push(`duplicate node id: ${node.id}`)
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id: ${edge.id}`)
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.from)) problems.push(`edge ${edge.id} references missing node: ${edge.from}`)
    if (!nodeIds.has(edge.to)) problems.push(`edge ${edge.id} references missing node: ${edge.to}`)
  }
  const triggers = definition.nodes.filter(isTriggerNode)
  if (triggers.length === 0) problems.push('graph has no trigger node')
  if (hasCycle(definition.nodes, definition.edges)) problems.push('graph has a cycle')
  const reachable = reachableNodes(definition.nodes, definition.edges, triggers.map(trigger => trigger.id))
  for (const node of definition.nodes) {
    if (!reachable.has(node.id)) problems.push(`unreachable node: ${node.id}`)
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Compile one work flow to a routine definition: trigger nodes become routine
 * triggers, action nodes become steps, and edges become step dependencies.
 * @param workflow - the work flow to compile.
 * @returns the routine definition input.
 */
export function compileWorkFlow(workflow: WorkFlow): RoutineDefinitionInput {
  const { definition } = workflow
  const triggers = definition.nodes.filter(isTriggerNode).map(triggerFor)
  const triggerIds = new Set(definition.nodes.filter(isTriggerNode).map(node => node.id))
  const nodeById = new Map<string, WorkFlowNode>(definition.nodes.map(node => [node.id, node]))
  const steps = definition.nodes
    .filter((node): node is ActionNode => !isTriggerNode(node))
    .map(node => stepFor(node, definition.edges, triggerIds, nodeById))
  return {
    intent: definition.intent,
    triggers,
    steps,
    expectedResult: definition.intent,
    permissions: [...definition.permissions],
    failurePolicy: definition.failurePolicy,
    ...definition.maxConcurrency === undefined ? {} : { maxConcurrency: definition.maxConcurrency },
  }
}

/** The `format` field every portable Work Flow JSON carries. */
export const WORKFLOW_EXPORT_FORMAT = 'faberloom-workflow'

/** The portable JSON version this build writes. */
export const WORKFLOW_EXPORT_VERSION = 1

/** The parsed content of a portable Work Flow JSON. */
export interface ParsedWorkFlow {
  /** Display name the export carried. */
  readonly name: string
  /** The graph to store. */
  readonly definition: WorkFlowDefinition
}

/**
 * Serialize one work flow as portable JSON: the same shape the gallery and the
 * knowledge hub store, independent of the owner and the compiled routine.
 * @param flow - the work flow to serialize.
 * @returns the JSON text.
 */
export function serializeWorkFlow(flow: WorkFlow): string {
  return JSON.stringify({
    format: WORKFLOW_EXPORT_FORMAT,
    version: WORKFLOW_EXPORT_VERSION,
    name: flow.name,
    definition: flow.definition,
  }, null, 2)
}

/**
 * Parse portable Work Flow JSON and validate its graph.
 * @param json - the JSON text.
 * @returns the name and the validated graph.
 * @throws when the JSON is malformed, is not a Work Flow export, or its graph is invalid.
 */
export function parseWorkFlow(json: string): ParsedWorkFlow {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('faberloom: el JSON exportado no es válido')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('faberloom: el JSON exportado debe ser un objeto')
  }
  const value = parsed as Record<string, unknown>
  if (value['format'] !== WORKFLOW_EXPORT_FORMAT) {
    throw new Error(`faberloom: el JSON exportado debe llevar format "${WORKFLOW_EXPORT_FORMAT}"`)
  }
  const definition = value['definition']
  if (definition === null || typeof definition !== 'object') throw new Error('faberloom: el JSON exportado no lleva definition')
  const candidate = definition as WorkFlowDefinition
  const verdict = validateWorkFlow(candidate)
  if (!verdict.ok) throw new Error(`faberloom: el grafo importado no es válido: ${verdict.problems.join('; ')}`)
  const name = typeof value['name'] === 'string' && value['name'].length > 0 ? value['name'] : 'Flujo importado'
  return { name, definition: candidate }
}

/** Whether two scopes name the same target. */
function sameScope(left: WorkFlowScope, right: WorkFlowScope): boolean {
  if (left.kind === 'personal' || right.kind === 'personal') return left.kind === right.kind
  return left.spaceId === right.spaceId
}

/**
 * The work flows service. It owns the durable versioned graph records, the
 * graph validation, and the compilation to a routine; every operation carries
 * the authenticated actor.
 */
export class FaberLoomWorkflows extends Service {
  static inject = ['storageDomain', 'faberloomRoutines']

  private domainPromise: Promise<Domain<typeof workflowsDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomWorkflows')
    this.ctx.effect(() => () => this.closeDomain(), 'faberloom.workflowsDomainClose')
  }

  /** Close the lazily opened domain, if any, when the service fiber unloads. */
  private async closeDomain(): Promise<void> {
    if (this.domainPromise === undefined) return
    await (await this.domainPromise).close()
  }

  /** Open the work flows domain once and keep its handle. */
  private domain(): Promise<Domain<typeof workflowsDomainSpec>> {
    this.domainPromise ??= this.ctx.storageDomain.open(workflowsDomainSpec)
    return this.domainPromise
  }

  /** The workflows table handle. */
  private async table(): Promise<KvTable<WorkFlowId, WorkFlowRecord>> {
    return (await this.domain()).table('workflows')
  }

  /** The append-only work flow versions table handle, keyed by `${id}:${version}`. */
  private async versionsTable(): Promise<KvTable<string, WorkFlowVersionRecord>> {
    return (await this.domain()).table('versions')
  }

  /** The staged-revision table handle, one row per work flow. */
  private async pendingTable(): Promise<KvTable<WorkFlowId, WorkFlowPendingRecord>> {
    return (await this.domain()).table('pending')
  }

  /** Stage one member's proposed name, scope, and graph for the owner to decide. */
  private async stage(
    actor: WorkFlowActor,
    id: WorkFlowId,
    record: WorkFlowRecord,
    proposal: { name: string; scope: WorkFlowScope; definition: WorkFlowDefinition },
  ): Promise<void> {
    const pending: WorkFlowPendingRecord = {
      workflowId: id,
      ownerId: record.ownerId,
      proposerId: actor.id,
      name: proposal.name,
      scope: proposal.scope,
      definition: proposal.definition,
      baseVersion: record.version,
      createdAt: new Date().toISOString(),
    }
    await (await this.pendingTable()).put(id, pending)
  }

  /** Append one immutable version row for a flow record. */
  private async recordVersion(id: WorkFlowId, record: WorkFlowRecord): Promise<void> {
    await (await this.versionsTable()).put(`${id}:${String(record.version)}`, {
      workflowId: id,
      version: record.version,
      name: record.name,
      scope: record.scope,
      definition: record.definition,
      createdAt: record.updatedAt,
    })
  }

  /** Read one record and require the actor to own it. */
  private async requireOwned(
    actor: WorkFlowActor,
    id: WorkFlowId,
  ): Promise<{ table: KvTable<WorkFlowId, WorkFlowRecord>; record: WorkFlowRecord }> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: work flow ${id} not found`)
    if (record.ownerId !== actor.id) throw new Error('faberloom: work flow access denied')
    return { table, record }
  }

  /**
   * Read a record the actor owns, or one an active share grant authorizes for
   * the named permission.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param permission - the action being authorized.
   * @returns the table handle and the record.
   * @throws when the flow is absent or the actor has neither ownership nor the grant.
   */
  private async requireAccess(
    actor: WorkFlowActor,
    id: WorkFlowId,
    permission: FaberLoomSharePermission,
  ): Promise<{ table: KvTable<WorkFlowId, WorkFlowRecord>; record: WorkFlowRecord }> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: work flow ${id} not found`)
    if (record.ownerId === actor.id) return { table, record }
    const shares = this.ctx.get('faberloomShares')
    if (shares === undefined || !await shares.can(actor.id, record.ownerId, { kind: 'workflow', id }, permission)) {
      throw new Error('faberloom: work flow access denied')
    }
    return { table, record }
  }

  /**
   * Compile the record and reconcile it with the routines engine: create and
   * activate the compiled routine the first time, or version it and migrate its
   * waiting executions on a later edit. Returns the routine id to store.
   */
  private async syncRoutine(id: WorkFlowId, record: WorkFlowRecord): Promise<string> {
    const routines = this.ctx.faberloomRoutines
    const definition = compileWorkFlow(toWorkFlow(id, record))
    if (record.routineId === null) {
      const created = await routines.createRoutine(record.ownerId, { name: record.name, definition })
      await routines.activateRoutine(record.ownerId, created.id)
      return created.id
    }
    const routineId = brandString<FaberLoomRoutineId>(record.routineId)
    const updated = await routines.updateRoutine(record.ownerId, routineId, { name: record.name, definition })
    await routines.activateRoutine(record.ownerId, routineId)
    for (const execution of await routines.listExecutions({ routineId, status: 'waiting' })) {
      await routines.previewMigration(execution.id, updated.version)
      await routines.migrate(execution.id, updated.version)
    }
    return record.routineId
  }

  /**
   * Create one work flow owned by the actor. The definition is stored as given;
   * validation is explicit and activation requires a valid graph.
   * @param actor - the acting identity.
   * @param input - name, optional scope, and the initial definition.
   * @returns the created work flow.
   */
  async create(actor: WorkFlowActor, input: CreateWorkFlowInput): Promise<WorkFlow> {
    const table = await this.table()
    const now = new Date().toISOString()
    const id = brandString<WorkFlowId>(randomUUID())
    const record: WorkFlowRecord = {
      ownerId: actor.id,
      scope: input.scope ?? { kind: 'personal' },
      name: input.name,
      status: 'draft',
      version: 1,
      definition: input.definition,
      routineId: null,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(id, record)
    await this.recordVersion(id, record)
    return toWorkFlow(id, record)
  }

  /**
   * Materialize a Work Flow another identity shared, under the remote id so the
   * imported record resolves the same grants. Idempotent: an existing record is
   * returned untouched, so a repeated sync never clobbers the member's state.
   * The record is owned by the publisher and stays `draft`; no routine is
   * created here, so a shared flow is readable and editable per grant but does
   * not start executing on the member's host.
   * @param input - remote id, publisher email, name, scope, and shared definition.
   * @returns the imported (or already present) work flow.
   */
  async importShared(input: ImportSharedWorkFlowInput): Promise<WorkFlow> {
    const table = await this.table()
    const id = brandString<WorkFlowId>(input.id)
    const existing = table.get(id)
    if (existing !== undefined) return toWorkFlow(id, existing)
    const now = new Date().toISOString()
    const record: WorkFlowRecord = {
      ownerId: input.ownerId,
      scope: input.scope ?? { kind: 'personal' },
      name: input.name,
      status: 'draft',
      version: 1,
      definition: input.definition,
      routineId: null,
      createdAt: now,
      updatedAt: now,
    }
    await table.put(id, record)
    await this.recordVersion(id, record)
    return toWorkFlow(id, record)
  }

  /**
   * List the actor's work flows, optionally only one scope, oldest first.
   * @param actor - the acting identity.
   * @param scope - when set, only flows in this scope.
   * @returns the actor's work flows.
   */
  async list(actor: WorkFlowActor, scope?: WorkFlowScope): Promise<WorkFlow[]> {
    const shares = this.ctx.get('faberloomShares')
    const out: WorkFlow[] = []
    for (const [id, record] of (await this.table()).entries()) {
      if (record.ownerId !== actor.id) {
        if (shares === undefined) continue
        if (!await shares.can(actor.id, record.ownerId, { kind: 'workflow', id }, 'view')) continue
      }
      if (scope !== undefined && !sameScope(record.scope, scope)) continue
      out.push(toWorkFlow(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Read one work flow the actor owns.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the work flow.
   * @throws when the flow is absent or owned by another identity.
   */
  async get(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow> {
    const { record } = await this.requireAccess(actor, id, 'view')
    return toWorkFlow(id, record)
  }

  /**
   * Apply a mutable patch to one work flow the actor owns, bumping the version.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param patch - fields to change.
   * @returns the updated work flow.
   */
  async update(actor: WorkFlowActor, id: WorkFlowId, patch: UpdateWorkFlowInput): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    if (record.ownerId !== actor.id) {
      await this.stage(actor, id, record, {
        name: patch.name ?? record.name,
        scope: patch.scope ?? record.scope,
        definition: patch.definition ?? record.definition,
      })
      return toWorkFlow(id, record)
    }
    let next: WorkFlowRecord = {
      ...record,
      name: patch.name ?? record.name,
      scope: patch.scope ?? record.scope,
      definition: patch.definition ?? record.definition,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    if (next.status === 'active' && (patch.definition !== undefined || patch.name !== undefined)) {
      next = { ...next, routineId: await this.syncRoutine(id, next) }
    }
    await table.update(id, () => next)
    await this.recordVersion(id, next)
    return toWorkFlow(id, next)
  }

  /**
   * List one work flow's version history, newest first.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the versions.
   */
  async versions(actor: WorkFlowActor, id: WorkFlowId): Promise<readonly WorkFlowVersionRecord[]> {
    await this.requireAccess(actor, id, 'view')
    const rows: WorkFlowVersionRecord[] = []
    for (const [, record] of (await this.versionsTable()).entries()) {
      if (record.workflowId === id) rows.push(record)
    }
    return rows.sort((left, right) => right.version - left.version)
  }

  /**
   * Restore one work flow to an earlier version, bumping the version and
   * reconciling an active flow's compiled routine.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param version - the version to restore.
   * @returns the restored work flow.
   */
  async restore(actor: WorkFlowActor, id: WorkFlowId, version: number): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    const target = (await this.versionsTable()).get(`${id}:${String(version)}`)
    if (target === undefined) throw new Error(`faberloom: work flow version ${String(version)} not found`)
    if (record.ownerId !== actor.id) {
      await this.stage(actor, id, record, { name: target.name, scope: target.scope, definition: target.definition })
      return toWorkFlow(id, record)
    }
    let next: WorkFlowRecord = {
      ...record,
      name: target.name,
      scope: target.scope,
      definition: target.definition,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    if (next.status === 'active') next = { ...next, routineId: await this.syncRoutine(id, next) }
    await table.update(id, () => next)
    await this.recordVersion(id, next)
    return toWorkFlow(id, next)
  }

  /**
   * List the staged revisions on the work flows the actor owns, newest first,
   * each with its base and proposed graph for the approval diff.
   * @param actor - the acting identity.
   * @returns the staged revisions.
   */
  async pendingChanges(actor: WorkFlowActor): Promise<readonly WorkFlowPendingChange[]> {
    const table = await this.table()
    const out: WorkFlowPendingChange[] = []
    for (const [id, pending] of (await this.pendingTable()).entries()) {
      if (pending.ownerId !== actor.id) continue
      const live = table.get(id)
      if (live === undefined) continue
      out.push({
        workflowId: id,
        ownerId: pending.ownerId,
        proposerId: pending.proposerId,
        name: pending.name,
        scope: pending.scope,
        baseVersion: pending.baseVersion,
        createdAt: pending.createdAt,
        base: live.definition,
        proposed: pending.definition,
      })
    }
    return out.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Accept one staged revision: apply it to the live flow, bump the version,
   * reconcile an active flow's routine, and clear the stage. Owner only.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the updated work flow.
   */
  async acceptPending(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'view')
    if (record.ownerId !== actor.id) throw new Error('faberloom: only the owner can accept a staged change')
    const pending = (await this.pendingTable()).get(id)
    if (pending === undefined) throw new Error(`faberloom: work flow ${id} has no staged change`)
    /* jscpd:ignore-start -- mirrors restore's apply tail: build the next record,
       reconcile an active flow's routine, store, and record the version. */
    let next: WorkFlowRecord = {
      ...record,
      name: pending.name,
      scope: pending.scope,
      definition: pending.definition,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    if (next.status === 'active') next = { ...next, routineId: await this.syncRoutine(id, next) }
    await table.update(id, () => next)
    await this.recordVersion(id, next)
    /* jscpd:ignore-end */
    await (await this.pendingTable()).delete(id)
    return toWorkFlow(id, next)
  }

  /**
   * Reject one staged revision: drop it, leaving the live flow unchanged.
   * Owner only.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the unchanged work flow.
   */
  async rejectPending(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlow> {
    const { record } = await this.requireAccess(actor, id, 'view')
    if (record.ownerId !== actor.id) throw new Error('faberloom: only the owner can reject a staged change')
    const pending = (await this.pendingTable()).get(id)
    if (pending === undefined) throw new Error(`faberloom: work flow ${id} has no staged change`)
    await (await this.pendingTable()).delete(id)
    return toWorkFlow(id, record)
  }

  /**
   * Persist a new definition for an owned flow, bumping the version and
   * reconciling an active flow's compiled routine and waiting executions.
   * @param table - the workflows table handle.
   * @param id - work flow id.
   * @param record - the owned record the edit starts from.
   * @param definition - the graph to store.
   * @returns the updated work flow.
   */
  private async writeDefinition(
    actor: WorkFlowActor,
    table: KvTable<WorkFlowId, WorkFlowRecord>,
    id: WorkFlowId,
    record: WorkFlowRecord,
    definition: WorkFlowDefinition,
  ): Promise<WorkFlow> {
    return await this.persistDefinition(actor, table, id, record, definition)
  }

  /**
   * Store an edited definition. A member's edit stages a proposed revision for
   * the owner to accept; the owner's edit bumps the version, recompiles an
   * active flow's routine, and returns the refreshed work flow.
   * @param actor - the acting identity.
   * @param table - the workflows table handle.
   * @param id - work flow id.
   * @param record - the record the edit starts from.
   * @param definition - the definition to store.
   * @returns the updated work flow (unchanged while a member's change is staged).
   */
  private async persistDefinition(
    actor: WorkFlowActor,
    table: KvTable<WorkFlowId, WorkFlowRecord>,
    id: WorkFlowId,
    record: WorkFlowRecord,
    definition: WorkFlowDefinition,
  ): Promise<WorkFlow> {
    if (record.ownerId !== actor.id) {
      await this.stage(actor, id, record, { name: record.name, scope: record.scope, definition })
      return toWorkFlow(id, record)
    }
    let next: WorkFlowRecord = { ...record, definition, updatedAt: new Date().toISOString(), version: record.version + 1 }
    if (next.status === 'active') next = { ...next, routineId: await this.syncRoutine(id, next) }
    await table.update(id, () => next)
    await this.recordVersion(id, next)
    return toWorkFlow(id, next)
  }

  /**
   * Append one node to a work flow the actor owns.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param input - node title, kind, optional config, and optional id.
   * @returns the updated work flow.
   * @throws when the node id repeats an existing node.
   */
  async addNode(
    actor: WorkFlowActor,
    id: WorkFlowId,
    input: { id?: string | undefined; title: string; kind: WorkFlowNodeKind; config?: Record<string, unknown> | undefined },
  ): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'add-nodes')
    const nodeId = brandString<WorkFlowNodeId>(input.id ?? randomUUID())
    if (record.definition.nodes.some(node => node.id === nodeId)) {
      throw new Error(`faberloom: work flow ${id} already has node ${nodeId}`)
    }
    const node = { id: nodeId, title: input.title, position: { x: 0, y: 0 }, kind: input.kind, config: input.config ?? {} } as WorkFlowNode
    return await this.writeDefinition(actor, table, id, record, { ...record.definition, nodes: [...record.definition.nodes, node] })
  }

  /**
   * Change one node's title, kind, or config values (merged into its config).
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param nodeId - the node to change.
   * @param patch - fields to change; `config` merges over the node's config.
   * @returns the updated work flow.
   * @throws when the node does not exist.
   */
  async updateNode(
    actor: WorkFlowActor,
    id: WorkFlowId,
    nodeId: WorkFlowNodeId,
    patch: { title?: string | undefined; kind?: WorkFlowNodeKind | undefined; config?: Record<string, unknown> | undefined },
  ): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    const index = record.definition.nodes.findIndex(node => node.id === nodeId)
    if (index < 0) throw new Error(`faberloom: work flow ${id} has no node ${nodeId}`)
    const current = record.definition.nodes[index] as WorkFlowNode
    const updated = {
      ...current,
      ...patch.title === undefined ? {} : { title: patch.title },
      ...patch.kind === undefined ? {} : { kind: patch.kind },
      ...patch.config === undefined ? {} : { config: { ...current.config, ...patch.config } },
    } as WorkFlowNode
    const nodes = [...record.definition.nodes]
    nodes[index] = updated
    return await this.writeDefinition(actor, table, id, record, { ...record.definition, nodes })
  }

  /**
   * Remove one node and every edge incident to it.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param nodeId - the node to remove.
   * @returns the updated work flow.
   * @throws when the node does not exist.
   */
  async removeNode(actor: WorkFlowActor, id: WorkFlowId, nodeId: WorkFlowNodeId): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'remove-nodes')
    if (!record.definition.nodes.some(node => node.id === nodeId)) throw new Error(`faberloom: work flow ${id} has no node ${nodeId}`)
    return await this.writeDefinition(actor, table, id, record, {
      ...record.definition,
      nodes: record.definition.nodes.filter(node => node.id !== nodeId),
      edges: record.definition.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId),
    })
  }

  /**
   * Add a directed edge between two existing nodes.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param input - source, target, and optional branch condition.
   * @returns the updated work flow.
   * @throws when a referenced node does not exist.
   */
  async connect(
    actor: WorkFlowActor,
    id: WorkFlowId,
    input: { from: WorkFlowNodeId; to: WorkFlowNodeId; condition?: string | undefined },
  ): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    const ids = new Set(record.definition.nodes.map(node => node.id))
    if (!ids.has(input.from) || !ids.has(input.to)) throw new Error(`faberloom: work flow ${id} connect needs two existing nodes`)
    const edge: WorkFlowEdge = {
      id: brandString<WorkFlowEdgeId>(randomUUID()),
      from: input.from,
      to: input.to,
      ...input.condition === undefined ? {} : { condition: input.condition },
    }
    return await this.writeDefinition(actor, table, id, record, { ...record.definition, edges: [...record.definition.edges, edge] })
  }

  /**
   * Remove one edge.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param edgeId - the edge to remove.
   * @returns the updated work flow.
   * @throws when the edge does not exist.
   */
  async disconnect(actor: WorkFlowActor, id: WorkFlowId, edgeId: WorkFlowEdgeId): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    if (!record.definition.edges.some(edge => edge.id === edgeId)) {
      throw new Error(`faberloom: work flow ${id} has no edge ${edgeId}`)
    }
    return await this.writeDefinition(actor, table, id, record, {
      ...record.definition,
      edges: record.definition.edges.filter(edge => edge.id !== edgeId),
    })
  }

  /**
   * Replace the flow's trigger with one new trigger node of the given kind,
   * dropping edges that referenced the removed triggers.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param input - trigger kind and optional config.
   * @returns the updated work flow.
   * @throws when the kind is not a trigger kind.
   */
  async setTrigger(
    actor: WorkFlowActor,
    id: WorkFlowId,
    input: { kind: WorkFlowNodeKind; config?: Record<string, unknown> | undefined },
  ): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'manage-triggers')
    if (!TRIGGER_KINDS.has(input.kind)) throw new Error(`faberloom: ${input.kind} is not a trigger kind`)
    const nodes = record.definition.nodes.filter(node => !isTriggerNode(node))
    const kept = new Set(nodes.map(node => node.id))
    const edges = record.definition.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to))
    const trigger = {
      id: brandString<WorkFlowNodeId>(randomUUID()),
      title: input.kind,
      position: { x: 0, y: 0 },
      kind: input.kind,
      config: input.config ?? {},
    } as WorkFlowNode
    return await this.writeDefinition(actor, table, id, record, { ...record.definition, nodes: [trigger, ...nodes], edges })
  }

  /**
   * Change one work flow's lifecycle. Activating validates the graph and
   * resolves the compiled routine id; an invalid graph is refused.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param status - the new status.
   * @returns the updated work flow.
   * @throws when the graph is invalid and the target status is `active`.
   */
  async setStatus(actor: WorkFlowActor, id: WorkFlowId, status: WorkFlowStatus): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'manage-triggers')
    let routineId = record.routineId
    if (status === 'active') {
      const verdict = validateWorkFlow(record.definition)
      if (!verdict.ok) throw new Error(`faberloom: work flow ${id} cannot activate: ${verdict.problems.join('; ')}`)
      routineId = await this.syncRoutine(id, record)
    } else if (routineId !== null) {
      await this.ctx.faberloomRoutines.pauseRoutine(record.ownerId, brandString<FaberLoomRoutineId>(routineId))
    }
    const next: WorkFlowRecord = { ...record, status, routineId, updatedAt: new Date().toISOString(), version: record.version + 1 }
    await table.update(id, () => next)
    return toWorkFlow(id, next)
  }

  /**
   * Set or clear one work flow's concurrency cap, recompiling an active flow so
   * the dispatcher sees the new limit.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param maxConcurrency - the cap, or null to clear it.
   * @returns the updated work flow.
   */
  async setConcurrency(actor: WorkFlowActor, id: WorkFlowId, maxConcurrency: number | null): Promise<WorkFlow> {
    const { table, record } = await this.requireAccess(actor, id, 'edit-graph')
    const definition: WorkFlowDefinition = { ...record.definition, maxConcurrency: maxConcurrency ?? undefined }
    return await this.persistDefinition(actor, table, id, record, definition)
  }

  /**
   * Validate one work flow's graph without mutating it.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the verdict.
   */
  async validate(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlowValidation> {
    const { record } = await this.requireAccess(actor, id, 'view')
    return validateWorkFlow(record.definition)
  }

  /**
   * Compile one work flow to a routine definition without mutating it.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the routine definition input.
   */
  async compile(actor: WorkFlowActor, id: WorkFlowId): Promise<RoutineDefinitionInput> {
    return compileWorkFlow(await this.get(actor, id))
  }

  /**
   * The built-in templates a user can start from.
   * @returns the template catalog, in gallery order.
   */
  templates(): readonly WorkFlowTemplate[] { return WORKFLOW_TEMPLATES }

  /**
   * Create one owned work flow from a built-in template.
   * @param actor - the acting identity.
   * @param templateId - the template id.
   * @param name - optional display name; the template's name is used otherwise.
   * @returns the created work flow.
   * @throws when the template id is unknown.
   */
  async createFromTemplate(actor: WorkFlowActor, templateId: string, name?: string): Promise<WorkFlow> {
    const template = getTemplate(templateId)
    if (template === undefined) throw new Error(`faberloom: work flow template ${templateId} not found`)
    return await this.create(actor, {
      name: name === undefined || name.length === 0 ? template.name : name,
      definition: template.definition,
    })
  }

  /**
   * Export one work flow as portable JSON the gallery, the knowledge hub, and
   * another deployment can import.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the JSON text.
   */
  async exportFlow(actor: WorkFlowActor, id: WorkFlowId): Promise<string> {
    return serializeWorkFlow(await this.get(actor, id))
  }

  /**
   * Import portable Work Flow JSON as a new owned work flow; the graph is
   * validated before it is stored.
   * @param actor - the acting identity.
   * @param json - the JSON text.
   * @param name - optional display name overriding the export's.
   * @returns the created work flow.
   * @throws when the JSON is malformed, mislabelled, or its graph is invalid.
   */
  async importFlow(actor: WorkFlowActor, json: string, name?: string): Promise<WorkFlow> {
    const parsed = parseWorkFlow(json)
    return await this.create(actor, {
      name: name === undefined || name.length === 0 ? parsed.name : name,
      definition: parsed.definition,
    })
  }

  /**
   * Remove one work flow the actor owns.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns whether the stored record was deleted.
   */
  async remove(actor: WorkFlowActor, id: WorkFlowId): Promise<boolean> {
    const { table } = await this.requireOwned(actor, id)
    return await table.delete(id)
  }

  /**
   * Start one manual execution of an active work flow.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the started execution id and whether the engine deduped it.
   * @throws when the flow has no activated routine.
   */
  async runNow(actor: WorkFlowActor, id: WorkFlowId): Promise<{ executionId: string; deduped: boolean }> {
    const { record } = await this.requireAccess(actor, id, 'run')
    if (record.routineId === null) throw new Error(`faberloom: work flow ${id} is not active`)
    const started = await this.ctx.faberloomRoutines.startExecution({
      routineId: brandString<FaberLoomRoutineId>(record.routineId),
      idempotencyKey: `workflow-manual:${id}:${new Date().toISOString()}`,
      channel: 'workflow',
    })
    return { executionId: started.execution.id, deduped: started.deduped }
  }

  /**
   * Start one run of an active work flow on behalf of a collaborator — a
   * routine step that invokes this flow — deduping by the caller's key.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @param request - the caller's idempotency key.
   * @returns the started execution id and whether the engine deduped it.
   * @throws when the flow has no activated routine.
   */
  async invoke(
    actor: WorkFlowActor,
    id: WorkFlowId,
    request: { idempotencyKey: string },
  ): Promise<{ executionId: string; deduped: boolean }> {
    const { record } = await this.requireAccess(actor, id, 'run')
    if (record.routineId === null) throw new Error(`faberloom: work flow ${id} is not active`)
    const started = await this.ctx.faberloomRoutines.startExecution({
      routineId: brandString<FaberLoomRoutineId>(record.routineId),
      idempotencyKey: `workflow-invoke:${id}:${request.idempotencyKey}`,
      channel: 'workflow',
    })
    return { executionId: String(started.execution.id), deduped: started.deduped }
  }

  /**
   * List one work flow's executions, oldest first.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the executions, or an empty list when the flow has no routine.
   */
  async runs(actor: WorkFlowActor, id: WorkFlowId): Promise<readonly Execution[]> {
    const { record } = await this.requireAccess(actor, id, 'view')
    if (record.routineId === null) return []
    return await this.ctx.faberloomRoutines.listExecutions({ routineId: brandString<FaberLoomRoutineId>(record.routineId) })
  }
}

export default FaberLoomWorkflows
