// @vitest-environment jsdom
/** FaberLoom surface: identity tokens, brand name, real workspace reads, and panel switching. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

const CONVERSAR = 'faberloom-conversar' as MainPanelId
const BOARD = 'faberloom-board' as MainPanelId
const SPACES = 'faberloom-spaces' as MainPanelId
const MEMORY = 'faberloom-memory' as MainPanelId
const EMAIL = 'faberloom-email' as MainPanelId

const OVERVIEW = {
  spaces: [{ id: 'space-1', title: 'Marluvas', parentId: null, agentId: 'agent-1', agentName: 'Proformas', workspaceId: 'ws-1' }],
  agents: [{ id: 'agent-1', name: 'Proformas', spaceIds: ['space-1'], detached: false, active: true }],
  board: [{ id: 'item-1', title: 'Preparar proforma', status: 'needs_review' }],
  routines: [{ id: 'routine-1', name: 'Pedido a proforma', status: 'active' }],
  memory: [{ id: 'mem-1', kind: 'episodic', text: 'El precio de Eguisa se consulta antes de cotizar.', at: '2026-09-16T00:00:00Z' }],
  canWrite: true,
}

const EMPTY = { spaces: [], agents: [], board: [], routines: [], memory: [], canWrite: true }

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

async function bench(
  overviewResult: unknown = { ok: true, value: OVERVIEW },
  spaceDetailResult: unknown = { ok: true, value: undefined },
  email: { drafts?: unknown[]; inbox?: unknown[] } = {},
) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const theme = { overrideTokens: vi.fn(() => () => {}) }
  const layout = { selectPanel: vi.fn((activePanelId: MainPanelId | null) => { runtime.panelInfo.set({ activePanelId }) }) }
  const overview = vi.fn(async () => overviewResult)
  const createSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const deleteSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const openSpaceWorkspace = vi.fn(async () => ({ ok: true, value: { registered: true, workspaceId: 'ws-1', title: 'Marluvas', sessions: 0 } }))
  const renameSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const renameAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const deactivateAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createBoardItem = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const reviewBoardItem = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const deleteBoardItem = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const setRoutineActive = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const remember = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const spaceMemory = vi.fn(async () => ({ ok: true, value: [] }))
  const teachings = vi.fn(async () => ({ ok: true, value: [] }))
  const saveTeaching = vi.fn(async () => ({ ok: true, value: [] }))
  const editTeaching = vi.fn(async () => ({ ok: true, value: [] }))
  const revokeTeaching = vi.fn(async () => ({ ok: true, value: [] }))
  const performance = vi.fn(async () => ({
    ok: true,
    value: { uses: 0, approved: 0, corrected: 0, agentFailures: 0, correctionsByCause: {}, correctionRate: null },
  }))
  const spaceDetail = vi.fn(async () => spaceDetailResult)
  const spaceWorkspace = vi.fn(async () => ({ ok: true, value: { registered: true, workspaceId: 'ws-1', title: 'Marluvas', sessions: 0 } }))
  const routineDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const setBoardRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const emailDrafts = vi.fn(async () => ({ ok: true, value: email.drafts ?? [] }))
  const emailInbox = vi.fn(async () => ({ ok: true, value: email.inbox ?? [] }))
  const emailRead = vi.fn(async () => ({ ok: true, value: { text: 'cuerpo', html: null, attachments: [] } }))
  const emailMarkSeen = vi.fn(async () => ({ ok: true, value: true }))
  const emailTrash = vi.fn(async () => ({ ok: true, value: { movedTo: 'Trash' } }))
  const emailVoice = vi.fn(async () => ({ ok: true, value: [] }))
  const emailPolicy = vi.fn(async () => ({ ok: true, value: { enabled: false, cleanSends: 0, threshold: 3 } }))
  const saveEmailPolicy = vi.fn(async () => ({ ok: true, value: { enabled: false, cleanSends: 0, threshold: 3 } }))
  const emailDraftWithAi = vi.fn(async () => ({ ok: true, value: undefined }))
  const learnFromEmail = vi.fn(async () => ({ ok: true, value: {} }))
  const sendEmailDraft = vi.fn(async () => ({ ok: true, value: [] }))
  const deleteEmailDraft = vi.fn(async () => ({ ok: true, value: [] }))
  const mwtStatus = vi.fn(async () => ({
    ok: true,
    value: { ownerId: '', role: '', companyId: null, companyIds: [], companies: [], servers: [] },
  }))
  const saveSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const saveRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const connections = vi.fn(async () => ({ ok: true, value: [] }))
  const saveConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const removeConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const probeConnection = vi.fn(async () => ({ ok: true, value: { ok: true, detail: 'ok' } }))
  const faberloomView = {
    overview, createSpace, deleteSpace, openSpaceWorkspace, renameSpace, createAgent, renameAgent,
    deactivateAgent, createBoardItem, reviewBoardItem, deleteBoardItem, createRoutine, setRoutineActive, remember,
    spaceDetail, spaceWorkspace, saveSpace, routineDetail, saveRoutine, boardDetail, setBoardRoutine,
    emailDrafts, emailInbox, emailRead, emailMarkSeen, emailTrash, sendEmailDraft, deleteEmailDraft, mwtStatus,
    emailVoice, emailPolicy, saveEmailPolicy, emailDraftWithAi, learnFromEmail,
    connections, saveConnection, removeConnection, probeConnection,
    spaceMemory, teachings, saveTeaching, editTeaching, revokeTeaching, performance,
  }
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('theme', theme as never)
      ctx.provide('layout', layout as never)
      ctx.provide('locale', locale)
      ctx.provide('remote', { faberloomView, $on: vi.fn(() => () => {}) } as never)
      ctx.provide('remote.faberloomView', faberloomView as never)
      // The chat gestures register into these seats; the panel specs stub them
      // (`sessions` is already provided by the slot test runtime).
      ctx.provide('inputTriggers', { registerSource: vi.fn(() => () => {}), sessionOf: vi.fn() } as never)
      ctx.provide('commandUi', { register: vi.fn(() => () => {}), decorate: vi.fn(() => () => {}), dismiss: vi.fn(), popupFor: vi.fn() } as never)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'test: common locale')
      ctx.slots.installLocale(locale)
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar.brand.name' | 'sidebar.panellist' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <header>{renderSlot('sidebar.brand.name', {})}</header>
        <nav>{renderSlot('sidebar.panellist', { size: 16, active: false })}</nav>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? CONVERSAR })}</main>
      </>
    )
  }
  await runtime.root.declare({
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  const surface = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return {
    runtime, theme, layout, overview, createSpace, deleteSpace, openSpaceWorkspace, saveSpace,
    deleteBoardItem, emailDrafts, emailInbox, emailMarkSeen, emailTrash, sendEmailDraft, deleteEmailDraft,
    remember, spaceMemory, surface, view,
  }
}

describe('faberloom surface', () => {
  it('registers the identity tokens and one sidebar row per section', async () => {
    const { runtime, theme, surface, view } = await bench()
    expect(theme.overrideTokens).toHaveBeenCalledOnce()
    const [source, tokens] = theme.overrideTokens.mock.calls[0] as unknown as [string, Record<string, { light: string; dark: string }>]
    expect(source).toBe('@deepseek-ai/dsh-client-ui-faberloom')
    expect(Object.keys(tokens)).toEqual(['--dsw-alias-brand-primary-new-colorprimary-new-color'])

    expect(runtime.slots.entries('sidebar.panellist').map(row => row.options.id)).toEqual([
      'faberloom-conversar',
      'faberloom-board',
      'faberloom-spaces',
      'faberloom-agents',
      'faberloom-skills',
      'faberloom-routines',
      'faberloom-memory',
      'faberloom-connections',
      'faberloom-email',
    ])
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual([
      'faberloom-conversar',
      'faberloom-board',
      'faberloom-spaces',
      'faberloom-agents',
      'faberloom-skills',
      'faberloom-routines',
      'faberloom-memory',
      'faberloom-connections',
      'faberloom-email',
    ])
    expect(view.getByText('faberloom')).toBeTruthy()
    expect(view.getByRole('heading', { name: 'What do you want to solve today?' })).toBeTruthy()
    await surface.dispose()
  })

  it('renders real workspace rows from the host view and opens the conversation', async () => {
    const { runtime, overview, layout, surface, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    expect(await view.findByRole('button', { name: 'Marluvas' })).toBeTruthy()
    expect(overview).toHaveBeenCalledOnce()

    act(() => { runtime.panelInfo.set({ activePanelId: CONVERSAR }) })
    const start = view.getByRole('button', { name: 'Start a conversation' })
    start.click()
    expect(layout.selectPanel).toHaveBeenCalledWith(null)

    await surface.dispose()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.entries('main')).toEqual([])
    expect(view.queryByText('faberloom')).toBeNull()
  })

  it('shows the empty state when the workspace has no rows', async () => {
    const { runtime, view } = await bench({ ok: true, value: EMPTY })
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    expect(await view.findByText('No data yet')).toBeTruthy()
  })

  it('creates a space from the dialog and republishes the refreshed overview', async () => {
    const { runtime, createSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    fireEvent.change(await view.findByPlaceholderText('Space name'), { target: { value: 'Marluvas' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Marluvas', undefined, undefined, true) })
  })

  it('creates a space with a default name when the field is empty', async () => {
    const { runtime, createSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('New space', undefined, undefined, true) })
  })

  it('creates a sub-space under the chosen parent space', async () => {
    const { runtime, createSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    fireEvent.change(await view.findByPlaceholderText('Space name'), { target: { value: 'Hijo' } })
    fireEvent.change(view.getByRole('combobox', { name: 'Parent space' }), { target: { value: 'space-1' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Hijo', undefined, 'space-1', true) })
  })

  it('creates a space in charge of the chosen agent', async () => {
    const { runtime, createSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    fireEvent.change(await view.findByPlaceholderText('Space name'), { target: { value: 'Marluvas' } })
    fireEvent.change(view.getByRole('combobox', { name: 'Agent' }), { target: { value: 'agent-1' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Marluvas', 'agent-1', undefined, true) })
  })

  it('opens the space Workspace from its table link', async () => {
    const { runtime, openSpaceWorkspace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'Marluvas' }))
    await waitFor(() => { expect(openSpaceWorkspace).toHaveBeenCalledWith('space-1') })
  })

  it('removes the selected space from the inspector', async () => {
    const { runtime, deleteSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    const rows = await view.findAllByRole('row')
    fireEvent.click(rows[1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(deleteSpace).toHaveBeenCalledWith('space-1') })
  })

  it('deletes the selected work-bench task from the inspector', async () => {
    const { runtime, deleteBoardItem, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    const rows = await view.findAllByRole('row')
    fireEvent.click(rows[1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(deleteBoardItem).toHaveBeenCalledWith('item-1') })
  })

  it('sends and discards an email draft from the work bench', async () => {
    const draft = {
      id: 'draft-1', to: ['cliente@mwt.one'], cc: [], subject: 'Propuesta', text: 'cuerpo',
      status: 'draft', aiText: null, inReplyTo: null, spaceId: null, createdAt: '2026-09-27T00:00:00Z',
    }
    const { runtime, sendEmailDraft, deleteEmailDraft, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [draft], inbox: [] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('Propuesta')
    const draftRows = view.getAllByRole('row')
    fireEvent.click(draftRows[draftRows.length - 1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Send' }))
    await waitFor(() => { expect(sendEmailDraft).toHaveBeenCalledWith('draft-1') })
    fireEvent.click(await view.findByRole('button', { name: 'Delete' }))
    await waitFor(() => { expect(deleteEmailDraft).toHaveBeenCalledWith('draft-1') })
  })

  it('lists an unread email as a work-bench task to answer', async () => {
    const message = { id: '42', messageId: '<x@y>', from: 'proveedor@mwt.one', subject: 'OC 505433', date: '2026-09-27' }
    const { runtime, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [], inbox: [message] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('OC 505433')
    const inboxRows = view.getAllByRole('row')
    fireEvent.click(inboxRows[inboxRows.length - 1] as HTMLTableRowElement)
    expect(await view.findByRole('button', { name: 'Reply' })).toBeTruthy()
  })

  it('marks read and trashes a message from the Email panel', async () => {
    const message = { id: '42', messageId: '<x@y>', from: 'proveedor@mwt.one', subject: 'OC 505433', date: '2026-09-27' }
    const { runtime, emailMarkSeen, emailTrash, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [], inbox: [message] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: EMAIL }) })
    await view.findByText('OC 505433')
    const rows = view.getAllByRole('row')
    fireEvent.click(rows[rows.length - 1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Mark as read' }))
    await waitFor(() => { expect(emailMarkSeen).toHaveBeenCalledWith('42') })
    fireEvent.click(await view.findByRole('button', { name: 'Trash' }))
    await waitFor(() => { expect(emailTrash).toHaveBeenCalledWith('42', 'proveedor@mwt.one', 'OC 505433') })
  })

  it('assigns the responsible agent from the space detail', async () => {
    const detail = {
      ok: true,
      value: {
        id: 'space-1', title: 'Marluvas', parentId: null, inheritContext: true,
        excluded: [], members: [], sources: [], contextKeys: [], agentId: null,
      },
    }
    const { runtime, saveSpace, view } = await bench({ ok: true, value: OVERVIEW }, detail)
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    const rows = await view.findAllByRole('row')
    fireEvent.click(rows[1] as HTMLTableRowElement)
    fireEvent.change(await view.findByRole('combobox', { name: 'Agent' }), { target: { value: 'agent-1' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(saveSpace).toHaveBeenCalledWith('space-1', expect.objectContaining({ agentId: 'agent-1' })) })
  })

  it('filters and remembers space-scoped memory', async () => {
    const { runtime, remember, spaceMemory, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })
    await waitFor(() => { expect(spaceMemory).toHaveBeenCalledWith(undefined) })
    fireEvent.change(view.getByRole('combobox', { name: 'Space' }), { target: { value: 'space-1' } })
    await waitFor(() => { expect(spaceMemory).toHaveBeenLastCalledWith('space-1') })
    fireEvent.change(view.getByPlaceholderText('Write what the agent must remember'), { target: { value: 'nota' } })
    fireEvent.click(view.getByRole('button', { name: 'Remember' }))
    await waitFor(() => { expect(remember).toHaveBeenCalledWith('nota', 'space-1') })
  })

  it('keeps the space form usable for a read-only identity (own spaces)', async () => {
    const { runtime, createSpace, view } = await bench({ ok: true, value: { ...OVERVIEW, canWrite: false } })
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    const input = await view.findByPlaceholderText('Space name')
    expect(input).toHaveProperty('disabled', false)
    fireEvent.change(input, { target: { value: 'Propio' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Propio', undefined, undefined, true) })
  })
})
