/**
 * Read-only MCP mail in the Correo surface: the registry's parsed payloads map
 * onto mailbox groups, envelopes, and bodies, and the synthetic ids never
 * collide with an IMAP account or uid.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FaberLoomMcpRegistry, FaberLoomMcpServer } from '@deepseek-ai/dsh-faberloom-mcp-registry'
import { FaberLoomViewService } from '../src/index.ts'
import {
  mcpAccountId,
  mcpMessageId,
  parseMcpAccount,
  parseMcpMessageId,
  mcpMessageRow,
} from '../src/mcp-mail.ts'

/** One saved mounted server, as the registry lists it. */
function serverRow(name: string): FaberLoomMcpServer {
  return {
    name,
    transport: { transport: 'streamable-http', url: 'https://mcp.example/mcp' },
    env: [],
    headers: [],
    enabled: true,
    mounted: true,
    error: null,
    createdAt: '2026-11-22T00:00:00Z',
    updatedAt: '2026-11-22T00:00:00Z',
  }
}

/** The `body` the Hostinger endpoint wraps every tool answer in. */
function envelope(data: unknown) {
  return { status: 200, headers: {}, body: { data } }
}

/** The three listings one account read needs, keyed by the raw tool name. */
function mailboxAnswers(options: {
  mailboxes?: readonly { resourceId: string; address: string }[]
  folders?: readonly unknown[]
  messages?: readonly unknown[]
  pagination?: { page: number; perPage: number; total: number; totalPages: number }
  text?: { text: string; html?: string | null }
} = {}) {
  const mailboxes = options.mailboxes ?? [{ resourceId: 'AC1', address: 'alvaro@muitowork.com' }]
  const folders = options.folders ?? [
    { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox' },
    { path: 'INBOX.Sent', name: 'Sent', specialUse: '\\Sent' },
  ]
  const messages = options.messages ?? [{
    uid: 42,
    path: 'INBOX',
    date: '2026-11-22T19:05:29Z',
    flags: [],
    unseen: true,
    subject: 'Factura',
    from: { name: 'Compras', address: 'compras@example.com' },
    to: [{ name: '', address: 'alvaro@muitowork.com' }],
    cc: [],
    messageId: '<42@example.com>',
  }]
  return {
    account_current: envelope({ mailboxes }),
    folders_list: envelope(folders),
    messages_list: envelope(messages),
    messages_text: envelope({ text: options.text?.text ?? 'cuerpo', html: options.text?.html ?? null }),
  }
}

/** A registry whose answers are the payloads the real one parses. */
function fakeRegistry(
  answers: Record<string, unknown>,
  servers: readonly FaberLoomMcpServer[] = [serverRow('hostinger-email')],
): FaberLoomMcpRegistry & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    list: vi.fn(async () => servers),
    save: vi.fn(),
    remove: vi.fn(),
    probe: vi.fn(),
    callTool: vi.fn(async (_owner: string, _server: string, tool: string) => {
      calls.push(tool)
      if (answers[tool] === undefined) throw new Error(`unexpected tool ${tool}`)
      return answers[tool]
    }),
  }
}

/** The minimal service graph the Correo remotes touch. */
function harness(inbound: unknown, connections: unknown, mcp?: unknown): FaberLoomViewService {
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => {
      if (name === 'faberloomInbound') return inbound
      if (name === 'faberloomConnections') return connections
      if (name === 'faberloomMcpRegistry') return mcp
      return undefined
    },
    faberloomInbound: inbound,
    faberloomConnections: connections,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'alvaro@muitowork.com', role: 'admin', readOnly: false })
}

