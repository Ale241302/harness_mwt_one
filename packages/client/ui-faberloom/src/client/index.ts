/**
 * FaberLoom surface plugin, browser half: the identity tokens, the brand name
 * beside the sidebar mark, and the global panels that switch the main column.
 * Every panel reads one shared overview from the declared store; the workspace
 * panels write through the generated Remote API and publish the result back to
 * the store, so a create or rename refreshes all panels at once. The Conversar
 * panel hands the user to the harness conversation, which owns the composer.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ctx.theme and the theme token override contract.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the renderer-owned slots service and its bound-action type.
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the shared MainPanelId used as the sidebar id and main key.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar shell's `sidebar.brand.name` and `sidebar.panellist` slots.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the generated Remote client and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.inputTriggers, ctx.commandUi, and ctx.sessions for the chat gestures.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { runAdoptSpaceWorkspace } from './adopt-space-workspace.ts'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import { FaberloomBrandName, FaberloomBrandMark, FABERLOOM_SECTIONS, sectionBadge, type FaberloomPanelInjected } from './panels.tsx'
import { McpServersSection, type McpServersSectionInjected } from './mcp-servers-section.tsx'
import { WorkspaceShareDialog, WorkspaceShareMenuItem, createWorkspaceShareStore, type WorkspaceShareInjected } from './workspace-share.tsx'
import { WorkspaceMoveDialog, WorkspaceMoveMenuItem, createWorkspaceMoveStore, type WorkspaceMoveInjected } from './workspace-move.tsx'
import { WorkspaceSubspaceDialog, WorkspaceSubspaceMenuItem, createWorkspaceSubspaceStore, type WorkspaceSubspaceInjected } from './workspace-subspace.tsx'
import { FaberloomSignOut } from './sign-out.tsx'
import { registerChatGestures } from './triggers.ts'
import { runSpaceFromEmail } from './space-from-email.ts'
import { runTaskChat } from './task-chat.ts'
import { createWorkspaceStore } from './store.ts'
import { en, es, zh, type FaberloomKey } from './locales.ts'
import { FABERLOOM_THEME_SOURCE, faberloomTokens } from './theme.ts'

export { FaberloomBrandName } from './panels.tsx'
export { FABERLOOM_SECTIONS, type FaberloomPanelInjected, type FaberloomSection } from './panels.tsx'
export { createWorkspaceStore, type WorkspaceState } from './store.ts'
export type { FaberloomKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The FaberLoom surface copy. */
    faberloom: FaberloomKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'faberloom'

/** Required services: slots, dictionaries, identity tokens, navigation, the workspace Remote, and the chat gesture seats. */
export const inject = ['slots', 'locale', 'theme', 'layout', 'remote', 'remote.faberloomView', 'remote.directoryPicker', 'inputTriggers', 'commandUi', 'sessions']

/** The store's bound write surface, as the registration's inject factory receives it. */
type WorkspaceActions = BoundActions<ReturnType<typeof createWorkspaceStore>>

