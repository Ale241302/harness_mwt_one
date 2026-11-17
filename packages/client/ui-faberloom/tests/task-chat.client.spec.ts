// @vitest-environment jsdom
/** The work-bench "open chat" gesture seeds a session with the task's context. */
import type { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runTaskChat, taskChatOriginKey } from '../src/client/task-chat.ts'

/** A ctx whose session/layout seats record what the gesture did. */
function fakeCtx() {
  const prompt = vi.fn(async () => {})
  const live = new Set<string>()
  let count = 0
  const create = vi.fn(async () => {
    count += 1
    const id = `session-${String(count)}`
    live.add(id)
    return id
  })
  const binding = vi.fn((id: string) => live.has(id) ? { session: { prompt } } : undefined)
  const open = vi.fn()
  const selectPanel = vi.fn()
  const attach = vi.fn(async () => {})
  const ctx = {
    sessions: { create, binding, open },
    layout: { selectPanel },
    remote: { faberloomView: { boardAttachIterationChat: attach } },
    get: (name: string) => (name === 'remote.faberloomView' ? ctx.remote.faberloomView : undefined),
  } as unknown as Context
  return { ctx, create, prompt, open, selectPanel, attach, live }
}

beforeEach(() => { window.localStorage.clear() })

describe('runTaskChat', () => {
  it.each(['board', 'draft', 'inbox'])('seeds a %s task and opens the session', async (kind) => {
    const { ctx, create, prompt, open, selectPanel } = fakeCtx()
    const bound = { setError: vi.fn() }

    runTaskChat(ctx, bound, { kind, title: 'Preparar proforma', detail: 'waiting_approval' })

    await vi.waitFor(() => { expect(open).toHaveBeenCalledWith('session-1') })
    expect(create).toHaveBeenCalledWith({})
    expect(prompt).toHaveBeenCalledOnce()
    const [content] = prompt.mock.calls[0] as unknown as [readonly { type: string; text: string }[]]
    expect((content[0]?.text ?? '').length).toBeGreaterThan(0)
    expect(content[0]?.text).toContain('grill-me-lite')
    if (kind !== 'mwt') expect(content[0]?.text).toContain('Preparar proforma')
    expect(selectPanel).toHaveBeenCalledWith(null)
    expect(bound.setError).not.toHaveBeenCalled()
  })

  it('names the agent the owner assigned to the task', async () => {
    const { ctx, prompt } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'inbox', title: 'OC 1', detail: 'De: x', agentName: 'Compras' })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    const [content] = prompt.mock.calls[0] as unknown as [readonly { text: string }[]]
    expect(content[0]?.text).toContain('Compras')
  })

  /** The pinned context one iteration chat is seeded with, as the view projects it. */
  const PINNED = {
    itemId: 'b1',
    title: 'PF 9001-2026',
    accountRef: 'Cuenta Demo',
    spaceId: 'sp-1',
    spaceTitle: 'Marluvas',
    version: 3,
    summary: 'Proforma DDP 100 pares' as string | null,
    draftSummary: 'Precio revisado' as string | null,
    rounds: 2,
    iterationId: 'iter-1',
    generation: 4,
    holderSession: 'tab-1',
    baseVersion: 3,
  }

  it('seeds an iteration chat with the pinned summary and unfinished work', async () => {
    const { ctx, prompt } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'iteration', title: 'PF 9001-2026', detail: 'v3', iteration: PINNED })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    const [content] = prompt.mock.calls[0] as unknown as [readonly { text: string }[]]
    expect(content[0]?.text).toContain('Resumen vigente: Proforma DDP 100 pares')
    expect(content[0]?.text).toContain('Trabajo sin terminar: Precio revisado')
  })

  it('names content the provider may not receive instead of sending it', async () => {
    const { ctx, prompt } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, {
      kind: 'iteration',
      title: 'PF 9001-2026',
      detail: 'v3',
      iteration: { ...PINNED, summary: null, draftSummary: null },
    })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    const [content] = prompt.mock.calls[0] as unknown as [readonly { text: string }[]]
    expect(content[0]?.text).not.toContain('Resumen vigente')
    expect(content[0]?.text).not.toContain('Precio revisado')
    expect(content[0]?.text).toContain('no se carga en este proveedor')
  })

  it('attaches an iteration chat to the exact attempt it works', async () => {
    const { ctx, attach } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'iteration', title: 'PF 9001-2026', detail: 'v3', iteration: PINNED })
    await vi.waitFor(() => { expect(attach).toHaveBeenCalledWith('b1', 'session-1') })
  })

  it('leaves a chat that works no attempt unattached', async () => {
    const { ctx, attach, prompt } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'board', title: 'Preparar', detail: 'waiting' })
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    expect(attach).not.toHaveBeenCalled()
  })
  it('reports a failed session create to the store', async () => {
    const { ctx } = fakeCtx()
    ;(ctx.sessions.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const bound = { setError: vi.fn() }

    runTaskChat(ctx, bound, { kind: 'board', title: 'x', detail: '' })

    await vi.waitFor(() => { expect(bound.setError).toHaveBeenCalledWith('task chat failed') })
  })

  it('reopens the same conversation for the same attempt instead of creating another', async () => {
    const { ctx, create, open, prompt } = fakeCtx()
    const input = { kind: 'iteration', title: 'PF 9001-2026', detail: 'v3', iteration: PINNED }

    runTaskChat(ctx, { setError: vi.fn() }, input)
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    runTaskChat(ctx, { setError: vi.fn() }, input)

    await vi.waitFor(() => { expect(open).toHaveBeenCalledTimes(2) })
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(taskChatOriginKey(input) ?? '')).toBe('session-1')
  })

  it('keeps a separate conversation for each attempt of the same item', async () => {
    const { ctx, create, open } = fakeCtx()

    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'iteration', title: 'PF', detail: 'v1', iteration: { ...PINNED, iterationId: 'iter-1' } })
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'iteration', title: 'PF', detail: 'v2', iteration: { ...PINNED, iterationId: 'iter-2' } })

    await vi.waitFor(() => { expect(open).toHaveBeenCalledTimes(2) })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('repairs a stale binding after a restart or a lost link', async () => {
    const { ctx, create, open } = fakeCtx()
    const input = { kind: 'iteration', title: 'PF', detail: 'v3', iteration: PINNED }
    const key = taskChatOriginKey(input) ?? ''
    window.localStorage.setItem(key, 'session-gone')

    runTaskChat(ctx, { setError: vi.fn() }, input)

    await vi.waitFor(() => { expect(open).toHaveBeenCalledWith('session-1') })
    expect(create).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(key)).toBe('session-1')
  })

  it('creates a new conversation when the task has no stable origin', async () => {
    const { ctx, create } = fakeCtx()
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'board', title: 'x', detail: '' })
    runTaskChat(ctx, { setError: vi.fn() }, { kind: 'board', title: 'x', detail: '' })
    await vi.waitFor(() => { expect(create).toHaveBeenCalledTimes(2) })
  })
})
