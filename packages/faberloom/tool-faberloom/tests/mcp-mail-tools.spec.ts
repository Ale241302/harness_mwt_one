/**
 * A mail that exists only in an MCP mailbox is read and answered by its
 * synthetic id: the body and attachments come from the server's own tools, the
 * draft carries that id as its origin, and no IMAP reader is touched.
 */
import { describe, expect, it, vi } from 'vitest'
import type { EmailDraftInput } from '@deepseek-ai/dsh-faberloom-connections'
import { apply, type Config } from '../src/index.ts'
import {
  mcpMessageAttachments,
  mcpMessageData,
  mcpMessageEnvelope,
  mcpMessageText,
  parseMcpOrigin,
} from '../src/drafts.ts'

const OWNER = 'alvaro@muitowork.com'
const MCP_ID = 'mcp-mail:hostinger-email:AC1:INBOX:21831'
const CONFIG: Config = { ownerId: OWNER, role: 'admin', readOnly: false }

interface CapturedTool {
  readonly name: string
  readonly execute: (args: Record<string, unknown>, exec?: Record<string, unknown>) => Promise<unknown>
  readonly output: { render: (args: unknown, value: unknown) => readonly { text?: string }[] }
}

/** Boot the product tools over stub services and capture the definitions. */
function harness(services: Record<string, unknown>, config: Config = CONFIG): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
    on: () => () => {},
    logger: { warn: () => {}, info: () => {} },
  }
  apply(ctx as never, config)
  return registered
}

/** The envelope the Hostinger mail server answers `messages_get` with. */
const ENVELOPE = {
  status: 200,
  body: {
    data: {
      uid: 21831,
      date: '2026-11-24T23:59:59Z',
      flags: ['\\Seen'],
      unseen: false,
      size: 2048,
      subject: 'OC 505433',
      from: { name: 'Compras Eguisa', address: 'compras@eguisa.example' },
      to: [{ name: 'Álvaro', address: 'alvaro@muitowork.com' }],
      cc: [],
      bcc: [],
      replyTo: null,
      messageId: '<abc@hostinger>',
      inReplyTo: '<root@eguisa.example>',
      attachments: [
        { filename: 'OC 505433.pdf', contentType: 'application/pdf', size: 1024 },
        { name: 'pliego.pdf', mediaType: 'application/pdf', size: 512 },
      ],
    },
  },
}

/** The plain text `messages_text` answers with. */
const TEXT = {
  status: 200,
  body: {
    data: {
      text: 'Adjunto la orden https://storage.example.com/oc.pdf',
      html: '<p>Adjunto la orden</p>',
      truncated: false,
    },
  },
}

