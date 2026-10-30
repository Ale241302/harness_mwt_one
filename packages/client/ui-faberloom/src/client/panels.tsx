/**
 * FaberLoom module screens. Each screen is the same shape: a toolbar, a dense
 * table of records, and a right-hand inspector that edits the selected record.
 * Agentes and Skills have full editors; the remaining modules read the shared
 * overview and expose their own row actions. The Conversar panel hands the user
 * to the harness conversation, which owns the composer.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: declares the sidebar shell's `sidebar.panellist` owner props.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  FlIconAdmin,
  FlIconCriterio,
  FlIconCuration,
  FlIconExternal,
  FlIconKnowledgeIndex,
  FlIconMail,
  FlIconRefresh,
  FlIconSpaceloom,
  FlIconStackloom,
  FlIconWorkspace,
  FlIconWorkloom,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { BrandWordmark, Modal, SecretInput } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTypeIcon, IconCheckOutline16, IconChevronRightOutline14, IconFolderClose16, IconFolderOpen16, IconTrashOutline16, classifyFileType } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  AgentSaveInput, FaberLoomAgentDetail, FaberLoomBoardDetail, FaberLoomBoardDraftRow, FaberLoomBoardRow,
  FaberLoomConnection, FaberLoomExecutionRow,
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
  FaberLoomContextRow, FaberLoomContextVersionRow, FaberLoomContextExportRow, FaberLoomWorkflowVersionRow,
  FaberLoomSharedSessionRow, FaberLoomSharedSessionContentRow,
  FaberLoomWorkflowPendingRow, FaberLoomWorkflowGraph,
  FaberLoomSkillInstallDestination, FaberLoomSkillInstallRow, FaberLoomHarnessReport,
  FaberLoomSpaceTreeEntry,
  FaberLoomBoardIteration, FaberLoomBoardIterationApplyInput, FaberLoomBoardIterationApplyResult,
  FaberLoomBoardIterationCancelInput,
  FaberLoomBoardIterationContext, FaberLoomBoardIterationDifference, FaberLoomBoardIterationDraftRead,
  FaberLoomBoardIterationDraftRow, FaberLoomBoardEditResult,
  FaberLoomBoardIterationExit, FaberLoomBoardIterationPauseInput, FaberLoomBoardIterationRecover,
  FaberLoomBoardIterationResume, FaberLoomBoardTransferredDraft,
  FaberLoomBoardIterationLockInput,
  FaberLoomBoardIterationSaveInput, FaberLoomBoardIterationChoice, FaberLoomBoardCorrectionScope,
  FaberLoomBoardEffectStatus, FaberLoomBoardEffectAlertRow, FaberLoomBoardEffectPolicy,
  FaberLoomBoardExecutionInput, FaberLoomBoardRevertInput, FaberLoomBoardRetryInput,
  FaberLoomBoardReconcileInput, FaberLoomBoardAdminCloseInput, FaberLoomBoardAdminCloseResult,
  FaberLoomBoardEffectOutcome, FaberLoomSignatureRow, SignatureIssueInput,
  FaberLoomBoardView, FaberLoomBoardViewFilters, FaberLoomBoardFieldChange,
} from '@deepseek-ai/dsh-faberloom-view/types'
import { Block, Chip, DataTable, Field, Inspector, SearchBox, SkillTransfer, StateBlock, StatusDot, tableLabels, Toolbar, type Column } from './components.tsx'
import { isDesktopApplication } from './desktop-app.ts'
import { HarnessInstallWizard } from './harness-install.tsx'
import { defaultConfigFor, edgeLine, kindIsTrigger, layoutNodes, NODE_HEIGHT, NODE_WIDTH, statusTone } from './workflow-logic.ts'
import { uniqueSpaces } from './space-options.ts'
import { evidenceLabel } from './evidence.ts'
import type { createWorkspaceStore } from './store.ts'
import type { FaberloomKey } from './locales.ts'
import styles from './faberloom.module.css'

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The version one approval names, captured when its panel opens (G9). The
 * approval never reads the item live, so a newer version under the panel cannot
 * be approved by accident.
 */
