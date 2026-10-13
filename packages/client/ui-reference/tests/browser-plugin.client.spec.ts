/**
 * Web reference source coverage: Remote-backed file/session discovery,
 * deterministic ordering and labels, quoted-path suppression, pick projections, codec
 * round-trip, and registration lifecycle.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

const sid = (value: string): SessionId => value as SessionId
const session: ClientSessionContext = { sessionId: sid('target') }
/** The target session's own workspace: candidates in it are the `sameWorkspace` rows. */
const HOME = '/Users/dev'
/** The target session's workspace root: the directory browsing is rooted at. */
const ROOT = `${HOME}/project`
const CREATED_AT = 1_700_000_000_000
/** Three days after every fixture's createdAt, so age copy is one fixed bucket. */
const NOW = CREATED_AT + 3 * 86_400_000
/** The Host session list dates a row; only a session missing from it falls back to createdAt. */
const UPDATED_AT = NOW - 3_600_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

type RemoteEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

type RemoteLookup<T> = (
  agentId: SessionId,
  query: string,
  signal?: AbortSignal,
) => Promise<RemoteEnvelope<T[]>>

/** One direct child of a listed workspace directory. */
interface ListingEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
}

/** One workspace directory listing, as `workspaceFiles.list` settles it. */
interface Listing {
  /** Workspace-relative path of the listed directory; empty at the root. */
  readonly path: string
  readonly entries: readonly ListingEntry[]
  readonly truncated: boolean
}

type ListingLookup = (
  sessionId: SessionId,
  path: string,
  signal?: AbortSignal,
) => Promise<RemoteEnvelope<Listing>>

/** The workspace root's listing the browsing tests start from. */
const ROOT_LISTING: Listing = {
  path: '',
  entries: [{ name: 'src', type: 'directory' }, { name: 'a b.md', type: 'file' }],
  truncated: false,
}

function request(
  query: string,
  options: { quoted?: boolean; signal?: AbortSignal } = {},
): CandidateRequest {
  return {
    query,
    quoted: options.quoted ?? false,
    position: 'inline',
    drilled: false,
    signal: options.signal ?? new AbortController().signal,
  }
}

type ReadAllLookup = (
  sessionId: SessionId,
  path: string,
  signal?: AbortSignal,
) => Promise<RemoteEnvelope<{ data: string }>>

/** The composer intake face the `@` source reaches through the scoped conversation service. */
interface AttachFace {
  attachWorkspaceFile(name: string, data: Uint8Array): void
  readonly input: { for(ctx: unknown): { notify(level: 'info' | 'error', text: string): void } }
}

async function bench(
  files: RemoteLookup<FileReferenceCandidate> = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: [
      { path: 'src', kind: 'directory' as const },
      { path: 'docs/a b.md', kind: 'file' as const },
    ],
  })),
  sessions: RemoteLookup<SessionReferenceMentionCandidate> = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: [{
      sessionId: sid('source'),
      label: 'Research',
      cwd: `${HOME}/project`,
      sameWorkspace: false,
      createdAt: CREATED_AT,
      mention: '@[Research](dsh-session:InNvdXJjZSI)',
    }],
  })),
  listed: Record<string, { cwd?: string; updatedAt?: number }> = { target: { cwd: ROOT } },
  workspaceFiles: ListingLookup = vi.fn(() => Promise.resolve({ ok: true as const, value: ROOT_LISTING })),
  readAll: ReadAllLookup = vi.fn(() => Promise.resolve({ ok: true as const, value: { data: '' } })),
  over: { scopeConversation?: AttachFace | null } = {},
): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  source: InputTriggerSource
  workspaceFiles: ListingLookup
  readAll: ReadAllLookup
  attach: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  ctx.provide('sidebarRight', { openResource: vi.fn() })
  let source: InputTriggerSource | undefined
  ctx.provide('inputTriggers', {
    registerSource(candidate: InputTriggerSource) {
      source = candidate
      return () => { source = undefined }
    },
  })
  class RemoteService extends Service {
    readonly $host = { home: HOME, isLoopback: true }

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.fileReferences', { list: files })
  ctx.provide('remote.sessionReferenceResolver', { candidates: sessions })
  ctx.provide('remote.workspaceFiles', { list: workspaceFiles, readAll })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const attach = vi.fn()
  const notify = vi.fn()
  const conversation: AttachFace = { attachWorkspaceFile: attach, input: { for: () => ({ notify }) } }
  const scopedConversation = over.scopeConversation === null ? undefined : (over.scopeConversation ?? conversation)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ byId: listed }) },
    scope: (id: SessionId) => id === sid('target')
      ? { get: (name: string) => name === 'conversation' ? scopedConversation : undefined }
      : undefined,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  if (source === undefined) throw new Error('reference source was not registered')
  return { ctx, fiber, source, workspaceFiles, readAll, attach, notify }
}