/** One Remote write result carrying the refreshed overview. */
type OverviewResult =
  | { readonly ok: true; readonly value: FaberLoomOverview }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Client plugin body: identity tokens, the brand name, and every global panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-faberloom: dictionaries')
  ctx.effect(
    () => ctx.theme.overrideTokens(FABERLOOM_THEME_SOURCE, faberloomTokens),
    'ui-faberloom: identity tokens',
  )

  registerChatGestures(ctx, t)

  const workspace = createWorkspaceStore()
  // The renderer binds actions per registration; the first binding is enough for
  // the shared store, so the focus refresh can publish while a panel is mounted.
  let actions: WorkspaceActions | undefined
  // The last overview published to the panels, kept so the sidebar row badges
  // (resolved synchronously, outside React) read the same live numbers.
  let latestOverview: FaberLoomOverview | null = null

  /**
   * Read once and publish. A failed read before any rows marks the state; once
   * rows are shown, a failed background read keeps them without an error, since
   * the panel polls again within seconds (a gateway restart answers a few reads
   * with its HTML page).
   */
  const refresh = (): void => {
    if (actions === undefined) return
    const bound = actions
    void ctx.remote.faberloomView.overview()
      .then((result) => {
        if (result.ok) {
          latestOverview = result.value
          bound.setOverview(result.value)
        } else if (latestOverview === null) bound.setError(result.error.message)
      })
      .catch(() => { if (latestOverview === null) bound.setError('read failed') })
  }

  /** Run one write and publish its fresh overview; a failure carries its message. */
  const write = (run: () => Promise<OverviewResult>): void => {
    if (actions === undefined) return
    const bound = actions
    void run()
      .then((result) => {
        if (result.ok) {
          latestOverview = result.value
          bound.setOverview(result.value)
        } else bound.setError(result.error.message)
      })
      .catch(() => { bound.setError('write failed') })
  }

  const injected = (bound: WorkspaceActions): FaberloomPanelInjected => {
    actions = bound
    return {
      load: refresh,
      startConversation: () => { ctx.layout.selectPanel(null) },
      createSpace: (title, agentId, parentId, inheritContext) => {
        write(() => ctx.remote.faberloomView.createSpace(title, agentId ?? undefined, parentId ?? undefined, inheritContext))
      },
      createSpaceFromFolder: (title, path, parentId) => {
        const run = ctx.remote.faberloomView.createSpaceFromFolder(title, path, parentId ?? undefined)
        write(() => run)
        return run
      },
      deleteSpace: (id) => { write(() => ctx.remote.faberloomView.deleteSpace(id)) },
      goToWorkspace: (spaceId) => {
        void ctx.remote.faberloomView.openSpaceWorkspace(spaceId).then(async (result) => {
          if (!result.ok || result.value.workspaceId === null) return
          const sessionId = await ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
          ctx.sessions.open(sessionId)
          ctx.layout.selectPanel(null)
        }).catch(() => {
          // A failed navigation keeps the current selection.
        })
      },
      adoptSpaceWorkspace: (spaceId) => {
        void runAdoptSpaceWorkspace(ctx.remote.directoryPicker, ctx.remote.faberloomView, refresh, spaceId).catch(() => {
          // A cancelled pick or a failed adoption keeps the current workspace.
        })
      },
      exportContextToFolder: spaceId => ctx.remote.faberloomView.exportSpaceViewToFolder(spaceId, 'context', '', 'markdown'),
      renameSpace: (id, title) => { write(() => ctx.remote.faberloomView.renameSpace(id, title)) },
      createAgent: (input) => {
        write(() => ctx.remote.faberloomView.createAgent(
          input.name, input.responsibility, input.provider ?? undefined, input.model ?? undefined,
          input.apiKey.length === 0 ? undefined : input.apiKey, input.webAccess, input.mwtMcp,
          input.sicopMcp, input.mailConnectionIds, input.subagentIds,
        ))
      },
      deactivateAgent: (id) => { write(() => ctx.remote.faberloomView.deleteAgent(id)) },
      purgeAgent: (id) => { write(() => ctx.remote.faberloomView.purgeAgent(id)) },
      reopenBoardItem: (id) => { const run = ctx.remote.faberloomView.reopenBoardItem(id); write(() => run); return run },
      submitBoardRevision: (id, input) => {
        const run = ctx.remote.faberloomView.submitBoardRevision(id, input)
        write(() => run)
        return run
      },
      boardException: (id, action) => { const run = ctx.remote.faberloomView.boardException(id, action); write(() => run); return run },
      boardSetSeverity: (id, severity, rowVersion, source, confidence) => {
        const run = ctx.remote.faberloomView.boardSetSeverity(id, severity as never, rowVersion, source ?? 'HUMAN', confidence ?? null)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardSaveEdits: (id, input) => {
        const run = ctx.remote.faberloomView.boardSaveEdits(id, {
          expectedRowVersion: input.rowVersion, baseVersion: input.baseVersion, changes: input.changes,
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardApprove: (id, input) => {
        const run = ctx.remote.faberloomView.boardApprove(id, {
          expectedRowVersion: input.rowVersion,
          expectedArtifactVersion: input.artifactVersion,
          expectedArtifactHash: input.artifactHash,
          ...input.confirmations === undefined ? {} : { confirmations: input.confirmations },
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardApproveWithEdits: (id, input) => {
        const run = ctx.remote.faberloomView.boardApproveWithEdits(id, {
          expectedRowVersion: input.rowVersion,
          expectedArtifactVersion: input.artifactVersion,
          expectedArtifactHash: input.artifactHash,
          baseVersion: input.baseVersion,
          changes: input.changes,
          ...input.confirmations === undefined ? {} : { confirmations: input.confirmations },
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardDiscard: (id, input) => {
        const run = ctx.remote.faberloomView.boardDiscard(id, {
          expectedRowVersion: input.rowVersion,
          reason: input.reason,
          ...input.note === undefined ? {} : { note: input.note },
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardResolveCandidate: (id, candidateId, candidateHash, decision) => {
        const run = ctx.remote.faberloomView.boardResolveCandidate(id, candidateId, candidateHash, decision)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardAssignWorkspace: (id, workspaceId) => {
        const run = ctx.remote.faberloomView.boardAssignWorkspace(id, workspaceId)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEvents: id => ctx.remote.faberloomView.boardEvents(id),
      boardGetDraft: id => ctx.remote.faberloomView.boardGetDraft(id),
      boardSaveDraft: (id, input) => ctx.remote.faberloomView.boardSaveDraft(id, input),
      boardTakeDraft: (id, writerSession) => ctx.remote.faberloomView.boardTakeDraft(id, writerSession),
      boardDiscardDraft: id => ctx.remote.faberloomView.boardDiscardDraft(id),
      boardRevalidate: (id, changed) => {
        const run = ctx.remote.faberloomView.boardRevalidate(id, changed)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIteration: id => ctx.remote.faberloomView.boardIteration(id),
      // An empty provider says the session names none, so the host assumes the
      // deployment's default; the wire always carries the field (§8.5, W-48).
      boardIterationContext: (id, providerId = '') => ctx.remote.faberloomView.boardIterationContext(id, providerId),
      boardIterationStart: (id, baseVersion, actorSession) => {
        const run = ctx.remote.faberloomView.boardIterationStart(id, baseVersion, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationSaveDraft: (id, input) => ctx.remote.faberloomView.boardIterationSaveDraft(id, input),
      boardIterationApply: (id, input) => {
        const run = ctx.remote.faberloomView.boardIterationApply(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationRenew: (id, input) => ctx.remote.faberloomView.boardIterationRenew(id, input),
      boardIterationPause: (id, input) => {
        const run = ctx.remote.faberloomView.boardIterationPause(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationCancel: (id, input) => {
        const run = ctx.remote.faberloomView.boardIterationCancel(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationResume: (id, baseVersion, actorSession) => {
        const run = ctx.remote.faberloomView.boardIterationResume(id, baseVersion, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationRecover: (id, draftKey, actorSession) => {
        const run = ctx.remote.faberloomView.boardIterationRecover(id, draftKey, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationDraft: (id, iterationId) => ctx.remote.faberloomView.boardIterationDraft(id, iterationId),
      boardApproveWithExecution: (id, input) => {
        const run = ctx.remote.faberloomView.boardApproveWithExecution(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectStatus: id => ctx.remote.faberloomView.boardEffectStatus(id),
      boardEffectAlerts: () => ctx.remote.faberloomView.boardEffectAlerts(),
      boardEffectPolicy: () => ctx.remote.faberloomView.boardEffectPolicy(),
      boardEffectRevert: (id, input) => {
        const run = ctx.remote.faberloomView.boardEffectRevert(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectRetry: (id, input) => {
        const run = ctx.remote.faberloomView.boardEffectRetry(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectReconcile: (id, input) => {
        const run = ctx.remote.faberloomView.boardEffectReconcile(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectProbe: (id, input) => {
        const run = ctx.remote.faberloomView.boardEffectProbe(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectAdminClose: (id, input) => {
        const run = ctx.remote.faberloomView.boardEffectAdminClose(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardSignatures: () => ctx.remote.faberloomView.boardSignatures(),
      boardSignatureStatus: actionType => ctx.remote.faberloomView.boardSignatureStatus(actionType),
      boardSignatureIssue: input => ctx.remote.faberloomView.boardSignatureIssue(input),
      boardSignatureRevoke: signatureId => ctx.remote.faberloomView.boardSignatureRevoke(signatureId),
      createRoutine: (name, spaceId) => { write(() => ctx.remote.faberloomView.createRoutine(name, name, spaceId ?? undefined)) },
      setRoutineActive: (id, active) => { write(() => ctx.remote.faberloomView.setRoutineActive(id, active)) },
      remember: (text, spaceId) => { write(() => ctx.remote.faberloomView.remember(text, spaceId ?? undefined)) },
      spaceMemory: spaceId => ctx.remote.faberloomView.spaceMemory(spaceId),
      deleteSpaceMemory: id => ctx.remote.faberloomView.deleteSpaceMemory(id),
      setMemoryVisibility: (id, visibility) => ctx.remote.faberloomView.setMemoryVisibility(id, visibility),
      setWorkflowVisibility: (id, visibility) => ctx.remote.faberloomView.setWorkflowVisibility(id, visibility),
      setRoutineVisibility: (id, visibility) => { write(() => ctx.remote.faberloomView.setRoutineVisibility(id, visibility)) },
      agentDetail: id => ctx.remote.faberloomView.agentDetail(id),
      models: () => ctx.remote.faberloomView.models(),
      modelCatalog: () => ctx.remote.faberloomView.modelCatalog(),
      recommendModel: agentId => ctx.remote.faberloomView.recommendModel(agentId),
      teachings: (spaceId, agentId, task) => ctx.remote.faberloomView.teachings(spaceId, agentId, task),
      saveTeaching: input => ctx.remote.faberloomView.saveTeaching(input),
      editTeaching: (id, text, reason) => ctx.remote.faberloomView.editTeaching(id, text, reason),
      revokeTeaching: id => ctx.remote.faberloomView.revokeTeaching(id),
      performance: (agentId, task) => ctx.remote.faberloomView.performance(agentId, task),
      costs: (agentId, task) => ctx.remote.faberloomView.costs(agentId, task),
      grants: () => ctx.remote.faberloomView.grants(),
      grant: input => ctx.remote.faberloomView.grant(input),
      revokeGrant: id => ctx.remote.faberloomView.revokeGrant(id),
      mwtStatus: () => ctx.remote.faberloomView.mwtStatus(),
      mcpTokens: () => ctx.remote.faberloomView.mcpTokens(),
      mintMcpToken: input => ctx.remote.faberloomView.mintMcpToken(input),
      revokeMcpToken: token => ctx.remote.faberloomView.revokeMcpToken(token),
      saveAgent: (id, input) => ctx.remote.faberloomView.saveAgent(id, input),
      shareAgent: (id, emails, allUsers) => ctx.remote.faberloomView.shareAgent(id, [...emails], allUsers),
      shareSkill: (name, emails, allUsers) => ctx.remote.faberloomView.shareSkill(name, [...emails], allUsers),
      shares: () => ctx.remote.faberloomView.shares(),
      unshareShare: id => ctx.remote.faberloomView.unshareShare(id),
      skills: () => ctx.remote.faberloomView.skills(),
      spaceTree: spaceId => ctx.remote.faberloomView.spaceTree(spaceId),
      renameSpaceEntry: (spaceId, path, name) => ctx.remote.faberloomView.renameSpaceEntry(spaceId, path, name),
      deleteSpaceEntries: (spaceId, paths) => ctx.remote.faberloomView.deleteSpaceEntries(spaceId, paths),
      openSpaceFile: (spaceId, path) => ctx.remote.faberloomView.openSpaceFile(spaceId, path),
      saveSkill: (name, markdown) => ctx.remote.faberloomView.saveSkill(name, markdown),
      skillMarkdown: name => ctx.remote.faberloomView.skillMarkdown(name),
      removeSkill: name => ctx.remote.faberloomView.removeSkill(name),
      skillInstalls: () => ctx.remote.faberloomView.skillInstalls(),
      installHarness: (source, replace) => ctx.remote.faberloomView.installHarness(source, replace),
      uninstallSkill: (name, destination) => ctx.remote.faberloomView.uninstallSkill(name, destination),
      pickFolder: async () => {
        const picked = await ctx.remote.directoryPicker.pick(undefined)
        return picked.ok ? picked.value : null
      },
      pickArchive: async () => {
        const picked = await ctx.remote.directoryPicker.pickFile()
        return picked.ok ? picked.value : null
      },
      connections: () => ctx.remote.faberloomView.connections(),
      saveConnection: input => ctx.remote.faberloomView.saveConnection(input),
      removeConnection: id => ctx.remote.faberloomView.removeConnection(id),
      probeConnection: id => ctx.remote.faberloomView.probeConnection(id),
      emailInbox: () => ctx.remote.faberloomView.emailInbox(),
      emailRead: uid => ctx.remote.faberloomView.emailRead(uid),
      emailMarkSeen: uid => ctx.remote.faberloomView.emailMarkSeen(uid),
      emailTrash: (uid, sender, subject) => ctx.remote.faberloomView.emailTrash(uid, sender, subject),
      emailAttachment: (uid, index) => ctx.remote.faberloomView.emailAttachment(uid, index),
      saveAttachmentToSpace: (spaceId, uid, name) => ctx.remote.faberloomView.saveSpaceAttachment(spaceId, uid, name),
      sendSpaceFileByEmail: (spaceId, path, to, subject, text) =>
        ctx.remote.faberloomView.sendSpaceFileByEmail(spaceId, path, to, subject, text),
      spaceFromEmail: (uid, name, agentId, from, spaceId) => {
        runSpaceFromEmail(ctx, bound, refresh, { uid, name, agentId, from, ...spaceId === undefined ? {} : { spaceId } })
      },
      routineChat: (uid, messages, subject, from) =>
        ctx.remote.faberloomView.routineChat(uid, [...messages], subject ?? undefined, from ?? undefined),
      routineFromEmail: (uid, name, instruction, subject, from) =>
        ctx.remote.faberloomView.routineFromEmail(uid, name, instruction, subject ?? undefined, from ?? undefined),
      openRoutines: () => { ctx.layout.selectPanel('faberloom-routines' as never) },
      learnFromEmail: uid => ctx.remote.faberloomView.learnFromEmail(uid),
      emailDrafts: () => ctx.remote.faberloomView.emailDrafts(),
      saveEmailDraft: input => ctx.remote.faberloomView.saveEmailDraft(input),
      deleteEmailDraft: id => ctx.remote.faberloomView.deleteEmailDraft(id),
      sendEmailDraft: id => ctx.remote.faberloomView.sendEmailDraft(id),
      emailVoice: spaceId => ctx.remote.faberloomView.emailVoice(spaceId),
      emailDraftWithAi: input => ctx.remote.faberloomView.emailDraftWithAi(input),
      emailPolicy: () => ctx.remote.faberloomView.emailPolicy(),
      saveEmailPolicy: input => ctx.remote.faberloomView.saveEmailPolicy(input),
      backups: () => ctx.remote.faberloomView.backups(),
      createBackup: note => ctx.remote.faberloomView.createBackup(note),
      verifyBackup: id => ctx.remote.faberloomView.verifyBackup(id),
      restoreBackup: (id, dryRun) => ctx.remote.faberloomView.restoreBackup(id, dryRun),
      deleteBackup: id => ctx.remote.faberloomView.deleteBackup(id),
      proposeWork: text => ctx.remote.faberloomView.proposeWork(text),
      createAgentFromWork: (text, name, spaceId) => ctx.remote.faberloomView.createAgentFromWork(text, name, spaceId),
      createRoutineFromWork: (text, name) => ctx.remote.faberloomView.createRoutineFromWork(text, name),
      linkPreview: spaceId => ctx.remote.faberloomView.linkPreview(spaceId),
      spaceDetail: id => ctx.remote.faberloomView.spaceDetail(id),
      prepareHarness: (id, title) => ctx.remote.faberloomView.prepareHarness('space', id, title),
      saveSpace: (id, input) => ctx.remote.faberloomView.saveSpace(id, input),
      spaceWorkspace: id => ctx.remote.faberloomView.spaceWorkspace(id),
      startSpaceSession: (spaceId) => {
        void ctx.remote.faberloomView.openSpaceWorkspace(spaceId).then((result) => {
          if (!result.ok || result.value.workspaceId === null) return
          void ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
            .then((sessionId) => { ctx.sessions.open(sessionId); ctx.layout.selectPanel(null) })
        })
      },
      openSession: (sessionId) => {
        ctx.sessions.open(sessionId as never)
        ctx.layout.selectPanel(null)
      },
      setSpacePermissions: (spaceId, email, permissions) => ctx.remote.faberloomView.setSpacePermissions(spaceId, email, [...permissions]),
      routineDetail: id => ctx.remote.faberloomView.routineDetail(id),
      saveRoutine: (id, input) => {
        const run = ctx.remote.faberloomView.saveRoutine(id, input)
        write(() => run)
        return run
      },
      removeRoutine: (id) => {
        const run = ctx.remote.faberloomView.removeRoutine(id)
        write(() => run)
        return run
      },
      boardDetail: id => ctx.remote.faberloomView.boardDetail(id),
      boardViews: () => ctx.remote.faberloomView.boardViews(),
      boardSaveView: (name, filters) => ctx.remote.faberloomView.boardSaveView(name, filters),
      boardRemoveView: name => ctx.remote.faberloomView.boardRemoveView(name),
      deleteBoardItem: (id) => {
        const run = ctx.remote.faberloomView.deleteBoardItem(id)
        write(() => run)
        return run
      },
      setBoardRoutine: (id, routineId) => {
        const run = ctx.remote.faberloomView.setBoardRoutine(id, routineId)
        write(() => run)
        return run
      },
      openTaskChat: (kind, title, detail, agentName, iteration, cwd) => {
        runTaskChat(ctx, bound, {
          kind,
          title,
          detail,
          ...agentName === undefined ? {} : { agentName },
          ...iteration === undefined ? {} : { iteration },
          ...cwd === undefined ? {} : { cwd },
        })
      },
      executions: routineId => ctx.remote.faberloomView.executions(routineId),
      startRoutine: routineId => ctx.remote.faberloomView.startRoutine(routineId),
      tickRoutine: routineId => ctx.remote.faberloomView.tickRoutine(routineId),
      reconcileExecution: id => ctx.remote.faberloomView.reconcileExecution(id),
      cancelExecutionEffect: (id, stepId) => ctx.remote.faberloomView.cancelExecutionEffect(id, stepId),
      workflows: {
        overview: () => ctx.remote.faberloomView.workflowOverview(),
        detail: id => ctx.remote.faberloomView.workflowDetail(id),
        create: (name, spaceId) => ctx.remote.faberloomView.createWorkflow(name, spaceId),
        remove: id => ctx.remote.faberloomView.deleteWorkflow(id),
        save: (id, name) => ctx.remote.faberloomView.saveWorkflow(id, name),
        addNode: (id, kind, title, configJson, nodeId) => ctx.remote.faberloomView.addNode(id, kind, title, configJson, nodeId),
        updateNode: (id, nodeId, title, kind, configJson) => ctx.remote.faberloomView.updateNode(id, nodeId, title, kind, configJson),
        removeNode: (id, nodeId) => ctx.remote.faberloomView.removeNode(id, nodeId),
        connect: (id, from, to, condition) => ctx.remote.faberloomView.connect(id, from, to, condition),
        disconnect: (id, edgeId) => ctx.remote.faberloomView.disconnect(id, edgeId),
        setStatus: (id, status) => ctx.remote.faberloomView.setWorkflowStatus(id, status),
        setConcurrency: (id, maxConcurrency) => ctx.remote.faberloomView.setWorkflowConcurrency(id, maxConcurrency),
        runs: id => ctx.remote.faberloomView.workflowRuns(id),
        topology: () => ctx.remote.faberloomView.spaceTopology(),
        links: () => ctx.remote.faberloomView.routineWorkflowLinks(),
        shareWorkflow: (id, emails, permissions) => ctx.remote.faberloomView.shareWorkflow(id, emails, permissions),
        shareSpace: (id, emails, permissions) => ctx.remote.faberloomView.shareSpace(id, emails, permissions),
        resourceShares: (kind, id) => ctx.remote.faberloomView.resourceShares(kind, id),
        revokeShareGrant: grantId => ctx.remote.faberloomView.revokeShareGrant(grantId),
        health: () => ctx.remote.faberloomView.executionHealth(),
        exportFlow: (id, format) => ctx.remote.faberloomView.exportWorkflow(id, format),
        templates: () => ctx.remote.faberloomView.workflowTemplates(),
        createFromTemplate: (templateId, name) => ctx.remote.faberloomView.createWorkflowFromTemplate(templateId, name),
        importFlow: (json, name) => ctx.remote.faberloomView.importWorkflow(json, name),
        workflowVersions: id => ctx.remote.faberloomView.workflowVersions(id),
        restoreWorkflow: (id, version) => ctx.remote.faberloomView.restoreWorkflow(id, version),
      },
      context: {
        entries: () => ctx.remote.faberloomView.contextEntries(),
        create: (title, body, spaceId) => ctx.remote.faberloomView.createContext(title, body, spaceId),
        update: (id, title, body) => ctx.remote.faberloomView.updateContext(id, title, body),
        versions: id => ctx.remote.faberloomView.contextVersions(id),
        restore: (id, version) => ctx.remote.faberloomView.restoreContext(id, version),
        approve: id => ctx.remote.faberloomView.approveContext(id),
        reject: id => ctx.remote.faberloomView.rejectContext(id),
        remove: id => ctx.remote.faberloomView.removeContext(id),
        export: (spaceId, format) => ctx.remote.faberloomView.exportContext(spaceId, format),
        import: payload => ctx.remote.faberloomView.importContext(payload),
        replace: (spaceId, entriesJson) => ctx.remote.faberloomView.replaceContext(spaceId, entriesJson),
      },
      sessionsShare: {
        list: spaceId => ctx.remote.faberloomView.spaceSessions(spaceId),
        content: (spaceId, ownerId, sessionId) => ctx.remote.faberloomView.spaceSessionContent(spaceId, ownerId, sessionId),
        remove: (spaceId, ownerId, sessionId) => ctx.remote.faberloomView.removeSpaceSession(spaceId, ownerId, sessionId),
      },
      approvals: {
        contextEntries: () => ctx.remote.faberloomView.contextEntries(),
        syncContext: () => ctx.remote.faberloomView.syncContext(),
        workflowChanges: () => ctx.remote.faberloomView.workflowPendingChanges(),
        acceptWorkflow: id => ctx.remote.faberloomView.acceptWorkflowChange(id),
        rejectWorkflow: id => ctx.remote.faberloomView.rejectWorkflowChange(id),
      },
    }
  }

  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandName))

  // Replace the harness's own mark with the FaberLoom isotipo, in both places it shows.
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandMark))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandMark))

  // The web shell has no native account menu; keep sign-out beside Settings.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'faberloom-sign-out',
    order: 100,
    locale: NS,
    inject: () => ({}),
  }, FaberloomSignOut))

  for (const section of FABERLOOM_SECTIONS) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: section.id,
      store: workspace,
      locale: NS,
      inject: injected,
    }, section.Page))
    // A section may keep its panel reachable without listing a sidebar row (the
    // Chat landing, or Skills folded into the Agents tab).
    if (section.sidebar === false) continue
    // Beyond the row itself, the registration carries the design's navigation
    // metadata: the mode and group the row belongs to, and — only for a section
    // the live overview counts — a badge resolved per read.
    const nav = {
      mode: () => t(section.modeKey),
      group: () => t(section.groupKey),
      ...(section.badge === undefined ? {} : { badge: () => sectionBadge(section, latestOverview) }),
    }
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: section.id,
      order: section.order,
      label: () => t(section.labelKey),
      ...nav,
      locale: NS,
      inject: () => ({}),
    }, section.Icon))
  }

  // MCP servers live in the Settings modal rather than a sidebar row: installing
  // one is deployment configuration the model can also do from a chat (the
  // `faberloom_mcp_add` tools), not a daily-work panel, and Settings is where the
  // product already keeps the surfaces that configure the harness (theme,
  // language, agent presets). The section reads and writes through the product's
  // own view Remote, so no host registry code reaches the browser.
  const mcpServersInjected = (): McpServersSectionInjected => ({
    load: () => ctx.remote.faberloomView.mcpServers(),
    save: input => ctx.remote.faberloomView.saveMcpServer(input),
    remove: name => ctx.remote.faberloomView.removeMcpServer(name),
    test: input => ctx.remote.faberloomView.probeMcpServer(input),
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'faberloom-mcp-servers',
    order: 30,
    label: () => t('mcp.servers.nav'),
    locale: NS,
    inject: mcpServersInjected,
  }, McpServersSection))

  // Share a Workspace's mirrored Space from the sidebar row menu. The overlay
  // host owns the dialog so it outlives the dropdown; both registrations share
  // one store handle.
  const workspaceShare = createWorkspaceShareStore()
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'faberloom-workspace-share',
    store: workspaceShare,
    locale: NS,
    inject: (): WorkspaceShareInjected => ({
      share: async (workspaceId, emails, permissions) => {
        const result = await ctx.remote.faberloomView.shareSpaceByWorkspace(workspaceId, emails, permissions)
        return result.ok ? { ok: true, message: '' } : { ok: false, message: result.error.message }
      },
    }),
  }, WorkspaceShareDialog))
  ctx.slots.inject('sidebar.workspaces.rowMenu', () => ctx.slots.register({
    name: 'sidebar.workspaces.rowMenu',
    id: 'faberloom-share',
    order: -100,
    store: workspaceShare,
    locale: NS,
    inject: () => ({}),
  }, WorkspaceShareMenuItem))

  // Move / promote a Space from the same row menu. The overlay host owns the
  // dialog so selecting a parent survives the menu closing.
  const workspaceMove = createWorkspaceMoveStore()
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'faberloom-workspace-move',
    store: workspaceMove,
    locale: NS,
    inject: (): WorkspaceMoveInjected => ({
      load: async () => {
        const result = await ctx.remote.faberloomView.overview()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      move: async (spaceId, parentId) => {
        const result = await ctx.remote.faberloomView.saveSpace(spaceId, { parentId })
        if (!result.ok) return { ok: false, message: result.error.message }
        if (actions !== undefined) {
          latestOverview = result.value
          actions.setOverview(result.value)
        }
        return { ok: true, message: '' }
      },
    }),
  }, WorkspaceMoveDialog))
  ctx.slots.inject('sidebar.workspaces.rowMenu', () => ctx.slots.register({
    name: 'sidebar.workspaces.rowMenu',
    id: 'faberloom-move',
    order: -90,
    store: workspaceMove,
    locale: NS,
    inject: () => ({}),
  }, WorkspaceMoveMenuItem))

  // Create a child Space from the same row menu. The Workspace row addresses
  // its mirrored Space; the host resolves that parent before writing.
  const workspaceSubspace = createWorkspaceSubspaceStore()
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'faberloom-workspace-subspace',
    store: workspaceSubspace,
    locale: NS,
    inject: (): WorkspaceSubspaceInjected => ({
      create: async (workspaceId, title) => {
        const overview = await ctx.remote.faberloomView.overview()
        if (!overview.ok) return { ok: false, message: overview.error.message }
        const parent = overview.value.spaces.find(space => space.workspaceId === workspaceId)
        if (parent === undefined) return { ok: false, message: t('workspaces.createSubspaceNoSpace') }
        const result = await ctx.remote.faberloomView.createSpace(title, undefined, parent.id, true)
        if (!result.ok) return { ok: false, message: result.error.message }
        if (actions !== undefined) {
          latestOverview = result.value
          actions.setOverview(result.value)
        }
        return { ok: true, message: '' }
      },
    }),
  }, WorkspaceSubspaceDialog))
  ctx.slots.inject('sidebar.workspaces.rowMenu', () => ctx.slots.register({
    name: 'sidebar.workspaces.rowMenu',
    id: 'faberloom-subspace',
    order: -95,
    store: workspaceSubspace,
    locale: NS,
    inject: () => ({}),
  }, WorkspaceSubspaceMenuItem))

  // Event-driven refresh: the harness forwards session activity, so a space or
  // agent created during a conversation appears without a reload. Throttled so a
  // busy turn does not turn into a read loop.
  let lastRefresh = 0
  ctx.effect(() => ctx.remote.$on('api-session/activity', () => {
    const now = Date.now()
    if (now - lastRefresh < 5000) return
    lastRefresh = now
    refresh()
  }), 'ui-faberloom: activity refresh')
}
