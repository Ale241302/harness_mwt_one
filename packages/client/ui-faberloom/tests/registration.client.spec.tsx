// @vitest-environment jsdom
/** FaberLoom surface: identity tokens, brand name, real workspace reads, and panel switching. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { es as commonEs } from '@deepseek-ai/dsh-client-locale/src/locales/es.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { resolveSlotLabel, type PropsRenderSlots, type PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import { apply, inject } from '../src/client/index.ts'
import { FABERLOOM_SECTIONS, resolveSectionNav, sectionBadge } from '../src/client/panels.tsx'
import { McpServersSection, type McpServersSectionInjected } from '../src/client/mcp-servers-section.tsx'
import { en as faberloomEn, es as faberloomEs, zh as faberloomZh, type FaberloomKey } from '../src/client/locales.ts'
import css from '../src/client/faberloom.module.css'

const CONVERSAR = 'faberloom-conversar' as MainPanelId
const BOARD = 'faberloom-board' as MainPanelId
const SPACES = 'faberloom-spaces' as MainPanelId
const MEMORY = 'faberloom-memory' as MainPanelId
const EMAIL = 'faberloom-email' as MainPanelId
const WORKFLOWS = 'faberloom-workflows' as MainPanelId
const ROUTINES = 'faberloom-routines' as MainPanelId
const SKILLS = 'faberloom-agents' as MainPanelId
const CONNECTIONS = 'faberloom-connections' as MainPanelId
const CONTEXT = 'faberloom-context' as MainPanelId

const OVERVIEW = {
  spaces: [{ id: 'space-1', title: 'Marluvas', parentId: null, agentId: 'agent-1', agentName: 'Proformas', workspaceId: 'ws-1' }],
  agents: [{ id: 'agent-1', name: 'Proformas', spaceIds: ['space-1'], detached: false, active: true }],
  board: [{
    id: 'item-1', title: 'Preparar proforma', status: 'waiting_approval', state: 'PENDIENTE_CRITERIO',
    column: 'TU_CRITERIO', severity: 'MEDIUM', routineId: null, spaceId: null, accountRef: 'eguisa',
    artifactType: 'proforma', dueAt: null, valueUsd: null, hasCandidate: false, hasDraft: false,
  }],
  routines: [{ id: 'routine-1', name: 'Pedido a proforma', status: 'active' }],
  memory: [{ id: 'mem-1', kind: 'episodic', text: 'El precio de Eguisa se consulta antes de cotizar.', at: '2026-09-16T00:00:00Z' }],
  canWrite: true,
}

const EMPTY = { spaces: [], agents: [], board: [], routines: [], memory: [], canWrite: true }

const DETAIL = {
  id: 'item-1', title: 'Preparar proforma', status: 'waiting_approval', state: 'PENDIENTE_CRITERIO',
  column: 'TU_CRITERIO', version: 1, rowVersion: 2, summary: 'Borrador', evidence: ['oc:505288'],
  approvedRevision: null, stale: false, staleReason: null, severity: 'MEDIUM', severitySource: 'HUMAN',
  severityConfidence: null, dueAt: null, valueUsd: 1200, dataClass: 'N2', dataClassProvisional: true,
  artifactType: 'proforma', accountRef: 'eguisa', artifactHash: 'h1', runId: 'run-1', supersedesItemId: null,
  pendingCandidate: null, spaceId: null, iterationId: null, iterationDraftKey: null, editDraft: null,
  events: [], effects: [], routineId: null,
  checks: [], missingChecks: [], checksError: null, fieldOrigins: [], transferredDrafts: [],
}

const IDLE_ATTEMPT = {
  phase: 'idle', iterationId: null, generation: 0, baseVersion: null, lockUntil: null, lockBy: null,
  renewalSeconds: 30, rounds: 0, roundLimit: 5, suggestRewrite: false,
  draftOutdated: false, candidatePending: false, draft: null, draftLinked: false,
}

const LIVE_ATTEMPT = {
  ...IDLE_ATTEMPT, phase: 'active', iterationId: 'iter-1', generation: 4, baseVersion: 1,
  lockUntil: new Date(Date.now() + 9 * 60_000).toISOString(), draftLinked: true,
  draft: {
    iterationId: 'iter-1', baseVersion: 1, summary: 'Borrador', evidence: [], outdated: false, archived: false,
    superseded: false, retained: true, updatedAt: '2026-10-28T10:00:00Z',
  },
}

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
  panels: { skills?: unknown[]; connections?: unknown[]; context?: unknown[] } = {},
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
  const prepareHarness = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { root: '/work/marluvas', written: ['AGENTS.md'], pruned: [] } }))
  const spaceWorkspace = vi.fn(async () => ({ ok: true, value: { registered: true, workspaceId: 'ws-1', title: 'Marluvas', sessions: 0 } }))
  const routineDetail = vi.fn(async () => ({
    ok: true,
    value: {
      id: 'routine-1', name: 'Pedido a proforma', status: 'active', version: 1, versions: [1], spaceId: null,
      intent: '', triggerKind: 'manual', triggerMatch: null, triggerTimezone: null, triggerDays: [],
      triggerWindowFrom: null, triggerWindowTo: null, triggerBusinessDays: false, maxConcurrency: null,
      steps: [], expectedResult: '', permissions: [], failurePolicy: 'review',
    },
  }))
  const boardDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardSetSeverity = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardSaveEdits = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { detail: null, correctionError: null },
  }))
  const boardApprove = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardApproveWithEdits = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardDiscard = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardResolveCandidate = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardAssignWorkspace = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardEvents = vi.fn(async () => ({ ok: true, value: [] }))
  const boardGetDraft = vi.fn(async (): Promise<unknown> => ({ ok: true, value: null }))
  const boardSaveDraft = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { revision: 1, writerSession: 'tab', changes: {} } }))
  const boardTakeDraft = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { revision: 2, writerSession: 'tab', changes: {} } }))
  const boardDiscardDraft = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const boardRevalidate = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardIteration = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const boardIterationContext = vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined }))
  const boardIterationStart = vi.fn(async (): Promise<unknown> => ({ ok: true, value: LIVE_ATTEMPT }))
  const boardIterationSaveDraft = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { summary: 'Borrador', baseVersion: 1, linked: true },
  }))
  const boardIterationApply = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { iteration: IDLE_ATTEMPT, correctionError: null },
  }))
  const boardIterationRenew = vi.fn(async (): Promise<unknown> => ({ ok: true, value: LIVE_ATTEMPT }))
  const boardIterationPause = vi.fn(async (): Promise<unknown> => ({ ok: true, value: IDLE_ATTEMPT }))
  const boardIterationCancel = vi.fn(async (): Promise<unknown> => ({ ok: true, value: IDLE_ATTEMPT }))
  const boardIterationResume = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { status: 'started', iteration: LIVE_ATTEMPT, differences: [] },
  }))
  const boardIterationRecover = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { status: 'started', iteration: LIVE_ATTEMPT, differences: [] },
  }))
  const boardIterationDraft = vi.fn(async (): Promise<unknown> => ({
    ok: true, value: { draft: null, differences: [] },
  }))
  const setBoardRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const emailDrafts = vi.fn(async () => ({ ok: true, value: email.drafts ?? [] }))
  const saveEmailDraft = vi.fn(async () => ({
    ok: true,
    value: { id: 'draft-1', to: [], cc: [], subject: 'Propuesta', text: 'cuerpo', status: 'draft', aiText: null, inReplyTo: null, spaceId: null, createdAt: '2026-09-27T00:00:00Z' },
  }))
  const emailInbox = vi.fn(async () => ({ ok: true, value: email.inbox ?? [] }))
  const emailRead = vi.fn(async () => ({ ok: true, value: { account: 'alejandro@muitowork.com', text: 'cuerpo', html: null, attachments: [] } }))
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
  const removeRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const executions = vi.fn(async () => ({ ok: true, value: [] }))
  const startRoutine = vi.fn(async () => ({ ok: true, value: [] }))
  const tickRoutine = vi.fn(async () => ({ ok: true, value: [] }))
  const reconcileExecution = vi.fn(async () => ({ ok: true, value: [] }))
  const cancelExecutionEffect = vi.fn(async () => ({ ok: true, value: [] }))
  const connections = vi.fn(async () => ({ ok: true, value: panels.connections ?? [] }))
  const skills = vi.fn(async () => ({ ok: true, value: panels.skills ?? [] }))
  const contextEntries = vi.fn(async () => ({ ok: true, value: panels.context ?? [] }))
  const contextVersions = vi.fn(async () => ({ ok: true, value: [] }))
  const contextAction = vi.fn(async () => ({ ok: true, value: panels.context ?? [] }))
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
  const setMemoryVisibility = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const setWorkflowVisibility = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const saveSkill = vi.fn(async (_name: string, _markdown: string): Promise<unknown> => ({ ok: true, value: panels.skills ?? [] }))
  const skillMarkdown = vi.fn(async (_name: string): Promise<unknown> => ({ ok: true, value: '---\nname: mwt-admin-builder-crear\ndescription: Crea una orden de compra\n---\n\nCuerpo.\n' }))
  const setRoutineVisibility = vi.fn(async (): Promise<unknown> => ({ ok: true, value: OVERVIEW }))
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
  const saveSpaceAttachment = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { files: [] } }))
  const sendSpaceFileByEmail = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { messageId: '<m@x>', accepted: [] } }))
  const exportSpaceViewToFolder = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { path: '/tmp/x', bytes: 1 } }))
  const mcpServers = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const saveMcpServer = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const removeMcpServer = vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] }))
  const probeMcpServer = vi.fn(async (): Promise<unknown> => ({ ok: true, value: { ok: true, tools: [] } }))
  const faberloomView = {
    overview, createSpace, deleteSpace, openSpaceWorkspace, renameSpace, createAgent, renameAgent,
    deactivateAgent, reviewBoardItem, deleteBoardItem, createRoutine, setRoutineActive, remember,
    spaceDetail, spaceWorkspace, saveSpace, routineDetail, saveRoutine, boardDetail, setBoardRoutine, prepareHarness,
    boardSetSeverity, boardSaveEdits, boardApprove, boardApproveWithEdits, boardDiscard, boardResolveCandidate,
    boardAssignWorkspace, boardEvents, boardGetDraft, boardSaveDraft, boardTakeDraft, boardDiscardDraft, boardRevalidate,
    boardIteration, boardIterationContext, boardIterationStart, boardIterationSaveDraft, boardIterationApply,
    boardIterationRenew, boardIterationPause, boardIterationCancel, boardIterationResume, boardIterationRecover,
    boardIterationDraft,
    removeRoutine, executions, startRoutine, tickRoutine, reconcileExecution, cancelExecutionEffect,
    emailDrafts, emailInbox, emailRead, emailMarkSeen, emailTrash, sendEmailDraft, deleteEmailDraft, saveEmailDraft, mwtStatus,
    emailVoice, emailPolicy, saveEmailPolicy, emailDraftWithAi, learnFromEmail,
    connections, saveConnection, removeConnection, probeConnection,
    skills,
    saveSkill,
    skillMarkdown,
    removeSkill: vi.fn(async () => ({ ok: true, value: panels.skills ?? [] })),
    shareSkill: vi.fn(async () => ({ ok: true, value: { outgoing: [] } })),
    shareAgent: vi.fn(async () => ({ ok: true, value: { outgoing: [] } })),
    shares: vi.fn(async () => ({ ok: true, value: { outgoing: [] } })),
    unshareShare: vi.fn(async () => ({ ok: true, value: { outgoing: [] } })),
    pickFolder: vi.fn(async () => null),
    pickArchive: vi.fn(async () => null),
    modelCatalog: vi.fn(async () => ({ ok: true, value: { providers: [] } })),
    mcpTokens: vi.fn(async () => ({ ok: true, value: [] })),
    mintMcpToken: vi.fn(async () => ({ ok: true, value: [] })),
    revokeMcpToken: vi.fn(async () => ({ ok: true, value: [] })),
    grants: vi.fn(async () => ({ ok: true, value: [] })),
    grant: vi.fn(async () => ({ ok: true, value: [] })),
    revokeGrant: vi.fn(async () => ({ ok: true, value: [] })),
    backups: vi.fn(async () => ({ ok: true, value: [] })),
    createBackup: vi.fn(async () => ({ ok: true, value: [] })),
    verifyBackup: vi.fn(async () => ({ ok: true, value: [] })),
    restoreBackup: vi.fn(async () => ({ ok: true, value: [] })),
    deleteBackup: vi.fn(async () => ({ ok: true, value: [] })),
    contextEntries, createContext: contextAction, updateContext: contextAction, contextVersions,
    restoreContext: contextAction, approveContext: contextAction, rejectContext: contextAction,
    removeContext: contextAction, exportContext: vi.fn(async () => ({ ok: true, value: { filename: 'c.json', content: '{}' } })),
    importContext: contextAction,
    skillInstalls: vi.fn(async () => ({ ok: true, value: [] })),
    installHarness: vi.fn(async () => ({ ok: true, value: { status: 'installed', source: '/fuentes/ECC', root: '/fuentes/ECC', parts: [], outcomes: [] } })),
    uninstallSkill: vi.fn(async () => ({ ok: true, value: [] })),
    spaceMemory, deleteSpaceMemory, teachings, saveTeaching, editTeaching, revokeTeaching, performance,
    workflowOverview, workflowDetail, createWorkflow, saveWorkflow, addNode, updateNode, removeNode,
    connect: connectNode, disconnect: disconnectNode, setWorkflowStatus, workflowRuns, spaceTopology, exportWorkflow,
    routineWorkflowLinks, setWorkflowConcurrency,
    shareWorkflow, shareSpace, resourceShares, revokeShareGrant, executionHealth,
    workflowTemplates, createWorkflowFromTemplate, importWorkflow,
    captureSpaceSessions, spaceSessions, spaceSessionContent, removeSpaceSession,
    syncContext, workflowPendingChanges, acceptWorkflowChange, rejectWorkflowChange,
    setMemoryVisibility, setWorkflowVisibility, setRoutineVisibility,
    saveSpaceAttachment, sendSpaceFileByEmail, exportSpaceViewToFolder,
    mcpServers, saveMcpServer, removeMcpServer, probeMcpServer,
  }
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('theme', theme as never)
      ctx.provide('layout', layout as never)
      ctx.provide('locale', locale)
      ctx.provide('remote', { faberloomView, $on: vi.fn(() => () => {}) } as never)
      ctx.provide('remote.faberloomView', faberloomView as never)
      ctx.provide('remote.directoryPicker', {
        pick: vi.fn(async (): Promise<unknown> => ({ ok: true, value: null })),
        list: vi.fn(async (): Promise<unknown> => ({ ok: true, value: [] })),
        createDirectory: vi.fn(async (): Promise<unknown> => ({ ok: true, value: '' })),
      } as never)
      // The chat gestures register into these seats; the panel specs stub them
      // (`sessions` is already provided by the slot test runtime).
      ctx.provide('inputTriggers', { registerSource: vi.fn(() => () => {}), sessionOf: vi.fn() } as never)
      ctx.provide('commandUi', { register: vi.fn(() => () => {}), decorate: vi.fn(() => () => {}), dismiss: vi.fn(), popupFor: vi.fn() } as never)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn, es: commonEs }), 'test: common locale')
      ctx.slots.installLocale(locale)
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar.brand.name' | 'sidebar.panellist' | 'sidebar.footer.action' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <header>{renderSlot('sidebar.brand.name', {})}</header>
        <nav>{renderSlot('sidebar.panellist', { size: 16, active: false })}</nav>
        <footer>{renderSlot('sidebar.footer.action', { wide: true })}</footer>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? CONVERSAR })}</main>
      </>
    )
  }
  await runtime.root.declare({
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  // Record every registration the surface makes, so the sidebar row metadata
  // (mode, group, badge) can be asserted even before the sidebar projects it.
  const registrations: Record<string, unknown>[] = []
  const originalRegister = runtime.slots.register
  vi.spyOn(runtime.slots, 'register').mockImplementation(((options: unknown, component: unknown) => {
    registrations.push(options as Record<string, unknown>)
    return originalRegister.call(runtime.slots, options as never, component as never)
  }) as never)
  const surface = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return {
    runtime, theme, layout, locale, overview, createSpace, deleteSpace, openSpaceWorkspace, saveSpace, prepareHarness,
    deleteBoardItem, boardDetail, boardSaveEdits, boardTakeDraft, boardRevalidate, boardApprove, boardApproveWithEdits,
    boardSaveDraft, boardAssignWorkspace,
    boardIteration, boardIterationContext, boardIterationStart, boardIterationSaveDraft, boardIterationApply,
    boardIterationRenew, boardIterationPause, boardIterationCancel, boardIterationResume, boardIterationRecover,
    boardIterationDraft,
    emailDrafts, emailInbox, emailMarkSeen, emailTrash, sendEmailDraft, deleteEmailDraft,
    deleteSpaceMemory, remember, spaceMemory, surface, view, registrations,
    connections, saveConnection, removeConnection, probeConnection, skills, contextEntries,
    workflowOverview, workflowDetail, createWorkflow, saveWorkflow, addNode, updateNode, removeNode,
    connectNode, disconnectNode, setWorkflowStatus, workflowRuns, spaceTopology, exportWorkflow,
    routineWorkflowLinks, setWorkflowConcurrency,
    shareWorkflow, shareSpace, resourceShares, revokeShareGrant, executionHealth,
    workflowTemplates, createWorkflowFromTemplate, importWorkflow,
    setMemoryVisibility, setWorkflowVisibility, setRoutineVisibility,
    saveRoutine, createRoutine, routineDetail, removeRoutine, setRoutineActive,
    mcpServers, saveMcpServer, removeMcpServer, probeMcpServer,
    saveSkill, skillMarkdown, executions, reconcileExecution,
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
      'faberloom-files',
      'faberloom-routines',
      'faberloom-workflows',
      'faberloom-memory',
      'faberloom-context',
      'faberloom-approvals',
      'faberloom-agents',
      'faberloom-email',
      'faberloom-connections',
    ])
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual([
      'faberloom-conversar',
      'faberloom-board',
      'faberloom-spaces',
      'faberloom-files',
      'faberloom-agents',
      'faberloom-routines',
      'faberloom-workflows',
      'faberloom-memory',
      'faberloom-context',
      'faberloom-approvals',
      'faberloom-connections',
      'faberloom-email',
    ])
    expect(view.getByText('Faber').style.color).toBe('var(--dsw-alias-brand-primary-new-colorprimary-new-color)')
    expect(view.getByText('Loom').style.color).toBe('var(--dsw-alias-label-primary)')
    expect(view.getByRole('heading', { name: 'What do you want to solve today?' })).toBeTruthy()
    await surface.dispose()
  })

  it('adds the web sign-out action beside the Settings control', async () => {
    const { runtime, registrations, surface } = await bench()
    expect(registrations.filter(options => options.name === 'sidebar.footer.action')).toHaveLength(1)
    expect(runtime.slots.entries('sidebar.footer.action')).toHaveLength(1)
    await surface.dispose()
  })

  it('contributes the MCP-servers page to Settings, reading through the product Remote', async () => {
    const { runtime, mcpServers, saveMcpServer, removeMcpServer, probeMcpServer } = await bench()
    const section = runtime.slots.entries('settings.section')[0]
    if (section === undefined) throw new Error('the MCP servers section is not registered')
    expect(section.component).toBe(McpServersSection)
    expect(section.options).toMatchObject({ id: 'faberloom-mcp-servers', order: 30 })
    expect(section.locale).toBe('faberloom')
    expect(resolveSlotLabel(section.options.label)).toBe('MCP servers')

    // The section reaches the host registry only through the product's own view
    // Remote; its face carries the four calls the page needs and nothing else.
    const injected = (section.inject as unknown as () => McpServersSectionInjected)()
    await injected.load()
    await injected.save({ name: 'docs', transport: 'stdio', command: 'npx' })
    await injected.remove('docs')
    await injected.test({ name: 'docs', transport: 'stdio', command: 'npx' })
    expect(mcpServers).toHaveBeenCalledOnce()
    expect(saveMcpServer).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx' })
    expect(removeMcpServer).toHaveBeenCalledWith('docs')
    expect(probeMcpServer).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx' })
  })

  it('renders the two-tone wordmark: coral on "Faber", the ground ink on "Loom"', async () => {
    const { view } = await bench()
    const faber = view.getByText('Faber')
    const loom = view.getByText('Loom')
    // The first half keeps the coral alias; the second takes the label alias,
    // which resolves to ink on the light palettes and cream on the dark ones.
    // A palette edit can never collapse the wordmark back to a single ink.
    expect(faber.style.color).toBe('var(--dsw-alias-brand-primary-new-colorprimary-new-color)')
    expect(loom.style.color).toBe('var(--dsw-alias-label-primary)')
    // The two halves are one lockup, rendered in the sidebar brand slot.
    expect(faber.parentElement).toBe(loom.parentElement)
    expect(faber.closest('header')).not.toBeNull()
  })

  it('labels each sidebar row with its mode, group, and live overview badge', async () => {
    const { registrations, runtime, locale, view } = await bench()
    type NavRow = { id: string; mode: () => string; group: () => string; badge?: () => string }
    const rows = registrations.filter(options => options.name === 'sidebar.panellist')
    const byId = new Map(rows.map(options => [String(options.id), options as unknown as NavRow]))

    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    await view.findByRole('button', { name: 'Marluvas' })

    expect(byId.get('faberloom-board')?.mode?.()).toBe('Operate')
    expect(byId.get('faberloom-board')?.group?.()).toBe('Work')
    expect(byId.get('faberloom-board')?.badge?.()).toBe('1')
    expect(byId.get('faberloom-spaces')?.badge?.()).toBe('1')
    expect(byId.get('faberloom-agents')?.mode?.()).toBe('Admin')
    expect(byId.get('faberloom-agents')?.group?.()).toBe('Setup')
    expect(byId.get('faberloom-memory')?.group?.()).toBe('Knowledge')
    expect(byId.get('faberloom-approvals')?.group?.()).toBe('Inbox')
    // A section without an overview count carries no badge at all.
    expect(byId.get('faberloom-approvals')?.badge).toBeUndefined()
    expect(byId.get('faberloom-workflows')?.badge).toBeUndefined()

    // The copy seat follows the active locale, so the same row re-labels in place.
    act(() => { locale.setLocale('zh') })
    await waitFor(() => { expect(byId.get('faberloom-board')?.mode?.()).toBe('操作') })
    expect(byId.get('faberloom-board')?.group?.()).toBe('工作')
  })

  it('resolves mode, group, and badge copy from the dictionaries without inventing a count', () => {
    const board = FABERLOOM_SECTIONS.find(section => section.id === 'faberloom-board')
    const workflows = FABERLOOM_SECTIONS.find(section => section.id === 'faberloom-workflows')
    if (board === undefined || workflows === undefined) throw new Error('sections missing')
    const overview = { board: [{}, {}] } as unknown as FaberLoomOverview
    const t = (key: FaberloomKey): string => faberloomEn[key]

    // No read yet, no count, or a zero count renders no badge.
    expect(sectionBadge(board, null)).toBe('')
    expect(sectionBadge(workflows, overview)).toBe('')
    expect(sectionBadge(board, { board: [] } as unknown as FaberLoomOverview)).toBe('')
    // The real overview count is the only badge source.
    expect(sectionBadge(board, overview)).toBe('2')

    expect(resolveSectionNav(board, t, overview)).toEqual({ mode: 'Operate', group: 'Work', badge: '2' })
    expect(resolveSectionNav(board, key => faberloomEs[key], overview).mode).toBe('Operar')
    expect(resolveSectionNav(board, key => faberloomZh[key], null)).toEqual({ mode: '操作', group: '工作', badge: '' })
  })

  it('pans the table inside its card and keeps the inspector reachable below the split', async () => {
    const { runtime, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    await view.findByRole('button', { name: 'Marluvas' })

    const split = view.container.querySelector(`.${css.split}`)
    expect(split).not.toBeNull()
    const scroll = split?.querySelector(`.${css.tableScroll}`)
    expect(scroll).not.toBeNull()
    const inspector = split?.querySelector(`.${css.inspector}`)
    expect(inspector).not.toBeNull()
    // Source order is table first, inspector last, so the single-column collapse
    // puts the detail editor under the list.
    expect(split?.firstElementChild?.contains(scroll ?? null)).toBe(true)
    expect(split?.lastElementChild).toBe(inspector)

    // A selected row is announced for assistive tech and carries the accent.
    const rows = await view.findAllByRole('row')
    fireEvent.click(rows[1] as HTMLTableRowElement)
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true')
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

  it('locks the editor to one tab and hands over control', async () => {
    const detail = {
      ...DETAIL,
      editDraft: { revision: 3, writerSession: 'other-tab', changes: { summary: 'borrador ajeno' } },
    }
    const { runtime, view, boardDetail, boardTakeDraft } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: detail } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.foreignDraft'])).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)

    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.takeControl'] }))
    await waitFor(() => { expect(boardTakeDraft).toHaveBeenCalledWith('item-1', expect.stringMatching(/^tab-/)) })
  })

  it('announces the retained draft and offers to resume it', async () => {
    const { runtime, view, boardDetail, boardIteration } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, iterationDraftKey: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: { ...IDLE_ATTEMPT, draft: LIVE_ATTEMPT.draft } } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iterationDraft'])).toBeTruthy()
    expect(view.getByRole('button', { name: faberloomEn['mesa.iterationOpen'] })).toBeTruthy()
  })

  it('offers the work a collision moved here and compares it on request', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationDraft, boardIterationResume } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        transferredDrafts: [{ kind: 'iteration', iterationId: 'iter-0', baseVersion: 1, transferredFrom: 'item-0' }],
      },
    } as never)
    boardIteration.mockResolvedValue({ ok: true, value: IDLE_ATTEMPT } as never)
    boardIterationDraft.mockResolvedValue({
      ok: true,
      value: {
        draft: { ...LIVE_ATTEMPT.draft, summary: null },
        differences: [{ field: 'total', draftValue: '1200', currentValue: '1000' }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iteration.diffTitle'])).toBeTruthy()
    expect(view.getByText(faberloomEn['mesa.iteration.transferredText'])).toBeTruthy()
    expect(boardIterationResume).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iteration.transferredReview'] }))
    await waitFor(() => { expect(boardIterationDraft).toHaveBeenCalledWith('item-1', 'iter-0') })
    expect(await view.findByText('1200')).toBeTruthy()
  })

  it('offers the retained work of a dead attempt the item never linked', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationResume } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, iterationDraftKey: null } } as never)
    boardIteration.mockResolvedValue({
      ok: true,
      value: {
        ...IDLE_ATTEMPT,
        draft: {
          ...LIVE_ATTEMPT.draft, iterationId: 'iter-0', summary: 'Residuo', archived: true,
        },
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iterationDraft'])).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iterationOpen'] }))

    await waitFor(() => {
      expect(boardIterationResume).toHaveBeenCalledWith('item-1', 1, expect.stringMatching(/^tab-/))
    })
  })

  it('recovers the transferred work as the live draft and never applies it', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationRecover, boardIterationApply } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        transferredDrafts: [
          { kind: 'iteration', key: 'item-1:iter-0', iterationId: 'iter-0', baseVersion: 1, transferredFrom: 'item-0' },
        ],
      },
    } as never)
    boardIteration.mockResolvedValue({ ok: true, value: IDLE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText(faberloomEn['mesa.iteration.transferredText'])

    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iteration.transferredRecover'] }))

    await waitFor(() => {
      expect(boardIterationRecover).toHaveBeenCalledWith('item-1', 'item-1:iter-0', expect.stringMatching(/^tab-/))
    })
    // Recovery links the draft; the work only reaches the item through Apply.
    expect(boardIterationApply).not.toHaveBeenCalled()
  })

  it('shows the differences of a transferred draft written on an older version', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationRecover } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        transferredDrafts: [
          { kind: 'iteration', key: 'item-1:iter-0', iterationId: 'iter-0', baseVersion: 1, transferredFrom: 'item-0' },
        ],
      },
    } as never)
    boardIteration.mockResolvedValue({ ok: true, value: IDLE_ATTEMPT } as never)
    boardIterationRecover.mockResolvedValue({
      ok: true,
      value: {
        status: 'outdated',
        iteration: IDLE_ATTEMPT,
        differences: [{ field: 'total', draftValue: '1200', currentValue: '1000' }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText(faberloomEn['mesa.iteration.transferredText'])

    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iteration.transferredRecover'] }))

    expect(await view.findByText('1200')).toBeTruthy()
  })

  it('follows the live item a space assignment kept instead of the closed one', async () => {
    const { runtime, view, boardDetail, boardAssignWorkspace } = await bench()
    boardDetail.mockImplementation((async (id: string) => ({
      ok: true,
      value: id === 'item-2' ? { ...DETAIL, id: 'item-2', title: 'Vigente' } : DETAIL,
    })) as never)
    boardAssignWorkspace.mockResolvedValue({ ok: true, value: { ...DETAIL, id: 'item-2', title: 'Vigente' } } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('③ Draft')
    const space = within(view.getByRole('article')).getByRole('combobox', { name: faberloomEn['mesa.space'] }) as HTMLSelectElement
    fireEvent.change(space, { target: { value: 'space-1' } })
    await waitFor(() => { expect(boardAssignWorkspace).toHaveBeenCalledWith('item-1', 'space-1') })
    expect(await view.findByText('Vigente')).toBeTruthy()
    await waitFor(() => { expect(boardDetail).toHaveBeenCalledWith('item-2') })
  })

  it('starts the iteration over the shown version and pins the chat context', async () => {
    const { runtime, view, boardDetail, boardIterationStart, boardIterationContext } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: DETAIL } as never)
    boardIterationContext.mockResolvedValue({
      ok: true,
      value: {
        itemId: 'item-1', title: 'Preparar proforma', accountRef: 'eguisa', spaceId: null, spaceTitle: null,
        version: 1, summary: 'Borrador', draftSummary: null, rounds: 0,
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('③ Draft')
    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iterate'] }))
    await waitFor(() => {
      expect(boardIterationStart).toHaveBeenCalledWith('item-1', 1, expect.stringMatching(/^tab-/))
    })
    await waitFor(() => { expect(boardIterationContext).toHaveBeenCalledWith('item-1', '') })
  })

  it('edits the iteration draft and applies it with the default scope', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationApply } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(new RegExp(faberloomEn['mesa.iteration.live']))).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Borrador')

    fireEvent.click(view.getByRole('button', { name: faberloomEn['mesa.iteration.apply'] }))
    const dialog = view.getByRole('dialog')
    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('puntual')
    fireEvent.click(within(dialog).getAllByRole('button', { name: faberloomEn['mesa.iteration.apply'] })[0] as HTMLElement)
    await waitFor(() => {
      expect(boardIterationApply).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1',
        generation: 4,
        actorSession: expect.stringMatching(/^tab-/u),
        baseVersion: 1,
        scope: 'puntual',
      })
    })
  })

  it('applies with the scope the selector names', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationApply } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.iteration.apply'] }))
    const dialog = view.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'cuenta' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: faberloomEn['mesa.iteration.apply'] })[0] as HTMLElement)
    await waitFor(() => {
      expect(boardIterationApply).toHaveBeenCalledWith('item-1', expect.objectContaining({ scope: 'cuenta' }))
    })
  })

  it('asks which version wins before applying over a pending candidate', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationApply } = await bench()
    const candidate = { id: 'c1', hash: 'h1', summary: 'Versión nueva', at: '2026-10-28T09:00:00Z' }
    boardDetail.mockResolvedValue({
      ok: true,
      value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1', pendingCandidate: candidate },
    } as never)
    boardIteration.mockResolvedValue({
      ok: true,
      value: { ...LIVE_ATTEMPT, candidatePending: true },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.iteration.apply'] }))
    const dialog = view.getByRole('dialog')
    const confirm = within(dialog).getAllByRole('button', { name: faberloomEn['mesa.iteration.apply'] })[0] as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: faberloomEn['mesa.adopt'] }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(boardIterationApply).toHaveBeenCalledWith('item-1', expect.objectContaining({
        scope: 'puntual',
        candidate: { id: 'c1', hash: 'h1', decision: 'adopt' },
      }))
    })
  })

  it('keeps the draft when saving and exiting', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationPause, boardIterationCancel, boardIterationApply } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.iteration.saveExit'] }))
    await waitFor(() => {
      expect(boardIterationPause).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u), reason: 'guardar-y-salir',
      })
    })
    expect(boardIterationCancel).not.toHaveBeenCalled()
    expect(boardIterationApply).not.toHaveBeenCalled()
  })

  it('discards the changes without applying them', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationCancel, boardIterationApply, boardIterationPause } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.iteration.discardChanges'] }))
    const dialog = view.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: faberloomEn['mesa.iteration.discardChanges'] }))
    await waitFor(() => {
      expect(boardIterationCancel).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u),
      })
    })
    expect(boardIterationApply).not.toHaveBeenCalled()
    expect(boardIterationPause).not.toHaveBeenCalled()
  })

  it('shows the differences of a stale draft and never overwrites', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationDraft, boardIterationResume, boardSaveEdits } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: { ...DETAIL, version: 2, summary: 'Versión nueva', iterationDraftKey: 'iter-1' },
    } as never)
    boardIteration.mockResolvedValue({
      ok: true,
      value: { ...IDLE_ATTEMPT, baseVersion: 1, draft: { ...LIVE_ATTEMPT.draft, outdated: true }, draftOutdated: true },
    } as never)
    boardIterationDraft.mockResolvedValue({
      ok: true,
      value: {
        draft: { ...LIVE_ATTEMPT.draft, baseVersion: 1 },
        differences: [{ field: 'total', draftValue: '1200', currentValue: '1000' }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iteration.diffTitle'])).toBeTruthy()
    expect(view.getByText('1200')).toBeTruthy()
    expect(view.getByText('1000')).toBeTruthy()
    expect(boardSaveEdits).not.toHaveBeenCalled()
    expect(boardIterationResume).not.toHaveBeenCalled()
  })

  it('keeps the Ctrl shortcuts inert inside the draft field', async () => {
    const { runtime, view, boardDetail, boardSaveEdits, boardIteration } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: DETAIL } as never)
    boardIteration.mockResolvedValue({ ok: true, value: undefined } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    const editor = await view.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Corregido' } })
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(boardSaveEdits).not.toHaveBeenCalled()
    expect(await view.findByText('③ Draft')).toBeTruthy()
  })

  it('stores the draft area on the attempt instead of the item summary', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationSaveDraft, boardSaveDraft } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    const editor = await view.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Precio 1200' } })
    await waitFor(() => {
      expect(boardIterationSaveDraft).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u),
        baseVersion: 1, summary: 'Precio 1200',
      })
    }, { timeout: 3_000 })
    expect(boardSaveDraft).not.toHaveBeenCalled()
  })

  it('never renders a late answer for a dead attempt as the item data', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationSaveDraft, boardSaveEdits } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration
      .mockResolvedValueOnce({ ok: true, value: LIVE_ATTEMPT } as never)
      .mockResolvedValue({ ok: true, value: IDLE_ATTEMPT } as never)
    boardIterationSaveDraft.mockResolvedValue({
      ok: true, value: { summary: 'Tarde', baseVersion: 1, linked: false },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    const editor = await view.findByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Tarde' } })
    await waitFor(() => { expect(boardIterationSaveDraft).toHaveBeenCalled() }, { timeout: 3_000 })
    await waitFor(() => { expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Borrador') })
    expect(boardSaveEdits).not.toHaveBeenCalled()
    expect(view.getByRole('button', { name: faberloomEn['mesa.iterate'] })).toBeTruthy()
  })

  it('renews the attempt this tab holds on the cadence the host projects', async () => {
    const { runtime, boardDetail, boardIteration, boardIterationRenew } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: { ...LIVE_ATTEMPT, renewalSeconds: 0.05 } })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await waitFor(() => {
      expect(boardIterationRenew).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u),
      })
    }, { timeout: 3_000 })
  })

  it('returns to the paused state with its draft when the renewal loses the lock', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationRenew, boardIterationSaveDraft, boardSaveEdits } = await bench()
    boardDetail
      .mockResolvedValueOnce({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
      .mockResolvedValue({ ok: true, value: DETAIL } as never)
    boardIteration
      .mockResolvedValueOnce({ ok: true, value: { ...LIVE_ATTEMPT, renewalSeconds: 0.05 } })
      .mockResolvedValue({ ok: true, value: { ...IDLE_ATTEMPT, draft: LIVE_ATTEMPT.draft } })
    boardIterationRenew.mockResolvedValue({
      ok: false,
      error: { code: 'LOCK_LOST', message: 'faberloom: LOCK_LOST — the item is not iterating or its lock expired' },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iteration.lockLost'], undefined, { timeout: 3_000 })).toBeTruthy()
    // The last text reaches the dead attempt before the panel drops its mirror,
    // so the retained draft still offers it (W-43, W-57).
    await waitFor(() => {
      expect(boardIterationSaveDraft).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u),
        baseVersion: 1, summary: 'Borrador',
      })
    })
    expect(await view.findByText(faberloomEn['mesa.iterationDraft'])).toBeTruthy()
    expect(view.queryByRole('button', { name: faberloomEn['mesa.iteration.saveExit'] })).toBeNull()
    expect(boardSaveEdits).not.toHaveBeenCalled()
  })

  it('keeps the last text in the panel when another tab holds the attempt', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationRenew, boardIterationSaveDraft } = await bench()
    boardDetail
      .mockResolvedValueOnce({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
      .mockResolvedValue({ ok: true, value: DETAIL } as never)
    const held = {
      ...LIVE_ATTEMPT, renewalSeconds: 0.05, draft: { ...LIVE_ATTEMPT.draft, summary: 'Borrador' },
    }
    boardIteration
      .mockResolvedValueOnce({ ok: true, value: held })
      .mockResolvedValue({ ok: true, value: { ...held, lockBy: 'tab-other' } })
    // The attempt reads as this tab's when the timer starts and as the other
    // tab's after the refusal; the late draft write meets the same held lock.
    boardIterationSaveDraft.mockResolvedValue({
      ok: false,
      error: { code: 'LOCK_HELD', message: 'faberloom: LOCK_HELD — another tab session holds the attempt' },
    } as never)
    boardIterationRenew.mockResolvedValue({
      ok: false,
      error: { code: 'LOCK_HELD', message: 'faberloom: LOCK_HELD — another tab session holds the attempt' },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iteration.residueKept'], undefined, { timeout: 3_000 })).toBeTruthy()
    await waitFor(() => {
      expect(boardIterationSaveDraft).toHaveBeenCalledWith('item-1', {
        iterationId: 'iter-1', generation: 4, actorSession: expect.stringMatching(/^tab-/u),
        baseVersion: 1, summary: 'Borrador',
      })
    })
    expect(await view.findByText(faberloomEn['mesa.iteration.otherTab'])).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect(view.queryByRole('button', { name: faberloomEn['mesa.iteration.saveExit'] })).toBeNull()
  })

  it('reads the item and offers no exit while another tab iterates it', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationRenew, boardIterationApply, boardSaveEdits } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({
      ok: true, value: { ...LIVE_ATTEMPT, lockBy: 'tab-other', renewalSeconds: 0.05 },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.iteration.otherTab'])).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    const exits = ['mesa.iteration.apply', 'mesa.iteration.discardChanges', 'mesa.iteration.saveExit', 'mesa.iteration.toSpaceloom'] as const
    for (const key of exits) expect(view.queryByRole('button', { name: faberloomEn[key] })).toBeNull()
    // The exits stay shut for the keyboard too: neither the apply dialog nor a
    // save may start from a tab that does not hold the attempt.
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(view.queryByRole('dialog')).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(boardIterationRenew).not.toHaveBeenCalled()
    expect(boardIterationApply).not.toHaveBeenCalled()
    expect(boardSaveEdits).not.toHaveBeenCalled()
  })

  it('reports a correction that could not be recorded after the apply commits', async () => {
    const { runtime, view, boardDetail, boardIteration, boardIterationApply } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, state: 'ITERANDO', iterationId: 'iter-1' } } as never)
    boardIteration.mockResolvedValue({ ok: true, value: LIVE_ATTEMPT })
    boardIterationApply.mockResolvedValue({
      ok: true,
      value: { iteration: IDLE_ATTEMPT, correctionError: 'faberloom: NO_DATA_CLASS — a correction carries the data classes' },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.iteration.apply'] }))
    const dialog = view.getByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: faberloomEn['mesa.iteration.apply'] })[0] as HTMLElement)
    expect(await view.findByText(/NO_DATA_CLASS/u)).toBeTruthy()
  })

  it('reports a correction that could not be recorded after the edit is saved', async () => {
    const { runtime, view, boardDetail, boardSaveEdits } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: DETAIL } as never)
    boardSaveEdits.mockResolvedValue({
      ok: true,
      value: { detail: DETAIL, correctionError: 'faberloom: NO_ACCESS — the correction origin is outside the actor scope' },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('③ Draft')
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Corregido' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(await view.findByText(/NO_ACCESS/u)).toBeTruthy()
  })

  it('saves with Ctrl+S, toggles Lista with V, and refuses R when not stale', async () => {
    const { runtime, view, boardDetail, boardSaveEdits } = await bench()
    boardDetail.mockResolvedValue({ ok: true, value: DETAIL } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    await view.findByText('③ Draft')

    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Corregido' } })
    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => {
      expect(boardSaveEdits).toHaveBeenCalledWith('item-1', expect.objectContaining({ changes: { summary: 'Corregido' } }))
    })

    fireEvent.keyDown(window, { key: 'v' })
    expect(await view.findByText(faberloomEn['mesa.account'])).toBeTruthy()

    fireEvent.keyDown(window, { key: 'r' })
    expect(await view.findByText(faberloomEn['mesa.notStale'])).toBeTruthy()
  })

  it('queues the visible items with a localized severity and a position', async () => {
    const row = OVERVIEW.board[0]
    const overview = {
      ...OVERVIEW,
      board: [
        { ...row, id: 'item-a', title: 'PF 2520-2026', severity: 'CRITICAL' },
        { ...row, id: 'item-b', title: 'PF 2487-2026', severity: 'HIGH' },
      ],
    }
    const { runtime, view, boardDetail } = await bench({ ok: true, value: overview })
    boardDetail.mockResolvedValue({ ok: true, value: { ...DETAIL, id: 'item-a', title: 'PF 2520-2026' } } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect((await view.findAllByText('PF 2520-2026')).length).toBeGreaterThan(0)
    expect(view.getAllByText(faberloomEn['mesa.severity.critical']).length).toBeGreaterThan(0)
    expect(await view.findByText('1 of 2')).toBeTruthy()
    expect(view.getByText(faberloomEn['mesa.queue'])).toBeTruthy()
  })

  it('shows one notice and folds the rest behind a counter', async () => {
    const { runtime, view, boardDetail } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: { ...DETAIL, stale: true, staleReason: 'El pedido cambio', pendingCandidate: { id: 'cand-1', hash: 'h2' } },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.candidate'])).toBeTruthy()
    expect(view.getByText('1 more notice')).toBeTruthy()
    expect(view.getByRole('button', { name: faberloomEn['mesa.adopt'] })).toBeTruthy()
  })

  it('blocks approval and explains why when a blocking control failed', async () => {
    const { runtime, view, boardDetail } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        checks: [{
          id: 'proforma.price', class: 'bloqueante', status: 'fail', source: 'mwt.price',
          sourceVersion: '7', checkedAt: '2026-10-28T10:00:00Z', fields: ['lines[0].unitPrice'], reason: 'PRICE_MISSING',
        }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText(faberloomEn['mesa.check.price'])).toBeTruthy()
    expect(view.getByText(faberloomEn['mesa.status.fail'])).toBeTruthy()
    expect(view.getByText(faberloomEn['mesa.checks.blocked'])).toBeTruthy()
    expect((view.getByRole('button', { name: faberloomEn['action.approve'] }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('requires accepting a failing confirmation control before approving', async () => {
    const { runtime, view, boardDetail, boardApprove } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        checks: [{
          id: 'proforma.stock', class: 'confirmacion', status: 'warning', source: 'mwt.stock',
          sourceVersion: '3', checkedAt: '2026-10-28T10:00:00Z', fields: [], reason: null,
        }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['action.approve'] }))
    const confirm = view.getByRole('button', { name: faberloomEn['action.confirm'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(view.getByRole('checkbox'))
    expect((view.getByRole('button', { name: faberloomEn['action.confirm'] }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(view.getByRole('button', { name: faberloomEn['action.confirm'] }))
    await waitFor(() => {
      expect(boardApprove).toHaveBeenCalledWith('item-1', expect.objectContaining({ confirmations: ['proforma.stock'] }))
    })
  })

  it('closes the approval dialog with Escape while focus is inside it', async () => {
    const { runtime, view, boardDetail } = await bench()
    boardDetail.mockResolvedValue({
      ok: true,
      value: {
        ...DETAIL,
        checks: [{
          id: 'proforma.stock', class: 'confirmacion', status: 'warning', source: 'mwt.stock',
          sourceVersion: '3', checkedAt: '2026-10-28T10:00:00Z', fields: [], reason: null,
        }],
      },
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['action.approve'] }))
    const checkbox = view.getByRole('checkbox')
    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
  })

  it('hides a Kanban column with no cards', async () => {    const { runtime, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['mesa.tab.kanban'] }))
    expect(await view.findByText(faberloomEn['mesa.column.tu'])).toBeTruthy()
    expect(view.queryByText(faberloomEn['mesa.column.esperando'])).toBeNull()
    expect(view.queryByText(faberloomEn['mesa.column.delegado'])).toBeNull()
  })

  it('opens the selected task in the Foco detail', async () => {
    const { runtime, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText('Preparar proforma')).toBeTruthy()
    expect(view.getByRole('button', { name: faberloomEn['mesa.tab.kanban'] })).toBeTruthy()
    expect(view.getByRole('button', { name: faberloomEn['mesa.tab.lista'] })).toBeTruthy()
  })

  it('sends an email draft from the Correo panel', async () => {
    const draft = {
      id: 'draft-1', to: ['cliente@mwt.one'], cc: [], subject: 'Propuesta', text: 'cuerpo',
      status: 'draft', aiText: null, inReplyTo: null, spaceId: null, createdAt: '2026-09-27T00:00:00Z',
    }
    const { runtime, sendEmailDraft, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [draft], inbox: [] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: EMAIL }) })
    fireEvent.change(await view.findByRole('combobox', { name: faberloomEn['email.mode'] }), { target: { value: 'drafts' } })
    await view.findByText('Propuesta')
    const draftRows = view.getAllByRole('row')
    fireEvent.click(draftRows[draftRows.length - 1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['email.send'] }))
    await waitFor(() => { expect(sendEmailDraft).toHaveBeenCalledWith('draft-1') })
  })

  it('offers reply, mark-read and trash on an unread email in Correo', async () => {
    const message = { id: '42', messageId: '<x@y>', from: 'proveedor@mwt.one', subject: 'OC 505433', date: '2026-09-27' }
    const { runtime, emailMarkSeen, emailTrash, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, { drafts: [], inbox: [message] },
    )
    act(() => { runtime.panelInfo.set({ activePanelId: EMAIL }) })
    await view.findByText('OC 505433')
    const inboxRows = view.getAllByRole('row')
    fireEvent.click(inboxRows[inboxRows.length - 1] as HTMLTableRowElement)
    expect(await view.findByRole('button', { name: faberloomEn['email.reply'] })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: `${faberloomEn['email.markRead']} proveedor@mwt.one` }))
    await waitFor(() => { expect(emailMarkSeen).toHaveBeenCalledWith('42') })
    fireEvent.click(view.getByRole('button', { name: `${faberloomEn['email.trash']} proveedor@mwt.one` }))
    await waitFor(() => { expect(emailTrash).toHaveBeenCalledWith('42', 'proveedor@mwt.one', 'OC 505433') })
  })

  it('shows the space name and a snippet, toggles visibility, and deletes the memory from a modal', async () => {
    const named = { id: 'm1', spaceIds: ['space-1'], createdAt: '2026-09-25T00:00:00Z', visibility: 'private', text: `Correo «PO 505433»: ${'x'.repeat(400)}` }
    const orphan = { id: 'm2', spaceIds: ['gone'], createdAt: '2026-09-26T00:00:00Z', visibility: 'shared', text: 'Documento «PF 1.pdf»: resumen' }
    const { runtime, deleteSpaceMemory, setMemoryVisibility, view } = await bench(
      { ok: true, value: OVERVIEW }, undefined, {}, [named, orphan],
    )
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })

    expect(await view.findByText('Marluvas')).toBeTruthy()
    expect(await view.findByText('(deleted space)')).toBeTruthy()

    const target = view.getAllByRole('row').find(row => row.textContent?.includes('Correo «PO 505433»'))
    fireEvent.click(target as HTMLTableRowElement)
    // A private entry offers to become shared again.
    fireEvent.click(await view.findByRole('button', { name: 'Make shared' }))
    await waitFor(() => { expect(setMemoryVisibility).toHaveBeenCalledWith('m1', 'shared') })

    const other = view.getAllByRole('row').find(row => row.textContent?.includes('Documento «PF 1.pdf»'))
    fireEvent.click(other as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Make private' }))
    await waitFor(() => { expect(setMemoryVisibility).toHaveBeenCalledWith('m2', 'private') })

    fireEvent.click(target as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Delete memory' }))
    await waitFor(() => { expect(deleteSpaceMemory).toHaveBeenCalledWith('m1') })
  })

  it('names the conversation a memory came from, opens it, and admits when it is gone', async () => {
    const captured = { id: 'm1', spaceIds: ['space-1'], createdAt: '2026-09-25T00:00:00Z', sessionId: 'sess-chat', text: 'Resultado: el usuario saludó' }
    const orphaned = { id: 'm2', spaceIds: [], createdAt: '2026-09-26T00:00:00Z', sessionId: 'sess-gone', text: 'Resultado: otra conversación' }
    const { runtime, layout, view } = await bench({ ok: true, value: OVERVIEW }, undefined, {}, [captured, orphaned])
    await runtime.sessions.add({ id: 'sess-chat', summary: { displayTitle: 'Saludo inicial' } }, { current: false })
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })
    await view.findByText('Resultado: el usuario saludó')

    const row = (text: string): HTMLTableRowElement =>
      view.getAllByRole('row').find(candidate => candidate.textContent?.includes(text)) as HTMLTableRowElement

    // The distilled line names the conversation that produced it, and the modal
    // is how the operator reads that conversation instead of the summary alone.
    fireEvent.click(row('Resultado: el usuario saludó'))
    expect(await view.findByText('Saludo inicial')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => { expect(layout.selectPanel).toHaveBeenCalledWith(null) })
    expect(runtime.sessions.calls.some(call => call.method === 'open' && call.args[0] === 'sess-chat')).toBe(true)

    // A Session this host no longer lists reads as gone: no action that cannot run.
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })
    await view.findByText('Resultado: otra conversación')
    fireEvent.click(row('Resultado: otra conversación'))
    expect(await view.findByText('That conversation is no longer on this computer.')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Open conversation' })).toBeNull()
  })

  it('surfaces a memory visibility failure, resolved and rejected', async () => {
    const entry = { id: 'm1', spaceIds: ['space-1'], createdAt: '2026-09-25T00:00:00Z', text: 'Correo «PO 1»' }
    const { runtime, view, setMemoryVisibility } = await bench({ ok: true, value: OVERVIEW }, undefined, {}, [entry])
    setMemoryVisibility.mockResolvedValueOnce({ ok: false, error: { message: 'vis-down' } })
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })
    const target = (await view.findAllByRole('row')).find(row => row.textContent?.includes('Correo «PO 1»'))
    fireEvent.click(target as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Make private' }))
    expect(await view.findByText('vis-down')).toBeTruthy()

    setMemoryVisibility.mockRejectedValueOnce(new Error('vis-boom'))
    fireEvent.click(view.getByRole('button', { name: 'Make private' }))
    expect(await view.findByText(/vis-boom/)).toBeTruthy()
  })

  it('renders a date in the data role and a prose cell in the UI-body role', async () => {
    const entry = { id: 'm1', spaceIds: ['space-1'], createdAt: '2026-09-25T00:00:00Z', text: 'El precio se consulta antes de cotizar.' }
    const { runtime, view } = await bench({ ok: true, value: OVERVIEW }, undefined, {}, [entry])
    act(() => { runtime.panelInfo.set({ activePanelId: MEMORY }) })

    // A date is an exact value: it carries the data-role class, not the prose one.
    const date = await view.findByText('2026-09-25T00:00:00Z')
    expect(date.className).toBe(css.cellData)
    // The text beside it is prose and keeps the UI-body role.
    const prose = await view.findByText('El precio se consulta antes de cotizar.')
    expect(prose.className).toBe(css.cellName)
    expect(prose.className).not.toBe(css.cellData)
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

  it('sets a flow private and back to shared from the toolbar', async () => {
    const { runtime, view, workflowOverview, workflowDetail, setWorkflowVisibility } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    const detailValue = { ...row, valid: true, problems: [], maxConcurrency: null, nodesList: [], edgesList: [] }
    workflowDetail.mockResolvedValue({ ok: true, value: detailValue })
    setWorkflowVisibility.mockResolvedValue({ ok: true, value: [{ ...row, visibility: 'private' }] })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByText(/Anti-spam/))
    fireEvent.click(await view.findByRole('button', { name: 'Make private' }))
    await waitFor(() => { expect(setWorkflowVisibility).toHaveBeenCalledWith('wf1', 'private') })

    // The refreshed row is private, so the toolbar offers the opposite toggle.
    fireEvent.click(await view.findByRole('button', { name: 'Make shared' }))
    await waitFor(() => { expect(setWorkflowVisibility).toHaveBeenLastCalledWith('wf1', 'shared') })
  })

  it('surfaces a flow visibility failure, resolved and rejected', async () => {
    const { runtime, view, workflowOverview, workflowDetail, setWorkflowVisibility } = await bench()
    workflowOverview.mockResolvedValue({ ok: true, value: [row] })
    workflowDetail.mockResolvedValue({
      ok: true, value: { ...row, valid: true, problems: [], maxConcurrency: null, nodesList: [], edgesList: [] },
    })
    setWorkflowVisibility.mockResolvedValueOnce({ ok: false, error: { message: 'wf-vis-down' } })

    act(() => { runtime.panelInfo.set({ activePanelId: WORKFLOWS }) })
    fireEvent.click(await view.findByText(/Anti-spam/))
    fireEvent.click(await view.findByRole('button', { name: 'Make private' }))
    expect(await view.findByText('wf-vis-down')).toBeTruthy()

    setWorkflowVisibility.mockRejectedValueOnce(new Error('wf-vis-boom'))
    fireEvent.click(view.getByRole('button', { name: 'Make private' }))
    expect(await view.findByText(/wf-vis-boom/)).toBeTruthy()
  })
})

describe('faberloom panel editors', () => {
  const SKILL_ROW = {
    id: 'skill-1', name: 'mwt-admin-builder-crear', module: 'builder', action: 'create',
    description: 'Crea una orden de compra', origin: 'owner', assignedTo: [], assignedNames: [], replacesCatalog: false, editsGlobally: false,
  }
  const ROLE_SKILL_ROW = {
    ...SKILL_ROW, id: 'skill-2', name: 'marluvas-correo', origin: 'role',
    assignedTo: ['052664bf-51a1-4ca4-846c-23728902e75b'], assignedNames: ['Operador Marluvas'],
  }
  const CONNECTION_ROW = {
    id: 'conn-1', kind: 'imap', label: '506@muitowork.com', host: 'imap.hostinger.com', port: 993,
    secure: true, starttls: false, username: '506@muitowork.com', destination: null,
    retentionDays: null, primary: true, hasSecret: true,
  }
  const CONTEXT_ROW = {
    id: 'ctx-1', title: 'Precios Eguisa', body: 'Verificado en MWT', visibility: 'local',
    spaceId: null, version: 1, updatedAt: '2026-10-14', shared: false, canDelete: true,
  }

  it('lists skills in two columns, with no inspector beside the table', async () => {
    const { runtime, view } = await bench(undefined, undefined, {}, [], { skills: [SKILL_ROW] })
    act(() => { runtime.panelInfo.set({ activePanelId: SKILLS }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['panel.skills.title'] }))
    await view.findByText(SKILL_ROW.name)

    expect([...view.container.querySelectorAll('th')].map(head => head.textContent))
      .toEqual([faberloomEn['col.name'], faberloomEn['col.module']])
    // The table is a direct child of the screen: no table+inspector grid wraps it.
    expect(view.container.querySelector(`.${css.tableCard}`)?.parentElement?.className).toBe(css.screen)
    const screen = [...view.container.querySelectorAll(`.${css.screen}`)]
      .find(element => element.textContent?.includes(SKILL_ROW.name))
    expect(screen?.querySelector(`.${css.inspector}`) ?? null).toBeNull()
  })

  it('opens a skill detail in a dialog when its row is clicked', async () => {
    const { runtime, view } = await bench(undefined, undefined, {}, [], { skills: [SKILL_ROW] })
    act(() => { runtime.panelInfo.set({ activePanelId: SKILLS }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['panel.skills.title'] }))
    fireEvent.click(await view.findByText(SKILL_ROW.name))

    const dialog = await view.findByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(SKILL_ROW.name)
    expect(dialog.textContent).toContain(SKILL_ROW.description)
    // The two facts the table no longer carries stay in the detail.
    expect(dialog.textContent).toContain(faberloomEn['field.usedBy'])
    expect(dialog.textContent).toContain(faberloomEn['field.origin'])
    fireEvent.click(view.getAllByRole('button', { name: faberloomEn['action.close'] })[0] as HTMLButtonElement)
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
  })

  it('names the agents that use a skill and edits a catalog skill into the owner copy', async () => {
    const { runtime, view, saveSkill, skillMarkdown } = await bench(undefined, undefined, {}, [], { skills: [ROLE_SKILL_ROW] })
    act(() => { runtime.panelInfo.set({ activePanelId: SKILLS }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['panel.skills.title'] }))
    fireEvent.click(await view.findByText(ROLE_SKILL_ROW.name))

    const dialog = await view.findByRole('dialog')
    expect(dialog.textContent).toContain('Operador Marluvas')
    expect(dialog.textContent).not.toContain('052664bf')

    fireEvent.click(view.getByRole('button', { name: faberloomEn['action.edit'] }))
    const editor = await view.findByLabelText(faberloomEn['skills.markdown'])
    expect(skillMarkdown).toHaveBeenCalledWith(ROLE_SKILL_ROW.name)
    expect(dialog.textContent).toContain(faberloomEn['skills.editCatalogHint'])
    fireEvent.change(editor, { target: { value: '---\nname: marluvas-correo\ndescription: editada\n---\n' } })
    fireEvent.click(view.getByRole('button', { name: faberloomEn['action.save'] }))
    await waitFor(() => { expect(saveSkill).toHaveBeenCalledWith(ROLE_SKILL_ROW.name, '---\nname: marluvas-correo\ndescription: editada\n---\n') })
    await waitFor(() => { expect(view.queryByLabelText(faberloomEn['skills.markdown'])).toBeNull() })
  })

  it('mounts the folder install block only inside the Desktop application', async () => {
    const { runtime, view } = await bench(undefined, undefined, {}, [], { skills: [SKILL_ROW] })
    act(() => { runtime.panelInfo.set({ activePanelId: SKILLS }) })
    fireEvent.click(await view.findByRole('button', { name: faberloomEn['panel.skills.title'] }))
    await view.findByText(SKILL_ROW.name)

    expect(view.queryByText(faberloomEn['harness.installButton'])).toBeNull()
    expect(view.getByText(faberloomEn['skills.upload'])).toBeTruthy()

    Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 }, configurable: true })
    try {
      // The panel keeps its tab state across a mount; switching tabs is what
      // re-renders the shell and reads the Desktop marker.
      fireEvent.click(await view.findByRole('button', { name: faberloomEn['panel.agents.title'] }))
      expect(await view.findByText(faberloomEn['harness.installButton'])).toBeTruthy()
    } finally {
      Reflect.deleteProperty(globalThis, 'dshDesktop')
    }
  })

  it('opens the connection editor as a dialog from the button and from a row', async () => {
    const { runtime, view, saveConnection } = await bench(undefined, undefined, {}, [], { connections: [CONNECTION_ROW] })
    act(() => { runtime.panelInfo.set({ activePanelId: CONNECTIONS }) })
    await view.findByText(CONNECTION_ROW.label)
    // The connections table itself sits directly under the screen; the blocks
    // below it keep their own two-pane layout untouched.
    expect(view.container.querySelector(`.${css.tableCard}`)?.parentElement?.className).toBe(css.screen)

    // A new connection opens on an empty form, never on the last edited record.
    fireEvent.click(view.getByRole('button', { name: faberloomEn['connections.new'] }))
    const editor = await view.findByRole('dialog')
    expect(editor.getAttribute('aria-label')).toBe(faberloomEn['connections.newTitle'])
    expect((view.getByRole('textbox', { name: faberloomEn['field.name'] }) as HTMLInputElement).value).toBe('')
    fireEvent.click(view.getAllByRole('button', { name: faberloomEn['action.close'] })[0] as HTMLButtonElement)
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })

    // A row opens the same editor on that record.
    fireEvent.click(view.getByText(CONNECTION_ROW.label))
    const loaded = await view.findByRole('dialog')
    expect(loaded.getAttribute('aria-label')).toBe(CONNECTION_ROW.label)
    expect((view.getByRole('textbox', { name: faberloomEn['field.name'] }) as HTMLInputElement).value)
      .toBe(CONNECTION_ROW.label)
    expect(view.getByRole('textbox', { name: faberloomEn['field.host'] })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: faberloomEn['action.save'] }))
    await waitFor(() => { expect(saveConnection).toHaveBeenCalled() })
  })

  it('opens a task detail and a context entry as dialogs', async () => {
    const { runtime, view } = await bench(undefined, undefined, {}, [], { context: [CONTEXT_ROW] })

    act(() => { runtime.panelInfo.set({ activePanelId: BOARD }) })
    expect(await view.findByText('Preparar proforma')).toBeTruthy()
    expect(view.queryByRole('dialog')).toBeNull()

    act(() => { runtime.panelInfo.set({ activePanelId: CONTEXT }) })
    fireEvent.click(await view.findByText(CONTEXT_ROW.title))
    expect((await view.findByRole('dialog')).getAttribute('aria-label')).toBe(CONTEXT_ROW.title)
    // The panel that shows the row keeps no table+inspector grid.
    const screens = [...view.container.querySelectorAll(`.${css.screen}`)]
    const screen = screens.find(element => element.textContent?.includes(CONTEXT_ROW.title))
    expect(screen?.querySelector(`.${css.inspector}`) ?? null).toBeNull()
    expect(screen?.querySelector(`.${css.tableCard}`)?.parentElement).toBe(screen)
  })
})

describe('faberloom routines visibility', () => {
  it('marks a routine private from the inspector', async () => {
    const { runtime, view, setRoutineVisibility } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: ROUTINES }) })
    await view.findByText('Pedido a proforma')
    fireEvent.click((await view.findAllByRole('row'))[1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Make private' }))
    await waitFor(() => { expect(setRoutineVisibility).toHaveBeenCalledWith('routine-1', 'private') })
  })

  it('offers to share a routine that is already private', async () => {
    const { runtime, view, setRoutineVisibility } = await bench({
      ok: true,
      value: { ...OVERVIEW, routines: [{ ...OVERVIEW.routines[0], visibility: 'private' }] },
    })
    act(() => { runtime.panelInfo.set({ activePanelId: ROUTINES }) })
    await view.findByText('Pedido a proforma')
    fireEvent.click((await view.findAllByRole('row'))[1] as HTMLTableRowElement)
    fireEvent.click(await view.findByRole('button', { name: 'Make shared' }))
    await waitFor(() => { expect(setRoutineVisibility).toHaveBeenCalledWith('routine-1', 'shared') })
  })

  it('lists runs newest first with their trigger and a plain-language failure', async () => {
    const { runtime, view, executions, reconcileExecution } = await bench()
    const step = (id: string, status: string, text: string | null, reason: string | null = null) =>
      ({ id, status, text, reason, effect: false })
    executions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'run-old', routineId: 'routine-1', routineName: 'Pedido a proforma', routineVersion: 3, status: 'completed',
          waitingFor: null, deadlineAt: null, reason: null, doneSteps: 1, totalSteps: 1,
          steps: [step('triar', 'completed', '**Resumen:** la OC 20845 queda registrada.\nDetalle largo.')],
          evidenceCount: 0, event: { key: 'k1', type: 'email', subject: 'OC 20845' },
          createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:05:00.000Z',
        },
        {
          id: 'run-new', routineId: 'routine-1', routineName: 'Pedido a proforma', routineVersion: 4, status: 'needs_review',
          waitingFor: null, deadlineAt: null, reason: null, doneSteps: 0, totalSteps: 1,
          steps: [step('triar', 'failed', null, 'faberloom: agent 7945b799-3211-4128-b641-e1e3ab8cd7c1 not found')],
          evidenceCount: 0, event: { key: 'k2', type: 'email', subject: 'PF 2494-2026 - Packing List' },
          createdAt: '2026-10-27T10:00:00.000Z', updatedAt: '2026-10-27T10:01:00.000Z',
        },
      ],
    } as never)
    act(() => { runtime.panelInfo.set({ activePanelId: ROUTINES }) })
    await view.findByText('Pedido a proforma')
    fireEvent.click((await view.findAllByRole('row'))[1] as HTMLTableRowElement)

    await view.findByText('PF 2494-2026 - Packing List')
    const subjects = [...view.container.querySelectorAll(`.${css.runSubject}`)]
    expect(subjects.map(node => node.textContent)).toEqual(['PF 2494-2026 - Packing List', 'OC 20845'])
    expect(view.getByText(faberloomEn['runs.problem.agent'])).toBeTruthy()
    expect(view.getByText(faberloomEn['runs.status.review'])).toBeTruthy()
    expect(view.getByText('Resumen: la OC 20845 queda registrada.')).toBeTruthy()

    // The steps and actions of each run sit in a collapsed details element.
    const reconcile = view.getAllByText(faberloomEn['routines.reconcile'])
    expect(reconcile).toHaveLength(1)
    fireEvent.click(reconcile[0] as HTMLElement)
    await waitFor(() => { expect(reconcileExecution).toHaveBeenCalledWith('run-new') })
  })

  it('scopes a routine to a Space from the editor', async () => {
    const { runtime, view, saveRoutine } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: ROUTINES }) })
    await view.findByText('Pedido a proforma')
    fireEvent.click((await view.findAllByRole('row'))[1] as HTMLTableRowElement)
    fireEvent.change(await view.findByRole('combobox', { name: 'Space' }), { target: { value: 'space-1' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(saveRoutine).toHaveBeenCalledWith('routine-1', expect.objectContaining({ spaceId: 'space-1' })) })
  })
})
