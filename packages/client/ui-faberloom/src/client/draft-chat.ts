/** Open the Host-owned native conversation of one email draft. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.sessions (refresh / binding) and ctx.remote.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ctx.uiWorkspace.openSession.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FaberLoomDraftSpaceSuggestion } from '@deepseek-ai/dsh-faberloom-view/types'
import { viewRemoteOf } from './view-remote.ts'

/** The shared-store write used to report a failed opening. */
export interface DraftChatBound {
  setError(message: string): void
}

/** How the draft conversation opens, and the first turn it asks. */
export interface DraftChatOptions {
  /** Open in the floating conversation instead of the main workspace. */
  readonly float?: boolean
  /** First question asked once per browser, so the panel opens answered. */
  readonly prompt?: string
  /**
   * Receive the Space the draft could join, as soon as the Host reports it.
   * The panel publishes that card before the float paints, so the gesture is
   * already on screen when the conversation appears.
   */
  readonly onSuggestion?: (suggestion: FaberLoomDraftSpaceSuggestion) => void
}

/** Session identity used by native workspace navigation. */
type SessionIdentity = Parameters<ClientContext['uiWorkspace']['forkSession']>[0]

/** Recover the branded navigation identity stored by the Host. */
function sessionIdentity(id: string): SessionIdentity {
  return id as SessionIdentity
}

/**
 * Open a draft's existing Session or let the Host seed and bind its first one without starting a turn.
 * The Host creates the Session before navigation; the Client refreshes its
 * list, then opens the conversation and lets the rename and the opening
 * question finish behind the panel instead of delaying it.
 * @param ctx - client root context carrying Sessions, workspace navigation, and layout.
 * @param bound - shared-store write surface for a visible failure.
 * @param draftId - Host-owned draft identity.
 * @param sessionTitle - localized title applied after the panel opens.
 * @param options - open in the float, ask the first summary question, and publish the Space card.
 * @returns true after navigation, or false after publishing the failure without navigating.
 */
export async function openDraftChat(
  ctx: ClientContext, bound: DraftChatBound, draftId: string, sessionTitle: string, options: DraftChatOptions = {},
): Promise<boolean> {
  const remote = viewRemoteOf(ctx)
  try {
    const opened = await remote.draftSessionOpen(draftId)
    if (!opened.ok) throw new Error(opened.error.message)
    options.onSuggestion?.(opened.value.spaceSuggestion)
    const existing = opened.value.sessionId
    if (existing !== null) {
      openDraftSession(ctx, sessionIdentity(existing), options)
      void greetOnce(remote, draftId, existing, options)
      return true
    }

    const started = await remote.draftSessionStart(draftId, opened.value.draft.revision)
    if (!started.ok) throw new Error(started.error.message)
    const sessionId = sessionIdentity(started.value.sessionId)
    // The Host created this Session outside the browser list, so refresh before
    // addressing its binding; an unlisted id would make open() fail loud.
    await ctx.sessions.refresh()
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error('faberloom: the draft Session is not listed yet')
    openDraftSession(ctx, sessionId, options)
    // The owner is already reading the conversation: naming it and asking the
    // first question continue in the background and report their own failures.
    void session.rename(sessionTitle).then(
      (renamed) => { if (!renamed.ok) bound.setError(renamed.error.message) },
      (error: unknown) => { bound.setError(error instanceof Error ? error.message : String(error)) },
    )
    void greetOnce(remote, draftId, started.value.sessionId, options)
    return true
  } catch (error: unknown) {
    bound.setError(error instanceof Error ? error.message : String(error))
    return false
  }
}

/** Open the conversation where the owner asked for it. */
function openDraftSession(ctx: ClientContext, sessionId: SessionIdentity, options: DraftChatOptions): void {
  if (options.float === true) {
    ctx.sessions.open(sessionId)
    ctx.layout.openFloatConversation()
    return
  }
  ctx.uiWorkspace.openSession(sessionId)
  ctx.layout.selectPanel(null)
}

/**
 * Ask the opening question once per Session in this browser, so the panel
 * opens with a summary and a later click continues the same conversation.
 * @param remote - FaberLoom view namespace.
 * @param draftId - draft whose Session receives the question.
 * @param sessionId - bound Session identity used as the marker key.
 * @param options - carries the localized opening question.
 */
async function greetOnce(
  remote: ReturnType<typeof viewRemoteOf>, draftId: string, sessionId: string, options: DraftChatOptions,
): Promise<void> {
  const prompt = options.prompt?.trim() ?? ''
  if (prompt.length === 0) return
  const storage = ((): Storage | undefined => {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      return undefined
    }
  })()
  const key = `faberloom.draft.greeted.${sessionId}`
  if (storage?.getItem(key) === '1') return
  try {
    storage?.setItem(key, '1')
  } catch {
    // A blocked storage only repeats the greeting.
  }
  await remote.draftSessionAsk(draftId, prompt).catch(() => undefined)
}
