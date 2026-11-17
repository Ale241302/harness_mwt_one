/**
 * O5-02C · the assignment gesture: remembering records one account rule, not
 * remembering records none, and the label reads the rule's origin. Nothing here
 * moves mail or grants Space access.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** The minimal service graph the board detail and the assignment gesture touch. */
function harness(options: {
  readonly item?: Record<string, unknown>
  readonly rules?: readonly Record<string, unknown>[]
  readonly evaluate?: Record<string, unknown>
} = {}) {
  const item = options.item ?? {
    id: 'item-1', ownerId: OWNER, title: 'OC 4711', status: 'PREPARADO', state: 'PREPARADO', column: 'PREPARADO',
    version: 1, rowVersion: 3, severity: null, routineId: null, spaceId: 'sp-1', accountRef: 'cuenta-a',
    assigneeId: null, actionType: 'mail.send', artifactType: 'task', dueAt: null, valueUsd: null,
    dataClass: 'internal', hasCandidate: false, hasDraft: false, origin: null, revisions: [],
  }
  const board = {
    list: vi.fn(async () => [item]),
    assignAgent: vi.fn(async () => undefined),
  }
  const assignment = {
    listRules: vi.fn(async () => options.rules ?? []),
    createRule: vi.fn(async (_owner: string, input: unknown) => ({ id: 'rule-1', ...input as object })),
    revokeRule: vi.fn(async (_owner: string, id: string) => ({ id, revokedAt: '2026-11-17T10:00:00Z' })),
    evaluate: vi.fn(async () => options.evaluate ?? { status: 'none', target: null, matches: [], conflicts: [] }),
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomAssignment') return assignment
      return undefined
    },
    faberloomBoard: board,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false })
  vi.spyOn(view, 'boardDetail').mockResolvedValue(undefined)
  return { view, board, assignment }
}

describe('O5-02C · assignment gesture', () => {
  it('records one account rule when the person asks to remember', async () => {
    const { view, board, assignment } = await harness()

    await view.boardAssignAgent('item-1', 'agent-9', 3, true)

    expect(board.assignAgent).toHaveBeenCalledWith(expect.anything(), 'item-1', 'agent-9', 3)
    expect(assignment.createRule).toHaveBeenCalledWith(OWNER, {
      criterion: { field: 'account', operator: 'equals', value: 'cuenta-a' },
      target: { spaceId: 'sp-1', agentId: 'agent-9' },
      kind: 'human',
      itemId: 'item-1',
    })
  })

  it('records no rule when the box is unchecked', async () => {
    const { view, board, assignment } = await harness()

    await view.boardAssignAgent('item-1', 'agent-9', 3, false)

    expect(board.assignAgent).toHaveBeenCalled()
    expect(assignment.createRule).not.toHaveBeenCalled()
  })

  it('reuses an active rule for the same account, space and agent', async () => {
    const { view, assignment } = await harness({
      rules: [{
        id: 'rule-1', revokedAt: null,
        criterion: { field: 'account', operator: 'equals', value: 'cuenta-a' },
        target: { spaceId: 'sp-1', agentId: 'agent-9' },
        origin: { kind: 'human', by: OWNER, at: '2026-11-17T09:00:00Z', itemId: 'item-1' },
        version: 1,
      }],
    })

    await view.boardAssignAgent('item-1', 'agent-9', 3, true)

    expect(assignment.createRule).not.toHaveBeenCalled()
  })

  it('explains the decision with the rule origin the label shows', async () => {
    const { view } = await harness({
      rules: [{
        id: 'rule-1', revokedAt: null,
        criterion: { field: 'account', operator: 'equals', value: 'cuenta-a' },
        target: { spaceId: 'sp-1', agentId: 'agent-9' },
        origin: { kind: 'human', by: OWNER, at: '2026-11-17T09:00:00Z', itemId: 'item-1' },
        version: 2,
      }],
      evaluate: {
        status: 'assigned',
        target: { spaceId: 'sp-1', agentId: 'agent-9' },
        matches: [{ ruleId: 'rule-1', version: 2, target: { spaceId: 'sp-1', agentId: 'agent-9' } }],
        conflicts: [],
      },
    })

    const explained = await view.assignmentFor('item-1')

    expect(explained?.status).toBe('assigned')
    expect(explained?.matches[0]).toMatchObject({
      ruleId: 'rule-1',
      version: 2,
      origin: { kind: 'human', by: OWNER, itemId: 'item-1' },
    })
  })

  it('revokes through the service so classification stops', async () => {
    const { view, assignment } = await harness()
    await view.revokeAssignmentRule('rule-1')
    expect(assignment.revokeRule).toHaveBeenCalledWith(OWNER, 'rule-1')
  })
})
