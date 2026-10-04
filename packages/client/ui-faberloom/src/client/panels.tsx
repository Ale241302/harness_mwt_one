/**
 * FaberLoom module screens. Each screen is the same shape: a toolbar, a dense
 * table of records, and a right-hand inspector that edits the selected record.
 * Agentes and Skills have full editors; the remaining modules read the shared
 * overview and expose their own row actions. The Conversar panel hands the user
 * to the harness conversation, which owns the composer.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: declares the sidebar shell's `sidebar.panellist` owner props.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconAgentPresetOutline16,
  IconAlarmClockOutline16,
  IconApiOutline14,
  IconBranchOutline16,
  IconChecklistOutline14,
  IconSendOutline14,
  IconDatabaseOutline16,
  IconFolderOpenOutline16,
  IconNewChatOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Modal, SecretInput } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AgentSaveInput, FaberLoomAgentDetail, FaberLoomBoardDetail, FaberLoomConnection, FaberLoomExecutionRow,
  FaberLoomGrantRow, FaberLoomMcpTokenRow, FaberLoomModelRecommendation, FaberLoomModelRow, FaberLoomModelCatalog, FaberLoomOverview,
  FaberLoomPerformanceRow, FaberLoomRoutineDetail, FaberLoomSkillRow,
  FaberLoomCostSummary,
  FaberLoomTeachingRow, GrantSaveInput, McpTokenInput, TeachingSaveInput,
  FaberLoomBackupRow,
  FaberLoomWorkProposal, FaberLoomLinkPreview, FaberLoomMwtStatus, FaberLoomSpaceWorkspace,
  FaberLoomSpaceDetail, RoutineSaveInput, SpaceSaveInput, FaberLoomRoutineStepRow, FaberLoomSpaceMemoryRow,
  FaberLoomInboxRow, FaberLoomEmailDraftRow, EmailDraftSaveInput, EmailDraftAiInput,
  FaberLoomEmailPolicy, EmailPolicySaveInput, FaberLoomEmailContent, FaberLoomEmailAttachmentContent,
  FaberLoomRoutineChatMessage, FaberLoomRoutineCreated, FaberLoomEmailFacts, FaberLoomShares, FaberLoomShareRow,
  FaberLoomWorkflowRow, FaberLoomWorkflowDetail, FaberLoomWorkflowRunRow, FaberLoomWorkflowExport, FaberLoomWorkflowLink, FaberLoomSpaceMap,
  FaberLoomJsonValue, FaberLoomShareGrantRow, FaberLoomHealth, FaberLoomWorkflowTemplateRow,
} from '@deepseek-ai/dsh-faberloom-view/types'
import { Block, Chip, DataTable, Field, Inspector, SearchBox, SkillTransfer, StateBlock, StatusDot, tableLabels, Toolbar, type Column } from './components.tsx'
import { defaultConfigFor, edgeLine, kindIsTrigger, layoutNodes, NODE_HEIGHT, NODE_WIDTH, statusTone } from './workflow-logic.ts'
import type { createWorkspaceStore } from './store.ts'
import type { FaberloomKey } from './locales.ts'
import styles from './faberloom.module.css'

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Model providers an agent may use, each with its own API key. */
const MODEL_PROVIDERS = ['anthropic', 'openai', 'kimi', 'deepseek'] as const

