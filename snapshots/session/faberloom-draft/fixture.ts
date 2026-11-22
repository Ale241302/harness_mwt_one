import type { Context } from '@deepseek-ai/cordis'
import FaberLoomConnections from '../../../packages/faberloom/connections/src/index.ts'
import type { EmailDraftInput, FaberLoomEmailDraft } from '../../../packages/faberloom/connections/src/types.ts'
import { registerEmailDraftTools } from '../../../packages/faberloom/tool-faberloom/src/drafts.ts'

/** Real connections storage with only the otherwise-random draft id fixed for replay. */
class SnapshotConnections extends FaberLoomConnections {
  override async saveDraft(ownerId: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft> {
    return await super.saveDraft(ownerId, { ...input, id: input.id ?? 'snapshot-draft' })
  }
}

export const name = 'snapshot-faberloom-draft'
export const inject = ['storageDomain', 'tools']

/** Mount the real owner-scoped draft store and tools without any mailbox or network service. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(SnapshotConnections)
  registerEmailDraftTools(ctx, { ownerId: 'owner@example.test', role: 'admin', readOnly: false })
}
