/**
 * The Email panel's "turn this email into a Space" gesture, in isolation: it
 * turns one message into a Space through the Remote face, opens the Space's
 * Workspace session, and starts that session with the email as its first
 * message, so the agent begins knowing the body and the extracted attachment
 * text instead of searching the mailbox for it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote client and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ctx.sessions (create / binding).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ctx.layout.selectPanel.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** The one write the seed performs on the shared store: publish a failure. */
export interface SpaceFromEmailBound {
  setError(message: string): void
}

/** The seed's arguments, exactly as the Email panel's Create gesture collects them. */
export interface SpaceFromEmailInput {
  readonly uid: string
  readonly name: string
  readonly agentId: string | null
  readonly from: string | null
}

/**
 * Create the Space from one email and hand the user to its conversation.
 * A read or write failure is published to the store; a failed session create
 * or prompt keeps the current panel. The Remote call does not reject — the
 * result carries the failure — so only the session steps need the inner catch.
 * @param ctx - client root context carrying the Remote face, sessions, and layout.
 * @param bound - the shared store's write surface, for a read or write failure.
 * @param refresh - republish the overview after a successful read.
 * @param input - the email uid, space title, chosen agent, and sender line.
 */
export function runSpaceFromEmail(
  ctx: ClientContext,
  bound: SpaceFromEmailBound,
  refresh: () => void,
  input: SpaceFromEmailInput,
): void {
  void ctx.remote.faberloomView.spaceFromEmail(
    input.uid, input.name, input.agentId ?? undefined, input.from ?? undefined,
  )
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
    })
    .catch(() => { bound.setError('space from email failed') })
}