/** The business face every panel shares: reads, writes, and the lazy detail reads. */
export interface FaberloomPanelInjected {
  /** Re-read the workspace overview. */
  load: () => void
  /** Leave the panel and open the harness conversation (its composer). */
  startConversation: () => void
  /** Create a space (root or sub-space) in charge of an optional agent, and refresh. */
  createSpace: (title: string, agentId: string | null, parentId: string | null, inheritContext: boolean) => void
  /** Remove one space, its Workspace, and its conversation area. */
  deleteSpace: (id: string) => void
  /** Open the space's Workspace in the sidebar conversation area. */
  goToWorkspace: (spaceId: string) => void
  /** Rename one space and refresh. */
  renameSpace: (id: string, title: string) => void
  /** Create an agent with its initial configuration, and refresh. */
  createAgent: (input: {
    readonly name: string
    readonly responsibility: string
    readonly provider: string | null
    readonly model: string | null
    readonly apiKey: string
    readonly webAccess: boolean
    readonly mwtMcp: boolean
    readonly sicopMcp: boolean
    readonly mailConnectionIds: readonly string[]
    readonly subagentIds: readonly string[]
  }) => void
  /** Deactivate one agent and refresh. */
  deactivateAgent: (id: string) => void
  /** Remove one agent from the catalog permanently. */
  purgeAgent: (id: string) => void
  /** Create a board item awaiting review. */
  createBoardItem: (title: string) => void
  /** Approve or reject the current board revision, with an optional review note. */
  reviewBoardItem: (id: string, approve: boolean, note?: string) => Promise<Result<FaberLoomOverview>>
  /** Reopen one reviewed board item for correction. */
  reopenBoardItem: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Submit a prepared result as a new revision awaiting review. */
  submitBoardRevision: (id: string, input: { summary: string; evidence: readonly string[] }) => Promise<Result<FaberLoomOverview>>
  /** Move a board item into an exception state: request_data, fail, or complete. */
  boardException: (id: string, action: 'request_data' | 'fail' | 'complete') => Promise<Result<FaberLoomOverview>>
  /** Create a draft routine. */
  createRoutine: (name: string) => void
  /** Activate or pause one routine. */
  setRoutineActive: (id: string, active: boolean) => void
  /** Remember one statement, attached to a space or to no space. */
  remember: (text: string, spaceId: string | null) => void
  /** Read the space-scoped memory, resolved for one space when given. */
  spaceMemory: (spaceId?: string) => Promise<Result<readonly FaberLoomSpaceMemoryRow[]>>
  /** Delete one space-memory entry and return the refreshed list. */
  deleteSpaceMemory: (id: string) => Promise<Result<readonly FaberLoomSpaceMemoryRow[]>>
  /** Read one agent's full editable configuration. */
  agentDetail: (id: string) => Promise<Result<FaberLoomAgentDetail | undefined>>
  /** List the model pool the panels assign from. */
  models: () => Promise<Result<readonly FaberLoomModelRow[]>>
  /** Live provider/model catalog so the panels offer what this deployment can run. */
  modelCatalog: () => Promise<Result<FaberLoomModelCatalog>>
  /** Ask the recommender which model suits one agent. */
  recommendModel: (agentId: string) => Promise<Result<FaberLoomModelRecommendation | undefined>>
  /** List the owner's versioned teachings, optionally filtered by space, agent, or task. */
  teachings: (spaceId?: string, agentId?: string, task?: string) => Promise<Result<readonly FaberLoomTeachingRow[]>>
  /** Record one teaching from a correction or a direct instruction. */
  saveTeaching: (input: TeachingSaveInput) => Promise<Result<readonly FaberLoomTeachingRow[]>>
  /** Edit one teaching, producing a new version. */
  editTeaching: (id: string, text: string, reason: string) => Promise<Result<readonly FaberLoomTeachingRow[]>>
  /** Revoke one teaching. */
  revokeTeaching: (id: string) => Promise<Result<readonly FaberLoomTeachingRow[]>>
  /** Read the owner's contextual performance evidence. */
  performance: (agentId?: string, task?: string) => Promise<Result<FaberLoomPerformanceRow>>
  /** Read the owner's recorded spend, grouped by model, agent, and task. */
  costs: (agentId?: string, task?: string) => Promise<Result<FaberLoomCostSummary>>
  /** List the owner's autonomy grants. */
  grants: () => Promise<Result<readonly FaberLoomGrantRow[]>>
  /** Grant one action. */
  grant: (input: GrantSaveInput) => Promise<Result<readonly FaberLoomGrantRow[]>>
  /** Revoke one grant. */
  revokeGrant: (id: string) => Promise<Result<readonly FaberLoomGrantRow[]>>
  /** Read the owner's MWT.ONE access: identity, company, and connected MCP servers. */
  mwtStatus: () => Promise<Result<FaberLoomMwtStatus>>
  /** List the MCP client tokens. */
  mcpTokens: () => Promise<Result<readonly FaberLoomMcpTokenRow[]>>
  /** Mint one MCP client token. */
  mintMcpToken: (input: McpTokenInput) => Promise<Result<readonly FaberLoomMcpTokenRow[]>>
  /** Revoke one MCP client token. */
  revokeMcpToken: (token: string) => Promise<Result<readonly FaberLoomMcpTokenRow[]>>
  /** Save one agent's editable configuration. */
  saveAgent: (id: string, input: AgentSaveInput) => Promise<Result<FaberLoomOverview>>
  /** Share one managed agent with named emails, the whole company, or both. */
  shareAgent: (id: string, emails: readonly string[], allUsers: boolean) => Promise<Result<FaberLoomShares>>
  /** Share one uploaded skill with named emails, the whole company, or both. */
  shareSkill: (name: string, emails: readonly string[], allUsers: boolean) => Promise<Result<FaberLoomShares>>
  /** List what the owner shares and what others share with them. */
  shares: () => Promise<Result<FaberLoomShares>>
  /** Stop sharing one published resource. */
  unshareShare: (id: string) => Promise<Result<FaberLoomShares>>
  /** List the skills available to this owner. */
  skills: () => Promise<Result<readonly FaberLoomSkillRow[]>>
  /** Add or replace one uploaded skill. */
  saveSkill: (name: string, markdown: string) => Promise<Result<readonly FaberLoomSkillRow[]>>
  /** Remove one uploaded skill. */
  removeSkill: (name: string) => Promise<Result<readonly FaberLoomSkillRow[]>>
  /** List the owner's own connections (IMAP, SMTP, backup). */
  connections: () => Promise<Result<readonly FaberLoomConnection[]>>
  /** Create or replace one connection. */
  saveConnection: (input: { id?: string; kind: 'imap' | 'smtp' | 'backup'; label: string; host?: string; port?: number; secure?: boolean; starttls?: boolean; primary?: boolean; username?: string; secret?: string; destination?: string; retentionDays?: number }) => Promise<Result<readonly FaberLoomConnection[]>>
  /** Remove one connection. */
  removeConnection: (id: string) => Promise<Result<readonly FaberLoomConnection[]>>
  /** Check one connection for real. */
  probeConnection: (id: string) => Promise<Result<{ ok: boolean; detail: string }>>
  /** List the mailbox envelopes, newest first. */
  emailInbox: () => Promise<Result<readonly FaberLoomInboxRow[]>>
  /** Read one mailbox message, read-only: text, HTML, and attachments. */
  emailRead: (uid: string) => Promise<Result<FaberLoomEmailContent>>
  /** Mark one mailbox message as read. */
  emailMarkSeen: (uid: string) => Promise<Result<boolean>>
  /** Move one mailbox message to the Trash mailbox. */
  emailTrash: (uid: string, sender?: string, subject?: string) => Promise<Result<{ movedTo: string }>>
  /** Read one attachment's bytes for download. */
  emailAttachment: (uid: string, index: number) => Promise<Result<FaberLoomEmailAttachmentContent | undefined>>
  /** Turn one email into a Space with its Workspace, memory, and files. */
  spaceFromEmail: (uid: string, name: string, agentId: string | null, from: string | null) => void
  /** Answer one message in the routine-designer chat. */
  routineChat: (
    uid: string, messages: readonly FaberLoomRoutineChatMessage[], subject: string | null, from: string | null,
  ) => Promise<Result<string>>
  /** Create a routine from a described workflow. */
  routineFromEmail: (
    uid: string, name: string, instruction: string, subject: string | null, from: string | null,
  ) => Promise<Result<FaberLoomRoutineCreated>>
  /** Jump to the Routines panel. */
  openRoutines: () => void
  /** Extract expediente facts from one email into Space memory. */
  learnFromEmail: (uid: string) => Promise<Result<FaberLoomEmailFacts>>
  /** List the email drafts awaiting approval. */
  emailDrafts: () => Promise<Result<readonly FaberLoomEmailDraftRow[]>>
  /** Create or replace one email draft. */
  saveEmailDraft: (input: EmailDraftSaveInput) => Promise<Result<FaberLoomEmailDraftRow>>
  /** Discard one email draft. */
  deleteEmailDraft: (id: string) => Promise<Result<boolean>>
  /** Send one email draft through the owner's SMTP connection. */
  sendEmailDraft: (id: string) => Promise<Result<FaberLoomEmailDraftRow>>
  /** Read the email voice profile captured from sent mail. */
  emailVoice: (spaceId?: string) => Promise<Result<readonly FaberLoomTeachingRow[]>>
  /** Draft one email with the model, in the owner's voice, and enqueue it. */
  emailDraftWithAi: (input: EmailDraftAiInput) => Promise<Result<FaberLoomEmailDraftRow>>
  /** Read the owner's auto-send policy. */
  emailPolicy: () => Promise<Result<FaberLoomEmailPolicy>>
  /** Save the owner's auto-send policy. */
  saveEmailPolicy: (input: EmailPolicySaveInput) => Promise<Result<FaberLoomEmailPolicy>>
  /** List the owner's knowledge backups, newest first. */
  backups: () => Promise<Result<readonly FaberLoomBackupRow[]>>
  /** Capture a new knowledge backup. */
  createBackup: (note?: string) => Promise<Result<readonly FaberLoomBackupRow[]>>
  /** Verify one backup's integrity. */
  verifyBackup: (id: string) => Promise<Result<{ ok: boolean; tables: number; badTables: number }>>
  /** Restore one backup; `dryRun` previews without writing. */
  restoreBackup: (id: string, dryRun: boolean) => Promise<Result<{ dryRun: boolean; tables: number; written: number; skipped: number }>>
  /** Delete one backup record. */
  deleteBackup: (id: string) => Promise<Result<readonly FaberLoomBackupRow[]>>
  /** Build an editable proposal from a fresh request. */
  proposeWork: (text: string) => Promise<Result<FaberLoomWorkProposal>>
  /** Create a board task from a proposal, preserving the conversation. */
  createTaskFromWork: (text: string, spaceId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Create a specialist from a proposal, preserving its origin. */
  createAgentFromWork: (text: string, name: string, spaceId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Create a routine draft from a proposal. */
  createRoutineFromWork: (text: string, name: string) => Promise<Result<FaberLoomOverview>>
  /** Preview the audience and material before linking work to a space. */
  linkPreview: (spaceId: string) => Promise<Result<FaberLoomLinkPreview>>
  /** Read one space's editable configuration. */
  spaceDetail: (id: string) => Promise<Result<FaberLoomSpaceDetail | undefined>>
  /** Save one space's editable configuration. */
  saveSpace: (id: string, input: SpaceSaveInput) => Promise<Result<FaberLoomOverview>>
  /** Read a space's conversation area (its workspace, when registered). */
  spaceWorkspace: (id: string) => Promise<Result<FaberLoomSpaceWorkspace>>
  /** Start a new conversation in a space's own area. */
  startSpaceSession: (spaceId: string) => void
  /** Read one routine's editable definition. */
  routineDetail: (id: string) => Promise<Result<FaberLoomRoutineDetail | undefined>>
  /** Save one routine's editable definition. */
  saveRoutine: (id: string, input: RoutineSaveInput) => Promise<Result<FaberLoomOverview>>
  /** Remove one routine definition. */
  removeRoutine: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Read one board item's review state. */
  boardDetail: (id: string) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Permanently remove one board item from the work table. */
  deleteBoardItem: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Link one board task to the routine that runs it, or unlink it with null. */
  setBoardRoutine: (id: string, routineId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Open a chat session seeded with the work-bench task's context and the assigned agent. */
  openTaskChat: (kind: string, title: string, detail: string, agentName?: string | null) => void
  /** List one routine's executions. */
  executions: (routineId?: string) => Promise<Result<readonly FaberLoomExecutionRow[]>>
  /** Start a manual run of one routine. */
  startRoutine: (routineId: string) => Promise<Result<readonly FaberLoomExecutionRow[]>>
  /** Advance the owner's runnable steps. */
  tickRoutine: (routineId: string) => Promise<Result<readonly FaberLoomExecutionRow[]>>
  /** Reconcile one execution's pending effect. */
  reconcileExecution: (id: string) => Promise<Result<readonly FaberLoomExecutionRow[]>>
  /** Cancel one step's recorded effect. */
  cancelExecutionEffect: (id: string, stepId: string) => Promise<Result<readonly FaberLoomExecutionRow[]>>
  /** The Work Flow editor surface: graph CRUD, runs, topology, and export. */
  workflows: {
    overview: () => Promise<Result<readonly FaberLoomWorkflowRow[]>>
    detail: (id: string) => Promise<Result<FaberLoomWorkflowDetail>>
    create: (name: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
    save: (id: string, name: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
    addNode: (id: string, kind: string, title: string, configJson: string, nodeId?: string) => Promise<Result<FaberLoomWorkflowDetail>>
    updateNode: (id: string, nodeId: string, title: string, kind: string, configJson: string) => Promise<Result<FaberLoomWorkflowDetail>>
    removeNode: (id: string, nodeId: string) => Promise<Result<FaberLoomWorkflowDetail>>
    connect: (id: string, from: string, to: string, condition?: string) => Promise<Result<FaberLoomWorkflowDetail>>
    disconnect: (id: string, edgeId: string) => Promise<Result<FaberLoomWorkflowDetail>>
    setStatus: (id: string, status: string) => Promise<Result<FaberLoomWorkflowDetail>>
    setConcurrency: (id: string, maxConcurrency: number | null) => Promise<Result<FaberLoomWorkflowDetail>>
    runs: (id: string) => Promise<Result<readonly FaberLoomWorkflowRunRow[]>>
    topology: () => Promise<Result<FaberLoomSpaceMap>>
    links: () => Promise<Result<readonly FaberLoomWorkflowLink[]>>
    shareWorkflow: (
      id: string,
      emails: readonly string[],
      permissions: readonly string[],
    ) => Promise<Result<readonly FaberLoomShareGrantRow[]>>
    shareSpace: (
      id: string,
      emails: readonly string[],
      permissions: readonly string[],
    ) => Promise<Result<readonly FaberLoomShareGrantRow[]>>
    resourceShares: (kind: string, id: string) => Promise<Result<readonly FaberLoomShareGrantRow[]>>
    revokeShareGrant: (grantId: string) => Promise<Result<readonly FaberLoomShareGrantRow[]>>
    health: () => Promise<Result<FaberLoomHealth>>
    exportFlow: (id: string, format: string) => Promise<Result<FaberLoomWorkflowExport>>
    templates: () => Promise<Result<readonly FaberLoomWorkflowTemplateRow[]>>
    createFromTemplate: (templateId: string, name?: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
    importFlow: (json: string, name?: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
  }
}

/** Binds one glyph to the sidebar panellist owner props. */
function panelIcon(Glyph: ComponentType<{ size: number }>) {
  return function FaberloomPanelIcon({ size, active }: PropsRuntime<'sidebar.panellist'>) {
    return (
      <span className={styles.navIcon} data-active={active}>
        <Glyph size={size} />
      </span>
    )
  }
}

/** Component props shared by every module screen. */
type ScreenProps = PropsLocale<'faberloom'>
  & PropsStore<ReturnType<typeof createWorkspaceStore>>
  & InjectFace<FaberloomPanelInjected>

/** Runs one lazy read once per mount, surfacing the failure message. */
function useLazy<T>(run: () => Promise<Result<T>>, deps: readonly unknown[]) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'error'; message: string }>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    run()
      .then((result) => { if (live) setState(result.ok ? { kind: 'ready', value: result.value } : { kind: 'error', message: result.error.message }) })
      .catch((error: unknown) => { if (live) setState({ kind: 'error', message: String(error) }) })
    return () => { live = false }
  }, deps)
  return state
}

/** Reads the shared overview and triggers the first load when a screen mounts. */
function useOverview(props: ScreenProps) {
  const { useStore, load } = props
  const overview = useStore(state => state.overview)
  const status = useStore(state => state.status)
  const error = useStore(state => state.lastError)
  useEffect(() => { if (overview === null) load() }, [overview, load])
  return { overview, status, error }
}

/** Screen wrapper: keeps the scroll container and the split consistent. */function Screen({ title, subtitle, trailing, children }: {
  title: string
  subtitle?: string | undefined
  trailing?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <section className={styles.screen}>
      <Toolbar title={title} subtitle={subtitle} trailing={trailing} />
      {children}
    </section>
  )
}

/** Write feedback line, shared by the editors. */
function Feedback({ t, message }: { t: ScreenProps['t']; message: string | null }) {
  if (message === null) return null
  return <StateBlock kind="error" title={t('state.writeError')} text={message} />
}

/** Espacios: list, create, and rename. */
function spacesScreen() {
  return function FaberloomSpaces(props: ScreenProps) {
    const { t, createSpace, deleteSpace, goToWorkspace, spaceDetail, saveSpace, spaceWorkspace, startSpaceSession } = props
    const { overview, status, error } = useOverview(props)
    const [draft, setDraft] = useState('')
    const [agentId, setAgentId] = useState('')
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [title, setTitle] = useState('')
    const [inherit, setInherit] = useState(true)
    const [members, setMembers] = useState('')
    const [spaceAgentId, setSpaceAgentId] = useState('')
    const [parentId, setParentId] = useState('')
    const [newInherit, setNewInherit] = useState(true)
    const [creating, setCreating] = useState(false)
    const agents = useMemo(() => (overview?.agents ?? []).filter(agent => agent.active), [overview])
    const rows = useMemo(
      () => (overview?.spaces ?? []).filter(space => space.title.toLowerCase().includes(query.trim().toLowerCase())),
      [overview, query],
    )
    const detail = useLazy<FaberLoomSpaceDetail | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : spaceDetail(selected),
      [selected],
    )
    const workspace = useLazy<FaberLoomSpaceWorkspace | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : spaceWorkspace(selected),
      [selected],
    )
    const detailValue = detail.kind === 'ready' ? detail.value : undefined

    useEffect(() => {
      if (detail.kind !== 'ready' || detail.value === undefined) return
      setTitle(detail.value.title)
      setInherit(detail.value.inheritContext)
      setMembers(detail.value.members.join(', '))
      setSpaceAgentId(detail.value.agentId ?? '')
      setMessage(null)
    }, [detail])

    const columns: readonly Column<FaberLoomOverview['spaces'][number]>[] = [
      {
        key: 'title',
        header: t('col.name'),
        cell: space => (
          <button className={styles.cellLink} type="button" title={t('spaces.openWorkspace')}
            onClick={(event) => { event.stopPropagation(); goToWorkspace(space.id) }}>{space.title}</button>
        ),
      },
      { key: 'parent', header: t('col.parent'), cell: space => <span className={styles.cellMuted}>{space.parentId ?? t('spaces.root')}</span> },
      { key: 'agent', header: t('col.agent'), cell: space => <span className={styles.cellMuted}>{space.agentName ?? t('spaces.noAgent')}</span> },
    ]

    const create = (): void => {
      setMessage(null)
      const name = draft.trim().length === 0 ? t('spaces.untitled') : draft.trim()
      createSpace(name, agentId.length === 0 ? null : agentId, parentId.length === 0 ? null : parentId, newInherit)
      setDraft('')
      setAgentId('')
      setParentId('')
      setNewInherit(true)
      setCreating(false)
    }

    /** Open the create dialog, optionally preset for a sub-space of `parent`. */
    const openCreate = (parent: string, agent: string, inheritChild: boolean): void => {
      setMessage(null)
      setDraft('')
      setParentId(parent)
      setAgentId(agent)
      setNewInherit(inheritChild)
      setCreating(true)
    }

    return (
      <Screen title={t('panel.spaces.title')} subtitle={t('panel.spaces.intro')}
        trailing={(
          <>
            <SearchBox value={query} onChange={setQuery} placeholder={t('action.search')} label={t('action.search')} />
            <button className={styles.primary} type="button" onClick={() => { openCreate('', '', true) }}>{t('spaces.createTitle')}</button>
          </>
        )}>
        <Feedback t={t} message={error ?? message} />
        <div className={styles.split}>
          {overview === null && status === 'loading'
            ? <StateBlock kind="loading" title={t('state.loading')} />
            : <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={setSelected} emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />}
          <Inspector title={detail.kind === 'ready' && detail.value !== undefined ? detail.value.title : t('spaces.detail')}
            footer={selected === null ? undefined : (
              <>
                <span className={styles.tools}>
                  <button className={styles.secondary} type="button" onClick={() => { openCreate(selected, spaceAgentId, true) }}>{t('spaces.newSubspace')}</button>
                  <button className={styles.danger} type="button" onClick={() => {
                    setMessage(null)
                    deleteSpace(selected)
                    setSelected(null)
                  }}>{t('action.delete')}</button>
                </span>
                <span className={styles.tools}>
                  <button className={styles.ghost} type="button" onClick={() => { setSelected(null) }}>{t('action.cancel')}</button>
                  <button className={styles.primary} type="button" onClick={() => {
                    setMessage(null)
                    void saveSpace(selected, {
                      title,
                      inheritContext: inherit,
                      members: members.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0),
                      agentId: spaceAgentId.length === 0 ? null : spaceAgentId,
                    })
                      .then((result) => { if (!result.ok) setMessage(result.error.message) })
                      .catch((cause: unknown) => { setMessage(String(cause)) })
                  }}>{t('action.save')}</button>
                </span>
              </>
            )}>
            {selected === null
              ? <StateBlock kind="empty" title={t('spaces.selectTitle')} text={t('spaces.selectText')} />
              : detail.kind === 'loading'
                ? <StateBlock kind="loading" title={t('state.loading')} />
                : detail.kind === 'error'
                  ? <StateBlock kind="error" title={t('state.error')} text={detail.message} />
                  : detail.value === undefined
                    ? <StateBlock kind="empty" title={t('state.empty.title')} text={t('state.empty.text')} />
                    : (
                      <>
                        <Field label={t('field.name')}><input type="text" value={title} onChange={(event) => { setTitle(event.target.value) }} /></Field>
                        <Field label={t('field.parent')}><span className={styles.cellMuted}>{detail.value.parentId ?? t('spaces.root')}</span></Field>
                        <Field label={t('col.agent')}>
                          <select value={spaceAgentId} onChange={(event) => { setSpaceAgentId(event.target.value) }}>
                            <option value="">{t('spaces.noAgent')}</option>
                            {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                          </select>
                        </Field>
                        <Field label={t('field.inherit')} hint={t('spaces.inheritHint')}>
                          <select value={inherit ? 'yes' : 'no'} onChange={(event) => { setInherit(event.target.value === 'yes') }}>
                            <option value="yes">{t('spaces.inheritYes')}</option>
                            <option value="no">{t('spaces.inheritNo')}</option>
                          </select>
                        </Field>
                        <Field label={t('spaces.conversations')} hint={t('spaces.workspaceHint')}>
                          {workspace.kind === 'loading'
                            ? <span className={styles.cellMuted}>{t('state.loading')}</span>
                            : workspace.kind !== 'ready' || workspace.value === undefined || !workspace.value.registered
                              ? <span className={styles.cellMuted}>{t('spaces.noWorkspace')}</span>
                              : <span className={styles.cellMuted}>{`${workspace.value.title ?? ''} · ${String(workspace.value.sessions)}`}</span>}
                          <span className={styles.tools}>
                            <button className={styles.secondary} type="button" disabled={detailValue === undefined} onClick={() => { if (detailValue !== undefined) startSpaceSession(detailValue.id) }}>{t('spaces.newInSpace')}</button>
                          </span>
                        </Field>
                      </>
                    )}
          </Inspector>
        </div>
        <Modal open={creating} onClose={() => { setCreating(false) }} title={t('spaces.createTitle')} closeLabel={t('action.close')}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setCreating(false) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={create}>{t('action.create')}</button>
            </>
          )}>
          <Field label={t('field.name')}>
            <input type="text" value={draft} placeholder={t('panel.spaces.newPlaceholder')}
              onChange={(event) => { setDraft(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') create() }} />
          </Field>
          <Field label={t('col.parent')}>
            <select value={parentId} onChange={(event) => { setParentId(event.target.value) }}>
              <option value="">{t('spaces.noParent')}</option>
              {(overview?.spaces ?? []).map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
            </select>
          </Field>
          <Field label={t('col.agent')}>
            <select value={agentId} onChange={(event) => { setAgentId(event.target.value) }}>
              <option value="">{t('spaces.noAgent')}</option>
              {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </Field>
          <Field label={t('field.inherit')} hint={t('spaces.inheritHint')}>
            <select value={newInherit ? 'yes' : 'no'} onChange={(event) => { setNewInherit(event.target.value === 'yes') }}>
              <option value="yes">{t('spaces.inheritYes')}</option>
              <option value="no">{t('spaces.inheritNo')}</option>
            </select>
          </Field>
        </Modal>
      </Screen>
    )
  }
}

/** Agentes: table plus the full editor. */
function agentsScreen() {
  return function FaberloomAgents(props: ScreenProps) {
    const {
      t, agentDetail, saveAgent, deactivateAgent, purgeAgent, createAgent, connections,
      shareAgent, shares, unshareShare, modelCatalog,
    } = props
    const { overview, error } = useOverview(props)
    const [selected, setSelected] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [message, setMessage] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [drafting, setDrafting] = useState(false)
    const [name, setName] = useState('')
    const [responsibility, setResponsibility] = useState('')
    const [assigned, setAssigned] = useState<readonly string[]>([])
    const [provider, setProvider] = useState('')
    const [modelId, setModelId] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [hasApiKey, setHasApiKey] = useState(false)
    const [webAccess, setWebAccess] = useState(false)
    const [mwtMcp, setMwtMcp] = useState(true)
    const [sicopMcp, setSicopMcp] = useState(true)
    const [mailIds, setMailIds] = useState<readonly string[]>([])
    const [subagentIds, setSubagentIds] = useState<readonly string[]>([])
    const [apiKeyTail, setApiKeyTail] = useState<string | null>(null)
    const [shareEmails, setShareEmails] = useState('')
    const [shareAll, setShareAll] = useState(false)
    const [shareMsg, setShareMsg] = useState<string | null>(null)
    const [outShares, setOutShares] = useState<readonly FaberLoomShareRow[]>([])

    const agents = useMemo(
      () => (overview?.agents ?? []).filter(agent => agent.name.toLowerCase().includes(query.trim().toLowerCase())),
      [overview, query],
    )
    const spaceTitles = useMemo(
      () => new Map((overview?.spaces ?? []).map(space => [space.id, space.title])),
      [overview],
    )
    const detail = useLazy<FaberLoomAgentDetail | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : agentDetail(selected),
      [selected],
    )
    const catalog = useLazy<readonly FaberLoomSkillRow[]>(() => props.skills(), [])
    const connectionsList = useLazy<readonly FaberLoomConnection[]>(() => connections(), [])
    const liveCatalog = useLazy<FaberLoomModelCatalog>(() => modelCatalog(), [])
    const liveProviders = useMemo(
      () => liveCatalog.kind === 'ready' ? liveCatalog.value.providers : [],
      [liveCatalog],
    )
    const providerOptions = useMemo(
      () => liveProviders.length > 0 ? liveProviders.map(entry => entry.id) : [...MODEL_PROVIDERS],
      [liveProviders],
    )
    const modelOptions = useMemo(
      () => liveProviders.find(entry => entry.id === provider)?.models ?? [],
      [liveProviders, provider],
    )

    // Load the selected agent's configuration into the editable fields.
    useEffect(() => {
      if (detail.kind !== 'ready' || detail.value === undefined) return
      setName(detail.value.name)
      setResponsibility(detail.value.responsibility)
      setAssigned(detail.value.skills)
      setProvider(detail.value.provider ?? '')
      setModelId(detail.value.model ?? '')
      setApiKey('')
      setHasApiKey(detail.value.hasApiKey)
      setApiKeyTail(detail.value.apiKeyTail ?? null)
      setWebAccess(detail.value.webAccess)
      setMwtMcp(detail.value.mwtMcp)
      setSicopMcp(detail.value.sicopMcp)
      setMailIds(detail.value.mailConnectionIds)
      setSubagentIds(detail.value.subagentIds)
      setShareEmails('')
      setShareAll(false)
      setShareMsg(null)
      setMessage(null)
    }, [detail])

    // What the owner already shares, so the panel can list and retract it.
    useEffect(() => {
      void shares()
        .then((result) => { if (result.ok) setOutShares(result.value.outgoing) })
        .catch(() => {})
    }, [shares, selected])

    const columns: readonly Column<FaberLoomOverview['agents'][number]>[] = [
      { key: 'name', header: t('col.name'), cell: agent => (
        <span className={styles.cellName}>
          {agent.name}
          {agent.sharedBy === undefined
            ? null
            : <span className={styles.cellMuted}>{t('agents.sharedBy')}{' '}{agent.sharedBy}</span>}
        </span>
      ) },
      { key: 'status', header: t('col.status'), cell: agent => <StatusDot on={agent.active} label={agent.active ? t('status.active') : t('status.inactive')} /> },
      { key: 'space', header: t('col.space'), cell: agent => agent.detached
        ? <Chip tone="muted">{t('agents.unassigned')}</Chip>
        : <span className={styles.cellMuted}>{agent.spaceIds.length === 0 ? t('spaces.root') : agent.spaceIds.map(id => spaceTitles.get(id) ?? id).join(', ')}</span> },
    ]

    /** Open the inspector in create mode with empty fields. */
    const openDraft = (): void => {
      setDrafting(true)
      setSelected(null)
      setName('')
      setResponsibility('')
      setAssigned([])
      setProvider('')
      setModelId('')
      setApiKey('')
      setHasApiKey(false)
      setWebAccess(false)
      setMwtMcp(true)
      setSicopMcp(true)
      setMailIds([])
      setSubagentIds([])
      setMessage(null)
    }

    const save = (): void => {
      if (drafting) {
        setMessage(null)
        createAgent({
          name: name.trim().length === 0 ? t('agents.untitled') : name.trim(),
          responsibility,
          provider: provider.length === 0 ? null : provider,
          model: modelId.length === 0 ? null : modelId,
          apiKey,
          webAccess,
          mwtMcp,
          sicopMcp,
          mailConnectionIds: mailIds,
          subagentIds,
        })
        setDrafting(false)
        return
      }
      if (selected === null) return
      setSaving(true)
      setMessage(null)
      /* jscpd:ignore-start -- the save handler chain mirrors the routines panel; the two editors own separate state */
      void saveAgent(selected, {
        name,
        responsibility,
        skills: assigned,
        provider: provider.length === 0 ? null : provider,
        model: modelId.length === 0 ? null : modelId,
        webAccess,
        mwtMcp,
        sicopMcp,
        mailConnectionIds: mailIds,
        subagentIds,
        ...apiKey.length === 0 ? {} : { apiKey },
      })
        .then((result) => { if (!result.ok) setMessage(result.error.message) })
        .catch((cause: unknown) => { setMessage(String(cause)) })
        .finally(() => { setSaving(false) })
      /* jscpd:ignore-end */
    }

    const editTitle = drafting
      ? t('agents.createTitle')
      : detail.kind === 'ready' && detail.value !== undefined
        ? detail.value.name
        : t('agents.editor')

    // A seeded/global agent belongs to the deployment: only Admin/CEO may edit
    // or delete it, and its API key is never revealable. A user-created agent is
    // editable by its owner.
    const selectedRow = (overview?.agents ?? []).find(agent => agent.id === selected) ?? null
    const canEdit = drafting || selectedRow?.editable === true

    return (
      <Screen title={t('panel.agents.title')} subtitle={t('panel.agents.intro')}
        trailing={(
          <>
            <SearchBox value={query} onChange={setQuery} placeholder={t('action.search')} label={t('action.search')} />
            <button className={styles.primary} type="button" onClick={openDraft}>{t('agents.createTitle')}</button>
          </>
        )}>
        <Feedback t={t} message={error ?? message} />
        <div className={styles.split}>
          <DataTable columns={columns} rows={agents} selectedId={selected} onSelect={(id) => { setDrafting(false); setSelected(id) }}
            emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />
          <Inspector
            title={editTitle}
            status={drafting
              ? <StatusDot on label={t('status.active')} />
              : detail.kind === 'ready' && detail.value !== undefined
                ? <StatusDot on={detail.value.active} label={detail.value.active ? t('status.active') : t('status.inactive')} />
                : undefined}
            footer={selected === null && !drafting ? undefined : (
              <>
                <span className={styles.tools}>
                  {drafting || !canEdit ? null : (
                    <>
                      <button className={styles.danger} type="button" onClick={() => { purgeAgent(selected ?? ''); setSelected(null) }}>{t('action.delete')}</button>
                      {detail.kind === 'ready' && detail.value?.active === true
                        ? <button className={styles.ghost} type="button" onClick={() => { if (selected !== null) deactivateAgent(selected) }}>{t('action.deactivate')}</button>
                        : null}
                    </>
                  )}
                </span>
                {/* jscpd:ignore-start -- the footer cancel/save pair mirrors the routines editor; agents adds its canEdit gate */}
                <span className={styles.tools}>
                  <button className={styles.ghost} type="button" onClick={() => { if (drafting) setDrafting(false); else setSelected(null) }}>{t('action.cancel')}</button>
                  <button className={styles.primary} type="button" disabled={saving || !canEdit} onClick={save}>{drafting ? t('action.create') : t('action.save')}</button>
                </span>
                {/* jscpd:ignore-end */}
              </>
            )}
          >
            {selected === null && !drafting
              ? <StateBlock kind="empty" title={t('agents.selectTitle')} text={t('agents.selectText')} />
              : !drafting && detail.kind === 'loading'
                ? <StateBlock kind="loading" title={t('state.loading')} />
                : !drafting && detail.kind === 'error'
                  ? <StateBlock kind="error" title={t('state.error')} text={detail.message} />
                  : (
                    <>
                      <Field label={t('field.name')}>
                        <input type="text" autoComplete="off" value={name} onChange={(event) => { setName(event.target.value) }} />
                      </Field>
                      <Field label={t('field.responsibility')} hint={t('agents.promptHint')}>
                        <textarea value={responsibility} onChange={(event) => { setResponsibility(event.target.value) }} />
                      </Field>
                      <Field label={t('field.skills')}>
                        {catalog.kind === 'loading'
                          ? <StateBlock kind="loading" title={t('state.loading')} />
                          : catalog.kind === 'error'
                            ? <StateBlock kind="error" title={t('state.error')} text={catalog.message} />
                            : (
                              <SkillTransfer
                                t={t}
                                labels={{ available: t('skills.available'), assigned: t('skills.assigned'), search: t('action.search'), add: t('action.add'), remove: t('action.remove') }}
                                available={catalog.value.map(skill => ({
                                  id: skill.name, name: skill.name, meta: skill.module ?? skill.description,
                                }))}
                                assigned={assigned}
                                onChange={setAssigned}
                              />
                            )}
                      </Field>
                      <Field label={t('field.connectedAgents')} hint={t('agents.connectedHint')}>
                        <SkillTransfer
                          t={t}
                          labels={{ available: t('agents.connectedAvailable'), assigned: t('agents.connectedAssigned'), search: t('action.search'), add: t('action.add'), remove: t('action.remove') }}
                          available={(overview?.agents ?? []).filter(agent => agent.id !== selected).map(agent => ({ id: agent.id, name: agent.name, meta: agent.spaceIds.length === 0 ? t('agents.unassigned') : '' }))}
                          assigned={subagentIds}
                          onChange={setSubagentIds}
                        />
                      </Field>
                      <Field label={t('field.provider')}>
                        <select value={provider} onChange={(event) => { setProvider(event.target.value); setModelId('') }}>
                          <option value="">{t('agents.providerUnset')}</option>
                          {provider !== '' && !providerOptions.includes(provider) ? <option value={provider}>{provider}</option> : null}
                          {providerOptions.map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </Field>
                      <Field label={t('field.modelId')} hint={t('agents.modelIdHint')}>
                        {modelOptions.length === 0
                          ? <input type="text" autoComplete="off" value={modelId} placeholder={t('agents.modelIdPlaceholder')} onChange={(event) => { setModelId(event.target.value) }} />
                          : (
                            <select value={modelId} onChange={(event) => { setModelId(event.target.value) }}>
                              <option value="">{t('agents.modelUnset')}</option>
                              {modelId !== '' && !modelOptions.includes(modelId) ? <option value={modelId}>{modelId}</option> : null}
                              {modelOptions.map(item => <option key={item} value={item}>{item}</option>)}
                            </select>
                          )}
                      </Field>
                      <Field label={t('field.apiKey')} hint={t('agents.apiKeyHint')}>
                        <div className={styles.grid2}>
                          <SecretInput
                            showLabel={t('agents.apiKeyShow')}
                            hideLabel={t('agents.apiKeyHide')}
                            revealable={canEdit}
                            disabled={!canEdit}
                            value={apiKey}
                            placeholder={hasApiKey ? '••••••••' : t('agents.apiKeyPlaceholder')}
                            autoComplete="new-password"
                            onChange={(event) => { setApiKey(event.target.value) }}
                          />
                          {hasApiKey && canEdit ? (
                            <button className={styles.ghost} type="button" onClick={() => {
                              setMessage(null)
                              void saveAgent(selected ?? '', { apiKey: '' })
                                .then((result) => { if (!result.ok) setMessage(result.error.message); else setHasApiKey(false) })
                                .catch((cause: unknown) => { setMessage(String(cause)) })
                            }}>{t('agents.apiKeyClear')}</button>
                          ) : null}
                        </div>
                        {hasApiKey && apiKeyTail !== null ? (
                          <p className={styles.hint}>{t('agents.apiKeyStored')}{' '}{apiKeyTail}</p>
                        ) : null}
                      </Field>
                      {drafting || canEdit ? null : (
                        <p className={styles.hint}>{t('agents.adminOnly')}</p>
                      )}
                      {drafting || !canEdit ? null : (
                        <Field label={t('agents.share')} hint={t('agents.shareHint')}>
                          <input type="text" value={shareEmails} placeholder={t('agents.sharePlaceholder')}
                            onChange={(event) => { setShareEmails(event.target.value) }} />
                          <label className={styles.stepFlag}>
                            <input type="checkbox" checked={shareAll} onChange={(event) => { setShareAll(event.target.checked) }} />
                            <span>{t('agents.shareAll')}</span>
                          </label>
                          <div className={styles.grid2}>
                            <button className={styles.ghost} type="button" disabled={saving}
                              onClick={() => {
                                const emails = shareEmails.split(',').map(value => value.trim()).filter(value => value.length > 0)
                                if (!shareAll && emails.length === 0) { setShareMsg(t('agents.shareNeedTarget')); return }
                                setSaving(true)
                                /* jscpd:ignore-start -- the share call mirrors the skills panel; agents also clears saving */
                                void shareAgent(selected ?? '', emails, shareAll)
                                  .then((result) => {
                                    if (!result.ok) setShareMsg(result.error.message)
                                    else { setShareMsg(t('agents.shareDone')); setShareEmails(''); setShareAll(false); setOutShares(result.value.outgoing) }
                                  })
                                  .catch((cause: unknown) => { setShareMsg(String(cause)) })
                                  .finally(() => { setSaving(false) })
                                /* jscpd:ignore-end */
                              }}>{t('agents.share')}</button>
                            {shareMsg === null ? null : <span className={styles.cellMuted}>{shareMsg}</span>}
                          </div>
                          {outShares.filter(share => share.kind === 'agent' && share.name === name).map(share => (
                            <div key={share.id} className={styles.grid2}>
                              <span className={styles.cellMuted}>{share.share_all ? t('agents.shareAllShort') : share.shared_emails.join(', ')}</span>
                              <button className={styles.ghost} type="button" onClick={() => {
                                void unshareShare(share.id)
                                  .then((result) => { if (result.ok) setOutShares(result.value.outgoing) })
                                  .catch(() => {})
                              }}>{t('agents.unshare')}</button>
                            </div>
                          ))}
                        </Field>
                      )}
                      <Field label={t('field.webAccess')} hint={t('agents.webAccessHint')}>
                        <label className={styles.stepFlag}>
                          <input type="checkbox" checked={webAccess} onChange={(event) => { setWebAccess(event.target.checked) }} />
                          {t('agents.webAccessAllow')}
                        </label>
                      </Field>
                      <Field label={t('field.mwtMcp')} hint={t('agents.mwtMcpHint')}>
                        <label className={styles.stepFlag}>
                          <input type="checkbox" checked={mwtMcp} onChange={(event) => { setMwtMcp(event.target.checked) }} />
                          {t('agents.mwtMcpAllow')}
                        </label>
                      </Field>
                      <Field label={t('field.sicopMcp')} hint={t('agents.sicopMcpHint')}>
                        <label className={styles.stepFlag}>
                          <input type="checkbox" checked={sicopMcp} onChange={(event) => { setSicopMcp(event.target.checked) }} />
                          {t('agents.sicopMcpAllow')}
                        </label>
                      </Field>
                      <Field label={t('field.mail')} hint={t('agents.mailHint')}>
                        <div className={styles.steps}>
                          {(connectionsList.kind === 'ready' ? connectionsList.value : []).filter(conn => conn.kind === 'imap' || conn.kind === 'smtp').map(conn => (
                            <label className={styles.stepFlag} key={conn.id}>
                              <input type="checkbox" checked={mailIds.includes(conn.id)}
                                onChange={(event) => {
                                  setMailIds(event.target.checked ? [...mailIds, conn.id] : mailIds.filter(id => id !== conn.id))
                                }} />
                              {`${conn.kind}: ${conn.label}`}
                            </label>
                          ))}
                        </div>
                      </Field>
                    </>
                  )}
          </Inspector>
        </div>
      </Screen>
    )
  }
}

/** Correo: the mailbox envelopes and the drafts awaiting approval. */
function emailScreen() {
  return function FaberloomEmail(props: ScreenProps) {
    const {
      t, emailInbox, emailRead, emailAttachment, emailMarkSeen, emailTrash, emailDrafts, saveEmailDraft, deleteEmailDraft, sendEmailDraft,
      emailVoice, emailDraftWithAi, emailPolicy, saveEmailPolicy, spaceFromEmail, routineChat, routineFromEmail,
      openRoutines, learnFromEmail, startConversation,
    } = props
    const { overview } = useOverview(props)
    const agentOptions = (overview?.agents ?? []).filter(agent => agent.active)
    const [mode, setMode] = useState<'inbox' | 'drafts'>('inbox')
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [reload, setReload] = useState(0)
    const [composing, setComposing] = useState(false)
    const [draftId, setDraftId] = useState<string | null>(null)
    const [to, setTo] = useState('')
    const [cc, setCc] = useState('')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [inReplyTo, setInReplyTo] = useState<string | null>(null)
    const [instruction, setInstruction] = useState('')
    const [aiText, setAiText] = useState<string | null>(null)
    const [replyBody, setReplyBody] = useState<string | null>(null)
    const [attachments, setAttachments] = useState<readonly string[]>([])
    const [spaceOpen, setSpaceOpen] = useState(false)
    const [spaceName, setSpaceName] = useState('')
    const [spaceAgent, setSpaceAgent] = useState('')
    const [routineOpen, setRoutineOpen] = useState(false)
    const [routineMessages, setRoutineMessages] = useState<readonly FaberLoomRoutineChatMessage[]>([])
    const [routineInput, setRoutineInput] = useState('')
    const [routineBusy, setRoutineBusy] = useState(false)
    const [routineCreated, setRoutineCreated] = useState<FaberLoomRoutineCreated | null>(null)
    const inbox = useLazy<readonly FaberLoomInboxRow[]>(() => emailInbox(), [reload])
    const drafts = useLazy<readonly FaberLoomEmailDraftRow[]>(() => emailDrafts(), [reload])
    const voice = useLazy<readonly FaberLoomTeachingRow[]>(() => emailVoice(), [reload])
    const policy = useLazy<FaberLoomEmailPolicy>(() => emailPolicy(), [reload])
    const [autoEnabled, setAutoEnabled] = useState(false)
    const [autoThreshold, setAutoThreshold] = useState('3')
    useEffect(() => {
      if (policy.kind !== 'ready') return
      setAutoEnabled(policy.value.enabled)
      setAutoThreshold(String(policy.value.threshold))
    }, [policy])
    const mailBody = useLazy<FaberLoomEmailContent>(
      () => selected === null || mode !== 'inbox'
        ? Promise.resolve({ ok: true as const, value: { text: '', html: null, attachments: [] } })
        : emailRead(selected),
      [selected, mode],
    )

    /** Fetch one attachment's bytes and save it through a temporary link. */
    const downloadAttachment = (uid: string, index: number, name: string): void => {
      void emailAttachment(uid, index).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (result.value === undefined) { setMessage(t('state.error')); return }
        const bytes = Uint8Array.from(atob(result.value.contentBase64), char => char.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: result.value.mediaType }))
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        URL.revokeObjectURL(url)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }
    const inboxRows = inbox.kind === 'ready' ? inbox.value : []
    const draftRows = drafts.kind === 'ready' ? drafts.value : []
    const rows: readonly { id: string }[] = mode === 'inbox' ? inboxRows : draftRows
    const chosenMail = mode === 'inbox' ? inboxRows.find(row => row.id === selected) ?? null : null

    const recipients = (value: string): string[] => value.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)

    const openCompose = (mail?: FaberLoomInboxRow): void => {
      setComposing(true)
      setSelected(null)
      setDraftId(null)
      setTo(mail?.from ?? '')
      setCc('')
      setSubject(mail === undefined || mail.subject === null ? '' : `Re: ${mail.subject}`)
      setBody('')
      setInReplyTo(mail?.messageId ?? null)
      setInstruction('')
      setAiText(null)
      setReplyBody(mailBody.kind === 'ready' ? (mailBody.value.text.length > 0 ? mailBody.value.text : mailBody.value.html) : null)
      setAttachments([])
      setMessage(null)
    }

    const openDraft = (draft: FaberLoomEmailDraftRow): void => {
      setComposing(true)
      setSelected(draft.id)
      setDraftId(draft.id)
      setTo(draft.to.join(', '))
      setCc(draft.cc.join(', '))
      setSubject(draft.subject)
      setBody(draft.text)
      setInReplyTo(draft.inReplyTo)
      setInstruction('')
      setAiText(draft.aiText)
      setReplyBody(null)
      setAttachments([])
      setMessage(null)
    }

    /** Note the chosen file names in the body; real SMTP attachments are next. */
    const onFiles = (files: FileList | null): void => {
      const names = files === null ? [] : Array.from(files).map(file => file.name)
      if (names.length === 0) return
      setAttachments(previous => [...new Set([...previous, ...names])])
      setBody(previous => previous.length === 0 ? `Adjuntos: ${names.join(', ')}` : `${previous}\n\nAdjuntos: ${names.join(', ')}`)
    }

    /** Persist the composer, returning the stored draft id (or null on failure). */
    const persist = async (): Promise<string | null> => {
      setMessage(null)
      const result = await saveEmailDraft({
        ...draftId === null ? {} : { id: draftId },
        to: recipients(to),
        cc: recipients(cc),
        subject,
        text: body,
        aiText,
        inReplyTo,
      })
      if (!result.ok) { setMessage(result.error.message); return null }
      setDraftId(result.value.id)
      setReload(value => value + 1)
      return result.value.id
    }

    /** Ask the model to write the draft in the owner's voice; never sends. */
    const draftWithAi = (): void => {
      if (instruction.trim().length === 0) { setMessage(t('state.needsText')); return }
      setMessage(null)
      void emailDraftWithAi({
        to: recipients(to),
        subject,
        instruction,
        replyToBody: replyBody,
      }).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setDraftId(result.value.id)
        setBody(result.value.text)
        setAiText(result.value.aiText)
        setReload(value => value + 1)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const send = (): void => {
      void (async () => {
        const id = await persist()
        if (id === null) return
        const result = await sendEmailDraft(id)
        if (!result.ok) { setMessage(result.error.message); return }
        setComposing(false)
        setDraftId(null)
        setReload(value => value + 1)
      })()
    }

    /** Open the "turn this email into a Space" dialog, presetting the subject. */
    const openSpace = (): void => {
      if (chosenMail === null) return
      setSpaceName(chosenMail.subject ?? '')
      setSpaceAgent('')
      setSpaceOpen(true)
    }

    /** Open the routine-designer chat for the chosen email. */
    const openRoutine = (): void => {
      if (chosenMail === null) return
      setRoutineMessages([])
      setRoutineInput('')
      setRoutineCreated(null)
      setRoutineOpen(true)
    }

    const appendRoutine = (role: string, content: string): void => {
      setRoutineMessages(current => [...current, { role, content }])
    }

    const sendRoutine = (): void => {
      const text = routineInput.trim()
      if (text.length === 0 || routineBusy) return
      const next = [...routineMessages, { role: 'user', content: text }]
      setRoutineMessages(next)
      setRoutineInput('')
      setRoutineBusy(true)
      void routineChat(selected ?? '', next, chosenMail?.subject ?? null, chosenMail?.from ?? null).then((result) => {
        setRoutineBusy(false)
        appendRoutine('assistant', result.ok ? result.value : result.error.message)
      }).catch(() => {
        setRoutineBusy(false)
        appendRoutine('assistant', t('routine.failed'))
      })
    }

    const createRoutine = (): void => {
      const instruction = routineMessages.filter(entry => entry.role === 'user').map(entry => entry.content).join('\n')
      if (instruction.trim().length === 0 || routineBusy) return
      setRoutineBusy(true)
      void routineFromEmail(selected ?? '', chosenMail?.subject ?? '', instruction, chosenMail?.subject ?? null, chosenMail?.from ?? null).then((result) => {
        setRoutineBusy(false)
        if (!result.ok) { appendRoutine('assistant', result.error.message); return }
        setRoutineCreated(result.value)
        appendRoutine('assistant', `${t('routine.created')}: ${result.value.name}`)
      }).catch(() => {
        setRoutineBusy(false)
        appendRoutine('assistant', t('routine.failed'))
      })
    }

    const learn = (): void => {
      if (chosenMail === null) return
      setMessage(t('learn.working'))
      void learnFromEmail(selected ?? '').then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        const parts = [
          result.value.cliente, result.value.oc, result.value.po, result.value.sku,
          result.value.tallas, result.value.cantidad, result.value.precio,
        ].filter(part => part.length > 0)
        setMessage(`${t('learn.done')}: ${parts.join(' · ')}`)
      }).catch(() => { setMessage(t('learn.failed')) })
    }

    const discard = (): void => {
      if (draftId === null) { setComposing(false); return }
      void deleteEmailDraft(draftId)
        .then((result) => {
          if (!result.ok) { setMessage(result.error.message); return }
          setComposing(false)
          setDraftId(null)
          setReload(value => value + 1)
        })
        .catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const columns: readonly Column<{ id: string }>[] = mode === 'inbox'
      ? [
        { key: 'from', header: t('col.from'), cell: row => <span className={styles.cellName}>{(row as FaberLoomInboxRow).from ?? '—'}</span> },
        { key: 'subject', header: t('col.subject'), cell: row => <span className={styles.cellMuted}>{(row as FaberLoomInboxRow).subject ?? '—'}</span> },
        { key: 'date', header: t('col.date'), cell: row => <span className={styles.cellMuted}>{(row as FaberLoomInboxRow).date ?? ''}</span> },
      ]
      : [
        { key: 'to', header: t('col.to'), cell: row => <span className={styles.cellName}>{(row as FaberLoomEmailDraftRow).to.join(', ')}</span> },
        { key: 'subject', header: t('col.subject'), cell: row => <span className={styles.cellMuted}>{(row as FaberLoomEmailDraftRow).subject}</span> },
        { key: 'status', header: t('col.status'), cell: row => <Chip>{(row as FaberLoomEmailDraftRow).status}</Chip> },
      ]

    const tableState = mode === 'inbox' ? inbox : drafts

    return (
      <Screen title={t('panel.email.title')} subtitle={t('panel.email.intro')}
        trailing={(
          <>
            <select className={styles.paneSearch} style={{ width: 160, padding: '8px 10px' }} value={mode} aria-label={t('email.mode')}
              onChange={(event) => { setMode(event.target.value === 'inbox' ? 'inbox' : 'drafts'); setSelected(null); setComposing(false) }}>
              <option value="inbox">{t('email.inbox')}</option>
              <option value="drafts">{t('email.drafts')}</option>
            </select>
            <button className={styles.primary} type="button" onClick={() => { openCompose() }}>{t('email.newDraft')}</button>
          </>
        )}>
        <Feedback t={t} message={message} />
        {tableState.kind === 'loading' && rows.length === 0
          ? <StateBlock kind="loading" title={t('state.loading')} />
          : tableState.kind === 'error'
            ? <StateBlock kind="error" title={t('state.error')} text={tableState.message} />
            : (
              <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={(id) => {
                if (mode === 'drafts') {
                  const draft = draftRows.find(candidate => candidate.id === id)
                  if (draft !== undefined) openDraft(draft)
                } else {
                  setSelected(id)
                  setComposing(false)
                }
              }} emptyTitle={t('state.empty.title')} emptyText={t('state.empty.email')} labels={tableLabels(t)} />
            )}
        <Modal open={!composing && chosenMail !== null} onClose={() => { setSelected(null) }} title={chosenMail?.subject ?? t('email.read')}
          closeLabel={t('action.close')} className={String(styles.emailModal)} contentClassName={String(styles.emailModalContent)}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setSelected(null) }}>{t('action.close')}</button>
              <button className={styles.secondary} type="button" onClick={() => {
                if (chosenMail === null) return
                setMessage(null)
                void emailMarkSeen(chosenMail.id).then((result) => {
                  if (!result.ok) { setMessage(result.error.message); return }
                  setReload(reload + 1)
                }).catch((cause: unknown) => { setMessage(String(cause)) })
              }}>{t('email.markRead')}</button>
              <button className={styles.danger} type="button" onClick={() => {
                if (chosenMail === null) return
                setMessage(null)
                void emailTrash(chosenMail.id, chosenMail.from ?? undefined, chosenMail.subject ?? undefined).then((result) => {
                  if (!result.ok) { setMessage(result.error.message); return }
                  setSelected(null)
                  setReload(reload + 1)
                }).catch((cause: unknown) => { setMessage(String(cause)) })
              }}>{t('email.trash')}</button>
              <button className={styles.secondary} type="button" onClick={openSpace}>{t('email.toSpace')}</button>
              <button className={styles.secondary} type="button" onClick={openRoutine}>{t('routine.title')}</button>
              <button className={styles.secondary} type="button" onClick={learn}>{t('learn.button')}</button>
              <button className={styles.primary} type="button" onClick={() => { if (chosenMail !== null) openCompose(chosenMail) }}>{t('email.reply')}</button>
            </>
          )}>
          <Field label={t('col.from')}><span className={styles.cellMuted}>{chosenMail?.from ?? '—'}</span></Field>
          <Field label={t('col.date')}><span className={styles.cellMuted}>{chosenMail?.date ?? ''}</span></Field>
          <Field label={t('field.body')}>
            {mailBody.kind === 'loading'
              ? <span className={styles.cellMuted}>{t('state.loading')}</span>
              : mailBody.kind === 'error'
                ? <span className={styles.cellMuted}>{mailBody.message}</span>
                : mailBody.value.html !== null
                  ? <iframe className={styles.emailHtml} sandbox="" srcDoc={mailBody.value.html} title={t('field.body')} />
                  : <textarea className={styles.emailBody} readOnly value={mailBody.value.text.length === 0 ? t('email.noBody') : mailBody.value.text} />}
          </Field>
          {mailBody.kind === 'ready' && mailBody.value.attachments.length > 0
            ? (
              <Field label={t('field.attachments')}>
                <div className={styles.steps}>
                  {mailBody.value.attachments.map((attachment, index) => (
                    <button className={styles.rowAction} type="button" key={`${attachment.name}-${String(index)}`}
                      onClick={() => { downloadAttachment(selected ?? '', index, attachment.name) }}>
                      {`${attachment.name} · ${String(attachment.size)}`}{' B'}
                    </button>
                  ))}
                </div>
              </Field>
            )
            : null}
        </Modal>
        <Modal open={spaceOpen} onClose={() => { setSpaceOpen(false) }} title={t('email.toSpace')} closeLabel={t('action.close')}
          className={String(styles.emailModal)} contentClassName={String(styles.emailModalContent)}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setSpaceOpen(false) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={() => {
                setMessage(null)
                spaceFromEmail(selected ?? '', spaceName.trim(), spaceAgent.length === 0 ? null : spaceAgent, chosenMail?.from ?? null)
                setSpaceOpen(false)
                setSelected(null)
              }}>{t('action.create')}</button>
            </>
          )}>
          <Field label={t('email.spaceName')}><input type="text" autoComplete="off" value={spaceName} onChange={(event) => { setSpaceName(event.target.value) }} /></Field>
          <Field label={t('col.agent')}>
            <select value={spaceAgent} onChange={(event) => { setSpaceAgent(event.target.value) }}>
              <option value="">{t('spaces.noAgent')}</option>
              {agentOptions.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </Field>
        </Modal>
        <Modal open={routineOpen} onClose={() => { setRoutineOpen(false) }} title={t('routine.title')} closeLabel={t('action.close')}
          className={String(styles.emailModal)} contentClassName={String(styles.emailModalContent)}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setRoutineOpen(false) }}>{t('action.close')}</button>
              <button className={styles.secondary} type="button" disabled={routineBusy} onClick={sendRoutine}>{t('routine.send')}</button>
              <button className={styles.primary} type="button" disabled={routineBusy} onClick={createRoutine}>{t('routine.create')}</button>
            </>
          )}>
          <div className={styles.emailBody}>
            {routineMessages.map((entry, index) => <p key={index}>{entry.content}</p>)}
            {routineBusy ? <p>{t('routine.thinking')}</p> : null}
          </div>
          {routineCreated === null ? null : (
            <button className={styles.secondary} type="button" onClick={() => { setRoutineOpen(false); openRoutines() }}>{t('routine.open')}</button>
          )}
          <Field label={t('routine.describe')}>
            <textarea rows={3} value={routineInput} onChange={(event) => { setRoutineInput(event.target.value) }} />
          </Field>
        </Modal>
        <Modal open={composing} onClose={() => { setComposing(false) }} title={draftId === null ? t('email.newDraft') : t('email.draft')}
          closeLabel={t('action.close')} className={String(styles.emailModal)} contentClassName={String(styles.emailModalContent)}
          footer={(
            <>
              <span className={styles.tools}>
                <button className={styles.danger} type="button" onClick={discard}>{t('action.delete')}</button>
              </span>
              <span className={styles.tools}>
                <button className={styles.ghost} type="button" onClick={() => { setComposing(false) }}>{t('action.cancel')}</button>
                <button className={styles.secondary} type="button" onClick={() => { void persist() }}>{t('action.save')}</button>
                <button className={styles.primary} type="button" onClick={send}>{t('email.send')}</button>
              </span>
            </>
          )}>
          <Field label={t('email.instruction')} hint={t('email.instructionHint')}>
            <textarea value={instruction} onChange={(event) => { setInstruction(event.target.value) }} />
            <span className={styles.tools}>
              <button className={styles.secondary} type="button" onClick={draftWithAi}>{t('email.draftWithAi')}</button>
              <button className={styles.ghost} type="button" onClick={() => { startConversation() }}>{t('email.draftInChat')}</button>
            </span>
          </Field>
          <div className={styles.grid2}>
            <Field label={t('field.to')}><input type="text" autoComplete="off" value={to} onChange={(event) => { setTo(event.target.value) }} /></Field>
            <Field label={t('field.cc')}><input type="text" autoComplete="off" value={cc} onChange={(event) => { setCc(event.target.value) }} /></Field>
          </div>
          <Field label={t('field.subject')}><input type="text" autoComplete="off" value={subject} onChange={(event) => { setSubject(event.target.value) }} /></Field>
          <Field label={t('field.attachments')}>
            <input type="file" multiple onChange={(event) => { onFiles(event.target.files) }} />
            {attachments.length === 0 ? null : <span className={styles.cellMuted}>{attachments.join(', ')}</span>}
          </Field>
          <Field label={t('field.body')}><textarea className={styles.emailBody} value={body} onChange={(event) => { setBody(event.target.value) }} /></Field>
        </Modal>
        <Block title={t('email.voice')} subtitle={t('email.voiceHint')}>
          {voice.kind === 'loading'
            ? <StateBlock kind="loading" title={t('state.loading')} />
            : voice.kind === 'error'
              ? <StateBlock kind="error" title={t('state.error')} text={voice.message} />
              : voice.value.length === 0
                ? <StateBlock kind="empty" title={t('email.voiceEmpty')} text={t('email.voiceEmptyText')} />
                : (
                  <div className={styles.steps}>
                    {voice.value.slice(0, 20).map(entry => (
                      <span className={styles.cellMuted} key={entry.id}>{entry.text.slice(0, 160)}</span>
                    ))}
                  </div>
                )}
        </Block>
        <Block title={t('email.autoSend')} subtitle={t('email.autoSendHint')}>
          {policy.kind !== 'ready'
            ? <StateBlock kind="loading" title={t('state.loading')} />
            : (
              <div className={styles.steps}>
                <label className={styles.stepFlag}>
                  <input type="checkbox" checked={autoEnabled} onChange={(event) => { setAutoEnabled(event.target.checked) }} />
                  {t('email.autoSendEnable')}
                </label>
                <input type="number" min={1} style={{ width: 90, padding: '8px 10px' }} value={autoThreshold} aria-label={t('email.autoSendThreshold')} onChange={(event) => { setAutoThreshold(event.target.value) }} />
                <span className={styles.cellMuted}>{`${t('email.cleanSends')}: ${String(policy.value.cleanSends)} / ${String(policy.value.threshold)}`}</span>
                <button className={styles.secondary} type="button" onClick={() => {
                  setMessage(null)
                  const threshold = Number(autoThreshold)
                  void saveEmailPolicy({ enabled: autoEnabled, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 1 })
                    .then((result) => { if (!result.ok) setMessage(result.error.message); else setReload(value => value + 1) })
                    .catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{t('action.save')}</button>
              </div>
            )}
        </Block>
      </Screen>
    )
  }
}