/** One connections double covering the draft guard and ledger reads. */
function connectionsDouble(options: { signature?: string } = {}) {
  const saved: EmailDraftInput[] = []
  const signature = options.signature ?? null
  const threads: {
    account: string | null
    threadKey: string
    messageKey: string
    status: string
    draftId?: string | null
    reason?: string | null
  }[] = []
  const state: {
    thread: {
      account: string | null
      threadKey: string
      messageKey: string
      status: 'drafted' | 'sent' | 'dismissed'
      draftId: string | null
      reason: string | null
      updatedAt: string
    } | null
    draftExists: boolean
  } = { thread: null, draftExists: false }
  const service = {
    list: vi.fn(async () => [
      { id: 'c1', kind: 'imap', label: 'Compras', username: '506@muitowork.com', primary: true },
    ]),
    signatureFor: vi.fn(async () => signature),
    signatureContent: vi.fn(async () => signature === null ? null : {
      text: signature,
      html: `<p>${signature.replace(/\n/gu, '<br>')}</p>`,
    }),
    mailThread: vi.fn(async () => state.thread),
    rememberMailThread: vi.fn(async (_owner: string, input: (typeof threads)[number]) => {
      threads.push(input)
      return {
        account: input.account,
        threadKey: input.threadKey,
        messageKey: input.messageKey,
        status: input.status,
        draftId: input.draftId ?? null,
        reason: input.reason ?? null,
        updatedAt: '2026-11-25T00:00:00Z',
      }
    }),
    getDraft: vi.fn(async () => state.draftExists
      ? {
        id: 'draft-existing', to: [], cc: [], bcc: [], subject: 'Re: OC', text: 'x', html: '',
        account: null, attachments: [], revision: 'rev', status: 'draft' as const, aiText: null,
        inReplyTo: null, references: [], spaceId: null, originUid: null, originMailbox: null,
        originReason: null, agentSessionId: null, createdAt: '2026-11-25T00:00:00Z',
        updatedAt: '2026-11-25T00:00:00Z', sentAt: null,
      }
      : null),
    saveDraft: vi.fn(async (_owner: string, input: EmailDraftInput) => {
      saved.push(input)
      return {
        id: 'draft-1',
        to: input.to,
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
        subject: input.subject,
        text: input.text,
        html: input.html ?? '',
        account: input.account ?? null,
        attachments: [],
        revision: 'rev-1',
        status: 'draft' as const,
        aiText: input.aiText ?? null,
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? [],
        spaceId: input.spaceId ?? null,
        originUid: input.originUid ?? null,
        originMailbox: input.originMailbox ?? null,
        originReason: input.originReason ?? null,
        agentSessionId: null,
        createdAt: '2026-11-25T00:00:00Z',
        updatedAt: '2026-11-25T00:00:00Z',
        sentAt: null,
      }
    }),
    recordDraftRevision: vi.fn(async () => ({ revision: 1 })),
  }
  return { service, saved, threads, state }
}

/** A registry double answering each mail tool with the payload it was given. */
function registryDouble(answers: {
  envelope?: unknown
  text?: unknown
} = {}) {
  const callTool = vi.fn(async (
    _owner: string,
    _server: string,
    tool: string,
  ) => tool === 'messages_get' ? answers.envelope ?? ENVELOPE : answers.text ?? TEXT)
  return { callTool }
}

describe('parseMcpOrigin', () => {
  it('reads server, mailbox, folder, and uid from the synthetic id', () => {
    expect(parseMcpOrigin(MCP_ID)).toEqual({
      id: MCP_ID, server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX', uid: 21831,
    })
    expect(parseMcpOrigin('mcp-mail:hostinger-email:AC%3A1:Sent%20Items:7')).toEqual({
      id: 'mcp-mail:hostinger-email:AC%3A1:Sent%20Items:7',
      server: 'hostinger-email', resourceId: 'AC:1', folder: 'Sent Items', uid: 7,
    })
  })

  it('refuses anything that is not a complete MCP message id', () => {
    for (const value of [
      'imap:7',
      'mcp-mail:hostinger-email:AC1:INBOX',
      'mcp-mail::AC1:INBOX:7',
      'mcp-mail:hostinger-email::INBOX:7',
      'mcp-mail:hostinger-email:AC1:INBOX:0',
      'mcp-mail:hostinger-email:AC1:INBOX:seven',
    ]) {
      expect(parseMcpOrigin(value)).toBeNull()
    }
  })
})

