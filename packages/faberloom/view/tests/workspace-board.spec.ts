import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** The minimal service graph the workspace and board remotes touch. */
function harness(options: { readOnly?: boolean } = {}) {
  const board = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: 'b1', version: 3 })),
    create: vi.fn(),
    submitRevision: vi.fn(async () => ({})),
    requestData: vi.fn(async () => ({})),
    fail: vi.fn(async () => ({})),
    complete: vi.fn(async () => ({})),
    review: vi.fn(async () => ({})),
    reopen: vi.fn(async () => ({})),
  }
  const entities: { id: string; path: string; title: string; sessionIds: string[] }[] = []
  const registry = {
    list: () => entities,
    create: vi.fn(async (dir: string, title?: string) => {
      const entity = { id: 'ws-1', path: dir, title: title ?? dir, sessionIds: [] as string[] }
      entities.push(entity)
      return entity
    }),
  }
  const spaces = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: 'sp1', title: 'Eguisa' })),
    resolveWorkdir: vi.fn(async () => ({ kind: 'opaque', ref: 'fw_abc123' })),
  }
  const ctx = {
    faberloomSpaces: spaces,
    faberloomAgents: { listAgents: vi.fn(async () => []) },
    faberloomBoard: board,
    faberloomRoutines: { listRoutines: vi.fn(async () => []) },
    provide: () => {},
    reflect: { provide: () => {} },
    get: (name: string) => (name === 'workspaceRegistry' ? registry : undefined),
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com',
    role: 'admin',
    readOnly: options.readOnly === true,
  })
  return { view, board, registry, spaces, entities }
}

describe('FaberLoomViewService space workspace', () => {
  it('reads an unregistered area without creating it, then opens it titled after the space', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-ws-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, entities } = harness()

    const before = await view.spaceWorkspace('sp1')
    expect(before).toEqual({ registered: false, workspaceId: null, title: null, sessions: 0 })
    expect(entities).toHaveLength(0)

    const opened = await view.openSpaceWorkspace('sp1')
    expect(opened).toMatchObject({ registered: true, workspaceId: 'ws-1', title: 'Eguisa', sessions: 0 })
    expect(existsSync(join(home, 'spaces', 'fw_abc123'))).toBe(true)

    const after = await view.spaceWorkspace('sp1')
    expect(after).toMatchObject({ registered: true, workspaceId: 'ws-1', title: 'Eguisa' })
  })
})

describe('FaberLoomViewService board actions', () => {
  it('submits a revision, moves exceptions, and reviews with a note', async () => {
    const { view, board } = harness()
    await view.submitBoardRevision('b1', { summary: 'proforma lista', evidence: ['doc-1'] })
    expect(board.submitRevision).toHaveBeenCalledWith('owner@muitowork.com', 'b1', { summary: 'proforma lista', evidence: ['doc-1'] })

    await view.boardException('b1', 'request_data')
    expect(board.requestData).toHaveBeenCalledWith('owner@muitowork.com', 'b1')
    await view.boardException('b1', 'fail')
    expect(board.fail).toHaveBeenCalledWith('owner@muitowork.com', 'b1')
    await view.boardException('b1', 'complete')
    expect(board.complete).toHaveBeenCalledWith('owner@muitowork.com', 'b1')

    await view.reviewBoardItem('b1', true, 'revisado contra MWT')
    expect(board.review).toHaveBeenCalledWith('owner@muitowork.com', 'b1', { decision: 'approve', version: 3, note: 'revisado contra MWT' })
    await view.reviewBoardItem('b1', false)
    expect(board.review).toHaveBeenLastCalledWith('owner@muitowork.com', 'b1', { decision: 'reject', version: 3 })
  })

  it('refuses every board write for a read-only identity', async () => {
    const { view, board } = harness({ readOnly: true })
    await expect(view.submitBoardRevision('b1', { summary: 's', evidence: ['e'] })).rejects.toThrow('read-only')
    await expect(view.boardException('b1', 'fail')).rejects.toThrow('read-only')
    await expect(view.reviewBoardItem('b1', true)).rejects.toThrow('read-only')
    expect(board.submitRevision).not.toHaveBeenCalled()
    expect(board.review).not.toHaveBeenCalled()
  })
})
