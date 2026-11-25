/**
 * O4-01 · reception with two accounts.
 *
 * Each account keeps its own cursor, one failing mailbox never hides the other,
 * a reconnection resumes exactly where it stopped without starting the same
 * message twice, and E1 refuses every flag write.
 */
import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../../connections/src/index.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput } from '../../routines/src/index.ts'
import FaberLoomInbound, { MIN_INTERVAL_MS } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** One message the fake server hands out. */
interface FakeMessage {
  readonly uid: number
  readonly messageId: string
  readonly from: string
  readonly subject: string
}

/** A minimal IMAP server that can be bound to a fixed port for reconnection. */
function fakeServer(
  messages: FakeMessage[],
  log: string[],
  port = 0,
  refuseLogin?: string,
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const server = createServer((socket: Socket) => {
    socket.write('* OK fake IMAP ready\r\n')
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let end = buffer.indexOf('\r\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\r\n')
        const [tag, ...rest] = line.split(' ')
        const command = rest.join(' ')
        log.push(command)
        if (/^LOGIN/i.test(command)) {
          socket.write(refuseLogin === undefined
            ? `${String(tag)} OK LOGIN completed\r\n`
            : `${String(tag)} NO ${refuseLogin}\r\n`)
        } else if (/^SELECT/i.test(command)) socket.write(`${String(tag)} OK [READ-WRITE] SELECT completed\r\n`)
        else if (/^UID SEARCH/i.test(command)) {
          const from = Number(/UID (\d+):\*/.exec(command)?.[1] ?? '0')
          const found = messages.filter(message => message.uid >= from).map(message => message.uid)
          socket.write(`* SEARCH${found.map(uid => ` ${String(uid)}`).join('')}\r\n${String(tag)} OK SEARCH completed\r\n`)
        } else if (/^UID FETCH/i.test(command)) {
          const asked = (/(\d+(?:,\d+)*) \(/.exec(command)?.[1] ?? '').split(',').map(Number)
          for (const uid of asked) {
            const message = messages.find(entry => entry.uid === uid)
            if (message === undefined) continue
            const header = `Message-ID: <${message.messageId}>\r\nFrom: ${message.from}\r\nSubject: ${message.subject}\r\nDate: Tue, 18 Sep 2026 10:00:00 +0000\r\n\r\n`
            socket.write(`* ${String(uid)} FETCH (UID ${String(uid)} BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)] {${String(header.length)}}\r\n${header})\r\n`)
          }
          socket.write(`${String(tag)} OK FETCH completed\r\n`)
        } else if (/^LOGOUT/i.test(command)) {
          socket.write(`* BYE bye\r\n${String(tag)} OK LOGOUT completed\r\n`)
          socket.end()
        } else socket.write(`${String(tag)} BAD unknown\r\n`)
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        port: typeof address === 'object' && address !== null ? address.port : 0,
        close: () => new Promise<void>((done) => { server.close(() => { done() }) }),
      })
    })
  })
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** Boot the receiver over one owner pool. */
async function harness(config: { readonly maxMessages?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('step', () => 'ok')
  await ctx.plugin(FaberLoomInbound, {
    ownerId: OWNER,
    enabled: false,
    intervalMs: MIN_INTERVAL_MS,
    timeoutMs: 2_000,
    ...config,
  })
  const routines = ctx.faberloomRoutines
  const routine = await routines.createRoutine(OWNER, { name: 'Atención', definition: ROUTINE })
  await routines.activateRoutine(OWNER, routine.id)
  return { connections: ctx.faberloomConnections, inbound: ctx.faberloomInbound, routines }
}

/** One routine that every email starts. */
const ROUTINE: RoutineDefinitionInput = {
  intent: 'atender el correo',
  triggers: [{ kind: 'email' }],
  steps: [{ id: 's1', instruction: 'atiende', handler: 'step' }],
  expectedResult: '',
  permissions: ['mwt'],
  failurePolicy: 'stop',
}

/** Save one plain IMAP connection and return its id. */
async function account(connections: Awaited<ReturnType<typeof harness>>['connections'], label: string, port: number, username: string): Promise<string> {
  const saved = await connections.save(OWNER, {
    kind: 'imap', label, host: '127.0.0.1', port, secure: false, username, secret: `secret-${label}`,
  })
  return saved.id
}

describe('O4-01 · two accounts', () => {
  it('reads both accounts with independent cursors', async () => {
    const logA: string[] = []
    const logB: string[] = []
    const messagesA: FakeMessage[] = []
    const messagesB: FakeMessage[] = []
    const a = await fakeServer(messagesA, logA)
    const b = await fakeServer(messagesB, logB)
    servers.push(a.server, b.server)
    const { connections, inbound } = await harness()
    await account(connections, 'Cuenta A', a.port, 'cuenta-a')
    await account(connections, 'Cuenta B', b.port, 'cuenta-b')

    // The first view of each account is its baseline, not its history.
    expect((await inbound.runOnce()).read).toBe(0)
    messagesA.push({ uid: 1, messageId: 'a1@x', from: 'uno@x', subject: 'Factura A' })
    messagesB.push({ uid: 1, messageId: 'b1@x', from: 'dos@x', subject: 'Factura B' })
    const report = await inbound.runOnce()

    expect(report.accounts).toHaveLength(2)
    expect(report.accounts.every(entry => entry.error === null)).toBe(true)
    expect(report.accounts.map(entry => entry.read)).toEqual([1, 1])
    expect(report.started).toHaveLength(2)
    expect(new Set(report.started.map(entry => entry.split(':').slice(1).join(':'))).size).toBe(2)
    expect(report.started.some(entry => entry.includes('a1@x'))).toBe(true)
    expect(report.started.some(entry => entry.includes('b1@x'))).toBe(true)
    expect(report.error).toBeNull()
  })

  it('keeps the working account useful when the other one is down, and resumes it without a second run', async () => {
    const logA: string[] = []
    const logB: string[] = []
    const messagesA: FakeMessage[] = []
    const messagesB: FakeMessage[] = []
    const a = await fakeServer(messagesA, logA)
    const b = await fakeServer(messagesB, logB)
    servers.push(a.server, b.server)
    const portA = a.port
    await a.close()

    const { connections, inbound } = await harness()
    await account(connections, 'Cuenta A', portA, 'cuenta-a')
    await account(connections, 'Cuenta B', b.port, 'cuenta-b')

    // First pass: A is unreachable, B answers and fixes its baseline.
    const first = await inbound.runOnce()
    expect(first.accounts).toHaveLength(2)
    const downA = first.accounts.find(entry => entry.mailbox === 'Cuenta A')
    expect(downA?.error).not.toBeNull()
    expect(first.accounts.find(entry => entry.mailbox === 'Cuenta B')?.read).toBe(0)
    expect(first.error).toContain('Cuenta A')
    expect(first.started).toEqual([])

    // A comes back on the same port; its first successful read is a baseline.
    const revived = await fakeServer(messagesA, logA, portA)
    servers.push(revived.server)
    const second = await inbound.runOnce()
    expect(second.accounts.every(entry => entry.error === null)).toBe(true)
    expect(second.accounts.find(entry => entry.mailbox === 'Cuenta A')?.read).toBe(0)
    expect(second.started).toEqual([])

    // A message that arrives after the baseline is read once; B sees nothing.
    messagesA.push({ uid: 1, messageId: 'a1@x', from: 'uno@x', subject: 'Factura A' })
    const third = await inbound.runOnce()
    expect(third.accounts.find(entry => entry.mailbox === 'Cuenta A')?.read).toBe(1)
    expect(third.accounts.find(entry => entry.mailbox === 'Cuenta B')?.read).toBe(0)
    expect(third.started).toHaveLength(1)
    expect(logB.filter(command => command.startsWith('UID SEARCH'))).toHaveLength(3)
  })

  it('reads an account in batches and never loses or repeats a message', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const server = await fakeServer(messages, log)
    servers.push(server.server)
    const { connections, inbound } = await harness({ maxMessages: 2 })
    await account(connections, 'Cuenta', server.port, 'cuenta-a')
    // Baseline first: the backlog that arrives afterwards is the new mail.
    await inbound.runOnce()

    messages.push(
      { uid: 1, messageId: 'm1@x', from: 'a@x', subject: 'uno' },
      { uid: 2, messageId: 'm2@x', from: 'a@x', subject: 'dos' },
      { uid: 3, messageId: 'm3@x', from: 'a@x', subject: 'tres' },
      { uid: 4, messageId: 'm4@x', from: 'a@x', subject: 'cuatro' },
      { uid: 5, messageId: 'm5@x', from: 'a@x', subject: 'cinco' },
    )
    const report = await inbound.runOnce()
    // One pass walks 2 + 2 + 1: a full batch never ends the poll.
    expect(report.accounts[0]?.read).toBe(5)
    expect(report.started).toHaveLength(5)
    expect(new Set(report.started).size).toBe(5)
    // The next pass has nothing above the cursor and repeats nothing.
    expect((await inbound.runOnce()).started).toEqual([])
  })

  it('refuses to mark, move or delete in E1 and leaves the server untouched', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = [{ uid: 1, messageId: 'm1@x', from: 'a@x', subject: 'uno' }]
    const server = await fakeServer(messages, log)
    servers.push(server.server)
    const { connections, inbound } = await harness()
    await account(connections, 'Cuenta', server.port, 'cuenta-a')
    await inbound.runOnce()
    const before = log.length

    await expect(inbound.markSeen(OWNER, 1)).rejects.toThrow(/WRITE_NOT_APPROVED/u)
    await expect(inbound.moveToTrash(OWNER, 1)).rejects.toThrow(/WRITE_NOT_APPROVED/u)

    expect(log).toHaveLength(before)
    expect(log.some(command => /^(STORE|COPY|EXPUNGE|UID STORE)/iu.test(command))).toBe(false)
  })

  it('carries the server reason when it refuses a login, instead of a bare NO', async () => {
    const log: string[] = []
    const server = await fakeServer([], log, 0, '[AUTHENTICATIONFAILED] Invalid credentials (Failure)')
    servers.push(server.server)
    const { connections, inbound } = await harness()
    const id = await account(connections, 'Cuenta', server.port, 'cuenta-a')

    const failure = await inbound.listInbox(OWNER, 10, id).catch((error: unknown) => error as Error)

    // A panel that only says `NO` leaves the owner with nothing to act on; the
    // server's own words are what names the cause.
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('AUTHENTICATIONFAILED')
    expect((failure as Error).message).toContain('Invalid credentials')
  })
})
