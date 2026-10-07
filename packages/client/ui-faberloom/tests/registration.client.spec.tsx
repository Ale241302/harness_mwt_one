// @vitest-environment jsdom
/** FaberLoom surface: identity tokens, brand name, real workspace reads, and panel switching. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
const WORKFLOWS = 'faberloom-workflows' as MainPanelId

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
  memoryRows: unknown[] = [],
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
  const spaceMemory = vi.fn(async () => ({ ok: true, value: memoryRows }))
  const deleteSpaceMemory = vi.fn(async () => ({ ok: true, value: memoryRows }))
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
  const skills = vi.fn(async () => ({ ok: true, value: [] }))
  const saveConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const removeConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const probeConnection = vi.fn(async () => ({ ok: true, value: { ok: true, detail: 'ok' } }))
  const workflowOverview = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const workflowDetail = vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: {
      id: 'wf1', name: 'flujo', status: 'draft', version: 1, routineId: null,
      valid: true, problems: [], maxConcurrency: null, nodesList: [], edgesList: [],
    },
  }))
  const createWorkflow = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const saveWorkflow = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const addNode = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const updateNode = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const removeNode = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const connectNode = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const disconnectNode = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const setWorkflowStatus = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const workflowRuns = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const spaceTopology = vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: { spaces: [], agents: [], connections: [], workspaces: [] },
  }))
  const exportWorkflow = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { format: 'json', content: '{}' } }))
  const routineWorkflowLinks = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const setWorkflowConcurrency = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const shareWorkflow = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const shareSpace = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const resourceShares = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const revokeShareGrant = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const executionHealth = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { ownerId: '', routines: [], totals: { runs: 0, failures: 0, needsReview: 0, waiting: 0, retries: 0, deadLettered: 0, alerts: 0 } } }))
  const workflowTemplates = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const createWorkflowFromTemplate = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const importWorkflow = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const captureSpaceSessions = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const spaceSessions = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const spaceSessionContent = vi.fn(async (): Promise<unknown> => ({
    ok: true,
    value: { sessionId: 's1', ownerId: 'o@x', spaceId: 'sp', title: 't', workspaceId: null, createdAt: 'c', updatedAt: 'u', messageCount: 0, origin: 'owner', content: '' },
  }))
  const removeSpaceSession = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const syncContext = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const workflowPendingChanges = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const acceptWorkflowChange = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const rejectWorkflowChange = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const faberloomView = {
    overview, createSpace, deleteSpace, openSpaceWorkspace, renameSpace, createAgent, renameAgent,
    deactivateAgent, createBoardItem, reviewBoardItem, deleteBoardItem, createRoutine, setRoutineActive, remember,
    spaceDetail, spaceWorkspace, saveSpace, routineDetail, saveRoutine, boardDetail, setBoardRoutine,
    emailDrafts, emailInbox, emailRead, emailMarkSeen, emailTrash, sendEmailDraft, deleteEmailDraft, mwtStatus,
    emailVoice, emailPolicy, saveEmailPolicy, emailDraftWithAi, learnFromEmail,
    connections, saveConnection, removeConnection, probeConnection,
    skills,
    spaceMemory, deleteSpaceMemory, teachings, saveTeaching, editTeaching, revokeTeaching, performance,
    workflowOverview, workflowDetail, createWorkflow, saveWorkflow, addNode, updateNode, removeNode,
    connect: connectNode, disconnect: disconnectNode, setWorkflowStatus, workflowRuns, spaceTopology, exportWorkflow,
    routineWorkflowLinks, setWorkflowConcurrency,
    shareWorkflow, shareSpace, resourceShares, revokeShareGrant, executionHealth,
    workflowTemplates, createWorkflowFromTemplate, importWorkflow,
    captureSpaceSessions, spaceSessions, spaceSessionContent, removeSpaceSession,
    syncContext, workflowPendingChanges, acceptWorkflowChange, rejectWorkflowChange,
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
    deleteSpaceMemory, remember, spaceMemory, surface, view,
    workflowOverview, workflowDetail, createWorkflow, saveWorkflow, addNode, updateNode, removeNode,
    connectNode, disconnectNode, setWorkflowStatus, workflowRuns, spaceTopology, exportWorkflow,
    routineWorkflowLinks, setWorkflowConcurrency,
    shareWorkflow, shareSpace, resourceShares, revokeShareGrant, executionHealth,
    workflowTemplates, createWorkflowFromTemplate, importWorkflow,
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
      'faberloom-board',
      'faberloom-spaces',
      'faberloom-agents',
      'faberloom-routines',
      'faberloom-workflows',
      'faberloom-memory',
      'faberloom-context',
      'faberloom-approvals',
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
      'faberloom-workflows',
      'faberloom-memory',
      'faberloom-context',
      'faberloom-approvals',
      'faberloom-connections',
      'faberloom-email',
    ])
    expect(view.getByText('MWT.ONE')).toBeTruthy()
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

  it('offers reply, chat, mark-read and trash on an unread email task', async () => {
    const message = { id: '42', messageId: '<x@y>', from: 'proveedor@mwt.one', subject: 'OC 505433', date: '2026-09-27' }
    const { runtime, emailMarkSeen, emailTrash, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [], inbox: [message] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('OC 505433')
    const inboxRows = view.getAllByRole('row')
    fireEvent.click(inboxRows[inboxRows.length - 1] as HTMLTableRowElement)
    expect(await view.findByRole('button', { name: 'Reply' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Open chat' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Mark as read' }))
    await waitFor(() => { expect(emailMarkSeen).toHaveBeenCalledWith('42') })
    fireEvent.click(view.getByRole('button', { name: 'Trash' }))
    await waitFor(() => { expect(emailTrash).toHaveBeenCalledWith('42', 'proveedor@mwt.one', 'OC 505433') })
  })

  it('shows the space name and a snippet, and deletes the memory from a modal', async () => {
    const named = { id: 'm1', spaceIds: ['space-1'], createdAt: '2026-09-25T00:00:00Z', text: `Correo «PO 505433»: ${'x'.repeat(400)}` }
    const orphan = { id: 'm2', spaceIds: ['gone'], createdAt: '2026-09-26T00:00:00Z', text: 'Documento «PF 1.pdf»: resumen' }
    const { runtime, deleteSpaceMemory, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, {}, [named, orphan],
    )
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })

    expect(await view.findByText('Marluvas')).toBeTruthy()
    expect(await view.findByText('(deleted space)')).toBeTruthy()

    const target = view.getAllByRole('row').find(row => row.textContent?.includes('Correo «PO 505433»'))
    fireEvent.click(target as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Delete memory' }))
    await waitFor(() => { expect(deleteSpaceMemory).toHaveBeenCalledWith('m1') })
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

  it('keeps the space form usable for a read-only identity (own spaces)', async () => {    const { runtime, createSpace, view } = await bench({ ok: true, value: { ...OVERVIEW, canWrite: false } })
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    fireEvent.click(await view.findByRole('button', { name: 'New space' }))
    const input = await view.findByPlaceholderText('Space name')
    expect(input).toHaveProperty('disabled', false)
    fireEvent.change(input, { target: { value: 'Propio' } })
    fireEvent.click(view.getByRole('button', { name: 'Create' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Propio', undefined, undefined, true) })
  })
})

describe('faberloom work-flow canvas', () => {
  // jsdom omits PointerEvent; the panel listens to pointer events for dragging.
  beforeAll(() => {
    if (window.PointerEvent === undefined) {
      Object.defineProperty(window, 'PointerEvent', { value: window.MouseEvent, configurable: true })
    }
  })

  const row = { id: 'wf1', name: 'Anti-spam', status: 'draft', version: 1, nodes: 2, edges: 1, routineId: null, spaceId: 's1' }

  it('lists, selects, edits, connects, drags, and removes graph nodes', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, workflowRuns,
      addNode, updateNode, removeNode, connectNode, disconnectNode,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    const detailValue = {
      ...row, valid: true, problems: [],
      nodesList: [
        { id: 'n1', kind: 'trigger.email', title: 'correo', x: 0, y: 0, config: {} },
        { id: 'n2', kind: 'agent', title: 'clasifica', x: 260, y: 0, config: { agentId: 'agent-1' } },
      ],
      edgesList: [{ id: 'e1', from: 'n1', to: 'n2', condition: 'spam == true' }],
    }
    const refreshed = { ok: true, value: detailValue }
    workflowDetail.mockResolvedValue(refreshed)
    addNode.mockResolvedValue(refreshed)
    updateNode.mockResolvedValue(refreshed)
    removeNode.mockResolvedValue(refreshed)
    connectNode.mockResolvedValue(refreshed)
    disconnectNode.mockResolvedValue(refreshed)
    workflowRuns.mockResolvedValue({
      ok: true,
      value: [{ id: 'ex1', status: 'completed', routineVersion: 1, createdAt: 'now', updatedAt: 'now' }],
    })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByText(/Anti-spam/))
    expect(await view.findByText('correo')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Logs' }))
    expect(await view.findByText('completed')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Close' }))

    fireEvent.click(view.getByText('correo'))
    fireEvent.change(view.getByPlaceholderText('Title'), { target: { value: 'nuevo' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(updateNode).toHaveBeenCalledWith('wf1', 'n1', 'nuevo', 'trigger.email', '{"match":""}') })

    fireEvent.change(view.getByRole('combobox', { name: 'Node kind' }), { target: { value: 'imap.action' } })
    fireEvent.click(view.getByRole('button', { name: 'Add node' }))
    await waitFor(() => { expect(addNode).toHaveBeenCalledWith('wf1', 'imap.action', 'nuevo', '{"op":"search"}', undefined) })
    fireEvent.click(view.getByRole('button', { name: 'Remove node' }))
    await waitFor(() => { expect(removeNode).toHaveBeenCalledWith('wf1', 'n1') })

    fireEvent.keyDown(window, { key: 'Delete' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => { expect(removeNode).toHaveBeenCalledTimes(2) })

    fireEvent.click(view.getByRole('button', { name: 'Connections' }))
    fireEvent.click(view.getByRole('button', { name: /Disconnect/ }))
    await waitFor(() => { expect(disconnectNode).toHaveBeenCalledWith('wf1', 'e1') })

    fireEvent.click(view.getByText('correo'))
    fireEvent.click(view.getByRole('button', { name: 'Connect' }))
    fireEvent.click(view.getByText('clasifica'))
    await waitFor(() => { expect(connectNode).toHaveBeenCalledWith('wf1', 'n1', 'n2', undefined) })

    const svg = view.container.querySelector('svg[viewBox="0 0 900 320"]') as SVGSVGElement
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 900, height: 320, right: 900, bottom: 320, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.pointerDown(view.getByText('correo'))
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 160 })
    fireEvent.pointerUp(svg)
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 160 })
    await waitFor(() => { expect(svg.textContent).toContain('correo') })
  })

  it('auto-selects a flow created from a template so its graph appears', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, workflowTemplates, createWorkflowFromTemplate,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [] })
    workflowTemplates.mockResolvedValue({
      ok: true,
      value: [{ id: 'anti-spam', name: 'Anti-spam', description: 'clasifica', nodes: 1, edges: 0 }],
    })
    createWorkflowFromTemplate.mockResolvedValue({
      ok: true,
      value: [{ id: 'wf2', name: 'Anti-spam', status: 'draft', version: 1, nodes: 1, edges: 0, routineId: null }],
    })
    workflowDetail.mockResolvedValue({
      ok: true,
      value: {
        id: 'wf2', name: 'Anti-spam', status: 'draft', version: 1, routineId: null,
        valid: true, problems: [], maxConcurrency: null,
        nodesList: [{ id: 'n1', kind: 'trigger.email', title: 'correo', x: 0, y: 0, config: {} }],
        edgesList: [],
      },
    })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(view.getByRole('button', { name: 'Templates' }))
    await view.findByRole('option', { name: 'Anti-spam' })
    fireEvent.change(view.getByRole('combobox', { name: 'Templates' }), { target: { value: 'anti-spam' } })
    await waitFor(() => {
      expect((view.getByRole('combobox', { name: 'Templates' }) as HTMLSelectElement).value).toBe('anti-spam')
    })
    fireEvent.click(view.getByRole('button', { name: 'Use template' }))

    await waitFor(() => { expect(workflowDetail).toHaveBeenCalledWith('wf2') })
    expect(await view.findByText('correo')).toBeTruthy()
  })

  it('creates, activates, exports, and points nodes at an agent and a connection', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, createWorkflow,
      setWorkflowStatus, exportWorkflow, updateNode, spaceTopology,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    const detailValue = {
      ...row, valid: true, problems: [], edgesList: [],
      nodesList: [
        { id: 'n1', kind: 'agent', title: 'clasifica', x: 0, y: 0, config: {} },
        { id: 'n2', kind: 'imap.action', title: 'borra', x: 260, y: 0, config: {} },
      ],
    }
    const refreshed = { ok: true, value: detailValue }
    workflowDetail.mockResolvedValue(refreshed)
    setWorkflowStatus.mockResolvedValue(refreshed)
    updateNode.mockResolvedValue(refreshed)
    spaceTopology.mockResolvedValue({
      ok: true,
      value: {
        spaces: [{ id: 's1', title: 'Marluvas' }],
        agents: [{ id: 'agent-1', name: 'Proformas' }],
        connections: [{ id: 'c1', label: 'IMAP' }],
        workspaces: [],
      },
    })
    createWorkflow.mockResolvedValue({ ok: true, value: [{ ...row, nodes: 2, edges: 0 }] })
    exportWorkflow.mockResolvedValue({ ok: true, value: { format: 'json', content: '{}' } })
    const open = vi.fn(() => null)
    const originalOpen = window.open
    window.open = open
    const urlAny = URL as unknown as { createObjectURL?: (blob: Blob) => string }
    const originalCreate = urlAny.createObjectURL
    urlAny.createObjectURL = vi.fn(() => 'blob:x')
    try {
      act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
      // The first flow is selected on load, so its graph is on screen.
      expect(await view.findByText(/Anti-spam/)).toBeTruthy()
      expect(await view.findByText('clasifica')).toBeTruthy()

      fireEvent.click(view.getByRole('button', { name: 'New flow' }))
      expect(createWorkflow).not.toHaveBeenCalled()
      fireEvent.change(view.getByPlaceholderText('Flow name'), { target: { value: 'Anti-spam' } })
      fireEvent.click(view.getByRole('button', { name: 'New flow' }))
      await waitFor(() => { expect(createWorkflow).toHaveBeenCalledWith('Anti-spam', 's1') })

      fireEvent.click(await view.findByText(/Anti-spam/))
      fireEvent.click(await view.findByRole('button', { name: 'Activate' }))
      await waitFor(() => { expect(setWorkflowStatus).toHaveBeenCalledWith('wf1', 'active') })
      fireEvent.click(view.getByRole('button', { name: 'Pause' }))
      await waitFor(() => { expect(setWorkflowStatus).toHaveBeenCalledWith('wf1', 'paused') })
      fireEvent.click(view.getByRole('button', { name: 'Export JSON' }))
      await waitFor(() => { expect(exportWorkflow).toHaveBeenCalledWith('wf1', 'json') })
      expect(open).toHaveBeenCalled()

      fireEvent.click(view.getByText('clasifica'))
      fireEvent.change(view.getByRole('combobox', { name: 'Agent' }), { target: { value: 'agent-1' } })
      await waitFor(() => {
        expect(updateNode).toHaveBeenCalledWith('wf1', 'n1', 'clasifica', 'agent', JSON.stringify({ agentId: 'agent-1' }))
      })

      fireEvent.click(view.getByText('borra'))
      fireEvent.change(view.getByRole('combobox', { name: 'Connection' }), { target: { value: 'c1' } })
      await waitFor(() => {
        expect(updateNode).toHaveBeenCalledWith('wf1', 'n2', 'borra', 'imap.action', JSON.stringify({ connectionId: 'c1' }))
      })
      expect(view.getAllByText(/Marluvas/).length).toBeGreaterThan(0)
    } finally {
      window.open = originalOpen
      if (originalCreate === undefined) delete urlAny.createObjectURL
      else urlAny.createObjectURL = originalCreate
    }
  })

  it('surfaces detail, create, export, and rejected-action failures', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, createWorkflow, exportWorkflow, addNode,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    workflowDetail.mockResolvedValue({ ok: false, error: { message: 'detail-down' } })
    createWorkflow.mockResolvedValue({ ok: false, error: { message: 'create-down' } })
    exportWorkflow.mockResolvedValue({ ok: false, error: { message: 'export-down' } })
    addNode.mockRejectedValueOnce(new Error('boom'))

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByText(/Anti-spam/))
    expect(await view.findByText('detail-down')).toBeTruthy()

    fireEvent.change(view.getByPlaceholderText('Flow name'), { target: { value: 'X' } })
    fireEvent.click(view.getByRole('button', { name: 'New flow' }))
    expect(await view.findByText('create-down')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Add node' }))
    expect(await view.findByText(/boom/)).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Export JSON' }))
    await waitFor(() => { expect(exportWorkflow).toHaveBeenCalledWith('wf1', 'json') })
  })

  it('creates a flow from the template gallery and imports a JSON export', async () => {
    const {
      runtime, view, workflowOverview, workflowTemplates, createWorkflowFromTemplate, importWorkflow,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    workflowTemplates.mockResolvedValue({
      ok: true,
      value: [{ id: 'anti-spam', name: 'Anti-spam', description: 'clasifica', nodes: 5, edges: 5 }],
    })
    createWorkflowFromTemplate.mockResolvedValue({ ok: true, value: [row] })
    importWorkflow.mockResolvedValue({ ok: true, value: [row] })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    await waitFor(() => { expect(workflowTemplates).toHaveBeenCalled() })

    fireEvent.click(view.getByRole('button', { name: 'Templates' }))
    // Using the gallery without picking a template does nothing.
    fireEvent.click(view.getByRole('button', { name: 'Use template' }))
    expect(createWorkflowFromTemplate).not.toHaveBeenCalled()
    await view.findByRole('option', { name: 'Anti-spam' })
    fireEvent.change(view.getByRole('combobox', { name: 'Templates' }), { target: { value: 'anti-spam' } })
    await waitFor(() => {
      expect((view.getByRole('combobox', { name: 'Templates' }) as HTMLSelectElement).value).toBe('anti-spam')
    })
    fireEvent.click(view.getByRole('button', { name: 'Use template' }))
    await waitFor(() => { expect(createWorkflowFromTemplate).toHaveBeenCalledWith('anti-spam', undefined) })

    fireEvent.click(view.getByRole('button', { name: 'Templates' }))
    const file = { text: async () => '{"format":"faberloom-workflow"}' } as unknown as File
    fireEvent.change(view.getByLabelText('Import JSON'), { target: { files: [file] } })
    await waitFor(() => { expect(importWorkflow).toHaveBeenCalledWith('{"format":"faberloom-workflow"}', undefined) })
  })

  it('stays usable when the overview and topology reads fail', async () => {
    const { runtime, view, workflowOverview, spaceTopology } = await bench()
    workflowOverview.mockRejectedValueOnce(new Error('down'))
    spaceTopology.mockRejectedValueOnce(new Error('down'))
    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    expect(await view.findByText('No flows yet')).toBeTruthy()
  })

  it('edits a schedule trigger, the concurrency cap, and shows routine links', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, updateNode,
      setWorkflowConcurrency, routineWorkflowLinks,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    const detail = {
      ...row, valid: true, problems: [], maxConcurrency: 2, edgesList: [],
      nodesList: [{
        id: 'n1', kind: 'trigger.schedule', title: 'cada 12 h', x: 0, y: 0,
        config: { recurrence: 'every:12h', timezone: 'Europe/Madrid', window: { from: 8, to: 18 }, days: [1, 2, 3], businessDays: true },
      }],
    }
    const refreshed = { ok: true, value: detail }
    workflowDetail.mockResolvedValue(refreshed)
    updateNode.mockResolvedValue(refreshed)
    setWorkflowConcurrency.mockResolvedValue(refreshed)
    routineWorkflowLinks.mockResolvedValue({
      ok: true,
      value: [{ routineId: 'r1', routineName: 'Vigía', workflowId: 'wf1', workflowName: 'Anti-spam', direction: 'routine-to-workflow' }],
    })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByRole('button', { name: /Anti-spam · draft/ }))
    fireEvent.click(await view.findByText('cada 12 h'))
    fireEvent.click(view.getByRole('button', { name: 'Routines' }))
    expect(await view.findByText('Vigía → Anti-spam')).toBeTruthy()

    const concurrencyBox = view.getByRole('textbox', { name: 'Max concurrency' }) as HTMLInputElement
    expect(concurrencyBox.value).toBe('2')
    fireEvent.change(concurrencyBox, { target: { value: '3' } })
    fireEvent.click(view.getByRole('button', { name: 'Save concurrency' }))
    await waitFor(() => { expect(setWorkflowConcurrency).toHaveBeenCalledWith('wf1', 3) })

    fireEvent.click(view.getByText('cada 12 h'))
    fireEvent.change(view.getByRole('textbox', { name: 'Cadence or cron' }), { target: { value: '0 7 * * *' } })
    fireEvent.click(view.getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith('wf1', 'n1', 'cada 12 h', 'trigger.schedule', expect.stringContaining('0 7 * * *'))
    })
  })

  it('shares the selected flow with an email and revokes the grant', async () => {
    const {
      runtime, view, workflowOverview, workflowDetail, resourceShares, shareWorkflow, revokeShareGrant,
    } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    const detailValue = { ...row, valid: true, problems: [], maxConcurrency: null, nodesList: [], edgesList: [] }
    workflowDetail.mockResolvedValue({ ok: true, value: detailValue })
    const grant = {
      id: 'g1', resourceKind: 'workflow', resourceId: 'wf1', resourceName: 'Anti-spam', ownerId: 'owner@muitowork.com',
      granteeEmail: 'guest@proveedor.com', permissions: ['view'], permissionLabel: 'view', status: 'pending',
      createdAt: 'now', acceptedAt: null,
    }
    resourceShares.mockResolvedValue({ ok: true, value: [grant] })
    shareWorkflow.mockResolvedValue({ ok: true, value: [{ ...grant, id: 'g2', granteeEmail: 'nuevo@proveedor.com' }] })
    revokeShareGrant.mockResolvedValue({ ok: true, value: [] })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByText(/Anti-spam/))
    fireEvent.click(view.getByRole('button', { name: 'Share' }))
    expect(await view.findByText('guest@proveedor.com')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => { expect(revokeShareGrant).toHaveBeenCalledWith('g1') })

    fireEvent.change(view.getByRole('textbox', { name: 'Guest email' }), { target: { value: 'nuevo@proveedor.com' } })
    fireEvent.click(view.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => { expect(shareWorkflow).toHaveBeenCalledWith('wf1', ['nuevo@proveedor.com'], ['view']) })
    expect(await view.findByText('nuevo@proveedor.com')).toBeTruthy()
  })
})
