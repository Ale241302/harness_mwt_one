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
import { ensureViewRemote, reportFailure, viewRemoteOf } from './view-remote.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createElement } from 'react'
import { PanelBoundary } from './ui/panel-boundary.tsx'
import { projectPanels, samePanels, type PanelPlacement } from './sidebar/panels.ts'
import type { SidebarPanelMetadata, SidebarRootInjected } from './sidebar/contract.ts'
import { SidebarRoot } from './sidebar/sidebar.tsx'
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
import { openDraftChat as runDraftChat } from './draft-chat.ts'
import { MailSuggestionBanner } from './mail-suggestion-banner.tsx'
import type { FloatSuggestionPayload, MailSpaceOffer } from './mail-suggestion-banner.tsx'
import type { DraftSuggestionPayload, MailChatInput, MailSuggestionPayload } from './panels.tsx'
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
export const inject = ['slots', 'locale', 'theme', 'layout', 'uiWorkspace', 'remote', 'remote.directoryPicker', 'inputTriggers', 'commandUi', 'sessions']

/** The store's bound write surface, as the registration's inject factory receives it. */
type WorkspaceActions = BoundActions<ReturnType<typeof createWorkspaceStore>>

/** One Remote write result carrying the refreshed overview. */
type OverviewResult =
  | { readonly ok: true; readonly value: FaberLoomOverview }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Client plugin body: identity tokens, the brand name, and every global panel.
 * Each activation phase reports its own failure; the Web shell prints only the
 * entry state, so an unreported throw leaves the operator without a cause.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  try {
    await ensureViewRemote(ctx)
  } catch (error) {
    reportFailure('view remote mount', error)
    throw error
  }
  try {
    registerSurface(ctx)
  } catch (error) {
    reportFailure('surface registration', error)
    throw error
  }
}

/**
 * Register the brand, the identity tokens, and every panel.
 * @param ctx - client root context with the view namespace already mounted.
 */