describe('apply', () => {
  it('declares its services and releases the @ reference registration on disposal', async () => {
    expect(inject).toEqual([
      'inputTriggers', 'locale', 'sessions', 'remote', 'remote.fileReferences',
      'remote.workspaceFiles', 'remote.sessionReferenceResolver', 'sidebarRight',
    ])
    const { fiber } = await bench()
    let registered: InputTriggerSource | undefined
    const ctx = new Context()
    ctx.provide('sidebarRight', { openResource: vi.fn() })
    ctx.provide('inputTriggers', {
      registerSource(source: InputTriggerSource) {
        registered = source
        return () => { registered = undefined }
      },
    })
    class RemoteService extends Service {
      readonly $host = { home: undefined, isLoopback: false }

      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService(ctx)
    ctx.provide('remote.fileReferences', { list: () => Promise.resolve({ ok: true, value: [] }) })
    ctx.provide('remote.sessionReferenceResolver', { candidates: () => Promise.resolve({ ok: true, value: [] }) })
    ctx.provide('remote.workspaceFiles', { list: () => Promise.resolve({ ok: true, value: ROOT_LISTING }) })
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }) } })
    const ownFiber = ctx.plugin({ inject: [...inject], apply })
    await ownFiber.await()
    expect(registered).toMatchObject({ trigger: '@', name: 'reference', showGroupTitle: false })
    await ownFiber.dispose()
    expect(registered).toBeUndefined()
    await fiber.dispose()
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