describe('MCP mail payload readers', () => {
  it('narrows the body data of one tool answer', () => {
    expect(mcpMessageData(ENVELOPE)).toMatchObject({ uid: 21831, messageId: '<abc@hostinger>' })
    for (const value of [null, 7, [], {}, { body: null }, { body: {} }, { body: { data: [] } }]) {
      expect(mcpMessageData(value)).toBeNull()
    }
  })

  it('reads the text and HTML body', () => {
    expect(mcpMessageText(TEXT)).toEqual({ text: 'Adjunto la orden https://storage.example.com/oc.pdf', html: '<p>Adjunto la orden</p>' })
    expect(mcpMessageText({ body: { data: { html: null } } })).toEqual({ text: '', html: null })
    expect(mcpMessageText(null)).toEqual({ text: '', html: null })
  })

  it('lists attachments as metadata and ignores unusable entries', () => {
    expect(mcpMessageAttachments(ENVELOPE)).toEqual([
      { name: 'OC 505433.pdf', mediaType: 'application/pdf' },
      { name: 'pliego.pdf', mediaType: 'application/pdf' },
    ])
    expect(mcpMessageAttachments({ body: { data: { attachments: [
      null,
      {},
      { filename: 'sin-tipo.bin' },
    ] } } })).toEqual([{ name: 'sin-tipo.bin', mediaType: 'application/octet-stream' }])
    expect(mcpMessageAttachments({ body: { data: {} } })).toEqual([])
    expect(mcpMessageAttachments(null)).toEqual([])
  })

  it('reads the envelope fields the draft uses', () => {
    expect(mcpMessageEnvelope(ENVELOPE)).toEqual({
      messageId: '<abc@hostinger>',
      inReplyTo: '<root@eguisa.example>',
      from: 'Compras Eguisa <compras@eguisa.example>',
      to: 'Álvaro <alvaro@muitowork.com>',
      cc: null,
      subject: 'OC 505433',
      date: '2026-11-24T23:59:59Z',
    })
    expect(mcpMessageEnvelope(null)).toBeNull()
    expect(mcpMessageEnvelope({ body: { data: {
      from: 'proveedor@eguisa.example',
      to: [{ address: 'alvaro@muitowork.com' }],
      cc: [{ name: 'Compras' }],
    } } })).toEqual({
      messageId: null,
      inReplyTo: null,
      from: 'proveedor@eguisa.example',
      to: 'alvaro@muitowork.com',
      cc: 'Compras',
      subject: null,
      date: null,
    })
    expect(mcpMessageEnvelope({ body: { data: { from: 7, to: 'alvaro@muitowork.com', cc: [{}, { name: 'Compras' }] } } })).toEqual({
      messageId: null,
      inReplyTo: null,
      from: null,
      to: null,
      cc: 'Compras',
      subject: null,
      date: null,
    })
  })
})

describe('faberloom_mail_read over MCP', () => {
  it('reads the body through the server and lists its attachments as metadata', async () => {
    const registry = registryDouble()
    const readEmail = vi.fn()
    const tools = harness({ faberloomMcpRegistry: registry, faberloomInbound: { readEmail } })

    const result = await tools.get('faberloom_mail_read')!.execute({ originId: MCP_ID, uid: 999, connectionId: 'ignored' }) as {
      text: string
      links: string[]
      attachments: { name: string; mediaType: string; markdown: string; note?: string }[]
    }

    expect(registry.callTool).toHaveBeenCalledWith(OWNER, 'hostinger-email', 'messages_text', {
      mailboxResourceId: 'AC1', folder: 'INBOX', uid: 21831,
    })
    expect(registry.callTool).toHaveBeenCalledWith(OWNER, 'hostinger-email', 'messages_get', {
      mailboxResourceId: 'AC1', folder: 'INBOX', uid: 21831,
    })
    expect(readEmail).not.toHaveBeenCalled()
    expect(result.text).toBe('Adjunto la orden https://storage.example.com/oc.pdf')
    expect(result.links).toEqual(['https://storage.example.com/oc.pdf'])
    expect(result.attachments).toEqual([
      { name: 'OC 505433.pdf', mediaType: 'application/pdf', markdown: '', note: 'MCP: el archivo se descarga desde el panel de Correo' },
      { name: 'pliego.pdf', mediaType: 'application/pdf', markdown: '', note: 'MCP: el archivo se descarga desde el panel de Correo' },
    ])
  })

  it('reads a text-only MCP body with no download links', async () => {
    const tools = harness({
      faberloomMcpRegistry: registryDouble({
        text: { body: { data: { text: 'Sin enlaces ni HTML' } } },
        envelope: { body: { data: {} } },
      }),
      faberloomInbound: { readEmail: vi.fn() },
    })

    const result = await tools.get('faberloom_mail_read')!.execute({ originId: MCP_ID }) as {
      text: string
      links: string[]
      attachments: unknown[]
    }

    expect(result).toEqual({ text: 'Sin enlaces ni HTML', links: [], attachments: [] })
  })

  it('reads an MCP body with no HTML and no links', async () => {
    const registry = registryDouble({ text: { body: { data: { text: 'solo texto', html: null } } } })
    const tools = harness({ faberloomMcpRegistry: registry, faberloomInbound: { readEmail: vi.fn() } })

    const result = await tools.get('faberloom_mail_read')!.execute({ originId: MCP_ID }) as {
      text: string
      links: string[]
      attachments: unknown[]
    }

    expect(result.text).toBe('solo texto')
    expect(result.links).toEqual([])
    expect(result.attachments).toHaveLength(2)
  })

  it('refuses an originId that names no MCP message and a call with neither uid nor originId', async () => {
    const tools = harness({ faberloomMcpRegistry: registryDouble(), faberloomInbound: { readEmail: vi.fn() } })
    const read = tools.get('faberloom_mail_read')!

    await expect(read.execute({ originId: 'imap:7' })).rejects.toThrow(/ORIGIN_ID_INVALID/u)
    await expect(read.execute({})).rejects.toThrow(/uid is required/u)
  })

  it('fails loud when the MCP registry is not mounted', async () => {
    const tools = harness({ faberloomInbound: { readEmail: vi.fn() } })

    await expect(tools.get('faberloom_mail_read')!.execute({ originId: MCP_ID }))
      .rejects.toThrow(/MCP registry service is not mounted/u)
  })
})

