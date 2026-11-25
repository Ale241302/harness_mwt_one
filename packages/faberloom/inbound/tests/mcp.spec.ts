/**
 * The MCP mail watcher: one mailbox that only exists on a mounted MCP server
 * must turn into routine events exactly like an IMAP one.
 *
 * The fake registry is the MCP server's own JSON envelope, so the watcher is
 * tested against the payloads Hostinger answers instead of an invented one.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../../connections/src/index.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput } from '../../routines/src/index.ts'
import type { FaberLoomMcpRegistry } from '../../mcp-registry/src/index.ts'
import FaberLoomInbound, { MIN_INTERVAL_MS, type CursorRecord } from '../src/index.ts'
import {
  isMailServer,
  mcpCursorKey,
  mcpEventKey,
  mcpInboxFolder,
  mcpMailboxes,
  mcpMailboxTargets,
  mcpMailConnectionId,
  mcpMailEntryOf,
  mcpMessagePage,
  mcpNewestEntries,
  mcpOriginId,
  type McpMailboxTarget,
} from '../src/mcp.ts'

const OWNER = 'compras2@sondelsa.com'

/** One message the fake server lists. */
interface FakeEntry {
  readonly uid: number
  readonly messageId?: string
  readonly subject?: string
  readonly seen?: boolean
}

/** One fake mail server: the tools it publishes and the mail it answers. */
interface FakeServer {
  readonly name: string
  readonly messages: FakeEntry[]
  readonly enabled?: boolean
  readonly tools?: readonly string[]
  readonly mailboxes?: readonly { readonly resourceId: string; readonly address: string }[]
  readonly folders?: readonly { readonly path: string; readonly specialUse?: string }[]
  /** Tool that throws instead of answering, when set. */
  readonly failTool?: string
  /** Value that failing tool throws. */
  readonly failValue?: unknown
  /** Omit `pagination` from `messages_list`, like a flatter server would. */
  readonly noPagination?: boolean
  /** Tool calls the watcher made, in order. */
  readonly calls: { readonly tool: string; readonly args: Readonly<Record<string, unknown>> | undefined }[]
}

/** Build one fake server with its default mailbox and inbox folder. */
function fakeServer(server: Omit<FakeServer, 'calls'>): FakeServer {
  return {
    ...server,
    mailboxes: server.mailboxes ?? [{ resourceId: 'AC1', address: 'alvaro@muitowork.com' }],
    folders: server.folders ?? [{ path: 'INBOX', specialUse: '\\inbox' }],
    calls: [],
  }
}

/** One message row as `messages_list` reports it. */
function rowOf(entry: FakeEntry, path = 'INBOX'): Record<string, unknown> {
  return {
    uid: entry.uid,
    path,
    date: '2026-11-24T23:59:59Z',
    flags: entry.seen === true ? ['\\Seen'] : [],
    unseen: entry.seen !== true,
    subject: entry.subject ?? 'Asunto',
    from: { name: 'Nombre', address: 'correo@dominio' },
    to: [{ address: 'alvaro@muitowork.com' }],
    cc: [],
    messageId: entry.messageId ?? null,
    inReplyTo: null,
    attachments: [],
  }
}

/** The registry a mounted set of fake servers presents. */
function registryOf(servers: readonly FakeServer[]): FaberLoomMcpRegistry {
  const find = (name: string): FakeServer => {
    const server = servers.find(candidate => candidate.name === name)
    if (server === undefined) throw new Error(`unknown server ${name}`)
    return server
  }
  return {
    list: async () => servers.map(server => ({
      name: server.name,
      transport: { transport: 'streamable-http' as const, url: 'http://127.0.0.1/mcp' },
      env: [],
      headers: [],
      enabled: server.enabled !== false,
      mounted: true,
      error: null,
      createdAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
    })),
    toolsFor: async (_owner: string, name: string) => find(name).tools
      ?? ['account_current', 'folders_list', 'messages_list', 'messages_text'],
    callTool: async (_owner: string, name: string, tool: string, args?: Readonly<Record<string, unknown>>) => {
      const server = find(name)
      server.calls.push({ tool, args })
      if (server.failTool === tool) throw server.failValue ?? new Error('boom')
      if (tool === 'account_current') return { status: 200, body: { data: { mailboxes: server.mailboxes } } }
      if (tool === 'folders_list') return { status: 200, body: { data: server.folders } }
      if (tool === 'messages_list') {
        const page = Number(args?.['page'] ?? 1)
        const perPage = Number(args?.['perPage'] ?? 25)
        const sorted = [...server.messages].sort((left, right) => right.uid - left.uid)
        const total = sorted.length
        const start = (page - 1) * perPage
        const data = sorted.slice(start, start + perPage).map(entry => rowOf(entry))
        return server.noPagination === true
          ? { status: 200, body: { data } }
          : { status: 200, body: { data, pagination: { total, totalPages: Math.max(1, Math.ceil(total / perPage)) } } }
      }
      throw new Error(`unexpected tool ${tool}`)
    },
  } as unknown as FaberLoomMcpRegistry
}