describe('candidates', () => {
  it('starts both Remote lookups together and renders files before sessions with stable labels', async () => {
    let releaseFiles!: () => void
    let releaseSessions!: () => void
    const files = vi.fn(() => new Promise<{
      ok: true
      value: { path: string; kind: 'file' | 'directory' }[]
    }>((resolve) => {
      releaseFiles = () => {
        resolve({
          ok: true,
          value: [
            { path: 'src', kind: 'directory' },
            { path: 'docs/a b.md', kind: 'file' },
          ],
        })
      }
    }))
    const sessions = vi.fn(() => new Promise<{
      ok: true
      value: {
        sessionId: SessionId
        label: string
        cwd: string
        sameWorkspace: boolean
        createdAt: number
        mention: string
      }[]
    }>((resolve) => {
      releaseSessions = () => {
        resolve({
          ok: true,
          value: [{
            sessionId: sid('source'),
            label: 'Research',
            cwd: `${HOME}/project`,
            sameWorkspace: false,
            createdAt: CREATED_AT,
            mention: '@[Research](dsh-session:InNvdXJjZSI)',
          }],
        })
      }
    }))
    const { source } = await bench(files, sessions, { source: { updatedAt: UPDATED_AT } })
    const pending = source.candidates(session, request('re'))
    expect(files).toHaveBeenCalledTimes(1)
    expect(sessions).toHaveBeenCalledTimes(1)
    releaseSessions()
    releaseFiles()
    const rows = await pending
    expect(rows).toEqual([
      {
        name: 'src/',
        icon: 'folder',
        section: 'Files & folders',
        value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'src', mention: '@src/' }),
        drill: true,
      },
      expect.objectContaining({
        name: 'a b.md',
        description: 'docs',
        icon: 'file',
        section: 'Files & folders',
      }),
      expect.objectContaining({
        name: 'Attach a b.md',
        section: 'Files & folders',
      }),
      expect.objectContaining({
        name: 'Research',
        description: '~/project · 1h',
        icon: 'session',
        section: 'Sessions',
      }),
    ])
    // The attach row carries the paperclip element, not a glyph token.
    expect(rows[2]?.icon).toBeTypeOf('function')
  })

  it('suppresses sessions for an open quoted path and degrades each failed domain independently', async () => {
    const files = vi.fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: [{ path: 'README.md', kind: 'file' as const }],
      })
      .mockResolvedValueOnce({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'file scan failed', {}),
      })
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('source'),
        label: 'Research',
        cwd: `${HOME}/project`,
        sameWorkspace: false,
        createdAt: CREATED_AT,
        mention: '@[Research](dsh-session:InNvdXJjZSI)',
      }],
    }))
    const { source } = await bench(files, sessions)
    const quoted = await source.candidates(session, request('READ', { quoted: true }))
    expect(quoted[0]).toEqual(expect.objectContaining({ name: 'README.md', icon: 'file' }))
    expect(quoted[1]).toEqual(expect.objectContaining({ name: 'Attach README.md' }))
    expect(source.onPick({
      candidate: quoted[0]!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 6, draftRev: 1 },
    })).toEqual({
      insert: {
        source: 'reference',
        ref: '@"README.md"',
        label: 'README.md',
        appearance: 'file',
        clipboardText: '@"README.md"',
      },
    })
    expect(sessions).not.toHaveBeenCalled()
    await expect(source.candidates(session, request('research'))).resolves.toEqual([
      expect.objectContaining({ name: 'Research', icon: 'session' }),
    ])
  })

  it('drops a completed result when the query signal was superseded', async () => {
    const controller = new AbortController()
    const { source } = await bench()
    const pending = source.candidates(session, request('', { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toEqual([])
  })

  it('treats Remote failures as empty domains and filters paths that cannot be mentioned', async () => {
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{ path: 'bad\nname', kind: 'file' as const }],
    }))
    const sessions = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'session lookup failed', {}),
    }))
    const { source } = await bench(files, sessions)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])

    files.mockResolvedValueOnce({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'file lookup failed', {}),
    } as never)
    await expect(source.candidates(session, request('bad'))).resolves.toEqual([])
  })

  it('labels a session without a cwd and still dates it', async () => {
    const files = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('same'),
        label: 'same',
        sameWorkspace: false,
        createdAt: CREATED_AT,
        mention: '@[same](dsh-session:InNhbWUi)',
      }],
    }))
    const { source } = await bench(files, sessions)
    await expect(source.candidates(session, request('same'))).resolves.toEqual([
      expect.objectContaining({
        name: 'same',
        description: '(no cwd) · 3d',
      }),
    ])
  })

  it('falls back to the candidate createdAt for a session the Host list does not carry', async () => {
    const files = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('unlisted'),
        label: 'Unlisted run',
        cwd: `${HOME}/project`,
        sameWorkspace: true,
        createdAt: CREATED_AT,
        mention: '@[Unlisted run](dsh-session:InVubGlzdGVkIg)',
      }],
    }))
    // A row absent from the list has no durable activity time to read.
    const { source } = await bench(files, sessions, { other: { updatedAt: UPDATED_AT } })
    await expect(source.candidates(session, request('unlisted'))).resolves.toEqual([
      expect.objectContaining({ name: 'Unlisted run', description: '3d' }),
    ])
  })

  it('reads a session opened moments ago as the present, not a zero distance', async () => {
    const files = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('just-now'),
        label: 'Just now',
        cwd: `${HOME}/project`,
        sameWorkspace: true,
        createdAt: NOW - 1_000,
        mention: '@[Just now](dsh-session:Imp1c3Qtbm93Ig)',
      }],
    }))
    const { source } = await bench(files, sessions, { 'just-now': { updatedAt: NOW - 1_000 } })
    await expect(source.candidates(session, request('just'))).resolves.toEqual([
      expect.objectContaining({ name: 'Just now', description: 'now' }),
    ])
  })

  it('dates a session in the current workspace without repeating that workspace', async () => {
    const files = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const sessions = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{
        sessionId: sid('sibling'),
        label: 'Sibling run',
        cwd: `${HOME}/project`,
        sameWorkspace: true,
        createdAt: CREATED_AT,
        mention: '@[Sibling run](dsh-session:InNpYmxpbmdyIg)',
      }],
    }))
    const { source } = await bench(files, sessions)
    await expect(source.candidates(session, request('sib'))).resolves.toEqual([
      expect.objectContaining({ name: 'Sibling run', description: '3d' }),
    ])
  })
})

