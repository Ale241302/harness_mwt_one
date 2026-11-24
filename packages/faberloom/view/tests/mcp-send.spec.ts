/**
 * A draft composed from an MCP mailbox leaves through that server's own send
 * tool on the owner's approval; a mailbox without it refuses and keeps the draft.
 * The model's path to the same tool stays denied (mcp-registry policy specs).
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { FaberLoomEmailDraft } from '@deepseek-ai/dsh-faberloom-connections'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'
const MCP_ID = 'mcp-mail:hostinger-email:AC1:INBOX:42'

/** One stored draft whose origin is the synthetic MCP message id. */
function draftFor(originUid: string | null): FaberLoomEmailDraft {
  return {
    id: 'draft-1',
    to: ['cliente@example.com'],
    cc: ['copia@example.com'],
    bcc: [],
    subject: 'Re: Factura MCP',
    text: 'Adjunto la factura.',
    html: '<p>Adjunto la <b>factura</b>.</p>',
    account: null,
    attachments: [],
    revision: 'rev-1',
    status: 'draft',
    aiText: null,
    inReplyTo: '<42@x>',
    references: ['<42@x>'],
    spaceId: null,
    originUid,
    originMailbox: 'INBOX',
    originReason: 'reply',
    agentSessionId: null,
    createdAt: '2026-11-24T00:00:00Z',
    updatedAt: '2026-11-24T00:00:00Z',
    sentAt: null,
  }
}

/**
 * The service graph `sendEmailDraft` reads: the connections seam, the MCP
 * registry, and an owner who may write drafts.
 * @param options - draft origin and the tools the server advertises.
 * @returns the view plus the spies each case asserts on.
 */
function harness(options: { originUid?: string | null; tools?: readonly string[]; reply?: unknown } = {}) {
  const draft = draftFor(options.originUid === undefined ? MCP_ID : options.originUid)
  const callOwnerAction = vi.fn(async () => options.reply ?? { status: 200, body: { data: { messageId: '<sent@hostinger>' } } })
  const registry = {
    toolsFor: vi.fn(async () => options.tools ?? ['send_email', 'messages_text']),
    callOwnerAction,
  }
  const sendDraft = vi.fn(async (
    _owner: string,
    _id: string,
    _updatedAt: string,
    _revision: string,
    delivery?: { deliver: (mail: unknown) => Promise<unknown> },
  ) => {
    const mail = {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      text: draft.text,
      html: draft.html,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
    }
    if (delivery !== undefined) await delivery.deliver(mail)
    return { ...draft, status: 'sent' as const, sentAt: '2026-11-24T00:01:00Z' }
  })
  const ctx = {
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomConnections') return { getDraft: vi.fn(async () => draft), sendDraft }
      if (name === 'faberloomMcpRegistry') return registry
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false })
  return { view, sendDraft, callOwnerAction }
}

describe('sendEmailDraft over MCP', () => {
  it('sends the approved draft through the mailbox that received the message', async () => {
    const { view, sendDraft, callOwnerAction } = harness()

    const sent = await view.sendEmailDraft('draft-1', '2026-11-24T00:00:00Z', 'rev-1')

    expect(sendDraft).toHaveBeenCalledWith(OWNER, 'draft-1', '2026-11-24T00:00:00Z', 'rev-1', expect.anything())
    expect(callOwnerAction).toHaveBeenCalledWith(OWNER, 'hostinger-email', 'send_email', {
      mailboxResourceId: 'AC1',
      to: ['cliente@example.com'],
      cc: ['copia@example.com'],
      subject: 'Re: Factura MCP',
      text: 'Adjunto la factura.',
      html: '<p>Adjunto la <b>factura</b>.</p>',
    }, expect.any(Number))
    expect(sent.status).toBe('sent')
  })

  it('refuses a mailbox whose server advertises no send tool and keeps the draft', async () => {
    const { view, sendDraft, callOwnerAction } = harness({ tools: ['messages_text'] })

    await expect(view.sendEmailDraft('draft-1', '2026-11-24T00:00:00Z', 'rev-1'))
      .rejects.toThrow(/no ofrece envío por MCP/u)
    expect(sendDraft).not.toHaveBeenCalled()
    expect(callOwnerAction).not.toHaveBeenCalled()
  })

  it('reports the status when the mailbox rejects the message', async () => {
    const { view } = harness({ reply: { status: 422, body: { error: 'blocked' } } })

    await expect(view.sendEmailDraft('draft-1', '2026-11-24T00:00:00Z', 'rev-1'))
      .rejects.toThrow(/rechazó el envío \(422\)/u)
  })

  it('keeps the SMTP path for a draft with no MCP origin', async () => {
    const { view, sendDraft, callOwnerAction } = harness({ originUid: null })

    await view.sendEmailDraft('draft-1', '2026-11-24T00:00:00Z', 'rev-1')

    expect(sendDraft).toHaveBeenCalledWith(OWNER, 'draft-1', '2026-11-24T00:00:00Z', 'rev-1', undefined)
    expect(callOwnerAction).not.toHaveBeenCalled()
  })
})