/** Boot the receiver with a registry over one owner pool. */
async function harness(servers: readonly FakeServer[], pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('step', () => 'ok')
  ctx.faberloomRoutines.registerHandler('agent', () => 'ok')
  const registry = registryOf(servers)
  ctx.provide('faberloomMcpRegistry', registry)
  await ctx.plugin(FaberLoomInbound, { ownerId: OWNER, enabled: false, intervalMs: MIN_INTERVAL_MS })
  return { ctx, routines: ctx.faberloomRoutines, inbound: ctx.faberloomInbound, registry, pool }
}

/** One routine every email starts. */
const ROUTINE: RoutineDefinitionInput = {
  intent: 'atender el correo entrante',
  triggers: [{ kind: 'email' }],
  steps: [{ id: 's1', instruction: 'atiende el correo', handler: 'step' }],
  expectedResult: 'correo atendido',
  permissions: ['mwt'],
  failurePolicy: 'stop',
}

/** Store one cursor row before the receiver opens its domain. */
function seedCursors(pool: MemoryMediaPool, rows: readonly [string, CursorRecord][]): void {
  pool.media.set('faberloom_inbound', {
    tables: new Map([['cursors', new Map(rows.map(([key, row]) => [key, row]))]]),
    global: null,
  })
  pool.versions.set('faberloom_inbound', 1)
}

/** One stored cursor as the medium holds it. */
function cursorOf(pool: MemoryMediaPool, key: string): CursorRecord | undefined {
  return pool.media.get('faberloom_inbound')?.tables.get('cursors')?.get(key) as CursorRecord | undefined
}

/** Create and activate one email routine for the tests that need a case. */
async function emailRoutine(routines: Awaited<ReturnType<typeof harness>>['routines']) {
  const routine = await routines.createRoutine(OWNER, { name: 'Bandeja MCP', definition: ROUTINE })
  await routines.activateRoutine(OWNER, routine.id)
  return routine
}

