// @vitest-environment jsdom
/** Draft conversations open only the Host-owned restricted Session and retain it through client setup. */
import { describe, expect, it, vi } from 'vitest'
import { openDraftChat } from '../src/client/draft-chat.ts'

const DRAFT = {
  id: 'draft-1',
  subject: 'Respuesta OC 505433',
  revision: 'revision-1',
  spaceId: null,
}
const TITLE = 'Borrador localizado'

/** A browser context whose Session and Remote operations record their order. */
function draftChatBench() {
  const events: string[] = []
  const draft = { ...DRAFT }
  const rename = vi.fn(async (): Promise<unknown> => {
    events.push('rename')
    return { ok: true, value: { title: TITLE, seq: 1 } }
  })
  const session = { rename }
  const refresh = vi.fn(async (): Promise<void> => {
    events.push('refresh')
  })
  const binding = vi.fn((): unknown => {
    events.push('binding')
    return { session }
  })
  const openSession = vi.fn(() => { events.push('open') })
  const selectPanel = vi.fn(() => { events.push('panel') })
  const draftSessionOpen = vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: {
      draft,
      sessionId: null,
      seed: null,
      revisions: [],
      signature: null,
      spaceSuggestion: { kind: 'wait', evidence: [] },
    },
  }))
  const draftSessionStart = vi.fn(async (): Promise<unknown> => {
    events.push('start')
    return { ok: true, value: { draft: { ...draft, agentSessionId: 'session-1' }, sessionId: 'session-1' } }
  })
  const remote = { draftSessionOpen, draftSessionStart }
  const ctx = {
    sessions: { refresh, binding },
    uiWorkspace: { openSession },
    layout: { selectPanel },
    get: (name: string) => name === 'remote.faberloomView' ? remote : undefined,
  } as never
  const bound = { setError: vi.fn() }
  return { ctx, bound, events, refresh, binding, rename, openSession, selectPanel, draftSessionOpen, draftSessionStart }
}

describe('openDraftChat', () => {
  it('starts the Host-owned session, refreshes to its binding, renames it, then reuses it', async () => {
    const bench = draftChatBench()
    bench.draftSessionOpen.mockResolvedValueOnce({
      ok: true,
      value: { draft: DRAFT, sessionId: null, seed: null, revisions: [], signature: null, spaceSuggestion: { kind: 'wait', evidence: [] } },
    }).mockResolvedValueOnce({
      ok: true,
      value: {
        draft: { ...DRAFT, agentSessionId: 'session-1' }, sessionId: 'session-1', seed: null,
        revisions: [], signature: null, spaceSuggestion: { kind: 'linked', spaceId: 'space-1' },
      },
    })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)
    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.draftSessionStart).toHaveBeenCalledOnce()
    expect(bench.draftSessionStart).toHaveBeenCalledWith('draft-1', 'revision-1')
    expect(bench.refresh).toHaveBeenCalledOnce()
    expect(bench.binding).toHaveBeenCalledWith('session-1')
    expect(bench.rename).toHaveBeenCalledOnce()
    expect(bench.rename).toHaveBeenCalledWith(TITLE)
    expect(bench.events).toEqual(['start', 'refresh', 'binding', 'rename', 'open', 'panel', 'open', 'panel'])
    expect(bench.bound.setError).not.toHaveBeenCalled()
  })

  it('does not navigate while the Host is still preparing and binding the session', async () => {
    const bench = draftChatBench()
    const pending = Promise.withResolvers<undefined>()
    bench.draftSessionStart.mockImplementation(() => {
      bench.events.push('start:start')
      return pending.promise.then(() => {
        bench.events.push('start:end')
        return { ok: true, value: { draft: DRAFT, sessionId: 'session-1' } }
      })
    })

    const opening = openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)
    await vi.waitFor(() => { expect(bench.draftSessionStart).toHaveBeenCalledOnce() })
    expect(bench.refresh).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()

    pending.resolve(undefined)
    await opening
    expect(bench.events.indexOf('start:end')).toBeLessThan(bench.events.indexOf('refresh'))
    expect(bench.events.indexOf('rename')).toBeLessThan(bench.events.indexOf('open'))
  })

  it('reports a rejected start without creating a client session or navigating', async () => {
    const bench = draftChatBench()
    bench.draftSessionStart.mockResolvedValue({ ok: false, error: { code: 'DRAFT_CHANGED', message: 'el borrador cambió' } })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.refresh).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('el borrador cambió')
  })

  it('keeps the editor available when the Host cannot supply the Space Workspace', async () => {
    const bench = draftChatBench()
    bench.draftSessionStart.mockResolvedValue({ ok: false, error: { code: 'SPACE_WORKSPACE_UNAVAILABLE', message: 'Space sin Workspace' } })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.refresh).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('Space sin Workspace')
  })

  it('reports a rename failure without navigating', async () => {
    const bench = draftChatBench()
    bench.rename.mockImplementation(async () => {
      bench.events.push('rename')
      return { ok: false, error: { code: 'FAILED', message: 'rename failed' } }
    })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.events).toContain('rename')
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('rename failed')
  })

  it('reports an unlisted Session without navigating', async () => {
    const bench = draftChatBench()
    bench.binding.mockReturnValue(undefined)

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.rename).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('faberloom: the draft Session is not listed yet')
  })
})