describe('workspace browsing', () => {
  const noSessions = (): ReturnType<RemoteLookup<SessionReferenceMentionCandidate>> =>
    Promise.resolve({ ok: true, value: [] })

  it('lists the session workspace root for the empty query, folders before files', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        path: '',
        entries: [
          { name: 'zeta.txt', type: 'file' as const },
          { name: 'src', type: 'directory' as const },
          { name: 'alpha', type: 'directory' as const },
          { name: 'odd', type: 'other' as const },
          { name: 'bad\nname', type: 'file' as const },
          { name: 'bad\ndir', type: 'directory' as const },
        ],
        truncated: false,
      },
    }))
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    const rows = await source.candidates(session, request(''))
    expect(workspaceFiles).toHaveBeenCalledWith(sid('target'), ROOT, expect.any(AbortSignal))
    expect(rows.map(row => row.name)).toEqual(['alpha/', 'src/', 'zeta.txt', 'Attach zeta.txt'])
    expect(rows.slice(0, 3).map(row => row.icon)).toEqual(['folder', 'folder', 'file'])
    expect(rows[3]?.icon).toBeTypeOf('function')
    expect(rows.filter(row => row.drill === true).map(row => row.name)).toEqual(['alpha/', 'src/'])
  })

  it('lists the workspace root as "." when the session list carries no workspace path', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({ ok: true as const, value: ROOT_LISTING }))
    const { source } = await bench(undefined, noSessions, {}, workspaceFiles)
    await source.candidates(session, request(''))
    expect(workspaceFiles).toHaveBeenCalledWith(sid('target'), '.', expect.any(AbortSignal))
  })

  it('drills into a subfolder from its row, lists that child path, and walks back through the breadcrumbs', async () => {
    const workspaceFiles = vi.fn((_sessionId: SessionId, path: string) => Promise.resolve({
      ok: true as const,
      value: path === ROOT
        ? { path: '', entries: [{ name: 'src', type: 'directory' as const }], truncated: false }
        : { path: 'src', entries: [{ name: 'index.html', type: 'file' as const }], truncated: false },
    }))
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    const [folder] = await source.candidates(session, request(''))
    const descends = source.onPick({
      candidate: folder!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'drill',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(descends).toEqual({ text: '@src/', continue: true })
    const drilled = await source.candidates(session, { ...request('src/'), drilled: true })
    expect(workspaceFiles).toHaveBeenNthCalledWith(2, sid('target'), `${ROOT}/src`, expect.any(AbortSignal))
    expect(drilled.map(row => row.name)).toEqual(['index.html', 'Attach index.html'])
    const crumbs = source.header?.(session, { query: 'src/', drilled: true })
    expect(crumbs?.map(crumb => crumb.label)).toEqual(['Workspace', 'src'])
    // The root crumb is the drill back to the workspace root.
    const returns = source.onPick({
      candidate: { name: crumbs![0]!.label, value: crumbs![0]!.value },
      session,
      position: 'inline',
      via: 'menu',
      action: 'drill',
      span: { start: 0, end: 3, draftRev: 1 },
    })
    expect(returns).toEqual({ text: '@', continue: true })
    await source.candidates(session, { ...request(''), drilled: true })
    expect(workspaceFiles).toHaveBeenNthCalledWith(3, sid('target'), ROOT, expect.any(AbortSignal))
  })

  it('filters a browsed directory by the name fragment typed after its path', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        path: 'src',
        entries: [
          { name: 'notes.md', type: 'file' as const },
          { name: 'module1', type: 'directory' as const },
          { name: 'index.ts', type: 'file' as const },
        ],
        truncated: false,
      },
    }))
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    const rows = await source.candidates(session, request('src/ind'))
    expect(workspaceFiles).toHaveBeenCalledWith(sid('target'), `${ROOT}/src`, expect.any(AbortSignal))
    expect(rows.map(row => row.name)).toEqual(['index.ts', 'Attach index.ts'])
  })

  it('keeps the fuzzy workspace search for a query with no separator', async () => {
    const files = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: [{ path: 'src/module1/index.ts', kind: 'file' as const }],
    }))
    const workspaceFiles = vi.fn()
    const { source } = await bench(files, noSessions, undefined, workspaceFiles)
    const rows = await source.candidates(session, request('ind'))
    expect(files).toHaveBeenCalledWith(sid('target'), 'ind', expect.any(AbortSignal))
    expect(workspaceFiles).not.toHaveBeenCalled()
    expect(rows.map(row => row.name)).toEqual(['index.ts', 'Attach index.ts'])
    expect(rows[0]?.description).toBe('src/module1')
  })

  it('says a listing was cut at the entry cap instead of hiding entries', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { path: '', entries: [{ name: 'src', type: 'directory' as const }], truncated: true },
    }))
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    const rows = await source.candidates(session, request(''))
    expect(rows.map(row => row.name)).toEqual(['src/', en['listing.truncated']])
    const note = rows.at(-1)
    expect(note?.value).toBeUndefined()
    expect(note?.section).toBe(en['section.files'])
  })

  it('names a failed listing in the reader\'s words instead of showing an empty menu', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({ ok: true as const, value: ROOT_LISTING }))
    workspaceFiles
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('workspace-file/not-found', 'gone', { path: 'gone' }),
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('workspace-file/outside-workspace', 'outside', { path: '../escape' }),
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('workspace-file/not-directory', 'a file', { path: 'notes.md', kind: 'file' }),
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        error: new RemoteError('gateway/internal', 'broker lost', {}),
      } as never)
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    await expect(source.candidates(session, request('gone/'))).resolves.toEqual([
      { name: en['listing.error.notFound'], section: en['section.files'] },
    ])
    await expect(source.candidates(session, request('../escape/'))).resolves.toEqual([
      { name: en['listing.error.outsideWorkspace'], section: en['section.files'] },
    ])
    await expect(source.candidates(session, request('notes.md/'))).resolves.toEqual([
      { name: en['listing.error.notDirectory'], section: en['section.files'] },
    ])
    await expect(source.candidates(session, request('weird/'))).resolves.toEqual([
      { name: en['listing.error.unavailable'].replace('{message}', 'broker lost'), section: en['section.files'] },
    ])
  })

  it('inserts the workspace-relative mention of a file reached by drilling', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        path: 'docs/guide',
        entries: [{ name: 'read me.md', type: 'file' as const }],
        truncated: false,
      },
    }))
    const { source } = await bench(undefined, noSessions, undefined, workspaceFiles)
    const [row] = await source.candidates(session, request('docs/guide/'))
    expect(workspaceFiles).toHaveBeenCalledWith(sid('target'), `${ROOT}/docs/guide`, expect.any(AbortSignal))
    expect(source.onPick({
      candidate: row!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 12, draftRev: 1 },
    })).toEqual({
      insert: {
        source: 'reference',
        ref: '@"docs/guide/read me.md"',
        label: 'read me.md',
        appearance: 'file',
        clipboardText: '@"docs/guide/read me.md"',
      },
    })
  })

  it('reads the picked attach row through the Host and hands its bytes to the composer intake', async () => {
    const readAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { data: 'AAEC' } }))
    const { source, attach } = await bench(undefined, noSessions, undefined, undefined, readAll)
    const rows = await source.candidates(session, request(''))
    const row = rows.find(entry => entry.name === 'Attach a b.md')
    expect(row).toBeDefined()
    expect(source.onPick({
      candidate: row!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1, draftRev: 1 },
    })).toBe('handled')
    await vi.waitFor(() => { expect(attach).toHaveBeenCalledOnce() })
    expect(readAll).toHaveBeenCalledWith(sid('target'), 'a b.md', expect.any(AbortSignal))
    const [name, data] = attach.mock.calls[0] as [string, Uint8Array]
    expect(name).toBe('a b.md')
    expect([...data]).toEqual([0, 1, 2])
  })

  it.each([
    ['workspace-file/not-found', 'attach.error.notFound'],
    ['workspace-file/too-large', 'attach.error.tooLarge'],
    ['workspace-file/not-regular-file', 'attach.error.notRegularFile'],
    ['gateway/internal', 'attach.error.unavailable'],
  ] as const)('surfaces a %s read refusal instead of attaching an empty file', async (code, key) => {
    const readAll = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError(code, 'broker lost', { path: 'a b.md', limit: 10 }),
    }))
    const { source, attach, notify } = await bench(undefined, noSessions, undefined, undefined, readAll)
    const rows = await source.candidates(session, request(''))
    const row = rows.find(entry => entry.name === 'Attach a b.md')
    source.onPick({
      candidate: row!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    await vi.waitFor(() => { expect(notify).toHaveBeenCalledOnce() })
    expect(attach).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('error', en[key].replace('{message}', 'broker lost'))
  })

  it('drops an attach pick whose Session scope or composer is gone', async () => {
    const { source, attach } = await bench()
    const rows = await source.candidates(session, request(''))
    const candidate = rows.find(entry => entry.name === 'Attach a b.md')!
    const pickFrom = (sessionId: SessionId) => source.onPick({
      candidate, session: { sessionId }, position: 'inline', via: 'menu', action: 'pick',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    expect(pickFrom(sid('ghost'))).toBe('handled')
    await Promise.resolve()
    expect(attach).not.toHaveBeenCalled()

    const gone = await bench(undefined, noSessions, undefined, undefined, undefined, { scopeConversation: null })
    const goneRows = await gone.source.candidates(session, request(''))
    gone.source.onPick({
      candidate: goneRows.find(entry => entry.name === 'Attach a b.md')!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1, draftRev: 1 },
    })
    await Promise.resolve()
    expect(gone.attach).not.toHaveBeenCalled()
  })
})