/** Skills: the role catalog plus the owner's uploads. */
function skillsScreen() {
  return function FaberloomSkills(props: ScreenProps) {
    const { t, skills, saveSkill, removeSkill, shareSkill, shares, unshareShare } = props
    const [list, setList] = useState<readonly FaberLoomSkillRow[] | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [moduleFilter, setModuleFilter] = useState('')
    const [selected, setSelected] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [shareEmails, setShareEmails] = useState('')
    const [shareAll, setShareAll] = useState(false)
    const [shareMsg, setShareMsg] = useState<string | null>(null)
    const [outShares, setOutShares] = useState<readonly FaberLoomShareRow[]>([])

    const apply = (result: Result<readonly FaberLoomSkillRow[]>): void => {
      if (result.ok) setList(result.value)
      else setMessage(result.error.message)
    }

    useEffect(() => {
      let live = true
      void skills().then((result) => { if (live) apply(result) }).catch((cause: unknown) => { if (live) setMessage(String(cause)) })
      return () => { live = false }
    }, [])

    // What the owner already shares, so the panel can list and retract it.
    useEffect(() => {
      void shares()
        .then((result) => { if (result.ok) setOutShares(result.value.outgoing) })
        .catch(() => {})
    }, [shares])

    const modules = useMemo(
      () => [...new Set((list ?? []).map(skill => skill.module).filter((value): value is string => value !== null))].sort(),
      [list],
    )
    const rows = useMemo(() => (list ?? []).map(skill => ({ ...skill, id: skill.name })).filter(skill =>
      (moduleFilter.length === 0 || skill.module === moduleFilter)
      && (query.trim().length === 0 || skill.name.toLowerCase().includes(query.trim().toLowerCase()))), [list, moduleFilter, query])

    const chosen = rows.find(row => row.name === selected) ?? null

    const onFiles = (files: FileList | null): void => {
      if (files === null || files.length === 0) return
      setUploading(true)
      setMessage(null)
      const items = [...files]
      void (async () => {
        for (const file of items) {
          const text = await file.text()
          const name = file.name.replace(/\.md$/i, '')
          const result = await saveSkill(name, text)
          if (!result.ok) { setMessage(`${file.name}: ${result.error.message}`); break }
          setList(result.value)
        }
      })().finally(() => { setUploading(false) })
    }

    const columns: readonly Column<FaberLoomSkillRow>[] = [
      { key: 'name', header: t('col.name'), cell: skill => <span className={styles.cellName}>{skill.name}</span> },
      { key: 'module', header: t('col.module'), cell: skill => <span className={styles.cellMuted}>{skill.module ?? '—'}{skill.action === null ? '' : ` · ${skill.action}`}</span> },
      { key: 'origin', header: t('col.origin'), cell: skill => <Chip tone={skill.origin === 'owner' ? 'accent' : 'muted'}>{skill.origin === 'owner' ? t('skills.own') : skill.origin === 'shared' ? t('skills.shared') : skill.origin === 'incoming' ? t('skills.incoming') : t('skills.role')}</Chip> },
      { key: 'used', header: t('col.usedBy'), cell: skill => <span className={styles.cellMuted}>{skill.assignedTo.length === 0 ? t('skills.unused') : String(skill.assignedTo.length)}</span> },
    ]

    return (
      <Screen title={t('panel.skills.title')} subtitle={t('panel.skills.intro')}
        trailing={(
          <>
            <SearchBox value={query} onChange={setQuery} placeholder={t('action.search')} label={t('action.search')} />
            <select className={styles.paneSearch} style={{ width: 170, padding: '8px 10px' }} value={moduleFilter} onChange={(event) => { setModuleFilter(event.target.value) }}>
              <option value="">{t('skills.allModules')}</option>
              {modules.map(module => <option key={module} value={module}>{module}</option>)}
            </select>
            <label className={styles.secondary}>
              {uploading ? t('skills.uploading') : t('skills.upload')}
              <input type="file" accept=".md,text/markdown" multiple style={{ display: 'none' }} onChange={(event) => { onFiles(event.target.files) }} />
            </label>
          </>
        )}>
        <Feedback t={t} message={message} />
        <div className={styles.split}>
          {list === null
            ? <StateBlock kind="loading" title={t('state.loading')} />
            : <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={setSelected}
              emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />}
          <Inspector title={chosen?.name ?? t('skills.detail')}
            footer={chosen === null || chosen.origin !== 'owner' ? undefined : (
              <button className={styles.danger} type="button" onClick={() => {
                void removeSkill(chosen.name).then((result) => { apply(result); setSelected(null) })
              }}>{t('action.delete')}</button>
            )}>
            {chosen === null
              ? <StateBlock kind="empty" title={t('skills.selectTitle')} text={t('skills.selectText')} />
              : (
                <>
                  <Field label={t('field.module')}><span className={styles.cellMuted}>{chosen.module ?? '—'}{chosen.action === null ? '' : ` · ${chosen.action}`}</span></Field>
                  <Field label={t('field.description')}><span className={styles.cellMuted}>{chosen.description.length === 0 ? '—' : chosen.description}</span></Field>
                  <Field label={t('field.usedBy')}>
                    {chosen.assignedTo.length === 0
                      ? <span className={styles.cellMuted}>{t('skills.unused')}</span>
                      : <span className={styles.chips}>{chosen.assignedTo.map(id => <Chip key={id}>{id.slice(0, 8)}</Chip>)}</span>}
                  </Field>
                  <Field label={t('field.origin')}><Chip tone={chosen.origin === 'owner' ? 'accent' : 'muted'}>{chosen.origin === 'owner' ? t('skills.own') : chosen.origin === 'shared' ? t('skills.shared') : chosen.origin === 'incoming' ? t('skills.incoming') : t('skills.role')}</Chip></Field>
                  {chosen.sharedBy === undefined ? null : <Field label={t('skills.sharedBy')}><span className={styles.cellMuted}>{chosen.sharedBy}</span></Field>}
                  {chosen.origin !== 'owner' ? null : (
                    <Field label={t('skills.share')} hint={t('skills.shareHint')}>
                      <input type="text" value={shareEmails} placeholder={t('agents.sharePlaceholder')} onChange={(event) => { setShareEmails(event.target.value) }} />
                      <label className={styles.stepFlag}>
                        <input type="checkbox" checked={shareAll} onChange={(event) => { setShareAll(event.target.checked) }} />
                        <span>{t('agents.shareAll')}</span>
                      </label>
                      <div className={styles.grid2}>
                        <button className={styles.ghost} type="button" onClick={() => {
                          const emails = shareEmails.split(',').map(value => value.trim()).filter(value => value.length > 0)
                          if (!shareAll && emails.length === 0) { setShareMsg(t('agents.shareNeedTarget')); return }
                          void shareSkill(chosen.name, emails, shareAll)
                            .then((result) => {
                              if (!result.ok) setShareMsg(result.error.message)
                              else { setShareMsg(t('agents.shareDone')); setShareEmails(''); setShareAll(false); setOutShares(result.value.outgoing) }
                            })
                            .catch((cause: unknown) => { setShareMsg(String(cause)) })
                        }}>{t('skills.share')}</button>
                        {shareMsg === null ? null : <span className={styles.cellMuted}>{shareMsg}</span>}
                      </div>
                      {outShares.filter(share => share.kind === 'skill' && share.name === chosen.name).map(share => (
                        <div key={share.id} className={styles.grid2}>
                          <span className={styles.cellMuted}>{share.share_all ? t('agents.shareAllShort') : share.shared_emails.join(', ')}</span>
                          <button className={styles.ghost} type="button" onClick={() => {
                            void unshareShare(share.id)
                              .then((result) => { if (result.ok) setOutShares(result.value.outgoing) })
                              .catch(() => {})
                          }}>{t('agents.unshare')}</button>
                        </div>
                      ))}
                    </Field>
                  )}
                </>
              )}
          </Inspector>
        </div>
      </Screen>
    )
  }
}

