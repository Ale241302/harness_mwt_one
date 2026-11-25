/**
 * The account a listed draft leaves from. A reply written over MCP mail carries
 * no account of its own, so the row must name the mailbox its originating
 * message came from instead of the generic "primary account".
 */
import { describe, expect, it } from 'vitest'
import type { FaberLoomMailboxGroup } from '@deepseek-ai/dsh-faberloom-view'
import { draftAccountOf } from '../src/client/drafts.ts'

/** One mailbox group as the host reports it. */
function group(account: string, source: 'imap' | 'mcp', address: string | null, primary = false): FaberLoomMailboxGroup {
  return {
    connectionId: account,
    account,
    source,
    server: source === 'mcp' ? 'hostinger-email' : null,
    address,
    primary,
    folders: [],
    capabilities: null,
    error: null,
  }
}

const MCP_ACCOUNT = 'mcp-mail:hostinger-email:AC1'
const MAILBOXES = [group(MCP_ACCOUNT, 'mcp', 'alvaro@muitowork.com'), group('conn-a', 'imap', 'a@x')]
const WITH_PRIMARY = [group('conn-p', 'imap', 'alvaro@muitowork.com', true), ...MAILBOXES]

describe('draftAccountOf', () => {
  it('keeps the account the draft already names', () => {
    expect(draftAccountOf({ account: 'otra@x', originUid: null }, MAILBOXES)).toBe('otra@x')
  })

  it('names the MCP mailbox the replied message came from', () => {
    expect(draftAccountOf({ account: null, originUid: `${MCP_ACCOUNT}:INBOX:42` }, MAILBOXES))
      .toBe(MCP_ACCOUNT)
  })

  it('places a folder with colons inside the originating id', () => {
    expect(draftAccountOf({ account: null, originUid: `${MCP_ACCOUNT}:INBOX:Odd/Path:42` }, MAILBOXES))
      .toBe(MCP_ACCOUNT)
  })

  it('leaves a draft with no origin under the primary account', () => {
    expect(draftAccountOf({ account: null, originUid: null }, MAILBOXES)).toBe('conn-a')
    expect(draftAccountOf({ account: null, originUid: null }, [])).toBeNull()
  })

  it('names the primary mailbox a draft with no account leaves from', () => {
    expect(draftAccountOf({ account: null, originUid: null }, WITH_PRIMARY)).toBe('conn-p')
  })

  it('does not claim a mailbox the host did not report', () => {
    expect(draftAccountOf({ account: null, originUid: 'mcp-mail:otro:AC9:INBOX:1' }, [group(MCP_ACCOUNT, 'mcp', 'a@x')]))
      .toBeNull()
    expect(draftAccountOf({ account: null, originUid: 'mcp-mail:otro:AC9:INBOX:1' }, WITH_PRIMARY)).toBe('conn-p')
  })

  it('never reads an IMAP connection id as the mailbox that owns the message', () => {
    const groups = [group(MCP_ACCOUNT, 'imap', 'a@x'), group('conn-b', 'imap', 'b@x', true)]
    expect(draftAccountOf({ account: null, originUid: `${MCP_ACCOUNT}:INBOX:42` }, groups)).toBe('conn-b')
  })
})