describe('directory header', () => {
  const drilledRequest = (query: string, quoted = false): CandidateRequest => ({
    query,
    quoted,
    position: 'inline',
    drilled: true,
    signal: new AbortController().signal,
  })

  it('publishes no header for a query the user typed', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src/module1/', drilled: false })).toBeUndefined()
  })

  it('publishes no header until a drilled query names a directory', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src', drilled: true })).toBeUndefined()
  })

  it('trails the workspace root down to the directory being listed', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'src/module1/ind', drilled: true })).toEqual([
      { label: 'Workspace', value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'Workspace', mention: '@' }) },
      { label: 'src', value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'src', mention: '@src/' }) },
      {
        label: 'module1',
        value: JSON.stringify({ kind: 'file', fileKind: 'directory', label: 'module1', mention: '@src/module1/' }),
        current: true,
      },
    ])
  })

  it('keeps an open quote across every crumb of a quoted descent', async () => {
    const { source } = await bench()
    const crumbs = source.header?.(session, { query: 'my dir/sub/', quoted: true, drilled: true })
    expect(crumbs?.map(crumb => JSON.parse(crumb.value) as { mention: string }).map(value => value.mention))
      .toEqual(['@"', '@"my dir/', '@"my dir/sub/'])
  })

  it('publishes no header when a segment cannot be written back as mention text', async () => {
    const { source } = await bench()
    expect(source.header?.(session, { query: 'ok/we\u0001ird/', drilled: true })).toBeUndefined()
  })

  it('returns to a crumb through the same drill outcome a folder row uses', async () => {
    const { source } = await bench()
    const crumbs = source.header?.(session, { query: 'src/module1/', drilled: true })
    expect(source.onPick({
      candidate: { name: 'src', value: crumbs?.[1]?.value ?? '' },
      session,
      position: 'inline',
      via: 'menu',
      action: 'drill',
      span: { start: 0, end: 13, draftRev: 1 },
    })).toEqual({ text: '@src/', continue: true })
  })

  it('drops the row location a drilled listing already shows in its header', async () => {
    const workspaceFiles = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        path: 'src/module1',
        entries: [{ name: 'index.html', type: 'file' as const }],
        truncated: false,
      },
    }))
    const sessions = vi.fn(() => Promise.resolve({ ok: true as const, value: [] }))
    const { source } = await bench(undefined, sessions, undefined, workspaceFiles)
    const rows = await source.candidates(session, drilledRequest('src/module1/'))
    expect(rows[0]).toEqual(expect.objectContaining({ name: 'index.html', icon: 'file' }))
    expect(rows[1]).toEqual(expect.objectContaining({ name: 'Attach index.html' }))
    expect(rows[0]).not.toHaveProperty('description')
    expect(source.header?.(session, { query: 'src/module1/', drilled: true })).not.toBeUndefined()
  })
})

