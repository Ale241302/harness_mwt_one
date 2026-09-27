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

  it('reports a failed session create to the store', async () => {
    const { ctx } = fakeCtx()
    ;(ctx.sessions.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const bound = { setError: vi.fn() }

    runTaskChat(ctx, bound, { kind: 'board', title: 'x', detail: '' })

    await vi.waitFor(() => { expect(bound.setError).toHaveBeenCalledWith('task chat failed') })
  })
})
