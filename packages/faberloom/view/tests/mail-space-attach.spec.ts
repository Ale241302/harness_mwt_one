import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'
// The Space area must exist: adopting or opening a Space refuses a folder the
// process cannot read.
const SPACE_ROOT = mkdtempSync(join(tmpdir(), 'faberloom-mail-space-'))
const SPACE_PATH = join(SPACE_ROOT, 'contabilidad')
mkdirSync(SPACE_PATH, { recursive: true })

afterAll(() => { rmSync(SPACE_ROOT, { recursive: true, force: true }) })

/** One draft row the fake connections store hands back. */
function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    to: ['cliente@example.com'],
    cc: [] as string[],
    bcc: [] as string[],
    subject: 'Pago de la tarjeta',
    text: 'Queda pagado.',
    account: null,
    attachments: [] as { name: string; mediaType: string; size: number }[],
    revision: 'rev-1',
    references: [] as string[],
    status: 'draft',
    aiText: null,
    inReplyTo: null,
    spaceId: null,
    originUid: '42',
    originMailbox: null,
    originReason: null,
    agentSessionId: 'draft-session',
    createdAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    sentAt: null,
    ...overrides,
  }
}

/** Boot the view over fake spaces, workspace, history, agents, and drafts. */
function harness(options: { cwd?: string; draft?: boolean } = {}) {
  const workspace = {
    id: 'w1',
    path: SPACE_PATH,
    title: 'Contabilidad',
    sessionIds: [] as string[],
    attachSession: vi.fn(async (id: string) => {
      if (!workspace.sessionIds.includes(id)) workspace.sessionIds.unshift(id)
    }),
  }
  const space = { id: 'sp1', ownerId: OWNER, title: 'Contabilidad', parentId: null, workspaceId: 'w1' }
  const spaces = {
    get: vi.fn(async () => space),
    list: vi.fn(async () => [space]),
    canManage: vi.fn(async () => true),
    create: vi.fn(async () => space),
    update: vi.fn(async () => space),
    remember: vi.fn(async () => ({})),
    attachFile: vi.fn(async () => ({})),
  }
  const inbound = {
    readEmail: vi.fn(async () => ({
      account: null,
      text: 'Pago de la tarjeta',
      html: null,
      attachments: [{ name: 'voucher.pdf', mediaType: 'application/pdf', size: 3, contentBase64: 'AA==' }],
    })),
  }
  let stored = draftRow()
  const connections = {
    listDrafts: vi.fn(async () => options.draft === true ? [stored] : []),
    getDraft: vi.fn(async () => options.draft === true ? stored : null),
    updateDraftAndRecord: vi.fn(async (
      _owner: string, _id: string, _revision: string, input: Record<string, unknown>,
    ) => {
      stored = { ...stored, ...input, revision: 'rev-2' }
      return { draft: stored, revision: { revision: 2 } }
    }),
    bindDraftSession: vi.fn(async (
      _owner: string, _id: string, sessionId: string, expectedSessionId: string | null,
    ) => {
      expect(stored.agentSessionId).toBe(expectedSessionId)
      stored = { ...stored, agentSessionId: sessionId }
      return stored
    }),
  }
  const history = {
    session: { id: 's1', cwd: options.cwd ?? 'C:\\global' },
    inheritedEventCount: 0,
    events: [
      { type: 'user/message', data: { message: { content: [{ type: 'text', text: '¿Qué pide el correo?' }] } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Que cierres el pago.' }] } } },
    ],
  }
  const sessionQuery = { readSession: vi.fn(async () => history) }
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
  }
  const agents = {
    create: vi.fn(async (input: { sessionId: string; meta: { cwd: string } }) => ({
      agent: {
        ctx: { tools: { restrict: vi.fn(), guard: vi.fn() } },
        session: { id: input.sessionId, seq: 0, snapshotEvents: () => [] },
        inject: vi.fn(),
        followup: vi.fn(),
        whenIdle: vi.fn(async () => {}),
      },
      dispose: vi.fn(async () => {}),
    })),
  }
  const registry = {
    get: vi.fn(() => workspace),
    list: vi.fn(() => [workspace]),
    create: vi.fn(async () => workspace),
  }
  const ctx = {
    reflect: { provide: () => {} },
    provide: () => {},
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    faberloomSpaces: spaces,
    faberloomInbound: inbound,
    faberloomConnections: connections,
    get: (name: string) => {
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomConnections') return connections
      if (name === 'faberloomSpaces') return spaces
      if (name === 'workspaceRegistry') return registry
      if (name === 'sessionQuery') return sessionQuery
      if (name === 'agents') return agents
      if (name === 'llm') return llm
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false })
  return { view, spaces, workspace, connections, sessionQuery, agents }
}

describe('attachMailToSpace moves the live conversation', () => {
  it('attaches a session already living in the Space workspace without re-creating it', async () => {
    const { view, workspace, agents } = harness({ cwd: SPACE_PATH })

    const attached = await view.attachMailToSpace('42', 'sp1', 'Contabilidad', 's1', 'Pago de la tarjeta')

    expect(workspace.attachSession).toHaveBeenCalledWith('s1')
    expect(agents.create).not.toHaveBeenCalled()
    expect(attached).toMatchObject({ sessionId: 's1', transferred: false, spaceId: 'sp1', workspaceId: 'w1' })
  })

  it('re-creates a different-cwd session inside the Space and returns the continuation', async () => {
    const { view, workspace, agents, sessionQuery } = harness({ cwd: 'C:\\global' })

    const attached = await view.attachMailToSpace('42', 'sp1', 'Contabilidad', 's1', 'Pago de la tarjeta')

    expect(sessionQuery.readSession).toHaveBeenCalledWith('s1')
    expect(agents.create).toHaveBeenCalledTimes(1)
    expect(agents.create.mock.calls[0]?.[0].meta.cwd).toBe(SPACE_PATH)
    const continuation = attached.sessionId ?? ''
    expect(continuation).toMatch(/^faberloom-mail-/u)
    expect(continuation).not.toBe('s1')
    expect(workspace.attachSession).toHaveBeenCalledWith(continuation)
    expect(workspace.attachSession).not.toHaveBeenCalledWith('s1')
    expect(attached.transferred).toBe(true)
  })

  it('reports no conversation when the card carried none', async () => {
    const { view, workspace } = harness()

    const attached = await view.attachMailToSpace('42', 'sp1', 'Contabilidad')

    expect(workspace.attachSession).not.toHaveBeenCalled()
    expect(attached).toMatchObject({ sessionId: null, transferred: false })
  })

  it('moves a draft conversation through the draft so its binding survives', async () => {
    const { view, workspace, spaces, connections, agents } = harness({ draft: true })

    const attached = await view.attachMailToSpace('42', 'sp1', 'Contabilidad', 'draft-session', 'Pago')

    expect(connections.updateDraftAndRecord).toHaveBeenCalledWith(
      OWNER, 'd1', 'rev-1', expect.objectContaining({ spaceId: 'sp1' }),
      expect.objectContaining({ source: 'human' }),
    )
    expect(connections.bindDraftSession).toHaveBeenCalledWith(
      OWNER, 'd1', expect.stringMatching(/^faberloom-mail-/u), 'draft-session', 'rev-2',
    )
    const continuation = attached.sessionId ?? ''
    expect(continuation).toMatch(/^faberloom-mail-/u)
    expect(workspace.attachSession).toHaveBeenCalledWith(continuation)
    expect(agents.create).toHaveBeenCalledTimes(1)
    expect(attached.transferred).toBe(true)
    // The draft already copies the originating mail, so its body is not stored twice.
    expect(spaces.remember).toHaveBeenCalledTimes(1)
  })
})
