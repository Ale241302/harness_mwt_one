/** The view's human teaching path: proposal, exact-version approval, health, and voice. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'

/** One durable teaching-shaped record the panel rows can read. */
function teaching(extra: Record<string, unknown> = {}) {
  return {
    id: 't-1', ownerId: OWNER, scope: 'space', spaceId: 'sp-1', agentId: null, skill: null, task: 'email',
    text: 'Cerrar con «Quedo atento».', source: 'panel', author: OWNER, status: 'candidate', version: 1,
    supersedes: null, uses: [], createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z', ...extra,
  }
}

/** Boot the view with the memory, connection, and model surfaces these remotes touch. */
function harness(memory: Record<string, unknown>, readOnly = false) {
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
    stream: async function* () {
      yield { type: 'text-delta', text: 'Quedo atento.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const drafts = new Map<string, Record<string, unknown>>()
  const connections = {
    saveDraft: vi.fn(async (_owner: string, input: { id?: string; text: string }) => {
      const draft = {
        id: input.id ?? 'd-1', to: [], cc: [], bcc: [], subject: 'Hola', text: input.text, status: 'draft', aiText: input.text,
        account: null, attachments: [], references: [], revision: 'rev-1',
        inReplyTo: null, spaceId: null, originUid: null, originReason: null, originMailbox: null, agentSessionId: null,
        createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z', sentAt: null,
      }
      drafts.set(draft.id, draft)
      return draft
    }),
    bindDraftSession: vi.fn(async (_owner: string, id: string, sessionId: string) => {
      const draft = { ...drafts.get(id), agentSessionId: sessionId }
      drafts.set(id, draft)
      return draft
    }),
    recordDraftRevision: vi.fn(async () => ({ revision: 1 })),
    signatureFor: vi.fn(async () => null),
    listDrafts: vi.fn(async () => [...drafts.values()]),
  }
  const agents = {
    create: vi.fn(async (input: { sessionId: string }) => {
      const events: { type: string; data: unknown }[] = []
      const agent = {
        ctx: { tools: { restrict: vi.fn(), guard: vi.fn() } },
        session: { id: input.sessionId, seq: 0, snapshotEvents: () => events },
        followup: vi.fn(() => {
          events.push(
            { type: 'assistant/message', data: { step: 1, message: { content: [{ type: 'text', text: 'Quedo atento.' }] } } },
            { type: 'turn/end', data: { reason: { kind: 'completed' } } },
          )
        }),
        inject: vi.fn(),
        whenIdle: vi.fn(async () => {}),
      }
      return { agent, dispose: vi.fn(async () => {}) }
    }),
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomMemory') return memory
      if (name === 'faberloomConnections') return connections
      if (name === 'agents') return agents
      if (name === 'llm') return llm
      return undefined
    },
    faberloomMemory: memory,
    faberloomConnections: connections,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly })
}

describe('FaberLoomViewService teaching activation', () => {
  it('records a proposal and approves the exact version in one human gesture', async () => {
    const created = teaching()
    const createTeaching = vi.fn(async () => created)
    const activateTeaching = vi.fn(async () => ({ ...created, status: 'active' }))
    const memory = {
      createTeaching, activateTeaching,
      listTeachings: vi.fn(async () => [created]),
      teachingHealth: vi.fn(async () => ({ candidates: 0, active: 1, revoked: 0, captureFailures: 0, lastCaptureFailure: null })),
    }
    const view = harness(memory)
    await view.saveTeaching({ scope: 'space', spaceId: 'sp-1', text: created.text, source: 'panel', activate: true })
    expect(createTeaching).toHaveBeenCalledWith(OWNER, expect.objectContaining({ text: created.text, author: OWNER }))
    expect(activateTeaching).toHaveBeenCalledWith(OWNER, created.id, expect.objectContaining({
      approvedBy: OWNER, proposalVersion: 1, approvalRef: expect.stringMatching(/^panel:teachings:/u),
    }))
  })

  it('leaves a proposal unapproved when the gesture does not approve it', async () => {
    const created = teaching()
    const createTeaching = vi.fn(async () => created)
    const activateTeaching = vi.fn()
    const view = harness({ createTeaching, activateTeaching, listTeachings: vi.fn(async () => [created]) })
    await view.saveTeaching({ scope: 'space', text: created.text, source: 'panel' })
    expect(activateTeaching).not.toHaveBeenCalled()
  })

  it('approves the version the person selected', async () => {
    const activateTeaching = vi.fn(async () => teaching({ status: 'active', version: 2 }))
    const view = harness({ activateTeaching, listTeachings: vi.fn(async () => []) })
    await view.activateTeaching('t-1', 2)
    expect(activateTeaching).toHaveBeenCalledWith(OWNER, 't-1', expect.objectContaining({ proposalVersion: 2, approvedBy: OWNER }))
  })

  it('reports proposals, approvals, revocations, and the latest failed capture', async () => {
    const memory = {
      teachingHealth: vi.fn(async () => ({
        candidates: 2, active: 3, revoked: 1, captureFailures: 4,
        lastCaptureFailure: { id: 'f-1', task: 'email', source: 'email', detail: 'disk full', at: '2026-11-18T11:00:00.000Z' },
      })),
    }
    const view = harness(memory)
    await expect(view.teachingHealth()).resolves.toEqual({
      candidates: 2, active: 3, revoked: 1, captureFailures: 4,
      lastCaptureFailure: { id: 'f-1', task: 'email', source: 'email', detail: 'disk full', at: '2026-11-18T11:00:00.000Z' },
    })
  })

  it('refuses activation from a read-only identity', async () => {
    const view = harness({ activateTeaching: vi.fn() }, true)
    await expect(view.activateTeaching('t-1', 1)).rejects.toThrow('read-only')
  })

  it('builds the writing voice from approved lessons only, never from proposals or revocations', async () => {
    const retrieved = teaching({ status: 'active' })
    const retrieve = vi.fn(async () => [retrieved])
    const listTeachings = vi.fn(async () => [teaching(), teaching({ id: 't-2', status: 'revoked' })])
    const view = harness({ retrieve, listTeachings, teachingHealth: vi.fn() })
    await view.emailVoice()
    await view.emailDraftWithAi({ to: ['cliente@eguisa.com'], subject: 'Hola', instruction: 'Confirmar' })
    expect(retrieve).toHaveBeenCalledWith(OWNER, expect.objectContaining({ task: 'email' }))
    expect(listTeachings).not.toHaveBeenCalled()
  })
})
