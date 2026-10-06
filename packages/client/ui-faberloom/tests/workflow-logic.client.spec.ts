// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { defaultConfigFor, edgeLine, kindIsTrigger, layoutNodes, NODE_HEIGHT, NODE_WIDTH, nodeAnchor, statusTone } from '../src/client/workflow-logic.ts'

describe('workflow canvas logic', () => {
  it('classifies trigger kinds', () => {
    expect(kindIsTrigger('trigger.email')).toBe(true)
    expect(kindIsTrigger('agent')).toBe(false)
  })

  it('anchors an edge at the box sides', () => {
    const node = { id: 'n1', kind: 'agent', title: 'a', x: 10, y: 20 }
    expect(nodeAnchor(node, 'left')).toEqual({ x: 10, y: 20 + NODE_HEIGHT / 2 })
    expect(nodeAnchor(node, 'right')).toEqual({ x: 10 + NODE_WIDTH, y: 20 + NODE_HEIGHT / 2 })
    expect(edgeLine(node, { id: 'n2', kind: 'notify', title: 'b', x: 300, y: 20 })).toEqual({
      x1: 10 + NODE_WIDTH,
      y1: 20 + NODE_HEIGHT / 2,
      x2: 300,
      y2: 20 + NODE_HEIGHT / 2,
    })
  })

  it('maps an execution status to a run-history tone, neutral for unknown', () => {
    expect(statusTone('completed')).toBe('completed')
    expect(statusTone('running')).toBe('running')
    expect(statusTone('waiting')).toBe('waiting')
    expect(statusTone('failed')).toBe('failed')
    expect(statusTone('needs_review')).toBe('waiting')
    expect(statusTone('ghost')).toBe('idle')
  })

  it('seeds a default config per node kind', () => {
    expect(defaultConfigFor('agent')).toEqual({ agentId: '', instruction: '' })
    expect(defaultConfigFor('skill')).toEqual({ skillName: '' })
    expect(defaultConfigFor('mcp.call')).toEqual({ server: '', tool: '' })
    expect(defaultConfigFor('imap.action')).toEqual({ op: 'search' })
    expect(defaultConfigFor('smtp.send')).toEqual({ to: [], subject: '' })
    expect(defaultConfigFor('memory.remember')).toEqual({ spaceId: '', text: '' })
    expect(defaultConfigFor('memory.teach')).toEqual({ scope: 'case', text: '', source: '' })
    expect(defaultConfigFor('board.create')).toEqual({ title: '' })
    expect(defaultConfigFor('space.reference')).toEqual({ spaceId: '' })
    expect(defaultConfigFor('routine.invoke')).toEqual({ routineId: '' })
    expect(defaultConfigFor('condition')).toEqual({ expression: '' })
    expect(defaultConfigFor('transform')).toEqual({ expression: '' })
    expect(defaultConfigFor('wait')).toEqual({ seconds: 0 })
    expect(defaultConfigFor('notify')).toEqual({ kind: 'board' })
    expect(defaultConfigFor('trigger.schedule')).toEqual({ recurrence: '1h', timezone: 'UTC', businessDays: false })
    expect(defaultConfigFor('trigger.email')).toEqual({ match: '' })
    expect(defaultConfigFor('unknown.kind')).toEqual({})
  })

  it('lays out a graph created with no positions, and keeps existing ones', () => {
    const nodes = [
      { id: 'a', kind: 'trigger.manual', title: 'a', x: 0, y: 0 },
      { id: 'b', kind: 'agent', title: 'b', x: 0, y: 0 },
      { id: 'c', kind: 'notify', title: 'c', x: 0, y: 0 },
      { id: 'd', kind: 'deadletter', title: 'd', x: 0, y: 0 },
      { id: 'e', kind: 'wait', title: 'e', x: 0, y: 0 },
    ]
    const laid = layoutNodes(nodes)
    expect(laid[0]).toMatchObject({ x: 40, y: 48 })
    expect(laid[4]).toMatchObject({ x: 40, y: 48 + 130 })
    const manual = [{ id: 'a', kind: 'agent', title: 'a', x: 5, y: 7 }]
    expect(layoutNodes(manual)).toBe(manual)
  })
})
