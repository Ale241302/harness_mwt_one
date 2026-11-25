/**
 * Which account a stored draft leaves from, for the rows that list it.
 *
 * A reply written over MCP mail has no account of its own: the product stores
 * `account: null` so the send goes back through the mailbox the message came
 * from, and the originating message id (which carries that mailbox) survives in
 * `originUid`. The list used to label every such draft with the generic "primary
 * account", so the owner could not tell where it would leave from.
 *
 * @module @deepseek-ai/dsh-client-ui-faberloom/drafts
 */

import type { FaberLoomEmailDraftRow, FaberLoomMailboxGroup } from '@deepseek-ai/dsh-faberloom-view'

/**
 * The account a draft is sent from.
 * @param draft - the stored draft, with its own account and originating message.
 * @param mailboxes - the mailbox groups the host reports, each with its account id.
 * @returns the draft's account, the MCP mailbox its origin names, or null when
 *   neither identifies one (a draft written from scratch under the primary one).
 */
export function draftAccountOf(
  draft: Pick<FaberLoomEmailDraftRow, 'account' | 'originUid'>,
  mailboxes: readonly FaberLoomMailboxGroup[],
): string | null {
  if (draft.account !== null) return draft.account
  const origin = draft.originUid
  if (origin === null) return null
  // A message id is `<account>:<folder>:<uid>`, so the owning mailbox is the
  // group whose account id prefixes it. Matching against the reported groups
  // keeps the client from parsing an id format the Host owns.
  return mailboxes.find(group => group.source === 'mcp' && origin.startsWith(`${group.account}:`))?.account ?? null
}
