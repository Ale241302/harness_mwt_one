/** The work-bench "open chat" gesture seeds a session with the task's context. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { runTaskChat } from '../src/client/task-chat.ts'

/** A ctx whose session/layout seats record what the gesture did. */
function fakeCtx() {
  const prompt = vi.fn(async () => {})
  const create = vi.fn(async () => 'session-1')
  const open = vi.fn()
  const selectPanel = vi.fn()
  const ctx = {
    sessions: { create, binding: vi.fn(() => ({ session: { prompt } })), open },
    layout: { selectPanel },
  } as unknown as Context
  return { ctx, create, prompt, open, selectPanel }
}

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

  it('reports a failed session create to the store', async () => {
    const { ctx } = fakeCtx()
    ;(ctx.sessions.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const bound = { setError: vi.fn() }

    runTaskChat(ctx, bound, { kind: 'board', title: 'x', detail: '' })

    await vi.waitFor(() => { expect(bound.setError).toHaveBeenCalledWith('task chat failed') })
  })
})
