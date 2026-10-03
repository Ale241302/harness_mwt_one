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
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { RoutineDefinitionInput, RoutineStepInput, RoutineTriggerInput } from '@deepseek-ai/dsh-faberloom-routines'
import type {
  CreateWorkFlowInput,
  UpdateWorkFlowInput,
  WorkFlow,
  WorkFlowActor,
  WorkFlowDefinition,
  WorkFlowEdge,
  WorkFlowId,
  WorkFlowNode,
  WorkFlowNodeId,
  WorkFlowRecord,
  WorkFlowScope,
  WorkFlowStatus,
  WorkFlowValidation,
} from './types.ts'

export type * from './types.ts'

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
  'mcp.call': 'mcp',
  'imap.action': 'imap',
  'smtp.send': 'smtp',
  'memory.remember': 'memory',
  'memory.teach': 'memory',
  'board.create': 'board',
  'space.reference': 'reference',
  'routine.invoke': 'routine',
  'condition': 'condition',
  'wait': 'wait',
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
    case 'trigger.schedule': return { kind: 'recurrence', match: node.config.recurrence }
    case 'trigger.email': return node.config.match === undefined ? { kind: 'email' } : { kind: 'email', match: node.config.match }
    case 'trigger.event': return node.config.match === undefined ? { kind: 'event' } : { kind: 'event', match: node.config.match }
    case 'trigger.board': return { kind: 'event', match: `${node.config.itemId ?? ''}@${node.config.status ?? ''}` }
  }
}

/** Compile one action node to a routine step input. */
function stepFor(node: ActionNode, edges: readonly WorkFlowEdge[], triggerIds: ReadonlySet<WorkFlowNodeId>): RoutineStepInput {
  const dependsOn = edges.filter(edge => edge.to === node.id && !triggerIds.has(edge.from)).map(edge => edge.from)
  const step: RoutineStepInput = {
    id: node.id,
    instruction: node.title,
    handler: HANDLER_BY_KIND[node.kind],
    dependsOn,
    effect: EFFECT_KINDS.has(node.kind),
  }
  return node.kind === 'wait' && node.config.waitFor !== undefined ? { ...step, waitFor: node.config.waitFor } : step
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
  const steps = definition.nodes
    .filter((node): node is ActionNode => !isTriggerNode(node))
    .map(node => stepFor(node, definition.edges, triggerIds))
  return {
    intent: definition.intent,
    triggers,
    steps,
    expectedResult: definition.intent,
    permissions: [...definition.permissions],
    failurePolicy: definition.failurePolicy,
  }
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
  static inject = ['storageDomain']

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
    return toWorkFlow(id, record)
  }

  /**
   * List the actor's work flows, optionally only one scope, oldest first.
   * @param actor - the acting identity.
   * @param scope - when set, only flows in this scope.
   * @returns the actor's work flows.
   */
  async list(actor: WorkFlowActor, scope?: WorkFlowScope): Promise<WorkFlow[]> {
    const out: WorkFlow[] = []
    for (const [id, record] of (await this.table()).entries()) {
      if (record.ownerId !== actor.id) continue
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
    const { record } = await this.requireOwned(actor, id)
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
    const { table, record } = await this.requireOwned(actor, id)
    const next: WorkFlowRecord = {
      ...record,
      name: patch.name ?? record.name,
      scope: patch.scope ?? record.scope,
      definition: patch.definition ?? record.definition,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    await table.update(id, () => next)
    return toWorkFlow(id, next)
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
    const { table, record } = await this.requireOwned(actor, id)
    let routineId = record.routineId
    if (status === 'active') {
      const verdict = validateWorkFlow(record.definition)
      if (!verdict.ok) throw new Error(`faberloom: work flow ${id} cannot activate: ${verdict.problems.join('; ')}`)
      routineId = routineId ?? id
    }
    const next: WorkFlowRecord = { ...record, status, routineId, updatedAt: new Date().toISOString(), version: record.version + 1 }
    await table.update(id, () => next)
    return toWorkFlow(id, next)
  }

  /**
   * Validate one work flow's graph without mutating it.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns the verdict.
   */
  async validate(actor: WorkFlowActor, id: WorkFlowId): Promise<WorkFlowValidation> {
    const { record } = await this.requireOwned(actor, id)
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
   * Remove one work flow the actor owns.
   * @param actor - the acting identity.
   * @param id - work flow id.
   * @returns whether the stored record was deleted.
   */
  async remove(actor: WorkFlowActor, id: WorkFlowId): Promise<boolean> {
    const { table } = await this.requireOwned(actor, id)
    return await table.delete(id)
  }
}

export default FaberLoomWorkflows