describe('MCP mail ids', () => {
  it('round-trips a mailbox account id', () => {
    const account = mcpAccountId('hostinger-email', 'ACe8fee3dd')
    expect(account).toBe('mcp-mail:hostinger-email:ACe8fee3dd')
    expect(parseMcpAccount(account)).toEqual({ server: 'hostinger-email', resourceId: 'ACe8fee3dd' })
  })

  it('round-trips a message id without losing a folder with colons', () => {
    const id = mcpMessageId({ server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX:Odd/Path', uid: 2769 })
    expect(parseMcpMessageId(id)).toEqual({
      server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX:Odd/Path', uid: 2769,
    })
  })

  it('never reads an IMAP id as MCP', () => {
    expect(parseMcpAccount('a6954537-caa1-4d3e-ab92-8ad2d282739d')).toBeNull()
    expect(parseMcpMessageId('a6954537-caa1-4d3e-ab92-8ad2d282739d:42')).toBeNull()
    expect(parseMcpMessageId('42')).toBeNull()
    expect(parseMcpAccount('mcp-mail:hostinger-email:')).toBeNull()
  })
})

describe('MCP mail mapping', () => {
  it('maps one listed message onto the inbox row with its own route', () => {
    const row = mcpMessageRow({
      uid: 42,
      path: 'INBOX',
      date: '2026-11-22T19:05:29Z',
      unseen: true,
      subject: 'Factura',
      from: { name: 'Compras', address: 'compras@example.com' },
      to: [{ name: '', address: 'alvaro@muitowork.com' }],
      cc: [{ name: 'Copia', address: 'copia@example.com' }],
      messageId: '<42@example.com>',
    }, {
      server: 'hostinger-email',
      resourceId: 'AC1',
      folder: 'INBOX',
      address: 'alvaro@muitowork.com',
    })
    expect(row).toMatchObject({
      connectionId: 'mcp-mail:hostinger-email:AC1',
      account: 'mcp-mail:hostinger-email:AC1',
      source: 'mcp',
      server: 'hostinger-email',
      address: 'alvaro@muitowork.com',
      from: 'Compras <compras@example.com>',
      to: 'alvaro@muitowork.com',
      cc: 'Copia <copia@example.com>',
      seen: false,
      subject: 'Factura',
    })
    expect(row?.id.startsWith('mcp-mail:hostinger-email:AC1:')).toBe(true)
  })

  it('keeps a message without a usable uid out of the list', () => {
    expect(mcpMessageRow({ subject: 'x' }, {
      server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX', address: 'a@x',
    })).toBeNull()
  })
})

describe('FaberLoomViewService MCP mail', () => {
  it('merges MCP envelopes beside the IMAP ones with distinct ids', async () => {
    const inbound = {
      listPage: vi.fn(async () => ({
        messages: [{
          uid: 42, messageId: '<imap@x>', from: 'imap@x', to: null, cc: null, references: null,
          subject: 'IMAP', date: '2026-11-22T18:00:00Z', seen: true,
        }],
        total: 1,
        page: 1,
        pageSize: 50,
        hasNext: false,
      })),
    }
    const connections = {
      list: vi.fn(async () => [{ id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' }]),
    }
    const registry = fakeRegistry(mailboxAnswers())
    const view = harness(inbound, connections, registry)

    const page = await view.emailInbox()

    const imap = page.rows.find(row => row.connectionId === 'conn-a')
    const mcp = page.rows.find(row => row.source === 'mcp')
    expect(imap?.id).toBe('conn-a:42')
    expect(mcp?.id).toBe('mcp-mail:hostinger-email:AC1:INBOX:42')
    expect(mcp?.id).not.toBe(imap?.id)
    expect(page.rows[0]?.source).toBe('mcp')
    expect(page.total).toBe(2)
    expect(registry.calls).toEqual(['account_current', 'folders_list', 'messages_list'])
  })

  it('lists each MCP mailbox as its own account with folders', async () => {
    const registry = fakeRegistry(mailboxAnswers())
    const view = harness(undefined, undefined, registry)

    const groups = await view.emailFolders()

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      connectionId: 'mcp-mail:hostinger-email:AC1',
      account: 'mcp-mail:hostinger-email:AC1',
      source: 'mcp',
      server: 'hostinger-email',
      address: 'alvaro@muitowork.com',
      error: null,
    })
    expect(groups[0]?.folders).toEqual([
      { name: 'INBOX', specialUse: 'inbox' },
      { name: 'INBOX.Sent', specialUse: 'sent' },
    ])
  })

  it('reads a message body through messages_text', async () => {
    const registry = fakeRegistry(mailboxAnswers({ text: { text: 'Hola', html: '<p>Hola</p>' } }))
    const view = harness(undefined, undefined, registry)
    const id = mcpMessageId({ server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX', uid: 42 })

    const content = await view.emailRead(id)

    expect(content).toEqual({ account: null, text: 'Hola', html: '<p>Hola</p>', attachments: [] })
    expect(registry.calls).toEqual(['messages_text'])
  })

  it('reports the MCP server that fails instead of an empty mailbox', async () => {
    const registry: FaberLoomMcpRegistry = {
      ...fakeRegistry({}, [serverRow('hostinger-email')]),
      callTool: vi.fn(async () => { throw new Error('invalid bearer') }),
    }
    const view = harness(undefined, undefined, registry)

    const page = await view.emailInbox()
    const groups = await view.emailFolders()

    expect(page.failures).toEqual([{
      account: 'mcp-mail:hostinger-email:',
      connectionId: 'mcp-mail:hostinger-email:',
      source: 'mcp',
      server: 'hostinger-email',
      address: null,
      message: 'invalid bearer',
    }])
    expect(groups[0]).toMatchObject({ source: 'mcp', error: 'invalid bearer', folders: [] })
  })

  it('keeps MCP out of the page when an IMAP account is selected', async () => {
    const inbound = { listPage: vi.fn(async () => ({ messages: [], total: 0, page: 1, pageSize: 50, hasNext: false })) }
    const connections = { list: vi.fn(async () => [{ id: 'conn-a', kind: 'imap', label: 'A', username: 'a@x' }]) }
    const registry = fakeRegistry(mailboxAnswers())
    const view = harness(inbound, connections, registry)

    await view.emailInbox(50, 1, 'conn-a')

    expect(registry.calls).toEqual([])
  })

  it('refuses a mutating mailbox action on an MCP row', async () => {
    const registry = fakeRegistry(mailboxAnswers())
    const view = harness({ markSeenFromOwner: vi.fn() }, undefined, registry)
    const id = mcpMessageId({ server: 'hostinger-email', resourceId: 'AC1', folder: 'INBOX', uid: 42 })

    await expect(view.emailMarkSeen(id, true)).rejects.toThrow('MCP mail is read-only')
    await expect(view.emailTrash(id)).rejects.toThrow('MCP mail is read-only')
    expect(registry.calls).toEqual([])
  })
})