describe('faberloom_email_draft over MCP', () => {
  it('answers the MCP message with a null account, its Message-ID, and its origin', async () => {
    const connections = connectionsDouble({ signature: 'Álvaro\nMuito Work' })
    const registry = registryDouble()
    const tools = harness({ faberloomConnections: connections.service, faberloomMcpRegistry: registry })

    const result = await tools.get('faberloom_email_draft')!.execute({
      originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola, adjunto la factura.',
    }) as {
      account: string | null
      originUid: string | null
      originMailbox: string | null
      originReason: string | null
      text: string
    }

    expect(registry.callTool).toHaveBeenCalledWith(OWNER, 'hostinger-email', 'messages_get', {
      mailboxResourceId: 'AC1', folder: 'INBOX', uid: 21831,
    })
    expect(connections.saved[0]).toMatchObject({
      account: null,
      inReplyTo: '<abc@hostinger>',
      references: ['<abc@hostinger>'],
      originUid: MCP_ID,
      originMailbox: 'INBOX',
      originReason: 'agent-reply',
      text: 'Hola, adjunto la factura.\n\nÁlvaro\nMuito Work',
    })
    expect(connections.saved[0]?.html).toContain('data-email-signature="auto"')
    expect(connections.service.signatureFor).toHaveBeenCalledWith(OWNER, null)
    expect(connections.service.signatureContent).toHaveBeenCalledWith(OWNER, null)
    expect(connections.threads).toEqual([{
      account: null,
      threadKey: '<abc@hostinger>',
      messageKey: '<abc@hostinger>',
      status: 'drafted',
      draftId: 'draft-1',
    }])
    expect(result).toMatchObject({
      account: null,
      originUid: MCP_ID,
      originMailbox: 'INBOX',
      originReason: 'agent-reply',
    })
  })

  it('keeps an explicit inReplyTo over the envelope Message-ID', async () => {
    const connections = connectionsDouble()
    const tools = harness({ faberloomConnections: connections.service, faberloomMcpRegistry: registryDouble() })

    await tools.get('faberloom_email_draft')!.execute({
      originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola',
      inReplyTo: '<explicit@muitowork.com>', account: 'otra@muitowork.com',
    })

    expect(connections.saved[0]).toMatchObject({
      account: null,
      inReplyTo: '<explicit@muitowork.com>',
      references: ['<explicit@muitowork.com>'],
    })
    expect(connections.threads[0]?.threadKey).toBe('<explicit@muitowork.com>')
  })

  it('applies the thread guards with the MCP account', async () => {
    const connections = connectionsDouble()
    const tools = harness({ faberloomConnections: connections.service, faberloomMcpRegistry: registryDouble() })
    const create = tools.get('faberloom_email_draft')!
    const args = { originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola' }
    const thread = {
      account: null,
      threadKey: '<abc@hostinger>',
      messageKey: '<abc@hostinger>',
      status: 'sent' as const,
      draftId: null,
      reason: null,
      updatedAt: '2026-11-25T00:00:00Z',
    }

    connections.state.thread = thread
    await expect(create.execute(args)).rejects.toThrow('MAIL_ALREADY_ANSWERED')

    connections.state.thread = { ...thread, status: 'dismissed' }
    await expect(create.execute(args)).rejects.toThrow('MAIL_THREAD_DISMISSED')

    connections.state.thread = { ...thread, status: 'drafted', draftId: 'draft-existing' }
    connections.state.draftExists = true
    await expect(create.execute(args)).rejects.toThrow('MAIL_DRAFT_EXISTS')
    expect(connections.saved).toEqual([])
  })

  it('refuses to copy IMAP attachments from an MCP message', async () => {
    const connections = connectionsDouble()
    const registry = registryDouble()
    const tools = harness({ faberloomConnections: connections.service, faberloomMcpRegistry: registry })

    await expect(tools.get('faberloom_email_draft')!.execute({
      originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola', attachFromUid: 42,
    })).rejects.toThrow(/attachFromUrl|panel de Correo/u)
    expect(registry.callTool).not.toHaveBeenCalled()
    expect(connections.saved).toEqual([])
  })

  it('refuses an originId that names no MCP message', async () => {
    const tools = harness({ faberloomConnections: connectionsDouble().service, faberloomMcpRegistry: registryDouble() })

    await expect(tools.get('faberloom_email_draft')!.execute({
      originId: 'mcp-mail:hostinger-email:AC1:INBOX', to: 'x@example.com', subject: 'Re: x', text: 'Hola',
    })).rejects.toThrow(/ORIGIN_ID_INVALID/u)
  })

  it('fails loud when the server returns no message envelope', async () => {
    const tools = harness({
      faberloomConnections: connectionsDouble().service,
      faberloomMcpRegistry: registryDouble({ envelope: { body: { data: [] } } }),
    })

    await expect(tools.get('faberloom_email_draft')!.execute({
      originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola',
    })).rejects.toThrow(/MCP_MESSAGE_UNREADABLE/u)
  })

  it('writes an MCP draft without a thread when the message carries no Message-ID', async () => {
    const connections = connectionsDouble()
    const tools = harness({
      faberloomConnections: connections.service,
      faberloomMcpRegistry: registryDouble({ envelope: { body: { data: { messageId: null, inReplyTo: null } } } }),
    })

    await tools.get('faberloom_email_draft')!.execute({
      originId: MCP_ID, to: 'compras@eguisa.example', subject: 'Re: OC 505433', text: 'Hola',
    })

    expect(connections.saved[0]).toMatchObject({ account: null, originUid: MCP_ID, originReason: 'agent-reply' })
    expect(connections.saved[0]?.inReplyTo).toBeUndefined()
    expect(connections.threads).toEqual([])
  })

  it('leaves the IMAP path untouched when no originId arrives', async () => {
    const connections = connectionsDouble()
    const registry = registryDouble()
    const listInbox = vi.fn(async () => [
      { uid: 7, messageId: '<imap@x>', from: 'proveedor@eguisa.example', to: '506@muitowork.com', cc: null, subject: 'OC', date: null, references: null, seen: false },
    ])
    const tools = harness({
      faberloomConnections: connections.service,
      faberloomMcpRegistry: registry,
      faberloomInbound: { listInbox },
    })

    await tools.get('faberloom_email_draft')!.execute({
      uid: 7, connectionId: 'c1', to: 'proveedor@eguisa.example', subject: 'Re: OC', text: 'Hola',
    })

    expect(listInbox).toHaveBeenCalledWith(OWNER, 200, 'c1')
    expect(registry.callTool).not.toHaveBeenCalled()
    expect(connections.saved[0]).toMatchObject({
      account: '506@muitowork.com',
      inReplyTo: '<imap@x>',
      originUid: 'c1:7',
      originReason: 'agent-reply',
    })
  })
})
