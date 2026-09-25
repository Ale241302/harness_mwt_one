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
// Type-only: the shared MainPanelId used as the sidebar id and main key.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the sidebar shell's `sidebar.brand.name` and `sidebar.panellist` slots.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the generated Remote client and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.inputTriggers, ctx.commandUi, and ctx.sessions for the chat gestures.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import { FaberloomBrandName, FABERLOOM_SECTIONS, type FaberloomPanelInjected } from './panels.tsx'
import { registerChatGestures } from './triggers.ts'
import { createWorkspaceStore } from './store.ts'
import { en, zh, type FaberloomKey } from './locales.ts'
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
export const inject = ['slots', 'locale', 'theme', 'layout', 'remote', 'remote.faberloomView', 'inputTriggers', 'commandUi', 'sessions']

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

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-faberloom: dictionaries')
  ctx.effect(
    () => ctx.theme.overrideTokens(FABERLOOM_THEME_SOURCE, faberloomTokens),
    'ui-faberloom: identity tokens',
  )

  registerChatGestures(ctx, t)

  const workspace = createWorkspaceStore()
  // The renderer binds actions per registration; the first binding is enough for
  // the shared store, so the focus refresh can publish while a panel is mounted.
  let actions: WorkspaceActions | undefined

  /** Read once and publish; a failed read keeps the last rows and marks the state. */
  const refresh = (): void => {
    if (actions === undefined) return
    const bound = actions
    void ctx.remote.faberloomView.overview()
      .then((result) => {
        if (result.ok) bound.setOverview(result.value)
        else bound.setError(result.error.message)
      })
      .catch(() => { bound.setError('read failed') })
  }

  /** Run one write and publish its fresh overview; a failure carries its message. */
  const write = (run: () => Promise<OverviewResult>): void => {
    if (actions === undefined) return
    const bound = actions
    void run()
      .then((result) => {
        if (result.ok) bound.setOverview(result.value)
        else bound.setError(result.error.message)
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
      deleteSpace: (id) => { write(() => ctx.remote.faberloomView.deleteSpace(id)) },
      goToWorkspace: (spaceId) => {
        void ctx.remote.faberloomView.openSpaceWorkspace(spaceId).then(async (result) => {
          if (!result.ok || result.value.workspaceId === null) return
          await ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
          ctx.layout.selectPanel(null)
        }).catch(() => {
          // A failed navigation keeps the current selection.
        })
      },
      renameSpace: (id, title) => { write(() => ctx.remote.faberloomView.renameSpace(id, title)) },
      createAgent: (input) => {
        write(() => ctx.remote.faberloomView.createAgent(
          input.name, input.responsibility, input.provider ?? undefined, input.model ?? undefined,
          input.apiKey.length === 0 ? undefined : input.apiKey, input.webAccess, input.mwtMcp,
          input.mailConnectionIds, input.subagentIds,
        ))
      },
      deactivateAgent: (id) => { write(() => ctx.remote.faberloomView.deleteAgent(id)) },
      purgeAgent: (id) => { write(() => ctx.remote.faberloomView.purgeAgent(id)) },
      createBoardItem: (title) => { write(() => ctx.remote.faberloomView.createBoardItem(title)) },
      reviewBoardItem: (id, approve, note) => {
        const run = ctx.remote.faberloomView.reviewBoardItem(id, approve, note)
        write(() => run)
        return run
      },
      reopenBoardItem: (id) => { const run = ctx.remote.faberloomView.reopenBoardItem(id); write(() => run); return run },
      submitBoardRevision: (id, input) => {
        const run = ctx.remote.faberloomView.submitBoardRevision(id, input)
        write(() => run)
        return run
      },
      boardException: (id, action) => { const run = ctx.remote.faberloomView.boardException(id, action); write(() => run); return run },
      createRoutine: (name) => { write(() => ctx.remote.faberloomView.createRoutine(name, name)) },
      setRoutineActive: (id, active) => { write(() => ctx.remote.faberloomView.setRoutineActive(id, active)) },
      remember: (text, spaceId) => { write(() => ctx.remote.faberloomView.remember(text, spaceId ?? undefined)) },
      spaceMemory: spaceId => ctx.remote.faberloomView.spaceMemory(spaceId),
      agentDetail: id => ctx.remote.faberloomView.agentDetail(id),
      models: () => ctx.remote.faberloomView.models(),
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
      skills: () => ctx.remote.faberloomView.skills(),
      saveSkill: (name, markdown) => ctx.remote.faberloomView.saveSkill(name, markdown),
      removeSkill: name => ctx.remote.faberloomView.removeSkill(name),
      connections: () => ctx.remote.faberloomView.connections(),
      saveConnection: input => ctx.remote.faberloomView.saveConnection(input),
      removeConnection: id => ctx.remote.faberloomView.removeConnection(id),
      probeConnection: id => ctx.remote.faberloomView.probeConnection(id),
      emailInbox: () => ctx.remote.faberloomView.emailInbox(),
      emailRead: uid => ctx.remote.faberloomView.emailRead(uid),
      emailAttachment: (uid, index) => ctx.remote.faberloomView.emailAttachment(uid, index),
      spaceFromEmail: (uid, name, agentId, from) => {
        void ctx.remote.faberloomView.spaceFromEmail(uid, name, agentId ?? undefined, from ?? undefined)
          .then(async (result) => {
            if (!result.ok) { bound.setError(result.error.message); return }
            refresh()
            if (result.value.workspaceId === null) return
            try {
              const sessionId = await ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
              // The email is the session's first message, so the agent starts with the
              // body and the extracted attachment text instead of hunting for it.
              const session = ctx.sessions.binding(sessionId)?.session
              if (session !== undefined && result.value.context.length > 0) {
                await session.prompt([{ type: 'text', text: result.value.context }], 'queue')
              }
            } catch { /* a failed session keeps the current panel */ }
            ctx.layout.selectPanel(null)
          }).catch(() => { bound.setError('space from email failed') })
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
      createTaskFromWork: (text, spaceId) => ctx.remote.faberloomView.createTaskFromWork(text, spaceId),
      createAgentFromWork: (text, name, spaceId) => ctx.remote.faberloomView.createAgentFromWork(text, name, spaceId),
      createRoutineFromWork: (text, name) => ctx.remote.faberloomView.createRoutineFromWork(text, name),
      linkPreview: spaceId => ctx.remote.faberloomView.linkPreview(spaceId),
      spaceDetail: id => ctx.remote.faberloomView.spaceDetail(id),
      saveSpace: (id, input) => ctx.remote.faberloomView.saveSpace(id, input),
      spaceWorkspace: id => ctx.remote.faberloomView.spaceWorkspace(id),
      startSpaceSession: (spaceId) => {
        void ctx.remote.faberloomView.openSpaceWorkspace(spaceId).then((result) => {
          if (!result.ok || result.value.workspaceId === null) return
          void ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
            .then(() => { ctx.layout.selectPanel(null) })
        })
      },
      routineDetail: id => ctx.remote.faberloomView.routineDetail(id),
      saveRoutine: (id, input) => ctx.remote.faberloomView.saveRoutine(id, input),
      removeRoutine: id => ctx.remote.faberloomView.removeRoutine(id),
      boardDetail: id => ctx.remote.faberloomView.boardDetail(id),
      executions: routineId => ctx.remote.faberloomView.executions(routineId),
      startRoutine: routineId => ctx.remote.faberloomView.startRoutine(routineId),
      tickRoutine: routineId => ctx.remote.faberloomView.tickRoutine(routineId),
      reconcileExecution: id => ctx.remote.faberloomView.reconcileExecution(id),
      cancelExecutionEffect: (id, stepId) => ctx.remote.faberloomView.cancelExecutionEffect(id, stepId),
    }
  }

  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandName))

  for (const section of FABERLOOM_SECTIONS) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: section.id,
      store: workspace,
      locale: NS,
      inject: injected,
    }, section.Page))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: section.id,
      order: section.order,
      label: () => t(section.labelKey),
      locale: NS,
      inject: () => ({}),
    }, section.Icon))
  }

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