interface Acceptance {
  /** Board item the acceptance belongs to. */
  readonly itemId: string
  /** Artifact version the approval names. */
  readonly version: number
  /** Artifact hash that version carries. */
  readonly hash: string
  /** Row version the command expects. */
  readonly rowVersion: number
  /** True when the panel committed the pending edits before it opened. */
  readonly saved: boolean
}

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
  /** Adopt an existing folder as a new space (or sub-space) and refresh. */
  createSpaceFromFolder: (title: string, path: string, parentId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Remove one space, its Workspace, and its conversation area. */
  deleteSpace: (id: string) => void
  /** Open the space's Workspace in the sidebar conversation area. */
  goToWorkspace: (spaceId: string) => void
  /** Adopt an existing folder as this space's Workspace, chosen with the directory picker. */
  adoptSpaceWorkspace: (spaceId: string) => void
  /** Write this space's context export into its folder. */
  exportContextToFolder: (spaceId: string) => Promise<Result<{ path: string; bytes: number }>>
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
  /** Approve or reject the current board revision, with an optional review note. */
  /** Reopen one reviewed board item for correction. */
  reopenBoardItem: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Submit a prepared result as a new revision awaiting review. */
  submitBoardRevision: (id: string, input: { summary: string; evidence: readonly string[] }) => Promise<Result<FaberLoomOverview>>
  /** Move a board item into an exception state: request_data, fail, or complete. */
  boardException: (id: string, action: 'request_data' | 'fail' | 'complete') => Promise<Result<FaberLoomOverview>>
  /** Set or correct the human severity. */
  boardSetSeverity: (id: string, severity: string, rowVersion: number, source?: 'RULE' | 'LLM' | 'HUMAN', confidence?: number | null) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Assign the catalog agent responsible for one item. */
  boardAssignAgent: (id: string, agentId: string | null, rowVersion: number) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Resolve a stored document key into a temporary URL. */
  boardArtifactUrl: (key: string) => Promise<Result<{ url: string } | null>>
  /** Save inline edits as a new version and report a correction that could not be recorded. */
  boardSaveEdits: (
    id: string,
    input: { rowVersion: number; baseVersion: number; changes: Record<string, string | number | boolean | null> },
  ) => Promise<Result<FaberLoomBoardEditResult>>
  /** Approve the exact version and hash. */
  boardApprove: (
    id: string,
    input: { rowVersion: number; artifactVersion: number; artifactHash: string; confirmations?: readonly string[] },
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Save edits and approve the resulting version atomically. */
  boardApproveWithEdits: (
    id: string,
    input: {
      rowVersion: number
      baseVersion: number
      artifactVersion: number
      artifactHash: string
      changes: Record<string, string | number | boolean | null>
      confirmations?: readonly string[]
    },
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Discard with a closed-list reason. */
  boardDiscard: (
    id: string,
    input: { rowVersion: number; reason: string; note?: string },
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Adopt or keep the pending candidate. */
  boardResolveCandidate: (
    id: string,
    candidateId: string,
    candidateHash: string,
    decision: 'adopt' | 'keep',
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Assign a space to an item. */
  boardAssignWorkspace: (id: string, workspaceId: string) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Read the audit history. */
  boardEvents: (id: string) => Promise<Result<readonly { command: string; at: string; reason: string | null }[]>>
  /** Read the caller's inline draft. */
  boardGetDraft: (id: string) => Promise<Result<FaberLoomBoardDraftRow | null>>
  /** Save one inline draft write. */
  boardSaveDraft: (
    id: string,
    input: { baseVersion: number; revision: number; writerSession: string; changes: Record<string, string | number | boolean | null> },
  ) => Promise<Result<FaberLoomBoardDraftRow>>
  /** Take the writer seat for this tab. */
  boardTakeDraft: (id: string, writerSession: string) => Promise<Result<FaberLoomBoardDraftRow>>
  /** Discard the caller's draft. */
  boardDiscardDraft: (id: string) => Promise<Result<void>>
  /** Clear staleness after checking the changed condition. */
  boardRevalidate: (id: string, changed: boolean) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Read one item's iteration attempt, already filtered by the host. */
  boardIteration: (id: string) => Promise<Result<FaberLoomBoardIteration | undefined>>
  /**
   * Read the pinned chat context, minimised to the item and capped by the
   * provider's data-class ceiling. The panel names no provider, so the host
   * assumes the deployment's default (§8.5, W-48).
   */
  boardIterationContext: (id: string) => Promise<Result<FaberLoomBoardIterationContext | undefined>>
  /** Start an attempt over the version the panel shows. */
  boardIterationStart: (id: string, baseVersion: number, actorSession: string) => Promise<Result<FaberLoomBoardIteration>>
  /** Store one write of the attempt's working draft. */
  boardIterationSaveDraft: (
    id: string,
    input: FaberLoomBoardIterationSaveInput,
  ) => Promise<Result<FaberLoomBoardIterationDraftRow>>
  /** Apply the attempt with the scope its correction teaches. */
  boardIterationApply: (
    id: string,
    input: FaberLoomBoardIterationApplyInput,
  ) => Promise<Result<FaberLoomBoardIterationApplyResult>>
  /** Extend the live attempt's lock while this tab works it. */
  boardIterationRenew: (
    id: string,
    input: FaberLoomBoardIterationLockInput,
  ) => Promise<Result<FaberLoomBoardIteration>>
  /** Save and exit, carry to SpaceLoom, or return without resolving. */
  boardIterationPause: (
    id: string,
    input: FaberLoomBoardIterationPauseInput,
  ) => Promise<Result<FaberLoomBoardIteration>>
  /** Discard the attempt's work; the version does not change. */
  boardIterationCancel: (
    id: string,
    input: FaberLoomBoardIterationCancelInput,
  ) => Promise<Result<FaberLoomBoardIteration>>
  /** Reopen the retained draft, or receive its differences when stale. */
  boardIterationResume: (id: string, baseVersion: number, actorSession: string) => Promise<Result<FaberLoomBoardIterationResume>>
  /** Recover a transferred draft as the live attempt's draft, or receive its differences when stale. */
  boardIterationRecover: (
    id: string,
    draftKey: string,
    actorSession: string,
  ) => Promise<Result<FaberLoomBoardIterationRecover>>
  /** Read the retained draft and, when stale, where it disagrees. */
  boardIterationDraft: (id: string, iterationId?: string) => Promise<Result<FaberLoomBoardIterationDraftRead>>
  /** Approve the exact artifact and accept one execution for it. */
  boardApproveWithExecution: (
    id: string,
    input: FaberLoomBoardExecutionInput,
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Read one item's external effect, or null when it authorized none. */
  boardEffectStatus: (id: string) => Promise<Result<FaberLoomBoardEffectStatus | null>>
  /** Read the tenant's visible effect alerts, newest first. */
  boardEffectAlerts: () => Promise<Result<readonly FaberLoomBoardEffectAlertRow[]>>
  /** Read the action types an acceptance may name and their reversal windows. */
  boardEffectPolicy: () => Promise<Result<FaberLoomBoardEffectPolicy>>
  /** Revert a delegated execution inside its window. */
  boardEffectRevert: (
    id: string,
    input: FaberLoomBoardRevertInput,
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Retry a failed execution with its original identity. */
  boardEffectRetry: (
    id: string,
    input: FaberLoomBoardRetryInput,
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Record what the destination reported about a dispatched effect. */
  boardEffectReconcile: (
    id: string,
    input: FaberLoomBoardReconcileInput,
  ) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** Ask the destination what became of a dispatched effect. */
  boardEffectProbe: (id: string, input: FaberLoomBoardRetryInput) => Promise<Result<FaberLoomBoardEffectStatus | null>>
  /** Close an item administratively, leaving its reconciliation open. */
  boardEffectAdminClose: (id: string, input: FaberLoomBoardAdminCloseInput) => Promise<Result<FaberLoomBoardAdminCloseResult>>
  /** List every protected action type and the signature state that covers it. */
  boardSignatures: () => Promise<Result<readonly FaberLoomSignatureRow[]>>
  /** Read the signature state covering one action type. */
  boardSignatureStatus: (actionType: string) => Promise<Result<FaberLoomSignatureRow>>
  /** Issue one CEO signature for the acting identity's tenant. */
  boardSignatureIssue: (input: SignatureIssueInput) => Promise<Result<readonly FaberLoomSignatureRow[]>>
  /** Revoke one CEO signature. */
  boardSignatureRevoke: (signatureId: string) => Promise<Result<readonly FaberLoomSignatureRow[]>>
  /** Create a draft routine, optionally scoped to a Space. */
  createRoutine: (name: string, spaceId: string | null) => void
  /** Activate or pause one routine. */
  setRoutineActive: (id: string, active: boolean) => void
  /** Remember one statement, attached to a space or to no space. */
  remember: (text: string, spaceId: string | null) => void
  /** Read the space-scoped memory, resolved for one space when given. */
  spaceMemory: (spaceId?: string) => Promise<Result<readonly FaberLoomSpaceMemoryRow[]>>
  /** Delete one space-memory entry and return the refreshed list. */
  deleteSpaceMemory: (id: string) => Promise<Result<readonly FaberLoomSpaceMemoryRow[]>>
  /** Set who may see one memory entry (owner only). */
  setMemoryVisibility: (id: string, visibility: string) => Promise<Result<readonly FaberLoomSpaceMemoryRow[]>>
  /** Set who may see one work flow (owner only). */
  setWorkflowVisibility: (id: string, visibility: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
  /** Set who may see one routine (owner only). */
  setRoutineVisibility: (id: string, visibility: string) => void
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
  /** Read a space's whole folder once, for search and session grouping. */
  spaceTree: (spaceId: string) => Promise<Result<{ root: string; entries: readonly FaberLoomSpaceTreeEntry[] }>>
  /** Rename one entry of a space's folder. */
  renameSpaceEntry: (spaceId: string, path: string, name: string) => Promise<Result<void>>
  /** Delete one or more entries of a space's folder. */
  deleteSpaceEntries: (spaceId: string, paths: readonly string[]) => Promise<Result<{ deleted: number }>>
  /** Open one file of a space's area with the operating system's application. */
  openSpaceFile: (spaceId: string, path: string) => Promise<Result<{ opened: boolean }>>
  /** Add or replace one uploaded skill. */
  saveSkill: (name: string, markdown: string) => Promise<Result<readonly FaberLoomSkillRow[]>>
  /** Read the full Markdown of one skill for editing. */
  skillMarkdown: (name: string) => Promise<Result<string>>
  /** Remove one uploaded skill. */
  removeSkill: (name: string) => Promise<Result<readonly FaberLoomSkillRow[]>>
  /** List this identity's recorded skill installs. */
  skillInstalls: () => Promise<Result<readonly FaberLoomSkillInstallRow[]>>
  /** Install one harness (a folder or a `.zip`) into the user's own Harness home. */
  installHarness: (
    source: string,
    replace: boolean,
  ) => Promise<Result<FaberLoomHarnessReport>>
  /** Remove one recorded skill install. */
  uninstallSkill: (
    name: string,
    destination: FaberLoomSkillInstallDestination,
  ) => Promise<Result<readonly FaberLoomSkillInstallRow[]>>
  /** Open the directory picker for one harness folder. */
  pickFolder: () => Promise<string | null>
  /** Open the file picker for one harness archive. */
  pickArchive: () => Promise<string | null>
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
  /** Save one mailbox attachment into a space's folder as a real file. */
  saveAttachmentToSpace: (
    spaceId: string,
    uid: string,
    name: string,
  ) => Promise<Result<{ files: readonly { name: string; path: string; bytes: number }[] }>>
  /** Mail one file that lives in a space's folder through the owner's SMTP row. */
  sendSpaceFileByEmail: (
    spaceId: string,
    path: string,
    to: string,
    subject: string,
    text: string,
  ) => Promise<Result<{ messageId: string; accepted: readonly string[] }>>
  /** Turn one email into a Space with its Workspace, memory, and files. */
  spaceFromEmail: (uid: string, name: string, agentId: string | null, from: string | null, spaceId?: string) => void
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
  /** Create a specialist from a proposal, preserving its origin. */
  createAgentFromWork: (text: string, name: string, spaceId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Create a routine draft from a proposal. */
  createRoutineFromWork: (text: string, name: string) => Promise<Result<FaberLoomOverview>>
  /** Preview the audience and material before linking work to a space. */
  linkPreview: (spaceId: string) => Promise<Result<FaberLoomLinkPreview>>
  /** Read one space's editable configuration. */
  spaceDetail: (id: string) => Promise<Result<FaberLoomSpaceDetail | undefined>>
  /** Write one space's harness into its folder: its agents, skills, flows, routines, memory, and context. */
  prepareHarness: (
    id: string,
    title: string,
  ) => Promise<Result<{ root: string; written: readonly string[]; pruned: readonly string[] } | null>>
  /** Save one space's editable configuration. */
  saveSpace: (id: string, input: SpaceSaveInput) => Promise<Result<FaberLoomOverview>>
  /** Read a space's conversation area (its workspace, when registered). */
  spaceWorkspace: (id: string) => Promise<Result<FaberLoomSpaceWorkspace>>
  /** Start a new conversation in a space's own area. */
  startSpaceSession: (spaceId: string) => void
  /** Open one chat session (a local or mirrored Session) in the conversation view. */
  openSession: (sessionId: string) => void
  /** Replace the permissions one grantee holds on a Space, keeping it active. */
  setSpacePermissions: (
    id: string,
    email: string,
    permissions: readonly string[],
  ) => Promise<Result<readonly FaberLoomShareGrantRow[]>>
  /** Read one routine's editable definition. */
  routineDetail: (id: string) => Promise<Result<FaberLoomRoutineDetail | undefined>>
  /** Save one routine's editable definition. */
  saveRoutine: (id: string, input: RoutineSaveInput) => Promise<Result<FaberLoomOverview>>
  /** Remove one routine definition. */
  removeRoutine: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Read one board item's review state. */
  boardDetail: (id: string) => Promise<Result<FaberLoomBoardDetail | undefined>>
  /** The saved views of the signed-in owner. */
  boardViews: () => Promise<Result<readonly FaberLoomBoardView[]>>
  /** Route one field instruction against the item's declared fields (§9.7). */
  boardRouteInstruction: (
    id: string,
    text: string,
  ) => Promise<Result<readonly FaberLoomBoardFieldChange[] | null>>
  /** Classify the items that carry no severity. */
  boardClassify: (limit: number) => Promise<Result<{ classified: number; failed: number; remaining: number }>>
  /** Client names from the MWT.ONE catalog, for the account filter. */
  boardAccounts: () => Promise<Result<readonly string[]>>
  /** Save or replace one named view. */
  boardSaveView: (name: string, filters: FaberLoomBoardViewFilters) => Promise<Result<readonly FaberLoomBoardView[]>>
  /** Remove one named view. */
  boardRemoveView: (name: string) => Promise<Result<readonly FaberLoomBoardView[]>>
  /** Permanently remove one board item from the work table. */
  deleteBoardItem: (id: string) => Promise<Result<FaberLoomOverview>>
  /** Link one board task to the routine that runs it, or unlink it with null. */
  setBoardRoutine: (id: string, routineId: string | null) => Promise<Result<FaberLoomOverview>>
  /** Open a chat session seeded with the work-bench task's context and the assigned agent. */
  openTaskChat: (
    kind: string,
    title: string,
    detail: string,
    agentName?: string | null,
    iteration?: FaberLoomBoardIterationContext,
    cwd?: string,
  ) => void
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
    create: (name: string, spaceId?: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
    remove: (id: string) => Promise<Result<readonly FaberLoomWorkflowRow[]>>
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
    workflowVersions: (id: string) => Promise<Result<readonly FaberLoomWorkflowVersionRow[]>>
    restoreWorkflow: (id: string, version: number) => Promise<Result<FaberLoomWorkflowDetail>>
  }
  /** The Workspace/Space Context surface. */
  context: {
    entries: () => Promise<Result<readonly FaberLoomContextRow[]>>
    create: (title: string, body: string, spaceId?: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    update: (id: string, title: string, body: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    versions: (id: string) => Promise<Result<readonly FaberLoomContextVersionRow[]>>
    restore: (id: string, version: number) => Promise<Result<readonly FaberLoomContextRow[]>>
    approve: (id: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    reject: (id: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    remove: (id: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    export: (spaceId?: string, format?: string) => Promise<Result<FaberLoomContextExportRow>>
    import: (payload: string) => Promise<Result<readonly FaberLoomContextRow[]>>
    replace: (spaceId: string, entriesJson: string) => Promise<Result<readonly FaberLoomContextRow[]>>
  }
  /** The shared Session catalog surface. */
  sessionsShare: {
    list: (spaceId: string) => Promise<Result<readonly FaberLoomSharedSessionRow[]>>
    content: (spaceId: string, ownerId: string, sessionId: string) => Promise<Result<FaberLoomSharedSessionContentRow>>
    remove: (spaceId: string, ownerId: string, sessionId: string) => Promise<Result<readonly FaberLoomSharedSessionRow[]>>
  }
  /** The approval inbox surface. */
  approvals: {
    contextEntries: () => Promise<Result<readonly FaberLoomContextRow[]>>
    syncContext: () => Promise<Result<readonly FaberLoomContextRow[]>>
    workflowChanges: () => Promise<Result<readonly FaberLoomWorkflowPendingRow[]>>
    acceptWorkflow: (id: string) => Promise<Result<readonly FaberLoomWorkflowPendingRow[]>>
    rejectWorkflow: (id: string) => Promise<Result<readonly FaberLoomWorkflowPendingRow[]>>
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
  & PropsRuntime<'main'>
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
  const { useStore, load, usePanelInfo } = props
  const overview = useStore(state => state.overview)
  const status = useStore(state => state.status)
  const error = useStore(state => state.lastError)
  const active = usePanelInfo === undefined ? true : usePanelInfo(info => info.activePanelId !== null)
  useEffect(() => { if (overview === null) load() }, [overview, load])
  // A Workspace added from the sidebar is adopted by the host when the overview
  // is read. Keep the active panel's copy fresh without a full restart.
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { load() }, 5_000)
    return () => { clearInterval(timer) }
  }, [active, load])
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

/** The Agents/Skills tab switch both screens share, so one sidebar row covers both. */
function AgentsSkillsTabs({ t, active, onSelect }: {
  t: ScreenProps['t']
  active: 'agents' | 'skills'
  onSelect: (tab: 'agents' | 'skills') => void
}) {
  return (
    <span className={styles.tools}>
      <button className={active === 'agents' ? styles.primary : styles.secondary} type="button"
        onClick={() => { onSelect('agents') }}>{t('panel.agents.title')}</button>
      <button className={active === 'skills' ? styles.primary : styles.secondary} type="button"
        onClick={() => { onSelect('skills') }}>{t('panel.skills.title')}</button>
    </span>
  )
}

/** Write feedback line, shared by the editors. */
function Feedback({ t, message }: { t: ScreenProps['t']; message: string | null }) {
  if (message === null) return null
  return <StateBlock kind="error" title={t('state.writeError')} text={serverUnavailable(message) ? t('state.serverUnavailable') : message} />
}

/**
 * Whether a failure means the server did not answer the call: a restarting
 * gateway serves an HTML page where the client expects JSON, and a dropped
 * network rejects the request outright. Neither carries a reason worth showing.
 * @param message - the failure text.
 * @returns true for an unavailable server.
 */
function serverUnavailable(message: string): boolean {
  return /Unexpected token '<'|<!DOCTYPE|is not valid JSON|Failed to fetch|NetworkError|ERR_QUIC_PROTOCOL_ERROR/i.test(message)
}

/** One Espacios row with its computed tree position. */
type SpaceTableRow = FaberLoomOverview['spaces'][number] & {
  readonly depth: number
  readonly childCount: number
  /** Another Space of this owner has the same title, so the folder disambiguates it. */
  readonly duplicateTitle: boolean
}

/** Every descendant id under one space, using the already-built child index. */
function descendantSpaceIds(children: ReadonlyMap<string, readonly string[]>, id: string): Set<string> {
  const out = new Set<string>()
  const walk = (parent: string): void => {
    for (const child of children.get(parent) ?? []) {
      if (out.has(child)) continue
      out.add(child)
      walk(child)
    }
  }
  walk(id)
  return out
}

/** Espacios: list, create, and rename. */
function spacesScreen() {
  return function FaberloomSpaces(props: ScreenProps) {
    const {
      t, createSpace, createSpaceFromFolder, deleteSpace, goToWorkspace, adoptSpaceWorkspace, exportContextToFolder,
      spaceDetail, saveSpace, spaceWorkspace, startSpaceSession, prepareHarness,
      sessionsShare, openSession, setSpacePermissions, workflows, pickFolder,
    } = props
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
    const [spacePrompt, setSpacePrompt] = useState('')
    const [parentId, setParentId] = useState('')
    const [parentDraft, setParentDraft] = useState('')
    const [newInherit, setNewInherit] = useState(true)
    const [creating, setCreating] = useState(false)
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
    const [shared, setShared] = useState<readonly FaberLoomSharedSessionRow[]>([])
    const [grants, setGrants] = useState<readonly FaberLoomShareGrantRow[]>([])
    const [grantOpen, setGrantOpen] = useState(false)
    const [grantEmail, setGrantEmail] = useState('')
    const [grantPermissions, setGrantPermissions] = useState<readonly string[]>([])
    const agents = useMemo(() => (overview?.agents ?? []).filter(agent => agent.active), [overview])
    const spaceList = useMemo(() => uniqueSpaces(overview?.spaces ?? []), [overview])
    const byId = useMemo(() => new Map(spaceList.map(space => [space.id, space])), [spaceList])
    const children = useMemo(() => {
      const map = new Map<string, string[]>()
      for (const space of spaceList) {
        if (space.parentId === null || !byId.has(space.parentId)) continue
        const list = map.get(space.parentId) ?? []
        list.push(space.id)
        map.set(space.parentId, list)
      }
      return map
    }, [spaceList, byId])
    const rows = useMemo(() => {
      const needle = query.trim().toLowerCase()
      const titleCounts = new Map<string, number>()
      for (const space of spaceList) {
        const key = space.title.trim().toLowerCase()
        titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
      }
      const keep = new Set<string>()
      if (needle.length > 0) {
        const mark = (id: string): void => {
          if (keep.has(id)) return
          keep.add(id)
          const space = byId.get(id)
          if (space?.parentId !== null && space?.parentId !== undefined) mark(space.parentId)
        }
        for (const space of spaceList) {
          if (!space.title.toLowerCase().includes(needle)) continue
          mark(space.id)
          for (const child of descendantSpaceIds(children, space.id)) keep.add(child)
        }
      }
      const out: SpaceTableRow[] = []
      const visit = (id: string, depth: number): void => {
        const space = byId.get(id)
        if (space === undefined) return
        const childIds = children.get(id) ?? []
        // The caller only visits a child after its parent is expanded; this
        // node's own expansion controls its children, not its own visibility.
        if (needle.length > 0 && !keep.has(id)) return
        out.push({
          ...space,
          depth,
          childCount: childIds.length,
          duplicateTitle: (titleCounts.get(space.title.trim().toLowerCase()) ?? 0) > 1,
        })
        if (needle.length > 0 || expanded.has(id)) {
          for (const child of childIds) visit(child, depth + 1)
        }
      }
      for (const space of spaceList) {
        if (space.parentId === null || !byId.has(space.parentId)) visit(space.id, 0)
      }
      return out
    }, [query, spaceList, byId, children, expanded])
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
      setParentDraft(detail.value.parentId ?? '')
      setInherit(detail.value.inheritContext)
      setMembers(detail.value.members.join(', '))
      setSpaceAgentId(detail.value.agentId ?? '')
      setSpacePrompt(detail.value.prompt)
      setMessage(null)
    }, [detail])

    // The Space's shared Sessions refresh with the selection and after each sync.
    useEffect(() => {
      if (selected === null) { setShared([]); return }
      void sessionsShare.list(selected).then((result) => { if (result.ok) setShared(result.value) })
    }, [selected, sessionsShare])

    // The Space's outgoing grants refresh with the selection and after each edit.
    useEffect(() => {
      if (selected === null) { setGrants([]); return }
      void workflows.resourceShares('space', selected).then((result) => { if (result.ok) setGrants(result.value) })
    }, [selected, workflows])

    /** Open one shared Session as the chat view, following its mirrored local copy. */
    const openShared = (session: FaberLoomSharedSessionRow): void => { openSession(session.sessionId) }

    /** Open the module-permission editor for one identity the Space is shared with. */
    const editGrant = (grant: FaberLoomShareGrantRow): void => {
      setGrantEmail(grant.granteeEmail)
      setGrantPermissions(grant.permissions)
      setGrantOpen(true)
    }

    /** Toggle one permission in the Space permission editor. */
    const toggleGrantPermission = (permission: string): void => {
      setGrantPermissions(current => current.includes(permission)
        ? current.filter(value => value !== permission)
        : [...current, permission])
    }

    /** Save one grantee's module permissions, keeping the grant active. */
    const saveGrant = (): void => {
      if (selected === null || grantEmail.trim().length === 0) return
      void setSpacePermissions(selected, grantEmail.trim(), grantPermissions).then((result) => {
        if (result.ok) { setGrants(result.value); setGrantOpen(false); setMessage(null) } else setMessage(result.error.message)
      })
    }

    /** Revoke one grantee's access, so the Space no longer appears for them. */
    const removeGrant = (grantId: string): void => {
      void workflows.revokeShareGrant(grantId).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (selected === null) return
        void workflows.resourceShares('space', selected).then((refreshed) => {
          if (refreshed.ok) setGrants(refreshed.value)
        })
      })
    }

    /** Drop one shared Session (its author or this Space's owner). */
    const removeShared = (session: FaberLoomSharedSessionRow): void => {
      void sessionsShare.remove(session.spaceId, session.ownerId, session.sessionId).then((result) => {
        if (result.ok) setShared(result.value)
      })
    }

    const columns: readonly Column<SpaceTableRow>[] = [
      {
        key: 'title',
        header: t('col.name'),
        cell: space => (
          <span className={styles.spaceTitle} style={{ paddingLeft: `${space.depth * 20}px` }}>
            {space.childCount === 0
              ? <span className={styles.spaceToggleSpacer} aria-hidden="true" />
              : (
                <button
                  className={styles.spaceToggle}
                  type="button"
                  aria-label={t('spaces.toggleChildren')}
                  aria-expanded={expanded.has(space.id)}
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(space.id)) next.delete(space.id)
                      else next.add(space.id)
                      return next
                    })
                  }}
                >
                  <IconChevronRightOutline14 className={expanded.has(space.id) ? styles.caretOpen : undefined} />
                </button>
              )}
            {space.depth > 0 && <span className={styles.spaceBranch} aria-hidden="true">↳</span>}
            <button className={styles.cellLink} type="button" title={space.folderPath}
              onClick={(event) => { event.stopPropagation(); goToWorkspace(space.id) }}>{space.title}</button>
            {space.duplicateTitle && (
              <span className={styles.cellMuted}> · {space.folderPath.split(/[\\/]/u).filter(Boolean).pop() ?? ''}</span>
            )}
          </span>
        ),
      },
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

    /** Adopt an existing local folder as a new root space, without creating a folder. */
    const createFromFolder = (): void => {
      setMessage(null)
      void pickFolder().then(async (path) => {
        if (path === null) return
        const name = path.split(/[\\/]/u).filter(part => part.length > 0).pop() ?? t('spaces.untitled')
        const result = await createSpaceFromFolder(name, path, null)
        if (!result.ok) setMessage(result.error.message)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
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
            <button className={styles.secondary} type="button" onClick={createFromFolder}>{t('spaces.fromFolderNew')}</button>
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
                      parentId: parentDraft.length === 0 ? null : parentDraft,
                      inheritContext: inherit,
                      members: members.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0),
                      agentId: spaceAgentId.length === 0 ? null : spaceAgentId,
                      prompt: spacePrompt,
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
                        <Field label={t('field.parent')} hint={t('spaces.moveHint')}>
                          <select value={parentDraft} onChange={(event) => { setParentDraft(event.target.value) }}>
                            <option value="">{t('spaces.noParent')}</option>
                            {spaceList
                              .filter(space => space.id !== selected && !descendantSpaceIds(children, selected ?? '').has(space.id))
                              .map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
                          </select>
                        </Field>
                        <Field label={t('spaces.folder')}>
                          <span className={styles.cellMuted}>{spaceList.find(space => space.id === selected)?.folderPath ?? ''}</span>
                        </Field>
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
                        <Field label={t('field.prompt')} hint={t('spaces.promptHint')}>
                          <textarea value={spacePrompt} onChange={(event) => { setSpacePrompt(event.target.value) }} />
                        </Field>
                        <Field label={t('spaces.conversations')} hint={t('spaces.workspaceHint')}>
                          {workspace.kind === 'loading'
                            ? <span className={styles.cellMuted}>{t('state.loading')}</span>
                            : workspace.kind !== 'ready' || workspace.value === undefined || !workspace.value.registered
                              ? <span className={styles.cellMuted}>{t('spaces.noWorkspace')}</span>
                              : <span className={styles.cellMuted}>{`${workspace.value.title ?? ''} · ${String(workspace.value.sessions)}`}</span>}
                          <span className={styles.tools}>
                            <button className={styles.secondary} type="button" disabled={detailValue === undefined} onClick={() => { if (detailValue !== undefined) startSpaceSession(detailValue.id) }}>{t('spaces.newInSpace')}</button>
                            <button className={styles.secondary} type="button" disabled={detailValue === undefined} onClick={() => { if (detailValue !== undefined) adoptSpaceWorkspace(detailValue.id) }}>{t('spaces.fromFolder')}</button>
                            <button className={styles.secondary} type="button" disabled={detailValue === undefined} onClick={() => {
                              if (detailValue === undefined) return
                              void exportContextToFolder(detailValue.id).then((result) => {
                                setMessage(result.ok ? `${t('spaces.exportedTo')} ${result.value.path}` : result.error.message)
                              }).catch((error: unknown) => { setMessage(String(error)) })
                            }}>{t('spaces.export')}</button>
                            <button className={styles.secondary} type="button" disabled={detailValue === undefined} onClick={() => {
                              if (detailValue === undefined) return
                              void prepareHarness(detailValue.id, detailValue.title).then((result) => {
                                if (!result.ok) { setMessage(result.error.message); return }
                                setMessage(result.value === null
                                  ? t('spaces.harnessUnavailable')
                                  : `${t('spaces.harnessReady')} ${result.value.root}`)
                              }).catch((error: unknown) => { setMessage(String(error)) })
                            }}>{t('spaces.harness')}</button>
                          </span>
                        </Field>
                        <Field label={t('spaces.sharedSessions')} hint={t('spaces.sharedSessionsHint')}>
                          {shared.length === 0
                            ? <span className={styles.cellMuted}>{t('spaces.noSharedSessions')}</span>
                            : shared.map(session => (
                              <div key={`${session.ownerId}:${session.sessionId}`} className={styles.grid2}>
                                <span className={styles.cellMuted}>
                                  {session.title} · {session.ownerId} · {String(session.messageCount)}
                                </span>
                                <span className={styles.tools}>
                                  <button className={styles.ghost} type="button" onClick={() => { openShared(session) }}>{t('spaces.viewSession')}</button>
                                  <button className={styles.ghost} type="button" onClick={() => { removeShared(session) }}>{t('action.delete')}</button>
                                </span>
                              </div>
                            ))}
                        </Field>
                        <Field label={t('spaces.sharedWith')} hint={t('spaces.sharedWithHint')}>
                          {grants.length === 0
                            ? <span className={styles.cellMuted}>{t('spaces.noSharedWith')}</span>
                            : grants.map(grant => (
                              <div key={grant.id} className={styles.grid2}>
                                <span className={styles.cellMuted}>{grant.granteeEmail} · {grant.permissions.map(permission => sharePermissionLabel(t, permission)).join(', ')}</span>
                                <span className={styles.tools}>
                                  <button className={styles.ghost} type="button" title={t('spaces.editPermissions')}
                                    onClick={() => { editGrant(grant) }}><span aria-hidden="true">✎</span></button>
                                  <button className={styles.ghost} type="button" title={t('action.delete')}
                                    onClick={() => { removeGrant(grant.id) }}><span aria-hidden="true">✕</span></button>
                                </span>
                              </div>
                            ))}
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
        <Modal open={grantOpen} onClose={() => { setGrantOpen(false) }} title={t('spaces.editPermissions')} closeLabel={t('action.close')}
          className={styles.shareDialogWide ?? ''}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setGrantOpen(false) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={saveGrant}>{t('action.save')}</button>
            </>
          )}>
          <Field label={t('wf.share.email')}><span className={styles.cellMuted}>{grantEmail}</span></Field>
          <Field label={t('wf.share.permissions')}>
            <div className={styles.workflowPermissions}>
              {SPACE_SHARE_PERMISSION_OPTIONS.map(permission => (
                <label key={permission} className={`${styles.workflowPermission} ${grantPermissions.includes(permission) ? styles.workflowPermissionOn : ''}`}>
                  <input type="checkbox" checked={grantPermissions.includes(permission)}
                    onChange={() => { toggleGrantPermission(permission) }} />
                  {sharePermissionLabel(t, permission)}
                </label>
              ))}
            </div>
          </Field>
        </Modal>
      </Screen>
    )
  }
}

/** Agentes: table plus the full editor. */
function agentsScreen() {
  return function FaberloomAgents(props: ScreenProps & { tabs?: ReactNode }) {
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
            {props.tabs}
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

/** Compact mailbox date: `21/10/2026 1:19 pm`. */
function emailDate(value: string | null): string {
  if (value === null || value.length === 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace('AM', 'am')
    .replace('PM', 'pm')
  return `${datePart} ${timePart}`
}

/** Last inbox page kept across panel mounts, so re-entering Correo is instant. */
let emailInboxCache: { readonly rows: readonly FaberLoomInboxRow[]; readonly at: number } = { rows: [], at: 0 }
const EMAIL_INBOX_CACHE_MS = 60_000

/** Correo: the mailbox envelopes and the drafts awaiting approval. */
function emailScreen() {
  return function FaberloomEmail(props: ScreenProps) {
    const {
      t, emailInbox, emailRead, emailAttachment, sendSpaceFileByEmail, emailMarkSeen, emailTrash, emailDrafts,
      saveEmailDraft, deleteEmailDraft, sendEmailDraft,
      emailVoice, emailDraftWithAi, emailPolicy, saveEmailPolicy, spaceFromEmail, routineChat, routineFromEmail,
      openRoutines, learnFromEmail, startConversation,
    } = props
    const { overview } = useOverview(props)
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
    const [sendSpaceId, setSendSpaceId] = useState('')
    const [sendFilePath, setSendFilePath] = useState('')
    const [spaceOpen, setSpaceOpen] = useState(false)
    const [spaceName, setSpaceName] = useState('')
    const [spaceTarget, setSpaceTarget] = useState('__new__')
    const [routineOpen, setRoutineOpen] = useState(false)
    const [routineMessages, setRoutineMessages] = useState<readonly FaberLoomRoutineChatMessage[]>([])
    const [routineInput, setRoutineInput] = useState('')
    const [routineBusy, setRoutineBusy] = useState(false)
    const [routineCreated, setRoutineCreated] = useState<FaberLoomRoutineCreated | null>(null)
    const [inboxRows, setInboxRows] = useState<readonly FaberLoomInboxRow[]>(() => emailInboxCache.rows)
    const [inboxState, setInboxState] = useState<'loading' | 'ready' | 'error'>(() => emailInboxCache.rows.length > 0 ? 'ready' : 'loading')
    const [inboxError, setInboxError] = useState<string | null>(null)
    const inboxRead = useRef(emailInbox)
    inboxRead.current = emailInbox
    useEffect(() => {
      const cached = emailInboxCache.rows.length > 0 && Date.now() - emailInboxCache.at < EMAIL_INBOX_CACHE_MS
      if (reload === 0 && cached) {
        setInboxRows(emailInboxCache.rows)
        setInboxState('ready')
        return
      }
      let live = true
      if (inboxRows.length === 0) setInboxState('loading')
      setInboxError(null)
      void inboxRead.current().then((result) => {
        if (!live) return
        if (!result.ok) {
          setInboxState(inboxRows.length === 0 ? 'error' : 'ready')
          setInboxError(result.error.message)
          return
        }
        emailInboxCache = { rows: result.value, at: Date.now() }
        setInboxRows(result.value)
        setInboxState('ready')
      }).catch((cause: unknown) => {
        if (!live) return
        setInboxState(inboxRows.length === 0 ? 'error' : 'ready')
        setInboxError(String(cause))
      })
      return () => { live = false }
    }, [reload])
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
        ? Promise.resolve({ ok: true as const, value: { account: null, text: '', html: null, attachments: [] } })
        : emailRead(selected),
      [selected, mode],
    )
    const [inlineHtml, setInlineHtml] = useState<string | null>(null)
    const attachmentRead = useRef(emailAttachment)
    attachmentRead.current = emailAttachment
    useEffect(() => {
      if (mailBody.kind !== 'ready' || mailBody.value.html === null || selected === null) {
        setInlineHtml(null)
        return
      }
      let live = true
      const html = mailBody.value.html
      const inline = mailBody.value.attachments
        .map((attachment, index) => ({ attachment, index }))
        .filter(entry => entry.attachment.contentId !== undefined)
      if (inline.length === 0) {
        setInlineHtml(html)
        return
      }
      void Promise.all(inline.map(async ({ attachment, index }) => {
        const result = await attachmentRead.current(selected, index)
        return result.ok && result.value !== undefined && attachment.contentId !== undefined
          ? { id: attachment.contentId, url: `data:${result.value.mediaType};base64,${result.value.contentBase64}` }
          : undefined
      })).then((images) => {
        if (!live) return
        let next = html
        for (const image of images) {
          if (image === undefined) continue
          next = next.replaceAll(`cid:${image.id}`, image.url).replaceAll(`CID:${image.id}`, image.url)
        }
        setInlineHtml(/<meta[^>]+charset=/iu.test(next) ? next : `<meta charset="utf-8">${next}`)
      }).catch(() => { if (live) setInlineHtml(html) })
      return () => { live = false }
    }, [mailBody, selected])
    const [attachmentUrls, setAttachmentUrls] = useState<Readonly<Record<number, string>>>({})
    const attachmentTrack = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      if (mailBody.kind !== 'ready' || selected === null) { setAttachmentUrls({}); return }
      let live = true
      const candidates = mailBody.value.attachments
        .map((attachment, index) => ({ attachment, index }))
        .filter(({ attachment }) => attachment.size <= 8_000_000 && /^(image|video)\/|application\/pdf/iu.test(attachment.mediaType))
      void Promise.all(candidates.map(async ({ index }) => {
        const result = await attachmentRead.current(selected, index)
        if (!result.ok || result.value === undefined) return undefined
        const url = `data:${result.value.mediaType};base64,${result.value.contentBase64}`
        return [index, url] as const
      })).then((entries) => {
        if (!live) return
        setAttachmentUrls(Object.fromEntries(entries.filter((entry): entry is readonly [number, string] => entry !== undefined)))
      }).catch(() => { if (live) setAttachmentUrls({}) })
      return () => { live = false }
    }, [mailBody, selected])

    /** Move the attachment strip one card at a time. */
    const scrollAttachments = (direction: -1 | 1): void => {
      attachmentTrack.current?.scrollBy({ left: direction * 236, behavior: 'smooth' })
    }

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
    /** Mail one file that lives in the chosen space's folder. */
    const sendSpaceFile = (): void => {
      setMessage(null)
      void sendSpaceFileByEmail(sendSpaceId, sendFilePath.trim(), to, subject, body).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setComposing(false)
        setReload(value => value + 1)
        setMessage(`${t('email.sentFile')} ${result.value.messageId}`)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }
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

    /** Open the Space picker for one email, presetting a new Space title. */
    const openSpaceFor = (mail: FaberLoomInboxRow): void => {
      setSelected(mail.id)
      setComposing(false)
      setSpaceName(mail.subject ?? '')
      setSpaceTarget('__new__')
      setSpaceOpen(true)
    }

    /** Open the "turn this email into a Space" dialog for the selected email. */
    const openSpace = (): void => {
      if (chosenMail === null) return
      openSpaceFor(chosenMail)
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

    const markRead = (mail: FaberLoomInboxRow): void => {
      setMessage(null)
      void emailMarkSeen(mail.id).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setMessage(t('email.markedRead'))
        setReload(value => value + 1)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const trashMail = (mail: FaberLoomInboxRow): void => {
      setMessage(null)
      void emailTrash(mail.id, mail.from ?? undefined, mail.subject ?? undefined).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        const next = inboxRows.filter(row => row.id !== mail.id)
        setInboxRows(next)
        emailInboxCache = { rows: next, at: Date.now() }
        if (selected === mail.id) setSelected(null)
      }).catch((cause: unknown) => { setMessage(String(cause)) })
    }

    const columns: readonly Column<{ id: string }>[] = mode === 'inbox'
      ? [
        {
          key: 'from',
          header: t('col.from'),
          width: 245,
          cell: row => (
            <span className={styles.mailFrom}>
              <span className={styles.cellName}>{(row as FaberLoomInboxRow).from ?? t('cell.none')}</span>
              {(row as FaberLoomInboxRow).account === null
                ? null
                : <span className={styles.mailAccount}>{(row as FaberLoomInboxRow).account}</span>}
            </span>
          ),
        },
        { key: 'subject', header: t('col.subject'), cell: row => <span className={styles.mailSubject}>{(row as FaberLoomInboxRow).subject ?? t('cell.none')}</span> },
        { key: 'date', header: t('col.date'), width: 148, cell: row => <span className={styles.cellData}>{emailDate((row as FaberLoomInboxRow).date)}</span> },
        {
          key: 'actions',
          header: t('col.actions'),
          width: 112,
          cell: (row) => {
            const mail = row as FaberLoomInboxRow
            return (
              <span className={styles.mailActions} onClick={(event) => { event.stopPropagation() }}>
                <button type="button" className={styles.mailAction} title={t('email.markRead')} aria-label={`${t('email.markRead')} ${mail.from ?? ''}`} onClick={() => { markRead(mail) }}>
                  <IconCheckOutline16 size={15} />
                </button>
                <button type="button" className={styles.mailAction} title={t('email.toSpace')} aria-label={`${t('email.toSpace')} ${mail.from ?? ''}`} onClick={() => { openSpaceFor(mail) }}>
                  <FlIconSpaceloom size={15} />
                </button>
                <button type="button" className={styles.mailActionDanger} title={t('email.trash')} aria-label={`${t('email.trash')} ${mail.from ?? ''}`} onClick={() => { trashMail(mail) }}>
                  <IconTrashOutline16 size={15} />
                </button>
              </span>
            )
          },
        },
      ]
      : [
        { key: 'to', header: t('col.to'), cell: row => <span className={styles.cellName}>{(row as FaberLoomEmailDraftRow).to.join(', ')}</span> },
        { key: 'subject', header: t('col.subject'), cell: row => <span className={styles.mailSubject}>{(row as FaberLoomEmailDraftRow).subject}</span> },
        { key: 'status', header: t('col.status'), cell: row => <Chip>{(row as FaberLoomEmailDraftRow).status}</Chip> },
      ]

    const spaceOptions = useMemo(() => uniqueSpaces(overview?.spaces ?? []), [overview])

    const spaceLabel = (space: FaberLoomOverview['spaces'][number]): string => {
      const byId = new Map((overview?.spaces ?? []).map(candidate => [candidate.id, candidate]))
      let depth = 0
      let parent = space.parentId
      while (parent !== null) {
        const parentSpace = byId.get(parent)
        if (parentSpace === undefined) break
        depth += 1
        parent = parentSpace.parentId
      }
      return `${'— '.repeat(depth)}${space.title}`
    }

    const tableState = mode === 'inbox'
      ? { kind: inboxState, message: inboxError ?? '' }
      : drafts

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
              <button className={styles.secondary} type="button" title={t('learn.hint')} onClick={learn}>{t('learn.button')}</button>
              <button className={styles.primary} type="button" onClick={() => { if (chosenMail !== null) openCompose(chosenMail) }}>{t('email.reply')}</button>
            </>
          )}>
          <Field label={t('col.from')}><span className={styles.cellMuted}>{chosenMail?.from ?? t('cell.none')}</span></Field>
          <Field label={t('field.to')}><span className={styles.cellMuted}>{chosenMail?.account ?? (mailBody.kind === 'ready' ? mailBody.value.account : null) ?? t('cell.none')}</span></Field>
          <Field label={t('col.date')}><span className={styles.cellMuted}>{emailDate(chosenMail?.date ?? null)}</span></Field>
          {mailBody.kind === 'ready' && mailBody.value.attachments.length > 0
            ? (
              <Field label={t('field.attachments')} hint={t('email.saveHint')}>
                <div className={styles.mailAttachmentCarousel}>
                  <button className={styles.mailCarouselArrow} type="button" aria-label={t('email.previousAttachment')} onClick={() => { scrollAttachments(-1) }}>‹</button>
                  <div className={styles.mailAttachmentTrack} ref={attachmentTrack}>
                    {mailBody.value.attachments.map((attachment, index) => {
                      const url = attachmentUrls[index]
                      const image = attachment.mediaType.startsWith('image/')
                      const video = attachment.mediaType.startsWith('video/')
                      const pdf = attachment.mediaType === 'application/pdf'
                      return (
                        <div className={styles.mailAttachmentCard} key={`${attachment.name}-${String(index)}`}>
                          <button className={styles.mailAttachmentPreview} type="button" title={attachment.name}
                            onClick={() => { downloadAttachment(selected ?? '', index, attachment.name) }}>
                            {url !== undefined && image
                              ? <img src={url} alt={attachment.name} />
                              : url !== undefined && video
                                ? <video src={url} muted preload="metadata" />
                                : url !== undefined && pdf
                                  ? <embed src={url} type="application/pdf" />
                                  : (
                                    <span className={styles.mailAttachmentIcon}>
                                      <FileTypeIcon kind={fileIconKind(attachment.name)} size={30} />
                                      <span>{attachment.name.split('.').pop()?.toUpperCase() ?? ''}</span>
                                    </span>
                                  )}
                          </button>
                          <span className={styles.mailAttachmentName} title={attachment.name}>{attachment.name}</span>
                          <span className={styles.mailAttachmentMeta}>{sizeLabel(attachment.size)}</span>
                        </div>
                      )
                    })}
                  </div>
                  <button className={styles.mailCarouselArrow} type="button" aria-label={t('email.nextAttachment')} onClick={() => { scrollAttachments(1) }}>›</button>
                </div>
              </Field>
            )
            : null}
          <Field label={t('field.body')}>
            {mailBody.kind === 'loading'
              ? <span className={styles.cellMuted}>{t('state.loading')}</span>
              : mailBody.kind === 'error'
                ? <span className={styles.cellMuted}>{mailBody.message}</span>
                : mailBody.value.html !== null
                  ? <iframe className={styles.emailHtml} sandbox="" referrerPolicy="no-referrer" srcDoc={inlineHtml ?? mailBody.value.html} title={t('field.body')} />
                  : <textarea className={styles.emailBody} readOnly value={mailBody.value.text.length === 0 ? t('email.noBody') : mailBody.value.text} />}
          </Field>
        </Modal>
        <Modal open={spaceOpen} onClose={() => { setSpaceOpen(false) }} title={t('email.toSpace')} closeLabel={t('action.close')}
          className={String(styles.emailModal)} contentClassName={String(styles.emailModalContent)}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setSpaceOpen(false) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={() => {
                setMessage(null)
                spaceFromEmail(
                  selected ?? '',
                  spaceTarget === '__new__' ? spaceName.trim() : '',
                  null,
                  chosenMail?.from ?? null,
                  spaceTarget === '__new__' ? undefined : spaceTarget,
                )
                setSpaceOpen(false)
                setSelected(null)
              }}>{spaceTarget === '__new__' ? t('action.create') : t('action.add')}</button>
            </>
          )}>
          <Field label={t('email.spaceTarget')} hint={t('email.spaceTargetHint')}>
            <select value={spaceTarget} onChange={(event) => { setSpaceTarget(event.target.value) }}>
              <option value="__new__">{t('email.newSpace')}</option>
              {spaceOptions.map(space => <option key={space.id} value={space.id}>{spaceLabel(space)}</option>)}
            </select>
          </Field>
          {spaceTarget === '__new__' && (
            <Field label={t('email.spaceName')}>
              <input type="text" autoComplete="off" value={spaceName} onChange={(event) => { setSpaceName(event.target.value) }} />
            </Field>
          )}
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
          <Field label={t('field.attachments')} hint={t('email.sendFileHint')}>
            <input type="file" multiple onChange={(event) => { onFiles(event.target.files) }} />
            {attachments.length === 0 ? null : <span className={styles.cellMuted}>{attachments.join(', ')}</span>}
            <div className={styles.grid2}>
              <select value={sendSpaceId} onChange={(event) => { setSendSpaceId(event.target.value) }} aria-label={t('email.saveTarget')}>
                <option value="">{t('email.saveTargetNone')}</option>
                {(overview?.spaces ?? []).map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
              </select>
              <input type="text" autoComplete="off" value={sendFilePath} placeholder={t('email.sendFilePath')}
                aria-label={t('email.sendFilePath')} onChange={(event) => { setSendFilePath(event.target.value) }} />
            </div>
            <span className={styles.tools}>
              <button className={styles.secondary} type="button"
                disabled={sendSpaceId.length === 0 || sendFilePath.trim().length === 0}
                onClick={sendSpaceFile}>
                {t('email.sendFileAction')}
              </button>
            </span>
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

/** Runs shown before the list asks to show more. */
const RUNS_PAGE = 10

/** The status label key for each execution status token; an unknown token shows verbatim. */
const RUN_STATUS_KEY: Readonly<Record<string, FaberloomKey>> = {
  running: 'runs.status.running',
  waiting: 'runs.status.waiting',
  completed: 'runs.status.completed',
  failed: 'runs.status.failed',
  needs_review: 'runs.status.review',
}

/** The step status label key for each step status token. */
const STEP_STATUS_KEY: Readonly<Record<string, FaberloomKey>> = {
  pending: 'runs.step.pending',
  running: 'runs.status.running',
  waiting: 'runs.status.waiting',
  completed: 'runs.step.done',
  failed: 'runs.status.failed',
  skipped: 'runs.step.skipped',
}

/**
 * Read a run failure in plain language. The engine records the cause as a raw
 * message (an id that no longer resolves, a provider's JSON error); the list
 * names the cause and keeps the raw text behind the details toggle.
 * @param text - the recorded reason or step text.
 * @returns the locale key for the known cause, or null when the text reads as is.
 */
function runProblemKey(text: string | null): FaberloomKey | null {
  if (text === null) return null
  if (/routine\s+\S+\s+version\s+\d+\s+not found/i.test(text)) return 'runs.problem.version'
  if (/agent\s+\S+\s+not found/i.test(text)) return 'runs.problem.agent'
  if (/insufficient balance|RESOURCE_EXHAUSTED|"code":\s*(429|402)|\bQUOTA\b|exceeded your current quota/i.test(text)) return 'runs.problem.quota'
  return null
}

/** One line of a step text: the first non-empty line without Markdown emphasis markers. */
function firstLine(text: string): string {
  const line = text.split('\n').map(value => value.trim()).find(value => value.length > 0) ?? ''
  return line.replace(/^#+\s*/, '').replace(/\*\*/g, '')
}

/**
 * The executions of one routine, newest first: what started each run, when,
 * how far it got, and what it concluded. Steps and the reconcile/cancel actions
 * sit behind a per-run details toggle.
 */
function RoutineRuns(props: {
  readonly t: ScreenProps['t']
  readonly runs: readonly FaberLoomExecutionRow[]
  readonly onReconcile: (runId: string) => void
  readonly onCancelEffect: (runId: string, stepId: string) => void
}) {
  const { t, runs, onReconcile, onCancelEffect } = props
  const [limit, setLimit] = useState(RUNS_PAGE)
  const ordered = useMemo(() => [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [runs])
  if (ordered.length === 0) return <span className={styles.cellMuted}>{t('routines.noExecutions')}</span>
  return (
    <div className={styles.runList}>
      {ordered.slice(0, limit).map((run) => {
        const statusKey = RUN_STATUS_KEY[run.status]
        const withText = [...run.steps].reverse().find(step => step.text !== null || step.reason !== null)
        const raw = run.reason ?? withText?.reason ?? withText?.text ?? null
        const problem = runProblemKey(run.reason) ?? runProblemKey(withText?.reason ?? null) ?? runProblemKey(withText?.text ?? null)
        const summary = withText?.text === null || withText?.text === undefined ? null : firstLine(withText.text)
        const when = new Date(run.createdAt)
        const reviewable = run.status === 'needs_review' || run.status === 'failed' || run.status === 'waiting'
        return (
          <article className={styles.runCard} key={run.id} data-status={run.status}>
            <header className={styles.runHead}>
              <span className={styles.runStatus}>{statusKey === undefined ? run.status : t(statusKey)}</span>
              <time className={styles.runMeta} dateTime={run.createdAt} title={run.createdAt}>
                {Number.isNaN(when.getTime()) ? run.createdAt : when.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </time>
              <span className={styles.runMeta}>
                {t('runs.progress').replace('{done}', String(run.doneSteps)).replace('{total}', String(run.totalSteps))}
                {` · ${t('routines.versionShort')}${String(run.routineVersion)}`}
              </span>
            </header>
            {run.event?.subject === null || run.event?.subject === undefined || run.event.subject.length === 0
              ? null
              : <p className={styles.runSubject} title={run.event.subject}>{run.event.subject}</p>}
            {problem !== null
              ? <p className={styles.runProblem}>{t(problem)}</p>
              : run.waitingFor !== null
                ? <p className={styles.runSummary}>{t('runs.waitingFor').replace('{what}', run.waitingFor)}</p>
                : summary === null || summary.length === 0 ? null : <p className={styles.runSummary}>{summary}</p>}
            <details className={styles.runDetails}>
              <summary>{t('runs.details')}</summary>
              <ol className={styles.runSteps}>
                {run.steps.map((step) => {
                  const stepKey = STEP_STATUS_KEY[step.status]
                  const body = step.text ?? step.reason
                  return (
                    <li key={step.id}>
                      <div className={styles.runStepHead}>
                        <span className={styles.runStepId}>{step.id}</span>
                        <span className={styles.runMeta}>{stepKey === undefined ? step.status : t(stepKey)}</span>
                        {step.effect && step.status === 'completed'
                          ? <button className={styles.ghost} type="button" onClick={() => { onCancelEffect(run.id, step.id) }}>{t('routines.cancelEffect')}</button>
                          : null}
                      </div>
                      {body === null ? null : <pre className={styles.runStepText}>{body}</pre>}
                    </li>
                  )
                })}
              </ol>
              {problem !== null && raw !== null && !run.steps.some(step => (step.text ?? step.reason) === raw)
                ? <pre className={styles.runStepText}>{raw}</pre>
                : null}
              {reviewable
                ? <button className={styles.secondary} type="button" onClick={() => { onReconcile(run.id) }}>{t('routines.reconcile')}</button>
                : null}
            </details>
          </article>
        )
      })}
      {ordered.length <= limit ? null : (
        <button className={styles.ghost} type="button" onClick={() => { setLimit(limit + RUNS_PAGE) }}>
          {t('runs.more').replace('{count}', String(ordered.length - limit))}
        </button>
      )}
    </div>
  )
}

/**
 * The origin label of one skill row.
 * @param row - the skill row.
 * @returns the locale key naming where the version the owner sees comes from.
 */
function skillOriginKey(row: FaberLoomSkillRow): FaberloomKey {
  if (row.origin === 'global') return 'skills.global'
  if (row.replacesCatalog) return 'skills.ownCopy'
  if (row.origin === 'owner') return 'skills.own'
  if (row.origin === 'shared') return 'skills.shared'
  if (row.origin === 'incoming') return 'skills.incoming'
  return 'skills.role'
}

/** Skills: the role catalog plus the owner's uploads. */
function skillsScreen() {
  return function FaberloomSkills(props: ScreenProps & { tabs?: ReactNode; refresh?: number }) {
    const { t, skills, saveSkill, skillMarkdown, removeSkill, shareSkill, shares, unshareShare, refresh } = props
    const [list, setList] = useState<readonly FaberLoomSkillRow[] | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [moduleFilter, setModuleFilter] = useState('')
    const [selected, setSelected] = useState<string | null>(null)
    // The skill being edited: null when the modal shows the read-only detail,
    // 'loading' while its Markdown arrives, otherwise the draft text.
    const [draft, setDraft] = useState<string | null>(null)
    const [draftLoading, setDraftLoading] = useState(false)
    const [draftSaving, setDraftSaving] = useState(false)
    const [draftError, setDraftError] = useState<string | null>(null)
    const select = (name: string | null): void => {
      setSelected(name)
      setDraft(null)
      setDraftError(null)
    }
    const startEdit = (name: string): void => {
      setDraftLoading(true)
      setDraftError(null)
      void skillMarkdown(name)
        .then((result) => {
          if (result.ok) setDraft(result.value)
          else setDraftError(result.error.message)
        })
        .catch((cause: unknown) => { setDraftError(String(cause)) })
        .finally(() => { setDraftLoading(false) })
    }
    const saveDraft = (name: string, markdown: string): void => {
      setDraftSaving(true)
      setDraftError(null)
      void saveSkill(name, markdown)
        .then((result) => {
          if (!result.ok) { setDraftError(result.error.message); return }
          setList(result.value)
          setDraft(null)
        })
        .catch((cause: unknown) => { setDraftError(String(cause)) })
        .finally(() => { setDraftSaving(false) })
    }
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
    }, [refresh])

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
      { key: 'module', header: t('col.module'), cell: skill => <span className={styles.cellMuted}>{skill.module ?? t('cell.none')}{skill.action === null ? '' : ` · ${skill.action}`}</span> },
    ]

    return (
      <Screen title={t('panel.skills.title')} subtitle={t('panel.skills.intro')}
        trailing={(
          <>
            {props.tabs}
            <SearchBox value={query} onChange={setQuery} placeholder={t('action.search')} label={t('action.search')} />
            <select className={styles.paneSearch} style={{ width: 170, padding: '8px 10px' }} value={moduleFilter} onChange={(event) => { setModuleFilter(event.target.value) }}>
              <option value="">{t('skills.allModules')}</option>
              {modules.map(module => <option key={module} value={module}>{module}</option>)}
            </select>
            <label className={`${styles.secondary} ${styles.fileAction}`}>
              {uploading ? t('skills.uploading') : t('skills.upload')}
              <input type="file" accept=".md,text/markdown" multiple style={{ display: 'none' }} onChange={(event) => { onFiles(event.target.files) }} />
            </label>
          </>
        )}>
        <Feedback t={t} message={message} />
        {/* Installing a whole harness — its skills, agents, rules, commands,
            and scripts — is only meaningful where the folder is the
            operator's own, which is the Desktop running the Host locally. */}
        {list === null
          ? <StateBlock kind="loading" title={t('state.loading')} />
          : <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={select}
            emptyTitle={t('state.empty.title')} emptyText={t('state.empty.text')} labels={tableLabels(t)} />}
        <Modal
          open={chosen !== null}
          onClose={() => { select(null) }}
          title={chosen?.name ?? t('skills.detail')}
          closeLabel={t('action.close')}
          className={styles.panelDialog ?? ''}
          footer={chosen === null ? undefined : draft !== null ? (
            <>
              <button className={styles.ghost} type="button" disabled={draftSaving} onClick={() => { setDraft(null); setDraftError(null) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" disabled={draftSaving || draft.trim().length === 0} onClick={() => { saveDraft(chosen.name, draft) }}>
                {draftSaving ? t('skills.saving') : t('action.save')}
              </button>
            </>
          ) : (
            <>
              <button className={styles.ghost} type="button" onClick={() => { select(null) }}>{t('action.close')}</button>
              {chosen.origin === 'owner' || (chosen.origin === 'global' && chosen.editsGlobally) ? (
                <button className={styles.danger} type="button" onClick={() => {
                  void removeSkill(chosen.name).then((result) => { apply(result); select(null) })
                }}>
                  {chosen.origin === 'global' ? t('skills.restoreCatalogAll') : chosen.replacesCatalog ? t('skills.restoreCatalog') : t('action.delete')}
                </button>
              ) : null}
              {chosen.origin === 'incoming' ? null : (
                <button className={styles.primary} type="button" disabled={draftLoading} onClick={() => { startEdit(chosen.name) }}>
                  {draftLoading ? t('state.loading') : t('action.edit')}
                </button>
              )}
            </>
          )}
        >
          {chosen === null
            ? null
            : draft !== null
              ? (
                <Field label={t('skills.markdown')}
                  hint={chosen.editsGlobally ? t('skills.editGlobalHint') : chosen.origin === 'owner' ? t('skills.editOwnHint') : t('skills.editCatalogHint')}>
                  <textarea className={styles.skillEditor} value={draft} spellCheck={false} aria-label={t('skills.markdown')}
                    onChange={(event) => { setDraft(event.target.value) }} />
                  {draftError === null ? null : <span className={styles.error}>{draftError}</span>}
                </Field>
              )
              : (
                <>
                  {draftError === null ? null : <span className={styles.error}>{draftError}</span>}
                  <Field label={t('field.module')}><span className={styles.cellMuted}>{chosen.module ?? t('cell.none')}{chosen.action === null ? '' : ` · ${chosen.action}`}</span></Field>
                  <Field label={t('field.description')}><span className={styles.cellMuted}>{chosen.description.length === 0 ? t('cell.none') : chosen.description}</span></Field>
                  <Field label={t('field.usedBy')}>
                    {chosen.assignedNames.length === 0
                      ? <span className={styles.cellMuted}>{t('skills.unused')}</span>
                      : (
                        <span className={styles.chips}>
                          {chosen.assignedNames.map((name, index) => <Chip key={chosen.assignedTo[index] ?? name}>{name}</Chip>)}
                        </span>
                      )}
                  </Field>
                  <Field label={t('field.origin')}><Chip tone={chosen.origin === 'owner' ? 'accent' : 'muted'}>{t(skillOriginKey(chosen))}</Chip></Field>
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
        </Modal>
      </Screen>
    )
  }
}

/** Locale key of one severity token; `null` and unknown tokens read as unclassified. */
function severitySourceKey(source: string): FaberloomKey {
  switch (source) {
    case 'LLM': return 'mesa.severity.llm'
    case 'HUMAN': return 'mesa.severity.human'
    default: return 'mesa.severity.rule'
  }
}

function severityKey(severity: string | null): FaberloomKey {
  switch ((severity ?? '').toUpperCase()) {
    case 'LOW': return 'mesa.severity.low'
    case 'MEDIUM': return 'mesa.severity.medium'
    case 'HIGH': return 'mesa.severity.high'
    case 'CRITICAL': return 'mesa.severity.critical'
    default: return 'mesa.unclassified'
  }
}

/** Locale key of one visible Mesa column, so the screen never prints a state token. */
function columnKey(column: string): FaberloomKey {
  switch (column) {
    case 'TU_CRITERIO': return 'mesa.column.tu'
    case 'ESPERANDO_CRITERIO': return 'mesa.column.esperando'
    case 'DELEGADO': return 'mesa.column.delegado'
    default: return 'mesa.column.error'
  }
}

/** Screen copy for the autonomy level of an item's unit (§7.1). */
function autonomyKey(level: string): FaberloomKey {
  switch (level) {
    case 'DELEGADO': return 'mesa.autonomy.delegado'
    case 'SUPERVISADO': return 'mesa.autonomy.supervisado'
    default: return 'mesa.autonomy.shadow'
  }
}

/** Calendar day of an ISO instant; the queue never prints a raw timestamp. */
function dayOf(iso: string): string {
  return iso.slice(0, 10)
}


/** Two-decimal money with grouping, shared by the detail and the List. */
const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Locale key of one verification status. */
function checkStatusKey(status: 'ok' | 'warning' | 'fail'): FaberloomKey {
  return status === 'ok' ? 'mesa.status.ok' : status === 'warning' ? 'mesa.status.warning' : 'mesa.status.fail'
}

/** Human name of a declared control; an unknown id stays readable as is. */
const CHECK_NAMES: Readonly<Record<string, FaberloomKey>> = {
  'proforma.price': 'mesa.check.price',
  'proforma.sku': 'mesa.check.sku',
  'proforma.quantity': 'mesa.check.quantity',
  'proforma.total': 'mesa.check.total',
  'proforma.stock': 'mesa.check.stock',
  'proforma.separation': 'mesa.check.separation',
}

/**
 * Readable name of one control.
 * @param t - locale seat.
 * @param id - declared control id.
 * @returns the localized name, or the id when this build does not know it.
 */
function checkName(t: ScreenProps['t'], id: string): string {
  const key = CHECK_NAMES[id]
  return key === undefined ? id : t(key)
}

/**
 * Keep Tab inside the open dialog, so a keyboard user cannot tab into the page
 * behind a modal decision.
 * @param event - the keydown of the dialog.
 */
function trapDialogTab(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return
  const focusables = event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea')
  if (focusables.length === 0) return
  const first = focusables[0] as HTMLElement
  const last = focusables[focusables.length - 1] as HTMLElement
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

/** Storage key of this tab's session, so a remounted panel keeps the seat it took. */
const TAB_SESSION_KEY = 'faberloom.mesa.tab'

/**
 * This browser tab's session. The Mesa remounts when the user visits the chat
 * it opens, so the seat has to outlive the component: one value per tab keeps
 * the attempt this tab opened its own (§9.7.1). A tab whose storage is
 * unavailable takes a fresh seat for the mount.
 * @returns the tab session.
 */
function tabSession(): string {
  const created = `tab-${Math.random().toString(36).slice(2)}`
  try {
    const stored = window.sessionStorage.getItem(TAB_SESSION_KEY)
    if (stored !== null && stored.length > 0) return stored
    window.sessionStorage.setItem(TAB_SESSION_KEY, created)
  } catch {
    // A sandboxed frame can refuse storage; this mount keeps the seat it minted.
  }
  return created
}

/**
 * Whether one refusal means the attempt this tab worked is over: the lock
 * expired, another attempt replaced it, or another tab session holds it
 * (W-43, §9.7.1). The board writes the stable code into the message, and the
 * transported error carries it as its code when it can.
 * @param error - the refusal the Remote answered.
 * @returns true when the panel must return to the paused state.
 */
function attemptIsOver(error: { readonly code: string; readonly message: string }): boolean {
  return /LOCK_LOST|LOCK_HELD|ITERATION_STALE/u.test(`${error.code} ${error.message}`)
}

/**
 * Whether one refusal says the attempt is another tab's, so the item reads
 * read-only there instead of resuming this tab's work (§9.7.1).
 * @param error - the refusal the Remote answered.
 * @returns true when the refusal is a held lock.
 */
function lockIsHeld(error: { readonly code: string; readonly message: string }): boolean {
  return /LOCK_HELD/u.test(`${error.code} ${error.message}`)
}

/** The WorkLoom Mesa: Foco, Kanban, Lista, and the detail zones. */function mesaScreen() {
  const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
  const REASONS = ['CLIENTE_CANCELO', 'DUPLICADO', 'ERROR_ORIGEN', 'NO_CORRESPONDE', 'RESUELTO_FUERA', 'OTRA'] as const
  // Scope of the correction an applied iteration teaches. `puntual` is the
  // default because it teaches nothing; the other three become candidates.
  const SCOPES = ['puntual', 'cuenta', 'espacio', 'agente'] as const
  // The queue rail shows one window of the queue so a long backlog does not
  // build hundreds of rows; the List keeps the complete set.
  const RAIL_LIMIT = 60
  // Business labels for the action types a deployment may execute. A type the
  // product does not know reads as the deployment declared it, never as an
  // internal token.
  const ACTION_KEYS: Readonly<Record<string, FaberloomKey>> = {
    'mail.send': 'mesa.action.mailSend',
    'inventory.reserve': 'mesa.action.inventoryReserve',
    'shipment.create': 'mesa.action.shipmentCreate',
  }
  // What a destination can report, as the reconciliation panel offers it.
  const OUTCOMES = ['CONFIRMADO', 'FALLIDO', 'DESCONOCIDO'] as const
  // One label per answer a probed destination can give (§9.8). An unknown
  // answer records the attempt and leaves the item in place.
  const PROBE_KEYS: Readonly<Record<FaberLoomBoardEffectOutcome, FaberloomKey>> = {
    CONFIRMADO: 'mesa.effect.probe.confirmado',
    FALLIDO: 'mesa.effect.probe.fallido',
    DESCONOCIDO: 'mesa.effect.probe.desconocido',
  }

  return function FaberloomMesa(props: ScreenProps) {
    const {
      t, boardDetail, boardRouteInstruction, boardClassify, boardAccounts, boardAssignAgent, boardArtifactUrl,
      boardSetSeverity, boardSaveEdits, boardApprove, boardApproveWithEdits,
      boardDiscard, boardResolveCandidate, boardAssignWorkspace, boardTakeDraft, boardRevalidate,
      boardSaveDraft, openTaskChat, goToWorkspace,
      boardIteration, boardIterationContext, boardIterationStart, boardIterationSaveDraft,
      boardIterationApply, boardIterationRenew, boardIterationPause, boardIterationCancel, boardIterationResume,
      boardIterationRecover, boardIterationDraft,
      boardApproveWithExecution, boardEffectStatus, boardEffectAlerts, boardEffectPolicy,
      boardEffectRevert, boardEffectRetry, boardEffectReconcile, boardEffectProbe, boardEffectAdminClose,
    } = props
    const { overview, error } = useOverview(props)
    const [view, setView] = useState<'foco' | 'kanban' | 'lista'>('foco')
    const [selected, setSelected] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [tick, setTick] = useState(0)
    const [classifying, setClassifying] = useState(false)
    const [catalogAccounts, setCatalogAccounts] = useState<readonly string[]>([])
    useEffect(() => {
      void boardAccounts().then((result) => { if (result.ok) setCatalogAccounts(result.value) })
    }, [])
    // The Mesa is shared: a priority, agent, or approval another reader saved
    // must reach this tab without a reload. The overview already polls; this
    // refreshes the open detail on the same order of magnitude.
    useEffect(() => {
      const timer = setInterval(() => setTick(count => count + 1), 15_000)
      return () => clearInterval(timer)
    }, [])
    const [spaceFilter, setSpaceFilter] = useState('')
    const [severityFilter, setSeverityFilter] = useState('')
    const [accountFilter, setAccountFilter] = useState('')
    // Items Saltar and ArrowRight left behind in this round. Skipping never
    // reorders the queue, it only moves the reader on (G7).
    const [skipped, setSkipped] = useState<readonly string[]>([])
    const [roundExhausted, setRoundExhausted] = useState(false)
    const [draft, setDraft] = useState<string | null>(null)
    const [draftRevision, setDraftRevision] = useState(0)
    const [showDiscard, setShowDiscard] = useState(false)
    const [discardReason, setDiscardReason] = useState<string>('DUPLICADO')
    const [discardNote, setDiscardNote] = useState('')
    const [showApprove, setShowApprove] = useState(false)
    const [confirmations, setConfirmations] = useState<readonly string[]>([])
    // E15: the effect-state controls. One panel at a time, like Discard, and
    // every one of them comes from the board's own vocabulary.
    const [showRevert, setShowRevert] = useState(false)
    const [revertReason, setRevertReason] = useState<string>('DUPLICADO')
    const [showReconcile, setShowReconcile] = useState(false)
    const [reconcileOutcome, setReconcileOutcome] = useState<FaberLoomBoardEffectOutcome>('DESCONOCIDO')
    // The answer the destination gave to one Conciliar request, kept with the
    // item it belongs to, so another item never shows it (§9.8).
    const [probeAnswer, setProbeAnswer] = useState<{
      readonly itemId: string
      readonly asked: boolean
      readonly outcome: FaberLoomBoardEffectOutcome | null
    } | null>(null)
    const [showRetry, setShowRetry] = useState(false)
    const [showClose, setShowClose] = useState(false)
    const [closeReason, setCloseReason] = useState('')
    // Action the approval executes, its destination, and the acceptance it
    // belongs to. An empty action approves without executing anything.
    const [execAction, setExecAction] = useState('')
    const [execDestination, setExecDestination] = useState('')
    const [executionId, setExecutionId] = useState('')
    // The version the open approval panel names; closing the panel drops it so
    // no acceptance survives a later gesture (W-73, G9).
    const [acceptance, setAcceptance] = useState<Acceptance | null>(null)
    // The clock the reversal countdown reads; one tick per second while a
    // delegated item is open.
    const [clock, setClock] = useState(() => Date.now())
    const [iterationDraft, setIterationDraft] = useState<string | null>(null)
    // Text of a draft write the board refused because the attempt was over,
    // kept for this item so the work is never dropped without a trace (W-43).
    const [residue, setResidue] = useState<{ readonly id: string; readonly text: string } | null>(null)
    const [differences, setDifferences] = useState<readonly FaberLoomBoardIterationDifference[]>([])
    const [exitMode, setExitMode] = useState<'apply' | 'discard' | null>(null)
    const [scope, setScope] = useState<FaberLoomBoardCorrectionScope>('puntual')
    const [candidateChoice, setCandidateChoice] = useState<'adopt' | 'keep' | null>(null)
    const [writerSession] = useState(tabSession)
    // The draft area's current text, so a handler created earlier reads the latest
    // one without restarting the renewal timer on every keystroke.
    const draftText = useRef<string | null>(null)
    const hydrated = useRef<string | null>(null)
    const editRef = useRef<HTMLTextAreaElement>(null)
    const severityRef = useRef<HTMLSelectElement>(null)
    const approvePanelRef = useRef<HTMLElement>(null)
    const approveButtonRef = useRef<HTMLButtonElement>(null)
    // The effect panels take focus when they open and hand it back to the
    // control that opened them, like the approval dialog (§9.9).
    const effectPanelRef = useRef<HTMLElement>(null)
    const effectTriggerRef = useRef<HTMLButtonElement | null>(null)
    // The board view an open item came from, remembered while the reader decides
    // inside Foco. A resolved command returns there (W-79); nothing renders it,
    // so it lives in a ref.
    const originView = useRef<'kanban' | 'lista' | null>(null)
    // The detail card and the Foco container scope the decision shortcuts: they
    // only act with the reader inside the card, and never while a dialog is open
    // (§9.9, W-71/W-73).
    const detailRef = useRef<HTMLElement | null>(null)
    const cardRef = useRef<HTMLDivElement | null>(null)

    /** Switch views by an explicit gesture; a manual switch forgets the origin (W-79). */
    const showView = (next: 'foco' | 'kanban' | 'lista'): void => {
      originView.current = null
      setView(next)
    }

    /**
     * Open one row in Foco and remember the board view it came from, so the
     * command that resolves it returns the reader there (W-79). Foco itself
     * keeps walking the queue and stores no origin.
     * @param id - the board item to open.
     */
    const openItem = (id: string): void => {
      setSelected(id)
      originView.current = view === 'foco' ? null : view
      setView('foco')
    }

    /**
     * Return to the view the item was opened from once a command settled it. The
     * row keeps its selection until the queue no longer holds it (W-79).
     * @param itemId - the item the settled command named.
     */
    const returnToOrigin = (itemId: string): void => {
      const target = originView.current
      if (target === null) return
      originView.current = null
      setView(target)
      setSelected(itemId)
    }

    /**
     * Close the approval panel and drop everything the acceptance minted, so no
     * action type, destination, execution id, or confirmed check survives to a
     * later gesture (W-73).
     */
    const resetApproval = (): void => {
      setShowApprove(false)
      setExecAction('')
      setExecDestination('')
      setExecutionId('')
      setAcceptance(null)
      setConfirmations([])
    }

    const rows = (overview?.board ?? []).filter(row => row.column !== 'CERRADO')
    /** Whether one row passes the selectors the filter bar shows (G7). */
    const matchesFilters = (row: FaberLoomBoardRow): boolean =>
      (spaceFilter.length === 0 || row.spaceId === spaceFilter)
      && (accountFilter.length === 0 || row.accountRef === accountFilter)
      && (severityFilter.length === 0 || row.severity === severityFilter)
    const visible = rows.filter(matchesFilters)
    const hidden = rows.filter(row => !matchesFilters(row))
    const queueEmpty = visible.length === 0
    // Identity of the visible queue, so a board view notices a row that left it
    // without re-running on every render (W-79).
    const visibleKey = visible.map(row => row.id).join('|')
    const detail = useLazy<FaberLoomBoardDetail | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : boardDetail(selected),
      [selected, tick],
    )
    const value = detail.kind === 'ready' ? detail.value : undefined
    const pending = value?.pendingCandidate ?? null
    // Work a collision moved to this item from the one it closed (§2.3, W-98).
    const transferred = value?.transferredDrafts ?? []
    const foreignDraft = value?.editDraft !== null && value?.editDraft !== undefined && value.editDraft.writerSession !== writerSession
    const editable = value?.state === 'PENDIENTE_CRITERIO' && !foreignDraft
    const draftChanged = draft !== null && value !== undefined && draft !== value.summary
    const restricted = value !== undefined && (value.dataClass === 'N3' || value.dataClass === 'N4')
    const iteration = useLazy<FaberLoomBoardIteration | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : boardIteration(selected),
      [selected, tick],
    )
    const attempt = iteration.kind === 'ready' ? iteration.value : undefined
    // An expired attempt already reads as idle; its draft stays offered (W-44).
    const live = attempt?.phase === 'active'
    // The attempt, not the user, is the lock subject: this tab owns the attempt
    // only when the lock names the session it opened it with (§9.7.1).
    const otherTabHolds = attempt !== undefined && attempt.phase === 'active'
      && attempt.lockBy !== null && attempt.lockBy !== writerSession
    const retainedDraft = live ? null : attempt?.draft ?? null
    const candidateBlocked = attempt?.candidatePending === true && candidateChoice === null
    const remaining = attempt?.lockUntil === null || attempt?.lockUntil === undefined
      ? null
      : Math.max(0, Math.ceil((Date.parse(attempt.lockUntil) - Date.now()) / 60_000))
    const outdatedDraft = useLazy<FaberLoomBoardIterationDraftRead | undefined>(
      () => selected === null || attempt?.draftOutdated !== true
        ? Promise.resolve({ ok: true, value: undefined })
        : boardIterationDraft(selected, attempt?.draft?.iterationId),
      [selected, tick, attempt?.draftOutdated, attempt?.draft?.iterationId],
    )

    useEffect(() => {
      if (outdatedDraft.kind !== 'ready' || outdatedDraft.value === undefined) return
      setDifferences(outdatedDraft.value.differences)
    }, [outdatedDraft])

    // E15: the item's external effect, the tenant's visible alerts, and the
    // action types an approval may execute. A read that fails leaves the item
    // usable: the effect zone simply shows nothing.
    const effect = useLazy<FaberLoomBoardEffectStatus | null>(
      () => selected === null
        ? Promise.resolve({ ok: true, value: null })
        : boardEffectStatus(selected),
      [selected, tick],
    )
    const effectStatus = effect.kind === 'ready' ? effect.value : null
    const alerts = useLazy<readonly FaberLoomBoardEffectAlertRow[]>(() => boardEffectAlerts(), [tick])
    const policy = useLazy<FaberLoomBoardEffectPolicy>(() => boardEffectPolicy(), [])
    const actionTypes = policy.kind === 'ready' ? policy.value.actionTypes : []
    // The board states the reversal window per action type; the panel says what
    // will happen from it and never keeps a window of its own (D-12).
    const windowMsOf = (actionType: string): number | null =>
      policy.kind === 'ready' ? policy.value.reversalWindowMs[actionType] ?? null : null

    // The effect state the panel is in. Every action below reads one of these,
    // so a state the board adds later simply shows no effect controls.
    const delegated = value?.state === 'DELEGADO_EN_VENTANA'
    const effectRunning = value?.state === 'EJECUCION_PENDIENTE'
    const effectOutcome = effectStatus?.executionOutcome ?? null
    // "No sabemos si se envió": the item's outcome, or its state, is unknown
    // (W-21, W-22). Correct and discard stay closed here (W-76).
    const outcomeUnknown = value?.state === 'DESCONOCIDO'
      || (value?.state === 'ERROR_RECUPERABLE' && effectOutcome === 'DESCONOCIDO')
    const outcomeFailed = value?.state === 'ERROR_RECUPERABLE' && !outcomeUnknown
    const effectZone = delegated || effectRunning || outcomeUnknown || outcomeFailed
    const canAdminClose = effectStatus?.canAdminClose === true
    const mayRetry = effectStatus?.idempotent === true
    // The board says whether its adapter can be asked about the destination
    // (§9.8); without one the operator states the answer.
    const probeAvailable = effectStatus?.probe === true
    const effectDeadline = delegated ? effectStatus?.reversalDeadline ?? null : null
    const remainingMs = effectDeadline === null ? 0 : Math.max(0, Date.parse(effectDeadline) - clock)
    const windowOpen = delegated && remainingMs > 0
    const executing = execAction.length > 0
    const effectActionLabel = effectStatus?.actionType === null || effectStatus?.actionType === undefined
      ? t('mesa.none')
      : actionLabel(effectStatus.actionType)

    // Zone ④ reads the same live report approval runs, so a blocking verdict
    // here is the verdict the command will apply.
    const checks = value?.checks ?? []
    const checksError = value?.checksError ?? null
    const missingChecks = value?.missingChecks ?? []
    const blockingFail = checks.find(check => check.class === 'bloqueante' && check.status === 'fail')
    const pendingConfirmations = checks.filter(check => check.class === 'confirmacion' && check.status !== 'ok')
    const confirmedAll = pendingConfirmations.every(check => confirmations.includes(check.id))

    /** Resolve a space id to its readable title; the queue never shows an id. */
    const spaceName = (id: string | null): string =>
      id === null ? t('mesa.noSpace') : overview?.spaces.find(space => space.id === id)?.title ?? t('mesa.noSpace')

    /** Account and space as one line; an absent space is dropped instead of printed. */
    const kickerOf = (account: string | null, space: string | null): string =>
      [account ?? t('mesa.noAccount'), space === null ? null : spaceName(space)].filter(part => part !== null).join(' · ')

    // The picker mirrors the sidebar: a Space and its sub-spaces, indented by
    // depth, so the human recognises where the work will live.
    const spaceOptions = (() => {
      const rows = overview?.spaces ?? []
      const byId = new Map(rows.map(space => [space.id, space]))
      const depthOf = (id: string): number => {
        let depth = 0
        let parent = byId.get(id)?.parentId ?? null
        while (parent !== null && depth < 8) {
          depth += 1
          parent = byId.get(parent)?.parentId ?? null
        }
        return depth
      }
      const seenTitles = new Set<string>()
      return rows
        .map(space => ({ id: space.id, title: space.title, depth: depthOf(space.id) }))
        .filter((space) => {
          // The projection can repeat one Space; the picker shows it once.
          const key = space.title.trim().toLocaleLowerCase()
          if (seenTitles.has(key)) return false
          seenTitles.add(key)
          return true
        })
        .sort((left, right) => left.depth - right.depth || left.title.localeCompare(right.title))
    })()

    /** Business label for one action type; an unknown one reads as declared. */
    function actionLabel(actionType: string): string {
      const key = ACTION_KEYS[actionType]
      return key === undefined ? actionType : t(key)
    }
    /** Minutes and seconds left in the reversal window. */
    const countdown = `${String(Math.floor(remainingMs / 60_000))}:${String(Math.floor((remainingMs % 60_000) / 1_000)).padStart(2, '0')}`

    const selectedIndex = visible.findIndex(row => row.id === selected)
    const railStart = selectedIndex < RAIL_LIMIT ? 0 : Math.max(0, selectedIndex - 10)
    const railRows = visible.slice(railStart, railStart + RAIL_LIMIT)
    const unclassifiedCount = visible.filter(row => row.severity === null).length
    /** Ask the classifier for the pending items and refresh the overview. */
    const classifyPending = (): void => {
      if (classifying) return
      setClassifying(true)
      void boardClassify(50).then((result) => {
        setClassifying(false)
        if (!result.ok) { setMessage(result.error.message); return }
        setTick(count => count + 1)
        setMessage(`${t('mesa.classify.done')} ${String(result.value.classified)}`
          + (result.value.remaining === 0 ? '' : ` · ${t('mesa.classify.remaining')} ${String(result.value.remaining)}`))
      })
    }
    const criticalCount = visible.filter(row => row.severity === 'CRITICAL').length
    const overdueCount = visible.filter(row => row.dueAt !== null && Date.parse(row.dueAt) < Date.now()).length
    const outsideCount = hidden.length
    // The scope bar names what a filter hides, so clearing it is a decision
    // over the items that matter instead of a guess (G7).
    const outsideUnclassified = hidden.filter(row => row.severity === null).length
    const outsideNoSpace = hidden.filter(row => row.spaceId === null).length
    const outsideCritical = hidden.filter(row => row.severity === 'CRITICAL').length
    // W-52: only a really empty authorized queue says nothing awaits a decision.
    // When a filter hides every item, the empty view names the counts instead, so
    // clearing the filter looks like the decision it is.
    const emptyTitle = rows.length === 0 ? t('mesa.empty') : t('mesa.noSelection')
    const emptyText = rows.length === 0
      ? t('mesa.emptyHint')
      : `${t('mesa.scope.outside')}: ${String(outsideCount)} · ${t('mesa.queue')}: ${String(rows.length)}`
    const emptyBlock = <StateBlock kind="empty" title={emptyTitle} text={emptyText} />
    // The account filter offers the MWT.ONE client book plus any account an item
    // already names, so a client with no queue yet is still selectable.
    const accountOptions = [...new Set([
      ...catalogAccounts,
      ...rows.map(row => row.accountRef).filter((account): account is string => account !== null),
    ])].sort((left, right) => left.localeCompare(right))
    /** The first condition that stops a decision, in the order the spec lists it. */
    const blockedReason = value === undefined ? null
      : pending !== null ? t('mesa.blocked.candidate')
        : value.stale ? t('mesa.blocked.stale')
          : value.severity === null ? t('mesa.blocked.severity')
            : missingChecks.length > 0 ? t('mesa.checks.missing')
              : blockingFail !== undefined ? t('mesa.checks.blocked')
                : null

    /** Report a write and refresh the detail and the queue. */
    function apply<T>(result: Result<T> | Promise<Result<T>>): void {
      void Promise.resolve(result).then((resolved) => {
        if (resolved.ok) { setTick(count => count + 1); setMessage(null) }
        else setMessage(resolved.error.message)
      })
    }

    /**
     * Keep the work of an attempt this tab no longer holds. One last draft
     * write carries the dead attempt's id, generation, session, and the current
     * text, so the board archives it and the retained draft still offers it
     * (W-43, W-57). A board that refuses that write too (another tab holds the
     * attempt) leaves the text in this panel, and the one-line message says so
     * instead of dropping it silently.
     * @param text - the text the draft area held when the refusal arrived.
     * @param held - whether another tab session holds the attempt.
     */
    function endAttempt(text: string | null, held: boolean): void {
      if (value === undefined || attempt === undefined || attempt.iterationId === null) return
      const itemId = value.id
      const iterationId = attempt.iterationId
      const generation = attempt.generation
      const baseVersion = attempt.baseVersion ?? value.version
      setDifferences([])
      setExitMode(null)
      setCandidateChoice(null)
      if (text === null || text.length === 0) {
        setIterationDraft(null)
        draftText.current = null
        if (!held) setMessage(t('mesa.iteration.lockLost'))
        setTick(count => count + 1)
        return
      }
      void boardIterationSaveDraft(itemId, {
        iterationId, generation, actorSession: writerSession, baseVersion, summary: text,
      }).then((result) => {
        if (result.ok) {
          setIterationDraft(null)
          draftText.current = null
          setResidue(null)
          setMessage(t('mesa.iteration.lockLost'))
        } else {
          setIterationDraft(text)
          draftText.current = text
          setResidue({ id: itemId, text })
          setMessage(t('mesa.iteration.residueKept'))
        }
        setTick(count => count + 1)
      })
    }

    useEffect(() => {
      if (view !== 'foco') return
      if (selected !== null && visible.some(row => row.id === selected)) return
      setSelected(visible[0]?.id ?? null)
    }, [view, spaceFilter, severityFilter, accountFilter, overview])

    // A different filter set or an empty queue starts a fresh round (G7).
    useEffect(() => {
      setSkipped([])
      setRoundExhausted(false)
    }, [spaceFilter, severityFilter, accountFilter, queueEmpty])

    // A board view keeps the row the reader came back to; when the queue no
    // longer holds it (an approval closed the item), the selection goes with it
    // (W-79). Foco keeps its own queue walk and is left alone.
    useEffect(() => {
      if (view === 'foco' || selected === null) return
      if (visible.some(row => row.id === selected)) return
      setSelected(null)
    }, [view, selected, visibleKey])

    useEffect(() => {
      if (value === undefined) return
      const key = [
        value.id,
        String(value.version),
        value.editDraft?.writerSession ?? '',
        attempt?.iterationId ?? '',
        attempt?.phase ?? '',
        attempt?.draft?.updatedAt ?? '',
      ].join(':')
      if (hydrated.current === key) return
      hydrated.current = key
      setDraft(value.editDraft !== null && value.editDraft.writerSession === writerSession
        ? (typeof value.editDraft.changes['summary'] === 'string' ? value.editDraft.changes['summary'] : value.summary)
        : value.summary)
      setDraftRevision(value.editDraft?.revision ?? 0)
      // A text the board refused to store survives the re-read and returns to
      // the draft area, so reopening the attempt can still carry it (E7).
      const kept = residue !== null && residue.id === value.id ? residue.text : null
      const attemptText = kept ?? (live ? attempt?.draft?.summary ?? value.summary : null)
      setIterationDraft(attemptText)
      draftText.current = attemptText
      setDifferences([])
      // An approval the save just opened names the version it committed, so
      // reading that same version keeps its panel open (G9).
      if (acceptance === null || acceptance.version !== value.version || acceptance.hash !== value.artifactHash) {
        resetApproval()
      }
      setShowDiscard(false)
      setShowRevert(false)
      setShowReconcile(false)
      setShowRetry(false)
      setShowClose(false)
      setCloseReason('')
      setExitMode(null)
      setCandidateChoice(null)
      setMessage(null)
    }, [
      value?.id, value?.version, value?.editDraft?.writerSession,
      attempt?.iterationId, attempt?.phase, attempt?.draft?.updatedAt, residue,
    ])

    // The acceptance names one version and hash: a newer version under the open
    // panel closes it instead of approving work the reader did not see (W-73).
    useEffect(() => {
      if (acceptance === null || value === undefined) return
      if (value.id !== acceptance.itemId) { resetApproval(); return }
      // A live read older than the acceptance is the reload of the save this
      // panel just committed, not a change of the item.
      if (value.version < acceptance.version) return
      if (value.version === acceptance.version && value.artifactHash === acceptance.hash) return
      resetApproval()
    }, [value?.id, value?.version, value?.artifactHash, acceptance])

    // The approval panel is a dialog: it takes focus when it opens and hands it
    // back to the button that opened it, so keyboard users never lose their place.
    useEffect(() => {
      if (!showApprove) return
      approvePanelRef.current?.focus()
      return () => { approveButtonRef.current?.focus() }
    }, [showApprove])

    // One effect control is open at a time; it takes focus when it opens and
    // returns it to the control that opened it (§9.9).
    const effectPanelOpen = showRevert || showReconcile || showRetry || showClose
    useEffect(() => {
      if (!effectPanelOpen) return
      effectPanelRef.current?.focus()
      return () => { effectTriggerRef.current?.focus() }
    }, [effectPanelOpen])

    // The reversal countdown reads the deadline the board recorded, once a
    // second while a delegated item is open (D-04). It stops with the item.
    useEffect(() => {
      if (!delegated) return
      setClock(Date.now())
      const timer = setInterval(() => { setClock(Date.now()) }, 1_000)
      return () => { clearInterval(timer) }
    }, [delegated, effectDeadline, selected])

    useEffect(() => {
      if (draft === null || value === undefined || !editable || restricted) return
      if (draft === value.summary) return
      const timer = setTimeout(() => {
        void boardSaveDraft(value.id, {
          baseVersion: value.version,
          revision: draftRevision,
          writerSession,
          changes: { summary: draft },
        }).then((result) => {
          if (result.ok) setDraftRevision(result.value.revision)
          else setMessage(result.error.message)
        })
      }, 350)
      return () => clearTimeout(timer)
    }, [draft, value?.id, value?.version, editable, restricted])

    // While the attempt is live the draft area edits its work, not the item
    // summary; the host stores it under the attempt and a write made after the
    // attempt ended is archived instead of reaching the item (W-57).
    useEffect(() => {
      if (value === undefined || attempt === undefined || !live || otherTabHolds || iterationDraft === null) return
      if (attempt.iterationId === null) return
      if (iterationDraft === (attempt.draft?.summary ?? value.summary)) return
      const iterationId = attempt.iterationId
      const generation = attempt.generation
      const baseVersion = value.version
      const timer = setTimeout(() => {
        void boardIterationSaveDraft(value.id, {
          iterationId, generation, actorSession: writerSession, baseVersion, summary: iterationDraft,
        })
          .then((result) => {
            if (!result.ok) {
              // The attempt ended elsewhere while this tab was typing: the work
              // is kept as a late draft instead of being dropped (W-43, W-57).
              if (attemptIsOver(result.error)) endAttempt(iterationDraft, lockIsHeld(result.error))
              else setMessage(result.error.message)
              return
            }
            if (!result.value.linked) setTick(count => count + 1)
          })
      }, 350)
      return () => clearTimeout(timer)
    }, [iterationDraft, live, otherTabHolds, attempt?.iterationId, attempt?.generation, value?.id, value?.version])

    // D-09: a tab that holds the attempt renews it on the cadence the host
    // projects, so work in progress never loses the lock. The timer stops with
    // the attempt or the panel, and a refusal means the attempt ended elsewhere:
    // its last text is archived as a draft of that attempt, the panel returns to
    // the paused state, and the item is never written from here (W-43, W-44).
    useEffect(() => {
      if (value === undefined || attempt === undefined) return
      if (!live || attempt.iterationId === null) return
      if (attempt.lockBy !== null && attempt.lockBy !== writerSession) return
      const itemId = value.id
      const iterationId = attempt.iterationId
      const generation = attempt.generation
      // The board validates the cadence as a positive number of seconds, so the
      // panel schedules it as given and carries no copy of the D-09 value.
      const period = attempt.renewalSeconds * 1_000
      const timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void boardIterationRenew(itemId, { iterationId, generation, actorSession: writerSession }).then((result) => {
          if (result.ok) { setTick(count => count + 1); return }
          if (!attemptIsOver(result.error)) { setMessage(result.error.message); return }
          // The attempt is no longer this tab's: the last text goes to the dead
          // attempt before the panel returns to the paused state (W-43, W-57).
          endAttempt(draftText.current, lockIsHeld(result.error))
        })
      }, period)
      return () => { clearInterval(timer) }
    }, [live, attempt?.iterationId, attempt?.generation, attempt?.lockBy, attempt?.renewalSeconds, value?.id])

    /**
     * Mark the current item skipped and move to the next one this round keeps.
     * When every remaining item is skipped the panel offers a new round instead
     * of cycling silently (G7); skipping never reorders the queue.
     */
    const next = (): void => {
      const index = visible.findIndex(row => row.id === selected)
      const current = visible[index]
      const left = current === undefined || skipped.includes(current.id) ? skipped : [...skipped, current.id]
      const ahead = index < 0
        ? visible
        : [...visible.slice(index + 1), ...visible.slice(0, index + 1)]
      const target = ahead.find(row => !left.includes(row.id))
      if (left !== skipped) setSkipped(left)
      if (target === undefined) { setRoundExhausted(true); return }
      setSelected(target.id)
      setRoundExhausted(false)
      setTick(count => count + 1)
    }

    /** Walk every visible item again after a round left only skipped ones (G7). */
    const restartRound = (): void => {
      setSkipped([])
      setRoundExhausted(false)
      setSelected(visible[0]?.id ?? null)
      setTick(count => count + 1)
    }

    /** Open the iteration chat with the pinned context the host filtered for this actor (§8.5). */
    const openIterationChat = (): void => {
      if (value === undefined) return
      void boardIterationContext(value.id).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        const context = result.value
        if (context === undefined) { setMessage(t('mesa.error')); return }
        // A task with a Space starts its session inside that Space's folder, so
        // the conversation shows up in the sidebar next to the work.
        const folder = value.spaceId === null
          ? undefined
          : overview?.spaces.find(space => space.id === value.spaceId)?.folderPath ?? undefined
        openTaskChat('iteration', value.title, `v${String(value.version)}`, '', context, folder)
      })
    }

    /**
     * Start or reopen the attempt and open the chat. A retained draft is
     * resumed instead of starting over, so the work is never archived by a
     * fresh attempt (E7); an outdated draft reports its differences instead of
     * overwriting the newer version (W-68).
     */
    const iterate = (): void => {
      if (value === undefined) return
      setMessage(null)
      // A task without a Space can still open its conversation: the attempt is
      // what needs a Space, not the gesture. Assigning one starts the attempt.
      if (value.spaceId === null && !live) {
        openIterationChat()
        setMessage(t('mesa.iteration.noSpaceChat'))
        return
      }
      if (live) { openIterationChat(); return }
      const refresh = (): void => { setTick(count => count + 1) }
      if (retainedDraft === null) {
        void boardIterationStart(value.id, value.version, writerSession).then((result) => {
          if (!result.ok) { setMessage(result.error.message); return }
          refresh()
          openIterationChat()
        })
        return
      }
      void boardIterationResume(value.id, retainedDraft.baseVersion, writerSession).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (result.value.status === 'outdated') {
          setDifferences(result.value.differences)
          refresh()
          return
        }
        setDifferences([])
        refresh()
        openIterationChat()
      })
    }

    /** Leave the live attempt through the exit the user chose; the draft stays (W-97). */
    const leaveIteration = (reason: FaberLoomBoardIterationExit, then?: () => void): void => {
      if (value === undefined || attempt === undefined || attempt.iterationId === null) return
      const run = boardIterationPause(value.id, {
        iterationId: attempt.iterationId,
        generation: attempt.generation,
        actorSession: writerSession,
        reason,
      })
      void run.then((result) => {
        if (!result.ok) {
          if (attemptIsOver(result.error)) { endAttempt(iterationDraft, lockIsHeld(result.error)); return }
          setMessage(result.error.message)
          return
        }
        setExitMode(null)
        setCandidateChoice(null)
        setIterationDraft(null)
        draftText.current = null
        setResidue(null)
        setDifferences([])
        setTick(count => count + 1)
        then?.()
      })
    }

    /** The candidate choice that must ride along with the exit, when one is pending. */
    const candidatePayload = (): { candidate?: FaberLoomBoardIterationChoice } => {
      if (pending === null || candidateChoice === null) return {}
      return { candidate: { id: pending.id, hash: pending.hash, decision: candidateChoice } }
    }

    /** Apply the attempt: one new version, the chosen scope, and the lock released. */
    const applyIteration = (): void => {
      if (value === undefined || attempt === undefined || attempt.iterationId === null) return
      const run = boardIterationApply(value.id, {
        iterationId: attempt.iterationId,
        generation: attempt.generation,
        actorSession: writerSession,
        baseVersion: value.version,
        scope,
        ...candidatePayload(),
      })
      void run.then((result) => {
        if (!result.ok) {
          if (attemptIsOver(result.error)) { endAttempt(iterationDraft, lockIsHeld(result.error)); return }
          setMessage(result.error.message)
          return
        }
        setExitMode(null)
        setCandidateChoice(null)
        setIterationDraft(null)
        draftText.current = null
        setResidue(null)
        setDifferences([])
        setTick(count => count + 1)
        // The version is committed: a correction that could not be recorded is
        // reported on one line instead of failing or undoing the apply (W-34).
        if (result.value.correctionError !== null) {
          setMessage(`${t('mesa.correctionMissing')} ${result.value.correctionError}`)
        }
      })
    }

    /** Discard the attempt's work: the draft goes and the version does not change. */
    const discardIteration = (): void => {
      if (value === undefined || attempt === undefined || attempt.iterationId === null) return
      const run = boardIterationCancel(value.id, {
        iterationId: attempt.iterationId,
        generation: attempt.generation,
        actorSession: writerSession,
        ...candidatePayload(),
      })
      void run.then((result) => {
        if (!result.ok) {
          if (attemptIsOver(result.error)) { endAttempt(iterationDraft, lockIsHeld(result.error)); return }
          setMessage(result.error.message)
          return
        }
        setExitMode(null)
        setCandidateChoice(null)
        setIterationDraft(null)
        draftText.current = null
        setResidue(null)
        setDifferences([])
        setTick(count => count + 1)
      })
    }

    /**
     * Assign a space and follow the board's answer: a collision can close the
     * item this panel had open and keep a peer live, so the panel selects the
     * live item and reads the drafts the collision moved there (§2.3, W-98).
     * @param spaceId - the space the user chose.
     */
    const assignSpace = (spaceId: string): void => {
      if (value === undefined) return
      const itemId = value.id
      void boardAssignWorkspace(itemId, spaceId).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (result.value !== undefined && result.value.id !== itemId) setSelected(result.value.id)
        setTick(count => count + 1)
      })
    }

    /**
     * Open one stored document in a new tab. A URL is opened as it is; a storage
     * key is signed by the deployment's storage tool first, so the panel never
     * holds a credential or a bucket address of its own.
     * @param ref - document URL or storage key.
     */
    const openDocument = (ref: string | null): void => {
      if (ref === null || ref.length === 0) { setMessage(t('mesa.document.none')); return }
      if (/^https?:\/\//u.test(ref)) { window.open(ref, '_blank', 'noopener,noreferrer'); return }
      void boardArtifactUrl(ref).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (result.value === null) { setMessage(t('mesa.document.none')); return }
        window.open(result.value.url, '_blank', 'noopener,noreferrer')
      })
    }

    /** The storage key one evidence reference names, or null. */
    const storageKeyOf = (entry: string): string | null => {
      const match = /key\s+([\w./-]+)/iu.exec(entry)
      return match?.[1] ?? null
    }

    /** The first match of a code pattern in the item's own text, or null. */
    const codeOf = (pattern: RegExp): string | null => {
      if (value === undefined) return null
      const text = [value.title, value.summary, ...value.evidence].join(' ')
      return new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(text)?.[0] ?? null
    }

    /**
     * The first iteration draft a collision moved to this item, which is the one
     * Compare and Recover act on (§2.3, W-98). An edit draft has no attempt, so
     * it is never this entry.
     * @returns the transferred iteration draft, or undefined when none moved here.
     */
    const transferredIteration = (): FaberLoomBoardTransferredDraft | undefined =>
      transferred.find(item => item.kind === 'iteration' && item.iterationId !== null)

    /**
     * Show what a draft the assignment moved here changed against the current
     * version, so the reader decides over that work before anything is applied
     * (§2.3, W-98). The draft is read, never resumed or applied by this button.
     */
    const compareTransferred = (): void => {
      if (value === undefined) return
      const entry = transferredIteration()
      if (entry === undefined) {
        setMessage(t('mesa.iteration.transferredEdit'))
        return
      }
      void boardIterationDraft(value.id, entry.iterationId ?? undefined).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        const draft = result.value.draft
        const rows = result.value.differences.length > 0
          ? result.value.differences
          : draft?.summary == null || draft.summary === value.summary
            ? []
            : [{ field: 'summary', draftValue: draft.summary, currentValue: value.summary }]
        if (rows.length === 0) { setMessage(t('mesa.iteration.transferredSame')); return }
        setDifferences(rows)
      })
    }

    /**
     * Recover the work a collision moved here as the live draft of a new attempt
     * (§2.3, W-98). The board links the draft and the attempt starts; it never
     * applies the work, so the panel still needs the normal Apply with a scope.
     * A draft written against an older version comes back with its differences
     * and the item is not written (W-68).
     */
    const recoverTransferred = (): void => {
      if (value === undefined) return
      const entry = transferredIteration()
      if (entry === undefined) {
        setMessage(t('mesa.iteration.transferredEdit'))
        return
      }
      void boardIterationRecover(value.id, entry.key, writerSession).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setTick(count => count + 1)
        if (result.value.status === 'outdated') {
          setDifferences(result.value.differences)
          return
        }
        setDifferences([])
        openIterationChat()
      })
    }

    const [instruction, setInstruction] = useState('')
    const [routing, setRouting] = useState(false)
    const routedFields = [...new Set(['summary', ...(value?.fieldOrigins ?? []).map(origin => origin.field)])]

    /**
     * Apply one deterministic field instruction without a model. The router
     * only owns instructions naming a declared field; anything else is left to
     * the agent (§9.7).
     */
    const applyInstruction = (): void => {
      if (value === undefined) return
      // The board owns the parser, so the detail and the iteration chat cannot
      // disagree about what an instruction means (§9.7).
      void boardRouteInstruction(value.id, instruction).then((routed) => {
        if (!routed.ok) { setMessage(routed.error.message); return }
        const changes = routed.value
        if (changes === null) { setMessage(t('mesa.router.unmatched')); return }
        const payload = Object.fromEntries(changes.map(change => [change.field, change.value]))
        return boardSaveEdits(value.id, {
          rowVersion: value.rowVersion,
          baseVersion: value.version,
          changes: payload,
        }).then((result) => {
          if (!result.ok) { setMessage(result.error.message); return }
          setInstruction('')
          setRouting(false)
          setTick(count => count + 1)
        })
      })
    }

    const save = (): void => {
      if (value === undefined || draft === null) return
      void boardSaveEdits(value.id, {
        rowVersion: value.rowVersion,
        baseVersion: value.version,
        changes: { summary: draft },
      }).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setTick(count => count + 1)
        // The version is committed: a correction that could not be recorded is
        // reported on one line instead of failing or undoing the edit (W-34).
        if (result.value.correctionError !== null) {
          setMessage(`${t('mesa.correctionMissing')} ${result.value.correctionError}`)
        }
      })
    }

    /**
     * Accept the version the open panel captured, or the live version when the
     * shortcut approves without a panel. Edits the panel already committed are
     * never sent twice (W-73, G9).
     */
    const approve = (): void => {
      if (value === undefined || restricted) return
      const held = acceptance !== null && acceptance.itemId === value.id ? acceptance : null
      const target = held ?? (value.artifactHash === null
        ? null
        : {
          itemId: value.id,
          version: value.version,
          hash: value.artifactHash,
          rowVersion: value.rowVersion,
          saved: false,
        })
      if (target === null) { setMessage(t('mesa.error')); return }
      if (!confirmedAll) return
      const acceptedConfirmations = pendingConfirmations.length === 0
        ? {}
        : { confirmations: pendingConfirmations.map(check => check.id) }
      if (executing) {
        // The acceptance names the effect and its destination. The board decides
        // whether that action type needs anything else; this panel adds nothing.
        if (execDestination.trim().length === 0) { setMessage(t('mesa.approveEffect.destinationRequired')); return }
        acceptExecution(value, target)
        resetApproval()
        return
      }
      const run = draftChanged && !target.saved
        ? boardApproveWithEdits(value.id, {
          rowVersion: target.rowVersion,
          baseVersion: target.version,
          artifactVersion: target.version,
          artifactHash: target.hash,
          changes: { summary: draft ?? '' },
          ...acceptedConfirmations,
        })
        : boardApprove(value.id, {
          rowVersion: target.rowVersion,
          artifactVersion: target.version,
          artifactHash: target.hash,
          ...acceptedConfirmations,
        })
      apply(run)
      // The board settled the decision: a board view gets its row back (W-79).
      void run.then((result) => { if (result.ok) returnToOrigin(target.itemId) })
      resetApproval()
    }

    const discard = (): void => {
      if (value === undefined) return
      const itemId = value.id
      const run = boardDiscard(itemId, {
        rowVersion: value.rowVersion,
        reason: discardReason,
        ...discardReason === 'OTRA' ? { note: discardNote } : {},
      })
      apply(run)
      void run.then((result) => { if (result.ok) returnToOrigin(itemId) })
      setShowDiscard(false)
    }

    /**
     * Accept the execution the confirmation panel describes, against the version
     * and hash the panel captured. The acceptance carries the signature that
     * covers its action type, so the audit names what allowed it (§10.1).
     * @param current - the detail whose id the command names.
     * @param target - the captured version, hash, and row version.
     */
    const acceptExecution = (current: FaberLoomBoardDetail, target: Acceptance): void => {
      const accepted = pendingConfirmations.length === 0
        ? {}
        : { confirmations: pendingConfirmations.map(check => check.id) }
      const run = boardApproveWithExecution(current.id, {
        expectedRowVersion: target.rowVersion,
        expectedArtifactVersion: target.version,
        expectedArtifactHash: target.hash,
        executionId,
        actionType: execAction,
        destination: execDestination.trim(),
        ...accepted,
      })
      apply(run)
      void run.then((result) => { if (result.ok) returnToOrigin(current.id) })
    }

    /**
     * Open the single confirmation panel and capture the version it names.
     * Pending edits are committed first when the panel also needs confirmations,
     * so the panel binds to the saved version instead of the one it replaces
     * (G9); a failed save reports the error and leaves the panel closed.
     */
    const openApprove = (): void => {
      if (value === undefined || restricted) return
      if (value.artifactHash === null) { setMessage(t('mesa.error')); return }
      setExecutionId(`exec-${writerSession}-${String(Date.now())}`)
      const open = (target: Acceptance): void => {
        setAcceptance(target)
        setShowApprove(true)
      }
      if (!draftChanged || pendingConfirmations.length === 0) {
        open({
          itemId: value.id,
          version: value.version,
          hash: value.artifactHash,
          rowVersion: value.rowVersion,
          saved: false,
        })
        return
      }
      void boardSaveEdits(value.id, {
        rowVersion: value.rowVersion,
        baseVersion: value.version,
        changes: { summary: draft ?? '' },
      }).then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        const saved = result.value.detail
        if (saved === null || saved.artifactHash === null) { setMessage(t('mesa.error')); return }
        open({
          itemId: saved.id,
          version: saved.version,
          hash: saved.artifactHash,
          rowVersion: saved.rowVersion,
          saved: true,
        })
        setTick(count => count + 1)
        // The version is committed: a correction that could not be recorded is
        // reported on one line instead of undoing the save (W-34).
        if (result.value.correctionError !== null) {
          setMessage(`${t('mesa.correctionMissing')} ${result.value.correctionError}`)
        }
      })
    }

    /** Revert the delegated execution: the reason and the button are two steps (§9.8). */
    const revertExecution = (): void => {
      if (value === undefined) return
      const itemId = value.id
      const run = boardEffectRevert(itemId, { expectedRowVersion: value.rowVersion, reason: revertReason })
      apply(run)
      // Reverting from a delegated item opened in Kanban returns there (W-79).
      void run.then((result) => { if (result.ok) returnToOrigin(itemId) })
      setShowRevert(false)
    }

    /** Record what the destination reported about a dispatched effect (W-21). */
    const reconcileExecution = (): void => {
      if (value === undefined) return
      apply(boardEffectReconcile(value.id, {
        expectedRowVersion: value.rowVersion,
        outcome: reconcileOutcome,
      }))
      setShowReconcile(false)
    }

    /**
     * Ask the destination what became of the effect (§9.8). The board settles
     * the answer it gets and returns the effect projection, so an unknown answer
     * records the attempt and leaves the item where it is, and the panel reports
     * what came back instead of choosing.
     */
    const probeDestination = (): void => {
      if (value === undefined) return
      const id = value.id
      const run = boardEffectProbe(id, { expectedRowVersion: value.rowVersion })
      void run.then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        if (result.value === null) return
        // `probe` is the board's declaration that an adapter could be asked, so
        // the answer below is the destination's, not a default.
        setProbeAnswer({ itemId: id, asked: result.value.probe, outcome: result.value.executionOutcome })
        setTick(count => count + 1)
      })
    }

    /** Open the panel that offers the three answers the destination could not give. */
    const openManualReconcile = (): void => {
      setReconcileOutcome('DESCONOCIDO')
      setShowReconcile(true)
    }

    /** Retry the failed execution with the identity it already holds (W-84). */
    const retryExecution = (): void => {
      if (value === undefined) return
      apply(boardEffectRetry(value.id, { expectedRowVersion: value.rowVersion }))
      setShowRetry(false)
    }

    /**
     * Close the item while its effect stays unconfirmed: the reason is
     * mandatory and the follow-up remains open (D-9, W-65). A pending candidate
     * becomes its own item, which this panel then opens (W-86).
     */
    const closeWithPendingReconciliation = (): void => {
      if (value === undefined || closeReason.trim().length === 0) return
      const run = boardEffectAdminClose(value.id, {
        expectedRowVersion: value.rowVersion,
        reason: closeReason.trim(),
      })
      void run.then((result) => {
        if (!result.ok) { setMessage(result.error.message); return }
        setShowClose(false)
        setCloseReason('')
        setSelected(result.value.createdId)
        setTick(count => count + 1)
      })
    }

    /** Close the innermost open control; false when none is open (§9.9). */
    const closeTopControl = (): boolean => {
      if (exitMode !== null) { setExitMode(null); return true }
      if (showRevert) { setShowRevert(false); return true }
      if (showReconcile) { setShowReconcile(false); return true }
      if (showRetry) { setShowRetry(false); return true }
      if (showClose) { setShowClose(false); return true }
      if (showApprove) { resetApproval(); return true }
      if (showDiscard) { setShowDiscard(false); return true }
      return false
    }

    // Opening an item moves focus into its card, so the decision shortcuts work
    // without a click and are scoped to the card from the first keystroke.
    useEffect(() => {
      if (view !== 'foco' || selected === null) return
      detailRef.current?.focus()
    }, [selected, view])

    useEffect(() => {
      const onKey = (event: KeyboardEvent): void => {
        if (value === undefined) return
        const target = event.target as HTMLElement | null
        const inField = target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        const command = event.ctrlKey || event.metaKey
        // Escape closes the innermost control even when focus sits inside it;
        // that is the only shortcut that must reach a focused checkbox or field.
        if (event.key === 'Escape') {
          if (closeTopControl()) return
          if (inField) { (event.target as HTMLElement).blur(); return }
          setSelected(null)
          return
        }
        // Every other shortcut stays inert inside a field, modifiers included,
        // so typing a draft never leaves the item.
        if (inField) return
        // A dialog owns the decision while it is open: its own buttons and
        // Escape handle it, and no letter command can run behind it (§9.9).
        const dialogOpen = showApprove || showDiscard || showRevert || showReconcile
          || showRetry || showClose || exitMode !== null
        if (dialogOpen) return
        // Shortcuts are card commands: with focus outside the card they do nothing,
        // so typing in another panel or on the shell never decides an item.
        const card = cardRef.current
        const origin = event.target as Node | null
        const focused = document.activeElement
        const inside = (node: Node | null): boolean => node !== null && node instanceof Node && card !== null && card.contains(node)
        if (!inside(origin) && !inside(focused)) return
        // Another tab owns the attempt: its exits stay shut here, keyboard
        // included, so this tab can never finish or save work it does not hold.
        if (command && event.key === 'Enter') {
          event.preventDefault()
          if (otherTabHolds) return
          if (live) { setExitMode('apply'); setCandidateChoice(null) } else iterate()
          return
        }
        if (command && (event.key === 's' || event.key === 'S')) {
          event.preventDefault()
          if (otherTabHolds) return
          if (live) leaveIteration('guardar-y-salir')
          else save()
          return
        }
        if (live) {
          // The item is frozen while the attempt holds it: only its chat reopens.
          if (event.key === 'i' || event.key === 'I') iterate()
          return
        }
        if (event.key === 'ArrowRight') { event.preventDefault(); next(); return }
        // E15 decision keys: Revertir inside a delegated window, Reintentar
        // after a failed effect, Conciliar while the outcome is unknown. Each
        // opens its panel and none executes by itself (§9.9).
        if (delegated) {
          if (event.key === 'v' || event.key === 'V') {
            event.preventDefault()
            if (windowOpen) setShowRevert(true)
            return
          }
        }
        if (outcomeFailed && (event.key === 'r' || event.key === 'R')) {
          event.preventDefault()
          setShowRetry(true)
          return
        }
        if (outcomeUnknown) {
          if (event.key === 'c' || event.key === 'C') {
            event.preventDefault()
            // Conciliar asks the destination when the board's adapter can be
            // asked, and only otherwise asks the operator for the answer (§9.8).
            if (probeAvailable) probeDestination()
            else openManualReconcile()
            return
          }
          // The effect may already exist: correct and discard stay shut so the
          // follow-up is never lost (W-76).
          if (event.key === 'd' || event.key === 'D' || event.key === 'g' || event.key === 'G') {
            event.preventDefault()
            return
          }
        }
        if (event.key === 'a' || event.key === 'A') {
          // Approving directly is only right when no edit waits and nothing
          // needs confirming; with either, A opens the panel like the button
          // does, so no external effect starts from a shortcut alone (W-73).
          if (pending !== null || value.stale || pendingConfirmations.length > 0 || draftChanged) {
            openApprove()
            return
          }
          if (blockedReason !== null) { setMessage(blockedReason); return }
          approve()
          return
        }
        if (event.key === 'g' || event.key === 'G') { event.preventDefault(); save(); return }
        if (event.key === 'e' || event.key === 'E') { event.preventDefault(); editRef.current?.focus(); return }
        if (event.key === 's' || event.key === 'S') { event.preventDefault(); severityRef.current?.focus(); return }
        if (event.key === 'd' || event.key === 'D') { event.preventDefault(); setShowDiscard(true); return }
        if (event.key === 'i' || event.key === 'I') { iterate(); return }
        if (event.key === 'v' || event.key === 'V') { event.preventDefault(); showView(view === 'lista' ? 'foco' : 'lista'); return }
        if (event.key === 'r' || event.key === 'R') {
          event.preventDefault()
          if (!value.stale) { setMessage(t('mesa.notStale')); return }
          apply(boardRevalidate(value.id, true))
          return
        }
        if (event.key === 'c' || event.key === 'C') { event.preventDefault(); setSelected(null); return }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    })

    const tabs = (
      <span className={styles.tools}>
        <button className={view === 'foco' ? styles.primary : styles.secondary} type="button" onClick={() => showView('foco')}>{t('mesa.tab.foco')}</button>
        <button className={view === 'kanban' ? styles.primary : styles.secondary} type="button" onClick={() => showView('kanban')}>{t('mesa.tab.kanban')}</button>
        <button className={view === 'lista' ? styles.primary : styles.secondary} type="button" onClick={() => showView('lista')}>{t('mesa.tab.lista')}</button>
      </span>
    )

    const filters = (
      <span className={`${styles.tools} ${styles.mesaFilters}`}>
        <select value={spaceFilter} aria-label={t('mesa.space')} onChange={event => setSpaceFilter(event.target.value)}>
          <option value="">{t('mesa.allSpaces')}</option>
          {spaceOptions.map(space => (
            <option key={space.id} value={space.id}>{`${'\u00a0\u00a0'.repeat(space.depth)}${space.title}`}</option>
          ))}
        </select>
        <select value={accountFilter} aria-label={t('mesa.account')} onChange={event => setAccountFilter(event.target.value)}>
          <option value="">{t('mesa.filter.accountAll')}</option>
          {accountOptions.map(account => <option key={account} value={account}>{account}</option>)}
        </select>
        <select value={severityFilter} aria-label={t('mesa.severity')} onChange={event => setSeverityFilter(event.target.value)}>
          <option value="">{t('mesa.allSeverities')}</option>
          {SEVERITIES.map(severity => <option key={severity} value={severity}>{t(severityKey(severity))}</option>)}
        </select>
      </span>
    )

    // The scope bar replaces a bare count: it says what the queue is made of
    // and how much a filter is hiding, which is what decides whether to clear it.
    const scopeBar = (
      <div className={styles.mesaScope}>
        <span>{`${t('mesa.column.tu')}: ${String(visible.filter(row => row.column === 'TU_CRITERIO').length)}`}</span>
        <span className={unclassifiedCount > 0 ? styles.mesaScopeAlert : undefined}>{`${t('mesa.unclassified')}: ${String(unclassifiedCount)}`}</span>
        {unclassifiedCount === 0 ? null : (
          <button className={styles.secondary} type="button" onClick={classifyPending} disabled={classifying}>
            {t('mesa.classify.pending')}
          </button>
        )}
        <span className={criticalCount > 0 ? styles.mesaScopeAlert : undefined}>{`${t('mesa.scope.critical')}: ${String(criticalCount)}`}</span>
        {overdueCount === 0 ? null : <span className={styles.mesaScopeAlert}>{`${t('mesa.scope.overdue')}: ${String(overdueCount)}`}</span>}
        {outsideCount === 0 ? null : <span>{`${t('mesa.scope.outside')}: ${String(outsideCount)}`}</span>}
        {outsideUnclassified === 0 ? null : (
          <span className={styles.mesaScopeAlert}>{`${t('mesa.scope.outsideUnclassified')}: ${String(outsideUnclassified)}`}</span>
        )}
        {outsideNoSpace === 0 ? null : <span>{`${t('mesa.scope.outsideNoSpace')}: ${String(outsideNoSpace)}`}</span>}
        {outsideCritical === 0 ? null : (
          <span className={styles.mesaScopeAlert}>{`${t('mesa.scope.outsideCritical')}: ${String(outsideCritical)}`}</span>
        )}
      </div>
    )

    const queue = (
      <nav className={styles.mesaQueue} aria-label={t('mesa.queue')}>
        <div className={styles.mesaQueueHead}>
          <span>{t('mesa.queue')}</span>
          <span>{String(visible.length)}</span>
        </div>
        <ol className={styles.mesaQueueList}>
          {railRows.map(row => (
            <li key={row.id}>
              <button
                type="button"
                className={styles.mesaQueueRow}
                aria-current={row.id === selected ? 'true' : undefined}
                onClick={() => setSelected(row.id)}
              >
                <span className={styles.mesaSeverity} data-severity={row.severity ?? 'none'}>{t(severityKey(row.severity))}</span>
                <span className={styles.mesaQueueTitle}>{row.title}</span>
                <span className={styles.mesaQueueMeta}>{kickerOf(row.accountRef, row.spaceId)}</span>
              </button>
            </li>
          ))}
        </ol>
        {railRows.length < visible.length ? <p className={styles.mesaHintLine}>{t('mesa.railMore')}</p> : null}
      </nav>
    )

    // One notice is visible; the rest fold behind a counter (spec E4).
    const notices: { title: string; body?: string; action?: ReactNode }[] = []
    // Another tab holds the attempt: the item is read here, the draft area stays
    // closed, and this tab offers no exit. One notice says why (§9.7.1).
    if (otherTabHolds) {
      notices.push({ title: t('mesa.iteration.otherTab'), body: t('mesa.iteration.otherTabText') })
    } else {
      if (pending !== null) {
        // During an attempt the choice belongs to Aplicar or Descartar, which
        // resolve the candidate and the attempt in one command; a standalone
        // adoption would move the version out from under the attempt.
        notices.push({
          title: t('mesa.candidate'),
          ...live ? { body: t('mesa.iteration.candidateInAttempt') } : {},
          ...live ? {} : {
            action: (
              <span className={styles.tools}>
                <button className={styles.primary} type="button" onClick={() => apply(boardResolveCandidate(value?.id ?? '', pending.id, pending.hash, 'adopt'))}>{t('mesa.adopt')}</button>
                <button className={styles.secondary} type="button" onClick={() => apply(boardResolveCandidate(value?.id ?? '', pending.id, pending.hash, 'keep'))}>{t('mesa.keep')}</button>
              </span>
            ),
          },
        })
      }
      if (retainedDraft !== null) {
        notices.push({
          title: t('mesa.iterationDraft'),
          body: t('mesa.iterationDraftText'),
          // Resuming stays shut while a candidate waits: the choice is applied
          // first, then the notices recalculate and the draft can be resumed
          // (W-91). The title says why instead of leaving a dead button.
          action: (
            <button
              className={styles.secondary}
              type="button"
              disabled={pending !== null}
              title={pending === null ? undefined : t('mesa.blocked.candidate')}
              onClick={iterate}
            >
              {t('mesa.iterationOpen')}
            </button>
          ),
        })
      }
      // Work a collision moved here from the item it closed is offered for
      // review or recovery, never applied by itself (§2.3, W-98). One notice
      // covers every transferred draft; the rest of the notices fold behind the
      // counter (E4). Recovering starts an attempt, so a live attempt leaves only
      // the comparison.
      if (transferred.length > 0) {
        notices.push({
          title: t('mesa.iteration.diffTitle'),
          body: t('mesa.iteration.transferredText'),
          action: (
            <span className={styles.tools}>
              {live ? null : (
                <button className={styles.primary} type="button" onClick={recoverTransferred}>
                  {t('mesa.iteration.transferredRecover')}
                </button>
              )}
              <button className={styles.secondary} type="button" onClick={compareTransferred}>
                {t('mesa.iteration.transferredReview')}
              </button>
            </span>
          ),
        })
      }
      if (foreignDraft) {
        notices.push({
          title: t('mesa.foreignDraft'),
          body: t('mesa.foreignDraftText'),
          action: (
            <button className={styles.secondary} type="button" onClick={() => apply(boardTakeDraft(value?.id ?? '', writerSession))}>{t('mesa.takeControl')}</button>
          ),
        })
      }
      if (value !== undefined && value.stale) notices.push({ title: value.staleReason ?? t('mesa.stale') })
    }

    const noticeBlock = notices.length === 0 ? null : (
      <div className={styles.mesaNotice} role="status">
        <div className={styles.mesaNoticeHead}>
          <strong>{notices[0]?.title}</strong>
          {notices[0]?.body === undefined ? null : <span>{notices[0].body}</span>}
        </div>
        {notices[0]?.action}
        {notices.length === 1 ? null : (
          <details className={styles.mesaCollapse}>
            <summary>{`${String(notices.length - 1)} ${notices.length === 2 ? t('mesa.moreNotices') : t('mesa.moreNoticesPlural')}`}</summary>
            <div className={styles.mesaCollapseBody}>
              {notices.slice(1).map((notice, index) => (
                <div key={`${notice.title}-${String(index)}`}>
                  <strong>{notice.title}</strong>
                  {notice.body === undefined ? null : <p className={styles.mesaHintLine}>{notice.body}</p>}
                  {notice.action}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    )

    // A late confirmation raises one visible alert and never reopens its item
    // (W-85). The newest is shown; the rest fold behind a counter.
    const alertRows = alerts.kind === 'ready' ? alerts.value : []
    const alertLine = (alert: FaberLoomBoardEffectAlertRow): string =>
      t(alert.kind === 'LATE_CONFIRMATION' ? 'mesa.effect.alert.late' : 'mesa.effect.alert.orphan')
        .replace('{item}', alert.itemTitle ?? alert.itemId)
    const alertText = (alert: FaberLoomBoardEffectAlertRow): string =>
      t(alert.kind === 'LATE_CONFIRMATION' ? 'mesa.effect.alert.lateText' : 'mesa.effect.alert.orphanText')
    const alertBlock = alertRows.length === 0 ? null : (
      <div className={styles.mesaNotice} role="status">
        <div className={styles.mesaNoticeHead}>
          <strong>{alertLine(alertRows[0] as FaberLoomBoardEffectAlertRow)}</strong>
          <span>{alertText(alertRows[0] as FaberLoomBoardEffectAlertRow)}</span>
        </div>
        {alertRows.length === 1 ? null : (
          <details className={styles.mesaCollapse}>
            <summary>{`${String(alertRows.length - 1)} ${t('mesa.effect.alert.more')}`}</summary>
            <div className={styles.mesaCollapseBody}>
              {alertRows.slice(1).map(alert => (
                <p className={styles.mesaHintLine} key={`${alert.itemId}-${alert.updatedAt}`}>
                  {`${alertLine(alert)} · ${alertText(alert)}`}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    )

    const detailBody = detail.kind === 'loading'
      ? <StateBlock kind="loading" title={t('state.loading')} />
      : detail.kind === 'error'
        ? <StateBlock kind="error" title={t('state.error')} text={detail.message} />
        : value === undefined
          ? <StateBlock kind="empty" title={t('mesa.empty')} text={rows.length === 0 ? t('mesa.emptyHint') : t('mesa.noSelection')} />
          : (
            <article className={styles.mesaMain} ref={detailRef} tabIndex={-1}>
              {noticeBlock}
              <header className={styles.mesaIdentity} data-zone="1">
                <div className={styles.mesaKicker}>
                  <span>{value.artifactType.length === 0 ? t('mesa.detail.draft') : value.artifactType}</span>
                  <span aria-hidden="true">·</span>
                  <span>{value.accountRef ?? t('mesa.noAccount')}</span>
                </div>
                <h2 className={styles.mesaTitle}>{value.title}</h2>
                <div className={styles.mesaMeta}>
                  {value.column === 'TU_CRITERIO' ? null : <span>{t(columnKey(value.column))}</span>}
                  <span>{value.dueAt === null ? t('mesa.noDue') : dayOf(value.dueAt)}</span>
                  {restricted || value.valueUsd === null ? null : <span>{`${money.format(value.valueUsd)} ${t('mesa.usd')}`}</span>}
                  <span>{`${t('mesa.autonomy')}: ${t(autonomyKey(value.autonomyLevel))}`}</span>
                </div>
                <div className={styles.mesaProperties}>
                  <label className={styles.mesaProperty}>
                    <span>{t('mesa.severity')}</span>
                    <select
                      ref={severityRef}
                      value={value.severity ?? ''}
                      data-severity={value.severity ?? 'none'}
                      disabled={!editable}
                      aria-label={t('mesa.severity')}
                      onChange={(event) => {
                        if (event.target.value.length === 0) return
                        apply(boardSetSeverity(value.id, event.target.value, value.rowVersion))
                      }}
                    >
                      <option value="">{t('mesa.unclassified')}</option>
                      {SEVERITIES.map(severity => <option key={severity} value={severity}>{t(severityKey(severity))}</option>)}
                    </select>
                    {value.severitySource === null ? null : (
                      <span className={styles.mesaHintLine}>{t(severitySourceKey(value.severitySource))}</span>
                    )}
                  </label>
                  <label className={styles.mesaProperty}>
                    <span>{t('mesa.agent')}</span>
                    <select
                      value={value.assigneeId ?? ''}
                      disabled={!editable}
                      aria-label={t('mesa.agent')}
                      onChange={(event) => {
                        apply(boardAssignAgent(value.id, event.target.value.length === 0 ? null : event.target.value, value.rowVersion))
                      }}
                    >
                      <option value="">{t('mesa.agent.none')}</option>
                      {(overview?.agents ?? []).map(agent => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.mesaProperty}>
                    <span>{t('mesa.space')}</span>
                    <select
                      value={value.spaceId ?? ''}
                      disabled={!editable}
                      aria-label={t('mesa.space')}
                      onChange={(event) => {
                        if (event.target.value.length === 0) return
                        assignSpace(event.target.value)
                      }}
                    >
                      <option value="">{t('mesa.noSpace')}</option>
                      {spaceOptions.map(space => (
                        <option key={space.id} value={space.id}>{`${'\u00a0\u00a0'.repeat(space.depth)}${space.title}`}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </header>

              <details className={styles.mesaCollapse} data-zone="2">
                <summary>{t('mesa.detail.origin')}</summary>
                <div className={styles.mesaCollapseBody}>
                  <dl className={styles.mesaFacts}>
                    <div>
                      <dt>{t('mesa.evidence')}</dt>
                      <dd>
                        {value.evidence.length === 0
                          ? t('cell.none')
                          : (
                            <ul className={styles.mesaEvidenceList}>
                              {value.evidence.map((entry, index) => {
                                const key = storageKeyOf(entry)
                                return (
                                  <li key={`${index}-${entry.slice(0, 24)}`}>
                                    <span>{evidenceLabel(entry)}</span>
                                    {key === null ? null : (
                                      <button className={styles.linkButton} type="button" onClick={() => openDocument(key)}>
                                        {t('mesa.document.link')}
                                      </button>
                                    )}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                      </dd>
                    </div>
                  </dl>
                  {value.fieldOrigins.length === 0 ? null : (
                    <dl className={styles.mesaFacts}>
                      <div>
                        <dt>{t('mesa.detail.origins')}</dt>
                        <dd>
                          {value.fieldOrigins.every(origin => origin.source === null)
                            ? t('mesa.origins.noneDeclared')
                            : value.fieldOrigins
                              .filter(origin => origin.source !== null)
                              .map(origin => `${origin.field} ← ${origin.source ?? ''}`)
                              .join(' · ')}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              </details>

              {live && attempt !== undefined ? (
                <p className={styles.mesaAttempt} role="status">
                  <span className={styles.mesaAttemptDot} aria-hidden="true" />
                  {remaining === null
                    ? t('mesa.iteration.live')
                    : `${t('mesa.iteration.live')} · ${t('mesa.iteration.remaining')} ${String(remaining)} ${t('mesa.iteration.minutes')}`}
                </p>
              ) : null}

              {live && attempt !== undefined && attempt.rounds >= attempt.roundLimit ? (
                <p className={styles.mesaHintLine}>
                  {t('mesa.iteration.roundLimit').replace('{rounds}', String(attempt.rounds))}
                </p>
              ) : null}

              {effectZone ? (
                <section className={styles.mesaChecksZone} aria-label={t('mesa.effect.title')}>
                  <h3>{t('mesa.effect.title')}</h3>
                  {delegated ? (
                    effectStatus === null ? (
                      <p className={styles.mesaHintLine}>{t('state.loading')}</p>
                    ) : (
                      <>
                        <p className={styles.mesaHintLine}>
                          {t('mesa.effect.delegatedText')
                            .replace('{action}', effectActionLabel)
                            .replace('{destination}', effectStatus.destination ?? t('mesa.none'))}
                        </p>
                        <p className={styles.mesaAttempt} role="timer">
                          <span className={styles.mesaAttemptDot} aria-hidden="true" />
                          {windowOpen
                            ? t('mesa.effect.remaining').replace('{time}', countdown)
                            : t('mesa.effect.windowClosed')}
                        </p>
                      </>
                    )
                  ) : effectRunning ? (
                    <>
                      <p className={styles.mesaAttempt} role="status">
                        <span className={styles.mesaAttemptDot} aria-hidden="true" />
                        {t('mesa.effect.pending')}
                      </p>
                      <p className={styles.mesaHintLine}>
                        {t('mesa.effect.pendingText')
                          .replace('{destination}', effectStatus?.destination ?? t('mesa.none'))}
                      </p>
                    </>
                  ) : outcomeUnknown ? (
                    <>
                      <p className={styles.mesaBlocked}>{t('mesa.effect.unknown')}</p>
                      <p className={styles.mesaHintLine}>{t('mesa.effect.unknownText')}</p>
                    </>
                  ) : (
                    <>
                      <p className={styles.mesaBlocked}>{t('mesa.effect.failed')}</p>
                      <p className={styles.mesaHintLine}>{t('mesa.effect.failedText')}</p>
                    </>
                  )}
                  {probeAnswer === null || probeAnswer.itemId !== value.id ? null : (
                    <p className={styles.mesaHintLine} role="status">
                      {probeAnswer.asked && probeAnswer.outcome !== null
                        ? t(PROBE_KEYS[probeAnswer.outcome])
                        : t('mesa.effect.probe.unavailable')}
                    </p>
                  )}
                  <dl className={styles.mesaFacts}>
                    <div><dt>{t('mesa.effect.action')}</dt><dd>{effectActionLabel}</dd></div>
                    <div>
                      <dt>{t('mesa.effect.destination')}</dt>
                      <dd>{effectStatus?.destination ?? t('mesa.none')}</dd>
                    </div>
                    {effectStatus?.idempotencyKey === null || effectStatus?.idempotencyKey === undefined
                      ? null
                      : (
                        <div>
                          <dt>{t('mesa.effect.idempotency')}</dt>
                          <dd>{effectStatus.idempotencyKey}</dd>
                        </div>
                      )}
                  </dl>
                </section>
              ) : null}


              <section className={styles.mesaDraftZone} data-zone="3">
                <div className={styles.mesaZoneHead}>
                  <h3>{t('mesa.detail.draft')}</h3>
                  {live
                    ? <span className={styles.mesaHintLine}>{t('mesa.iteration.draftHint')}</span>
                    : value.editDraft !== null && !foreignDraft
                      ? <span className={styles.mesaHintLine} role="status">{t('mesa.draftSaved')}</span>
                      : null}
                </div>
                {restricted
                  ? <StateBlock kind="empty" title={t('mesa.restricted')} text={t('mesa.restrictedText')} />
                  : (
                    <>
                      <textarea
                        ref={editRef}
                        className={styles.mesaDraft}
                        aria-label={t('mesa.detail.draft')}
                        value={(live ? iterationDraft ?? attempt?.draft?.summary ?? value.summary : draft) ?? ''}
                        disabled={otherTabHolds || (!live && !editable)}
                        onChange={(event) => {
                          if (live) {
                            setIterationDraft(event.target.value)
                            draftText.current = event.target.value
                          } else setDraft(event.target.value)
                        }}
                      />
                      {live ? null : routing ? (
                        <div className={styles.tools}>
                          <input
                            type="text"
                            value={instruction}
                            placeholder={t('mesa.router.placeholder')}
                            aria-label={t('mesa.router.label')}
                            onChange={event => setInstruction(event.target.value)}
                            disabled={!editable}
                          />
                          <button
                            className={styles.secondary}
                            type="button"
                            onClick={applyInstruction}
                            disabled={!editable || instruction.trim().length === 0}
                          >
                            {t('mesa.router.apply')}
                          </button>
                          {routedFields.filter(field => field !== 'summary').map(field => (
                            <button
                              key={field}
                              className={styles.ghost}
                              type="button"
                              onClick={() => setInstruction(`@${field} = `)}
                              disabled={!editable}
                            >
                              {`@${field}`}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button className={styles.mesaRouterToggle} type="button" onClick={() => setRouting(true)} disabled={!editable}>
                          {t('mesa.router.label')}
                        </button>
                      )}
                    </>
                  )}
              </section>

              {differences.length === 0 ? null : (
                <section className={styles.mesaDiff} aria-label={t('mesa.iteration.diffTitle')}>
                  <h3>{t('mesa.iteration.diffTitle')}</h3>
                  <p className={styles.mesaHintLine}>{t('mesa.iteration.diffText')}</p>
                  <dl className={styles.mesaDiffList}>
                    {differences.map(difference => (
                      <div key={difference.field}>
                        <dt>{difference.field}</dt>
                        <dd>
                          <span className={styles.mesaDiffOld}>{difference.currentValue}</span>
                          <span aria-hidden="true">→</span>
                          <span className={styles.mesaDiffNew}>{difference.draftValue}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section className={styles.mesaChecksZone} data-zone="4">
                <h3>{t('mesa.detail.checks')}</h3>
                {checksError === null ? null : <p className={styles.mesaHintLine}>{`${t('mesa.checks.error')} ${checksError}`}</p>}
                {missingChecks.length === 0 ? null : <p className={styles.mesaBlocked}>{t('mesa.checks.missing')}</p>}
                {checks.length === 0 && missingChecks.length === 0 && checksError === null
                  ? <p className={styles.mesaHintLine}>{value.checksDeclared.length === 0 ? t('mesa.checks.notApplicable') : t('mesa.noChecks')}</p>
                  : checks.map(check => (
                    <div className={styles.mesaCheck} data-status={check.status} key={check.id}>
                      <span className={styles.mesaCheckStatus}>{t(checkStatusKey(check.status))}</span>
                      <span className={styles.mesaCheckName}>{checkName(t, check.id)}</span>
                      <span className={styles.mesaCheckSource}>{`${check.source} · ${dayOf(check.checkedAt)}`}</span>
                    </div>
                  ))}
              </section>

              <dl className={styles.mesaFacts} data-zone="5">
                <div>
                  <dt>{t('mesa.detail.doubts')}</dt>
                  <dd>
                    {value.doubts.length === 0
                      ? (
                        <>
                          <span>{t('mesa.doubts.reviewed')}</span>
                          {value.severitySource === null ? null : (
                            <span className={styles.mesaHintLine}>
                              {t('mesa.doubts.source').replace('{source}', t(severitySourceKey(value.severitySource)))}
                            </span>
                          )}
                        </>
                      )
                      : (
                        <ul className={styles.mesaEvidenceList}>
                          {value.doubts.map((doubt, index) => <li key={`${index}-${doubt.slice(0, 24)}`}>{doubt}</li>)}
                        </ul>
                      )}
                  </dd>
                </div>
              </dl>

              <details className={styles.mesaCollapse} data-zone="6">
                <summary>{t('mesa.originContext')}</summary>
                <div className={styles.mesaCollapseBody}>
                  <dl className={styles.mesaFacts}>
                    <div>
                      <dt>{t('mesa.origin.source')}</dt>
                      <dd>{value.runId === null ? t('mesa.origin.manual') : t('mesa.origin.mcp')}</dd>
                    </div>
                    <div><dt>{t('mesa.origin.client')}</dt><dd>{value.accountRef ?? t('mesa.noAccount')}</dd></div>
                    {codeOf(/PF\s*\d{4}-\d{4}/iu) === null ? null : (
                      <div><dt>{t('mesa.origin.proforma')}</dt><dd>{codeOf(/PF\s*\d{4}-\d{4}/iu)}</dd></div>
                    )}
                    {codeOf(/(?:PO|OC)\s*\d{4,}/iu) === null ? null : (
                      <div><dt>{t('mesa.origin.order')}</dt><dd>{codeOf(/(?:PO|OC)\s*\d{4,}/iu)}</dd></div>
                    )}
                    {codeOf(/Expediente\s+[\w-]+/iu) === null ? null : (
                      <div>
                        <dt>{t('mesa.origin.expediente')}</dt>
                        <dd>{(codeOf(/Expediente\s+[\w-]+/iu) ?? '').replace(/^Expediente\s+/iu, '')}</dd>
                      </div>
                    )}
                    <div><dt>{t('mesa.space')}</dt><dd>{spaceName(value.spaceId)}</dd></div>
                    <div>
                      <dt>{t('mesa.origin.documents')}</dt>
                      <dd>
                        {value.documentRef === null
                          ? t('mesa.document.none')
                          : (
                            <button className={styles.linkButton} type="button" onClick={() => openDocument(value.documentRef)}>
                              {t('mesa.document.open')}
                            </button>
                          )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>

              <footer className={styles.mesaActionBar} data-zone="7">
                <div className={styles.mesaActions}>
                  {live && otherTabHolds ? (
                    <button className={styles.ghost} type="button" onClick={next}>{t('mesa.skip')}</button>
                  ) : live ? (
                    <>
                      <button
                        className={styles.primary}
                        type="button"
                        onClick={() => { setExitMode('apply'); setCandidateChoice(null) }}
                      >
                        {t('mesa.iteration.apply')}
                      </button>
                      <button
                        className={styles.danger}
                        type="button"
                        onClick={() => { setExitMode('discard'); setCandidateChoice(null) }}
                      >
                        {t('mesa.iteration.discardChanges')}
                      </button>
                      <button
                        className={styles.secondary}
                        type="button"
                        onClick={() => leaveIteration('guardar-y-salir')}
                      >
                        {t('mesa.iteration.saveExit')}
                      </button>
                      <button
                        className={styles.ghost}
                        type="button"
                        onClick={() => leaveIteration('llevar-a-spaceloom', () => {
                          if (value.spaceId !== null) goToWorkspace(value.spaceId)
                        })}
                      >
                        {t('mesa.iteration.toSpaceloom')}
                      </button>
                    </>
                  ) : effectZone ? (
                    <>
                      {delegated ? (
                        <button
                          ref={effectTriggerRef}
                          className={styles.danger}
                          type="button"
                          disabled={!windowOpen}
                          onClick={() => setShowRevert(true)}
                        >
                          {t('mesa.effect.revert')}
                        </button>
                      ) : null}
                      {outcomeUnknown ? (
                        <button
                          ref={effectTriggerRef}
                          className={styles.primary}
                          type="button"
                          onClick={probeAvailable ? probeDestination : openManualReconcile}
                        >
                          {t('mesa.effect.reconcile')}
                        </button>
                      ) : null}
                      {outcomeUnknown ? (
                        <button
                          className={styles.secondary}
                          type="button"
                          disabled={!mayRetry}
                          onClick={() => setShowRetry(true)}
                        >
                          {t('mesa.effect.retry')}
                        </button>
                      ) : null}
                      {outcomeFailed ? (
                        <button
                          ref={effectTriggerRef}
                          className={styles.primary}
                          type="button"
                          onClick={() => setShowRetry(true)}
                        >
                          {t('mesa.effect.retry')}
                        </button>
                      ) : null}
                      {outcomeFailed ? (
                        <button className={styles.secondary} type="button" onClick={() => editRef.current?.focus()}>
                          {t('mesa.effect.correct')}
                        </button>
                      ) : null}
                      {outcomeUnknown && canAdminClose ? (
                        <button className={styles.danger} type="button" onClick={() => setShowClose(true)}>
                          {t('mesa.effect.adminClose')}
                        </button>
                      ) : null}
                      {effectRunning ? <span className={styles.mesaHintLine}>{t('mesa.effect.noDecision')}</span> : null}
                      <button className={styles.ghost} type="button" onClick={next}>{t('mesa.skip')}</button>
                    </>
                  ) : (
                    <>
                      <button
                        ref={approveButtonRef}
                        className={styles.primary}
                        type="button"
                        disabled={!editable || pending !== null || value.stale || value.severity === null
                          || missingChecks.length > 0 || blockingFail !== undefined}
                        onClick={openApprove}
                      >
                        {t('action.approve')}
                      </button>
                      <button
                        className={styles.secondary}
                        type="button"
                        disabled={!editable || draft === null || draft === value.summary}
                        onClick={save}
                      >
                        {t('action.save')}
                      </button>
                      <button className={styles.secondary} type="button" disabled={!editable} onClick={iterate}>{t('mesa.iterate')}</button>
                      <button className={styles.ghost} type="button" onClick={next}>{t('mesa.skip')}</button>
                      <button
                        className={styles.danger}
                        type="button"
                        disabled={!editable || pending !== null}
                        onClick={() => setShowDiscard(true)}
                      >
                        {t('action.discard')}
                      </button>
                    </>
                  )}
                </div>
                <details className={styles.mesaCollapse}>
                  <summary>{t('mesa.shortcutsTitle')}</summary>
                  <p className={styles.mesaHintLine}>{t('mesa.shortcuts')}</p>
                </details>
              </footer>
              {blockedReason === null ? null : <p className={styles.mesaBlocked}>{blockedReason}</p>}
              {outcomeUnknown && !mayRetry
                ? <p className={styles.mesaBlocked}>{t('mesa.effect.retryBlocked')}</p>
                : null}

              {showApprove ? (
                <section
                  className={`${styles.mesaNotice} ${styles.mesaDialog}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mesa-approve-title"
                  tabIndex={-1}
                  ref={approvePanelRef}
                  onKeyDown={trapDialogTab}
                >
                  <strong id="mesa-approve-title">
                    {executing ? t('mesa.approveEffect.title') : t('mesa.confirmApprove')}
                  </strong>
                  <span>{executing ? t('mesa.approveEffect.text') : t('mesa.approvePanel')}</span>
                  <Field label={t('mesa.effect.action')}>
                    <select
                      value={execAction}
                      aria-label={t('mesa.effect.action')}
                      onChange={(event) => { setExecAction(event.target.value) }}
                    >
                      <option value="">{t('mesa.approveEffect.none')}</option>
                      {actionTypes.map(actionType => (
                        <option key={actionType} value={actionType}>{actionLabel(actionType)}</option>
                      ))}
                    </select>
                  </Field>
                  {executing ? (
                    <>
                      <Field label={t('mesa.approveEffect.destination')}>
                        <input
                          type="text"
                          aria-label={t('mesa.approveEffect.destination')}
                          value={execDestination}
                          onChange={(event) => { setExecDestination(event.target.value) }}
                        />
                      </Field>
                      <dl className={styles.mesaFacts}>
                        <div>
                          <dt>{t('mesa.approveEffect.amount')}</dt>
                          <dd>
                            {restricted || value.valueUsd === null
                              ? t('mesa.approveEffect.restricted')
                              : `${money.format(value.valueUsd)} ${t('mesa.usd')}`}
                          </dd>
                        </div>
                      </dl>
                      {windowMsOf(execAction) === null ? null : (
                        <p className={styles.mesaHintLine}>
                          {t('mesa.approveEffect.window')
                            .replace('{minutes}', String(Math.round((windowMsOf(execAction) ?? 0) / 60_000)))}
                        </p>
                      )}
                    </>
                  ) : null}
                  {pendingConfirmations.length === 0 ? null : (
                    <fieldset className={styles.mesaConfirmations}>
                      <legend>{t('mesa.checks.confirmTitle')}</legend>
                      {pendingConfirmations.map(check => (
                        <label className={styles.mesaConfirmation} key={check.id}>
                          <input
                            type="checkbox"
                            checked={confirmations.includes(check.id)}
                            onChange={(event) => {
                              setConfirmations(current => event.target.checked
                                ? [...current, check.id]
                                : current.filter(id => id !== check.id))
                            }}
                          />
                          <span>{`${checkName(t, check.id)}: ${t(checkStatusKey(check.status))}`}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <span className={styles.tools}>
                    <button
                      className={styles.primary}
                      type="button"
                      disabled={!confirmedAll || (executing && execDestination.trim().length === 0)}
                      onClick={approve}
                    >
                      {executing ? t('mesa.approveEffect.confirm') : t('action.confirm')}
                    </button>
                    <button className={styles.ghost} type="button" onClick={resetApproval}>{t('action.cancel')}</button>
                  </span>
                </section>
              ) : null}

              {showDiscard ? (
                <section className={styles.mesaNotice} role="dialog" aria-modal="true" aria-label={t('mesa.discardReason')}>
                  <Field label={t('mesa.discardReason')}>
                    <select value={discardReason} onChange={event => setDiscardReason(event.target.value)}>
                      {REASONS.map(reason => <option key={reason} value={reason}>{t(`mesa.reason.${reason.toLowerCase()}` as FaberloomKey)}</option>)}
                    </select>
                  </Field>
                  {discardReason === 'OTRA' ? <Field label={t('mesa.discardNote')}><input type="text" value={discardNote} onChange={event => setDiscardNote(event.target.value)} /></Field> : null}
                  <span className={styles.tools}>
                    <button className={styles.danger} type="button" onClick={discard}>{t('action.discard')}</button>
                    <button className={styles.ghost} type="button" onClick={() => setShowDiscard(false)}>{t('action.cancel')}</button>
                  </span>
                </section>
              ) : null}

              {showRevert ? (
                <section
                  className={styles.mesaNotice}
                  role="region"
                  aria-label={t('mesa.effect.revertTitle')}
                  ref={effectPanelRef}
                  tabIndex={-1}
                >
                  <strong>{t('mesa.effect.revertTitle')}</strong>
                  <span>{t('mesa.effect.revertText')}</span>
                  <Field label={t('mesa.effect.reason')}>
                    <select
                      value={revertReason}
                      aria-label={t('mesa.effect.reason')}
                      onChange={event => setRevertReason(event.target.value)}
                    >
                      {REASONS.map(reason => (
                        <option key={reason} value={reason}>
                          {t(`mesa.reason.${reason.toLowerCase()}` as FaberloomKey)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <span className={styles.tools}>
                    <button
                      className={styles.danger}
                      type="button"
                      disabled={!windowOpen}
                      onClick={revertExecution}
                    >
                      {t('mesa.effect.revert')}
                    </button>
                    <button className={styles.ghost} type="button" onClick={() => setShowRevert(false)}>
                      {t('action.cancel')}
                    </button>
                  </span>
                </section>
              ) : null}

              {showReconcile ? (
                <section
                  className={styles.mesaNotice}
                  role="region"
                  aria-label={t('mesa.effect.reconcileTitle')}
                  ref={effectPanelRef}
                  tabIndex={-1}
                >
                  <strong>{t('mesa.effect.reconcileTitle')}</strong>
                  <span>{t('mesa.effect.reconcileText')}</span>
                  {probeAvailable ? null : <p className={styles.mesaHintLine}>{t('mesa.effect.reconcileNoProbe')}</p>}
                  <Field label={t('mesa.effect.reconcileTitle')}>
                    <select
                      value={reconcileOutcome}
                      aria-label={t('mesa.effect.reconcileTitle')}
                      onChange={event => setReconcileOutcome(event.target.value as FaberLoomBoardEffectOutcome)}
                    >
                      {OUTCOMES.map(outcome => (
                        <option key={outcome} value={outcome}>
                          {t(`mesa.effect.outcome.${outcome.toLowerCase()}` as FaberloomKey)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <span className={styles.tools}>
                    <button className={styles.primary} type="button" onClick={reconcileExecution}>
                      {t('mesa.effect.confirmReconcile')}
                    </button>
                    <button className={styles.ghost} type="button" onClick={() => setShowReconcile(false)}>
                      {t('action.cancel')}
                    </button>
                  </span>
                </section>
              ) : null}

              {showRetry ? (
                <section
                  className={`${styles.mesaNotice} ${styles.mesaDialog}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mesa-retry-title"
                  tabIndex={-1}
                  ref={effectPanelRef}
                  onKeyDown={trapDialogTab}
                >
                  <strong id="mesa-retry-title">{t('mesa.effect.retryTitle')}</strong>
                  <span>
                    {t('mesa.effect.retryText').replace('{destination}', effectStatus?.destination ?? t('mesa.none'))}
                  </span>
                  <dl className={styles.mesaFacts}>
                    <div><dt>{t('mesa.effect.action')}</dt><dd>{effectActionLabel}</dd></div>
                    <div>
                      <dt>{t('mesa.effect.idempotency')}</dt>
                      <dd>{effectStatus?.idempotencyKey ?? t('mesa.none')}</dd>
                    </div>
                  </dl>
                  <span className={styles.tools}>
                    <button
                      className={styles.primary}
                      type="button"
                      disabled={outcomeUnknown && !mayRetry}
                      onClick={retryExecution}
                    >
                      {t('mesa.effect.retry')}
                    </button>
                    <button className={styles.ghost} type="button" onClick={() => setShowRetry(false)}>
                      {t('action.cancel')}
                    </button>
                  </span>
                </section>
              ) : null}

              {showClose ? (
                <section
                  className={`${styles.mesaNotice} ${styles.mesaDialog}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mesa-close-title"
                  tabIndex={-1}
                  ref={effectPanelRef}
                  onKeyDown={trapDialogTab}
                >
                  <strong id="mesa-close-title">{t('mesa.effect.adminCloseTitle')}</strong>
                  <span>{t('mesa.effect.adminCloseText')}</span>
                  <p className={styles.mesaHintLine}>{t('mesa.effect.closeFollowUp')}</p>
                  <Field label={t('mesa.effect.closeReason')}>
                    <input
                      type="text"
                      aria-label={t('mesa.effect.closeReason')}
                      value={closeReason}
                      onChange={event => setCloseReason(event.target.value)}
                    />
                  </Field>
                  <span className={styles.tools}>
                    <button
                      className={styles.danger}
                      type="button"
                      disabled={closeReason.trim().length === 0}
                      onClick={closeWithPendingReconciliation}
                    >
                      {t('mesa.effect.close')}
                    </button>
                    <button className={styles.ghost} type="button" onClick={() => setShowClose(false)}>
                      {t('action.cancel')}
                    </button>
                  </span>
                </section>
              ) : null}

              {exitMode === null ? null : (
                <section
                  className={`${styles.mesaNotice} ${styles.mesaDialog}`}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mesa-iteration-exit"
                  tabIndex={-1}
                  onKeyDown={trapDialogTab}
                >
                  <strong id="mesa-iteration-exit">
                    {t(exitMode === 'apply' ? 'mesa.iteration.applyTitle' : 'mesa.iteration.discardTitle')}
                  </strong>
                  <span>{t(exitMode === 'apply' ? 'mesa.iteration.applyText' : 'mesa.iteration.discardText')}</span>
                  {exitMode === 'apply' ? (
                    <Field label={t('mesa.iteration.scope')}>
                      <select
                        value={scope}
                        aria-label={t('mesa.iteration.scope')}
                        onChange={(event) => { setScope(event.target.value as FaberLoomBoardCorrectionScope) }}
                      >
                        {SCOPES.map(option => (
                          <option key={option} value={option}>
                            {t(`mesa.iteration.scope.${option}` as FaberloomKey)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  {attempt?.candidatePending === true && pending !== null ? (
                    <fieldset className={styles.mesaConfirmations}>
                      <legend>{t('mesa.iteration.candidateAsk')}</legend>
                      <span className={styles.tools}>
                        <button
                          className={candidateChoice === 'adopt' ? styles.primary : styles.secondary}
                          type="button"
                          aria-pressed={candidateChoice === 'adopt'}
                          onClick={() => setCandidateChoice('adopt')}
                        >
                          {t('mesa.adopt')}
                        </button>
                        <button
                          className={candidateChoice === 'keep' ? styles.primary : styles.secondary}
                          type="button"
                          aria-pressed={candidateChoice === 'keep'}
                          onClick={() => setCandidateChoice('keep')}
                        >
                          {t('mesa.keep')}
                        </button>
                      </span>
                    </fieldset>
                  ) : null}
                  <span className={styles.tools}>
                    <button
                      className={exitMode === 'apply' ? styles.primary : styles.danger}
                      type="button"
                      disabled={candidateBlocked}
                      onClick={exitMode === 'apply' ? applyIteration : discardIteration}
                    >
                      {t(exitMode === 'apply' ? 'mesa.iteration.apply' : 'mesa.iteration.discardChanges')}
                    </button>
                    {exitMode === 'apply'
                      ? (
                        <button className={styles.ghost} type="button" onClick={() => leaveIteration('volver-sin-resolver')}>
                          {t('mesa.iteration.exitUnresolved')}
                        </button>
                      )
                      : null}
                    <button className={styles.ghost} type="button" onClick={() => setExitMode(null)}>{t('action.cancel')}</button>
                  </span>
                </section>
              )}
            </article>
          )

    /** Catalog agent name for one id; an absent agent is its own state. */
    const agentName = (id: string | null): string =>
      id === null ? t('mesa.agent.none') : overview?.agents.find(agent => agent.id === id)?.name ?? id

    // A card is also the drag handle: dropping it on another priority column
    // states the human's priority for that item, which the board learns from.
    const cardOf = (row: FaberLoomBoardRow): ReactNode => (
      <button
        className={styles.mesaCard}
        key={row.id}
        type="button"
        draggable
        title={t('mesa.card.drag')}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', row.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => openItem(row.id)}
      >
        <span className={styles.mesaKicker}>{kickerOf(row.accountRef, row.spaceId)}</span>
        <strong>{row.title}</strong>
        <span className={styles.mesaCardFoot}>
          <span className={styles.mesaSeverity} data-severity={row.severity ?? 'none'}>{t(severityKey(row.severity))}</span>
          <span className={styles.mesaQueueMeta}>{agentName(row.assigneeId)}</span>
        </span>
      </button>
    )

    /**
     * Move one card to another priority. The drop is the human's decision, so it
     * writes the priority as `HUMAN` and the board teaches the pair from it.
     * @param itemId - card that was dropped.
     * @param severity - priority of the column it landed in.
     */
    const dropOnPriority = (itemId: string, severity: string): void => {
      const row = rows.find(entry => entry.id === itemId)
      if (row === undefined || row.severity === severity) return
      apply(boardSetSeverity(row.id, severity, row.rowVersion))
    }

    // Kanban columns are the priority itself: moving a card is how the human
    // states what matters, and the live agent learns that pair from the move.
    const kanban = visible.length === 0
      ? emptyBlock
      : (
        <div className={styles.mesaColumns}>
          {SEVERITIES.map((severity) => {
            const cards = visible.filter(row => row.severity === severity)
            return (
              <section
                className={styles.mesaColumn}
                key={severity}
                data-severity={severity}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  dropOnPriority(event.dataTransfer.getData('text/plain'), severity)
                }}
              >
                <h3>{t(severityKey(severity))} <span className={styles.mesaQueueMeta}>{String(cards.length)}</span></h3>
                {cards.length === 0
                  ? <p className={styles.mesaColumnEmpty}>{t('mesa.column.empty')}</p>
                  : cards.map(cardOf)}
              </section>
            )
          })}
          {visible.some(row => row.severity === null) ? (
            <section className={styles.mesaColumn} data-severity="none">
              <h3>
                {t('mesa.unclassified')}
                <span className={styles.mesaQueueMeta}>{String(visible.filter(row => row.severity === null).length)}</span>
              </h3>
              {visible.filter(row => row.severity === null).map(cardOf)}
            </section>
          ) : null}
        </div>
      )

    const columns: readonly Column<{
      id: string
      title: string
      spaceId: string | null
      accountRef: string | null
      assigneeId: string | null
      severity: string | null
      dueAt: string | null
      valueUsd: number | null
    }>[] = [
      {
        key: 'title',
        header: t('col.title'),
        cell: row => <span className={styles.cellName}>{row.title}</span>,
      },
      { key: 'account', header: t('mesa.account'), cell: row => <span className={styles.cellMuted}>{row.accountRef ?? t('mesa.none')}</span> },
      { key: 'agent', header: t('mesa.agent'), cell: row => <span className={styles.cellMuted}>{agentName(row.assigneeId)}</span> },
      { key: 'space', header: t('mesa.space'), cell: row => <span className={styles.cellMuted}>{row.spaceId === null ? t('mesa.none') : spaceName(row.spaceId)}</span> },
      { key: 'severity', header: t('mesa.severity'), cell: row => <span className={styles.mesaSeverity} data-severity={row.severity ?? 'none'}>{t(severityKey(row.severity))}</span> },
      { key: 'due', header: t('mesa.due'), cell: row => <span className={styles.cellMuted}>{row.dueAt === null ? t('mesa.none') : dayOf(row.dueAt)}</span> },
      { key: 'amount', header: t('mesa.amount'), align: 'end', cell: row => <span className={styles.cellMuted}>{row.valueUsd === null || row.valueUsd === undefined ? t('mesa.none') : money.format(row.valueUsd)}</span> },
    ]

    const list = <DataTable columns={columns} rows={visible} selectedId={selected ?? ''} onSelect={openItem} emptyTitle={emptyTitle} emptyText={emptyText} labels={tableLabels(t)} />

    return (
      <Screen title={t('panel.board.title')} subtitle={t('panel.board.intro')} trailing={tabs}>
        <Feedback t={t} message={error ?? message} />
        {filters}
        {scopeBar}
        {roundExhausted && view === 'foco' ? (
          <div className={styles.mesaNotice} role="status">
            <div className={styles.mesaNoticeHead}><span>{t('mesa.skippedOnly')}</span></div>
            <span className={styles.tools}>
              <button className={styles.secondary} type="button" onClick={restartRound}>{t('mesa.restartRound')}</button>
            </span>
          </div>
        ) : null}
        {alertBlock}
        {view === 'foco'
          ? (visible.length === 0
            ? emptyBlock
            : (
              <div className={styles.mesaFoco} ref={cardRef}>
                {queue}
                {detailBody}
              </div>
            ))
          : view === 'kanban'
            ? kanban
            : list}
      </Screen>
    )
  }
}

/** Rutinas: routines with the full definition editor. */
function routinesScreen() {
  return function FaberloomRoutines(props: ScreenProps) {
    const {
      t, createRoutine, setRoutineActive, routineDetail, saveRoutine, removeRoutine, executions,
      startRoutine, tickRoutine, reconcileExecution, cancelExecutionEffect, setRoutineVisibility,
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
    const [spaceId, setSpaceId] = useState('')
    const rows = overview?.routines ?? []
    const chosen = rows.find(row => row.id === selected) ?? null
    const detail = useLazy<FaberLoomRoutineDetail | undefined>(
      () => selected === null ? Promise.resolve({ ok: true, value: undefined }) : routineDetail(selected),
      [selected],
    )
    const cloud = detail.kind === 'ready' ? detail.value?.cloud : undefined
    const [runs, setRuns] = useState<readonly FaberLoomExecutionRow[]>([])
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
      setSpaceId(detail.value.spaceId ?? '')
      setMessage(null)
    }, [detail])

    const columns: readonly Column<FaberLoomOverview['routines'][number]>[] = [
      { key: 'name', header: t('col.name'), cell: routine => <span className={styles.cellName}>{routine.name}</span> },
      { key: 'status', header: t('col.status'), cell: routine => <Chip>{routine.status}</Chip> },
      {
        key: 'cloud',
        header: t('routines.cloud'),
        cell: routine => routine.cloud === undefined
          ? null
          : <Chip>{routine.cloud.cloudReady ? t('routines.cloudCloud') : t('routines.cloudPc')}</Chip>,
      },
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
      setSpaceId('')
      setMessage(null)
    }

    const save = (): void => {
      setMessage(null)
      if (drafting) {
        createRoutine(name.trim().length === 0 ? t('routines.untitled') : name.trim(), spaceId.length === 0 ? null : spaceId)
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
        spaceId: spaceId.length === 0 ? null : spaceId,
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
                      {chosen?.shared === true && chosen.canDelete !== true ? null : (
                        <button className={styles.danger} type="button" onClick={() => {
                          if (selected === null) return
                          setMessage(null)
                          void removeRoutine(selected)
                            .then((result) => { if (!result.ok) setMessage(result.error.message); else setSelected(null) })
                            .catch((cause: unknown) => { setMessage(String(cause)) })
                        }}>{t('action.delete')}</button>
                      )}
                      {chosen?.shared !== true ? (
                        <button className={styles.secondary} type="button" onClick={() => {
                          if (selected !== null) setRoutineVisibility(selected, chosen?.visibility === 'private' ? 'shared' : 'private')
                        }}>{chosen?.visibility === 'private' ? t('action.makeShared') : t('action.makePrivate')}</button>
                      ) : null}
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
                        <Field label={t('routines.space')} hint={t('routines.spaceHint')}>
                          <select aria-label={t('routines.space')} value={spaceId} onChange={(event) => { setSpaceId(event.target.value) }}>
                            <option value="">{t('routines.noSpace')}</option>
                            {(overview?.spaces ?? []).map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
                          </select>
                        </Field>
                        {cloud === undefined ? null : (
                          <Field label={t('routines.cloud')} hint={t('routines.cloudHint')}>
                            <div className={styles.steps}>
                              <Chip>{cloud.cloudReady ? t('routines.cloudCloud') : t('routines.cloudPc')}</Chip>
                              <span className={styles.cellMuted}>{cloud.note}</span>
                            </div>
                          </Field>
                        )}
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
                          <RoutineRuns t={t} runs={runs}
                            onReconcile={(runId) => { applyRun(reconcileExecution(runId)) }}
                            onCancelEffect={(runId, stepId) => { applyRun(cancelExecutionEffect(runId, stepId)) }} />
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
    const { t, remember, spaceMemory, deleteSpaceMemory, setMemoryVisibility, openSession } = props
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
    // A memory that a finished turn captured carries that Session, and its text
    // is the turn distilled, so the conversation is the evidence behind the row.
    // The list names it; a Session this host no longer lists reads as gone
    // instead of offering an action that cannot run.
    const sourceSessionId = chosen?.sessionId ?? null
    const sourceSession = props.useSessions(state => sourceSessionId === null
      ? null
      : state.byId[sourceSessionId as never] ?? null)
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
      { key: 'at', header: t('col.date'), cell: row => <span className={styles.cellData}>{row.createdAt}</span> },
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
              {chosen !== null && chosen.shared !== true ? (
                <button className={styles.secondary} type="button" onClick={() => {
                  setMessage(null)
                  void setMemoryVisibility(chosen.id, chosen.visibility === 'private' ? 'shared' : 'private').then((result) => {
                    if (!result.ok) { setMessage(result.error.message); return }
                    setReload(value => value + 1)
                  }).catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{chosen.visibility === 'private' ? t('action.makeShared') : t('action.makePrivate')}</button>
              ) : null}
              {chosen?.shared === true && chosen.canDelete !== true ? null : (
                <button className={styles.danger} type="button" onClick={() => {
                  if (chosen === null) return
                  setMessage(null)
                  void deleteSpaceMemory(chosen.id).then((result) => {
                    if (!result.ok) { setMessage(result.error.message); return }
                    setSelected(null)
                    setReload(value => value + 1)
                  }).catch((cause: unknown) => { setMessage(String(cause)) })
                }}>{t('memory.delete')}</button>
              )}
            </>
          )}>
          {/* A row rather than a Field: this one can hold a button, and a button
              inside a label takes the whole field as its accessible name. */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('field.origin')}</span>
            {sourceSessionId === null
              ? <span className={styles.cellMuted}>{kindOf(chosen?.text ?? '')}</span>
              : sourceSession === null
                ? <span className={styles.cellMuted}>{t('memory.conversationGone')}</span>
                : (
                  <span className={styles.tools}>
                    <span className={styles.cellMuted}>{sourceSession.displayTitle}</span>
                    <button className={styles.secondary} type="button"
                      onClick={() => { openSession(sourceSession.id) }}>{t('memory.openConversation')}</button>
                  </span>
                )}
          </div>
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
    const [editorOpen, setEditorOpen] = useState(false)
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

    /** Open the editor on a fresh record: a new connection must not inherit the last one's values. */
    const startNewConnection = (): void => {
      setSelected(null)
      setMessage(null)
      setProbe(null)
      setKind('imap')
      setLabel('')
      setHost('')
      setPort('993')
      setSecure(true)
      setStarttls(false)
      setUsername('')
      setSecret('')
      setDestination('')
      setRetention('30')
      setEditorOpen(true)
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
      { key: 'security', header: t('col.security'), cell: row => row.kind === 'backup' ? <span className={styles.cellMuted}>{t('cell.none')}</span> : <Chip tone={row.secure || row.starttls ? 'accent' : 'muted'}>{row.secure ? t('connections.modeTls') : row.starttls ? t('connections.modeStarttls') : t('connections.modeNone')}</Chip> },
      { key: 'target', header: t('col.target'), cell: row => <span className={styles.cellMuted}>{row.kind === 'imap' || row.kind === 'smtp' ? [row.username, row.host].filter(part => part !== null && part.length > 0).join(' · ') : row.destination ?? ''}</span> },
    ]

    return (
      <Screen title={t('panel.connections.title')} subtitle={t('panel.connections.intro')}
        trailing={<button className={styles.primary} type="button" onClick={startNewConnection}>{t('connections.new')}</button>}>
        <Feedback t={t} message={message} />
        {list === null
          ? <StateBlock kind="loading" title={t('state.loading')} />
          : <DataTable columns={columns} rows={list.map(row => ({ ...row }))} selectedId={selected}
            onSelect={(id) => { setSelected(id); setEditorOpen(true) }}
            emptyTitle={t('connections.emptyTitle')} emptyText={t('connections.emptyText')} labels={tableLabels(t)} />}
        <Modal
          open={editorOpen}
          onClose={() => { setEditorOpen(false) }}
          title={chosen?.label ?? t('connections.newTitle')}
          closeLabel={t('action.close')}
          className={styles.panelDialog ?? ''}
          footer={(
            <>
              {chosen === null ? null : (
                <button className={styles.danger} type="button" onClick={() => {
                  void removeConnection(chosen.id).then(apply)
                  setSelected(null)
                  setEditorOpen(false)
                }}>{t('action.delete')}</button>
              )}
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
              <button className={styles.ghost} type="button" onClick={() => { setEditorOpen(false) }}>{t('action.close')}</button>
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
        </Modal>
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

/** Public gateway origin a desktop renderer cannot derive from its `dsh-app:` origin. */
const MCP_PUBLIC_ORIGIN = 'https://harness.mwt.one'

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
  'faberloom_agent_purge',
  'faberloom_models',
  'faberloom_model_register',
  'faberloom_agent_resolve_model',
  'faberloom_agent_recommend_model',
  'faberloom_agent_record_outcome',
  'faberloom_board',
  'faberloom_board_get',
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
  'faberloom_skills',
  'faberloom_skill_save',
  'faberloom_skill_remove',
  'faberloom_memory',
  'faberloom_memory_remember',
  'faberloom_memory_update',
  'faberloom_memory_forget',
  'faberloom_context',
  'faberloom_context_create',
  'faberloom_context_update',
  'faberloom_context_remove',
  'faberloom_workflows',
  'faberloom_workflow_get',
  'faberloom_workflow_create',
  'faberloom_workflow_update',
  'faberloom_workflow_delete',
  'faberloom_workflow_node_add',
  'faberloom_workflow_node_update',
  'faberloom_workflow_node_remove',
  'faberloom_workflow_connect',
  'faberloom_workflow_disconnect',
  'faberloom_email_inbox',
  'faberloom_email_read',
  'faberloom_space_from_email',
  'faberloom_mcp_servers',
  'faberloom_mcp_server_save',
  'faberloom_mcp_server_remove',
  'faberloom_mcp_server_probe',
  'faberloom_workspaces',
  'faberloom_workspace_create',
  'faberloom_sessions',
  'faberloom_session_create',
  'faberloom_session_send',
  'faberloom_routine_get',
  'faberloom_routine_create',
  'faberloom_routine_update',
  'faberloom_routine_remove',
  'faberloom_routine_active',
  'faberloom_routine_visibility',
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
  const allSelected = scopes.length === MCP_TOOL_NAMES.length
  const columns: readonly Column<FaberLoomMcpTokenRow & { readonly id: string }>[] = [
    { key: 'label', header: t('mcp.label'), cell: row => <span className={styles.cellName}>{row.label}</span> },
    {
      key: 'token',
      header: t('mcp.token'),
      cell: row => (
        <input className={styles.tokenValue} type="text" readOnly value={row.token}
          aria-label={`${t('mcp.token')} ${row.label}`}
          onFocus={(event) => { event.currentTarget.select() }} />
      ),
    },
    { key: 'state', header: t('col.status'), cell: row => <Chip>{row.revokedAt === null ? t('grants.active') : t('grants.revoked')}</Chip> },
    { key: 'scopes', header: t('mcp.scopes'), cell: row => <span className={styles.cellMuted}>{row.scopes === null ? t('mcp.allTools') : row.scopes.join(', ')}</span> },
    {
      key: 'actions',
      header: t('mcp.actions'),
      cell: row => row.revokedAt === null
        ? (
          <button className={styles.danger} type="button" onClick={() => {
            setMessage(null)
            void revokeMcpToken(row.token).then(apply).catch((cause: unknown) => { setMessage(String(cause)) })
          }}>{t('mcp.revoke')}</button>
        )
        : <span className={styles.cellMuted}>{t('grants.revoked')}</span>,
    },
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
        <div className={styles.mcpScopeHead}>
          <span className={styles.hint}>{allSelected ? t('mcp.allTools') : scopes.length === 0 ? t('mcp.allTools') : `${String(scopes.length)} ${t('mcp.selected')}`}</span>
          <label className={styles.stepFlag}>
            <input type="checkbox" checked={allSelected}
              onChange={(event) => { setScopes(event.target.checked ? [...MCP_TOOL_NAMES] : []) }} />
            {t('mcp.selectAll')}
          </label>
          {scopes.length > 0 && (
            <button className={styles.linkButton} type="button" onClick={() => { setScopes([]) }}>{t('mcp.clearSelection')}</button>
          )}
        </div>
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
      <DataTable columns={columns} rows={tableRows} selectedId={null} onSelect={() => {}}
        emptyTitle={t('mcp.empty')} emptyText={t('mcp.emptyText')} labels={tableLabels(t)} />
      <div className={styles.mcpConnect}>
        <Inspector title={t('mcp.detail')}>
          <Field label={t('mcp.endpoint')}><span className={styles.cellMuted}>{`${typeof window === 'undefined' || !window.location.origin.startsWith('http') ? MCP_PUBLIC_ORIGIN : window.location.origin}${MCP_ENDPOINT_PATH}`}</span></Field>
          <Field label={t('mcp.how')} hint={t('mcp.howHint')}><span className={styles.mcpHowText}>{t('mcp.howText')}</span></Field>
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
      t, startConversation, proposeWork, createAgentFromWork, createRoutineFromWork, linkPreview,
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
              <span className={styles.cellMuted}>{t('propose.mesaHint')}</span>
            </>
          )}
        </Inspector>
      </Screen>
    )
  }
}

/**
 * Sidebar brand name beside the mark. Renders the shared two-tone wordmark so
 * "Faber" holds the coral alias and "Loom" takes the ink of its ground, rather
 * than the shell's one-ink text label. The name is a proper noun, so it carries
 * no locale dictionary entry.
 * @returns the FaberLoom wordmark without the separately slotted mark.
 */
export function FaberloomBrandName() {
  return <BrandWordmark className={styles.brandName} includeMark={false} />
}

/**
 * The product brand mark: the FaberLoom 3x3 isotipo, cream on the dark theme
 * and ink on the light one. It occupies `sidebar.brand.mark` and
 * `conversation.hero.brand.mark`, replacing the harness's own mark.
 * @param props.size - the pixel height the slot asks for.
 * @returns the theme-appropriate mark image.
 */
export function FaberloomBrandMark({ size = 24 }: { size?: number }) {
  return (
    <span className={styles.brandMark} style={{ height: size }}>
      <img className={styles.brandMarkDark} src="/faberloom_isotipo_dark.svg" alt="" />
      <img className={styles.brandMarkLight} src="/faberloom_isotipo_mono.svg" alt="" />
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
  /** Sidebar mode this row lives under: `nav.mode.*`. */
  modeKey: FaberloomKey
  /** Group inside the mode: `nav.group.*`. */
  groupKey: FaberloomKey
  /** Live overview count for the row badge; omitted when the overview carries no such number. */
  badge?: (overview: FaberLoomOverview) => number
  /** Sidebar row occupant. */
  Icon: FaberloomPanelIconType
  /** Main-panel occupant. */
  Page: FaberloomPanelBody
  /** Whether the sidebar lists a row for the panel (default true). */
  sidebar?: boolean
}

/** Copy seat a section's navigation metadata resolves through. */
export type FaberloomCopy = (key: FaberloomKey) => string

/** One sidebar row's resolved navigation metadata. */
export interface FaberloomSectionNav {
  /** Mode label for the sidebar's three-mode bar. */
  mode: string
  /** Group label inside the mode. */
  group: string
  /** Row badge: the live overview count, or an empty string when there is none. */
  badge: string
}

/**
 * Resolve a section's row badge from the live overview. A section without an
 * overview count, or a zero count, yields no badge — a count is never invented.
 * @param section - the section row.
 * @param overview - the live overview, or null before the first read.
 * @returns the badge text, or an empty string when the row carries none.
 */
export function sectionBadge(section: FaberloomSection, overview: FaberLoomOverview | null): string {
  if (section.badge === undefined || overview === null) return ''
  const count = section.badge(overview)
  return count === 0 ? '' : String(count)
}

/**
 * Resolve a section's localized mode, group, and badge together, for the
 * sidebar row metadata the surface contributes.
 * @param section - the section row.
 * @param t - copy seat bound to the faberloom namespace.
 * @param overview - the live overview, or null before the first read.
 * @returns the resolved mode, group, and badge strings.
 */
export function resolveSectionNav(
  section: FaberloomSection,
  t: FaberloomCopy,
  overview: FaberLoomOverview | null,
): FaberloomSectionNav {
  return {
    mode: t(section.modeKey),
    group: t(section.groupKey),
    badge: sectionBadge(section, overview),
  }
}

/** Every node kind the Work Flow inspector offers. */
const WORKFLOW_KINDS = [
  'trigger.manual', 'trigger.schedule', 'trigger.email', 'trigger.event', 'trigger.board',
  'agent', 'skill', 'mcp.call', 'imap.action', 'smtp.send', 'memory.remember', 'memory.teach',
  'board.create', 'space.reference', 'routine.invoke', 'condition', 'transform', 'wait', 'notify', 'deadletter',
] as const

/** Permission checkboxes a Work Flow share offers. */
export const SHARE_PERMISSION_OPTIONS = [
  'view', 'run', 'edit-graph', 'add-nodes', 'remove-nodes', 'edit-agents', 'manage-triggers', 'share',
  'view-memory', 'create-memory', 'edit-memory', 'delete-memory',
  'view-context', 'create-context', 'edit-context', 'delete-context',
  'view-workflows', 'create-workflows', 'edit-workflows', 'delete-workflows',
  'view-routines', 'create-routines', 'edit-routines', 'delete-routines',
] as const

/** Permission checkboxes a Space share offers, including moving its hierarchy. */
export const SPACE_SHARE_PERMISSION_OPTIONS = [
  ...SHARE_PERMISSION_OPTIONS,
  'create-subspace', 'move-space',
] as const

/**
 * The localized, human-readable label of one share-permission token. The base
 * Work Flow actions have their own names; a `<action>-<module>` token reads as
 * the action followed by the module (for example "Ver memoria").
 * @param t - the panel translator.
 * @param permission - the permission token.
 * @returns the label to show.
 */
export function sharePermissionLabel(t: PropsLocale<'faberloom'>['t'], permission: string): string {
  const base: Readonly<Record<string, FaberloomKey>> = {
    view: 'perm.view',
    run: 'perm.run',
    share: 'perm.share',
    'edit-graph': 'perm.editGraph',
    'add-nodes': 'perm.addNodes',
    'remove-nodes': 'perm.removeNodes',
    'edit-agents': 'perm.editAgents',
    'manage-triggers': 'perm.manageTriggers',
    'create-subspace': 'perm.createSubspace',
    'move-space': 'perm.moveSpace',
  }
  const mapped = base[permission]
  if (mapped !== undefined) return t(mapped)
  const match = /^(view|create|edit|delete)-(memory|context|workflows|routines)$/.exec(permission)
  if (match === null) return permission
  return `${t(`perm.${match[1]}` as FaberloomKey)} ${t(`perm.${match[2]}` as FaberloomKey)}`
}

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
    const { t, workflows, setWorkflowVisibility } = props
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
    const [flowSpaceId, setFlowSpaceId] = useState('')
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
    const [templatesOpen, setTemplatesOpen] = useState(false)
    const [nodeTab, setNodeTab] = useState<'node' | 'connections' | 'routines'>('node')
    const [routinePick, setRoutinePick] = useState('')
    const [versionsOpen, setVersionsOpen] = useState(false)
    const [flowVersions, setFlowVersions] = useState<readonly FaberLoomWorkflowVersionRow[]>([])
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
    // The Space picker lists only real Spaces; default to the first one so a new
    // flow always has a target once the topology arrives.
    useEffect(() => {
      const spaces = topology?.spaces ?? []
      if (spaces.length === 0) return
      setFlowSpaceId(current => spaces.some(space => space.id === current) ? current : spaces[0]?.id ?? '')
    }, [topology])
    const skillOptions = skillsState.kind === 'ready' ? skillsState.value : []
    const routineOptions = overview?.routines ?? []
    const selectedHealth = detail?.routineId === undefined || health === null
      ? null
      : health.routines.find(row => row.routineId === detail.routineId) ?? null
    const selectedSpaceId = flows.find(flow => flow.id === selected)?.spaceId ?? null
    const selectedFlow = flows.find(flow => flow.id === selected)
    const selectedFlowShared = selectedFlow?.shared === true && selectedFlow.canDelete !== true
    const selectedFlowReadOnly = selectedFlow?.shared === true && selectedFlow.canEdit !== true
    const selectedSpaceName = selectedSpaceId === null
      ? null
      : topology?.spaces.find(space => space.id === selectedSpaceId)?.title ?? selectedSpaceId

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
    /** Append a routine.invoke node bound to one existing routine. */
    const addRoutineNode = (flowId: string, routineId: string): void => {
      const routine = routineOptions.find(entry => entry.id === routineId)
      const before = new Set((detail?.nodesList ?? []).map(node => node.id))
      void workflows.addNode(flowId, 'routine.invoke', routine?.name ?? 'routine.invoke', JSON.stringify({ routineId, input: '' })).then((result) => {
        accept(result)
        if (!result.ok) return
        const added = result.value.nodesList.find(node => !before.has(node.id))
        if (added === undefined) return
        setNodeId(added.id)
        setTitle(added.title)
        setKind(added.kind)
        setFields(workflowFields(added.kind, added.config))
        setNodeTab('node')
        setNodeOpen(true)
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
    /** The display name of one node id. */
    const nodeName = (id: string): string => detail?.nodesList.find(node => node.id === id)?.title ?? id
    /** The edges incident to the picked node, incoming or outgoing. */
    const incidentEdges = (detail?.edgesList ?? []).filter(edge => edge.from === nodeId || edge.to === nodeId)

    return (
      <div className={styles.workflowScreen}>
        <aside className={styles.workflowSidebar}>
          <h3 className={styles.h2}>{t('wf.title')}</h3>
          <input value={flowName} placeholder={t('wf.namePlaceholder')} onChange={(event) => { setFlowName(event.target.value) }} />
          <select aria-label={t('wf.space')} value={flowSpaceId} onChange={(event) => { setFlowSpaceId(event.target.value) }}>
            {spaceOptions.map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
          </select>
          <button type="button" className={styles.primary} onClick={() => {
            if (flowName.trim().length === 0) return
            void workflows.create(flowName.trim(), flowSpaceId.length === 0 ? undefined : flowSpaceId).then((result) => { acceptFlows(result); if (result.ok) setFlowName('') })
          }}>{t('wf.create')}</button>
          <button type="button" onClick={() => { setTemplatesOpen(true) }}>{t('wf.templates')}</button>
          {flows.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.empty')}</span> : null}
          {flows.map(flow => (
            <button key={flow.id} type="button" className={`${styles.workflowFlowButton} ${selected === flow.id ? styles.workflowFlowButtonActive : ''}`} onClick={() => { setSelected(flow.id) }}>
              {flow.name} · {flow.status} · {flow.nodes}/{flow.edges}{flow.cloud === undefined ? '' : ` · ${flow.cloud.cloudReady ? t('routines.cloudCloud') : t('routines.cloudPc')}`}
            </button>
          ))}
        </aside>
        <main className={styles.workflowMain}>
          {message !== null ? <div className={styles.workflowMessage}>{message}</div> : null}
          {selected === null ? <span>{t('wf.select')}</span> : (
            <>
              <div className={styles.workflowToolbar}>
                {selectedFlowReadOnly ? <span className={styles.cellMuted}>{t('wf.readOnly')}</span> : null}
                {selectedFlow?.cloud === undefined ? null : (
                  <span className={styles.workflowSpaceLabel} title={selectedFlow.cloud.note}>
                    {selectedFlow.cloud.cloudReady ? t('routines.cloudCloud') : t('routines.cloudPc')}
                  </span>
                )}
                <button type="button" className={styles.primary} disabled={selectedFlowReadOnly} onClick={() => { act(() => workflows.setStatus(selected, 'active')) }}>{t('wf.activate')}</button>
                <button type="button" disabled={selectedFlowReadOnly} onClick={() => { act(() => workflows.setStatus(selected, 'paused')) }}>{t('wf.pause')}</button>
                {selectedFlowShared ? null : (
                  <button type="button" className={styles.danger} onClick={() => {
                    void workflows.remove(selected).then((result) => {
                      if (!result.ok) { setMessage(result.error.message); return }
                      setSelected(null)
                      setFlows(result.value)
                      setMessage(null)
                    })
                  }}>{t('action.delete')}</button>
                )}
                {selectedFlowShared ? null : (
                  <button type="button" onClick={() => {
                    // A private flow stops being shared: no other member, and no
                    // other member's agent, reads or edits it.
                    void setWorkflowVisibility(selected, selectedFlow?.visibility === 'private' ? 'shared' : 'private')
                      .then((result) => { if (result.ok) setFlows(result.value); else setMessage(result.error.message) })
                      .catch((error: unknown) => { setMessage(String(error)) })
                  }}>{selectedFlow?.visibility === 'private' ? t('action.makeShared') : t('action.makePrivate')}</button>
                )}
                <button type="button" className={styles.primary} disabled={selectedFlowReadOnly} onClick={() => { addNode(selected) }}>{t('wf.addNode')}</button>
                <button type="button" onClick={() => { setLogsOpen(true) }}>{t('wf.logs')}</button>
                <button type="button" onClick={() => { void workflows.workflowVersions(selected).then((result) => { if (result.ok) { setFlowVersions(result.value); setVersionsOpen(true) } }) }}>{t('wf.versions')}</button>
                <button type="button" onClick={() => { setShareOpen(true) }}>{t('wf.share')}</button>
                <button type="button" onClick={() => { void workflows.exportFlow(selected, 'json').then((result) => { if (result.ok) openWorkflowExport(result.value) }) }}>{t('wf.exportJson')}</button>
                <button type="button" onClick={() => { void workflows.exportFlow(selected, 'archify').then((result) => { if (result.ok) openWorkflowExport(result.value) }) }}>{t('wf.exportArchify')}</button>
                <input aria-label={t('wf.concurrency')} placeholder={t('wf.concurrency')} value={concurrency}
                  onChange={(event) => { setConcurrency(event.target.value) }} />
                <button type="button" disabled={selectedFlowReadOnly} onClick={() => { saveConcurrency(selected) }}>{t('wf.concurrency.save')}</button>
                {selectedSpaceName === null
                  ? <span className={styles.workflowSpaceLabel}>{t('wf.space')}: {t('wf.personal')}</span>
                  : <span className={styles.workflowSpaceLabel}>{t('wf.space')}: {selectedSpaceName}</span>}
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
                    {incidentEdges.length > 0 ? incidentEdges.map(edge => (
                      <div key={edge.id} className={styles.workflowRunRow}>
                        <span>{nodeName(edge.from)} → {nodeName(edge.to)}{edge.condition === null ? '' : ` · ${edge.condition}`}</span>
                        <button type="button" onClick={() => { dropEdge(selected, edge.id) }}>{t('wf.disconnect')}</button>
                      </div>
                    )) : <span className={styles.workflowEmpty}>{t('wf.noConnections')}</span>}
                  </div>
                ) : null}
                {nodeTab === 'routines' ? (
                  <div className={styles.workflowTabPanel}>
                    <Field label={t('wf.routine')}>
                      <select aria-label={t('wf.routine')} value={routinePick} onChange={(event) => { setRoutinePick(event.target.value) }}>
                        <option value="">—</option>
                        {routineOptions.map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
                      </select>
                    </Field>
                    <button type="button" className={styles.primary} disabled={routinePick.length === 0} onClick={() => { addRoutineNode(selected, routinePick) }}>{t('wf.addRoutineNode')}</button>
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
              <Modal open={versionsOpen} onClose={() => { setVersionsOpen(false) }} title={t('wf.versions')} closeLabel={t('action.close')}>
                {flowVersions.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.noVersions')}</span> : flowVersions.map(version => (
                  <div key={version.version} className={styles.workflowRunRow}>
                    <span>
                      <span className={styles.cellData}>{String(version.version)}</span>
                      {' · '}{version.name}{' · '}
                      <span className={styles.cellData}>{`${String(version.nodes)}/${String(version.edges)}`}</span>
                      {' · '}
                      <span className={styles.cellData}>{version.createdAt}</span>
                    </span>
                    <button type="button" onClick={() => { act(() => workflows.restoreWorkflow(selected, version.version)); setVersionsOpen(false) }}>{t('ctx.restore')}</button>
                  </div>
                ))}
              </Modal>
              {/* Run history and health live in the Logs modal. */}
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
              <Modal open={shareOpen} onClose={() => { setShareOpen(false) }} title={t('wf.share')} closeLabel={t('action.close')} className={styles.shareDialogWide ?? ''}>
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
                          {sharePermissionLabel(t, permission)}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <button type="button" className={styles.primary} onClick={() => { shareFlow(selected) }}>{t('wf.share.submit')}</button>
                </div>
                {grants.length === 0 ? <span className={styles.workflowEmpty}>{t('wf.share.none')}</span> : grants.map(grant => (
                  <div key={grant.id} className={styles.workflowRunRow}>
                    <span>{grant.granteeEmail}</span>
                    <span className={styles.workflowRunWhen}>{grant.permissions.map(permission => sharePermissionLabel(t, permission)).join(', ')}</span>
                    <span>{statusLabel(grant.status)}</span>
                    <button type="button" onClick={() => { revokeGrant(grant.id) }}>{t('wf.share.revoke')}</button>
                  </div>
                ))}
              </Modal>
            </>
          )}
          <Modal open={templatesOpen} onClose={() => { setTemplatesOpen(false) }} title={t('wf.templates')} closeLabel={t('action.close')}>
            <div className={styles.workflowForm}>
              <Field label={t('wf.templates')}>
                <select aria-label={t('wf.templates')} value={templateId} onChange={(event) => { setTemplateId(event.target.value) }}>
                  <option value="">{t('wf.templates.pick')}</option>
                  {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </Field>
              <button type="button" className={styles.primary} disabled={templateId.length === 0} onClick={() => { useTemplate(); setTemplatesOpen(false) }}>{t('wf.templates.use')}</button>
              <Field label={t('wf.import')}>
                <input type="file" accept="application/json,.json" onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file === undefined) return
                  void file.text().then(text => workflows.importFlow(text)).then((result) => {
                    acceptFlows(result)
                    setTemplatesOpen(false)
                  })
                  event.target.value = ''
                }} />
              </Field>
            </div>
          </Modal>
        </main>
      </div>
    )
  }
}

/** Contexto: the versioned, approvable Workspace/Space context, separate from Memory. */
/** Name one context entry's Space, or the personal scope, without leaking ids. */
function contextSpaceName(t: ScreenProps['t'], spaces: readonly { readonly id: string; readonly title: string }[], id: string | null): string {
  if (id === null) return t('ctx.personal')
  return spaces.find(space => space.id === id)?.title ?? t('memory.deletedSpace')
}

function contextScreen() {
  return function FaberloomContext(props: ScreenProps) {
    const { t } = props
    const { overview } = useOverview(props)
    const [reload, setReload] = useState(0)
    const list = useLazy<readonly FaberLoomContextRow[]>(() => props.context.entries(), [reload])
    const rows = list.kind === 'ready' ? list.value : []
    const [selected, setSelected] = useState<string | null>(null)
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [newTitle, setNewTitle] = useState('')
    const [newBody, setNewBody] = useState('')
    const [spaceId, setSpaceId] = useState('')
    const [versions, setVersions] = useState<readonly FaberLoomContextVersionRow[]>([])
    const [message, setMessage] = useState<string | null>(null)
    const chosen = rows.find(row => row.id === selected) ?? null

    const visibilityLabel = (visibility: string): string =>
      visibility === 'shared' ? t('ctx.visibility.shared')
        : visibility === 'pending' ? t('ctx.visibility.pending')
          : t('ctx.visibility.local')

    const versionLabel = (version: number): string => `${t('ctx.versionLabel')}${String(version)}`
    const versionDetail = (version: FaberLoomContextVersionRow): string =>
      `${versionLabel(version.version)} · ${version.authorId} · ${version.createdAt}`

    const refresh = (result: Result<readonly FaberLoomContextRow[]>): void => {
      if (result.ok) { setMessage(null); setReload(value => value + 1) } else setMessage(result.error.message)
    }
    const reloadVersions = (id: string): void => {
      void props.context.versions(id).then((next) => { if (next.ok) setVersions(next.value) })
    }
    const open = (id: string): void => {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) return
      setSelected(id)
      setTitle(row.title)
      setBody(row.body)
      reloadVersions(id)
    }

    const columns: readonly Column<FaberLoomContextRow>[] = [
      { key: 'title', header: t('col.title'), cell: row => <span className={styles.cellName}>{row.title}</span> },
      { key: 'visibility', header: t('ctx.visibility'), cell: row => <Chip>{visibilityLabel(row.visibility)}</Chip> },
      { key: 'space', header: t('col.space'), cell: row => <span className={styles.cellMuted}>{contextSpaceName(t, overview?.spaces ?? [], row.spaceId)}</span> },
      { key: 'version', header: t('ctx.version'), align: 'end', cell: row => <span className={styles.cellMuted}>{versionLabel(row.version)}</span> },
      { key: 'updated', header: t('col.date'), cell: row => <span className={styles.cellData}>{row.updatedAt}</span> },
    ]

    return (
      <Screen title={t('ctx.title')} subtitle={t('ctx.subtitle')}
        trailing={(
          <>
            <select className={styles.paneSearch} style={{ width: 200, padding: '8px 10px' }} value={spaceId} aria-label={t('ctx.space')}
              onChange={(event) => { setSpaceId(event.target.value) }}>
              <option value="">{t('ctx.personal')}</option>
              {(overview?.spaces ?? []).map(space => <option key={space.id} value={space.id}>{space.title}</option>)}
            </select>
            <input className={styles.paneSearch} style={{ width: 180, padding: '8px 10px' }} value={newTitle} placeholder={t('ctx.newPlaceholder')} onChange={(event) => { setNewTitle(event.target.value) }} />
            <input className={styles.paneSearch} style={{ width: 220, padding: '8px 10px' }} value={newBody} placeholder={t('ctx.bodyPlaceholder')} onChange={(event) => { setNewBody(event.target.value) }} />
            <button className={styles.primary} type="button" onClick={() => {
              if (newTitle.trim().length === 0) { setMessage(t('state.needsText')); return }
              setMessage(null)
              void props.context.create(newTitle.trim(), newBody, spaceId.length === 0 ? undefined : spaceId).then((result) => {
                if (result.ok) { setNewTitle(''); setNewBody('') }
                refresh(result)
              })
            }}>{t('ctx.create')}</button>
            <button className={styles.secondary} type="button" onClick={() => {
              void props.context.export(spaceId.length === 0 ? undefined : spaceId, 'json').then((result) => {
                if (!result.ok) { setMessage(result.error.message); return }
                const blob = new Blob([result.value.content], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = result.value.filename
                anchor.click()
                URL.revokeObjectURL(url)
              })
            }}>{t('ctx.export')}</button>
            <label className={`${styles.secondary} ${styles.fileAction}`} style={{ cursor: 'pointer' }}>
              {t('ctx.import')}
              <input type="file" accept="application/json,.json" style={{ display: 'none' }} aria-label={t('ctx.import')} onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file === undefined) return
                void file.text().then(text => props.context.import(text)).then(refresh)
              }} />
            </label>
          </>
        )}>
        <Feedback t={t} message={list.kind === 'error' ? list.message : message} />
        <DataTable columns={columns} rows={rows} selectedId={selected} onSelect={open}
          emptyTitle={t('state.empty.title')} emptyText={t('ctx.empty')} labels={tableLabels(t)} />
        <Modal
          open={selected !== null}
          onClose={() => { setSelected(null) }}
          title={chosen === null ? t('ctx.detail') : chosen.title}
          closeLabel={t('action.close')}
          className={styles.panelDialog ?? ''}
          footer={selected === null ? undefined : (
            <span className={styles.tools}>
              {chosen?.shared === true && chosen.canDelete !== true ? null : (
                <button className={styles.danger} type="button" onClick={() => {
                  void props.context.remove(selected).then((result) => { if (result.ok) setSelected(null); refresh(result) })
                }}>{t('ctx.remove')}</button>
              )}
              <button className={styles.secondary} type="button" onClick={() => {
                void props.context.approve(selected).then((result) => {
                  refresh(result); reloadVersions(selected)
                })
              }}>{t('ctx.approve')}</button>
              <button className={styles.secondary} type="button" onClick={() => {
                void props.context.reject(selected).then((result) => {
                  refresh(result); reloadVersions(selected)
                })
              }}>{t('ctx.reject')}</button>
              <button className={styles.ghost} type="button" onClick={() => { setSelected(null) }}>{t('action.close')}</button>
              <button className={styles.primary} type="button" onClick={() => {
                void props.context.update(selected, title, body).then((result) => { refresh(result); reloadVersions(selected) })
              }}>{t('ctx.save')}</button>
            </span>
          )}>
          {selected === null
            ? null
            : (
              <>
                <Field label={t('ctx.title')}><input aria-label={t('ctx.title')} value={title} onChange={(event) => { setTitle(event.target.value) }} /></Field>
                <Field label={t('ctx.body')}><textarea aria-label={t('ctx.body')} value={body} onChange={(event) => { setBody(event.target.value) }} /></Field>
                <p className={styles.hint}>{t('ctx.approveHint')}</p>
                <h4>{t('ctx.versions')}</h4>
                {versions.length === 0 ? <span className={styles.workflowEmpty}>{t('ctx.noVersions')}</span> : versions.map(version => (
                  <div key={version.version} className={styles.workflowRunRow}>
                    <span className={styles.cellMuted}>{versionDetail(version)}</span>
                    <button className={styles.ghost} type="button" onClick={() => {
                      void props.context.restore(selected, version.version).then((result) => {
                        refresh(result); reloadVersions(selected)
                      })
                    }}>{t('ctx.restore')}</button>
                  </div>
                ))}
              </>
            )}
        </Modal>
      </Screen>
    )
  }
}

/** One line of the work-flow approval diff. */
interface WorkflowDiffLine {
  readonly id: string
  readonly op: string
  readonly labelKey: 'approvals.nodeAdd' | 'approvals.nodeRemove' | 'approvals.nodeChange' | 'approvals.edgeAdd' | 'approvals.edgeRemove'
  readonly text: string
}

/** Compare a work-flow proposal against its base as labelled diff lines. */
function workflowDiffLines(base: FaberLoomWorkflowGraph, proposed: FaberLoomWorkflowGraph): readonly WorkflowDiffLine[] {
  const lines: WorkflowDiffLine[] = []
  const baseNodes = new Map(base.nodes.map(node => [node.id, node]))
  const proposedNodes = new Map(proposed.nodes.map(node => [node.id, node]))
  for (const node of proposed.nodes) {
    const before = baseNodes.get(node.id)
    if (before === undefined) {
      lines.push({ id: `+n${node.id}`, op: '+', labelKey: 'approvals.nodeAdd', text: `${node.title} (${node.kind})` })
      continue
    }
    if (before.title !== node.title || before.kind !== node.kind) {
      lines.push({ id: `~n${node.id}`, op: '~', labelKey: 'approvals.nodeChange', text: `${node.id}: ${before.title}/${before.kind} → ${node.title}/${node.kind}` })
    }
  }
  for (const node of base.nodes) {
    if (!proposedNodes.has(node.id)) lines.push({ id: `-n${node.id}`, op: '-', labelKey: 'approvals.nodeRemove', text: `${node.title} (${node.kind})` })
  }
  const edgeKey = (edge: { readonly from: string; readonly to: string }): string => `${edge.from} → ${edge.to}`
  const baseEdges = new Set(base.edges.map(edgeKey))
  const proposedEdges = new Set(proposed.edges.map(edgeKey))
  for (const edge of proposed.edges) {
    if (!baseEdges.has(edgeKey(edge))) lines.push({ id: `+e${edge.id}`, op: '+', labelKey: 'approvals.edgeAdd', text: edgeKey(edge) })
  }
  for (const edge of base.edges) {
    if (!proposedEdges.has(edgeKey(edge))) lines.push({ id: `-e${edge.id}`, op: '-', labelKey: 'approvals.edgeRemove', text: edgeKey(edge) })
  }
  return lines
}

/** Aprobaciones: the owner's pending context and staged work-flow changes. */
function approvalsScreen() {
  return function FaberloomApprovals(props: ScreenProps) {
    const { t, context, approvals } = props
    const { overview } = useOverview(props)
    const [contextRows, setContextRows] = useState<readonly FaberLoomContextRow[]>([])
    const [changes, setChanges] = useState<readonly FaberLoomWorkflowPendingRow[]>([])
    const [message, setMessage] = useState<string | null>(null)

    useEffect(() => {
      void approvals.contextEntries().then((result) => { if (result.ok) setContextRows(result.value) })
      void approvals.workflowChanges().then((result) => { if (result.ok) setChanges(result.value) })
    }, [approvals])

    const pendingContext = contextRows.filter(row => row.visibility === 'pending')
    const preview = (text: string): string => {
      const flat = text.replace(/\s+/g, ' ').trim()
      return flat.length <= 120 ? flat : `${flat.slice(0, 120).trimEnd()}…`
    }
    const decide = (row: FaberLoomContextRow, approve: boolean): void => {
      void (approve ? context.approve(row.id) : context.reject(row.id)).then((result) => {
        if (result.ok) setContextRows(result.value)
      })
    }
    const contextColumns: readonly Column<FaberLoomContextRow>[] = [
      { key: 'title', header: t('col.title'), cell: row => <span className={styles.cellName}>{row.title}</span> },
      { key: 'author', header: t('approvals.author'), cell: row => <span className={styles.cellData}>{row.authorId}</span> },
      { key: 'space', header: t('col.space'), cell: row => <span className={styles.cellMuted}>{contextSpaceName(t, overview?.spaces ?? [], row.spaceId)}</span> },
      { key: 'body', header: t('ctx.body'), cell: row => <span className={styles.cellMuted}>{preview(row.body)}</span> },
      {
        key: 'decide', header: t('approvals.decide'), cell: row => (
          <span className={styles.tools}>
            <button className={styles.primary} type="button" onClick={() => { decide(row, true) }}>{t('approvals.accept')}</button>
            <button className={styles.ghost} type="button" onClick={() => { decide(row, false) }}>{t('approvals.reject')}</button>
          </span>
        ),
      },
    ]

    return (
      <Screen title={t('approvals.title')} subtitle={t('approvals.subtitle')}
        trailing={(
          <button className={styles.secondary} type="button" onClick={() => {
            void approvals.syncContext().then((result) => {
              if (result.ok) setContextRows(result.value)
              else setMessage(result.error.message)
            })
          }}>{t('approvals.sync')}</button>
        )}>
        <Feedback t={t} message={message} />
        <section className={styles.workflowSection}>
          <h4>{t('approvals.context')} ({String(pendingContext.length)})</h4>
          <p className={styles.hint}>{t('approvals.pendingHint')}</p>
          <DataTable columns={contextColumns} rows={pendingContext} labels={tableLabels(t)}
            selectedId={null} onSelect={() => undefined}
            emptyTitle={t('state.empty.title')} emptyText={t('approvals.noContext')} />
        </section>
        <section className={styles.workflowSection}>
          <h4>{t('approvals.workflows')} ({String(changes.length)})</h4>
          <p className={styles.hint}>{t('approvals.flowHint')}</p>
          {changes.length === 0
            ? <span className={styles.workflowEmpty}>{t('approvals.noWorkflows')}</span>
            : changes.map(change => (
              <div key={change.workflowId} className={styles.workflowSection}>
                <div className={styles.workflowRunRow}>
                  <span className={styles.cellName}>
                    {change.name}
                    {' · '}{t('approvals.proposedBy')}{' '}
                    <span className={styles.cellData}>{change.proposerId}</span>
                    {' · '}
                    <span className={styles.cellData}>{String(change.baseVersion)}</span>
                  </span>
                  <span className={styles.tools}>
                    <button className={styles.primary} type="button" onClick={() => {
                      void approvals.acceptWorkflow(change.workflowId).then((result) => { if (result.ok) setChanges(result.value) })
                    }}>{t('approvals.accept')}</button>
                    <button className={styles.ghost} type="button" onClick={() => {
                      void approvals.rejectWorkflow(change.workflowId).then((result) => { if (result.ok) setChanges(result.value) })
                    }}>{t('approvals.reject')}</button>
                  </span>
                </div>
                {workflowDiffLines(change.base, change.proposed).map(line => (
                  <div key={line.id} className={styles.workflowRunRow}>
                    <span className={styles.cellMuted}>{line.op} {t(line.labelKey)}: {line.text}</span>
                  </div>
                ))}
              </div>
            ))}
        </section>
      </Screen>
    )
  }
}

/** Agents and Skills in one panel, switched by a tab, so the sidebar lists one row. */
function agentsAndSkillsScreen() {
  const AgentsPage = agentsScreen()
  const SkillsPage = skillsScreen()
  return function FaberloomAgentsAndSkills(props: ScreenProps) {
    const [tab, setTab] = useState<'agents' | 'skills'>('agents')
    const [refresh, setRefresh] = useState(0)
    const tabs = (
      <>
        {isDesktopApplication()
          ? (
            <HarnessInstallWizard
              t={props.t}
              pickSource={props.pickArchive}
              install={props.installHarness}
              onChanged={() => { setRefresh(value => value + 1) }}
            />
          )
          : null}
        <AgentsSkillsTabs t={props.t} active={tab} onSelect={setTab} />
      </>
    )
    return tab === 'agents'
      ? <AgentsPage {...props} tabs={tabs} />
      : <SkillsPage {...props} tabs={tabs} refresh={refresh} />
  }
}

/** The FaberLoom sections in sidebar order. The glyphs are the product's own
 *  icon system (`FlIcon*`, 24×24 / stroke 1.75): the brand set carries the
 *  weaving vocabulary — SpaceLoom for a conversation, WorkLoom for the work
 *  bench, Curation for the pipeline, Criterio for a human approval, StackLoom
 *  for the knowledge layers, KnowledgeIndex for incoming material, Workspace
 *  for a Space — and the standard set covers the rest. */
/** Case-insensitive path equality between the host's root and a session's cwd. */
function sameDirectory(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false
  const normalize = (value: string): string => value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
  return normalize(left) === normalize(right)
}

/** Substring first, then in-order subsequence, so a partial name still matches. */
function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  if (haystack.includes(needle)) return true
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return needle.length === 0
}

/** Bytes in the reader's own unit notation. */
function sizeLabel(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return new Intl.NumberFormat(undefined, {
    style: 'unit', unit: units[index], unitDisplay: 'short', maximumFractionDigits: 1,
  }).format(value)
}

/** Parent path, empty at the area root. */
function parentOfPath(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** Pre-order tree order: folders before files at every level, then by name. */
function treeOrder(entries: readonly FaberLoomSpaceTreeEntry[]): readonly FaberLoomSpaceTreeEntry[] {
  const kinds = new Map(entries.map(entry => [entry.path, entry.kind]))
  return [...entries].sort((left, right) => {
    const a = left.path.split('/')
    const b = right.path.split('/')
    const shared = Math.min(a.length, b.length)
    for (let index = 0; index < shared; index += 1) {
      const leftSegment = a[index]
      const rightSegment = b[index]
      if (leftSegment === undefined || rightSegment === undefined || leftSegment === rightSegment) continue
      const prefixA = a.slice(0, index + 1).join('/')
      const prefixB = b.slice(0, index + 1).join('/')
      const rankA = kinds.get(prefixA) === 'directory' ? 0 : 1
      const rankB = kinds.get(prefixB) === 'directory' ? 0 : 1
      return rankA - rankB || leftSegment.localeCompare(rightSegment, 'es', { numeric: true })
    }
    return a.length - b.length
  })
}

/** Whether every folder above one path is expanded. */
function ancestorsExpanded(spaceId: string, path: string, open: ReadonlySet<string>): boolean {
  let parent = parentOfPath(path)
  while (parent !== '') {
    if (!open.has(`${spaceId}\u0000${parent}`)) return false
    parent = parentOfPath(parent)
  }
  return true
}

/** CSV files are spreadsheets to the reader; every other type keeps its own mark. */
function fileIconKind(name: string): ReturnType<typeof classifyFileType> {
  return /\.csv$/iu.test(name) ? 'excel' : classifyFileType(name)
}

/** One session (or the no-session bucket) and the entries it wrote. */
interface FileGroup {
  readonly key: string
  readonly title: string
  readonly at: number
  readonly entries: readonly FaberLoomSpaceTreeEntry[]
}

/** Files: a Space's folder grouped by the Session that wrote each file, or as a plain tree. */
function filesScreen() {
  return function FaberloomFiles(props: ScreenProps) {
    const { t, spaceTree, openSpaceFile, renameSpaceEntry, deleteSpaceEntries, createSpaceFromFolder, useSessions, useWorkspaces } = props
    const { overview } = useOverview(props)
    const sessionsById = useSessions(state => state.byId)
    const sessions = useMemo(() => Object.values(sessionsById ?? {}), [sessionsById])
    const workspaceItems = useWorkspaces === undefined ? [] : useWorkspaces(state => state.items)
    // Two Spaces can mirror the same folder (one row per machine); the folder,
    // not the title, is the identity: sibling sub-spaces may share a title.
    const spaces = useMemo(() => uniqueSpaces(overview?.spaces ?? []), [overview])
    const spaceById = useMemo(() => new Map(spaces.map(space => [space.id, space])), [spaces])
    const childSpaces = useMemo(() => {
      const map = new Map<string, FaberLoomOverview['spaces'][number][]>()
      for (const space of spaces) {
        if (space.parentId === null || !spaceById.has(space.parentId)) continue
        const list = map.get(space.parentId) ?? []
        list.push(space)
        map.set(space.parentId, list)
      }
      return map
    }, [spaces, spaceById])
    const rootSpaces = useMemo(
      () => spaces.filter(space => space.parentId === null || !spaceById.has(space.parentId)),
      [spaces, spaceById],
    )
    // The parent's folder contains the child's folder. Hide that raw folder from
    // the parent tree: the child Space row below it is the same entry, expanded
    // with its own files and sessions.
    const hiddenChildFolders = useMemo(() => {
      const hidden = new Map<string, ReadonlySet<string>>()
      for (const [parentId, children] of childSpaces) {
        const parent = spaceById.get(parentId)
        if (parent === undefined) continue
        const separator = parent.folderPath.includes('\\') ? '\\' : '/'
        const paths = new Set<string>()
        for (const child of children) {
          if (!child.folderPath.startsWith(`${parent.folderPath}${separator}`)) continue
          paths.add(child.folderPath.slice(parent.folderPath.length + 1).split(separator).join('/'))
        }
        hidden.set(parentId, paths)
      }
      return hidden
    }, [childSpaces, spaceById])
    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [mode, setMode] = useState<'session' | 'folder'>('session')
    const [trees, setTrees] = useState<Record<string, { readonly root: string; readonly entries: readonly FaberLoomSpaceTreeEntry[] }>>({})
    const [openSpaces, setOpenSpaces] = useState<ReadonlySet<string>>(new Set())
    const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
    const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set())
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    const [busy, setBusy] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [renaming, setRenaming] = useState<{ readonly spaceId: string; readonly path: string; readonly name: string } | null>(null)
    const [removing, setRemoving] = useState<ReadonlyArray<{ readonly spaceId: string; readonly paths: readonly string[] }> | null>(null)

    const reloadSpace = (spaceId: string): void => {
      void spaceTree(spaceId).then((result) => {
        if (result.ok) setTrees(current => ({ ...current, [spaceId]: result.value }))
        else setError(result.error.message)
      }).catch(() => { setError(t('panel.files.loadError')) })
    }

    const loadSpace = (spaceId: string): void => {
      if (trees[spaceId] !== undefined) return
      reloadSpace(spaceId)
    }

    const toggleSpace = (spaceId: string): void => {
      const next = new Set(openSpaces)
      if (next.has(spaceId)) next.delete(spaceId)
      else {
        next.add(spaceId)
        loadSpace(spaceId)
      }
      setOpenSpaces(next)
    }

    const toggle = (setter: typeof setOpenFolders, key: string): void => {
      setter((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }

    const toggleSelected = (key: string): void => {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }

    // A selected folder can become a sub-space of the folder's current Space.
    const selectedFolder = useMemo(() => {
      if (selected.size !== 1) return undefined
      const [key] = [...selected]
      if (key === undefined) return undefined
      const [spaceId, path] = key.split('\u0000')
      if (spaceId === undefined || path === undefined) return undefined
      const tree = trees[spaceId]
      const entry = tree?.entries.find(candidate => candidate.path === path)
      if (tree === undefined || entry === undefined || entry.kind !== 'directory') return undefined
      const separator = tree.root.includes('\\') ? '\\' : '/'
      const absolute = `${tree.root.replace(/[\\/]+$/u, '')}${separator}${path.split('/').join(separator)}`
      return { spaceId, path, name: entry.name, absolute }
    }, [selected, trees])

    const selectedFolderIsSpace = selectedFolder !== undefined
      && (overview?.spaces ?? []).some(space => space.folderPath === selectedFolder.absolute)

    const convertFolder = (): void => {
      if (selectedFolder === undefined) return
      setBusy(`${selectedFolder.spaceId}\u0000${selectedFolder.path}`)
      setError(null)
      setNotice(null)
      void createSpaceFromFolder(selectedFolder.name, selectedFolder.absolute, selectedFolder.spaceId)
        .then((result) => {
          if (!result.ok) { setError(result.error.message); return }
          setNotice(t('spaces.converted'))
          setSelected(new Set())
          reloadSpace(selectedFolder.spaceId)
        })
        .catch((cause: unknown) => { setError(String(cause)) })
        .finally(() => { setBusy(null) })
    }

    const sessionOf = (spaceId: string, root: string, at: string): SessionSummary | undefined => {
      const stamp = Date.parse(at)
      const space = spaceById.get(spaceId)
      const workspace = (space?.workspaceId === null || space?.workspaceId === undefined
        ? undefined
        : workspaceItems.find(candidate => String(candidate.workspaceId) === space.workspaceId))
        ?? workspaceItems.find(candidate => sameDirectory(candidate.path, root))
      const memberIds = new Set(workspace?.sessionIds.map(String) ?? [])
      const candidates = sessions.filter((session) => {
        // A blank session is the workspace's empty slot, not a conversation:
        // attributing files to it would label them with the folder's name.
        if (session.blank) return false
        // Workspace membership is authoritative after a move; cwd is the
        // fallback for a workspace whose session summaries are still loading.
        return memberIds.size > 0 ? memberIds.has(String(session.id)) : sameDirectory(session.cwd, root)
      })
      let best: SessionSummary | undefined
      for (const session of candidates) {
        if (session.updatedAt < stamp) continue
        if (best === undefined || session.updatedAt < best.updatedAt) best = session
      }
      // A file can be written after its turn ended (attachments, extracted
      // text, a user edit). The newest session in the same Workspace still
      // owns it; do not fall back to "Sin sesión" while that session exists.
      return best ?? candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    }

    const withFolders = (
      all: readonly FaberLoomSpaceTreeEntry[],
      files: readonly FaberLoomSpaceTreeEntry[],
    ): readonly FaberLoomSpaceTreeEntry[] => {
      const keep = new Set(files.map(file => file.path))
      for (const file of files) {
        let parent = parentOfPath(file.path)
        while (parent !== '') {
          keep.add(parent)
          parent = parentOfPath(parent)
        }
      }
      return all.filter(entry => keep.has(entry.path))
    }

    const groupsOf = (spaceId: string): ReadonlyArray<FileGroup> => {
      const tree = trees[spaceId]
      if (tree === undefined) return []
      const groups = new Map<string, { key: string; title: string; at: number; files: FaberLoomSpaceTreeEntry[] }>()
      for (const entry of tree.entries) {
        if (entry.kind === 'directory') continue
        const session = sessionOf(spaceId, tree.root, entry.modifiedAt)
        const id = session === undefined ? 'none' : String(session.id)
        const group = groups.get(id) ?? {
          key: `${spaceId}\u0000${id}`,
          title: session?.displayTitle ?? t('panel.files.noSession'),
          at: session?.updatedAt ?? 0,
          files: [],
        }
        group.files.push(entry)
        groups.set(id, group)
      }
      return [...groups.values()]
        .sort((left, right) => right.at - left.at)
        .map(group => ({ key: group.key, title: group.title, at: group.at, entries: withFolders(tree.entries, group.files) }))
    }

    const openFile = (spaceId: string, path: string): void => {
      const key = `${spaceId}\u0000${path}`
      setBusy(key)
      setError(null)
      setNotice(null)
      void openSpaceFile(spaceId, path)
        .then((result) => {
          if (!result.ok) setError(result.error.message)
          else if (!result.value.opened) setNotice(t('panel.files.noOpener'))
        })
        .catch((cause: unknown) => { setError(String(cause)) })
        .finally(() => { setBusy(null) })
    }

    const beginRename = (): void => {
      const [key] = [...selected]
      if (key === undefined) return
      const [spaceId, path] = key.split('\u0000')
      setRenaming({ spaceId: spaceId ?? '', path: path ?? '', name: (path ?? '').split('/').pop() ?? '' })
    }

    const submitRename = (): void => {
      if (renaming === null) return
      const target = renaming
      setBusy(`${target.spaceId}\u0000${target.path}`)
      void renameSpaceEntry(target.spaceId, target.path, target.name.trim())
        .then((result) => {
          if (!result.ok) {
            setError(result.error.message)
            return
          }
          setRenaming(null)
          setSelected(new Set())
          reloadSpace(target.spaceId)
        })
        .catch((cause: unknown) => { setError(String(cause)) })
        .finally(() => { setBusy(null) })
    }

    const beginDelete = (): void => {
      const bySpace = new Map<string, string[]>()
      for (const key of selected) {
        const [spaceId, path] = key.split('\u0000')
        if (spaceId === undefined || path === undefined) continue
        const paths = bySpace.get(spaceId) ?? []
        paths.push(path)
        bySpace.set(spaceId, paths)
      }
      setRemoving([...bySpace.entries()].map(([spaceId, paths]) => ({ spaceId, paths })))
    }

    const submitDelete = (): void => {
      if (removing === null) return
      const groups = removing
      void Promise.all(groups.map(group => deleteSpaceEntries(group.spaceId, group.paths)))
        .then((results) => {
          const failed = results.find(result => !result.ok)
          if (failed !== undefined && !failed.ok) {
            setError(failed.error.message)
            return
          }
          setRemoving(null)
          setSelected(new Set())
          for (const group of groups) reloadSpace(group.spaceId)
        })
        .catch((cause: unknown) => { setError(String(cause)) })
    }

    const runSearch = (): void => {
      setSearch(query.trim())
      for (const space of spaces) loadSpace(space.id)
    }

    const tip = (spaceId: string, entry: FaberLoomSpaceTreeEntry): string => {
      const tree = trees[spaceId]
      const session = tree === undefined ? undefined : sessionOf(spaceId, tree.root, entry.modifiedAt)
      const modified = new Date(entry.modifiedAt).toLocaleString()
      const created = new Date(entry.createdAt).toLocaleString()
      return [
        entry.path,
        `${sizeLabel(entry.bytes)} · ${t('panel.files.tip.modified')} ${modified} · ${t('panel.files.tip.created')} ${created}`,
        `${t('panel.files.tip.session')}: ${session?.displayTitle ?? t('panel.files.noSession')}${session === undefined ? '' : ` · ${new Date(session.updatedAt).toLocaleDateString()}`}`,
      ].join('\n')
    }

    const rows = (spaceId: string, list: readonly FaberLoomSpaceTreeEntry[], indent = 0): ReactNode => (
      <>
        {treeOrder(list)
          .filter(entry => ancestorsExpanded(spaceId, entry.path, openFolders))
          .filter(entry => entry.kind !== 'directory' || !(hiddenChildFolders.get(spaceId)?.has(entry.path) ?? false))
          .map((entry) => {
            const key = `${spaceId}\u0000${entry.path}`
            const depth = entry.path.split('/').length - 1
            const directory = entry.kind === 'directory'
            const expanded = openFolders.has(key)
            const busyNow = busy === key
            return (
              <div className={styles.fileRow} key={key}>
                <input
                  type="checkbox"
                  className={styles.fileCheck}
                  checked={selected.has(key)}
                  onChange={() => { toggleSelected(key) }}
                  aria-label={`${t('panel.files.select')} ${entry.name}`}
                />
                <button
                  type="button"
                  className={styles.treeRow}
                  data-kind={entry.kind}
                  style={{ paddingLeft: `${6 + (depth + indent) * 16}px` }}
                  onClick={() => { if (directory) toggle(setOpenFolders, key); else openFile(spaceId, entry.path) }}
                  aria-expanded={directory ? expanded : undefined}
                  disabled={busyNow}
                  title={tip(spaceId, entry)}
                >
                  <span className={styles.treeCaret}>
                    {directory ? <IconChevronRightOutline14 className={expanded ? styles.caretOpen : undefined} /> : null}
                  </span>
                  <span className={styles.treeIcon}>
                    {directory
                      ? (expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />)
                      : <FileTypeIcon kind={fileIconKind(entry.name)} size={16} />}
                  </span>
                  <span className={styles.treeName}>{entry.name}</span>
                  <span className={styles.fileMeta}>
                    {new Date(entry.modifiedAt).toLocaleDateString()}
                    {directory ? '' : ` · ${sizeLabel(entry.bytes)}`}
                  </span>
                  {busyNow && <span className={styles.treeBusy}>{t('panel.files.opening')}</span>}
                </button>
              </div>
            )
          })}
      </>
    )

    const searchRows = (): ReactNode => (
      <>
        {spaces.map((space) => {
          const tree = trees[space.id]
          if (tree === undefined) return null
          const found = tree.entries.filter(entry => entry.kind !== 'directory' && matchesQuery(entry.path, search))
          if (found.length === 0) return null
          return (
            <div key={`search-${space.id}`}>
              <p className={styles.fileGroupHint}>{space.title}</p>
              {found.slice(0, 100).map((entry) => {
                const key = `${space.id}\u0000${entry.path}`
                return (
                  <div className={styles.fileRow} key={key}>
                    <input
                      type="checkbox"
                      className={styles.fileCheck}
                      checked={selected.has(key)}
                      onChange={() => { toggleSelected(key) }}
                      aria-label={`${t('panel.files.select')} ${entry.name}`}
                    />
                    <button
                      type="button"
                      className={styles.treeRow}
                      data-kind={entry.kind}
                      onClick={() => { openFile(space.id, entry.path) }}
                      title={tip(space.id, entry)}
                    >
                      <span className={styles.treeCaret} />
                      <span className={styles.treeIcon}><FileTypeIcon kind={fileIconKind(entry.name)} size={16} /></span>
                      <span className={styles.treeName}>{entry.path}</span>
                      <span className={styles.fileMeta}>{new Date(entry.modifiedAt).toLocaleDateString()}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
      </>
    )

    const renderSpace = (space: FaberLoomOverview['spaces'][number], depth: number): ReactNode => {
      const expanded = openSpaces.has(space.id)
      const tree = trees[space.id]
      const children = childSpaces.get(space.id) ?? []
      return (
        <div key={space.id}>
          <button
            type="button"
            className={styles.treeSpace}
            style={{ paddingLeft: `${6 + depth * 16}px` }}
            aria-expanded={expanded}
            onClick={() => { toggleSpace(space.id) }}
            title={space.folderPath}
          >
            <span className={styles.treeCaret}>
              <IconChevronRightOutline14 className={expanded ? styles.caretOpen : undefined} />
            </span>
            <span className={styles.treeIcon}>{expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}</span>
            {depth > 0 && <span className={styles.spaceBranch} aria-hidden="true">↳</span>}
            <span className={styles.treeName}>{space.title}</span>
          </button>
          {expanded && tree !== undefined && mode === 'folder' && rows(space.id, tree.entries, depth)}
          {expanded && tree !== undefined && mode === 'session' && groupsOf(space.id).map((group) => {
            const open = openGroups.has(group.key)
            return (
              <div key={group.key}>
                <button type="button" className={styles.fileGroup} aria-expanded={open} onClick={() => { toggle(setOpenGroups, group.key) }}>
                  <span className={styles.treeCaret}>
                    <IconChevronRightOutline14 className={open ? styles.caretOpen : undefined} />
                  </span>
                  <span className={styles.treeName}>{group.title}</span>
                  <span className={styles.fileMeta}>
                    {group.at === 0 ? '' : `${new Date(group.at).toLocaleDateString()} · `}
                    {group.entries.filter(entry => entry.kind !== 'directory').length}
                  </span>
                </button>
                {open && rows(space.id, group.entries, depth)}
              </div>
            )
          })}
          {expanded && children.map(child => renderSpace(child, depth + 1))}
        </div>
      )
    }

    return (
      <Screen title={t('panel.files.title')} subtitle={t('panel.files.subtitle')}>
        <div className={styles.fileTools}>
          <div className={styles.fileSearch} onKeyDown={(event) => { if (event.key === 'Enter') runSearch() }}>
            <SearchBox
              value={query}
              onChange={(next) => {
                setQuery(next)
                if (next.trim() === '') setSearch('')
              }}
              placeholder={t('panel.files.search')}
              label={t('panel.files.search')}
            />
          </div>
          <div className={styles.segments}>
            <button type="button" className={mode === 'session' ? styles.segmentActive : styles.segment} onClick={() => { setMode('session') }}>{t('panel.files.bySession')}</button>
            <button type="button" className={mode === 'folder' ? styles.segmentActive : styles.segment} onClick={() => { setMode('folder') }}>{t('panel.files.byFolder')}</button>
          </div>
        </div>
        {selected.size > 0 && (
          <div className={styles.fileSelection}>
            <span>{selected.size} · {t('panel.files.selected')}</span>
            {selected.size === 1 && (
              <button type="button" className={styles.ghost} onClick={beginRename}>{t('panel.files.rename')}</button>
            )}
            {selectedFolder !== undefined && !selectedFolderIsSpace && (
              <button type="button" className={styles.secondary} onClick={convertFolder} disabled={busy !== null}>
                {t('spaces.convertFolder')}
              </button>
            )}
            <button type="button" className={styles.ghost} onClick={beginDelete}>{t('panel.files.delete')}</button>
            <button type="button" className={styles.ghost} onClick={() => { setSelected(new Set()) }}>{t('panel.files.clearSelection')}</button>
          </div>
        )}
        {error !== null && <StateBlock kind="error" title={t('panel.files.loadError')} text={error} />}
        {notice !== null && <p className={styles.treeNotice} role="status">{notice}</p>}
        {spaces.length === 0 && <StateBlock kind="empty" title={t('panel.files.empty')} />}
        <div className={styles.tree}>
          {search !== '' && searchRows()}
          {search !== '' && spaces.every((space) => {
            const tree = trees[space.id]
            return tree === undefined || !tree.entries.some(entry => entry.kind !== 'directory' && matchesQuery(entry.path, search))
          }) && <StateBlock kind="empty" title={t('panel.files.searchEmpty')} />}
          {search === '' && rootSpaces.map(space => renderSpace(space, 0))}
        </div>
        <Modal
          open={renaming !== null}
          onClose={() => { setRenaming(null) }}
          title={t('panel.files.renameTitle')}
          closeLabel={t('action.close')}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setRenaming(null) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={submitRename}>{t('action.save')}</button>
            </>
          )}
        >
          <Field label={t('field.name')}>
            <input
              type="text"
              value={renaming?.name ?? ''}
              onChange={(event) => { setRenaming(current => current === null ? null : { ...current, name: event.target.value }) }}
            />
          </Field>
        </Modal>
        <Modal
          open={removing !== null}
          onClose={() => { setRemoving(null) }}
          title={t('panel.files.deleteTitle')}
          closeLabel={t('action.close')}
          footer={(
            <>
              <button className={styles.ghost} type="button" onClick={() => { setRemoving(null) }}>{t('action.cancel')}</button>
              <button className={styles.primary} type="button" onClick={submitDelete}>{t('panel.files.delete')}</button>
            </>
          )}
        >
          <p>{removing?.reduce((total, group) => total + group.paths.length, 0) ?? 0} · {t('panel.files.deleteQuestion')}</p>
        </Modal>
      </Screen>
    )
  }
}


export const FABERLOOM_SECTIONS: readonly FaberloomSection[] = [
  // The Chat landing keeps its route but no sidebar row (the New Session button
  // and the conversation cover it).
  { id: 'faberloom-conversar' as MainPanelId, order: 10, labelKey: 'nav.conversar', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', Icon: panelIcon(FlIconSpaceloom), Page: conversarPanel(), sidebar: false },
  { id: 'faberloom-board' as MainPanelId, order: 20, labelKey: 'nav.board', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', badge: overview => overview.board.length, Icon: panelIcon(FlIconWorkloom), Page: mesaScreen() },
  { id: 'faberloom-spaces' as MainPanelId, order: 30, labelKey: 'nav.spaces', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', badge: overview => overview.spaces.length, Icon: panelIcon(FlIconWorkspace), Page: spacesScreen() },
  // The files panel reads the same Spaces the platform sidebar groups, so the
  // harness projection and the operator's documents are visible without opening
  // the conversation's right pane.
  { id: 'faberloom-files' as MainPanelId, order: 35, labelKey: 'nav.files', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', Icon: panelIcon(FlIconKnowledgeIndex), Page: filesScreen() },
  // Agents and Skills share one sidebar row; the panel's own tab switches them.
  { id: 'faberloom-agents' as MainPanelId, order: 70, labelKey: 'nav.agentsAndSkills', modeKey: 'nav.mode.admin', groupKey: 'nav.group.setup', badge: overview => overview.agents.length, Icon: panelIcon(FlIconAdmin), Page: agentsAndSkillsScreen() },
  { id: 'faberloom-routines' as MainPanelId, order: 50, labelKey: 'nav.routines', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', badge: overview => overview.routines.length, Icon: panelIcon(FlIconRefresh), Page: routinesScreen() },
  { id: 'faberloom-workflows' as MainPanelId, order: 55, labelKey: 'nav.workflows', modeKey: 'nav.mode.operate', groupKey: 'nav.group.work', Icon: panelIcon(FlIconCuration), Page: workflowsScreen() },
  { id: 'faberloom-memory' as MainPanelId, order: 60, labelKey: 'nav.memory', modeKey: 'nav.mode.learn', groupKey: 'nav.group.knowledge', badge: overview => overview.memory.length, Icon: panelIcon(FlIconStackloom), Page: memoryScreen() },
  { id: 'faberloom-context' as MainPanelId, order: 62, labelKey: 'nav.context', modeKey: 'nav.mode.learn', groupKey: 'nav.group.knowledge', Icon: panelIcon(FlIconKnowledgeIndex), Page: contextScreen() },
  { id: 'faberloom-approvals' as MainPanelId, order: 64, labelKey: 'nav.approvals', modeKey: 'nav.mode.learn', groupKey: 'nav.group.inbox', Icon: panelIcon(FlIconCriterio), Page: approvalsScreen() },
  { id: 'faberloom-connections' as MainPanelId, order: 80, labelKey: 'nav.connections', modeKey: 'nav.mode.admin', groupKey: 'nav.group.setup', Icon: panelIcon(FlIconExternal), Page: connectionsScreen() },
  { id: 'faberloom-email' as MainPanelId, order: 75, labelKey: 'nav.email', modeKey: 'nav.mode.operate', groupKey: 'nav.group.inbox', Icon: panelIcon(FlIconMail), Page: emailScreen() },
]
