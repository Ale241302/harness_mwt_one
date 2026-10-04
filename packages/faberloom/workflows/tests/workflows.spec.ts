import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomWorkflows from '../src/index.ts'
import { getTemplate } from '../src/index.ts'
import { workFlowRecord } from '../src/spec.ts'
import type { WorkFlowDefinition, WorkFlowEdge, WorkFlowEdgeId, WorkFlowId, WorkFlowNode, WorkFlowNodeId, WorkFlowNodeKind } from '../src/index.ts'

/** Brand a test node id. */
const nid = (value: string): WorkFlowNodeId => value as WorkFlowNodeId

/** Brand a test edge id. */
const eid = (value: string): WorkFlowEdgeId => value as WorkFlowEdgeId

/** Build one test node of any kind. */
function node(id: string, kind: WorkFlowNodeKind, config: Record<string, unknown>): WorkFlowNode {
  return { id: nid(id), title: id, position: { x: 0, y: 0 }, kind, config } as WorkFlowNode
}

/** Build one test edge. */
function edge(id: string, from: string, to: string): WorkFlowEdge {
  return { id: eid(id), from: nid(from), to: nid(to) }
}

/** A minimal valid graph: one trigger feeding one agent step. */
const simple: WorkFlowDefinition = {
  intent: 'procesar pedido',
  nodes: [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'agent-1', instruction: 'procesar' })],
  edges: [edge('e1', 't', 'a')],
  permissions: ['mwt'],
  failurePolicy: 'stop',
}

/** A graph with the step unreachable from its trigger. */
const invalid: WorkFlowDefinition = {
  intent: 'flujo roto',
  nodes: [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'agent-1', instruction: 'procesar' })],
  edges: [],
  permissions: [],
  failurePolicy: 'stop',
}

/** The acceptance graph the service stores and activates. */
const antispam: WorkFlowDefinition = {
  intent: 'bloquear correo no deseado',
  nodes: [
    node('n1', 'trigger.email', { match: 'Antispam' }),
    node('n2', 'condition', { expression: 'category === "spam"' }),
    node('n3', 'agent', { agentId: 'antispam', instruction: 'clasificar' }),
    node('n4', 'imap.action', { op: 'move', folder: 'Spam' }),
    node('n5', 'memory.remember', { spaceId: 'sp-antispam', text: 'bloqueado' }),
    node('n6', 'notify', { kind: 'email' }),
  ],
  edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3'), edge('e3', 'n3', 'n4'), edge('e4', 'n4', 'n5'), edge('e5', 'n5', 'n6')],
  permissions: ['email:read'],
  failurePolicy: 'review',
}

