/**
 * Model-facing Work Flow tools (`faberloom_workflows_*`): list, read, create,
 * and edit a versioned graph node by node, then validate, activate, pause, run,
 * and read its runs. Registered only when the deployment opts in with
 * `Config.workflowTools`, because they add request schema.
 * @module @deepseek-ai/dsh-tool-faberloom/src/workflows
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import type {
  FaberLoomWorkflows,
  WorkFlow,
  WorkFlowEdgeId,
  WorkFlowId,
  WorkFlowNodeId,
  WorkFlowNodeKind,
} from '@deepseek-ai/dsh-faberloom-workflows'
import type { FaberLoomShares } from '@deepseek-ai/dsh-faberloom-shares'

/** One argument value accepted by a workflow tool executor. */
type WorkflowArgs = Record<string, unknown>

/** Build the text one workflow tool returns to the model. */
function renderWorkflow(value: Record<string, unknown>): string {
  if (typeof value['valid'] === 'boolean') {
    return value['valid']
      ? `Flow ${String(value['id'])} is valid.`
      : `Flow ${String(value['id'])} is invalid: ${(value['problems'] as readonly string[]).join('; ')}`
  }
  if (typeof value['executionId'] === 'string') {
    return `Started ${value['executionId']}${value['deduped'] === true ? ' (deduped)' : ''}.`
  }
  if (Array.isArray(value['runs'])) return `${String((value['runs'] as readonly unknown[]).length)} run(s).`
  return `Flow ${String(value['id'])} "${String(value['name'])}" ${String(value['status'])} v${String(value['version'])} (${String(value['nodes'])} nodes, ${String(value['edges'])} edges).`
}

/** Shared output: every workflow tool renders its summary line. */
const WORKFLOW_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
      version: { type: 'number' },
      nodes: { type: 'number' },
      edges: { type: 'number' },
      valid: { type: 'boolean' },
      problems: { type: 'array', items: { type: 'string' } },
      executionId: { type: 'string' },
      deduped: { type: 'boolean' },
      runs: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  },
  render: (_args: unknown, value: Record<string, unknown>) => [{ type: 'text' as const, text: renderWorkflow(value) }],
} as const

/** Shared output: every sharing tool renders its grant summary. */
const SHARE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      workflowId: { type: 'string' },
      revoked: { type: 'string' },
      grants: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  },
  render: (_args: unknown, value: Record<string, unknown>) => [{
    type: 'text' as const,
    text: Array.isArray(value['grants'])
      ? `${String((value['grants'] as readonly unknown[]).length)} share grant(s) on ${String(value['workflowId'])}.`
      : `Revoked ${String(value['revoked'])}.`,
  }],
} as const

/** The two fields every node tool shares. */
const WORKFLOW_ID = { type: 'string', required: true, description: 'Work flow id from faberloom_workflows_list or _create.' } as const
const NODE_ID = { type: 'string', required: true, description: 'Node id inside the work flow.' } as const
/** Free-form node configuration; the tool passes it through to the stored graph. */
const NODE_CONFIG = { type: 'object', additionalProperties: true, description: 'Node configuration for the kind (e.g. agentId and instruction for agent; server and tool for mcp.call; op for imap.action).' } as const
const NODE_KIND = { type: 'string', required: true, description: 'Node kind: trigger.manual, trigger.schedule, trigger.email, trigger.event, trigger.board, agent, skill, mcp.call, imap.action, smtp.send, memory.remember, memory.teach, board.create, space.reference, routine.invoke, condition, transform, wait, notify, or deadletter.' } as const

/** One workflow tool declaration. */
interface WorkflowTool {
  readonly name: string
  readonly description: string
  readonly parameters: ParameterSchemaSpec
  readonly run: (service: FaberLoomWorkflows, actor: SpaceActor, args: WorkflowArgs) => Promise<Record<string, unknown>>
}

/** Summary of one stored work flow. */
function summarize(flow: WorkFlow): Record<string, unknown> {
  return {
    id: flow.id,
    name: flow.name,
    status: flow.status,
    version: flow.version,
    nodes: flow.definition.nodes.length,
    edges: flow.definition.edges.length,
  }
}

