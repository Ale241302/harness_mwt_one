import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { runSpaceFromEmail, type SpaceFromEmailBound } from '../src/client/space-from-email.ts'

const CONTEXT = 'Correo recibido:\nDe: compras2@sondelsa.com\nAsunto: RE: PO 505433'

/** Boot the seed over a stub client context and capture every call it makes. */
function harness(spaceFromEmailResult: unknown) {
  const prompt = vi.fn(async () => {})
  const create = vi.fn(async () => 's1')
  const binding = vi.fn(() => ({ session: { prompt } }))
  const selectPanel = vi.fn()
  const spaceFromEmail = vi.fn(async () => spaceFromEmailResult)
  const overview = vi.fn(async () => ({ ok: true, value: {} }))
  const ctx = {
    remote: { faberloomView: { spaceFromEmail, overview } },
    sessions: { create, binding },
    layout: { selectPanel },
  } as unknown as ClientContext
  const setError = vi.fn()
  const bound: SpaceFromEmailBound = { setError }
  const refresh = vi.fn()
  runSpaceFromEmail(ctx, bound, refresh, {
    uid: '12', name: 'RE: PO 505433', agentId: null, from: 'compras2@sondelsa.com',
  })
  return { create, binding, prompt, selectPanel, spaceFromEmail, refresh, setError }
}

/** Let the seed's promise chain settle: one turn is enough, two is safe. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('space from email seed', () => {
  it('creates the workspace session and sends the email as its first message', async () => {
    const bench = harness({
      ok: true, value: { spaceId: 'sp1', workspaceId: 'ws-1', context: CONTEXT },
    })
    await vi.waitFor(() => { expect(bench.prompt).toHaveBeenCalledOnce() })
    expect(bench.spaceFromEmail).toHaveBeenCalledWith('12', 'RE: PO 505433', undefined, 'compras2@sondelsa.com')
    expect(bench.refresh).toHaveBeenCalledOnce()
    expect(bench.create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(bench.binding).toHaveBeenCalledWith('s1')
    expect(bench.prompt).toHaveBeenCalledWith([{ type: 'text', text: CONTEXT }], 'queue')
    expect(bench.selectPanel).toHaveBeenCalledWith(null)
    expect(bench.setError).not.toHaveBeenCalled()
  })

  it('creates no session when the space registers no workspace', async () => {
    const bench = harness({
      ok: true, value: { spaceId: 'sp1', workspaceId: null, context: CONTEXT },
    })
    await settle()
    expect(bench.spaceFromEmail).toHaveBeenCalledOnce()
    expect(bench.refresh).toHaveBeenCalledOnce()
    expect(bench.create).not.toHaveBeenCalled()
    expect(bench.binding).not.toHaveBeenCalled()
    expect(bench.prompt).not.toHaveBeenCalled()
    expect(bench.selectPanel).not.toHaveBeenCalled()
  })

  it('publishes the failure and opens nothing when the read fails', async () => {
    const bench = harness({ ok: false, error: { code: 'faberloom/read', message: 'buzón no disponible' } })
    await settle()
    expect(bench.setError).toHaveBeenCalledWith('buzón no disponible')
    expect(bench.refresh).not.toHaveBeenCalled()
    expect(bench.create).not.toHaveBeenCalled()
    expect(bench.selectPanel).not.toHaveBeenCalled()
  })
})