/** Boot the storage/domain composition plus access, routines, and workflows over one pool. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  const fiber = await ctx.plugin(FaberLoomWorkflows)
  const routines = ctx.faberloomRoutines
  for (const name of ['agent', 'mcp', 'mcp.call', 'imap', 'smtp', 'memory.remember', 'memory.teach', 'board.create', 'reference', 'subroutine', 'condition', 'transform', 'delay', 'notify', 'deadletter']) {
    routines.registerHandler(name, () => 'ok')
  }
  return { ctx, workflows: ctx.faberloomWorkflows, routines, fiber, pool, facility }
}

const OWNER = { id: 'compras2@sondelsa.com' }
const OTHER = { id: 'otro@sonepar.com' }

describe('FaberLoomWorkflows', () => {
  it('F1 · creates, lists, and reads versioned flows scoped to personal or a Space', async () => {
    const { workflows } = await harness()
    const draft = await workflows.create(OWNER, { name: 'borrador', definition: simple })
    expect(draft).toMatchObject({ ownerId: OWNER.id, status: 'draft', version: 1, scope: { kind: 'personal' } })
    expect(draft.routineId).toBeUndefined()
    expect((await workflows.list(OWNER)).map(flow => flow.name)).toEqual(['borrador'])
    expect(await workflows.list(OTHER)).toEqual([])

    const inSpace = await workflows.create(OWNER, { name: 'en espacio', scope: { kind: 'space', spaceId: 'sp-1' }, definition: simple })
    expect(inSpace.scope).toEqual({ kind: 'space', spaceId: 'sp-1' })
    expect((await workflows.list(OWNER)).map(flow => flow.name)).toEqual(['borrador', 'en espacio'])
    expect((await workflows.list(OWNER, { kind: 'personal' })).map(flow => flow.name)).toEqual(['borrador'])
    expect((await workflows.list(OWNER, { kind: 'space', spaceId: 'sp-1' })).map(flow => flow.name)).toEqual(['en espacio'])
    expect(await workflows.list(OWNER, { kind: 'space', spaceId: 'sp-2' })).toEqual([])

    expect((await workflows.get(OWNER, draft.id)).name).toBe('borrador')
    await expect(workflows.get(OTHER, draft.id)).rejects.toThrow('access denied')
    await expect(workflows.get(OWNER, 'missing' as WorkFlowId)).rejects.toThrow('not found')
  })

  it('F1 · updates a flow, bumping the version and preserving untouched fields', async () => {
    const { workflows } = await harness()
    const flow = await workflows.create(OWNER, { name: 'v1', definition: simple })
    const renamed = await workflows.update(OWNER, flow.id, { name: 'v2' })
    expect(renamed).toMatchObject({ name: 'v2', version: 2 })
    const rescoped = await workflows.update(OWNER, flow.id, { scope: { kind: 'space', spaceId: 'sp-9' } })
    expect(rescoped.scope).toEqual({ kind: 'space', spaceId: 'sp-9' })
    expect(rescoped.name).toBe('v2')
    const redefined = await workflows.update(OWNER, flow.id, { definition: antispam })
    expect(redefined.definition.intent).toBe('bloquear correo no deseado')
    expect(redefined.version).toBe(4)
    await expect(workflows.update(OTHER, flow.id, { name: 'ajeno' })).rejects.toThrow('access denied')
    await expect(workflows.update(OWNER, 'missing' as WorkFlowId, { name: 'x' })).rejects.toThrow('not found')
  })

  it('F2 · activation creates and activates the compiled routine, then pauses it', async () => {
    const { workflows, routines } = await harness()
    const flow = await workflows.create(OWNER, { name: 'antispam', definition: antispam })
    const active = await workflows.setStatus(OWNER, flow.id, 'active')
    expect(active.status).toBe('active')
    expect(active.routineId).toBeTypeOf('string')
    expect((await routines.getRoutine(active.routineId as never)).status).toBe('active')

    const reactivated = await workflows.setStatus(OWNER, flow.id, 'active')
    expect(reactivated.routineId).toBe(active.routineId)
    expect((await routines.getRoutine(active.routineId as never)).version).toBe(2)

    const paused = await workflows.setStatus(OWNER, flow.id, 'paused')
    expect(paused.status).toBe('paused')
    expect((await routines.getRoutine(active.routineId as never)).status).toBe('paused')

    const broken = await workflows.create(OWNER, { name: 'roto', definition: invalid })
    await expect(workflows.setStatus(OWNER, broken.id, 'active')).rejects.toThrow('cannot activate')
    expect((await workflows.setStatus(OWNER, broken.id, 'draft')).status).toBe('draft')
    expect((await workflows.setStatus(OWNER, broken.id, 'paused')).status).toBe('paused')
    await expect(workflows.setStatus(OTHER, flow.id, 'paused')).rejects.toThrow('access denied')
    await expect(workflows.setStatus(OWNER, 'missing' as WorkFlowId, 'draft')).rejects.toThrow('not found')
  })

  it('F6 · sets and clears the concurrency cap, recompiling an active flow', async () => {
    const { workflows, routines } = await harness()
    const flow = await workflows.create(OWNER, { name: 'cap', definition: simple })
    expect((await workflows.setConcurrency(OWNER, flow.id, 2)).definition.maxConcurrency).toBe(2)
    const active = await workflows.setStatus(OWNER, flow.id, 'active')
    const recompiled = await workflows.setConcurrency(OWNER, flow.id, 3)
    expect(recompiled.definition.maxConcurrency).toBe(3)
    expect((await routines.getRoutine(active.routineId as never)).definition.maxConcurrency).toBe(3)
    expect((await workflows.setConcurrency(OWNER, flow.id, null)).definition.maxConcurrency).toBeUndefined()
    await expect(workflows.setConcurrency(OTHER, flow.id, 1)).rejects.toThrow('access denied')
  })

  it('F6 · invokes an active flow from a collaborator and refuses an inactive one', async () => {
    const { workflows, routines } = await harness()
    const flow = await workflows.create(OWNER, { name: 'puente', definition: simple })
    await expect(workflows.invoke(OWNER, flow.id, { idempotencyKey: 'x' })).rejects.toThrow('is not active')
    const active = await workflows.setStatus(OWNER, flow.id, 'active')
    const started = await workflows.invoke(OWNER, flow.id, { idempotencyKey: 'paso-1' })
    expect(started.deduped).toBe(false)
    expect(String((await routines.getExecution(started.executionId as never)).routineId)).toBe(active.routineId)
    const again = await workflows.invoke(OWNER, flow.id, { idempotencyKey: 'paso-1' })
    expect(again).toMatchObject({ deduped: true, executionId: started.executionId })
    await expect(workflows.invoke(OTHER, flow.id, { idempotencyKey: 'x' })).rejects.toThrow('access denied')
  })

  it('F2 · editing an active flow versions the routine and migrates waiting executions', async () => {
    const { workflows, routines } = await harness()
    const waiting: WorkFlowDefinition = {
      intent: 'espera la respuesta',
      nodes: [node('t', 'trigger.manual', {}), node('d', 'wait', { waitFor: 'reply' })],
      edges: [edge('e1', 't', 'd')],
      permissions: [],
      failurePolicy: 'stop',
    }
    const flow = await workflows.create(OWNER, { name: 'espera', definition: waiting })
    const active = await workflows.setStatus(OWNER, flow.id, 'active')
    const started = await routines.startExecution({ routineId: active.routineId as never, idempotencyKey: 'caso-1', channel: 'manual' })
    expect(started.execution.status).toBe('waiting')

    const rescoped = await workflows.update(OWNER, flow.id, { scope: { kind: 'space', spaceId: 'sp-1' } })
    expect(rescoped.routineId).toBe(active.routineId)

    const edited = await workflows.update(OWNER, flow.id, { definition: waiting })
    expect(edited.routineId).toBe(active.routineId)
    const migrated = await routines.getExecution(started.execution.id)
    expect(migrated.routineVersion).toBe(2)
    expect(migrated.steps.d).toMatchObject({ status: 'waiting' })
  })

  it('F1 · validates and compiles a stored flow', async () => {
    const { workflows } = await harness()
    const flow = await workflows.create(OWNER, { name: 'antispam', definition: antispam })
    expect(await workflows.validate(OWNER, flow.id)).toEqual({ ok: true, problems: [] })
    const compiled = await workflows.compile(OWNER, flow.id)
    expect(compiled.steps.map(step => step.id)).toEqual(['n2', 'n3', 'n4', 'n5', 'n6'])
    await expect(workflows.validate(OTHER, flow.id)).rejects.toThrow('access denied')
    await expect(workflows.compile(OTHER, flow.id)).rejects.toThrow('access denied')
  })

  it('F1 · removes an owned flow and refuses a foreign one', async () => {
    const { workflows } = await harness()
    const flow = await workflows.create(OWNER, { name: 'r', definition: simple })
    expect(await workflows.remove(OWNER, flow.id)).toBe(true)
    expect(await workflows.list(OWNER)).toEqual([])
    await expect(workflows.remove(OWNER, flow.id)).rejects.toThrow('not found')
    const foreign = await workflows.create(OWNER, { name: 'r2', definition: simple })
    await expect(workflows.remove(OTHER, foreign.id)).rejects.toThrow('access denied')
  })

  it('F1 · closes the work flows domain with its own fiber', async () => {
    const { workflows, fiber, facility } = await harness()
    await workflows.create(OWNER, { name: 'vivo', definition: simple })
    expect(Boolean(facility.get('faberloom_workflows'))).toBe(true)
    await fiber.dispose()
    expect(Boolean(facility.get('faberloom_workflows'))).toBe(false)
    await expect(workflows.list(OWNER)).rejects.toThrow()
  })

  it('F1 · disposes cleanly when no domain was ever opened', async () => {
    const { fiber } = await harness()
    await fiber.dispose()
  })

  it('F4 · edits a flow node by node and runs it on demand', async () => {
    const { workflows, routines } = await harness()
    const flow = await workflows.create(OWNER, { name: 'chat', definition: { intent: 'x', nodes: [], edges: [], permissions: [], failurePolicy: 'stop' } })
    const withTrigger = await workflows.setTrigger(OWNER, flow.id, { kind: 'trigger.manual' })
    expect(withTrigger.definition.nodes.filter(node => node.kind === 'trigger.manual')).toHaveLength(1)
    const triggerId = withTrigger.definition.nodes[0]!.id

    const added = await workflows.addNode(OWNER, flow.id, { id: 'a', title: 'actúa', kind: 'agent', config: { agentId: 'ag', instruction: 'i' } })
    expect(added.version).toBe(3)
    await workflows.addNode(OWNER, flow.id, { id: 'b', title: 'sin config', kind: 'deadletter' })
    await expect(workflows.addNode(OWNER, flow.id, { id: 'a', title: 'x', kind: 'agent' })).rejects.toThrow('already has node')

    const connected = await workflows.connect(OWNER, flow.id, { from: triggerId, to: 'a' as WorkFlowNodeId, condition: 'x == true' })
    expect(connected.definition.edges[0]?.condition).toBe('x == true')
    const withoutCondition = await workflows.connect(OWNER, flow.id, { from: triggerId, to: 'a' as WorkFlowNodeId })
    const toDisconnect = withoutCondition.definition.edges[1]!.id
    await workflows.connect(OWNER, flow.id, { from: 'a' as WorkFlowNodeId, to: 'b' as WorkFlowNodeId })
    await workflows.connect(OWNER, flow.id, { from: 'b' as WorkFlowNodeId, to: 'a' as WorkFlowNodeId })
    await expect(workflows.connect(OWNER, flow.id, { from: triggerId, to: 'ghost' as WorkFlowNodeId })).rejects.toThrow('two existing nodes')

    const retitled = await workflows.updateNode(OWNER, flow.id, 'a' as WorkFlowNodeId, { title: 'actúa v2' })
    expect(retitled.definition.nodes.find(node => node.id === 'a')?.title).toBe('actúa v2')
    const rekinded = await workflows.updateNode(OWNER, flow.id, 'a' as WorkFlowNodeId, { kind: 'notify', config: { kind: 'email' } })
    expect(rekinded.definition.nodes.find(node => node.id === 'a')).toMatchObject({ kind: 'notify', config: { kind: 'email', instruction: 'i' } })
    await expect(workflows.updateNode(OWNER, flow.id, 'ghost' as WorkFlowNodeId, { title: 'x' })).rejects.toThrow('has no node')

    await workflows.disconnect(OWNER, flow.id, toDisconnect)
    await expect(workflows.disconnect(OWNER, flow.id, toDisconnect)).rejects.toThrow('has no edge')
    await workflows.setTrigger(OWNER, flow.id, { kind: 'trigger.manual', config: {} })
    await expect(workflows.setTrigger(OWNER, flow.id, { kind: 'agent' })).rejects.toThrow('not a trigger kind')

    const removed = await workflows.removeNode(OWNER, flow.id, 'a' as WorkFlowNodeId)
    expect(removed.definition.nodes.some(node => node.id === 'a')).toBe(false)
    await expect(workflows.removeNode(OWNER, flow.id, 'ghost' as WorkFlowNodeId)).rejects.toThrow('has no node')

    const runFlow = await workflows.create(OWNER, { name: 'run', definition: simple })
    await expect(workflows.runNow(OWNER, runFlow.id)).rejects.toThrow('is not active')
    expect(await workflows.runs(OWNER, runFlow.id)).toEqual([])
    const active = await workflows.setStatus(OWNER, runFlow.id, 'active')
    const started = await workflows.runNow(OWNER, active.id)
    expect(typeof started.executionId).toBe('string')
    expect(await workflows.runs(OWNER, active.id)).toHaveLength(1)
    expect((await routines.getExecution(started.executionId as never)).routineId).toBe(active.routineId)
    await workflows.addNode(OWNER, active.id, { title: 'extra', kind: 'notify', config: { kind: 'board' } })
  })
})

describe('workFlowRecord schema', () => {
  it('parses a branded stored record with a node and an edge', () => {
    const parsed = workFlowRecord.parse({
      ownerId: OWNER.id,
      scope: { kind: 'space', spaceId: 'sp-1' },
      name: 'antispam',
      status: 'active',
      version: 2,
      definition: {
        intent: 'bloquear',
        nodes: [{ id: 'n1', title: 'correo', position: { x: 1, y: 2 }, kind: 'trigger.email', config: { match: 'Antispam' } }],
        edges: [{ id: 'e1', from: 'n1', to: 'n1' }],
        permissions: ['email:read'],
        failurePolicy: 'review',
      },
      routineId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(parsed.definition.nodes[0]?.id).toBe('n1')
    expect(parsed.definition.edges[0]?.id).toBe('e1')
    expect(parsed.routineId).toBeNull()
  })

  it('rejects a node whose config does not match its kind', () => {
    expect(() => workFlowRecord.parse({
      ownerId: OWNER.id,
      scope: { kind: 'personal' },
      name: 'roto',
      status: 'draft',
      version: 1,
      definition: {
        intent: 'x',
        nodes: [{ id: 'n1', title: 'x', position: { x: 0, y: 0 }, kind: 'trigger.schedule', config: {} }],
        edges: [],
        permissions: [],
        failurePolicy: 'stop',
      },
      routineId: null,
      createdAt: 'c',
      updatedAt: 'u',
    })).toThrow()
  })
})

describe('FaberLoomWorkflows templates, export, and import', () => {
  it('F9 · every built-in template validates and compiles', async () => {
    const { workflows } = await harness()
    const templates = workflows.templates()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.map(template => template.id)).toContain('anti-spam')
    for (const template of templates) {
      const flow = await workflows.createFromTemplate(OWNER, template.id)
      expect(flow.definition.nodes).toHaveLength(template.definition.nodes.length)
      await expect(workflows.compile(OWNER, flow.id)).resolves.toBeTruthy()
    }
  })

  it('F9 · createFromTemplate uses the template name and accepts an override', async () => {
    const { workflows } = await harness()
    const named = await workflows.createFromTemplate(OWNER, 'anti-spam')
    expect(named.name).toBe(getTemplate('anti-spam')?.name)
    const overridden = await workflows.createFromTemplate(OWNER, 'anti-spam', 'Mi anti-spam')
    expect(overridden.name).toBe('Mi anti-spam')
    await expect(workflows.createFromTemplate(OWNER, 'nope')).rejects.toThrow('work flow template nope not found')
  })

  it('F9 · exports portable JSON and imports it back as a new flow', async () => {
    const { workflows } = await harness()
    const source = await workflows.createFromTemplate(OWNER, 'inbox-digest', 'Origen')
    const json = await workflows.exportFlow(OWNER, source.id)
    const parsed = JSON.parse(json) as { format: string; version: number; name: string }
    expect(parsed.format).toBe('faberloom-workflow')
    expect(parsed.version).toBe(1)
    expect(parsed.name).toBe('Origen')

    const imported = await workflows.importFlow(OWNER, json, 'Copia')
    expect(imported.name).toBe('Copia')
    expect(imported.id).not.toBe(source.id)
    expect(imported.status).toBe('draft')
    expect(imported.definition.nodes.map(node => node.kind)).toEqual(source.definition.nodes.map(node => node.kind))

    // Without an override the export's name survives a round trip.
    const again = await workflows.importFlow(OWNER, json)
    expect(again.name).toBe('Origen')
  })

  it('F9 · rejects malformed, mislabelled, and invalid imports', async () => {
    const { workflows } = await harness()
    await expect(workflows.importFlow(OWNER, 'not json')).rejects.toThrow('no es válido')
    await expect(workflows.importFlow(OWNER, '[]')).rejects.toThrow('debe ser un objeto')
    await expect(workflows.importFlow(OWNER, JSON.stringify({ format: 'otro', definition: simple }))).rejects.toThrow('format')
    await expect(workflows.importFlow(OWNER, JSON.stringify({ format: 'faberloom-workflow' }))).rejects.toThrow('definition')

    const broken = await workflows.create(OWNER, { name: 'roto', definition: invalid })
    const brokenJson = await workflows.exportFlow(OWNER, broken.id)
    await expect(workflows.importFlow(OWNER, brokenJson)).rejects.toThrow('no es válido')
  })
})
