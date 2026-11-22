/** Open the Host-owned native conversation of one email draft. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { viewRemoteOf } from './view-remote.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A draft Session retained through binding, rename, and deferred context injection. */
    faberloomDraftAgent: unknown
  }
}

/** The shared-store write used to report a failed opening. */
export interface DraftChatBound {
  setError(message: string): void
}

/** Session identity used by native workspace navigation. */
type SessionIdentity = Parameters<ClientContext['uiWorkspace']['forkSession']>[0]

/** Recover the branded navigation identity stored by the Host. */
function sessionIdentity(id: string): SessionIdentity {
  return id as SessionIdentity
}

/**
 * Open a draft's existing Session or let the Host seed and bind its first one without starting a turn.
 * Client setup holds its own Session reference through rename; navigation acquires
 * the independent main-view reference only after setup succeeds.
 * @param ctx - client root context carrying Sessions, workspace navigation, and layout.
 * @param bound - shared-store write surface for a visible failure.
 * @param draftId - Host-owned draft identity.
 * @param sessionTitle - localized title applied while the Session is retained.
 * @returns true after navigation, or false after publishing the failure without navigating.
 */
export async function openDraftChat(
  ctx: ClientContext, bound: DraftChatBound, draftId: string, sessionTitle: string,
): Promise<boolean> {
  const remote = viewRemoteOf(ctx)
  try {
    const opened = await remote.draftSessionOpen(draftId)
    if (!opened.ok) throw new Error(opened.error.message)
    const existing = opened.value.sessionId
    if (existing !== null) {
      ctx.uiWorkspace.openSession(sessionIdentity(existing))
      ctx.layout.selectPanel(null)
      return true
    }

    const started = await remote.draftSessionStart(draftId, opened.value.draft.revision)
    if (!started.ok) throw new Error(started.error.message)
    const sessionId = sessionIdentity(started.value.sessionId)
    await ctx.sessions.using(sessionId, { source: 'faberloomDraftAgent' }, async (reference) => {
      await reference.ready
      const renamed = await reference.binding.session.rename(sessionTitle)
      if (!renamed.ok) throw new Error(renamed.error.message)
    })
    ctx.uiWorkspace.openSession(sessionId)
    ctx.layout.selectPanel(null)
    return true
  } catch (error: unknown) {
    bound.setError(error instanceof Error ? error.message : String(error))
    return false
  }
}