/** The workflow tools this package registers. */
const WORKFLOW_TOOLS: readonly WorkflowTool[] = [
  {
    name: 'faberloom_workflows_list',
    description: 'List the owner work flows: id, name, status, and graph size.',
    parameters: {},
    run: async (service, actor) => ({ runs: (await service.list(actor)).map(summarize) }),
  },
  {
    name: 'faberloom_workflows_get',
    description: 'Read one work flow graph: its nodes, edges, and lifecycle.',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => summarize(await service.get(actor, args.workflowId as WorkFlowId)),
  },
  {
    name: 'faberloom_workflows_create',
    description: 'Create an empty work flow graph; add a trigger and nodes next.',
    parameters: {
      name: { type: 'string', required: true, description: 'Human-readable flow name.' },
      scope: { type: 'string', description: '`personal` (default) or `space`.' },
      spaceId: { type: 'string', description: 'Space id when scope is `space`.' },
    },
    run: async (service, actor, args) => {
      const scope = args.scope === 'space'
        ? { kind: 'space' as const, spaceId: typeof args.spaceId === 'string' ? args.spaceId : '' }
        : undefined
      return summarize(await service.create(actor, { name: String(args.name), ...scope === undefined ? {} : { scope }, definition: { intent: String(args.name), nodes: [], edges: [], permissions: [], failurePolicy: 'stop' } }))
    },
  },
  {
    name: 'faberloom_workflows_add_node',
    description: 'Append one node to a work flow graph.',
    parameters: { workflowId: WORKFLOW_ID, kind: NODE_KIND, title: { type: 'string', required: true, description: 'Node title.' }, config: NODE_CONFIG, id: { type: 'string', description: 'Optional stable node id to connect against.' } },
    run: async (service, actor, args) => summarize(await service.addNode(actor, args.workflowId as WorkFlowId, {
      kind: args.kind as WorkFlowNodeKind,
      title: String(args.title),
      ...args.id === undefined ? {} : { id: args.id as string },
      ...args.config === undefined ? {} : { config: args.config as Record<string, unknown> },
    })),
  },
  {
    name: 'faberloom_workflows_update_node',
    description: 'Change a node title, kind, or config (config values merge; use it to change agentId).',
    parameters: { workflowId: WORKFLOW_ID, nodeId: NODE_ID, title: { type: 'string', description: 'New title.' }, kind: { type: 'string', description: 'New node kind.' }, config: NODE_CONFIG },
    run: async (service, actor, args) => summarize(await service.updateNode(
      actor,
      args.workflowId as WorkFlowId,
      args.nodeId as WorkFlowNodeId,
      {
        ...args.title === undefined ? {} : { title: args.title as string },
        ...args.kind === undefined ? {} : { kind: args.kind as WorkFlowNodeKind },
        ...args.config === undefined ? {} : { config: args.config as Record<string, unknown> },
      },
    )),
  },
  {
    name: 'faberloom_workflows_remove_node',
    description: 'Remove one node and its incident edges.',
    parameters: { workflowId: WORKFLOW_ID, nodeId: NODE_ID },
    run: async (service, actor, args) => summarize(await service.removeNode(
      actor,
      args.workflowId as WorkFlowId,
      args.nodeId as WorkFlowNodeId,
    )),
  },
  {
    name: 'faberloom_workflows_connect',
    description: 'Connect two existing nodes with a directed edge; an edge from a condition node may carry a `== true`/`== false` branch condition.',
    parameters: {
      workflowId: WORKFLOW_ID,
      from: { type: 'string', required: true, description: 'Source node id.' },
      to: { type: 'string', required: true, description: 'Target node id.' },
      condition: { type: 'string', description: 'Optional branch condition, e.g. `spam == true`.' },
    },
    run: async (service, actor, args) => summarize(await service.connect(actor, args.workflowId as WorkFlowId, {
      from: args.from as WorkFlowNodeId,
      to: args.to as WorkFlowNodeId,
      ...args.condition === undefined ? {} : { condition: args.condition as string },
    })),
  },
  {
    name: 'faberloom_workflows_disconnect',
    description: 'Remove one edge.',
    parameters: { workflowId: WORKFLOW_ID, edgeId: { type: 'string', required: true, description: 'Edge id from faberloom_workflows_get.' } },
    run: async (service, actor, args) => summarize(await service.disconnect(
      actor,
      args.workflowId as WorkFlowId,
      args.edgeId as WorkFlowEdgeId,
    )),
  },
  {
    name: 'faberloom_workflows_set_trigger',
    description: 'Replace the flow trigger with one trigger node of the given kind.',
    parameters: { workflowId: WORKFLOW_ID, kind: { type: 'string', required: true, description: 'Trigger kind: trigger.manual, trigger.schedule, trigger.email, trigger.event, or trigger.board.' }, config: NODE_CONFIG },
    run: async (service, actor, args) => summarize(await service.setTrigger(actor, args.workflowId as WorkFlowId, {
      kind: args.kind as WorkFlowNodeKind,
      ...args.config === undefined ? {} : { config: args.config as Record<string, unknown> },
    })),
  },
  {
    name: 'faberloom_workflows_validate',
    description: 'Validate the graph (cycles, unreachable nodes, missing trigger, dangling edges).',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => {
      const verdict = await service.validate(actor, args.workflowId as WorkFlowId)
      return { id: args.workflowId, valid: verdict.ok, problems: [...verdict.problems] }
    },
  },
  {
    name: 'faberloom_workflows_activate',
    description: 'Validate and activate the flow, compiling it to a routine that runs offline.',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => summarize(await service.setStatus(actor, args.workflowId as WorkFlowId, 'active')),
  },
  {
    name: 'faberloom_workflows_pause',
    description: 'Pause the flow; running executions keep going.',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => summarize(await service.setStatus(actor, args.workflowId as WorkFlowId, 'paused')),
  },
  {
    name: 'faberloom_workflows_run_now',
    description: 'Start one manual execution of an active flow.',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => await service.runNow(actor, args.workflowId as WorkFlowId),
  },
  {
    name: 'faberloom_workflows_runs',
    description: 'List the executions of one work flow.',
    parameters: { workflowId: WORKFLOW_ID },
    run: async (service, actor, args) => ({
      runs: (await service.runs(actor, args.workflowId as WorkFlowId)).map(run => ({
        id: run.id,
        status: run.status,
        routineVersion: run.routineVersion,
      })),
    }),
  },
]

