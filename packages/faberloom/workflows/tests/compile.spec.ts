import { describe, expect, it } from 'vitest'
import { compileWorkFlow, validateWorkFlow } from '../src/index.ts'
import type {
  WorkFlow,
  WorkFlowDefinition,
  WorkFlowEdge,
  WorkFlowEdgeId,
  WorkFlowId,
  WorkFlowNode,
  WorkFlowNodeId,
  WorkFlowNodeKind,
} from '../src/index.ts'

/** Brand a test node id. */
const nid = (value: string): WorkFlowNodeId => value as WorkFlowNodeId

/** Brand a test edge id. */
const eid = (value: string): WorkFlowEdgeId => value as WorkFlowEdgeId

/** Build one test node of any kind. */
function node(id: string, kind: WorkFlowNodeKind, config: Record<string, unknown>, title = id): WorkFlowNode {
  return { id: nid(id), title, position: { x: 0, y: 0 }, kind, config } as WorkFlowNode
}

/** Build one test edge. */
function edge(id: string, from: string, to: string, condition?: string): WorkFlowEdge {
  return { id: eid(id), from: nid(from), to: nid(to), ...condition === undefined ? {} : { condition } }
}

/** Build one test definition. */
function definition(
  nodes: readonly WorkFlowNode[],
  edges: readonly WorkFlowEdge[],
  overrides: Partial<WorkFlowDefinition> = {},
): WorkFlowDefinition {
  return { intent: 'procesar pedido', nodes, edges, permissions: ['mwt'], failurePolicy: 'stop', ...overrides }
}