/** Mesa de trabajo: board tasks, email drafts, unread mail, and the MWT scan. */
type WorkbenchSource = 'board' | 'draft' | 'inbox' | 'mwt'

/** Locale key for each work-bench source's chip label. */
const WORKBENCH_SOURCE_KEY: Record<WorkbenchSource, FaberloomKey> = {
  board: 'workbench.source.board',
  draft: 'workbench.source.draft',
  inbox: 'workbench.source.inbox',
  mwt: 'workbench.source.mwt',
}

/** One unified work-bench row, whatever its source. */
interface WorkbenchRow {
  readonly id: string
  readonly source: WorkbenchSource
  readonly title: string
  readonly status: string
}

function boardScreen() {
  return function FaberloomBoard(props: ScreenProps) {
    const {
      t, createBoardItem, reviewBoardItem, reopenBoardItem, submitBoardRevision, boardException,
      deleteBoardItem, setBoardRoutine, boardDetail, emailDrafts, sendEmailDraft, deleteEmailDraft,
      emailInbox, emailMarkSeen, emailTrash, openTaskChat,
    } = props
    const { overview, error } = useOverview(props)
    const [title, setTitle] = useState('')
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [drafting, setDrafting] = useState(false)
    const [tick, setTick] = useState(0)
    const [summary, setSummary] = useState('')
    const [evidence, setEvidence] = useState('')
    const [note, setNote] = useState('')
    const [drafts, setDrafts] = useState<readonly FaberLoomEmailDraftRow[]>([])
    const [inbox, setInbox] = useState<readonly FaberLoomInboxRow[]>([])
    const [assignedAgent, setAssignedAgent] = useState('')

    // The email sources reload on every board write (tick) so a send, discard,
    // trash, or read repaints the whole queue without a manual refresh.
    useEffect(() => {
      let live = true
      void emailDrafts().then((result) => { if (live && result.ok) setDrafts(result.value) }).catch(() => {})
      return () => { live = false }
    }, [tick])
    useEffect(() => {
      let live = true
      void emailInbox().then((result) => { if (live && result.ok) setInbox(result.value) }).catch(() => {})
      return () => { live = false }
    }, [tick])

    const boardItems = overview?.board ?? []
    const [pickedSource, ...pickedRest] = selected === null ? [null, ''] : selected.split(':')
    const pickedId = pickedRest.join(':')
    const boardId = pickedSource === 'board' ? pickedId : null
    const chosenBoard = boardId === null ? null : boardItems.find(row => row.id === boardId) ?? null
    const chosenDraft = pickedSource === 'draft' ? drafts.find(entry => entry.id === pickedId) ?? null : null
    const chosenInbox = pickedSource === 'inbox' ? inbox.find(entry => entry.id === pickedId) ?? null : null
    const detail = useLazy<FaberLoomBoardDetail | undefined>(
      () => boardId === null ? Promise.resolve({ ok: true, value: undefined }) : boardDetail(boardId),
      [boardId, tick],
    )

    /** Report one write's failure or refresh the queue on success. */
    const apply = (result: Result<unknown>): void => {
      if (result.ok) setTick(tick + 1)
      else setMessage(result.error.message)
    }

    const rows: readonly WorkbenchRow[] = [
      ...boardItems.filter(item => item.status !== 'completed' && item.status !== 'failed').map(item => ({ id: `board:${item.id}`, source: 'board' as const, title: item.title, status: item.status })),
      ...drafts.filter(entry => entry.status === 'draft').map(entry => ({
        id: `draft:${entry.id}`, source: 'draft' as const,
        title: entry.subject.length === 0 ? t('workbench.untitled') : entry.subject, status: entry.status,
      })),
      ...inbox.map(entry => ({
        id: `inbox:${entry.id}`, source: 'inbox' as const,
        title: entry.subject ?? t('workbench.untitled'), status: t('workbench.source.inbox'),
      })),
    ]

    const columns: readonly Column<WorkbenchRow>[] = [
      { key: 'title', header: t('col.title'), cell: row => <span className={styles.cellName}>{row.title}</span> },
      { key: 'source', header: t('col.source'), cell: row => <Chip>{t(WORKBENCH_SOURCE_KEY[row.source])}</Chip> },
      { key: 'status', header: t('col.status'), cell: row => <Chip>{row.status}</Chip> },
    ]

    const value = detail.kind === 'ready' ? detail.value : undefined
    const reviewable = value !== undefined && value.status !== 'completed' && value.status !== 'failed'

    /** Open the inspector in create mode with an editable title. */
    const openDraft = (): void => {
      setDrafting(true)
      setSelected(null)
      setTitle('')
      setMessage(null)
    }

    const create = (): void => {
      setMessage(null)
      createBoardItem(title.trim().length === 0 ? t('board.untitled') : title.trim())
      setDrafting(false)
    }

    /** Approve the current revision and close the task, so it leaves the queue. */
    const resolve = (): void => {
      if (chosenBoard === null) return
      setMessage(null)
      void reviewBoardItem(chosenBoard.id, true, note).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        return boardException(chosenBoard.id, 'complete').then((done) => {
          if (done.ok) setSelected(null)
          apply(done)
        })
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const inspectorTitle = (): string => {
      if (drafting) return t('board.newTitle')
      if (chosenBoard !== null) return chosenBoard.title
      if (chosenDraft !== null) return t('workbench.draftDetail')
      if (chosenInbox !== null) return t('workbench.inboxDetail')
      return t('board.detail')
    }

    /** The assigned agent's name, or an empty string for the live agent alone. */
    const agentName = (): string => (overview?.agents ?? []).find(agent => agent.id === assignedAgent)?.name ?? ''

    const boardFooter = chosenBoard === null ? null : (
      <span className={styles.tools}>
        {reviewable
          ? (
            <>
              <button className={styles.primary} type="button" onClick={() => { void reviewBoardItem(chosenBoard.id, true, note).then(apply) }}>{t('action.approve')}</button>
              <button className={styles.secondary} type="button" onClick={() => { void reviewBoardItem(chosenBoard.id, false, note).then(apply) }}>{t('action.reject')}</button>
              <button className={styles.ghost} type="button" onClick={() => { void reopenBoardItem(chosenBoard.id).then(() => { setTick(tick + 1) }) }}>{t('action.reopen')}</button>
              <button className={styles.ghost} type="button" onClick={() => { void boardException(chosenBoard.id, 'request_data').then(apply) }}>{t('board.requestData')}</button>
              <button className={styles.danger} type="button" onClick={() => { void boardException(chosenBoard.id, 'fail').then(apply) }}>{t('board.fail')}</button>
            </>
          )
          : null}
        {reviewable
          ? <button className={styles.primary} type="button" onClick={resolve}>{t('workbench.resolve')}</button>
          : null}
        <button className={styles.secondary} type="button"
          onClick={() => { openTaskChat('board', chosenBoard.title, `${chosenBoard.status} · ${chosenBoard.routineId ?? t('workbench.noRoutine')}`, agentName()) }}>
          {t('workbench.chat')}
        </button>
        <button className={styles.danger} type="button" onClick={() => { void deleteBoardItem(chosenBoard.id).then(apply) }}>{t('action.delete')}</button>
      </span>
    )

    const draftFooter = chosenDraft === null ? null : (
      <span className={styles.tools}>
        <button className={styles.primary} type="button" onClick={() => { void sendEmailDraft(chosenDraft.id).then(apply) }}>{t('email.send')}</button>
        <button className={styles.ghost} type="button"
          onClick={() => { openTaskChat('draft', chosenDraft.subject, `Para: ${chosenDraft.to.join(', ')}`, agentName()) }}>{t('workbench.chat')}</button>
        <button className={styles.danger} type="button" onClick={() => { void deleteEmailDraft(chosenDraft.id).then(apply) }}>{t('action.delete')}</button>
      </span>
    )

    const inboxFooter = chosenInbox === null ? null : (
      <span className={styles.tools}>
        <button className={styles.primary} type="button"
          onClick={() => { openTaskChat('inbox', chosenInbox.subject ?? t('workbench.untitled'), `De: ${chosenInbox.from ?? ''} · ${chosenInbox.date ?? ''}`, agentName()) }}>{t('email.reply')}</button>
        <button className={styles.secondary} type="button"
          onClick={() => { openTaskChat('inbox', chosenInbox.subject ?? t('workbench.untitled'), `De: ${chosenInbox.from ?? ''} · ${chosenInbox.date ?? ''}`, agentName()) }}>{t('workbench.chat')}</button>
        <button className={styles.ghost} type="button" onClick={() => { void emailMarkSeen(chosenInbox.id).then(apply) }}>{t('email.markRead')}</button>
        <button className={styles.danger} type="button"
          onClick={() => { void emailTrash(chosenInbox.id, chosenInbox.from ?? undefined, chosenInbox.subject ?? undefined).then(apply) }}>{t('email.trash')}</button>
      </span>
    )

    const footer = drafting
      ? (
        <span className={styles.tools}>
          <button className={styles.ghost} type="button" onClick={() => { setDrafting(false) }}>{t('action.cancel')}</button>
          <button className={styles.primary} type="button" onClick={create}>{t('action.create')}</button>
        </span>
      )
      : chosenBoard !== null
        ? boardFooter
        : chosenDraft !== null
          ? draftFooter
          : chosenInbox !== null
            ? inboxFooter
            : null

    const boardBody = value === undefined
      ? <StateBlock kind="empty" title={t('state.empty.title')} text={t('state.empty.text')} />
      : (
        <>
          <Field label={t('field.revision')}>
            <span className={styles.cellMuted}>{String(value.version)}{value.approvedRevision === null ? '' : ` · ${t('board.approved')} ${String(value.approvedRevision)}`}</span>
          </Field>
          <Field label={t('field.summary')}><span className={styles.summary}>{value.summary.length === 0 ? '—' : value.summary}</span></Field>
          <Field label={t('field.evidence')}>
            {value.evidence.length === 0
              ? <span className={styles.cellMuted}>{t('board.noEvidence')}</span>
              : <span className={styles.evidenceGrid}>{value.evidence.map((entry, index) => <Chip key={`${entry}-${String(index)}`}>{entry}</Chip>)}</span>}
          </Field>
          <Field label={t('workbench.routine')}>
            <select value={value.routineId ?? ''} onChange={(event) => {
              if (chosenBoard === null) return
              const next = event.target.value
              void setBoardRoutine(chosenBoard.id, next.length === 0 ? null : next).then(apply)
            }}>
              <option value="">{t('workbench.noRoutine')}</option>
              {(overview?.routines ?? []).map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
            </select>
          </Field>
          <Field label={t('field.stale')}>
            <StatusDot on={!value.stale} label={value.stale ? (value.staleReason ?? t('board.stale')) : t('board.fresh')} />
          </Field>
          <Field label={t('field.effects')}>
            {value.effects.length === 0
              ? <span className={styles.cellMuted}>{t('board.noEffects')}</span>
              : (
                <div className={styles.steps}>
                  {value.effects.map(effect => (
                    <span className={styles.cellMuted} key={`${effect.ref}-${effect.at}`}>{`${effect.ref}${effect.detail === null ? '' : ` · ${effect.detail}`} · ${effect.at}`}</span>
                  ))}
                </div>
              )}
          </Field>
          {value.status === 'approved'
            ? (
              <Field label={t('board.completeHint')}>
                <button className={styles.primary} type="button" onClick={() => { if (chosenBoard !== null) void boardException(chosenBoard.id, 'complete').then(apply) }}>{t('board.complete')}</button>
              </Field>
            )
            : null}
          {reviewable
            ? (
              <>
                <Field label={t('board.submitRevision')} hint={t('board.revisionHint')}>
                  <textarea value={summary} placeholder={t('board.summaryPlaceholder')} onChange={(event) => { setSummary(event.target.value) }} />
                  <input type="text" value={evidence} placeholder={t('board.evidencePlaceholder')} onChange={(event) => { setEvidence(event.target.value) }} />
                  <span className={styles.tools}>
                    <button className={styles.secondary} type="button"
                      disabled={summary.trim().length === 0 || evidence.trim().length === 0}
                      onClick={() => {
                        if (chosenBoard === null) return
                        setMessage(null)
                        void submitBoardRevision(chosenBoard.id, {
                          summary: summary.trim(),
                          evidence: evidence.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0),
                        }).then((result) => {
                          apply(result)
                          if (result.ok) { setSummary(''); setEvidence('') }
                        })
                      }}>{t('board.submitRevision')}</button>
                  </span>
                </Field>
                <Field label={t('board.reviewNote')}>
                  <input type="text" value={note} placeholder={t('board.notePlaceholder')} onChange={(event) => { setNote(event.target.value) }} />
                </Field>
              </>
            )
            : null}
        </>
      )

    const draftBody = chosenDraft === null ? null : (
      <>
        <Field label={t('field.to')}><span className={styles.cellMuted}>{chosenDraft.to.join(', ')}</span></Field>
        <Field label={t('col.subject')}><span className={styles.cellMuted}>{chosenDraft.subject}</span></Field>
        <Field label={t('field.body')}><span className={styles.cellMuted}>{chosenDraft.text.slice(0, 400)}</span></Field>
      </>
    )

    const inboxBody = chosenInbox === null ? null : (
      <>
        <Field label={t('col.from')}><span className={styles.cellMuted}>{chosenInbox.from ?? '—'}</span></Field>
        <Field label={t('col.subject')}><span className={styles.cellMuted}>{chosenInbox.subject ?? t('workbench.untitled')}</span></Field>
        <Field label={t('col.date')}><span className={styles.cellMuted}>{chosenInbox.date ?? '—'}</span></Field>
      </>
    )

    return (
      <Screen title={t('panel.board.title')} subtitle={t('panel.board.intro')}
        trailing={(
          <>
            <button className={styles.primary} type="button" onClick={openDraft}>{t('board.newTitle')}</button>
          </>
        )}>
        <Feedback t={t} message={error ?? message} />
        <div className={styles.split}>
          <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={(id) => { setDrafting(false); setSelected(id); setNote('') }}
            emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />
          <Inspector title={inspectorTitle()}
            status={drafting || value === undefined ? undefined : <Chip>{value.status}</Chip>}
            footer={footer}>
            {drafting
              ? <Field label={t('col.title')}><input type="text" autoComplete="off" value={title} onChange={(event) => { setTitle(event.target.value) }} /></Field>
              : selected === null
                ? <StateBlock kind="empty" title={t('board.selectTitle')} text={t('board.selectText')} />
                : (
                  <>
                    <Field label={t('workbench.agent')} hint={t('workbench.agentHint')}>
                      <select value={assignedAgent} aria-label={t('workbench.agent')} onChange={(event) => { setAssignedAgent(event.target.value) }}>
                        <option value="">{t('workbench.liveAgent')}</option>
                        {(overview?.agents ?? [])
                          .filter(agent => agent.active)
                          .map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                      </select>
                    </Field>
                    {chosenDraft !== null
                      ? draftBody
                      : chosenInbox !== null
                        ? inboxBody
                        : detail.kind === 'loading'
                          ? <StateBlock kind="loading" title={t('state.loading')} />
                          : detail.kind === 'error'
                            ? <StateBlock kind="error" title={t('state.error')} text={detail.message} />
                            : boardBody}
                  </>
                )}
          </Inspector>
        </div>
      </Screen>
    )
  }
}

/** Rutinas: routines with the full definition editor. */
function routinesScreen() {
  return function FaberloomRoutines(props: ScreenProps) {
    const {
      t, createRoutine, setRoutineActive, routineDetail, saveRoutine, removeRoutine, executions,
      startRoutine, tickRoutine, reconcileExecution, cancelExecutionEffect,
    } = props
    const { overview, error } = useOverview(props)
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [drafting, setDrafting] = useState(false)
    const [name, setName] = useState('')
    const [intent, setIntent] = useState('')
    const [triggerKind, setTriggerKind] = useState('manual')
    const [triggerMatch, setTriggerMatch] = useState('')
    const [steps, setSteps] = useState<readonly FaberLoomRoutineStepRow[]>([])
    const [expectedResult, setExpectedResult] = useState('')
    const [permissions, setPermissions] = useState('')
    const [failurePolicy, setFailurePolicy] = useState('review')
    const rows = overview?.routines ?? []
    const chosen = rows.find(row => row.id === selected) ?? null
    const detail = useLazy<FaberLoomRoutineDetail | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : routineDetail(selected),
      [selected],
    )
    const [runs, setRuns] = useState<readonly FaberLoomExecutionRow[]>([])
    const [runStep, setRunStep] = useState<Record<string, string>>({})
    const loadedRuns = useLazy<readonly FaberLoomExecutionRow[]>(
      () => selected === null ? Promise.resolve({ ok: true, value: [] }) : executions(selected),
      [selected],
    )

    useEffect(() => {
      if (loadedRuns.kind === 'ready') setRuns(loadedRuns.value)
    }, [loadedRuns])

    const applyRun = (call: Promise<Result<readonly FaberLoomExecutionRow[]>>): void => {
      setMessage(null)
      void call
        .then((result) => { if (result.ok) setRuns(result.value); else setMessage(result.error.message) })
        .catch((cause: unknown) => { setMessage(String(cause)) })
    }

    useEffect(() => {
      if (detail.kind !== 'ready' || detail.value === undefined) return
      setName(detail.value.name)
      setIntent(detail.value.intent)
      setTriggerKind(detail.value.triggerKind)
      setTriggerMatch(detail.value.triggerMatch ?? '')
      setSteps(detail.value.steps)
      setExpectedResult(detail.value.expectedResult)
      setPermissions(detail.value.permissions.join(', '))
      setFailurePolicy(detail.value.failurePolicy)
      setMessage(null)
    }, [detail])

    const columns: readonly Column<FaberLoomOverview['routines'][number]>[] = [
      { key: 'name', header: t('col.name'), cell: routine => <span className={styles.cellName}>{routine.name}</span> },
      { key: 'status', header: t('col.status'), cell: routine => <Chip>{routine.status}</Chip> },
    ]

    const editStep = (index: number, patch: Partial<FaberLoomRoutineStepRow>): void => {
      setSteps(steps.map((step, at) => at === index ? { ...step, ...patch } : step))
    }

    /** Open the inspector in create mode with empty fields. */
    const openDraft = (): void => {
      setDrafting(true)
      setSelected(null)
      setName('')
      setIntent('')
      setTriggerKind('manual')
      setTriggerMatch('')
      setSteps([])
      setExpectedResult('')
      setPermissions('')
      setFailurePolicy('review')
      setMessage(null)
    }

    const save = (): void => {
      setMessage(null)
      if (drafting) {
        createRoutine(name.trim().length === 0 ? t('routines.untitled') : name.trim())
        setDrafting(false)
        return
      }
      if (selected === null) return
      setSaving(true)
      void saveRoutine(selected, {
        name, intent,
        triggerKind,
        triggerMatch: triggerMatch.trim().length === 0 ? null : triggerMatch,
        steps,
        expectedResult,
        permissions: permissions.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0),
        failurePolicy,
      })
        .then((result) => { if (!result.ok) setMessage(result.error.message) })
        .catch((cause: unknown) => { setMessage(String(cause)) })
        .finally(() => { setSaving(false) })
    }

    return (
      <Screen title={t('panel.routines.title')} subtitle={t('panel.routines.intro')}
        trailing={(
          <>
            <button className={styles.primary} type="button" onClick={openDraft}>{t('routines.newTitle')}</button>
          </>
        )}>
        <Feedback t={t} message={error ?? message} />
        <div className={styles.split}>
          <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={(id) => { setDrafting(false); setSelected(id) }}
            emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />
          <Inspector title={drafting ? t('routines.newTitle') : detail.kind === 'ready' && detail.value !== undefined ? detail.value.name : t('routines.detail')}
            status={drafting || chosen === null ? undefined : <Chip>{chosen.status}</Chip>}
            footer={selected === null && !drafting ? undefined : (
              <>
                <span className={styles.tools}>
                  {drafting ? null : (
                    <>
                      <button className={styles.danger} type="button" onClick={() => {
                        if (selected === null) return
                        setMessage(null)
                        void removeRoutine(selected)
                          .then((result) => { if (!result.ok) setMessage(result.error.message); else setSelected(null) })
                          .catch((cause: unknown) => { setMessage(String(cause)) })
                      }}>{t('action.delete')}</button>
                      <button className={styles.primary} type="button" onClick={() => { if (selected !== null) setRoutineActive(selected, true) }}>{t('action.activate')}</button>
                      <button className={styles.secondary} type="button" onClick={() => { if (selected !== null) setRoutineActive(selected, false) }}>{t('action.pause')}</button>
                      <button className={styles.primary} type="button" onClick={() => { if (selected !== null) applyRun(startRoutine(selected)) }}>{t('routines.start')}</button>
                      <button className={styles.secondary} type="button" onClick={() => { if (selected !== null) applyRun(tickRoutine(selected)) }}>{t('routines.tick')}</button>
                    </>
                  )}
                </span>
                <span className={styles.tools}>
                  <button className={styles.ghost} type="button" onClick={() => { if (drafting) setDrafting(false); else setSelected(null) }}>{t('action.cancel')}</button>
                  <button className={styles.primary} type="button" disabled={saving} onClick={save}>{drafting ? t('action.create') : t('action.save')}</button>
                </span>
              </>
            )}>
            {selected === null && !drafting
              ? <StateBlock kind="empty" title={t('routines.selectTitle')} text={t('routines.selectText')} />
              : !drafting && detail.kind === 'loading'
                ? <StateBlock kind="loading" title={t('state.loading')} />
                : !drafting && detail.kind === 'error'
                  ? <StateBlock kind="error" title={t('state.error')} text={detail.message} />
                  : !drafting && detail.kind === 'ready' && detail.value === undefined
                    ? <StateBlock kind="empty" title={t('state.empty.title')} text={t('state.empty.text')} />
                    : (
                      <>
                        <Field label={t('field.name')}><input type="text" value={name} onChange={(event) => { setName(event.target.value) }} /></Field>
                        <Field label={t('field.intent')} hint={t('routines.intentHint')}><textarea value={intent} onChange={(event) => { setIntent(event.target.value) }} /></Field>
                        <Field label={t('field.trigger')}>
                          <div className={styles.grid2}>
                            <select value={triggerKind} onChange={(event) => { setTriggerKind(event.target.value) }}>
                              <option value="manual">{t('routines.triggerManual')}</option>
                              <option value="email">{t('routines.triggerEmail')}</option>
                              <option value="event">{t('routines.triggerEvent')}</option>
                              <option value="date">{t('routines.triggerDate')}</option>
                              <option value="recurrence">{t('routines.triggerRecurrence')}</option>
                            </select>
                            <input type="text" value={triggerMatch} placeholder={t('routines.triggerMatchPlaceholder')} onChange={(event) => { setTriggerMatch(event.target.value) }} />
                          </div>
                        </Field>
                        <Field label={t('field.steps')}>
                          <div className={styles.steps}>
                            {steps.map((step, index) => (
                              <div className={styles.stepRow} key={`${step.id}-${String(index)}`}>
                                <span className={styles.stepIndex}>{index + 1}</span>
                                <input type="text" value={step.instruction} aria-label={t('field.instruction')} onChange={(event) => { editStep(index, { instruction: event.target.value }) }} />
                                <input type="text" value={step.handler} aria-label={t('field.handler')} onChange={(event) => { editStep(index, { handler: event.target.value }) }} />
                                <input type="text" value={step.waitFor ?? ''} aria-label={t('field.waitFor')} placeholder={t('routines.waitPlaceholder')} onChange={(event) => { editStep(index, { waitFor: event.target.value.length === 0 ? null : event.target.value }) }} />
                                <label className={styles.stepFlag}>
                                  <input type="checkbox" checked={step.effect} onChange={(event) => { editStep(index, { effect: event.target.checked }) }} />
                                  {t('field.effect')}
                                </label>
                                <button className={styles.rowAction} type="button" aria-label={t('action.remove')} onClick={() => { setSteps(steps.filter((_, at) => at !== index)) }}>−</button>
                              </div>
                            ))}
                            <button className={styles.secondary} type="button" onClick={() => {
                              const id = `step-${String(Date.now()).slice(-6)}`
                              setSteps([...steps, { id, instruction: '', handler: 'agent', dependsOn: [], waitFor: null, effect: false }])
                            }}>{t('routines.addStep')}</button>
                          </div>
                        </Field>
                        <Field label={t('field.expectedResult')}><textarea value={expectedResult} onChange={(event) => { setExpectedResult(event.target.value) }} /></Field>
                        <Field label={t('field.permissions')} hint={t('routines.permissionsHint')}>
                          <input type="text" value={permissions} onChange={(event) => { setPermissions(event.target.value) }} />
                        </Field>
                        <Field label={t('field.failurePolicy')}>
                          <select value={failurePolicy} onChange={(event) => { setFailurePolicy(event.target.value) }}>
                            <option value="review">{t('routines.failReview')}</option>
                            <option value="stop">{t('routines.failStop')}</option>
                            <option value="continue">{t('routines.failContinue')}</option>
                          </select>
                        </Field>
                        <Field label={t('field.executions')} hint={t('routines.executionsHint')}>
                          <div className={styles.steps}>
                            {runs.length === 0
                              ? <span className={styles.cellMuted}>{t('routines.noExecutions')}</span>
                              : runs.map((run) => {
                                const shown = run.steps.find(step => step.id === (runStep[run.id] ?? (run.steps[0]?.id ?? '')))
                                return (
                                  <div className={styles.run} key={run.id}>
                                    <div className={styles.runRow}>
                                      <Chip>{run.status}</Chip>
                                      <span className={styles.cellMuted}>{`${t('routines.versionShort')}${String(run.routineVersion)}`} · {run.doneSteps}/{run.totalSteps}</span>
                                      <span className={styles.cellMuted}>{run.waitingFor ?? run.reason ?? t('routines.ready')}</span>
                                      {run.deadlineAt === null ? null : (
                                        <span className={styles.cellMuted} title={run.deadlineAt}>{run.deadlineAt.slice(11, 16)}</span>
                                      )}
                                      <select aria-label={t('routines.effectStep')} value={runStep[run.id] ?? (run.steps[0]?.id ?? '')}
                                        onChange={(event) => { setRunStep({ ...runStep, [run.id]: event.target.value }) }}>
                                        {run.steps.map(step => (
                                          <option key={step.id} value={step.id}>{step.id} · {step.status}</option>
                                        ))}
                                      </select>
                                      <button className={styles.secondary} type="button" onClick={() => { applyRun(reconcileExecution(run.id)) }}>{t('routines.reconcile')}</button>
                                      <button className={styles.rowAction} type="button" aria-label={t('routines.cancelEffect')}
                                        onClick={() => { applyRun(cancelExecutionEffect(run.id, runStep[run.id] ?? (run.steps[0]?.id ?? ''))) }}>−</button>
                                    </div>
                                    {shown?.text === null || shown === undefined
                                      ? null
                                      : <p className={styles.runText} title={shown.text}>{shown.text}</p>}
                                  </div>
                                )
                              })}
                          </div>
                        </Field>
                      </>
                    )}
          </Inspector>
        </div>
      </Screen>
    )
  }
}