/**
 * Register the Work Flow tools on the calling agent's tool registry.
 * @param ctx - context carrying `tools` and the `faberloomWorkflows` service.
 * @param actor - the acting identity, from the deployment config.
 */
export function registerWorkflowTools(ctx: Context, actor: SpaceActor): void {
  for (const tool of WORKFLOW_TOOLS) {
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: WORKFLOW_OUTPUT,
      execute: async (args: WorkflowArgs) => {
        const service = ctx.get('faberloomWorkflows')
        if (service === undefined) throw new Error('faberloom: the workflows service is not mounted')
        return await tool.run(service, actor, args)
      },
      presentCall: (callArgs: WorkflowArgs) => ({ card: 'generic', title: tool.name, kind: 'other', rawInput: callArgs }),
    }))
  }
  registerShareTools(ctx, actor)
}

/**
 * Register the sharing tools (`faberloom_workflows_share/_revoke/_permissions`),
 * which act on `ctx.faberloomShares` rather than the graph.
 * @param ctx - context carrying `tools` and the `faberloomShares` service.
 * @param actor - the acting identity, from the deployment config.
 */
function registerShareTools(ctx: Context, actor: SpaceActor): void {
  const shares = (): FaberLoomShares => {
    const service = ctx.get('faberloomShares')
    if (service === undefined) throw new Error('faberloom: the shares service is not mounted')
    return service
  }
  const grantsFor = async (workflowId: string): Promise<Record<string, string | string[]>[]> =>
    (await shares().list(actor.id)).outgoing
      .filter(grant => grant.resource.kind === 'workflow' && grant.resource.id === workflowId)
      .map(grant => ({
        id: grant.id,
        email: grant.granteeEmail,
        permissions: [...grant.permissions],
        status: grant.status,
      }))

  ctx.tools.register(defineTool({
    name: 'faberloom_workflows_share',
    description: 'Share one work flow with named emails and per-action permissions (view, run, edit-graph, add-nodes, remove-nodes, edit-agents, manage-triggers, share). The grantee receives an acceptance link by email and gets access once accepted.',
    parameters: {
      workflowId: WORKFLOW_ID,
      emails: { type: 'array', required: true, items: { type: 'string' }, description: 'Emails to share with.' },
      permissions: { type: 'array', required: true, items: { type: 'string' }, description: 'Permissions to grant.' },
    },
    output: SHARE_OUTPUT,
    execute: async (args: WorkflowArgs) => {
      const service = ctx.get('faberloomWorkflows')
      if (service === undefined) throw new Error('faberloom: the workflows service is not mounted')
      const workflowId = typeof args['workflowId'] === 'string' ? args['workflowId'] : ''
      const flow = await service.get(actor, workflowId as WorkFlowId)
      const emails = Array.isArray(args['emails']) ? args['emails'].map(String) : []
      const permissions = Array.isArray(args['permissions']) ? args['permissions'].map(String) : []
      for (const email of emails) {
        await shares().create(actor.id, { resource: { kind: 'workflow', id: workflowId }, resourceName: flow.name, granteeEmail: email, permissions })
      }
      return { workflowId, grants: await grantsFor(workflowId) }
    },
    presentCall: (callArgs: WorkflowArgs) => ({ card: 'generic', title: 'faberloom_workflows_share', kind: 'other', rawInput: callArgs }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_workflows_revoke',
    description: 'Revoke one share grant by id.',
    parameters: { grantId: { type: 'string', required: true, description: 'Grant id from faberloom_workflows_permissions.' } },
    output: SHARE_OUTPUT,
    execute: async (args: WorkflowArgs) => {
      const grantId = typeof args['grantId'] === 'string' ? args['grantId'] : ''
      await shares().revoke(actor.id, grantId)
      return { revoked: grantId }
    },
    presentCall: (callArgs: WorkflowArgs) => ({ card: 'generic', title: 'faberloom_workflows_revoke', kind: 'other', rawInput: callArgs }),
  }))

  ctx.tools.register(defineTool({
    name: 'faberloom_workflows_permissions',
    description: 'List the share grants on one work flow: grantee email, permissions, and status.',
    parameters: { workflowId: WORKFLOW_ID },
    output: SHARE_OUTPUT,
    execute: async (args: WorkflowArgs) => {
      const workflowId = typeof args['workflowId'] === 'string' ? args['workflowId'] : ''
      return { workflowId, grants: await grantsFor(workflowId) }
    },
    presentCall: (callArgs: WorkflowArgs) => ({ card: 'generic', title: 'faberloom_workflows_permissions', kind: 'other', rawInput: callArgs }),
  }))
}
