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
 * @returns the draft's account, the MCP mailbox its origin names, the product's
 *   primary mailbox when the draft names none, or null when the host reported no
 *   primary either.
 */
export function draftAccountOf(
  draft: Pick<FaberLoomEmailDraftRow, 'account' | 'originUid'>,
  mailboxes: readonly FaberLoomMailboxGroup[],
): string | null {
  if (draft.account !== null) return draft.account
  const origin = draft.originUid
  if (origin !== null) {
    // A message id is `<account>:<folder>:<uid>`, so the owning mailbox is the
    // group whose account id prefixes it. Matching against the reported groups
    // keeps the client from parsing an id format the Host owns.
    const owner = mailboxes.find(group => group.source === 'mcp' && origin.startsWith(`${group.account}:`))
    if (owner !== undefined) return owner.account
  }
  // A draft with no account of its own is sent by the primary mailbox; the
  // product resolves a missing account the same way: the row marked primary,
  // else the first mail connection.
  const primary = mailboxes.find(group => group.primary === true && group.account !== null)
    ?? mailboxes.find(group => group.source !== 'mcp' && group.account !== null)
  return primary?.account ?? null
}