/** Memoria: the owner's rows from the agent-memory server plus the recall form. */
function memoryScreen() {
  return function FaberloomMemory(props: ScreenProps) {
    const { t, remember, spaceMemory, deleteSpaceMemory } = props
    const { overview, error } = useOverview(props)
    const [draft, setDraft] = useState('')
    const [spaceId, setSpaceId] = useState('')
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [reload, setReload] = useState(0)
    const memory = useLazy<readonly FaberLoomSpaceMemoryRow[]>(
      () => spaceMemory(spaceId.length === 0 ? undefined : spaceId),
      [spaceId, reload],
    )
    const rows = memory.kind === 'ready' ? memory.value : []
    const chosen = rows.find(row => row.id === selected) ?? null
    // A space that no longer exists is named as deleted instead of leaking its
    // id: the memory outlives the space, so its origin must read as history.
    const spaceNames = (ids: readonly string[]): string => ids.length === 0
      ? t('spaces.noSpace')
      : ids.map(id => (overview?.spaces ?? []).find(space => space.id === id)?.title ?? t('memory.deletedSpace')).join(', ')

    /** One-line preview so a row stays a row; the modal carries the full text. */
    const snippet = (text: string): string => {
      const flat = text.replace(/\s+/g, ' ').trim()
      return flat.length <= 120 ? flat : `${flat.slice(0, 120).trimEnd()}…`
    }

    /** Coarse origin of one entry, derived from its own opening words. */
    const kindOf = (text: string): string =>
      text.startsWith('Correo «') ? t('memory.type.email')
        : text.startsWith('Documento «') ? t('memory.type.document')
          : t('memory.type.note')

    const columns: readonly Column<FaberLoomSpaceMemoryRow>[] = [
      { key: 'text', header: t('col.text'), cell: row => <span className={styles.cellName}>{snippet(row.text)}</span> },
      { key: 'type', header: t('col.type'), cell: row => <Chip>{kindOf(row.text)}</Chip> },
      { key: 'space', header: t('col.space'), cell: row => <span className={styles.cellMuted}>{spaceNames(row.spaceIds)}</span> },
      { key: 'at', header: t('col.date'), cell: row => <span className={styles.cellMuted}>{row.createdAt}</span> },
    ]

    return (
      <Screen title={t('panel.memory.title')} subtitle={t('panel.memory.intro')}
        trailing={(
          <>
            <select className={styles.paneSearch} style={{ width: 220, padding: '8px 10px' }} value={spaceId} aria-label={t('col.space')}
              onChange={(event) => { setSpaceId(event.target.value); setSelected(null) }}>
              <option value="">{t('memory.allSpaces')}</option>
              {(overview?.spaces ?? []).map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
            </select>
            <input className={styles.paneSearch} style={{ width: 240, padding: '8px 10px' }} value={draft} placeholder={t('panel.memory.rememberPlaceholder')} onChange={(event) => { setDraft(event.target.value) }} />
            <button className={styles.primary} type="button" onClick={() => {
              if (draft.trim().length === 0) { setMessage(t('state.needsText')); return }
              setMessage(null)
              remember(draft.trim(), spaceId.length === 0 ? null : spaceId)
              setDraft('')
              setReload(value => value + 1)
            }}>{t('action.remember')}</button>
          </>
        )}>
        <Feedback t={t} message={error ?? message} />
        <p className={styles.hint}>{t('state.memoryPending')}</p>
        {memory.kind === 'loading'
          ? <StateBlock kind="loading" title={t('state.loading')} />
          : memory.kind === 'error'
            ? <StateBlock kind="error" title={t('state.error')} text={memory.message} />
            : <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={setSelected}
              emptyTitle={t('state.empty.title')} emptyText={t('state.empty.memory')} labels={tableLabels(t)} />}
        <Modal open={chosen !== null} onClose={() => { setSelected(null) }} title={t('memory.detailTitle')} closeLabel={t('action.close')}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setSelected(null) }}>{t('action.close')}</button>
              <button className={styles.danger} type="button" onClick={() => {
                if (chosen === null) return
                setMessage(null)
                void deleteSpaceMemory(chosen.id).then((result) => {
                  if (!result.ok) { setMessage(result.error.message); return }
                  setSelected(null)
                  setReload(value => value + 1)
                }).catch((cause: unknown) => { setMessage(String(cause)) })
              }}>{t('memory.delete')}</button>
            </>
          )}>
          <Field label={t('memory.fullText')}><span className={styles.cellMuted}>{chosen?.text ?? ''}</span></Field>
          <Field label={t('col.space')}><span className={styles.cellMuted}>{chosen === null ? '' : spaceNames(chosen.spaceIds)}</span></Field>
          <Field label={t('field.date')}><span className={styles.cellMuted}>{chosen?.createdAt ?? ''}</span></Field>
          <p className={styles.hint}>{t('memory.deleteHint')}</p>
        </Modal>
        <TeachingsBlock
          t={t}
          teachings={props.teachings}
          saveTeaching={props.saveTeaching}
          editTeaching={props.editTeaching}
          revokeTeaching={props.revokeTeaching}
          performance={props.performance}
        />
      </Screen>
    )
  }
}

