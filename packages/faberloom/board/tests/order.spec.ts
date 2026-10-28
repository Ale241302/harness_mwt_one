import { describe, expect, it } from 'vitest'
import {
  PRIORITY_UNCLASSIFIED,
  compareBoardOrder,
  orderBoardGroups,
  orderBoardItems,
  priorityRank,
} from '../src/order.ts'
import type { BoardOrderFields, BoardSeverity } from '../src/types.ts'
import { ACTOR_A, bootBoard, seedSpace } from './helpers/harness.ts'

interface RowFields {
  readonly severity?: BoardSeverity | null
  readonly spaceId?: string | null
  readonly dueAt?: string | null
  readonly valueUsd?: number | null
  readonly createdAt?: string
}

/** Build the item fields the order tuple reads, defaulting the optional ones to "missing". */
function row(id: string, fields: RowFields = {}): BoardOrderFields {
  return {
    id,
    severity: fields.severity === undefined ? null : fields.severity,
    spaceId: fields.spaceId === undefined ? 'sp-1' : fields.spaceId,
    dueAt: fields.dueAt === undefined ? null : fields.dueAt,
    valueUsd: fields.valueUsd === undefined ? null : fields.valueUsd,
    createdAt: fields.createdAt === undefined ? '2026-10-01T00:00:00.000Z' : fields.createdAt,
  }
}