describe('pick and codec', () => {
  const pickAs = (action: 'pick' | 'drill') =>
    (source: InputTriggerSource, candidate: InputTriggerCandidate) => source.onPick({
      candidate,
      session,
      position: 'inline',
      via: 'menu',
      action,
      span: { start: 0, end: 1, draftRev: 1 },
    })
  const pick = pickAs('pick')
  const drill = pickAs('drill')

  it('settles files and directories as atomic icon labels; drill keeps directory completion open', async () => {
    const { source } = await bench()
    const [directory, file] = await source.candidates(session, request(''))
    expect(directory?.name).toBe('src/')
    expect(directory?.drill).toBe(true)
    expect(file?.name).toBe('a b.md')
    expect(file?.drill).toBeUndefined()
    expect(pick(source, directory!)).toEqual({
      insert: {
        source: 'reference',
        ref: '@src/',
        label: 'src/',
        appearance: 'folder',
        clipboardText: '@src/',
      },
    })
    expect(drill(source, directory!)).toEqual({ text: '@src/', continue: true })
    expect(pick(source, file!)).toEqual({
      insert: {
        source: 'reference',
        ref: '@"a b.md"',
        label: 'a b.md',
        appearance: 'file',
        clipboardText: '@"a b.md"',
      },
    })
    const [quotedDirectory] = await source.candidates(session, request('', { quoted: true }))
    expect(drill(source, quotedDirectory!)).toEqual({ text: '@"src/', continue: true })
  })

  it('inserts sessions as atomic chips whose clipboard and model forms are canonical mentions', async () => {
    const { source } = await bench()
    const candidates = await source.candidates(session, request(''))
    const candidate = candidates.find(item => item.name === 'Research')!
    const mention = '@[Research](dsh-session:InNvdXJjZSI)'
    expect(pick(source, candidate)).toEqual({
      insert: {
        source: 'reference',
        ref: mention,
        label: 'Research',
        appearance: 'session',
        clipboardText: mention,
      },
    })
    expect(source.codec?.clipboardText(mention)).toBe(mention)
    await expect(source.codec?.serialize(mention, new AbortController().signal)).resolves.toBe(mention)
  })

  it('ignores candidates that do not carry a source-owned value', async () => {
    const { source } = await bench()
    expect(pick(source, { name: 'foreign candidate' })).toBeUndefined()
  })
})

describe('reference preview', () => {
  it('opens plain and quoted file references without treating folders or sessions as files', async () => {
    const { ctx, source, fiber } = await bench()
    const openResource = vi.spyOn(ctx.sidebarRight, 'openResource')
    expect(source.openReference?.(session, { ref: '@notes/readme.md', appearance: 'file' })).toBe(true)
    expect(source.openReference?.(session, { ref: '@"docs/a b.md"', appearance: 'file' })).toBe(true)
    expect(openResource).toHaveBeenNthCalledWith(1, 'dsh-resource://file/session/target/notes/readme.md')
    expect(openResource).toHaveBeenNthCalledWith(2, 'dsh-resource://file/session/target/docs/a%20b.md')
    expect(source.openReference?.(session, { ref: '@docs/', appearance: 'folder' })).toBe(false)
    expect(source.openReference?.(session, { ref: '@[Research](dsh-session:abc)', appearance: 'session' })).toBe(false)
    expect(openResource).toHaveBeenCalledTimes(2)
    await fiber.dispose()
  })
})