/** The versioned teachings registry, beside the agent-memory rows. */
function TeachingsBlock(props: {
  readonly t: ScreenProps['t']
  readonly teachings: ScreenProps['teachings']
  readonly saveTeaching: ScreenProps['saveTeaching']
  readonly editTeaching: ScreenProps['editTeaching']
  readonly revokeTeaching: ScreenProps['revokeTeaching']
  readonly performance: ScreenProps['performance']
}) {
  const { t, teachings, saveTeaching, editTeaching, revokeTeaching, performance } = props
  const [rows, setRows] = useState<readonly FaberLoomTeachingRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [draftScope, setDraftScope] = useState('space')
  const [draftText, setDraftText] = useState('')
  const [draftTask, setDraftTask] = useState('')
  const [editText, setEditText] = useState('')
  const [editReason, setEditReason] = useState('')
  const [evidence, setEvidence] = useState<string | null>(null)
  const [fSpace, setFSpace] = useState('')
  const [fAgent, setFAgent] = useState('')
  const [fTask, setFTask] = useState('')

  const apply = (result: Result<readonly FaberLoomTeachingRow[]>): void => {
    if (result.ok) setRows(result.value)
    else setMessage(result.error.message)
  }

  // G5 · la vista Memoria filtra por espacio, agente y tarea; las enseñanzas de
  // FaberLoom son la fuente canónica y la memoria externa se muestra aparte.
  const load = (): void => {
    setMessage(null)
    void teachings(fSpace, fAgent, fTask).then(apply).catch((cause: unknown) => { setMessage(String(cause)) })
  }

  useEffect(() => {
    let live = true
    void teachings().then((result) => { if (live) apply(result) }).catch((cause: unknown) => { if (live) setMessage(String(cause)) })
    return () => { live = false }
  }, [])

  const chosen = rows.find(row => row.id === selected) ?? null

  useEffect(() => {
    if (chosen === null) { setEditText(''); setEvidence(null); return }
    setEditText(chosen.text)
    setEditReason('')
    let live = true
    void performance(undefined, chosen.task ?? undefined).then((result) => {
      if (!live || !result.ok) return
      const summary = result.value
      setEvidence(`${t('executions.approved')} ${String(summary.approved)} · ${t('executions.corrected')} ${String(summary.corrected)} · ${t('executions.correctionRate')} ${summary.correctionRate === null ? t('agents.costUnknown') : summary.correctionRate.toFixed(2)}`)
    }).catch(() => { /* evidence is optional */ })
    return () => { live = false }
  }, [selected, rows.length])

  const columns: readonly Column<FaberLoomTeachingRow>[] = [
    { key: 'text', header: t('col.text'), cell: row => <span className={styles.cellName}>{row.text}</span> },
    { key: 'scope', header: t('field.scope'), cell: row => <Chip>{row.scope}</Chip> },
    { key: 'status', header: t('col.status'), cell: row => <span className={styles.cellMuted}>{`${row.status} · ${t('routines.versionShort')}${String(row.version)}`}</span> },
  ]

  return (
    <section className={styles.steps}>
      <Toolbar title={t('teachings.title')} subtitle={t('teachings.intro')} />
      <Feedback t={t} message={message} />
      <div className={styles.grid2}>
        <input type="text" value={fSpace} placeholder={t('teachings.filterSpace')} onChange={(event) => { setFSpace(event.target.value) }} />
        <div className={styles.grid2}>
          <input type="text" value={fAgent} placeholder={t('teachings.filterAgent')} onChange={(event) => { setFAgent(event.target.value) }} />
          <input type="text" value={fTask} placeholder={t('teachings.filterTask')} onChange={(event) => { setFTask(event.target.value) }} />
        </div>
        <button className={styles.secondary} type="button" onClick={load}>{t('teachings.filter')}</button>
      </div>
      <div className={styles.grid2}>
        <input type="text" value={draftText} placeholder={t('teachings.newText')} onChange={(event) => { setDraftText(event.target.value) }} />
        <div className={styles.grid2}>
          <select value={draftScope} onChange={(event) => { setDraftScope(event.target.value) }}>
            <option value="space">{t('teachings.scopeSpace')}</option>
            <option value="agent">{t('teachings.scopeAgent')}</option>
            <option value="skill">{t('teachings.scopeSkill')}</option>
            <option value="global">{t('teachings.scopeGlobal')}</option>
          </select>
          <input type="text" value={draftTask} placeholder={t('teachings.task')} onChange={(event) => { setDraftTask(event.target.value) }} />
        </div>
        <button className={styles.primary} type="button" disabled={draftText.trim().length === 0} onClick={() => {
          setMessage(null)
          void saveTeaching({ scope: draftScope, text: draftText.trim(), source: t('teachings.sourceUser'), task: draftTask, active: true })
            .then((result) => { apply(result); if (result.ok) { setDraftText(''); setDraftTask('') } })
            .catch((cause: unknown) => { setMessage(String(cause)) })
        }}>{t('teachings.record')}</button>
      </div>
      <div className={styles.split}>
        <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={setSelected}
          emptyTitle={t('teachings.empty')} emptyText={t('teachings.emptyText')} labels={tableLabels(t)} />
        <Inspector title={chosen === null ? t('teachings.detail') : chosen.task ?? chosen.scope}
          status={chosen === null ? undefined : <Chip>{chosen.status}</Chip>}
          footer={chosen === null ? undefined : (
            <span className={styles.tools}>
              <button className={styles.primary} type="button" disabled={editText.trim().length === 0 || chosen.status === 'revoked'}
                onClick={() => {
                  setMessage(null)
                  void editTeaching(chosen.id, editText.trim(), editReason.trim().length === 0 ? t('teachings.reasonDefault') : editReason.trim())
                    .then(apply)
                    .catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{t('action.save')}</button>
              <button className={styles.danger} type="button" disabled={chosen.status === 'revoked'}
                onClick={() => {
                  setMessage(null)
                  void revokeTeaching(chosen.id).then(apply).catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{t('teachings.revoke')}</button>
            </span>
          )}>
          {chosen === null
            ? <StateBlock kind="empty" title={t('teachings.selectTitle')} text={t('teachings.selectText')} />
            : (
              <>
                <Field label={t('field.text')}><textarea value={editText} onChange={(event) => { setEditText(event.target.value) }} /></Field>
                <Field label={t('teachings.reason')} hint={t('teachings.reasonHint')}>
                  <input type="text" value={editReason} onChange={(event) => { setEditReason(event.target.value) }} />
                </Field>
                <Field label={t('field.scope')}><span className={styles.cellMuted}>{`${chosen.scope} · ${t('routines.versionShort')}${String(chosen.version)}`}</span></Field>
                <Field label={t('teachings.source')}><span className={styles.cellMuted}>{`${chosen.source} · ${chosen.author}`}</span></Field>
                <Field label={t('teachings.uses')}><span className={styles.cellMuted}>{String(chosen.uses.length)}</span></Field>
                <Field label={t('executions.evidenceFor')}><span className={styles.cellMuted}>{evidence ?? t('state.loading')}</span></Field>
              </>
            )}
        </Inspector>
      </div>
    </section>
  )
}

/** Conexiones: per-user integrations, independent of the MWT.ONE MCP. */
function connectionsScreen() {
  return function FaberloomConnections(props: ScreenProps) {
    const { t, connections, saveConnection, removeConnection, probeConnection } = props
    const [list, setList] = useState<readonly FaberLoomConnection[] | null>(null)
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [probe, setProbe] = useState<{ state: 'probing' | 'ok' | 'fail'; text: string } | null>(null)
    const [kind, setKind] = useState<'imap' | 'smtp' | 'backup'>('imap')
    const [label, setLabel] = useState('')
    const [host, setHost] = useState('')
    const [port, setPort] = useState('993')
    const [secure, setSecure] = useState(true)
    const [starttls, setStarttls] = useState(false)
    const [username, setUsername] = useState('')
    const [secret, setSecret] = useState('')
    const [destination, setDestination] = useState('')
    const [retention, setRetention] = useState('30')

    const chosen = (list ?? []).find(row => row.id === selected) ?? null

    useEffect(() => {
      let live = true
      void connections().then((result) => { if (live) { if (result.ok) setList(result.value); else setMessage(result.error.message) } })
        .catch((cause: unknown) => { if (live) setMessage(String(cause)) })
      return () => { live = false }
    }, [])

    // Load the selected connection into the form and verify it right away: a
    // real login is the only way to know the stored credentials still work, and
    // the user should not have to ask for the test.
    useEffect(() => {
      if (chosen === null) return
      setKind(chosen.kind)
      setLabel(chosen.label)
      setHost(chosen.host ?? '')
      setPort(chosen.port === null ? (chosen.kind === 'smtp' ? '465' : '993') : String(chosen.port))
      setSecure(chosen.secure !== false)
      setStarttls(chosen.starttls)
      setUsername(chosen.username ?? '')
      setSecret('')
      setDestination(chosen.destination ?? '')
      setRetention(chosen.retentionDays === null ? '30' : String(chosen.retentionDays))
      setMessage(null)
      if (chosen.kind === 'imap' || chosen.kind === 'smtp') runProbe(chosen.id)
      else setProbe(null)
    }, [chosen])

    /** Run the real connection test and keep its outcome in the panel. */
    const runProbe = (id: string): void => {
      setProbe({ state: 'probing', text: t('connections.probing') })
      void probeConnection(id).then((result) => {
        // `result.ok` is the Remote call; `result.value.ok` is the probe itself.
        if (!result.ok) { setProbe({ state: 'fail', text: `${t('connections.probeFail')}: ${result.error.message}` }); return }
        setProbe(result.value.ok
          ? { state: 'ok', text: `${t('connections.probeOk')}: ${result.value.detail}` }
          : { state: 'fail', text: `${t('connections.probeFail')}: ${result.value.detail}` })
      }).catch((cause: unknown) => { setProbe({ state: 'fail', text: String(cause) }) })
    }

    const apply = (result: Result<readonly FaberLoomConnection[]>): void => {
      if (result.ok) setList(result.value)
      else setMessage(result.error.message)
    }

    const save = (): void => {
      setMessage(null)
      const defaultLabel = kind === 'imap' ? t('connections.mailLabel') : kind === 'smtp' ? t('connections.smtpLabel') : t('connections.backupLabel')
      const effectiveLabel = label.trim().length === 0 ? defaultLabel : label.trim()
      void saveConnection({
        ...selected === null ? {} : { id: selected },
        kind,
        label: effectiveLabel,
        ...kind === 'imap' || kind === 'smtp'
          ? { host, port: Number(port), secure, starttls, username, ...secret.length === 0 ? {} : { secret } }
          : { destination, retentionDays: Number(retention) },
      })
        .then((result) => {
          apply(result)
          if (!result.ok || kind === 'backup') return
          // Select what was just saved so the automatic test runs against it.
          const saved = result.value.find(row => row.kind === kind && row.label === effectiveLabel)
          if (saved !== undefined) setSelected(saved.id)
        })
        .catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const columns: readonly Column<FaberLoomConnection>[] = [
      { key: 'label', header: t('col.name'), cell: row => <span className={styles.cellName}>{row.label}{row.kind !== 'backup' && row.primary ? <span className={styles.chips}> <Chip tone="accent">{t('connections.primary')}</Chip></span> : null}</span> },
      { key: 'kind', header: t('col.kind'), cell: row => <Chip tone={row.kind === 'backup' ? 'muted' : 'accent'}>{row.kind === 'imap' ? t('connections.imap') : row.kind === 'smtp' ? t('connections.smtp') : t('connections.backup')}</Chip> },
      { key: 'security', header: t('col.security'), cell: row => row.kind === 'backup' ? <span className={styles.cellMuted}>{t('connections.notApplicable')}</span> : <Chip tone={row.secure || row.starttls ? 'accent' : 'muted'}>{row.secure ? t('connections.modeTls') : row.starttls ? t('connections.modeStarttls') : t('connections.modeNone')}</Chip> },
      { key: 'target', header: t('col.target'), cell: row => <span className={styles.cellMuted}>{row.kind === 'imap' || row.kind === 'smtp' ? [row.username, row.host].filter(part => part !== null && part.length > 0).join(' · ') : row.destination ?? ''}</span> },
    ]

    return (
      <Screen title={t('panel.connections.title')} subtitle={t('panel.connections.intro')}
        trailing={<button className={styles.primary} type="button" onClick={() => { setSelected(null); setMessage(null) }}>{t('connections.new')}</button>}>
        <Feedback t={t} message={message} />
        <div className={styles.split}>
          {list === null
            ? <StateBlock kind="loading" title={t('state.loading')} />
            : <DataTable columns={columns} rows={list.map(row => ({ ...row }))} selectedId={selected} onSelect={setSelected}
              emptyTitle={t('connections.emptyTitle')} emptyText={t('connections.emptyText')} labels={tableLabels(t)} />}
          <Inspector title={chosen?.label ?? t('connections.newTitle')}
            footer={(
              <>
                <span className={styles.tools}>
                  {chosen === null ? null : <button className={styles.danger} type="button" onClick={() => { void removeConnection(chosen.id).then(apply); setSelected(null) }}>{t('action.delete')}</button>}
                  {chosen === null ? null : (
                    <button className={styles.secondary} type="button" onClick={() => { runProbe(chosen.id) }}>{t('connections.probe')}</button>
                  )}
                  {chosen === null || chosen.kind === 'backup' || chosen.primary ? null : (
                    <button className={styles.secondary} type="button" onClick={() => {
                      setMessage(null)
                      void saveConnection({ id: chosen.id, kind: chosen.kind, label: chosen.label, primary: true })
                        .then(apply)
                        .catch((cause: unknown) => { setMessage(String(cause)) })
                    }}>{t(chosen.kind === 'smtp' ? 'connections.makePrimarySmtp' : 'connections.makePrimary')}</button>
                  )}
                </span>
                <button className={styles.primary} type="button" onClick={save}>{t('action.save')}</button>
              </>
            )}>
            <Field label={t('field.kind')}>
              <select value={kind} onChange={(event) => {
                const next = event.target.value === 'smtp' ? 'smtp' as const : event.target.value === 'backup' ? 'backup' as const : 'imap' as const
                setKind(next)
                // Follow each protocol's usual default port on a kind switch.
                if (next === 'smtp' && (port === '993' || port === '143')) { setPort('465'); setSecure(true); setStarttls(false) }
                if (next === 'imap' && (port === '465' || port === '587' || port === '25')) { setPort('993'); setSecure(true); setStarttls(false) }
              }}>
                <option value="imap">{t('connections.imap')}</option>
                <option value="smtp">{t('connections.smtp')}</option>
                <option value="backup">{t('connections.backup')}</option>
              </select>
            </Field>
            <Field label={t('field.name')}>
              <input type="text" value={label} onChange={(event) => { setLabel(event.target.value) }} />
            </Field>
            {kind === 'imap' || kind === 'smtp'
              ? (
                <>
                  <div className={styles.grid2}>
                    <Field label={t('field.host')}><input type="text" value={host} placeholder={kind === 'smtp' ? 'smtp.dominio.com' : 'imap.dominio.com'} onChange={(event) => { setHost(event.target.value) }} /></Field>
                    <Field label={t('field.port')}><input type="text" value={port} onChange={(event) => { setPort(event.target.value) }} /></Field>
                  </div>
                  <div className={styles.grid2}>
                    <Field label={t('field.username')}><input type="text" value={username} onChange={(event) => { setUsername(event.target.value) }} /></Field>
                    <Field label={t('field.password')} hint={chosen?.hasSecret === true ? t('connections.secretKept') : undefined}>
                      <SecretInput value={secret} showLabel={t('field.showSecret')} hideLabel={t('field.hideSecret')} onChange={(event) => { setSecret(event.target.value) }} />
                    </Field>
                  </div>
                  <Field label={t('field.tls')} hint={t('connections.securityHint')}>
                    <select value={secure ? 'tls' : starttls ? 'starttls' : 'none'} onChange={(event) => {
                      const mode = event.target.value
                      setSecure(mode === 'tls')
                      setStarttls(mode === 'starttls')
                      // Follow the protocol's usual port unless a custom one is set.
                      if (kind === 'imap' && (port === '993' || port === '143')) setPort(mode === 'tls' ? '993' : '143')
                      if (kind === 'smtp' && (port === '465' || port === '587' || port === '25')) setPort(mode === 'tls' ? '465' : mode === 'starttls' ? '587' : '25')
                    }}>
                      <option value="tls">{t(kind === 'smtp' ? 'connections.smtpTls' : 'connections.tlsImplicit')}</option>
                      <option value="starttls">{t(kind === 'smtp' ? 'connections.smtpStarttls' : 'connections.tlsStarttls')}</option>
                      <option value="none">{t(kind === 'smtp' ? 'connections.smtpNone' : 'connections.tlsNone')}</option>
                    </select>
                  </Field>
                </>
              )
              : (
                <div className={styles.grid2}>
                  <Field label={t('field.destination')} hint={t('connections.destHint')}>
                    <input type="text" value={destination} placeholder={t('connections.destPlaceholder')} onChange={(event) => { setDestination(event.target.value) }} />
                  </Field>
                  <Field label={t('field.retention')}><input type="text" value={retention} onChange={(event) => { setRetention(event.target.value) }} /></Field>
                </div>
              )}
            {probe === null ? null : (
              <StateBlock
                kind={probe.state === 'ok' ? 'empty' : probe.state === 'fail' ? 'error' : 'loading'}
                title={probe.text}
              />
            )}
          </Inspector>
        </div>
        <MwtBlock t={t} mwtStatus={props.mwtStatus} />
        <McpBlock t={t} mcpTokens={props.mcpTokens} mintMcpToken={props.mintMcpToken} revokeMcpToken={props.revokeMcpToken} />
        <GrantsBlock t={t} grants={props.grants} grant={props.grant} revokeGrant={props.revokeGrant} />
        <BackupsBlock
          t={t}
          backups={props.backups}
          createBackup={props.createBackup}
          verifyBackup={props.verifyBackup}
          restoreBackup={props.restoreBackup}
          deleteBackup={props.deleteBackup}
        />
      </Screen>
    )
  }
}

/** The knowledge backups: capture, verify, preview, restore, and delete. */
function BackupsBlock(props: {
  readonly t: ScreenProps['t']
  readonly backups: ScreenProps['backups']
  readonly createBackup: ScreenProps['createBackup']
  readonly verifyBackup: ScreenProps['verifyBackup']
  readonly restoreBackup: ScreenProps['restoreBackup']
  readonly deleteBackup: ScreenProps['deleteBackup']
}) {
  const { t, backups, createBackup, verifyBackup, restoreBackup, deleteBackup } = props
  const [rows, setRows] = useState<readonly FaberLoomBackupRow[]>([])
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void backups().then((result) => { if (live && result.ok) setRows(result.value) })
    return () => { live = false }
  }, [])
  const apply = (result: Result<readonly FaberLoomBackupRow[]>): void => {
    if (result.ok) setRows(result.value)
    else setMessage(result.error.message)
  }
  return (
    <Inspector title={t('backup.title')}>
      <Field label={t('backup.intro')}>
        <span className={styles.tools}>
          <input type="text" value={note} placeholder={t('backup.notePlaceholder')} onChange={(event) => { setNote(event.target.value) }} />
          <button className={styles.primary} type="button" onClick={() => {
            void createBackup(note.trim().length === 0 ? undefined : note.trim()).then(apply)
            setNote('')
          }}>{t('backup.create')}</button>
        </span>
      </Field>
      {message === null ? null : <StateBlock kind="error" title={message} />}
      {rows.length === 0
        ? <StateBlock kind="empty" title={t('backup.emptyTitle')} text={t('backup.emptyText')} />
        : rows.map(row => (
          <Field key={row.id} label={`${row.createdAt} · ${row.domains} ${t('backup.domains')} · ${row.records} ${t('backup.records')}`}>
            <span className={styles.tools}>
              <button className={styles.secondary} type="button" onClick={() => {
                void verifyBackup(row.id).then((result) => {
                  setMessage(result.ok
                    ? (result.value.ok ? t('backup.verifyOk') : `${t('backup.verifyBad')}: ${String(result.value.badTables)}`)
                    : result.error.message)
                })
              }}>{t('backup.verify')}</button>
              <button className={styles.secondary} type="button" onClick={() => {
                void restoreBackup(row.id, true).then((result) => {
                  setMessage(result.ok ? `${t('backup.preview')}: ${String(result.value.written)}` : result.error.message)
                })
              }}>{t('backup.preview')}</button>
              <button className={styles.primary} type="button" onClick={() => {
                void restoreBackup(row.id, false).then((result) => {
                  setMessage(result.ok ? `${t('backup.restored')}: ${String(result.value.written)}` : result.error.message)
                })
              }}>{t('backup.restore')}</button>
              <button className={styles.danger} type="button" onClick={() => { void deleteBackup(row.id).then(apply) }}>{t('action.delete')}</button>
            </span>
          </Field>
        ))}
    </Inspector>
  )
}

/** The owner's MWT.ONE access: identity, active company, and the MCP servers the assistant can call. */
function MwtBlock(props: {
  readonly t: ScreenProps['t']
  readonly mwtStatus: ScreenProps['mwtStatus']
}) {
  const { t, mwtStatus } = props
  const status = useLazy<FaberLoomMwtStatus | undefined>(
    () => mwtStatus().then(result => result.ok ? { ok: true as const, value: result.value } : { ok: false as const, error: result.error }),
    [],
  )
  const value = status.kind === 'ready' ? status.value : undefined
  return (
    <Block title={t('mwt.title')} subtitle={t('mwt.intro')}>
      {status.kind === 'loading'
        ? <StateBlock kind="loading" title={t('state.loading')} />
        : status.kind === 'error'
          ? <StateBlock kind="error" title={t('state.error')} text={status.message} />
          : value === undefined
            ? <StateBlock kind="empty" title={t('mwt.noServers')} text={t('mwt.noServersText')} />
            : (
              <>
                <div className={styles.grid2}>
                  <Field label={t('mwt.identity')}><span className={styles.cellMuted}>{`${value.ownerId} · ${value.role}`}</span></Field>
                  <Field label={t('mwt.company')} hint={value.companies.length > 1 ? t('mwt.companiesHint') : undefined}>
                    {value.companies.length === 0
                      ? <span className={styles.cellMuted}>{value.companyId ?? t('mwt.companyUnset')}</span>
                      : (
                        <span className={styles.chips}>
                          {value.companies.map(company => (
                            <Chip key={company.id} tone={value.companyId !== null && company.id.toLowerCase() === value.companyId.toLowerCase() ? 'accent' : 'muted'}>
                              {company.name ?? company.id}
                            </Chip>
                          ))}
                        </span>
                      )}
                  </Field>
                </div>
                <Field label={t('mwt.servers')}>
                  {value.servers.length === 0
                    ? <StateBlock kind="empty" title={t('mwt.noServers')} text={t('mwt.noServersText')} />
                    : (
                      <div className={styles.steps}>
                        {value.servers.map(server => (
                          <details key={server.name}>
                            <summary>{`${server.name} · ${String(server.tools.length)} ${t('mwt.tools')}`}</summary>
                            <div className={styles.toolList}>
                              {server.tools.map(tool => <span className={styles.cellMuted} key={tool}>{tool}</span>)}
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                </Field>
              </>
            )}
    </Block>
  )
}

/** The MCP endpoint path the panel shows for token setup; a wire path, not product copy. */
const MCP_ENDPOINT_PATH = '/mcp'

/** The tools a token may be scoped to, in catalogue order. */
const MCP_TOOL_NAMES = [
  'faberloom_overview',
  'faberloom_spaces',
  'faberloom_space_get',
  'faberloom_space_create',
  'faberloom_space_update',
  'faberloom_space_archive',
  'faberloom_space_context',
  'faberloom_space_preview_link',
  'faberloom_agents',
  'faberloom_agent_get',
  'faberloom_agent_create',
  'faberloom_agent_update',
  'faberloom_agent_policy',
  'faberloom_agent_duplicate',
  'faberloom_agent_deactivate',
  'faberloom_models',
  'faberloom_model_register',
  'faberloom_agent_resolve_model',
  'faberloom_agent_recommend_model',
  'faberloom_agent_record_outcome',
  'faberloom_board',
  'faberloom_board_get',
  'faberloom_board_create',
  'faberloom_board_submit',
  'faberloom_board_review',
  'faberloom_board_reopen',
  'faberloom_board_effect',
  'faberloom_board_mark_stale',
  'faberloom_board_revalidate',
  'faberloom_grants',
  'faberloom_grant',
  'faberloom_grant_revoke',
  'faberloom_backup_create',
  'faberloom_backup_list',
  'faberloom_backup_verify',
  'faberloom_backup_restore',
  'faberloom_migrations_list',
  'faberloom_migrations_run',
  'faberloom_connections',
  'faberloom_connection_save',
  'faberloom_connection_remove',
  'faberloom_connection_probe',
  'faberloom_routines',
  'faberloom_executions',
  'faberloom_routine_run',
  'faberloom_teachings',
  'faberloom_teaching_record',
  'faberloom_teaching_edit',
  'faberloom_teaching_revoke',
] as const

/** The MCP client tokens: who may drive this workspace from another AI. */
function McpBlock(props: {
  readonly t: ScreenProps['t']
  readonly mcpTokens: ScreenProps['mcpTokens']
  readonly mintMcpToken: ScreenProps['mintMcpToken']
  readonly revokeMcpToken: ScreenProps['revokeMcpToken']
}) {
  const { t, mcpTokens, mintMcpToken, revokeMcpToken } = props
  const [rows, setRows] = useState<readonly FaberLoomMcpTokenRow[]>([])
  const [label, setLabel] = useState('')
  const [scopes, setScopes] = useState<readonly string[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const apply = (result: Result<readonly FaberLoomMcpTokenRow[]>): void => {
    if (result.ok) setRows(result.value)
    else setMessage(result.error.message)
  }

  useEffect(() => {
    let live = true
    void mcpTokens().then((result) => { if (live) apply(result) }).catch((cause: unknown) => { if (live) setMessage(String(cause)) })
    return () => { live = false }
  }, [])

  const tableRows = rows.map(row => ({ ...row, id: row.token }))
  const columns: readonly Column<FaberLoomMcpTokenRow & { readonly id: string }>[] = [
    { key: 'label', header: t('mcp.label'), cell: row => <span className={styles.cellName}>{row.label}</span> },
    { key: 'token', header: t('mcp.token'), cell: row => <input type="text" readOnly value={row.token} onFocus={(event) => { event.currentTarget.select() }} /> },
    { key: 'state', header: t('col.status'), cell: row => <Chip>{row.revokedAt === null ? t('grants.active') : t('grants.revoked')}</Chip> },
    { key: 'scopes', header: t('mcp.scopes'), cell: row => <span className={styles.cellMuted}>{row.scopes === null ? t('mcp.allTools') : row.scopes.join(', ')}</span> },
  ]

  return (
    <Block title={t('mcp.title')} subtitle={t('mcp.intro')}>
      <Feedback t={t} message={message} />
      <div className={styles.grid2}>
        <input type="text" value={label} placeholder={t('mcp.labelPlaceholder')} onChange={(event) => { setLabel(event.target.value) }} />
        <button className={styles.primary} type="button" onClick={() => {
          setMessage(null)
          void mintMcpToken({ label: label.trim(), scopes }).then((result) => { apply(result); if (result.ok) { setLabel(''); setScopes([]) } })
            .catch((cause: unknown) => { setMessage(String(cause)) })
        }}>{t('mcp.mint')}</button>
      </div>
      <Field label={t('mcp.scopes')} hint={t('mcp.scopesHint')}>
        <span className={styles.hint}>{scopes.length === 0 ? t('mcp.allTools') : `${String(scopes.length)} ${t('mcp.selected')}`}</span>
        <div className={styles.toolList}>
          {MCP_TOOL_NAMES.map(name => (
            <label className={styles.stepFlag} key={name}>
              <input type="checkbox" checked={scopes.includes(name)}
                onChange={(event) => {
                  setScopes(event.target.checked ? [...scopes, name] : scopes.filter(entry => entry !== name))
                }} />
              {name}
            </label>
          ))}
        </div>
      </Field>
      <div className={styles.split}>
        <DataTable columns={columns} rows={tableRows} selectedId={null} onSelect={() => {}}
          emptyTitle={t('mcp.empty')} emptyText={t('mcp.emptyText')} labels={tableLabels(t)} />
        <Inspector title={t('mcp.detail')}>
          <Field label={t('mcp.endpoint')}><span className={styles.cellMuted}>{`${typeof window === 'undefined' ? '' : window.location.origin}${MCP_ENDPOINT_PATH}`}</span></Field>
          <Field label={t('mcp.how')} hint={t('mcp.howHint')}><span className={styles.cellMuted}>{t('mcp.howText')}</span></Field>
          <div className={styles.steps}>
            {rows.filter(row => row.revokedAt === null).map(row => (
              <button className={styles.danger} type="button" key={row.token}
                onClick={() => {
                  setMessage(null)
                  void revokeMcpToken(row.token).then(apply).catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{`${t('teachings.revoke')} ${row.label}`}</button>
            ))}
          </div>
        </Inspector>
      </div>
    </Block>
  )
}

/** The autonomy grants: what an agent may do alone, revocable here. */
function GrantsBlock(props: {
  readonly t: ScreenProps['t']
  readonly grants: ScreenProps['grants']
  readonly grant: ScreenProps['grant']
  readonly revokeGrant: ScreenProps['revokeGrant']
}) {
  const { t, grants, grant, revokeGrant } = props
  const [rows, setRows] = useState<readonly FaberLoomGrantRow[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [action, setAction] = useState('')
  const [agentId, setAgentId] = useState('')
  const [context, setContext] = useState('')
  const [note, setNote] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const apply = (result: Result<readonly FaberLoomGrantRow[]>): void => {
    if (result.ok) setRows(result.value)
    else setMessage(result.error.message)
  }

  useEffect(() => {
    let live = true
    void grants().then((result) => { if (live) apply(result) }).catch((cause: unknown) => { if (live) setMessage(String(cause)) })
    return () => { live = false }
  }, [])

  const columns: readonly Column<FaberLoomGrantRow>[] = [
    { key: 'action', header: t('grants.action'), cell: row => <span className={styles.cellName}>{row.action}</span> },
    { key: 'scope', header: t('field.scope'), cell: row => <span className={styles.cellMuted}>{`${row.agentId ?? t('grants.anyAgent')} · ${row.context ?? t('grants.anyContext')}`}</span> },
    { key: 'state', header: t('col.status'), cell: row => <Chip>{row.revoked ? t('grants.revoked') : t('grants.active')}</Chip> },
  ]

  return (
    <Block title={t('grants.title')} subtitle={t('grants.intro')}>
      <Feedback t={t} message={message} />
      <div className={styles.grid2}>
        <input type="text" value={action} placeholder={t('grants.actionPlaceholder')} onChange={(event) => { setAction(event.target.value) }} />
        <input type="text" value={agentId} placeholder={t('grants.agentPlaceholder')} onChange={(event) => { setAgentId(event.target.value) }} />
        <input type="text" value={context} placeholder={t('grants.contextPlaceholder')} onChange={(event) => { setContext(event.target.value) }} />
        <input type="text" value={note} placeholder={t('grants.notePlaceholder')} onChange={(event) => { setNote(event.target.value) }} />
        <input type="text" value={expiresAt} placeholder={t('grants.expiryPlaceholder')} onChange={(event) => { setExpiresAt(event.target.value) }} />
        <button className={styles.primary} type="button" disabled={action.trim().length === 0} onClick={() => {
          setMessage(null)
          void grant({ action: action.trim(), agentId, context, note, expiresAt })
            .then((result) => { apply(result); if (result.ok) { setAction(''); setAgentId(''); setContext(''); setNote(''); setExpiresAt('') } })
            .catch((cause: unknown) => { setMessage(String(cause)) })
        }}>{t('grants.create')}</button>
      </div>
      <div className={styles.split}>
        <DataTable columns={columns} rows={rows} selectedId={null} onSelect={() => {}}
          emptyTitle={t('grants.empty')} emptyText={t('grants.emptyText')} labels={tableLabels(t)} />
        <Inspector title={t('grants.detail')}>
          <Field label={t('grants.how')} hint={t('grants.howHint')}>
            <span className={styles.cellMuted}>{t('grants.howText')}</span>
          </Field>
          <div className={styles.steps}>
            {rows.filter(row => !row.revoked).map(row => (
              <button className={styles.danger} type="button" key={row.id}
                onClick={() => {
                  setMessage(null)
                  void revokeGrant(row.id).then(apply).catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{`${t('teachings.revoke')} ${row.action}`}</button>
            ))}
          </div>
        </Inspector>
      </div>
    </Block>
  )
}

/** Landing that hands the user to the harness conversation and its composer. */
function conversarPanel() {
  return function FaberloomConversar(props: ScreenProps) {
    const {
      t, startConversation, proposeWork, createTaskFromWork, createAgentFromWork, createRoutineFromWork, linkPreview,
    } = props
    const { overview } = useOverview(props)
    const [text, setText] = useState('')
    const [agentName, setAgentName] = useState('')
    const [routineName, setRoutineName] = useState('')
    const [proposal, setProposal] = useState<FaberLoomWorkProposal | null>(null)
    const [spaceId, setSpaceId] = useState('')
    const [preview, setPreview] = useState<FaberLoomLinkPreview | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const spaces = overview?.spaces ?? []
    const fail = (cause: unknown): void => { setMessage(String(cause)) }
    return (
      <Screen title={t('panel.conversar.title')} subtitle={t('panel.conversar.intro')}>
        <button type="button" className={styles.primary} onClick={() => { startConversation() }}>
          {t('panel.conversar.start')}
        </button>
        <ul className={styles.infoRows}>
          <li className={styles.infoRow}>{t('panel.conversar.context')}</li>
          <li className={styles.infoRow}>{t('panel.conversar.model')}</li>
          <li className={styles.infoRow}>{t('panel.conversar.note')}</li>
        </ul>
        <Inspector title={t('propose.title')}>
          <Field label={t('propose.prompt')}>
            <textarea value={text} placeholder={t('propose.placeholder')} onChange={(event) => { setText(event.target.value) }} />
          </Field>
          <Field label={t('propose.space')}>
            <span className={styles.tools}>
              <select value={spaceId} onChange={(event) => { setSpaceId(event.target.value); setPreview(null) }}>
                <option value="">{t('propose.personal')}</option>
                {spaces.map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
              </select>
              {spaceId === '' ? null : (
                <button className={styles.secondary} type="button" onClick={() => {
                  void linkPreview(spaceId).then((result) => {
                    if (result.ok) setPreview(result.value)
                    else fail(result.error.message)
                  }).catch(fail)
                }}>
                  {t('propose.preview')}
                </button>
              )}
              <button className={styles.primary} type="button" onClick={() => {
                void proposeWork(text).then((result) => {
                  if (result.ok) setProposal(result.value)
                  else fail(result.error.message)
                }).catch(fail)
              }}>
                {t('propose.build')}
              </button>
            </span>
          </Field>
          {preview === null ? null : (
            <StateBlock kind="empty" title={`${t('propose.audience')}: ${String(preview.newlyVisibleTo.length)}`} text={preview.sharedContextKeys.join(', ')} />
          )}
          {message === null ? null : <StateBlock kind="error" title={message} />}
          {proposal === null ? null : (
            <>
              <Field label={t('propose.result')}><span className={styles.cellMuted}>{proposal.title}</span></Field>
              <ul className={styles.infoRows}>
                {proposal.suggestedSteps.map((step, index) => <li key={`${String(index)}-${step}`} className={styles.infoRow}>{step}</li>)}
              </ul>
              <Field label={t('propose.agentName')}>
                <input type="text" value={agentName} placeholder={proposal.suggestedAgents[0]?.name ?? ''} onChange={(event) => { setAgentName(event.target.value) }} />
              </Field>
              <Field label={t('propose.routineName')}>
                <input type="text" value={routineName} onChange={(event) => { setRoutineName(event.target.value) }} />
              </Field>
              <span className={styles.tools}>
                <button className={styles.primary} type="button" onClick={() => {
                  void createTaskFromWork(text, spaceId === '' ? null : spaceId)
                    .then((result) => { if (result.ok) setMessage(t('propose.taskCreated')); else fail(result.error.message) })
                    .catch(fail)
                }}>{t('propose.createTask')}</button>
                <button className={styles.secondary} type="button" onClick={() => {
                  const name = agentName.trim().length === 0 ? proposal.suggestedAgents[0]?.name ?? proposal.title : agentName.trim()
                  void createAgentFromWork(text, name, spaceId === '' ? null : spaceId)
                    .then((result) => { if (result.ok) setMessage(t('propose.agentCreated')); else fail(result.error.message) })
                    .catch(fail)
                }}>{t('propose.createAgent')}</button>
                <button className={styles.secondary} type="button" onClick={() => {
                  const name = routineName.trim().length === 0 ? proposal.title : routineName.trim()
                  void createRoutineFromWork(text, name)
                    .then((result) => { if (result.ok) setMessage(t('propose.routineCreated')); else fail(result.error.message) })
                    .catch(fail)
                }}>{t('propose.createRoutine')}</button>
              </span>
            </>
          )}
        </Inspector>
      </Screen>
    )
  }
}

/** Sidebar brand name beside the mark. */
export function FaberloomBrandName({ t }: PropsLocale<'faberloom'>) {
  return <span className={styles.brandName}>{t('brand.name')}</span>
}

/**
 * The product brand mark: the MWT.ONE swoosh, white on the dark theme and green
 * on the light one. It occupies `sidebar.brand.mark` and
 * `conversation.hero.brand.mark`, replacing the harness's own mark.
 * @param props.size - the pixel height the slot asks for.
 * @returns the theme-appropriate mark image.
 */
export function FaberloomBrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className={styles.brandMark} style={{ height: size }}>
      <img className={styles.brandMarkDark} src="/brand-dark.png" alt="" />
      <img className={styles.brandMarkLight} src="/brand-light.png" alt="" />
    </span>
  )
}

/** Sidebar row occupant type: a function component over the panellist owner props. */
export type FaberloomPanelIconType = (props: PropsRuntime<'sidebar.panellist'>) => ReactNode

/** Main-panel occupant type: a function component over the locale, store, and inject seats. */
export type FaberloomPanelBody = (props: ScreenProps) => ReactNode

/** One FaberLoom global section: sidebar row plus its main panel. */
export interface FaberloomSection {
  /** Sidebar list id and matching main-panel key. */
  id: MainPanelId
  /** Ascending sidebar row order. */
  order: number
  /** Sidebar row label key. */
  labelKey: FaberloomKey
  /** Sidebar row occupant. */
  Icon: FaberloomPanelIconType
  /** Main-panel occupant. */
  Page: FaberloomPanelBody
}

/** Every node kind the Work Flow inspector offers. */
const WORKFLOW_KINDS = [
  'trigger.manual', 'trigger.schedule', 'trigger.email', 'trigger.event', 'trigger.board',
  'agent', 'skill', 'mcp.call', 'imap.action', 'smtp.send', 'memory.remember', 'memory.teach',
  'board.create', 'space.reference', 'routine.invoke', 'condition', 'transform', 'wait', 'notify', 'deadletter',
] as const

/** Permission checkboxes the Compartir form offers. */
const SHARE_PERMISSION_OPTIONS = ['view', 'run', 'edit-graph', 'add-nodes', 'remove-nodes', 'edit-agents', 'manage-triggers', 'share'] as const

/** The IMAP operations the mail node offers. */
const WORKFLOW_IMAP_OPS = ['search', 'move', 'delete', 'markRead'] as const

/**
 * The colour category one node kind paints its left accent with, so the canvas
 * tells triggers, control steps, agents, and effects apart at a glance.
 * @param kind - node kind.
 * @returns the tone key.
 */
function workflowKindTone(kind: string): 'trigger' | 'control' | 'agent' | 'effect' {
  if (kind.startsWith('trigger.')) return 'trigger'
  if (kind === 'condition' || kind === 'transform' || kind === 'wait') return 'control'
  if (kind === 'agent' || kind === 'skill' || kind === 'routine.invoke' || kind === 'mcp.call') return 'agent'
  return 'effect'
}

/** The accent colour class each node tone paints its left bar with. */
const WORKFLOW_ACCENT_CLASSES: Readonly<Record<ReturnType<typeof workflowKindTone>, string | undefined>> = {
  trigger: styles.workflowAccentTrigger,
  control: styles.workflowAccentControl,
  agent: styles.workflowAccentAgent,
  effect: styles.workflowAccentEffect,
}

/** Open a read-only export in a new tab. */
function openWorkflowExport(value: FaberLoomWorkflowExport): void {
  const blob = new Blob([value.content], { type: value.format === 'json' ? 'application/json' : 'text/html' })
  window.open(URL.createObjectURL(blob), '_blank')
}

/**
 * Project one node's stored config onto the inspector's named text fields, so the
 * form opens on the node's current values instead of raw JSON.
 * @param kind - node kind.
 * @param config - stored node config.
 * @returns the field values keyed by field name.
 */
function workflowFields(kind: string, config: Readonly<Record<string, FaberLoomJsonValue>>): Record<string, string> {
  const text = (key: string): string => {
    const raw = config[key]
    return typeof raw === 'string' ? raw : ''
  }
  switch (kind) {
    case 'agent': return { agentId: text('agentId'), instruction: text('instruction'), useSpaceContext: config['useSpaceContext'] === false ? '' : 'true' }
    case 'skill': return { skillName: text('skillName'), instruction: text('instruction') }
    case 'routine.invoke': return { routineId: text('routineId'), input: text('input') }
    case 'mcp.call': return { server: text('server'), tool: text('tool') }
    case 'imap.action': return { connectionId: text('connectionId'), op: text('op') || 'search', folder: text('folder') }
    case 'smtp.send': return { connectionId: text('connectionId'), subject: text('subject') }
    case 'memory.remember': return { spaceId: text('spaceId'), text: text('text') }
    case 'memory.teach': return { spaceId: text('spaceId'), text: text('text') }
    case 'board.create': return { title: text('title'), summary: text('summary') }
    case 'space.reference': return { spaceId: text('spaceId') }
    case 'condition': return { expression: text('expression') }
    case 'transform': return { expression: text('expression') }
    case 'wait': {
      const seconds = config['seconds']
      return { seconds: typeof seconds === 'number' ? String(seconds) : '0' }
    }
    case 'notify': return { connectionId: text('connectionId'), text: text('text') }
    case 'trigger.email': return { match: text('match') }
    default: return {}
  }
}

/**
 * Compose the config to store from the inspector's named fields for one kind.
 * @param kind - node kind.
 * @param fields - field values.
 * @returns the config object to persist.
 */
function workflowConfig(kind: string, fields: Readonly<Record<string, string>>): Record<string, unknown> {
  const value = (key: string): string => fields[key] ?? ''
  switch (kind) {
    case 'agent': return { agentId: value('agentId'), instruction: value('instruction'), useSpaceContext: value('useSpaceContext') !== '' }
    case 'skill': return { skillName: value('skillName'), instruction: value('instruction') }
    case 'routine.invoke': return { routineId: value('routineId'), input: value('input') }
    case 'mcp.call': return { server: value('server'), tool: value('tool') }
    case 'imap.action': return { connectionId: value('connectionId'), op: value('op') || 'search', folder: value('folder') }
    case 'smtp.send': return { connectionId: value('connectionId'), subject: value('subject') }
    case 'memory.remember': return { spaceId: value('spaceId'), text: value('text') }
    case 'memory.teach': return { spaceId: value('spaceId'), text: value('text'), scope: 'case', source: '' }
    case 'board.create': return { title: value('title'), summary: value('summary') }
    case 'space.reference': return { spaceId: value('spaceId') }
    case 'condition': return { expression: value('expression') }
    case 'transform': return { expression: value('expression') }
    case 'wait': return { seconds: Number(value('seconds')) || 0 }
    case 'notify': return { connectionId: value('connectionId'), text: value('text') }
    case 'trigger.email': return { match: value('match') }
    default: return defaultConfigFor(kind)
  }
}

/** The minimal config a relationship field writes when the user picks a value. */
const WORKFLOW_RELATION_FIELDS: Readonly<Record<string, (value: string) => Record<string, unknown>>> = {
  agentId: value => ({ agentId: value }),
  skillName: value => ({ skillName: value }),
  routineId: value => ({ routineId: value }),
  connectionId: value => ({ connectionId: value }),
  spaceId: value => ({ spaceId: value }),
}

/** One labeled select bound to a catalog relation (agent, skill, routine, connection, space). */
function RelationSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly { id: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <select aria-label={label} value={value} onChange={(event) => { onChange(event.target.value) }}>
        <option value="">—</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  )
}

/** Work Flows: the SVG graph canvas, the node inspector, run history, Space map, and export. */
function workflowsScreen() {
  return function FaberloomWorkflows(props: ScreenProps) {
    const { t, workflows } = props
    const { overview } = useOverview(props)
    const skillsState = useLazy(() => props.skills(), [])
    const [flows, setFlows] = useState<readonly FaberLoomWorkflowRow[]>([])
    const [selected, setSelected] = useState<string | null>(null)
    const [detail, setDetail] = useState<FaberLoomWorkflowDetail | null>(null)
    const [runs, setRuns] = useState<readonly FaberLoomWorkflowRunRow[]>([])
    const [topology, setTopology] = useState<FaberLoomSpaceMap | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [nodeId, setNodeId] = useState<string | null>(null)
    const [connectFrom, setConnectFrom] = useState<string | null>(null)
    const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
    const [view, setView] = useState({ x: 0, y: 0, k: 1 })
    const panning = useRef<{ x: number; y: number } | null>(null)
    const [kind, setKind] = useState('agent')
    const [title, setTitle] = useState('')
    const [flowName, setFlowName] = useState('')
    const [scheduleRecurrence, setScheduleRecurrence] = useState('')
    const [scheduleTimezone, setScheduleTimezone] = useState('')
    const [scheduleFrom, setScheduleFrom] = useState('')
    const [scheduleTo, setScheduleTo] = useState('')
    const [scheduleDays, setScheduleDays] = useState('')
    const [scheduleBusinessDays, setScheduleBusinessDays] = useState(false)
    const [concurrency, setConcurrency] = useState('')
    const [links, setLinks] = useState<readonly FaberLoomWorkflowLink[]>([])
    const [grants, setGrants] = useState<readonly FaberLoomShareGrantRow[]>([])
    const [health, setHealth] = useState<FaberLoomHealth | null>(null)
    const [templates, setTemplates] = useState<readonly FaberLoomWorkflowTemplateRow[]>([])
    const [templateId, setTemplateId] = useState('')
    const [shareEmail, setShareEmail] = useState('')
    const [sharePermissions, setSharePermissions] = useState<readonly string[]>(['view'])
    const [fields, setFields] = useState<Record<string, string>>({})
    const [logsOpen, setLogsOpen] = useState(false)
    const [shareOpen, setShareOpen] = useState(false)
    const [nodeOpen, setNodeOpen] = useState(false)
    const [nodeTab, setNodeTab] = useState<'node' | 'connections' | 'space' | 'routines'>('node')
    const dragging = useRef<string | null>(null)
    const dragged = useRef(false)

    const accept = (result: Result<FaberLoomWorkflowDetail>): void => {
      if (result.ok) {
        setDetail(result.value)
        setMessage(null)
        setConcurrency(result.value.maxConcurrency === null ? '' : String(result.value.maxConcurrency))
      } else setMessage(result.error.message)
    }

    // Refresh the list and select the flow that was just added, so its graph is
    // on screen instead of the "Select a flow" placeholder.
    const acceptFlows = (result: Result<readonly FaberLoomWorkflowRow[]>): void => {
      if (!result.ok) { setMessage(result.error.message); return }
      const created = result.value.find(flow => !flows.some(previous => previous.id === flow.id))
      setFlows(result.value)
      setMessage(null)
      if (created !== undefined) setSelected(created.id)
    }

    useEffect(() => {
      void workflows.overview().then((result) => {
        if (!result.ok) return
        setFlows(result.value)
        const first = result.value[0]
        if (first !== undefined) setSelected(current => current ?? first.id)
      }).catch(() => undefined)
      void workflows.topology().then((result) => { if (result.ok) setTopology(result.value) }).catch(() => undefined)
      void workflows.links().then((result) => { if (result.ok) setLinks(result.value) }).catch(() => undefined)
      void workflows.health().then((result) => { if (result.ok) setHealth(result.value) }).catch(() => undefined)
      void workflows.templates().then((result) => { if (result.ok) setTemplates(result.value) }).catch(() => undefined)
    }, [])
    useEffect(() => {
      if (selected === null) { setDetail(null); setRuns([]); return }
      void workflows.detail(selected).then(accept)
      void workflows.runs(selected).then((result) => { if (result.ok) setRuns(result.value) })
      void workflows.links().then((result) => { if (result.ok) setLinks(result.value) })
      void workflows.resourceShares('workflow', selected).then((result) => { if (result.ok) setGrants(result.value) })
    }, [selected])
    useEffect(() => {
      if (detail === null) { setPositions({}); return }
      const laid = layoutNodes(detail.nodesList.map(node => ({ id: node.id, kind: node.kind, title: node.title, x: node.x, y: node.y })))
      const next: Record<string, { x: number; y: number }> = {}
      for (const node of laid) next[node.id] = { x: node.x, y: node.y }
      setPositions(next)
      setNodeId(null)
    }, [detail])
    useEffect(() => {
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Delete' && selected !== null && nodeId !== null) void workflows.removeNode(selected, nodeId).then(accept)
      }
      window.addEventListener('keydown', onKey)
      return () => { window.removeEventListener('keydown', onKey) }
    })

    const base = detail === null
      ? []
      : layoutNodes(detail.nodesList.map(node => ({ id: node.id, kind: node.kind, title: node.title, x: node.x, y: node.y })))
    const nodes = base.map(node => ({ ...node, ...(positions[node.id] ?? {}) }))
    const byId = new Map(nodes.map(node => [node.id, node]))
    const agentOptions = topology?.agents ?? []
    const connectionOptions = topology?.connections ?? []
    const spaceOptions = topology?.spaces ?? []
    const skillOptions = skillsState.kind === 'ready' ? skillsState.value : []
    const routineOptions = overview?.routines ?? []
    const selectedHealth = detail?.routineId === undefined || health === null
      ? null
      : health.routines.find(row => row.routineId === detail.routineId) ?? null

    const pick = (id: string): void => {
      if (connectFrom !== null && connectFrom !== id) {
        if (selected !== null) void workflows.connect(selected, connectFrom, id).then(accept)
        setConnectFrom(null)
        return
      }
      setNodeId(id)
      const node = detail?.nodesList.find(entry => entry.id === id)
      if (node !== undefined) {
        setKind(node.kind)
        setTitle(node.title)
        setFields(workflowFields(node.kind, node.config))
        const config = node.config
        setScheduleRecurrence(typeof config['recurrence'] === 'string' ? config['recurrence'] : '')
        setScheduleTimezone(typeof config['timezone'] === 'string' ? config['timezone'] : '')
        const window = config['window']
        const windowObject = window !== null && typeof window === 'object' && !Array.isArray(window)
          ? window as Readonly<Record<string, FaberLoomJsonValue>>
          : undefined
        setScheduleFrom(windowObject !== undefined && typeof windowObject['from'] === 'number' ? String(windowObject['from']) : '')
        setScheduleTo(windowObject !== undefined && typeof windowObject['to'] === 'number' ? String(windowObject['to']) : '')
        const days = config['days']
        setScheduleDays(Array.isArray(days) ? days.filter((value): value is number => typeof value === 'number').join(', ') : '')
        setScheduleBusinessDays(config['businessDays'] === true)
      }
      if (!dragged.current) { setNodeTab('node'); setNodeOpen(true) }
    }

    /** Open the node editor modal for one node. */
    const openNode = (id: string): void => {
      pick(id)
      setNodeTab('node')
      setNodeOpen(true)
    }

    const act = (run: () => Promise<Result<FaberLoomWorkflowDetail>>): void => {
      void run().then(accept).catch((error: unknown) => { setMessage(String(error)) })
    }
    /** Append a node of the inspector's kind and select it (disconnected). */
    const addNode = (flowId: string): void => {
      const before = new Set((detail?.nodesList ?? []).map(node => node.id))
      void workflows.addNode(flowId, kind, title.length === 0 ? kind : title, JSON.stringify(defaultConfigFor(kind))).then((result) => {
        accept(result)
        if (!result.ok) return
        const added = result.value.nodesList.find(node => !before.has(node.id))
        if (added !== undefined) {
          setNodeId(added.id)
          setTitle(added.title)
          setKind(added.kind)
          setFields(workflowFields(added.kind, added.config))
          setNodeTab('node')
          setNodeOpen(true)
        }
      }).catch((error: unknown) => { setMessage(String(error)) })
    }
    /** Persist the inspector's form onto the picked node. */
    const saveNode = (flowId: string, id: string): void => {
      act(() => workflows.updateNode(flowId, id, title, kind, JSON.stringify(workflowConfig(kind, fields))))
    }
    /** Change the picked node's kind and apply it, resetting its fields. */
    const changeKind = (flowId: string, id: string, nextKind: string): void => {
      setKind(nextKind)
      setFields(workflowFields(nextKind, {}))
      act(() => workflows.updateNode(flowId, id, title, nextKind, JSON.stringify(defaultConfigFor(nextKind))))
    }
    /** Drop the picked node and its edges. */
    const deleteNode = (flowId: string, id: string): void => {
      act(() => workflows.removeNode(flowId, id))
    }
    /** Remove one edge by id. */
    const dropEdge = (flowId: string, edgeId: string): void => {
      act(() => workflows.disconnect(flowId, edgeId))
    }
    /** Write one relationship field and apply it to the picked node. */
    const setRelation = (flowId: string, id: string, key: string, value: string): void => {
      setFields(current => ({ ...current, [key]: value }))
      const build = WORKFLOW_RELATION_FIELDS[key]
      if (build !== undefined) act(() => workflows.updateNode(flowId, id, title, kind, JSON.stringify(build(value))))
    }
    /** Persist the schedule sub-form onto the picked trigger node. */
    const saveSchedule = (flowId: string, id: string): void => {
      const days = scheduleDays.split(',').map(part => Number(part.trim())).filter(value => Number.isInteger(value) && value >= 0 && value <= 6)
      const from = scheduleFrom.trim().length === 0 ? undefined : Number(scheduleFrom)
      const to = scheduleTo.trim().length === 0 ? undefined : Number(scheduleTo)
      const config: Record<string, unknown> = { recurrence: scheduleRecurrence.trim().length === 0 ? '1h' : scheduleRecurrence.trim() }
      const timezone = scheduleTimezone.trim()
      if (timezone.length > 0) config['timezone'] = timezone
      if (from !== undefined && to !== undefined && !Number.isNaN(from) && !Number.isNaN(to)) config['window'] = { from, to }
      if (days.length > 0) config['days'] = days
      if (scheduleBusinessDays) config['businessDays'] = true
      act(() => workflows.updateNode(flowId, id, title, kind, JSON.stringify(config)))
    }
    /** Persist the flow's concurrency cap. */
    const saveConcurrency = (flowId: string): void => {
      const trimmed = concurrency.trim()
      const value = trimmed.length === 0 ? null : Number(trimmed)
      if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
        setMessage(t('wf.concurrency.invalid'))
        return
      }
      act(() => workflows.setConcurrency(flowId, value))
    }
    /** Create a flow from the selected gallery template. */
    const useTemplate = (): void => {
      if (templateId.length === 0) return
      void workflows.createFromTemplate(templateId).then((result) => {
        if (result.ok) setTemplateId('')
        acceptFlows(result)
      })
    }
    /** Toggle one permission in the Compartir form. */
    const togglePermission = (permission: string): void => {
      setSharePermissions(current => current.includes(permission)
        ? current.filter(value => value !== permission)
        : [...current, permission])
    }
    /** Share the selected flow with the entered email and checked permissions. */
    const shareFlow = (flowId: string): void => {
      const email = shareEmail.trim()
      if (email.length === 0 || sharePermissions.length === 0) return
      void workflows.shareWorkflow(flowId, [email], sharePermissions).then((result) => {
        if (result.ok) { setGrants(result.value); setShareEmail(''); setMessage(null) } else setMessage(result.error.message)
      })
    }
    /** Revoke one grant and drop its row. */
    const revokeGrant = (grantId: string): void => {
      void workflows.revokeShareGrant(grantId).then((result) => {
        if (result.ok) {
          setGrants(current => current.filter(row => row.id !== grantId))
          setMessage(null)
        } else setMessage(result.error.message)
      })
    }
    /** The localized label of one grant status. */
    const statusLabel = (status: string): string => status === 'active'
      ? t('wf.share.status.active')
      : status === 'revoked' ? t('wf.share.status.revoked') : t('wf.share.status.pending')
    const STATUS_CLASSES: Readonly<Record<ReturnType<typeof statusTone>, string | undefined>> = {
      running: styles.workflowStatusRunning,
      waiting: styles.workflowStatusWaiting,
      completed: styles.workflowStatusCompleted,
      failed: styles.workflowStatusFailed,
      idle: styles.workflowStatusIdle,
    }

    /** One inspector field value. */
    const field = (key: string): string => fields[key] ?? ''
    /** Write one inspector field value. */
    const setField = (key: string, value: string): void => { setFields(current => ({ ...current, [key]: value })) }

    return (
      <div className={styles.workflowScreen}>
        <aside className={styles.workflowSidebar}>
          <h3 className={styles.h2}>{t('wf.title')}</h3>
          <input value={flowName} placeholder={t('wf.namePlaceholder')} onChange={(event) => { setFlowName(event.target.value) }} />
          <button type="button" className={styles.primary} onClick={() => {
            if (flowName.trim().length === 0) return
            void workflows.create(flowName.trim()).then((result) => { acceptFlows(result); if (result.ok) setFlowName('') })
          }}>{t('wf.create')}</button>
          {flows.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.empty')}</span> : null}
          {flows.map(flow => (
            <button key={flow.id} type="button" className={`${styles.workflowFlowButton} ${selected === flow.id ? styles.workflowFlowButtonActive : ''}`} onClick={() => { setSelected(flow.id) }}>
              {flow.name} · {flow.status} · {flow.nodes}/{flow.edges}
            </button>
          ))}
          <div className={styles.workflowTemplates}>
            <span>{t('wf.templates')}</span>
            <select aria-label={t('wf.templates')} value={templateId} onChange={(event) => { setTemplateId(event.target.value) }}>
              <option value="">{t('wf.templates.pick')}</option>
              {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <button type="button" onClick={() => { useTemplate() }}>{t('wf.templates.use')}</button>
            <label className={styles.workflowImport}>
              {t('wf.import')}
              <input type="file" accept="application/json,.json" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file === undefined) return
                void file.text().then(text => workflows.importFlow(text)).then((result) => { acceptFlows(result) })
                event.target.value = ''
              }} />
            </label>
          </div>
        </aside>
        <main className={styles.workflowMain}>
          {message !== null ? <div className={styles.workflowMessage}>{message}</div> : null}
          {selected === null ? <span>{t('wf.select')}</span> : (
            <>
              <div className={styles.workflowToolbar}>
                <button type="button" className={styles.primary} onClick={() => { act(() => workflows.setStatus(selected, 'active')) }}>{t('wf.activate')}</button>
                <button type="button" onClick={() => { act(() => workflows.setStatus(selected, 'paused')) }}>{t('wf.pause')}</button>
                <button type="button" className={styles.primary} onClick={() => { addNode(selected) }}>{t('wf.addNode')}</button>
                <button type="button" onClick={() => { setLogsOpen(true) }}>{t('wf.logs')}</button>
                <button type="button" onClick={() => { setShareOpen(true) }}>{t('wf.share')}</button>
                <button type="button" onClick={() => { void workflows.exportFlow(selected, 'json').then((result) => { if (result.ok) openWorkflowExport(result.value) }) }}>{t('wf.exportJson')}</button>
                <button type="button" onClick={() => { void workflows.exportFlow(selected, 'archify').then((result) => { if (result.ok) openWorkflowExport(result.value) }) }}>{t('wf.exportArchify')}</button>
                <input aria-label={t('wf.concurrency')} placeholder={t('wf.concurrency')} value={concurrency}
                  onChange={(event) => { setConcurrency(event.target.value) }} />
                <button type="button" onClick={() => { saveConcurrency(selected) }}>{t('wf.concurrency.save')}</button>
              </div>
              {selectedHealth === null ? null : (
                <div className={styles.workflowInspector}>
                  <span>{t('wf.health')}</span>
                  <span>{t('wf.health.runs')}: {selectedHealth.runs}</span>
                  <span>{t('wf.health.failures')}: {selectedHealth.failures}</span>
                  <span>{t('wf.health.review')}: {selectedHealth.needsReview}</span>
                  <span>{t('wf.health.retries')}: {selectedHealth.retries}</span>
                  {selectedHealth.deadlineAt === null ? null : <span>{t('wf.health.deadline')}: {selectedHealth.deadlineAt}</span>}
                </div>
              )}
              <div className={styles.workflowCanvasWrap}>
                <svg className={styles.workflowCanvas} viewBox="0 0 900 320"
                  onPointerDown={(event) => { panning.current = { x: event.clientX, y: event.clientY } }}
                  onPointerMove={(event) => {
                    const id = dragging.current
                    if (id !== null) {
                      dragged.current = true
                      const rect = (event.currentTarget).getBoundingClientRect()
                      const x = ((event.clientX - rect.left) / rect.width) * 900
                      const y = ((event.clientY - rect.top) / rect.height) * 320
                      setPositions(current => ({ ...current, [id]: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } }))
                      return
                    }
                    const start = panning.current
                    if (start === null) return
                    const dx = event.clientX - start.x
                    const dy = event.clientY - start.y
                    panning.current = { x: event.clientX, y: event.clientY }
                    setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }))
                  }}
                  onPointerUp={() => { dragging.current = null; panning.current = null }}
                  onPointerLeave={() => { dragging.current = null; panning.current = null }}
                  onWheel={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const px = ((event.clientX - rect.left) / rect.width) * 900
                    const py = ((event.clientY - rect.top) / rect.height) * 320
                    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
                    setView((current) => {
                      const k = Math.min(3, Math.max(0.3, current.k * factor))
                      const scale = k / current.k
                      return { k, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale }
                    })
                  }}>
                  <defs>
                    <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" className={styles.workflowArrowHead} />
                    </marker>
                    <marker id="wf-arrow-cond" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M 0 0 L 10 5 L 0 10 z" className={styles.workflowArrowHeadConditional} />
                    </marker>
                  </defs>
                  <g transform={`translate(${String(view.x)}, ${String(view.y)}) scale(${String(view.k)})`}>
                    {detail?.edgesList.map((edge) => {
                      const from = byId.get(edge.from)
                      const to = byId.get(edge.to)
                      if (from === undefined || to === undefined) return null
                      const line = edgeLine(from, to)
                      return (
                        <line key={edge.id} className={edge.condition === null ? styles.workflowEdge : styles.workflowEdgeConditional}
                          markerEnd={edge.condition === null ? 'url(#wf-arrow)' : 'url(#wf-arrow-cond)'} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                      )
                    })}
                    {nodes.map(node => (
                      <g key={node.id} className={styles.workflowNode} transform={`translate(${String(node.x)}, ${String(node.y)})`} onPointerDown={(event) => { event.stopPropagation(); dragging.current = node.id; dragged.current = false }} onClick={() => { pick(node.id) }}>
                        <rect className={`${styles.workflowNodeBody} ${kindIsTrigger(node.kind) ? styles.workflowNodeBodyTrigger : ''} ${nodeId === node.id ? styles.workflowNodeBodySelected : ''} ${connectFrom === node.id ? styles.workflowNodeBodyConnecting : ''}`} width={NODE_WIDTH} height={NODE_HEIGHT} rx={10} />
                        <rect className={`${styles.workflowNodeAccent} ${WORKFLOW_ACCENT_CLASSES[workflowKindTone(node.kind)] ?? ''}`} width={4} height={NODE_HEIGHT} rx={2} />
                        <text className={styles.workflowNodeTitle} x={12} y={24}>{node.title}</text>
                        <text className={styles.workflowNodeKind} x={12} y={42}>{node.kind}</text>
                        <g className={styles.workflowNodeEdit} role="button" aria-label={t('wf.editNode')} transform={`translate(${String(NODE_WIDTH - 28)}, 6)`} onPointerDown={(event) => { event.stopPropagation() }} onClick={(event) => { event.stopPropagation(); openNode(node.id) }}>
                          <rect className={styles.workflowNodeEditBg} width={20} height={18} rx={5} />
                          <path className={styles.workflowNodeEditGlyph} d="M5 12 L5 14.5 L7.5 14.5 L13.5 8.5 L11 6 Z" />
                        </g>
                      </g>
                    ))}
                  </g>
                </svg>
                <div className={styles.workflowZoom}>
                  <button type="button" aria-label={t('wf.zoomOut')} onClick={() => { setView(current => ({ ...current, k: Math.max(0.3, current.k / 1.2) })) }}>{'-'}</button>
                  <span>{`${String(Math.round(view.k * 100))}%`}</span>
                  <button type="button" aria-label={t('wf.zoomIn')} onClick={() => { setView(current => ({ ...current, k: Math.min(3, current.k * 1.2) })) }}>{'+'}</button>
                  <button type="button" onClick={() => { setView({ x: 0, y: 0, k: 1 }) }}>{t('wf.zoomReset')}</button>
                </div>
              </div>
              <Modal open={nodeOpen} onClose={() => { setNodeOpen(false) }} title={t('wf.node')} closeLabel={t('action.close')} className={styles.workflowModal ?? ''} contentClassName={styles.workflowModalContent ?? ''}>
                <div className={styles.workflowTabs}>
                  <button type="button" className={nodeTab === 'node' ? styles.workflowTabActive : styles.workflowTab} onClick={() => { setNodeTab('node') }}>{t('wf.tabNode')}</button>
                  <button type="button" className={nodeTab === 'connections' ? styles.workflowTabActive : styles.workflowTab} onClick={() => { setNodeTab('connections') }}>{t('wf.tabConnections')}</button>
                  <button type="button" className={nodeTab === 'space' ? styles.workflowTabActive : styles.workflowTab} onClick={() => { setNodeTab('space') }}>{t('wf.tabSpace')}</button>
                  <button type="button" className={nodeTab === 'routines' ? styles.workflowTabActive : styles.workflowTab} onClick={() => { setNodeTab('routines') }}>{t('wf.tabRoutines')}</button>
                </div>
                {nodeTab === 'node' ? (
                  <div className={styles.workflowTabPanel}>
                    <Field label={t('wf.kind')}>
                      <select aria-label={t('wf.kind')} value={kind} onChange={(event) => { if (nodeId !== null) changeKind(selected, nodeId, event.target.value); else setKind(event.target.value) }}>
                        {WORKFLOW_KINDS.map(value => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Field label={t('wf.nodeTitle')}>
                      <input value={title} placeholder={t('wf.nodeTitle')} onChange={(event) => { setTitle(event.target.value) }} />
                    </Field>
                    {kind === 'agent' ? (
                      <>
                        <RelationSelect label={t('wf.agent')} value={field('agentId')} options={agentOptions.map(agent => ({ id: agent.id, label: agent.name }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'agentId', value) }} />
                        <Field label={t('wf.instruction')}>
                          <textarea aria-label={t('wf.instruction')} value={field('instruction')} onChange={(event) => { setField('instruction', event.target.value) }} />
                        </Field>
                        <label className={styles.workflowCheck}>
                          <input type="checkbox" checked={field('useSpaceContext') !== ''} onChange={(event) => { setField('useSpaceContext', event.target.checked ? 'true' : '') }} />
                          {t('wf.useSpaceContext')}
                        </label>
                      </>
                    ) : null}
                    {kind === 'skill' ? (
                      <>
                        <RelationSelect label={t('wf.skill')} value={field('skillName')} options={skillOptions.map(skill => ({ id: skill.name, label: skill.name }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'skillName', value) }} />
                        <Field label={t('wf.instruction')}>
                          <textarea aria-label={t('wf.instruction')} value={field('instruction')} onChange={(event) => { setField('instruction', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'routine.invoke' ? (
                      <>
                        <RelationSelect label={t('wf.routine')} value={field('routineId')} options={routineOptions.map(routine => ({ id: routine.id, label: routine.name }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'routineId', value) }} />
                        <Field label={t('wf.input')}>
                          <input aria-label={t('wf.input')} value={field('input')} onChange={(event) => { setField('input', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'imap.action' ? (
                      <>
                        <RelationSelect label={t('wf.connection')} value={field('connectionId')} options={connectionOptions.map(connection => ({ id: connection.id, label: connection.label }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'connectionId', value) }} />
                        <Field label={t('wf.op')}>
                          <select aria-label={t('wf.op')} value={field('op') === '' ? 'search' : field('op')} onChange={(event) => { setField('op', event.target.value) }}>
                            {WORKFLOW_IMAP_OPS.map(op => <option key={op} value={op}>{op}</option>)}
                          </select>
                        </Field>
                        <Field label={t('wf.folder')}>
                          <input aria-label={t('wf.folder')} value={field('folder')} onChange={(event) => { setField('folder', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'smtp.send' || kind === 'notify' ? (
                      <>
                        <RelationSelect label={t('wf.connection')} value={field('connectionId')} options={connectionOptions.map(connection => ({ id: connection.id, label: connection.label }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'connectionId', value) }} />
                        <Field label={t('wf.text')}>
                          <textarea aria-label={t('wf.text')} value={kind === 'smtp.send' ? field('subject') : field('text')} onChange={(event) => { setField(kind === 'smtp.send' ? 'subject' : 'text', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'memory.remember' || kind === 'memory.teach' || kind === 'space.reference' ? (
                      <>
                        <RelationSelect label={t('wf.space')} value={field('spaceId')} options={spaceOptions.map(space => ({ id: space.id, label: space.title }))} onChange={(value) => { if (nodeId !== null) setRelation(selected, nodeId, 'spaceId', value) }} />
                        {kind === 'space.reference' ? null : (
                          <Field label={t('wf.text')}>
                            <textarea aria-label={t('wf.text')} value={field('text')} onChange={(event) => { setField('text', event.target.value) }} />
                          </Field>
                        )}
                      </>
                    ) : null}
                    {kind === 'mcp.call' ? (
                      <>
                        <Field label={t('wf.server')}>
                          <input aria-label={t('wf.server')} value={field('server')} onChange={(event) => { setField('server', event.target.value) }} />
                        </Field>
                        <Field label={t('wf.tool')}>
                          <input aria-label={t('wf.tool')} value={field('tool')} onChange={(event) => { setField('tool', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'board.create' ? (
                      <>
                        <Field label={t('wf.nodeTitle')}>
                          <input aria-label={t('wf.boardTitle')} value={field('title')} onChange={(event) => { setField('title', event.target.value) }} />
                        </Field>
                        <Field label={t('wf.summary')}>
                          <textarea aria-label={t('wf.summary')} value={field('summary')} onChange={(event) => { setField('summary', event.target.value) }} />
                        </Field>
                      </>
                    ) : null}
                    {kind === 'condition' || kind === 'transform' ? (
                      <Field label={t('wf.expression')}>
                        <input aria-label={t('wf.expression')} value={field('expression')} onChange={(event) => { setField('expression', event.target.value) }} />
                      </Field>
                    ) : null}
                    {kind === 'wait' ? (
                      <Field label={t('wf.seconds')}>
                        <input aria-label={t('wf.seconds')} inputMode="numeric" value={field('seconds')} onChange={(event) => { setField('seconds', event.target.value) }} />
                      </Field>
                    ) : null}
                    {kind === 'trigger.email' ? (
                      <Field label={t('wf.match')}>
                        <input aria-label={t('wf.match')} value={field('match')} onChange={(event) => { setField('match', event.target.value) }} />
                      </Field>
                    ) : null}
                    {kind === 'trigger.schedule' ? (
                      <>
                        <Field label={t('wf.schedule.recurrence')}>
                          <input aria-label={t('wf.schedule.recurrence')} placeholder={t('wf.schedule.recurrence')} value={scheduleRecurrence}
                            onChange={(event) => { setScheduleRecurrence(event.target.value) }} />
                        </Field>
                        <Field label={t('wf.schedule.timezone')}>
                          <input aria-label={t('wf.schedule.timezone')} placeholder={t('wf.schedule.timezone')} value={scheduleTimezone}
                            onChange={(event) => { setScheduleTimezone(event.target.value) }} />
                        </Field>
                        <Field label={t('wf.schedule.from')}>
                          <input aria-label={t('wf.schedule.from')} placeholder={t('wf.schedule.from')} value={scheduleFrom}
                            onChange={(event) => { setScheduleFrom(event.target.value) }} />
                        </Field>
                        <Field label={t('wf.schedule.to')}>
                          <input aria-label={t('wf.schedule.to')} placeholder={t('wf.schedule.to')} value={scheduleTo}
                            onChange={(event) => { setScheduleTo(event.target.value) }} />
                        </Field>
                        <Field label={t('wf.schedule.days')}>
                          <input aria-label={t('wf.schedule.days')} placeholder={t('wf.schedule.days')} value={scheduleDays}
                            onChange={(event) => { setScheduleDays(event.target.value) }} />
                        </Field>
                        <label className={styles.workflowCheck}>
                          <input type="checkbox" checked={scheduleBusinessDays}
                            onChange={(event) => { setScheduleBusinessDays(event.target.checked) }} />
                          {t('wf.schedule.businessDays')}
                        </label>
                      </>
                    ) : null}
                    <div className={styles.workflowActions}>
                      <button type="button" className={styles.primary} disabled={nodeId === null} onClick={() => { if (nodeId !== null) saveNode(selected, nodeId) }}>{t('wf.save')}</button>
                      {kind === 'trigger.schedule' ? (
                        <button type="button" disabled={nodeId === null} onClick={() => { if (nodeId !== null) saveSchedule(selected, nodeId) }}>{t('wf.schedule.save')}</button>
                      ) : null}
                      <button type="button" disabled={nodeId === null} onClick={() => { setConnectFrom(nodeId) }}>{t('wf.connect')}</button>
                      <button type="button" disabled={nodeId === null} onClick={() => { if (nodeId !== null) deleteNode(selected, nodeId) }}>{t('wf.removeNode')}</button>
                    </div>
                    <span className={styles.workflowHint}>
                      {connectFrom === null ? t('wf.hintEdit') : t('wf.hintConnect')}
                    </span>
                  </div>
                ) : null}
                {nodeTab === 'connections' ? (
                  <div className={styles.workflowTabPanel}>
                    {detail !== null && detail.edgesList.length > 0 ? detail.edgesList.map(edge => (
                      <div key={edge.id} className={styles.workflowRunRow}>
                        <span>{edge.from} → {edge.to}{edge.condition === null ? '' : ` · ${edge.condition}`}</span>
                        <button type="button" onClick={() => { dropEdge(selected, edge.id) }}>{t('wf.disconnect')}</button>
                      </div>
                    )) : <span className={styles.workflowEmpty}>{t('wf.noConnections')}</span>}
                  </div>
                ) : null}
                {nodeTab === 'space' ? (
                  <div className={styles.workflowTabPanel}>
                    {topology === null || topology.spaces.length === 0
                      ? <span className={styles.workflowEmpty}>{t('wf.noConnections')}</span>
                      : topology.spaces.map(space => <div key={space.id}>{space.title}</div>)}
                  </div>
                ) : null}
                {nodeTab === 'routines' ? (
                  <div className={styles.workflowTabPanel}>
                    {links.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.links.empty')}</span> : links.map(link => (
                      <div key={`${link.direction}:${link.routineId}:${link.workflowId}`}>
                        {link.direction === 'routine-to-workflow'
                          ? `${link.routineName} → ${link.workflowName}`
                          : `${link.workflowName} → ${link.routineName}`}
                      </div>
                    ))}
                  </div>
                ) : null}
              </Modal>
              {/* Connections, the Space map, and the routine links live in the Logs modal. */}
              <Modal open={logsOpen} onClose={() => { setLogsOpen(false) }} title={t('wf.runs')} closeLabel={t('action.close')}>
                {selectedHealth === null ? null : (
                  <div className={styles.workflowHealthRow}>
                    <span>{t('wf.health.runs')}: {selectedHealth.runs}</span>
                    <span>{t('wf.health.failures')}: {selectedHealth.failures}</span>
                    <span>{t('wf.health.review')}: {selectedHealth.needsReview}</span>
                    <span>{t('wf.health.retries')}: {selectedHealth.retries}</span>
                    {selectedHealth.deadlineAt === null ? null : <span>{t('wf.health.deadline')}: {selectedHealth.deadlineAt}</span>}
                  </div>
                )}
                {runs.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.noRuns')}</span> : runs.map(run => (
                  <div key={run.id} className={styles.workflowRunRow}>
                    <span className={`${styles.workflowStatusDot} ${STATUS_CLASSES[statusTone(run.status)]}`} />
                    <span>{run.status}</span><span className={styles.workflowRunWhen}>{run.createdAt}</span>
                  </div>
                ))}
              </Modal>
              <Modal open={shareOpen} onClose={() => { setShareOpen(false) }} title={t('wf.share')} closeLabel={t('action.close')}>
                <div className={styles.workflowForm}>
                  <Field label={t('wf.share.email')}>
                    <input aria-label={t('wf.share.email')} placeholder={t('wf.share.email')} value={shareEmail}
                      onChange={(event) => { setShareEmail(event.target.value) }} />
                  </Field>
                  <Field label={t('wf.share.permissions')}>
                    <div className={styles.workflowPermissions}>
                      {SHARE_PERMISSION_OPTIONS.map(permission => (
                        <label key={permission} className={`${styles.workflowPermission} ${sharePermissions.includes(permission) ? styles.workflowPermissionOn : ''}`}>
                          <input type="checkbox" checked={sharePermissions.includes(permission)}
                            onChange={() => { togglePermission(permission) }} />
                          {permission}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <button type="button" className={styles.primary} onClick={() => { shareFlow(selected) }}>{t('wf.share.submit')}</button>
                </div>
                {grants.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.share.none')}</span> : grants.map(grant => (
                  <div key={grant.id} className={styles.workflowRunRow}>
                    <span>{grant.granteeEmail}</span>
                    <span className={styles.workflowRunWhen}>{grant.permissionLabel}</span>
                    <span>{statusLabel(grant.status)}</span>
                    <button type="button" onClick={() => { revokeGrant(grant.id) }}>{t('wf.share.revoke')}</button>
                  </div>
                ))}
              </Modal>
            </>
          )}
        </main>
      </div>
    )
  }
}

/** The FaberLoom sections in sidebar order. */
export const FABERLOOM_SECTIONS: readonly FaberloomSection[] = [
  { id: 'faberloom-conversar' as MainPanelId, order: 10, labelKey: 'nav.conversar', Icon: panelIcon(IconNewChatOutline16), Page: conversarPanel() },
  { id: 'faberloom-board' as MainPanelId, order: 20, labelKey: 'nav.board', Icon: panelIcon(IconChecklistOutline14), Page: boardScreen() },
  { id: 'faberloom-spaces' as MainPanelId, order: 30, labelKey: 'nav.spaces', Icon: panelIcon(IconFolderOpenOutline16), Page: spacesScreen() },
  { id: 'faberloom-agents' as MainPanelId, order: 40, labelKey: 'nav.agents', Icon: panelIcon(IconAgentPresetOutline16), Page: agentsScreen() },
  { id: 'faberloom-skills' as MainPanelId, order: 45, labelKey: 'nav.skills', Icon: panelIcon(IconAgentPresetOutline16), Page: skillsScreen() },
  { id: 'faberloom-routines' as MainPanelId, order: 50, labelKey: 'nav.routines', Icon: panelIcon(IconAlarmClockOutline16), Page: routinesScreen() },
  { id: 'faberloom-workflows' as MainPanelId, order: 55, labelKey: 'nav.workflows', Icon: panelIcon(IconBranchOutline16), Page: workflowsScreen() },
  { id: 'faberloom-memory' as MainPanelId, order: 60, labelKey: 'nav.memory', Icon: panelIcon(IconDatabaseOutline16), Page: memoryScreen() },
  { id: 'faberloom-connections' as MainPanelId, order: 70, labelKey: 'nav.connections', Icon: panelIcon(IconApiOutline14), Page: connectionsScreen() },
  { id: 'faberloom-email' as MainPanelId, order: 75, labelKey: 'nav.email', Icon: panelIcon(IconSendOutline14), Page: emailScreen() },
]
