/**
 * The Mesa mail effect adapter.
 *
 * The board owns when an effect leaves; it owns no mail client (E15). This row
 * is the `mail.send` provider: it reads the approved item, composes one
 * plain-text message from the revision the human approved, and sends it through
 * the owner's own SMTP connection. The destination is the normalised recipient
 * list the approval named.
 *
 * SMTP cannot dedupe, so the adapter declares `idempotent: false`: a retry of an
 * unknown outcome is not offered, and the operator reconciles it. Any throw
 * reaches the board as `DESCONOCIDO`, never as "sent" (W-22).
 * @module @deepseek-ai/dsh-faberloom-effects-mail
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { BoardEffectAdapter, BoardEffectDispatch, BoardEffectResult, FaberLoomBoardItem, FaberLoomBoardItemId } from '@deepseek-ai/dsh-faberloom-board'
// Type-only: resolves the ctx.faberloomConnections declaration this row sends through.
import type {} from '@deepseek-ai/dsh-faberloom-connections'

/** Plugin name the Loader reports. */
export const name = 'faberloom-effects-mail'

/** Both services must be mounted: the board schedules, the connections send. */
export const inject = ['faberloomBoard', 'faberloomConnections']

/** Deployment configuration of the mail adapter. */
export interface Config {
  /** Action type this row serves; the board's own set must accept it. */
  readonly actionType?: string
}

/** Validated configuration. */
export const Config: z<Config> = z.object({
  actionType: z.string().min(1).default('mail.send'),
})

/**
 * Read the approved revision of one dispatched item.
 * @param item - the board item the effect belongs to.
 * @returns the summary and evidence the human approved.
 */
export function approvedMailBody(item: FaberLoomBoardItem): { readonly subject: string; readonly text: string } {
  const revision = item.revisions.find(entry => entry.version === item.approvedRevision)
  if (revision === undefined) {
    throw new Error('faberloom: NO_APPROVED_REVISION — the item does not record the revision the effect was authorized for')
  }
  const evidence = revision.evidence.length === 0 ? '' : `\n\nEvidencia:\n${revision.evidence.map(ref => `- ${ref}`).join('\n')}`
  const document = revision.documentRef === null ? '' : `\nDocumento: ${revision.documentRef}`
  return {
    subject: item.title,
    text: `${revision.summary}${evidence}${document}`,
  }
}

/**
 * Build the adapter over one board and one connections service.
 * @param board - the board service, read for the approved revision.
 * @param connections - the owner's SMTP sender.
 * @param actionType - action type this adapter serves.
 * @returns the adapter the board registers.
 */
export function mailEffectAdapter(
  board: {
    get(actor: { id: string; companyId?: string | undefined }, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem>
  },
  connections: {
    sendMail(ownerId: string, mail: { to: string[]; subject: string; text: string }): Promise<{ messageId: string }>
  },
  actionType: string,
): BoardEffectAdapter {
  return {
    idempotent: false,
    async send(dispatch: BoardEffectDispatch): Promise<BoardEffectResult> {
      if (dispatch.actionType !== actionType) {
        throw new Error(`faberloom: EFFECT_ACTION_MISMATCH — ${dispatch.actionType} is not ${actionType}`)
      }
      const to = dispatch.destination.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
      if (to.length === 0) throw new Error('faberloom: EFFECT_DESTINATION_EMPTY — mail.send needs at least one recipient')
      const actor = dispatch.companyId === null
        ? { id: dispatch.ownerId }
        : { id: dispatch.ownerId, companyId: dispatch.companyId }
      const item = await board.get(actor, dispatch.itemId as FaberLoomBoardItemId)
      const body = approvedMailBody(item)
      const sent = await connections.sendMail(dispatch.ownerId, { to, subject: body.subject, text: body.text })
      return { status: 'CONFIRMADO', ref: sent.messageId, detail: `sent to ${to.join(', ')}` }
    },
  }
}

/**
 * Mount the mail adapter on the board's effect registry.
 * @param ctx - the plugin's Cordis context, with both services injected.
 * @param config - the action type this row serves.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const actionType = config.actionType ?? 'mail.send'
  // A deployment that did not accept the action type has execution off by
  // configuration (A-05); the row stays loaded but registers nothing, so an
  // empty `effectActionTypes` does not fail the process.
  if (!ctx.faberloomBoard.effectPolicy().actionTypes.includes(actionType)) {
    ctx.logger.warn(`faberloom: ${actionType} is not an accepted effect type; the mail adapter stays unregistered`)
    return
  }
  ctx.effect(
    () => ctx.faberloomBoard.registerEffectAdapter(
      actionType,
      mailEffectAdapter(ctx.faberloomBoard, ctx.faberloomConnections, actionType),
    ),
    `faberloom: effect adapter ${actionType}`,
  )
}