describe('canonical queue order', () => {
  it('W-04 · the same item set produces the same order when the first four fields tie', () => {
    const tie = {
      severity: 'HIGH' as const,
      dueAt: '2026-10-28T09:00:00.000Z',
      valueUsd: 1200,
      createdAt: '2026-10-01T00:00:00.000Z',
    }
    const items = [row('item-c', tie), row('item-a', tie), row('item-b', tie)]

    expect(orderBoardItems(items).map(item => item.id)).toEqual(['item-a', 'item-b', 'item-c'])
    expect(orderBoardItems([...items].reverse()).map(item => item.id)).toEqual(['item-a', 'item-b', 'item-c'])
    expect(compareBoardOrder(row('item-a', tie), row('item-b', tie))).toBeLessThan(0)
    expect(compareBoardOrder(row('item-b', tie), row('item-a', tie))).toBeGreaterThan(0)
  })

  it('W-04 · orders by severity, due date, value, creation, then id', () => {
    const ordered = orderBoardItems([
      row('low-old', { severity: 'LOW', createdAt: '2026-10-01T00:00:00.000Z' }),
      row('high-late', { severity: 'HIGH', dueAt: '2026-11-05T00:00:00.000Z' }),
      row('high-early', { severity: 'HIGH', dueAt: '2026-11-01T00:00:00.000Z' }),
      row('critical', { severity: 'CRITICAL' }),
      row('high-null-due-big', { severity: 'HIGH', valueUsd: 900 }),
      row('high-null-due-small', { severity: 'HIGH', valueUsd: 100 }),
      row('high-null-due-none', { severity: 'HIGH' }),
    ])

    expect(ordered.map(item => item.id)).toEqual([
      'critical',
      'high-early',
      'high-late',
      'high-null-due-big',
      'high-null-due-small',
      'high-null-due-none',
      'low-old',
    ])
  })

  it('W-04 · the tuple stays total when creation instants tie across severities', () => {
    const createdAt = '2026-10-01T00:00:00.000Z'
    const ordered = orderBoardItems([
      row('b-high', { severity: 'HIGH', createdAt }),
      row('z-critical', { severity: 'CRITICAL', createdAt }),
      row('a-medium', { severity: 'MEDIUM', createdAt }),
    ])

    expect(ordered.map(item => item.id)).toEqual(['z-critical', 'b-high', 'a-medium'])
    for (const [index, left] of ordered.entries()) {
      const right = ordered[index + 1]
      if (right === undefined) continue
      expect(compareBoardOrder(left, right)).toBeLessThan(0)
      expect(compareBoardOrder(right, left)).toBeGreaterThan(0)
    }
  })

  it('W-05 · an unclassified item sorts before any CRITICAL', () => {
    const critical = row('critical', { severity: 'CRITICAL' })
    const unclassified = row('unclassified', { severity: null })

    expect(priorityRank(unclassified)).toBe(PRIORITY_UNCLASSIFIED)
    expect(priorityRank(critical)).toBe(4)
    expect(orderBoardItems([critical, unclassified]).map(item => item.id)).toEqual(['unclassified', 'critical'])
  })

  it('W-05 · a space-less CRITICAL sorts before a HIGH with a space', () => {
    const spaceLess = row('space-less-critical', { severity: 'CRITICAL', spaceId: null })
    const withSpace = row('high-with-space', { severity: 'HIGH' })

    expect(priorityRank(spaceLess)).toBe(PRIORITY_UNCLASSIFIED)
    expect(orderBoardItems([withSpace, spaceLess]).map(item => item.id)).toEqual(['space-less-critical', 'high-with-space'])
  })

  it('W-06 · groups follow the tuple of their first item, including unclassified groups', () => {
    const groups = [
      {
        spaceId: 'sp-a',
        items: [row('a-low', { severity: 'LOW', spaceId: 'sp-a' }), row('a-critical', { severity: 'CRITICAL', spaceId: 'sp-a' })],
      },
      { spaceId: 'sp-b', items: [row('b-unclassified', { severity: null, spaceId: 'sp-b' })] },
      { spaceId: 'sp-c', items: [row('c-high', { severity: 'HIGH', spaceId: 'sp-c' })] },
      { spaceId: null, items: [row('no-space-medium', { severity: 'MEDIUM', spaceId: null })] },
    ]

    const ordered = orderBoardGroups(groups)
    expect(ordered.map(group => group.spaceId)).toEqual(['sp-b', null, 'sp-a', 'sp-c'])
    expect(ordered[2]?.items.map(item => item.id)).toEqual(['a-critical', 'a-low'])
  })

  it('W-06 · groups with no items sort last, by space id', () => {
    const ordered = orderBoardGroups([
      { spaceId: 'sp-z', items: [] },
      { spaceId: 'sp-filled', items: [row('filled', { severity: 'LOW', spaceId: 'sp-filled' })] },
      { spaceId: 'sp-a', items: [] },
    ])

    expect(ordered.map(group => group.spaceId)).toEqual(['sp-filled', 'sp-a', 'sp-z'])
  })

  it('W-04 · null due dates and USD values sort last from either side', () => {
    const due = row('due', { dueAt: '2026-10-28T00:00:00.000Z' })
    const noDue = row('no-due')
    expect(compareBoardOrder(due, noDue)).toBeLessThan(0)
    expect(compareBoardOrder(noDue, due)).toBeGreaterThan(0)

    const valued = row('valued', { valueUsd: 10 })
    const unvalued = row('unvalued')
    expect(compareBoardOrder(valued, unvalued)).toBeLessThan(0)
    expect(compareBoardOrder(unvalued, valued)).toBeGreaterThan(0)
    expect(compareBoardOrder(row('small', { valueUsd: 10 }), row('big', { valueUsd: 900 }))).toBeGreaterThan(0)

    const notFinite = row('not-finite', { valueUsd: Number.NaN })
    expect(compareBoardOrder(valued, notFinite)).toBeLessThan(0)
    expect(compareBoardOrder(notFinite, valued)).toBeGreaterThan(0)
  })

  it('W-04 · creation instant and id break the remaining ties', () => {
    const early = row('early', { severity: 'MEDIUM', createdAt: '2026-10-01T00:00:00.000Z' })
    const late = row('late', { severity: 'MEDIUM', createdAt: '2026-10-02T00:00:00.000Z' })

    expect(compareBoardOrder(early, late)).toBeLessThan(0)
    expect(compareBoardOrder(late, early)).toBeGreaterThan(0)
    expect(compareBoardOrder(row('a', { createdAt: early.createdAt }), row('b', { createdAt: early.createdAt }))).toBeLessThan(0)
  })

  it('W-04 · list returns the canonical order for the actor', async () => {
    const harness = await bootBoard()
    const { board } = harness
    // A space keeps every item on the severity leg of the tuple; without one all
    // items rank 5 by design (W-05).
    const spaceId = await seedSpace(harness, ACTOR_A, 'Eguisa')
    const submitted = { runId: 'run-order', evidence: ['oc:505288'], artifactType: 'proforma', spaceId }
    const critical = await board.submit(ACTOR_A, {
      ...submitted, idempotencyKey: 'idem-c', businessKey: 'bkey-c', summary: 'crítico', severity: 'CRITICAL',
    })
    const unclassified = await board.submit(ACTOR_A, {
      ...submitted, idempotencyKey: 'idem-u', businessKey: 'bkey-u', summary: 'sin clasificar',
    })
    const low = await board.submit(ACTOR_A, {
      ...submitted, idempotencyKey: 'idem-l', businessKey: 'bkey-l', summary: 'bajo', severity: 'LOW',
    })

    const first = (await board.list(ACTOR_A)).map(item => item.id)
    expect(first).toEqual([unclassified.id, critical.id, low.id])
    expect((await board.list(ACTOR_A)).map(item => item.id)).toEqual(first)
  })
})