describe('MCP mail helpers', () => {
  it('recognizes a mail server only when every tool the watcher reads is published', () => {
    expect(isMailServer(['account_current', 'folders_list', 'messages_list', 'messages_text'])).toBe(true)
    expect(isMailServer(['account_current', 'folders_list', 'messages_list', 'messages_text', 'send_email'])).toBe(true)
    expect(isMailServer(['account_current', 'folders_list', 'messages_list'])).toBe(false)
  })

  it('builds the synthetic ids in the exact format the Correo panel parses', () => {
    expect(mcpMailConnectionId('hostinger-email', 'AC1')).toBe('mcp-mail:hostinger-email:AC1')
    expect(mcpMailConnectionId('hostinger-email', 'AC 1/x')).toBe('mcp-mail:hostinger-email:AC%201%2Fx')
    const target: McpMailboxTarget = { server: 'hostinger-email', resourceId: 'AC1', address: 'a@b', folder: 'INBOX.Sent' }
    expect(mcpOriginId(target, 12)).toBe('mcp-mail:hostinger-email:AC1:INBOX.Sent:12')
    expect(mcpCursorKey(target)).toBe('mcp:hostinger-email:AC1:INBOX.Sent')
  })

  it('keys a message by its Message-ID when it has one and by its copy otherwise', () => {
    const target: McpMailboxTarget = { server: 'hostinger-email', resourceId: 'AC1', address: 'a@b', folder: 'INBOX' }
    expect(mcpEventKey(target, { uid: 9, messageId: '<x@y>', from: null, to: null, cc: null, subject: null, date: null }))
      .toBe('mail:msg:<x@y>')
    expect(mcpEventKey(target, { uid: 9, messageId: null, from: null, to: null, cc: null, subject: null, date: null }))
      .toBe('mcp:hostinger-email:AC1:INBOX:9')
  })

  it('narrows the mailbox list, the inbox folder, and one message envelope', () => {
    expect(mcpMailboxes({
      body: { data: { mailboxes: [{ resourceId: 'AC1', address: 'a@b' }, { address: 'sin-id@b' }, 'basura', { resourceId: 'AC2' }] } },
    })).toEqual([{ resourceId: 'AC1', address: 'a@b' }, { resourceId: 'AC2', address: '' }])
    // A flatter server answers the payload directly.
    expect(mcpMailboxes({ data: { mailboxes: [{ resourceId: 'AC1', address: 'a@b' }] } }))
      .toEqual([{ resourceId: 'AC1', address: 'a@b' }])
    expect(mcpMailboxes({ body: { data: { mailboxes: 'nada' } } })).toEqual([])
    expect(mcpMailboxes({ body: { data: 'nada' } })).toEqual([])
    expect(mcpMailboxes(null)).toEqual([])

    expect(mcpInboxFolder({ body: { data: [{ path: 'Archivo' }, { path: 'INBOX', specialUse: '\\Inbox' }] } })).toBe('INBOX')
    expect(mcpInboxFolder({ body: { data: [{ path: 'Archivo' }] } })).toBe('Archivo')
    expect(mcpInboxFolder({ body: { data: [{ specialUse: '\\inbox' }] } })).toBeNull()
    expect(mcpInboxFolder({ body: { data: [] } })).toBeNull()
    // A payload whose `data` is not an array, or carries a non-object entry.
    expect(mcpInboxFolder({ body: { data: 'nada' } })).toBeNull()
    expect(mcpInboxFolder({ body: { data: [null, 'texto'] } })).toBeNull()

    expect(mcpMailEntryOf({
      uid: '7',
      messageId: '<m@x>',
      from: '"Nombre" <correo@dominio>',
      to: [{ address: 'a@b' }, { name: 'Solo nombre' }, null, 'texto@b'],
      cc: [{ name: '', address: '' }],
      subject: 'Asunto',
      date: '2026-11-24T23:59:59Z',
    })).toEqual({
      uid: 7,
      messageId: '<m@x>',
      from: '"Nombre" <correo@dominio>',
      to: 'a@b, Solo nombre, texto@b',
      cc: null,
      subject: 'Asunto',
      date: '2026-11-24T23:59:59Z',
    })
    expect(mcpMailEntryOf({ uid: 8, from: { name: 'Nombre', address: 'a@b' }, to: 'no-es-lista' })).toMatchObject({
      uid: 8,
      from: 'Nombre <a@b>',
      to: null,
      messageId: null,
      subject: null,
      date: null,
    })
    expect(mcpMailEntryOf({ uid: 9, from: { name: 'Nombre' }, to: [] })).toMatchObject({ from: 'Nombre', to: null })
    expect(mcpMailEntryOf({ uid: 10, from: {}, cc: [''] })).toMatchObject({ from: null, cc: null })
    expect(mcpMailEntryOf({ uid: 0 })).toBeNull()
    expect(mcpMailEntryOf({ uid: 'sin-numero' })).toBeNull()
    expect(mcpMailEntryOf('basura')).toBeNull()
  })

  it('reads one page with the server pagination the payload carries', async () => {
    const server = fakeServer({ name: 'hostinger-email', messages: [{ uid: 5 }, { uid: 3 }, { uid: 0 }] })
    const registry = registryOf([server])
    const target: McpMailboxTarget = { server: 'hostinger-email', resourceId: 'AC1', address: 'a@b', folder: 'INBOX' }

    const page = await mcpMessagePage(registry, OWNER, target, 1, 100)
    // An entry with no usable uid is dropped instead of becoming a message.
    expect(page.entries.map(entry => entry.uid)).toEqual([5, 3])
    expect(page.totalPages).toBe(1)
    expect(server.calls.at(-1)).toEqual({
      tool: 'messages_list',
      args: { mailboxResourceId: 'AC1', folder: 'INBOX', page: 1, perPage: 100, sort: '-uid' },
    })

    const flat = fakeServer({ name: 'hostinger-email', messages: [{ uid: 5 }], noPagination: true })
    const flatRegistry = registryOf([flat])
    expect((await mcpMessagePage(flatRegistry, OWNER, target, 1, 10)).totalPages).toBeNull()
  })

  it('discovers one target per mailbox and skips a server without the mail tools or folders', async () => {
    const server = fakeServer({ name: 'hostinger-email', messages: [] })
    expect(await mcpMailboxTargets(registryOf([server]), OWNER, 'hostinger-email')).toEqual([{
      server: 'hostinger-email', resourceId: 'AC1', address: 'alvaro@muitowork.com', folder: 'INBOX',
    }])

    const bare = fakeServer({ name: 'sin-correo', messages: [], tools: ['search'] })
    expect(await mcpMailboxTargets(registryOf([bare]), OWNER, 'sin-correo')).toEqual([])

    const folderless: FakeServer = { ...fakeServer({ name: 'sin-carpetas', messages: [] }), folders: [] }
    expect(await mcpMailboxTargets(registryOf([folderless]), OWNER, 'sin-carpetas')).toEqual([])
  })

  it('collects the newest messages across the pages a batch needs', async () => {
    const many = fakeServer({
      name: 'hostinger-email',
      messages: Array.from({ length: 150 }, (_value, index) => ({ uid: index + 1 })),
    })
    const registry = registryOf([many])
    const target: McpMailboxTarget = { server: 'hostinger-email', resourceId: 'AC1', address: 'a@b', folder: 'INBOX' }

    const newest = await mcpNewestEntries(registry, OWNER, target, 150)
    expect(newest).toHaveLength(150)
    expect(newest[0]?.uid).toBe(150)
    expect(newest.at(-1)?.uid).toBe(1)

    const few = fakeServer({ name: 'hostinger-email', messages: [{ uid: 2 }, { uid: 1 }] })
    const fewRegistry = registryOf([few])
    expect(await mcpNewestEntries(fewRegistry, OWNER, target, 5)).toHaveLength(2)

    const empty = fakeServer({ name: 'hostinger-email', messages: [] })
    expect(await mcpNewestEntries(registryOf([empty]), OWNER, target, 5)).toEqual([])

    const flat = fakeServer({ name: 'hostinger-email', messages: [{ uid: 2 }, { uid: 1 }], noPagination: true })
    expect(await mcpNewestEntries(registryOf([flat]), OWNER, target, 2)).toHaveLength(2)
  })
})