/** Wrap a definition in a work flow the compiler accepts. */
function workflow(definition: WorkFlowDefinition): WorkFlow {
  return {
    id: 'wf-1' as WorkFlowId,
    ownerId: 'compras2@sondelsa.com',
    scope: { kind: 'personal' },
    name: 'flujo',
    status: 'draft',
    version: 1,
    definition,
    routineId: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** The acceptance graph: classify inbound mail and route spam. */
const antispam = definition(
  [
    node('n1', 'trigger.email', { match: 'Antispam', unseenOnly: true }),
    node('n2', 'condition', { expression: 'category === "spam"' }),
    node('n3', 'agent', { agentId: 'antispam', instruction: 'clasificar el correo' }),
    node('n4', 'imap.action', { op: 'move', folder: 'Spam' }),
    node('n5', 'memory.remember', { spaceId: 'sp-antispam', text: 'remitente bloqueado' }),
    node('n6', 'notify', { kind: 'email', text: 'spam detectado' }),
    node('n7', 'deadletter', { reason: 'no clasificable' }),
    node('n8', 'trigger.schedule', { recurrence: '0 7 * * *' }),
  ],
  [
    edge('e1', 'n1', 'n2'),
    edge('e2', 'n8', 'n2'),
    edge('e3', 'n2', 'n3'),
    edge('e4', 'n3', 'n4'),
    edge('e5', 'n3', 'n7'),
    edge('e6', 'n4', 'n5'),
    edge('e7', 'n5', 'n6'),
  ],
  { intent: 'bloquear correo no deseado', permissions: ['email:read', 'email:move'], failurePolicy: 'review' },
)

describe('validateWorkFlow', () => {
  it('accepts the anti-spam acceptance graph', () => {
    expect(validateWorkFlow(antispam)).toEqual({ ok: true, problems: [] })
  })

  it('reports duplicate node and edge ids', () => {
    const duplicateNodes = definition(
      [node('t', 'trigger.manual', {}), node('x', 'agent', { agentId: 'a', instruction: 'i' }), node('x', 'agent', { agentId: 'a', instruction: 'i' })],
      [edge('e1', 't', 'x')],
    )
    expect(validateWorkFlow(duplicateNodes).problems).toContain('duplicate node id: x')
    const duplicateEdges = definition(
      [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' })],
      [edge('e1', 't', 'a'), edge('e1', 't', 'a')],
    )
    expect(validateWorkFlow(duplicateEdges).problems).toContain('duplicate edge id: e1')
  })

  it('reports edges that reference a missing source or target', () => {
    const missingSource = definition([node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' })], [edge('e1', 'ghost', 'a'), edge('e2', 't', 'a')])
    expect(validateWorkFlow(missingSource).problems).toContain('edge e1 references missing node: ghost')
    const missingTarget = definition([node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' })], [edge('e1', 't', 'ghost')])
    expect(validateWorkFlow(missingTarget).problems).toContain('edge e1 references missing node: ghost')
  })

  it('reports a graph without a trigger and nodes unreachable from one', () => {
    const noTrigger = definition([node('a', 'agent', { agentId: 'a', instruction: 'i' })], [])
    const verdict = validateWorkFlow(noTrigger)
    expect(verdict.problems).toContain('graph has no trigger node')
    expect(verdict.problems).toContain('unreachable node: a')
    const unreachable = definition(
      [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' }), node('b', 'notify', { kind: 'email' })],
      [edge('e1', 't', 'a')],
    )
    expect(validateWorkFlow(unreachable).problems).toContain('unreachable node: b')
  })

  it('reports a directed cycle', () => {
    const cyclic = definition(
      [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' }), node('b', 'agent', { agentId: 'a', instruction: 'i' })],
      [edge('e1', 't', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    )
    expect(validateWorkFlow(cyclic).problems).toContain('graph has a cycle')
  })

  it('accepts a diamond where one node is reached twice', () => {
    const diamond = definition(
      [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' }), node('b', 'agent', { agentId: 'a', instruction: 'i' }), node('c', 'notify', { kind: 'board' })],
      [edge('e1', 't', 'a'), edge('e2', 't', 'b'), edge('e3', 'a', 'c'), edge('e4', 'b', 'c')],
    )
    expect(validateWorkFlow(diamond)).toEqual({ ok: true, problems: [] })
  })
})

describe('compileWorkFlow', () => {
  it('compiles the anti-spam graph to a deterministic routine', () => {
    const compiled = compileWorkFlow(workflow(antispam))
    expect(compiled).toMatchInlineSnapshot(`
      {
        "expectedResult": "bloquear correo no deseado",
        "failurePolicy": "review",
        "intent": "bloquear correo no deseado",
        "permissions": [
          "email:read",
          "email:move",
        ],
        "steps": [
          {
            "config": {
              "expression": "category === "spam"",
            },
            "dependsOn": [],
            "effect": false,
            "handler": "condition",
            "id": "n2",
            "instruction": "n2",
          },
          {
            "config": {
              "agentId": "antispam",
              "instruction": "clasificar el correo",
            },
            "dependsOn": [
              "n2",
            ],
            "effect": false,
            "handler": "agent",
            "id": "n3",
            "instruction": "n3",
          },
          {
            "config": {
              "folder": "Spam",
              "op": "move",
            },
            "dependsOn": [
              "n3",
            ],
            "effect": true,
            "handler": "imap",
            "id": "n4",
            "instruction": "n4",
          },
          {
            "config": {
              "spaceId": "sp-antispam",
              "text": "remitente bloqueado",
            },
            "dependsOn": [
              "n4",
            ],
            "effect": false,
            "handler": "memory.remember",
            "id": "n5",
            "instruction": "n5",
          },
          {
            "config": {
              "kind": "email",
              "text": "spam detectado",
            },
            "dependsOn": [
              "n5",
            ],
            "effect": false,
            "handler": "notify",
            "id": "n6",
            "instruction": "n6",
          },
          {
            "config": {
              "reason": "no clasificable",
            },
            "dependsOn": [
              "n3",
            ],
            "effect": false,
            "handler": "deadletter",
            "id": "n7",
            "instruction": "n7",
          },
        ],
        "triggers": [
          {
            "kind": "email",
            "match": "Antispam",
          },
          {
            "kind": "recurrence",
            "match": "0 7 * * *",
          },
        ],
      }
    `)
  })

  it('maps every trigger kind to a routine trigger', () => {
    const triggers = definition(
      [
        node('t1', 'trigger.manual', {}),
        node('t2', 'trigger.schedule', { recurrence: 'daily' }),
        node('t3', 'trigger.email', { match: 'factura' }),
        node('t4', 'trigger.email', {}),
        node('t5', 'trigger.event', { match: 'order.paid' }),
        node('t6', 'trigger.event', {}),
        node('t7', 'trigger.board', { itemId: 'b1', status: 'approved' }),
        node('t8', 'trigger.board', {}),
      ],
      [],
    )
    expect(compileWorkFlow(workflow(triggers)).triggers).toEqual([
      { kind: 'manual' },
      { kind: 'recurrence', match: 'daily' },
      { kind: 'email', match: 'factura' },
      { kind: 'email' },
      { kind: 'event', match: 'order.paid' },
      { kind: 'event' },
      { kind: 'event', match: 'b1@approved' },
      { kind: 'event', match: '@' },
    ])
  })

  it('F6 — compiles a schedule trigger with timezone, window, days, and business days', () => {
    const flow = workflow(definition(
      [node('t1', 'trigger.schedule', {
        recurrence: '0 7 * * 1-5',
        timezone: 'Europe/Madrid',
        days: [1, 2, 3, 4, 5],
        window: { from: 8, to: 18 },
        businessDays: true,
      })],
      [],
    ))
    expect(compileWorkFlow(flow).triggers).toEqual([{
      kind: 'recurrence',
      match: '0 7 * * 1-5',
      timezone: 'Europe/Madrid',
      days: [1, 2, 3, 4, 5],
      window: { from: 8, to: 18 },
      businessDays: true,
    }])
  })

  it('F6 — carries the flow concurrency cap into the compiled routine', () => {
    const capped = definition([node('a0', 'notify', { kind: 'board' })], [], { maxConcurrency: 2 })
    expect(compileWorkFlow(workflow(capped)).maxConcurrency).toBe(2)
    const uncapped = definition([node('a0', 'notify', { kind: 'board' })], [])
    expect(compileWorkFlow(workflow(uncapped)).maxConcurrency).toBeUndefined()
  })

  it('maps every action kind to its handler and effect flag', () => {
    const actions: [WorkFlowNodeKind, Record<string, unknown>][] = [
      ['agent', { agentId: 'a', instruction: 'i' }],
      ['skill', { skillName: 'skill' }],
      ['mcp.call', { server: 's', tool: 't' }],
      ['imap.action', { op: 'search' }],
      ['smtp.send', { to: ['x@y.z'], subject: 's' }],
      ['memory.remember', { spaceId: 'sp', text: 't' }],
      ['memory.teach', { scope: 'space', text: 't', source: 's' }],
      ['board.create', { title: 't' }],
      ['space.reference', { spaceId: 'sp' }],
      ['routine.invoke', { routineId: 'r' }],
      ['condition', { expression: 'true' }],
      ['transform', { expression: 'toUpperCase()' }],
      ['wait', { seconds: 5 }],
      ['wait', { waitFor: 'reply' }],
      ['notify', { kind: 'board' }],
      ['deadletter', {}],
    ]
    const nodes = actions.map(([kind, config], index) => node(`a${index}`, kind, config))
    const compiled = compileWorkFlow(workflow(definition(nodes, [])))
    expect(compiled.steps.map(step => [step.id, step.handler, step.effect, step.waitFor])).toEqual([
      ['a0', 'agent', false, undefined],
      ['a1', 'agent', false, undefined],
      ['a2', 'mcp.call', true, undefined],
      ['a3', 'imap', true, undefined],
      ['a4', 'smtp', true, undefined],
      ['a5', 'memory.remember', false, undefined],
      ['a6', 'memory.teach', false, undefined],
      ['a7', 'board.create', true, undefined],
      ['a8', 'reference', false, undefined],
      ['a9', 'subroutine', false, undefined],
      ['a10', 'condition', false, undefined],
      ['a11', 'transform', false, undefined],
      ['a12', 'delay', false, '@delay:5'],
      ['a13', 'delay', false, 'reply'],
      ['a14', 'notify', false, undefined],
      ['a15', 'deadletter', false, undefined],
    ])
  })

  it('orders step dependencies from the incoming edges', () => {
    const fanIn = definition(
      [node('t', 'trigger.manual', {}), node('a', 'agent', { agentId: 'a', instruction: 'i' }), node('b', 'notify', { kind: 'board' }), node('c', 'deadletter', {})],
      [edge('e1', 'a', 'c'), edge('e2', 'b', 'c'), edge('e3', 't', 'a')],
    )
    const compiled = compileWorkFlow(workflow(fanIn))
    expect(compiled.steps.find(step => step.id === 'c')?.dependsOn).toEqual(['a', 'b'])
    expect(compiled.steps.find(step => step.id === 'a')?.dependsOn).toEqual([])
  })

  it('gates a step on the condition edge that reaches it', () => {
    const branched = definition(
      [
        node('c', 'condition', { expression: 'spam == true' }),
        node('yes', 'notify', { kind: 'email' }),
        node('no', 'deadletter', {}),
      ],
      [edge('e1', 'c', 'yes', 'spam == true'), edge('e2', 'c', 'no', 'spam == false')],
    )
    const compiled = compileWorkFlow(workflow(branched))
    expect(compiled.steps.find(step => step.id === 'yes')?.gate).toEqual({ stepId: 'c', expect: true })
    expect(compiled.steps.find(step => step.id === 'no')?.gate).toEqual({ stepId: 'c', expect: false })

    const ungated = definition(
      [
        node('a', 'agent', { agentId: 'a', instruction: 'i' }),
        node('c', 'condition', { expression: 'x' }),
        node('t', 'notify', { kind: 'board' }),
      ],
      [edge('e1', 'a', 't', 'spam == true'), edge('e2', 'c', 't', 'spam > 2')],
    )
    const plain = compileWorkFlow(workflow(ungated))
    expect(plain.steps.find(step => step.id === 't')?.gate).toBeUndefined()
  })

  it('compiles a wait node to an event wait, a bounded delay, or neither', () => {
    const waits = definition(
      [node('w1', 'wait', { waitFor: 'reply' }), node('w2', 'wait', { seconds: 5 }), node('w3', 'wait', {})],
      [],
    )
    const compiled = compileWorkFlow(workflow(waits))
    expect(compiled.steps.find(step => step.id === 'w1')?.waitFor).toBe('reply')
    expect(compiled.steps.find(step => step.id === 'w2')?.waitFor).toBe('@delay:5')
    expect(compiled.steps.find(step => step.id === 'w3')?.waitFor).toBeUndefined()
  })
})