function registerSurface(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  // The namespace is mounted at activation time, so it cannot ride `inject`.
  const viewRemote = () => viewRemoteOf(ctx)

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
    void viewRemote().overview()
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

  /**
   * Open one Space's conversation area, creating the Workspace it mirrors when
   * the Space has none yet. The sidebar tree and the Espacios panel share it.
   * @param spaceId - the Space to open.
   */
  function openSpaceWorkspace(spaceId: string): void {
    void viewRemote().openSpaceWorkspace(spaceId).then(async (result) => {
      if (!result.ok || result.value.workspaceId === null) return
      const sessionId = await ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
      ctx.sessions.open(sessionId)
      ctx.layout.selectPanel(null)
    }).catch(() => {
      // A failed navigation keeps the current selection.
    })
  }

  /**
   * Open the floating conversation over one Space, optionally with one file
   * selected. The turn runs in the Space's own workspace, so the host composes
   * the Space's agent and skills; the injected seed names the Space subtree and
   * the selected document, and the owner's first message starts the turn.
   * @param spaceId - Space (or sub-space) the conversation is anchored to.
   * @param path - selected file, relative to that Space; null for the whole area.
   * @param seed - context injected before the owner's first message.
   */
  function openSpaceChat(spaceId: string, path: string | null, seed: string): void {
    // A card published by the mail panel belongs to that mail conversation.
    // This float is about a Space, so it must not inherit a stale offer left
    // over from an earlier email chat.
    clearFloatSuggestion()
    const storage = ((): Storage | undefined => {
      try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
      } catch {
        return undefined
      }
    })()
    const key = `faberloom.space.chat.v1.${spaceId}.${path ?? ''}`
    const known = storage?.getItem(key) ?? null
    const toRef = (id: string): Parameters<typeof ctx.sessions.open>[0] => id as never
    if (known !== null && ctx.sessions.binding(toRef(known))?.session !== undefined) {
      ctx.sessions.open(toRef(known))
      ctx.layout.openFloatConversation()
      return
    }
    void (async () => {
      const area = await viewRemote().openSpaceWorkspace(spaceId).catch(() => undefined)
      const workspaceId = area?.ok === true ? area.value.workspaceId : null
      const sessionId = await ctx.sessions.create(workspaceId === null ? {} : { workspaceId: workspaceId as never })
      try {
        storage?.setItem(key, sessionId)
      } catch {
        // A blocked storage keeps this conversation in memory only.
      }
      // create() returns before the browser list carries the binding, so read
      // the session only after the refresh.
      await ctx.sessions.refresh().catch(() => undefined)
      const session = ctx.sessions.binding(toRef(sessionId))?.session
      if (session !== undefined) {
        const title = area?.ok === true && area.value.title !== null ? area.value.title : t('spaces.chatTitle')
        await session.rename(`${t('spaces.chatTitle')}: ${title}`).catch(() => undefined)
      }
      ctx.sessions.open(toRef(sessionId))
      ctx.layout.openFloatConversation()
      // The float mounts the Session; seed after it so the injected context
      // reaches a live agent instead of a registry entry with no conversation.
      await viewRemote().seedMailSession(sessionId, seed, true).catch(() => undefined)
    })().catch(() => {
      // The tablero stays open; the next click retries the session.
    })
  }

  /** Mail context injected when the floating conversation opens on one email. */
  function mailConversationContext(input: MailChatInput): string {
    return [
      `Abre este correo y trabájalo conmigo: uid ${input.uid}.`,
      ...input.from === null ? [] : [`De: ${input.from}`],
      ...input.subject === null ? [] : [`Asunto: ${input.subject}`],
      ...input.spaceTitle === null ? [] : [`Space: ${input.spaceTitle}`],
      ...input.attachments.length === 0 ? [] : [`Adjuntos: ${input.attachments.join(', ')}`],
      ...input.body.trim().length === 0
        ? []
        : ['<untrusted-email>', input.body.slice(0, 6000), '</untrusted-email>'],
      'Puedes usar tools y MCP para leer el hilo completo. No envíes el correo sin mi confirmación.',
    ].join('\n')
  }

  /** Spaces, their memory, and their files, as the floating conversation reads them. */
  function mailSpacesContext(brief: {
    readonly total: number
    readonly candidates: readonly {
      readonly title: string
      readonly parentTitle: string | null
      readonly memory: readonly string[]
      readonly files: readonly string[]
    }[]
  }): string {
    const lines = ['<untrusted-spaces>', `Spaces del owner: ${String(brief.total)}.`]
    for (const space of brief.candidates) {
      lines.push(`- «${space.parentTitle === null ? space.title : `${space.parentTitle} / ${space.title}`}»`)
      if (space.memory.length > 0) lines.push(`  memoria: ${space.memory.join(' | ')}`)
      if (space.files.length > 0) lines.push(`  archivos: ${space.files.join(', ')}`)
    }
    lines.push('</untrusted-spaces>')
    return lines.join('\n')
  }

  /** Publish the card the floating banner reads for this mail. */
  function writeMailSuggestion(input: MailSuggestionPayload): void {
    try {
      localStorage.setItem('faberloom.mail.suggestion', JSON.stringify(input satisfies MailSuggestionPayload))
      window.dispatchEvent(new Event('faberloom:mail-suggestion'))
    } catch {
      // A blocked storage only hides the optional card.
    }
  }

  /** Publish the card the floating banner reads for this draft. */
  function writeDraftSuggestion(input: DraftSuggestionPayload): void {
    try {
      localStorage.setItem('faberloom.mail.suggestion', JSON.stringify(input satisfies DraftSuggestionPayload))
      window.dispatchEvent(new Event('faberloom:mail-suggestion'))
    } catch {
      // A blocked storage only hides the optional card.
    }
  }

  /** Drop the published card after the owner accepted it. */
  function clearFloatSuggestion(): void {
    try {
      localStorage.removeItem('faberloom.mail.suggestion')
    } catch {
      // A blocked storage only leaves the card data behind.
    }
    window.dispatchEvent(new Event('faberloom:mail-suggestion'))
  }

  /**
   * Link a draft to its confirmed Space and keep the conversation in the float.
   * The revision is read again at click time, so an agent edit made meanwhile
   * is never overwritten by a stale confirmation.
   * @param draftId - draft the card is showing.
   */
  async function attachDraftSuggestion(draftId: string): Promise<void> {
    const suggestion = await viewRemote().draftSpaceSuggestion(draftId)
    if (!suggestion.ok) return
    const value = suggestion.value
    if (value.kind !== 'existing' && value.kind !== 'create') return
    const result = await viewRemote().draftAttachToSpace(
      draftId,
      value.kind === 'existing'
        ? { spaceId: value.spaceId, expectedRevision: value.revision }
        : { title: value.title, expectedRevision: value.revision },
    )
    if (!result.ok) return
    refresh()
    clearFloatSuggestion()
    if (result.value.sessionId === null) return
    // The transferred continuation was created by the Host outside the list.
    await ctx.sessions.refresh().catch(() => undefined)
    ctx.sessions.open(result.value.sessionId as never)
    ctx.layout.openFloatConversation()
  }

  /**
   * Attach the mail and the live conversation to a Space, then show that chat
   * in the main conversation. The conversation on screen is the one that moves,
   * whether the float holds the mail chat or a draft chat.
   * @param input - the open mail and the offered Space.
   */
  function attachMailSuggestion(input: MailSuggestionPayload): void {
    const name = (input.spaceName ?? input.subject ?? 'Correo').trim() || 'Correo'
    const toRef = (id: string): Parameters<typeof ctx.sessions.open>[0] => id as never
    const storage = ((): Storage | undefined => {
      try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
      } catch {
        return undefined
      }
    })()
    const selected = ctx.sessions.list.getSnapshot().current
    const known = selected ?? storage?.getItem(`faberloom.mail.chat.v2.${input.uid}`) ?? null
    void viewRemote().attachMailToSpace(
      input.uid,
      input.spaceId ?? undefined,
      name,
      known === null ? undefined : known,
      input.subject ?? undefined,
    ).then(async (result) => {
      if (!result.ok) return
      refresh()
      try {
        storage?.removeItem('faberloom.mail.suggestion')
      } catch {
        // A blocked storage only leaves the card data behind.
      }
      let target = result.value.sessionId
      if (target === null) {
        // The float never held a conversation: open one born in this Space.
        target = String(await ctx.sessions.create({ workspaceId: result.value.workspaceId as never }))
        await ctx.sessions.refresh().catch(() => undefined)
        const session = ctx.sessions.binding(toRef(target))?.session
        if (session !== undefined) {
          await session.rename(`Correo: ${input.subject ?? 'sin asunto'}`).catch(() => undefined)
          await viewRemote().seedMailSession(target, mailConversationContext({
            uid: input.uid,
            subject: input.subject,
            from: input.from,
            body: input.body,
            attachments: input.attachments,
            spaceId: result.value.spaceId,
            spaceTitle: name,
          }), true, t('email.mailSummaryPrompt')).catch(() => undefined)
        }
      }
      // A transferred continuation was created by the Host outside the list.
      await ctx.sessions.refresh().catch(() => undefined)
      ctx.sessions.open(toRef(target))
      ctx.layout.closeFloatConversation()
      ctx.layout.selectPanel(null)
    }).catch((error: unknown) => {
      // The card stays on screen; a retry is a new click.
      void error
    })
  }

  /** Assistant answers a conversation needs before a Space is offered. */
  const MAIL_SPACE_TURNS = 4

  /**
   * Offer a Space only when the conversation already has depth and the Host
   * ranks a real match. Returns null while the mail is still being read, when
   * no Space fits, or when the browser never opened a conversation for it.
   * @param input - the open mail.
   * @returns the matched Space, or null.
   */
  async function suggestMailSpace(input: MailSuggestionPayload): Promise<{ spaceId: string; spaceName: string } | null> {
    const storage = ((): Storage | undefined => {
      try {
        return typeof localStorage === 'undefined' ? undefined : localStorage
      } catch {
        return undefined
      }
    })()
    const sessionId = storage?.getItem(`faberloom.mail.chat.v2.${input.uid}`) ?? null
    if (sessionId === null) return null
    const turns = await viewRemote().mailSessionTurns(sessionId).catch(() => undefined)
    if (turns === undefined || !turns.ok || turns.value < MAIL_SPACE_TURNS) return null
    const brief = await viewRemote().mailSpaceBrief(input.subject ?? undefined, input.from ?? undefined, input.body).catch(() => undefined)
    if (brief === undefined || !brief.ok) return null
    const best = brief.value.candidates[0]
    if (best === undefined || best.score < 2) return null
    return {
      spaceId: best.id,
      spaceName: best.parentTitle === null ? best.title : `${best.parentTitle} / ${best.title}`,
    }
  }

  const injected = (bound: WorkspaceActions): FaberloomPanelInjected => {
    actions = bound
    return {
      load: refresh,
      startConversation: () => { ctx.layout.selectPanel(null) },
      openMailChat: (input) => {
        writeMailSuggestion({
          uid: input.uid,
          subject: input.subject,
          from: input.from,
          body: input.body,
          attachments: input.attachments,
          spaceId: input.spaceId,
          spaceName: input.spaceTitle,
        })
        // The key is versioned: sessions created before the opening turn existed
        // are empty, so a new click must not reuse them.
        const key = `faberloom.mail.chat.v2.${input.uid}`
        const storage = ((): Storage | undefined => {
          try {
            return typeof localStorage === 'undefined' ? undefined : localStorage
          } catch {
            return undefined
          }
        })()
        const known = storage?.getItem(key) ?? null
        const toRef = (id: string): Parameters<typeof ctx.sessions.open>[0] => id as never
        if (known !== null && ctx.sessions.binding(toRef(known))?.session !== undefined) {
          ctx.sessions.open(toRef(known))
          ctx.layout.openFloatConversation()
          return
        }
        void (async () => {
          let workspaceId: string | null = null
          if (input.spaceId !== null && input.spaceId.length > 0) {
            const area = await viewRemote().openSpaceWorkspace(input.spaceId).catch(() => undefined)
            if (area?.ok === true) workspaceId = area.value.workspaceId
          }
          const sessionId = await ctx.sessions.create(
            workspaceId === null ? {} : { workspaceId: workspaceId as never },
          )
          try {
            storage?.setItem(key, sessionId)
          } catch {
            // A blocked storage keeps this conversation in memory only.
          }
          // create() returns before the browser list carries the new binding; the
          // seed and the rename address it, so read it only after the refresh.
          await ctx.sessions.refresh().catch(() => undefined)
          const session = ctx.sessions.binding(toRef(sessionId))?.session
          if (session !== undefined) {
            await session.rename(`Correo: ${input.subject ?? 'sin asunto'}`).catch(() => undefined)
            const brief = await viewRemote()
              .mailSpaceBrief(input.subject ?? undefined, input.from ?? undefined, input.body)
              .catch(() => undefined)
            // The mail travels as injected context; the question below is the
            // first turn, so the float opens with a summary instead of an empty composer.
            await viewRemote().seedMailSession(
              sessionId,
              [
                mailConversationContext(input),
                ...brief?.ok === true ? [mailSpacesContext(brief.value)] : [],
                'Si este correo pertenece a uno de esos Spaces, dilo por su nombre (con el padre si es un subespacio) y ofrece agregarlo a ese Space como una sesión de chat. No inventes un Space que no esté en la lista.',
              ].join('\n\n'),
              true,
              t('email.mailSummaryPrompt'),
            ).catch(() => undefined)
          }
          ctx.sessions.open(toRef(sessionId))
          ctx.layout.openFloatConversation()
        })().catch((error: unknown) => {
          // The email stays open; the next click retries the session.
          void error
        })
      },
      openDraftChat: (draftId, sessionTitle, options) => runDraftChat(ctx, bound, draftId, sessionTitle, {
        ...options,
        // The Host reports the Space while opening the conversation, so the
        // panel publishes the card without a second suggestion round trip.
        onSuggestion: (suggestion) => {
          if (options?.float === true && (suggestion.kind === 'existing' || suggestion.kind === 'create')) {
            writeDraftSuggestion({ kind: 'draft', draftId, suggestion })
          }
        },
      }),
      attachMailSuggestion,
      createSpace: (title, agentId, parentId, inheritContext) => {
        write(() => viewRemote().createSpace(title, agentId ?? undefined, parentId ?? undefined, inheritContext))
      },
      createSpaceFromFolder: (title, path, parentId) => {
        const run = viewRemote().createSpaceFromFolder(title, path, parentId ?? undefined)
        write(() => run)
        return run
      },
      deleteSpace: (id) => { write(() => viewRemote().deleteSpace(id)) },
      goToWorkspace: (spaceId) => { openSpaceWorkspace(spaceId) },
      adoptSpaceWorkspace: (spaceId) => {
        void runAdoptSpaceWorkspace(ctx.remote.directoryPicker, viewRemote(), refresh, spaceId).catch(() => {
          // A cancelled pick or a failed adoption keeps the current workspace.
        })
      },
      exportContextToFolder: spaceId => viewRemote().exportSpaceViewToFolder(spaceId, 'context', '', 'markdown'),
      renameSpace: (id, title) => { write(() => viewRemote().renameSpace(id, title)) },
      createAgent: (input) => {
        write(() => viewRemote().createAgent(
          input.name, input.responsibility, input.provider ?? undefined, input.model ?? undefined,
          input.apiKey.length === 0 ? undefined : input.apiKey, input.webAccess, input.mwtMcp,
          input.sicopMcp, input.mailConnectionIds, input.subagentIds,
        ))
      },
      deactivateAgent: (id) => { write(() => viewRemote().deleteAgent(id)) },
      purgeAgent: (id) => { write(() => viewRemote().purgeAgent(id)) },
      reopenBoardItem: (id) => { const run = viewRemote().reopenBoardItem(id); write(() => run); return run },
      submitBoardRevision: (id, input) => {
        const run = viewRemote().submitBoardRevision(id, input)
        write(() => run)
        return run
      },
      boardException: (id, action) => { const run = viewRemote().boardException(id, action); write(() => run); return run },
      boardSetSeverity: (id, severity, rowVersion, source, confidence) => {
        const run = viewRemote().boardSetSeverity(id, severity as never, rowVersion, source ?? 'HUMAN', confidence ?? null)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardAssignAgent: (id, agentId, rowVersion, remember) => {
        const run = viewRemote().boardAssignAgent(id, agentId, rowVersion, remember ?? false)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardArtifactUrl: key => viewRemote().boardArtifactUrl(key),
      boardSaveEdits: (id, input) => {
        const run = viewRemote().boardSaveEdits(id, {
          expectedRowVersion: input.rowVersion, baseVersion: input.baseVersion, changes: input.changes,
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardApprove: (id, input) => {
        const run = viewRemote().boardApprove(id, {
          expectedRowVersion: input.rowVersion,
          expectedArtifactVersion: input.artifactVersion,
          expectedArtifactHash: input.artifactHash,
          ...input.confirmations === undefined ? {} : { confirmations: input.confirmations },
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardApproveWithEdits: (id, input) => {
        const run = viewRemote().boardApproveWithEdits(id, {
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
        const run = viewRemote().boardDiscard(id, {
          expectedRowVersion: input.rowVersion,
          reason: input.reason,
          ...input.note === undefined ? {} : { note: input.note },
        })
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardResolveCandidate: (id, candidateId, candidateHash, decision) => {
        const run = viewRemote().boardResolveCandidate(id, candidateId, candidateHash, decision)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardAssignWorkspace: (id, workspaceId) => {
        const run = viewRemote().boardAssignWorkspace(id, workspaceId)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEvents: id => viewRemote().boardEvents(id),
      boardGetDraft: id => viewRemote().boardGetDraft(id),
      boardSaveDraft: (id, input) => viewRemote().boardSaveDraft(id, input),
      boardTakeDraft: (id, writerSession) => viewRemote().boardTakeDraft(id, writerSession),
      boardDiscardDraft: id => viewRemote().boardDiscardDraft(id),
      boardRevalidate: (id, changed) => {
        const run = viewRemote().boardRevalidate(id, changed)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIteration: id => viewRemote().boardIteration(id),
      // An empty provider says the session names none, so the host assumes the
      // deployment's default; the wire always carries the field (§8.5, W-48).
      boardIterationContext: (id, providerId = '') => viewRemote().boardIterationContext(id, providerId),
      boardIterationStart: (id, baseVersion, actorSession) => {
        const run = viewRemote().boardIterationStart(id, baseVersion, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationSaveDraft: (id, input) => viewRemote().boardIterationSaveDraft(id, input),
      boardIterationApply: (id, input) => {
        const run = viewRemote().boardIterationApply(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationRenew: (id, input) => viewRemote().boardIterationRenew(id, input),
      boardIterationPause: (id, input) => {
        const run = viewRemote().boardIterationPause(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationCancel: (id, input) => {
        const run = viewRemote().boardIterationCancel(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationResume: (id, baseVersion, actorSession) => {
        const run = viewRemote().boardIterationResume(id, baseVersion, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationRecover: (id, draftKey, actorSession) => {
        const run = viewRemote().boardIterationRecover(id, draftKey, actorSession)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardIterationDraft: (id, iterationId) => viewRemote().boardIterationDraft(id, iterationId),
      boardApproveWithExecution: (id, input) => {
        const run = viewRemote().boardApproveWithExecution(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectStatus: id => viewRemote().boardEffectStatus(id),
      boardEffectAlerts: () => viewRemote().boardEffectAlerts(),
      boardEffectPolicy: () => viewRemote().boardEffectPolicy(),
      boardEffectRevert: (id, input) => {
        const run = viewRemote().boardEffectRevert(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectRetry: (id, input) => {
        const run = viewRemote().boardEffectRetry(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectReconcile: (id, input) => {
        const run = viewRemote().boardEffectReconcile(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectProbe: (id, input) => {
        const run = viewRemote().boardEffectProbe(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardEffectAdminClose: (id, input) => {
        const run = viewRemote().boardEffectAdminClose(id, input)
        void run.then((result) => { if (result.ok) refresh() })
        return run
      },
      boardSignatures: () => viewRemote().boardSignatures(),
      boardSignatureStatus: actionType => viewRemote().boardSignatureStatus(actionType),
      boardSignatureIssue: input => viewRemote().boardSignatureIssue(input),
      boardSignatureRevoke: signatureId => viewRemote().boardSignatureRevoke(signatureId),
      createRoutine: (name, spaceId) => { write(() => viewRemote().createRoutine(name, name, spaceId ?? undefined)) },
      setRoutineActive: (id, active) => { write(() => viewRemote().setRoutineActive(id, active)) },
      remember: (text, spaceId) => { write(() => viewRemote().remember(text, spaceId ?? undefined)) },
      spaceMemory: spaceId => viewRemote().spaceMemory(spaceId),
      deleteSpaceMemory: id => viewRemote().deleteSpaceMemory(id),
      setMemoryVisibility: (id, visibility) => viewRemote().setMemoryVisibility(id, visibility),
      setWorkflowVisibility: (id, visibility) => viewRemote().setWorkflowVisibility(id, visibility),
      setRoutineVisibility: (id, visibility) => { write(() => viewRemote().setRoutineVisibility(id, visibility)) },
      agentDetail: id => viewRemote().agentDetail(id),
      models: () => viewRemote().models(),
      modelCatalog: () => viewRemote().modelCatalog(),
      recommendModel: agentId => viewRemote().recommendModel(agentId),
      teachings: (spaceId, agentId, task) => viewRemote().teachings(spaceId, agentId, task),
      saveTeaching: input => viewRemote().saveTeaching(input),
      activateTeaching: (id, proposalVersion) => viewRemote().activateTeaching(id, proposalVersion),
      teachingHealth: () => viewRemote().teachingHealth(),
      editTeaching: (id, text, reason) => viewRemote().editTeaching(id, text, reason),
      revokeTeaching: id => viewRemote().revokeTeaching(id),
      discardTeaching: (id, reason) => viewRemote().discardTeaching(id, reason),
      mergeTeachings: (ids, text, reason) => viewRemote().mergeTeachings(ids, text, reason),
      curationReport: () => viewRemote().curationReport(),
      mwtWrites: itemId => viewRemote().mwtWrites(itemId),
      mwtAuthorizeWrite: (id, scope) => viewRemote().mwtAuthorizeWrite(id, scope),
      mwtExecuteWrite: (id, authorizationId) => viewRemote().mwtExecuteWrite(id, authorizationId),
      mwtReconcileWrite: (id, resolution, ref) => viewRemote().mwtReconcileWrite(id, resolution, ref),
      performance: (agentId, task) => viewRemote().performance(agentId, task),
      costs: (agentId, task) => viewRemote().costs(agentId, task),
      grants: () => viewRemote().grants(),
      grant: input => viewRemote().grant(input),
      revokeGrant: id => viewRemote().revokeGrant(id),
      mwtStatus: () => viewRemote().mwtStatus(),
      mwtConnect: (usuario, password) => viewRemote().mwtConnect(usuario, password),
      mwtDisconnect: () => viewRemote().mwtDisconnect(),
      mcpTokens: () => viewRemote().mcpTokens(),
      mcpTools: () => viewRemote().mcpTools(),
      sicopStatus: () => viewRemote().sicopStatus(),
      probeSicop: () => viewRemote().probeSicop(),
      mcpAuthorizations: () => viewRemote().mcpAuthorizations(),
      mcpAuthorizationDecide: (id, decision) => viewRemote().mcpAuthorizationDecide(id, decision),
      mintMcpToken: input => viewRemote().mintMcpToken(input),
      revokeMcpToken: token => viewRemote().revokeMcpToken(token),
      saveAgent: (id, input) => viewRemote().saveAgent(id, input),
      shareAgent: (id, emails, allUsers) => viewRemote().shareAgent(id, [...emails], allUsers),
      shareSkill: (name, emails, allUsers) => viewRemote().shareSkill(name, [...emails], allUsers),
      shares: () => viewRemote().shares(),
      unshareShare: id => viewRemote().unshareShare(id),
      skills: () => viewRemote().skills(),
      spaceTree: spaceId => viewRemote().spaceTree(spaceId),
      renameSpaceEntry: (spaceId, path, name) => viewRemote().renameSpaceEntry(spaceId, path, name),
      deleteSpaceEntries: (spaceId, paths) => viewRemote().deleteSpaceEntries(spaceId, paths),
      moveSpaceEntry: (spaceId, path, targetSpaceId, targetDir) => (
        viewRemote().moveSpaceEntry(spaceId, path, targetSpaceId, targetDir ?? '')
      ),
      openSpaceChat: (spaceId, path, seed) => { openSpaceChat(spaceId, path, seed) },
      openSpaceFile: (spaceId, path) => viewRemote().openSpaceFile(spaceId, path),
      readSpaceFile: (spaceId, path) => viewRemote().readSpaceFile(spaceId, path),
      saveSkill: (name, markdown) => viewRemote().saveSkill(name, markdown),
      skillMarkdown: name => viewRemote().skillMarkdown(name),
      removeSkill: name => viewRemote().removeSkill(name),
      skillInstalls: () => viewRemote().skillInstalls(),
      installHarness: (source, replace) => viewRemote().installHarness(source, replace),
      uninstallSkill: (name, destination) => viewRemote().uninstallSkill(name, destination),
      pickFolder: async () => {
        const picked = await ctx.remote.directoryPicker.pick(undefined)
        return picked.ok ? picked.value : null
      },
      pickArchive: async () => {
        const picked = await ctx.remote.directoryPicker.pickFile()
        return picked.ok ? picked.value : null
      },
      connections: () => viewRemote().connections(),
      saveConnection: input => viewRemote().saveConnection(input),
      removeConnection: id => viewRemote().removeConnection(id),
      probeConnection: id => viewRemote().probeConnection(id),
      // The Connections table merges this owner's MCP servers beside their mail
      // connections; the registry owns their records and their secrets.
      mcpServers: () => viewRemote().mcpServers(),
      saveMcpServer: input => viewRemote().saveMcpServer(input),
      removeMcpServer: name => viewRemote().removeMcpServer(name),
      probeMcpServer: input => viewRemote().probeMcpServer(input),
      emailInbox: (limit, page, connectionId, mailbox, filter, query) =>
        viewRemote().emailInbox(limit, page, connectionId, mailbox, filter, query),
      emailFolders: () => viewRemote().emailFolders(),
      emailRead: (uid, mailbox) => viewRemote().emailRead(uid, mailbox),
      emailMarkSeen: (uid, seen, mailbox) => viewRemote().emailMarkSeen(uid, seen, mailbox),
      emailTrash: (uid, sender, subject, mailbox) => viewRemote().emailTrash(uid, sender, subject, mailbox),
      emailMove: (uid, destination, mailbox) => viewRemote().emailMove(uid, destination, mailbox),
      emailRestore: (uid, mailbox) => viewRemote().emailRestore(uid, mailbox),
      emailAttachment: (uid, index) => viewRemote().emailAttachment(uid, index),
      emailImage: source => viewRemote().emailImage(source),
      saveAttachmentToSpace: (spaceId, uid, name) => viewRemote().saveSpaceAttachment(spaceId, uid, name),
      sendSpaceFileByEmail: (spaceId, path, to, subject, text) =>
        viewRemote().sendSpaceFileByEmail(spaceId, path, to, subject, text),
      spaceFromEmail: (uid, name, agentId, from, spaceId) => {
        runSpaceFromEmail(ctx, bound, refresh, { uid, name, agentId, from, ...spaceId === undefined ? {} : { spaceId } })
      },
      routineChat: (uid, messages, subject, from) =>
        viewRemote().routineChat(uid, [...messages], subject ?? undefined, from ?? undefined),
      emailChat: (uid, messages, subject, from, options) =>
        viewRemote().emailChat(uid, [...messages], subject ?? undefined, from ?? undefined, options),
      routineFromEmail: (uid, name, instruction, subject, from) =>
        viewRemote().routineFromEmail(uid, name, instruction, subject ?? undefined, from ?? undefined),
      openRoutines: () => { ctx.layout.selectPanel('faberloom-routines' as never) },
      learnFromEmail: uid => viewRemote().learnFromEmail(uid),
      emailDrafts: () => viewRemote().emailDrafts(),
      saveEmailDraft: input => viewRemote().saveEmailDraft(input),
      deleteEmailDraft: (id, reason) => viewRemote().deleteEmailDraft(id, reason),
      draftSessionHistory: draftId => viewRemote().draftSessionHistory(draftId),
      draftRestore: (draftId, revision, expectedRevision) => viewRemote().draftRestore(draftId, revision, expectedRevision),
      sendEmailDraft: (id, seenUpdatedAt, seenRevision) => viewRemote().sendEmailDraft(id, seenUpdatedAt, seenRevision),
      emailSendIntents: draftId => viewRemote().emailSendIntents(draftId),
      emailResolveSend: (draftId, resolution) => viewRemote().emailResolveSend(draftId, resolution),
      emailVoice: spaceId => viewRemote().emailVoice(spaceId),
      emailSignatures: () => viewRemote().emailSignatures(),
      saveEmailSignature: (account, text, auto, html) => viewRemote().saveEmailSignature(account, text, auto, html),
      deleteEmailSignature: account => viewRemote().deleteEmailSignature(account),
      emailDraftWithAi: input => viewRemote().emailDraftWithAi(input),
      backups: () => viewRemote().backups(),
      createBackup: note => viewRemote().createBackup(note),
      verifyBackup: id => viewRemote().verifyBackup(id),
      restoreBackup: (id, dryRun) => viewRemote().restoreBackup(id, dryRun),
      deleteBackup: id => viewRemote().deleteBackup(id),
      proposeWork: text => viewRemote().proposeWork(text),
      experienceFor: (spaceId, query) => viewRemote().experienceFor(spaceId, query),
      createAgentFromWork: (text, name, spaceId) => viewRemote().createAgentFromWork(text, name, spaceId),
      createRoutineFromWork: (text, name) => viewRemote().createRoutineFromWork(text, name),
      linkPreview: spaceId => viewRemote().linkPreview(spaceId),
      spaceDetail: id => viewRemote().spaceDetail(id),
      prepareHarness: (id, title) => viewRemote().prepareHarness('space', id, title),
      saveSpace: (id, input) => viewRemote().saveSpace(id, input),
      spaceWorkspace: id => viewRemote().spaceWorkspace(id),
      startSpaceSession: (spaceId) => {
        void viewRemote().openSpaceWorkspace(spaceId).then((result) => {
          if (!result.ok || result.value.workspaceId === null) return
          void ctx.sessions.create({ workspaceId: result.value.workspaceId as never })
            .then((sessionId) => { ctx.sessions.open(sessionId); ctx.layout.selectPanel(null) })
        })
      },
      openSession: (sessionId) => {
        ctx.sessions.open(sessionId as never)
        ctx.layout.selectPanel(null)
      },
      setSpacePermissions: (spaceId, email, permissions) => viewRemote().setSpacePermissions(spaceId, email, [...permissions]),
      routineDetail: id => viewRemote().routineDetail(id),
      saveRoutine: (id, input) => {
        const run = viewRemote().saveRoutine(id, input)
        write(() => run)
        return run
      },
      removeRoutine: (id) => {
        const run = viewRemote().removeRoutine(id)
        write(() => run)
        return run
      },
      boardDetail: id => viewRemote().boardDetail(id),
      boardViews: () => viewRemote().boardViews(),
      boardSaveView: (name, filters) => viewRemote().boardSaveView(name, filters),
      boardRemoveView: name => viewRemote().boardRemoveView(name),
      boardRouteInstruction: (id, text) => viewRemote().boardRouteInstruction(id, text),
      boardClassify: limit => viewRemote().boardClassify(limit),
      boardAccounts: () => viewRemote().boardAccounts(),
      deleteBoardItem: (id) => {
        const run = viewRemote().deleteBoardItem(id)
        write(() => run)
        return run
      },
      setBoardRoutine: (id, routineId) => {
        const run = viewRemote().setBoardRoutine(id, routineId)
        write(() => run)
        return run
      },
      openTaskEntry: input => viewRemote().openTaskEntry(input),
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
      executions: routineId => viewRemote().executions(routineId),
      startRoutine: routineId => viewRemote().startRoutine(routineId),
      tickRoutine: routineId => viewRemote().tickRoutine(routineId),
      reconcileExecution: id => viewRemote().reconcileExecution(id),
      cancelExecutionEffect: (id, stepId) => viewRemote().cancelExecutionEffect(id, stepId),
      workflows: {
        overview: () => viewRemote().workflowOverview(),
        detail: id => viewRemote().workflowDetail(id),
        create: (name, spaceId) => viewRemote().createWorkflow(name, spaceId),
        remove: id => viewRemote().deleteWorkflow(id),
        save: (id, name) => viewRemote().saveWorkflow(id, name),
        addNode: (id, kind, title, configJson, nodeId) => viewRemote().addNode(id, kind, title, configJson, nodeId),
        updateNode: (id, nodeId, title, kind, configJson) => viewRemote().updateNode(id, nodeId, title, kind, configJson),
        removeNode: (id, nodeId) => viewRemote().removeNode(id, nodeId),
        connect: (id, from, to, condition) => viewRemote().connect(id, from, to, condition),
        disconnect: (id, edgeId) => viewRemote().disconnect(id, edgeId),
        setStatus: (id, status) => viewRemote().setWorkflowStatus(id, status),
        setConcurrency: (id, maxConcurrency) => viewRemote().setWorkflowConcurrency(id, maxConcurrency),
        runs: id => viewRemote().workflowRuns(id),
        topology: () => viewRemote().spaceTopology(),
        links: () => viewRemote().routineWorkflowLinks(),
        shareWorkflow: (id, emails, permissions) => viewRemote().shareWorkflow(id, emails, permissions),
        shareSpace: (id, emails, permissions) => viewRemote().shareSpace(id, emails, permissions),
        resourceShares: (kind, id) => viewRemote().resourceShares(kind, id),
        revokeShareGrant: grantId => viewRemote().revokeShareGrant(grantId),
        health: () => viewRemote().executionHealth(),
        exportFlow: (id, format) => viewRemote().exportWorkflow(id, format),
        templates: () => viewRemote().workflowTemplates(),
        createFromTemplate: (templateId, name) => viewRemote().createWorkflowFromTemplate(templateId, name),
        importFlow: (json, name) => viewRemote().importWorkflow(json, name),
        workflowVersions: id => viewRemote().workflowVersions(id),
        restoreWorkflow: (id, version) => viewRemote().restoreWorkflow(id, version),
      },
      context: {
        entries: () => viewRemote().contextEntries(),
        create: (title, body, spaceId) => viewRemote().createContext(title, body, spaceId),
        update: (id, title, body) => viewRemote().updateContext(id, title, body),
        versions: id => viewRemote().contextVersions(id),
        restore: (id, version) => viewRemote().restoreContext(id, version),
        approve: id => viewRemote().approveContext(id),
        reject: id => viewRemote().rejectContext(id),
        remove: id => viewRemote().removeContext(id),
        export: (spaceId, format) => viewRemote().exportContext(spaceId, format),
        import: payload => viewRemote().importContext(payload),
        replace: (spaceId, entriesJson) => viewRemote().replaceContext(spaceId, entriesJson),
      },
      sessionsShare: {
        list: spaceId => viewRemote().spaceSessions(spaceId),
        content: (spaceId, ownerId, sessionId) => viewRemote().spaceSessionContent(spaceId, ownerId, sessionId),
        remove: (spaceId, ownerId, sessionId) => viewRemote().removeSpaceSession(spaceId, ownerId, sessionId),
      },
      approvals: {
        contextEntries: () => viewRemote().contextEntries(),
        syncContext: () => viewRemote().syncContext(),
        workflowChanges: () => viewRemote().workflowPendingChanges(),
        acceptWorkflow: id => viewRemote().acceptWorkflowChange(id),
        rejectWorkflow: id => viewRemote().rejectWorkflowChange(id),
      },
    }
  }

  // A single slot keeps one occupant per priority and renders the lowest. The
  // stock app fills both brand cells with the official wordmark at the default
  // priority, so the FaberLoom identity registers below it to render instead.
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -10,
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandName))

  // Replace the harness's own mark with the FaberLoom isotipo, in both places it shows.
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    priority: -10,
    locale: NS,
    inject: () => ({}),
  }, FaberloomBrandMark))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -10,
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

  // Placement travels beside the registration: a Host registry that drops
  // unknown registration members would otherwise flatten every group.
  const placements = new Map<string, PanelPlacement>()

  for (const section of FABERLOOM_SECTIONS) {
    // The slot renderer blanks a panel that throws; keep the failure readable.
    const Page = section.Page
    const Guarded = (props: Parameters<typeof Page>[0]) =>
      createElement(
        PanelBoundary,
        { name: section.id, failureTitle: props.t('panel.failed', { name: section.id }) },
        createElement(Page, props),
      )
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: section.id,
      store: workspace,
      locale: NS,
      inject: injected,
    }, Guarded))
    // A section may keep its panel reachable without listing a sidebar row (the
    // Chat landing, or Skills folded into the Agents tab).
    if (section.sidebar === false) continue
    // Beyond the row itself, the registration carries the design's navigation
    // metadata: the group the row belongs to, and — only for a section the live
    // overview counts — a badge resolved per read.
    const nav = {
      group: () => t(section.groupKey),
      ...(section.badge === undefined ? {} : { badge: () => sectionBadge(section, latestOverview) }),
    }
    placements.set(section.id, nav)
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

  // The FaberLoom shell. A host sidebar that predates the placement metadata
  // ignores the modes and groups this surface publishes, so the product owns
  // the column: it declares the same holes the host shell does, and every other
  // plugin's contribution still lands unchanged.
  const workspaceNavigation = ctx.get('uiWorkspace') as { startSession: (workspaceId?: string) => void } | undefined
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const syncPanels = (): void => {
    const next = projectPanels(ctx.slots.entriesOfSlot('sidebar.panellist'), id => placements.get(id))
    if (!samePanels(panels.getSnapshot(), next)) panels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'ui-faberloom: sidebar rows')
  ctx.effect(() => ctx.locale.subscribe(syncPanels), 'ui-faberloom: sidebar labels')

  // Whether a Host browser occupies the browsing hole. The shell draws its own
  // Space tree while this is false, so a Host whose Workspace service never
  // activated no longer leaves the region blank. It starts true (never flash a
  // second tree over a working Host browser) and settles on the first checks.
  const workspacesFilled = createSnapshotStore(true)
  const syncWorkspacesFilled = (): void => {
    const filled = ctx.slots.entriesOfSlot('sidebar.workspaces').length > 0
    if (workspacesFilled.getSnapshot() !== filled) workspacesFilled.set(filled)
  }
  ctx.effect(
    () => ctx.slots.subscribe('sidebar.workspaces', syncWorkspacesFilled),
    'ui-faberloom: workspace tree occupancy',
  )
  // The Host browser registers through its own inject wait, which resolves after
  // this shell declares the hole; a few bounded checks catch it (and an empty
  // hole) without polling for the session's lifetime.
  ctx.effect(() => {
    const timers = [0, 120, 600, 2_000, 5_000].map(delay => window.setTimeout(syncWorkspacesFilled, delay))
    return () => { for (const timer of timers) window.clearTimeout(timer) }
  }, 'ui-faberloom: workspace tree settle')

  const sidebarInjected = (bound: WorkspaceActions): SidebarRootInjected => {
    actions = bound
    return {
      startSession: (workspaceId?: string) => { workspaceNavigation?.startSession(workspaceId) },
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      selectPanel: (id) => { ctx.layout.selectPanel(id) },
      load: refresh,
      openSpace: openSpaceWorkspace,
      hooks: { panels, workspacesFilled },
    }
  }
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    priority: -10,
    locale: NS,
    // The column draws the Workspace tree from the same overview the panels
    // read, so a Space created in the panel appears in the sidebar at once.
    store: workspace,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      // The row menu of the shell's own tree (drawn when the Host browser is
      // absent). It shares the owner contract of the Host tree's row menu.
      'faberloom.spaces.rowMenu': { kind: 'list', scope: 'root' },
    },
    inject: sidebarInjected,
  }, SidebarRoot))
  syncPanels()
  syncWorkspacesFilled()

  // The floating conversation's mail-to-Space card. The email panel publishes
  // the suggestion; the card only offers the two gestures.
  ctx.slots.inject('float.banner', () => ctx.slots.register({
    name: 'float.banner',
    locale: NS,
    inject: () => ({
      attach: (input: FloatSuggestionPayload) => {
        if ('draftId' in input) { void attachDraftSuggestion(input.draftId); return }
        attachMailSuggestion(input)
      },
      suggest: async (input: FloatSuggestionPayload): Promise<MailSpaceOffer | null> => {
        if ('draftId' in input) {
          const suggestion = input.suggestion
          if (suggestion.kind === 'existing') {
            return { spaceId: suggestion.spaceId, spaceName: suggestion.title, create: false, evidence: suggestion.evidence }
          }
          if (suggestion.kind === 'create') {
            return { spaceId: null, spaceName: suggestion.title, create: true, evidence: suggestion.evidence }
          }
          return null
        }
        const found = await suggestMailSpace(input)
        return found === null ? null : { ...found, create: false, evidence: [] }
      },
    }),
  }, MailSuggestionBanner))

  // MCP servers live in the Settings modal rather than a sidebar row: installing
  // one is deployment configuration the model can also do from a chat (the
  // `faberloom_mcp_add` tools), not a daily-work panel, and Settings is where the
  // product already keeps the surfaces that configure the harness (theme,
  // language, agent presets). The section reads and writes through the product's
  // own view Remote, so no host registry code reaches the browser.
  const mcpServersInjected = (): McpServersSectionInjected => ({
    load: () => viewRemote().mcpServers(),
    save: input => viewRemote().saveMcpServer(input),
    remove: name => viewRemote().removeMcpServer(name),
    test: input => viewRemote().probeMcpServer(input),
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
        const result = await viewRemote().shareSpaceByWorkspace(workspaceId, emails, permissions)
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
  // The shell's own tree publishes the same owner contract at its own hole, so
  // one contribution serves both trees.
  ctx.slots.inject('faberloom.spaces.rowMenu', () => ctx.slots.register({
    name: 'faberloom.spaces.rowMenu',
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
        const result = await viewRemote().overview()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      move: async (spaceId, parentId) => {
        const result = await viewRemote().saveSpace(spaceId, { parentId })
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
  ctx.slots.inject('faberloom.spaces.rowMenu', () => ctx.slots.register({
    name: 'faberloom.spaces.rowMenu',
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
        const overview = await viewRemote().overview()
        if (!overview.ok) return { ok: false, message: overview.error.message }
        const parent = overview.value.spaces.find(space => space.workspaceId === workspaceId)
        if (parent === undefined) return { ok: false, message: t('workspaces.createSubspaceNoSpace') }
        const result = await viewRemote().createSpace(title, undefined, parent.id, true)
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
  ctx.slots.inject('faberloom.spaces.rowMenu', () => ctx.slots.register({
    name: 'faberloom.spaces.rowMenu',
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