describe('FaberLoomInbound over MCP', () => {
  it('fixes a baseline on the first view and turns a later MCP message into one draft case', async () => {
    const server = fakeServer({
      name: 'hostinger-email',
      messages: [{ uid: 10, messageId: '<historial@x>' }, { uid: 11, messageId: '<historial2@x>' }],
    })
    const { inbound, routines, pool } = await harness([server])
    const routine = await emailRoutine(routines)

    const first = await inbound.runOnce()
    expect(first).toMatchObject({ skipped: null, read: 0, error: null, started: [] })
    expect(first.accounts[0]).toMatchObject({
      connectionId: 'mcp-mail:hostinger-email:AC1',
      mailbox: 'alvaro@muitowork.com',
      read: 0,
      error: null,
    })
    expect(cursorOf(pool, 'mcp:hostinger-email:AC1:INBOX')).toMatchObject({
      lastUid: 11, baselineUid: 11, sweepUid: 11, connectionId: 'mcp-mail:hostinger-email:AC1',
    })

    server.messages.push({ uid: 12, messageId: '<nuevo@x>', subject: 'Factura 7' })
    const report = await inbound.runOnce()
    expect(report.read).toBe(1)
    expect(report.started).toHaveLength(1)

    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(1)
    expect(executions[0]?.event?.key).toBe('mail:msg:<nuevo@x>')
    expect(executions[0]?.event?.data).toEqual({
      origin: 'mcp',
      originId: 'mcp-mail:hostinger-email:AC1:INBOX:12',
      server: 'hostinger-email',
      resourceId: 'AC1',
      folder: 'INBOX',
      uid: 12,
      mailbox: 'alvaro@muitowork.com',
      connectionId: 'mcp-mail:hostinger-email:AC1',
      from: 'Nombre <correo@dominio>',
      to: 'alvaro@muitowork.com',
      cc: null,
      messageId: '<nuevo@x>',
      date: '2026-11-24T23:59:59Z',
      receivedAt: expect.any(String) as string,
    })
    expect((await inbound.runOnce()).read).toBe(0)
  })

  it('reads every page of a hole in one pass instead of stopping at the first full page', async () => {
    const server = fakeServer({ name: 'hostinger-email', messages: [] })
    const { inbound, routines } = await harness([server])
    const routine = await emailRoutine(routines)
    await inbound.runOnce()

    for (let uid = 1; uid <= 101; uid += 1) server.messages.push({ uid, messageId: `<m${String(uid)}@x>` })
    const report = await inbound.runOnce()
    expect(report.read).toBe(101)
    expect(report.started).toHaveLength(101)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(101)
    // The second pass finds the cursor on its first page and reads nothing.
    expect((await inbound.runOnce()).read).toBe(0)
  })

  it('stops on a short page when the server reports no pagination', async () => {
    const server = fakeServer({ name: 'hostinger-email', messages: [], noPagination: true })
    const { inbound, routines } = await harness([server])
    await emailRoutine(routines)
    await inbound.runOnce()

    server.messages.push({ uid: 21, messageId: '<corto@x>' })
    expect((await inbound.runOnce()).read).toBe(1)
  })

  it('dedupes one message that two mail servers list, by its Message-ID', async () => {
    const first = fakeServer({ name: 'hostinger-email', messages: [] })
    const second = fakeServer({
      name: 'otro-correo',
      messages: [],
      mailboxes: [{ resourceId: 'AC9', address: 'compras@muitowork.com' }],
    })
    const { inbound, routines } = await harness([first, second])
    const routine = await emailRoutine(routines)
    await inbound.runOnce()

    first.messages.push({ uid: 30, messageId: '<compartido@x>' })
    second.messages.push({ uid: 40, messageId: '<compartido@x>' })
    const report = await inbound.runOnce()
    expect(report.read).toBe(2)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(1)
  })

  it('reports a failing server and a failing mailbox without hiding the working one', async () => {
    const brokenServer = fakeServer({
      name: 'broken', messages: [], failTool: 'account_current', failValue: new Error('sin token'),
    })
    const brokenMailbox = fakeServer({ name: 'half', messages: [], failTool: 'messages_list', failValue: 'tiempo agotado' })
    const working = fakeServer({ name: 'hostinger-email', messages: [] })
    const { inbound, routines } = await harness([brokenServer, brokenMailbox, working])
    await emailRoutine(routines)

    const report = await inbound.runOnce()
    expect(report.accounts).toHaveLength(3)
    expect(report.accounts.find(entry => entry.mailbox === 'broken')).toMatchObject({
      connectionId: 'mcp-mail:broken',
      read: 0,
      error: 'sin token',
    })
    expect(report.accounts.find(entry => entry.connectionId === 'mcp-mail:half:AC1')).toMatchObject({
      mailbox: 'alvaro@muitowork.com',
      read: 0,
      error: 'tiempo agotado',
    })
    expect(report.accounts.find(entry => entry.connectionId === 'mcp-mail:hostinger-email:AC1')).toMatchObject({ error: null })
    expect(report.error).toContain('broken: sin token')
    expect(report.error).toContain('tiempo agotado')
    // The working server still provisions the reply routine.
    expect((await routines.listRoutines(OWNER)).some(candidate => candidate.name === 'Vigía de correo')).toBe(true)
  })

  it('provisions the reply routine from a mounted MCP mail server alone', async () => {
    const { inbound, routines } = await harness([fakeServer({ name: 'hostinger-email', messages: [] })])
    await inbound.runOnce()

    const list = await routines.listRoutines(OWNER)
    const reply = list.find(candidate => candidate.name === 'Vigía de correo')
    expect(reply?.status).toBe('active')
    expect(reply?.definition.intent).toContain('borrador')
    // The Marluvas operator still needs the privileged IMAP mailbox.
    expect(list.some(candidate => candidate.name === 'Operadora Marluvas')).toBe(false)
  })

  it('provisions nothing from a disabled server or from one that is not a mailbox', async () => {
    const disabled = fakeServer({ name: 'apagado', messages: [], enabled: false })
    const other = fakeServer({ name: 'buscador', messages: [], tools: ['search'] })
    const { inbound, routines } = await harness([disabled, other])

    expect(await inbound.runOnce()).toMatchObject({ skipped: 'no mailbox configured' })
    expect(await routines.listRoutines(OWNER)).toEqual([])
  })

  it('provisions nothing and skips cleanly when the owner has no MCP servers at all', async () => {
    const { inbound, routines } = await harness([])
    expect(await inbound.runOnce()).toMatchObject({ skipped: 'no mailbox configured' })
    expect(await routines.listRoutines(OWNER)).toEqual([])
  })

  it('sweeps the newest MCP mail above the baseline and never repeats it', async () => {
    const server = fakeServer({
      name: 'hostinger-email',
      messages: [{ uid: 10, messageId: '<historial@x>' }, { uid: 20, messageId: '<saltado@x>', seen: true, subject: '' }],
    })
    const pool = new MemoryMediaPool()
    const { inbound, routines } = await harness([server], pool)
    const routine = await emailRoutine(routines)
    // A watcher installed at UID 10 whose poll cursor reached 20 without
    // delivering UID 20: the hole the sweep exists for.
    seedCursors(pool, [['mcp:hostinger-email:AC1:INBOX', {
      ownerId: OWNER,
      connectionId: 'mcp-mail:hostinger-email:AC1',
      lastUid: 20,
      uidValidity: null,
      baselineUid: 10,
      sweepUid: 10,
      updatedAt: '2026-11-25T00:00:00.000Z',
    }]])

    const start = new Date('2026-11-25T10:00:00Z')
    expect((await inbound.runOnce(start)).started).toEqual([])

    const swept = await inbound.runOnce(new Date(start.getTime() + 6 * 60_000))
    expect(swept.started).toHaveLength(1)
    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(1)
    expect(executions[0]?.event?.key).toBe('mail:msg:<saltado@x>')
    // A message with no Subject carries none on its event.
    expect(executions[0]?.event?.subject).toBeUndefined()
    // The history below the baseline stays history, read or not.
    expect(await routines.hasEvent(OWNER, 'mail:msg:<historial@x>')).toBe(false)

    const delivered = executions[0]?.evidence.length ?? 0
    const repeat = await inbound.runOnce(new Date(start.getTime() + 12 * 60_000))
    expect(repeat.started).toEqual([])
    expect((await routines.listExecutions({ routineId: routine.id }))[0]?.evidence).toHaveLength(delivered)
  })

  it('sweeps an old MCP cursor from its own last UID when the record carries no baseline', async () => {
    const server = fakeServer({
      name: 'hostinger-email',
      messages: [{ uid: 10, messageId: '<historial@x>' }, { uid: 20, messageId: '<cubierto@x>' }],
    })
    const pool = new MemoryMediaPool()
    const { inbound, routines } = await harness([server], pool)
    await emailRoutine(routines)
    // A cursor written before the baseline existed: `lastUid` is the only floor.
    seedCursors(pool, [['mcp:hostinger-email:AC1:INBOX', {
      ownerId: OWNER,
      connectionId: 'mcp-mail:hostinger-email:AC1',
      lastUid: 20,
      uidValidity: null,
      updatedAt: '2026-11-25T00:00:00.000Z',
    }]])

    const start = new Date('2026-11-25T10:00:00Z')
    await inbound.runOnce(start)
    const swept = await inbound.runOnce(new Date(start.getTime() + 6 * 60_000))
    expect(swept.started).toEqual([])
    expect(await routines.hasEvent(OWNER, 'mail:msg:<cubierto@x>')).toBe(false)
  })
})
