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
    return { ok: true, value: undefined }
  })
  const reference = {
    ready: Promise.resolve(),
    binding: { session: { rename } },
  }
  const using = vi.fn(async (
    _sessionId: string,
    _options: { readonly source: string },
    operation: (current: typeof reference) => Promise<void>,
  ) => {
    events.push('retain')
    try {
      await operation(reference)
    } finally {
      events.push('release')
    }
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
    sessions: { using },
    uiWorkspace: { openSession },
    layout: { selectPanel },
    get: (name: string) => name === 'remote.faberloomView' ? remote : undefined,
  } as never
  const bound = { setError: vi.fn() }
  return { ctx, bound, events, using, rename, openSession, selectPanel, draftSessionOpen, draftSessionStart }
}

describe('openDraftChat', () => {
  it('starts the Host-owned session, retains it through rename, then reuses the binding', async () => {
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
    expect(bench.using).toHaveBeenCalledWith('session-1', { source: 'faberloomDraftAgent' }, expect.any(Function))
    expect(bench.rename).toHaveBeenCalledOnce()
    expect(bench.rename).toHaveBeenCalledWith(TITLE)
    expect(bench.events).toEqual(['start', 'retain', 'rename', 'release', 'open', 'panel', 'open', 'panel'])
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
    expect(bench.using).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()

    pending.resolve(undefined)
    await opening
    expect(bench.events.indexOf('start:end')).toBeLessThan(bench.events.indexOf('retain'))
    expect(bench.events.indexOf('release')).toBeLessThan(bench.events.indexOf('open'))
  })

  it('reports a rejected start without creating a client session or navigating', async () => {
    const bench = draftChatBench()
    bench.draftSessionStart.mockResolvedValue({ ok: false, error: { code: 'DRAFT_CHANGED', message: 'el borrador cambió' } })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.using).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('el borrador cambió')
  })

  it('keeps the editor available when the Host cannot supply the Space Workspace', async () => {
    const bench = draftChatBench()
    bench.draftSessionStart.mockResolvedValue({ ok: false, error: { code: 'SPACE_WORKSPACE_UNAVAILABLE', message: 'Space sin Workspace' } })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.using).not.toHaveBeenCalled()
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('Space sin Workspace')
  })

  it('releases the reference and reports a rename failure without navigating', async () => {
    const bench = draftChatBench()
    bench.rename.mockResolvedValue({ ok: false, error: { code: 'FAILED', message: 'rename failed' } })

    await openDraftChat(bench.ctx, bench.bound, 'draft-1', TITLE)

    expect(bench.events).toContain('release')
    expect(bench.openSession).not.toHaveBeenCalled()
    expect(bench.bound.setError).toHaveBeenCalledWith('rename failed')
  })
})
