import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../../connections/src/index.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput } from '../../routines/src/index.ts'
import FaberLoomInbound, { MAX_SWEEP_BATCH, MIN_INTERVAL_MS, type CursorRecord } from '../src/index.ts'
import { fetchMessages, headerValue, latestUid, messagesOf, searchMessages, uidsOf, uidValidityOf } from '../src/imap.ts'

const OWNER = 'compras2@sondelsa.com'

/** One message the fake server will hand out. */
interface FakeMessage {
  readonly uid: number
  readonly messageId: string
  readonly from: string
  readonly subject: string
  /** Whether the mailbox already carries `\Seen`; absent means unread. */
  readonly seen?: boolean
  /** `Date` header value; a fixed 2026 date otherwise. */
  readonly date?: string
}

/** A minimal IMAP server: greeting, LOGIN, SELECT, UID SEARCH, UID FETCH, LOGOUT. */
function fakeServer(
  messages: FakeMessage[],
  log: string[],
  uidValidity: number | null = null,
  refuseCharset = false,
  failSearchAfter = Number.POSITIVE_INFINITY,
): Promise<{ server: Server; port: number }> {
  let searches = 0
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
        if (/^LOGIN/i.test(command)) socket.write(`${String(tag)} OK LOGIN completed\r\n`)
        else if (/^SELECT/i.test(command)) {
          if (uidValidity !== null) socket.write(`* OK [UIDVALIDITY ${String(uidValidity)}] mailbox ready\r\n`)
          socket.write(`${String(tag)} OK [READ-WRITE] SELECT completed\r\n`)
        }
        else if (/^UID SEARCH/i.test(command) && refuseCharset && /CHARSET/i.test(command)) {
          socket.write(`${String(tag)} BAD unsupported charset\r\n`)
        }
        else if (/^UID SEARCH/i.test(command)) {
          searches += 1
          if (searches > failSearchAfter) {
            socket.write(`${String(tag)} BAD search refused\r\n`)
            continue
          }
          const unseen = /UNSEEN/i.test(command)
          const from = Number(/UID (\d+):\*/.exec(command)?.[1] ?? '0')
          const found = messages.filter(message => unseen || message.uid >= from).map(message => message.uid)
          socket.write(`* SEARCH${found.map(uid => ` ${String(uid)}`).join('')}\r\n${String(tag)} OK SEARCH completed\r\n`)
        } else if (/^UID FETCH/i.test(command)) {
          const asked = (/(\d+(?:,\d+)*) \(/.exec(command)?.[1] ?? '').split(',').map(Number)
          for (const uid of asked) {
            const message = messages.find(entry => entry.uid === uid)
            if (message === undefined) continue
            const date = message.date ?? 'Tue, 18 Sep 2026 10:00:00 +0000'
            const header = `Message-ID: <${message.messageId}>\r\nFrom: ${message.from}\r\nSubject: ${message.subject}\r\nDate: ${date}\r\n\r\n`
            const flags = message.seen === true ? '\\Seen' : ''
            socket.write(`* ${String(uid)} FETCH (UID ${String(uid)} FLAGS (${flags}) BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)] {${String(header.length)}}\r\n${header})\r\n`)
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
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0 })
    })
  })
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** Boot storage, connections, access, and routines over one owner pool. */
async function boot(pool = new MemoryMediaPool()): Promise<Context> {
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
  return ctx
}

/** Boot the receiver over one owner pool. */
async function harness(
  pool = new MemoryMediaPool(),
  role = '',
  config: { readonly maxMessages?: number; readonly sweepBatch?: number } = {},
) {
  const ctx = await boot(pool)
  await ctx.plugin(FaberLoomInbound, {
    ownerId: OWNER,
    enabled: false,
    intervalMs: MIN_INTERVAL_MS,
    mailbox: 'INBOX',
    role,
    ...config,
  })
  return { ctx, connections: ctx.faberloomConnections, routines: ctx.faberloomRoutines, inbound: ctx.faberloomInbound }
}

/**
 * Write cursor rows into the pooled medium before the receiver opens its
 * domain, so a test starts from a watcher that was already installed.
 */
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

/** Build a definition from one step and an email trigger. */
function emailRoutine(match: string): RoutineDefinitionInput {
  return {
    intent: 'atender el correo entrante',
    triggers: [{ kind: 'email', match }],
    steps: [{ id: 's1', instruction: 'atiende el correo', handler: 'step' }],
    expectedResult: 'correo atendido',
    permissions: ['mwt'],
    failurePolicy: 'stop',
  }
}

describe('FaberLoomInbound', () => {
  it('leaves the cloud-ready routines of a mail to the VPS on a desktop that mirrors to it', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)
    vi.stubEnv('FABERLOOM_MIRROR_ENABLED', '1')
    try {
      const { connections, routines, inbound } = await harness()
      await connections.save(OWNER, { kind: 'imap', label: 'Correo Eguisa', host: '127.0.0.1', port: fake.port, secure: false, username: 'compras2', secret: 'secreta' })
      const cloud = { ...emailRoutine('orden de compra'), steps: [{ id: 's1', instruction: 'atiende el correo', handler: 'agent' }] }
      const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: cloud })
      await routines.activateRoutine(OWNER, routine.id)

      // The first view fixes the baseline; mail that arrives later is new work.
      expect((await inbound.runOnce()).read).toBe(0)
      messages.push({ uid: 11, messageId: 'oc-2@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4712' })
      const report = await inbound.runOnce()
      expect(report).toMatchObject({ read: 1, error: null })
      expect(report.started).toEqual([])
      expect(await routines.listExecutions({ routineId: routine.id })).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('F07 � fixes the baseline at the top on the first view and turns a later message into one run', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo Eguisa', host: '127.0.0.1', port: fake.port, secure: false, username: 'compras2', secret: 'secreta' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)

    const baseline = await inbound.runOnce()
    expect(baseline).toMatchObject({ skipped: null, mailbox: 'Correo Eguisa', read: 0, error: null })
    expect(baseline.started).toEqual([])
    expect(log).toContain('UID SEARCH ALL')

    messages.push({ uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' })
    const report = await inbound.runOnce()
    expect(report).toMatchObject({ read: 1, error: null })
    expect(report.started).toHaveLength(1)

    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(1)
    expect(executions[0]?.event).toMatchObject({ type: 'email', subject: 'Orden de compra 4711' })
    // One mail, one key, whichever transport reads it.
    expect(executions[0]?.event?.key).toBe('mail:msg:<oc-1@eguisa.example>')
    expect(log).toContain('UID SEARCH UID 1:*')
  })

  it('does not answer the history a mailbox already held when the watcher is installed', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 50, messageId: 'viejo@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4600' },
      { uid: 51, messageId: 'otro@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4601', seen: true },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)

    const first = await inbound.runOnce()
    expect(first.read).toBe(0)
    expect(first.started).toEqual([])
    expect(await routines.listExecutions({ routineId: routine.id })).toEqual([])
    // The whole mailbox was searched for its top, not for unread mail: the
    // baseline is the top regardless of which messages were already read.
    expect(log).toContain('UID SEARCH ALL')
  })

  it('reads a full batch as a batch: a complete page never ends the poll', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness(new MemoryMediaPool(), '', { maxMessages: 2 })
    await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos', definition: emailRoutine('') })
    await routines.activateRoutine(OWNER, routine.id)
    await inbound.runOnce()

    for (const uid of [1, 2, 3, 4, 5]) {
      messages.push({ uid, messageId: `m${String(uid)}@x`, from: 'a@x', subject: uid === 3 ? '' : `uno ${String(uid)}` })
    }
    const report = await inbound.runOnce()
    // Five messages with a batch of two: 2 + 2 + 1 in one pass, none lost.
    expect(report.read).toBe(5)
    expect(report.started).toHaveLength(5)
    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(5)
    // A message with no Subject carries no subject on its event either.
    expect(executions.some(execution => execution.event?.subject === undefined)).toBe(true)
    expect(log.filter(command => /^UID SEARCH UID /u.test(command))).toEqual([
      'UID SEARCH UID 1:*',
      'UID SEARCH UID 3:*',
      'UID SEARCH UID 5:*',
    ])
    expect((await inbound.runOnce()).read).toBe(0)
  })

  it('treats a new UIDVALIDITY as a new baseline instead of reading the mailbox as new', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 70, messageId: 'nuevo@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4800' },
    ], log, 2)
    servers.push(fake.server)

    const pool = new MemoryMediaPool()
    const { connections, routines, inbound } = await harness(pool)
    const saved = await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)
    // The stored cursor belongs to a previous mailbox generation.
    seedCursors(pool, [[saved.id, {
      ownerId: OWNER, connectionId: saved.id, lastUid: 5, uidValidity: 1, baselineUid: 1, sweepUid: 1, updatedAt: '2026-09-18T09:00:00.000Z',
    }]])

    const report = await inbound.runOnce()
    expect(report.read).toBe(0)
    expect(report.started).toEqual([])
    expect(await routines.listExecutions({ routineId: routine.id })).toEqual([])
    expect(cursorOf(pool, saved.id)).toMatchObject({ lastUid: 70, baselineUid: 70, sweepUid: 70, uidValidity: 2 })
  })

  it('lists the important and awaiting pages with their own IMAP criteria', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 1, messageId: 'm1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden' },
    ], log)
    servers.push(fake.server)
    const { connections, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo Eguisa', host: '127.0.0.1', port: fake.port, secure: false, username: 'compras2', secret: 'secreta' })

    await inbound.listPage(OWNER, { filter: 'important' })
    await inbound.listPage(OWNER, { filter: 'awaiting' })
    // Important covers the owner's flag and the server's important keyword;
    // awaiting is the standard unanswered flag, both resolved by the server.
    expect(log).toContain('UID SEARCH ALL OR FLAGGED KEYWORD $Important')
    expect(log).toContain('UID SEARCH ALL UNANSWERED')
  })

  it('ignores a cursor whose UIDVALIDITY changed, and keeps it when it did not', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 5, messageId: 'leido@eguisa.example', from: 'cliente@eguisa.example', subject: 'ya leído' },
      { uid: 25, messageId: 'nuevo@eguisa.example', from: 'cliente@eguisa.example', subject: 'nuevo' },
    ], log, 2)
    servers.push(fake.server)

    const base = {
      host: '127.0.0.1',
      port: fake.port,
      secure: false,
      user: 'compras2',
      password: 'secreta',
      mailbox: 'INBOX',
      maxMessages: 20,
      timeoutMs: 5_000,
    }

    // The mailbox was re-indexed: the stored cursor (UIDVALIDITY 1, UID 20) no
    // longer names these messages, so the read starts from the mailbox again.
    const stale = await fetchMessages({ ...base, since: 20, expectedUidValidity: 1 })
    expect(stale.uidValidity).toBe(2)
    expect(stale.reset).toBe(true)
    expect(stale.messages.map(message => message.uid)).toEqual([5, 25])

    // Same mailbox identity: the cursor is honoured and only newer mail is read.
    const fresh = await fetchMessages({ ...base, since: 5, expectedUidValidity: 2 })
    expect(fresh.reset).toBe(false)
    expect(fresh.messages.map(message => message.uid)).toEqual([25])
  })

  it('reads the mailbox top for a baseline and asks for the whole mailbox when a read has no cursor', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 3, messageId: 'leido@x', from: 'a@x', subject: 'leído', seen: true },
      { uid: 9, messageId: 'nuevo@x', from: 'a@x', subject: 'nuevo' },
    ], log, 7)
    servers.push(fake.server)
    const empty = await fakeServer([], log)
    servers.push(empty.server)
    const base = {
      host: '127.0.0.1',
      secure: false,
      user: 'u',
      password: 's',
      mailbox: 'INBOX',
      since: null,
      maxMessages: 20,
      timeoutMs: 5_000,
    }

    expect(await latestUid({ ...base, port: fake.port })).toEqual({ uidValidity: 7, uid: 9 })
    expect(await latestUid({ ...base, port: empty.port })).toEqual({ uidValidity: null, uid: 0 })

    await fetchMessages({ ...base, port: fake.port })
    await fetchMessages({ ...base, port: fake.port, unseenOnly: false })
    // The poller's question is unread mail; a sweep asks for the mailbox.
    expect(log.filter(command => command === 'UID SEARCH UNSEEN')).toHaveLength(1)
    expect(log.filter(command => command === 'UID SEARCH ALL')).toHaveLength(3)
  })

  it('reads UIDVALIDITY from the SELECT response and ignores a server that omits it', () => {
    expect(uidValidityOf(['* OK [UIDVALIDITY 1700000000] mailbox ready'])).toBe(1_700_000_000)
    expect(uidValidityOf(['* OK [READ-WRITE] SELECT completed'])).toBeNull()
    expect(uidValidityOf(['* OK [UIDVALIDITY not-a-number] x'])).toBeNull()
  })

  it('rejects a sweep batch outside its bounds', async () => {
    const ctx = await boot()
    await expect(ctx.plugin(FaberLoomInbound, {
      ownerId: OWNER, enabled: false, intervalMs: MIN_INTERVAL_MS, sweepBatch: 0,
    })).rejects.toThrow('sweepBatch')
    const another = await boot()
    await expect(another.plugin(FaberLoomInbound, {
      ownerId: OWNER, enabled: false, intervalMs: MIN_INTERVAL_MS, sweepBatch: MAX_SWEEP_BATCH + 1,
    })).rejects.toThrow('sweepBatch')
  })

  it('provisions the reply routine and the Marluvas operator as separate routines', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 20, messageId: 'marluvas-1@marluvas.example', from: 'samuel.fernandes@marluvas.com.br', subject: 'Proforma 2500-2026' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness(new MemoryMediaPool(), 'admin')
    await connections.save(OWNER, { kind: 'imap', label: 'Marluvas', host: '127.0.0.1', port: fake.port, secure: false, username: 'alvaro@muitowork.com', secret: 'secreta' })
    await connections.save(OWNER, { kind: 'smtp', label: 'Marluvas SMTP', host: '127.0.0.1', port: 465, secure: true, username: 'alvaro@muitowork.com', secret: 'secreta' })

    await inbound.runOnce()

    const list = await routines.listRoutines(OWNER)
    const reply = list.find(candidate => candidate.name === 'Vigía de correo')
    const operator = list.find(candidate => candidate.name === 'Operadora Marluvas')
    expect(reply?.status).toBe('active')
    expect(reply?.definition.intent).toContain('borrador')
    expect(reply?.definition.steps.every(step => step.config?.['agentName'] === undefined)).toBe(true)
    expect(operator?.status).toBe('active')
    expect(operator?.definition.intent).toContain('Marluvas')
    expect(operator?.definition.steps.every(step => step.config?.['agentName'] === 'Operador Marluvas')).toBe(true)
  })

  it('keeps only the reply routine for a non-privileged role on the operations mailbox', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 30, messageId: 'marluvas-2@marluvas.example', from: 'samuel.fernandes@marluvas.com.br', subject: 'Proforma 2501-2026' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness(new MemoryMediaPool(), 'manager')
    await connections.save(OWNER, { kind: 'imap', label: 'Marluvas', host: '127.0.0.1', port: fake.port, secure: false, username: 'alvaro@muitowork.com', secret: 'secreta' })
    await connections.save(OWNER, { kind: 'smtp', label: 'Marluvas SMTP', host: '127.0.0.1', port: 465, secure: true, username: 'alvaro@muitowork.com', secret: 'secreta' })

    await inbound.runOnce()

    const list = await routines.listRoutines(OWNER)
    const [routine] = list.filter(candidate => candidate.name === 'Vigía de correo')
    expect(routine?.definition.intent).toContain('borrador')
    expect(routine?.definition.steps.every(step => step.config?.['agentName'] === undefined)).toBe(true)
    expect(list.some(candidate => candidate.name === 'Operadora Marluvas')).toBe(false)
  })

  it('F07 � re-reading the mailbox never starts the same message twice', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)
    await inbound.runOnce()

    messages.push(
      { uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' },
      { uid: 11, messageId: 'oc-2@eguisa.example', from: 'otro@eguisa.example', subject: 'Orden de compra 4712' },
    )
    expect((await inbound.runOnce()).read).toBe(2)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(2)

    const again = await inbound.runOnce()
    expect(again.read).toBe(0)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(2)
    expect(log.some(command => /UID SEARCH UID 12:\*/.test(command))).toBe(true)
  })

  it('dedupes one message delivered to two mailboxes by its Message-ID', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = []
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: '506', host: '127.0.0.1', port: fake.port, secure: false, username: '506@muitowork.com', secret: 's' })
    await connections.save(OWNER, { kind: 'imap', label: 'alejandro', host: '127.0.0.1', port: fake.port, secure: false, username: 'alejandro@muitowork.com', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Redactora', definition: emailRoutine('Hola') })
    await routines.activateRoutine(OWNER, routine.id)
    await inbound.runOnce()

    messages.push({ uid: 40, messageId: 'compartido@eguisa.example', from: 'cliente@eguisa.example', subject: 'Hola' })
    const report = await inbound.runOnce()
    // Both mailboxes read the message, but one run answers it.
    expect(report.read).toBe(2)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(1)
  })

  it('sweeps a cycle from the baseline to the top, read or not, and never appends the same evidence twice', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 10, messageId: 'instalado@x', from: 'a@x', subject: 'historial', date: 'Mon, 01 Jan 2024 00:00:00 +0000' },
      // Already read, and old: neither the flag nor the date hides it from the sweep.
      { uid: 50, messageId: 'saltado@x', from: 'a@x', subject: 'saltado', seen: true, date: 'Mon, 01 Jan 2024 00:00:00 +0000' },
    ], log)
    servers.push(fake.server)

    const pool = new MemoryMediaPool()
    const { connections, routines, inbound } = await harness(pool)
    const saved = await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Barrido', definition: emailRoutine('') })
    await routines.activateRoutine(OWNER, routine.id)
    // A watcher installed at UID 10 whose poll cursor reached 50 without
    // delivering UID 50: exactly the hole the sweep exists for.
    seedCursors(pool, [[saved.id, {
      ownerId: OWNER, connectionId: saved.id, lastUid: 50, uidValidity: null, baselineUid: 10, sweepUid: 10, updatedAt: '2026-09-18T09:00:00.000Z',
    }]])

    const start = new Date('2026-09-18T10:00:00Z')
    // The first pass arms the sweep cadence; the poll has nothing above 50.
    expect((await inbound.runOnce(start)).started).toEqual([])

    const swept = await inbound.runOnce(new Date(start.getTime() + 6 * 60_000))
    expect(swept.started).toHaveLength(1)
    expect(cursorOf(pool, saved.id)?.sweepUid).toBe(50)
    const delivered = (await routines.listExecutions({ routineId: routine.id }))[0]?.evidence.length ?? 0
    expect(delivered).toBeGreaterThan(0)

    // Nothing above 50: the cycle returns to the baseline.
    await inbound.runOnce(new Date(start.getTime() + 12 * 60_000))
    expect(cursorOf(pool, saved.id)?.sweepUid).toBe(10)

    // The second cycle reads UID 50 again; the durable event key keeps the
    // case at the same evidence instead of growing the same run.
    const repeat = await inbound.runOnce(new Date(start.getTime() + 18 * 60_000))
    expect(repeat.started).toEqual([])
    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(1)
    expect(executions[0]?.evidence).toHaveLength(delivered)
    expect(await routines.hasEvent(OWNER, 'mail:msg:<saltado@x>')).toBe(true)
  })

  it('queues the unread backlog of an old cursor and leaves its read mail alone', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 10, messageId: 'viejo@x', from: 'a@x', subject: 'historial sin leer' },
      { uid: 50, messageId: 'otro@x', from: 'a@x', subject: 'más historial', seen: true },
    ], log)
    servers.push(fake.server)

    const pool = new MemoryMediaPool()
    const { connections, routines, inbound } = await harness(pool)
    const saved = await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Barrido', definition: emailRoutine('') })
    await routines.activateRoutine(OWNER, routine.id)
    // A watcher written before the baseline existed: `lastUid` is its old cursor,
    // not a floor that hides unread mail the old sweep never reached.
    seedCursors(pool, [[saved.id, {
      ownerId: OWNER, connectionId: saved.id, lastUid: 50, uidValidity: null, updatedAt: '2026-09-18T09:00:00.000Z',
    }]])

    const start = new Date('2026-09-18T10:00:00Z')
    await inbound.runOnce(start)
    const swept = await inbound.runOnce(new Date(start.getTime() + 6 * 60_000))
    // The unread old message gets its one event; the read one stays history.
    expect(swept.started).toHaveLength(1)
    expect(await routines.hasEvent(OWNER, 'mail:msg:<viejo@x>')).toBe(true)
    expect(await routines.hasEvent(OWNER, 'mail:msg:<otro@x>')).toBe(false)
    expect(cursorOf(pool, saved.id)?.sweepUid).toBe(50)
  })

  it('logs a sweep read failure without losing the poll cursor', async () => {
    const log: string[] = []
    // Two searches succeed (the poll of each pass); the sweep's third read is refused.
    const fake = await fakeServer([
      { uid: 10, messageId: 'instalado@x', from: 'a@x', subject: 'historial' },
    ], log, null, false, 2)
    servers.push(fake.server)

    const pool = new MemoryMediaPool()
    const { connections, routines, inbound } = await harness(pool)
    const saved = await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Barrido', definition: emailRoutine('') })
    await routines.activateRoutine(OWNER, routine.id)
    seedCursors(pool, [[saved.id, {
      ownerId: OWNER, connectionId: saved.id, lastUid: 10, uidValidity: null, baselineUid: 10, sweepUid: 10, updatedAt: '2026-09-18T09:00:00.000Z',
    }]])

    const start = new Date('2026-09-18T10:00:00Z')
    await inbound.runOnce(start)
    const report = await inbound.runOnce(new Date(start.getTime() + 6 * 60_000))
    // The poll succeeded; only the sweep read failed, and its cursor stays put
    // for the next cycle instead of skipping the batch.
    expect(report).toMatchObject({ error: null, started: [] })
    expect(cursorOf(pool, saved.id)).toMatchObject({ lastUid: 10, sweepUid: 10 })
  })

  it('reports no mailbox when the connections service is not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomAccess)
    await ctx.plugin(FaberLoomRoutines)
    await ctx.plugin(FaberLoomInbound, { ownerId: OWNER, enabled: false, intervalMs: MIN_INTERVAL_MS })

    expect(await ctx.faberloomInbound.runOnce()).toMatchObject({ skipped: 'no mailbox configured' })
  })

  it('F07 � a mailbox that cannot be read is reported, not thrown, and the poller survives', async () => {
    const { connections, inbound } = await harness()
    expect(await inbound.runOnce()).toMatchObject({ skipped: 'no mailbox configured' })

    await connections.save(OWNER, { kind: 'imap', label: 'Roto', host: '127.0.0.1', port: 1, secure: false, username: 'u', secret: 's' })
    const failed = await inbound.runOnce()
    expect(failed.error).not.toBeNull()
    expect(failed.read).toBe(0)

    const backupOnly = await harness()
    await backupOnly.connections.save(OWNER, { kind: 'backup', label: 'Respaldo', destination: '/opt/backups', retentionDays: 30 })
    expect(await backupOnly.inbound.runOnce()).toMatchObject({ skipped: 'no mailbox configured' })
  })

  it('F07 � reads the protocol pieces on their own', () => {
    expect(uidsOf(['* SEARCH 4 2 10'])).toEqual([2, 4, 10])
    expect(uidsOf(['* SEARCH', '* 3 EXISTS'])).toEqual([])
    const header = 'Message-ID: <a@b>\r\nFrom: "Cliente" <c@d>\r\nTo: compras@mwt.one, ventas@x.example\r\nCc: logistica@x.example\r\nSubject: Orden\r\n de compra\r\nDate: hoy\r\nReferences: <z@y>\r\n\r\n'
    const messages = messagesOf([`* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (...)] {${String(header.length)}}\r\n${header})`])
    expect(messages).toEqual([{
      uid: 7,
      messageId: '<a@b>',
      from: '"Cliente" <c@d>',
      to: 'compras@mwt.one, ventas@x.example',
      cc: 'logistica@x.example',
      subject: 'Orden de compra',
      date: 'hoy',
      references: '<z@y>',
      seen: true,
    }])
    // A message without the flag is unread, and the list says so.
    const unread = messagesOf([`* 1 FETCH (UID 7 FLAGS () BODY[HEADER.FIELDS (...)] {${String(header.length)}}\r\n${header})`])
    expect(unread[0]?.seen).toBe(false)
    expect(headerValue('Subject: uno\nSubject: dos', 'subject')).toBe('uno')
    expect(headerValue('X: y', 'subject')).toBeNull()
  })

  it('searches the owner mailbox from the chat, newest first, without touching the cursor', async () => {
    const log: string[] = []
    const messages: FakeMessage[] = [
      { uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' },
      { uid: 11, messageId: 'oc-2@eguisa.example', from: 'otro@eguisa.example', subject: 'Orden de compra 4712', seen: true },
      { uid: 12, messageId: 'aviso@example', from: 'avisos@mwt.one', subject: 'Aviso de sistema' },
    ]
    const fake = await fakeServer(messages, log)
    servers.push(fake.server)

    const { connections, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })

    const found = await inbound.searchMailbox(OWNER, 'compra', 10)
    expect(found.messages.map(message => message.uid)).toEqual([12, 11, 10])
    expect(found.complete).toBe(true)
    expect(found.connectionId).toBeTypeOf('string')
    expect(log.some(command => /^UID SEARCH CHARSET UTF-8 TEXT "compra"$/.test(command))).toBe(true)
    // The list the panel paints needs the flag: asking for it is what makes
    // read and unread distinguishable without writing to the mailbox.
    expect(log.some(command => /^UID FETCH .*FLAGS BODY\.PEEK/.test(command))).toBe(true)
    expect(found.messages.find(message => message.uid === 11)?.seen).toBe(true)
    expect(found.messages.find(message => message.uid === 10)?.seen).toBe(false)

    // An empty query lists the newest envelopes, limited.
    const newest = await inbound.searchMailbox(OWNER, '', 2)
    expect(newest.messages.map(message => message.uid)).toEqual([12, 11])
    expect(newest.matched).toBe(3)
    expect(log.some(command => /^UID SEARCH ALL$/.test(command))).toBe(true)

    // Searching never advances the receiver's cursor: its first view still
    // fixes the baseline at the top, and mail after it is read.
    expect((await inbound.runOnce()).read).toBe(0)
    messages.push({ uid: 13, messageId: 'nuevo@example', from: 'avisos@mwt.one', subject: 'Aviso nuevo' })
    expect((await inbound.runOnce()).read).toBe(1)
  })

  it('fails loud when the chat search has no mailbox configured', async () => {
    const { inbound } = await harness()
    await expect(inbound.searchMailbox(OWNER, 'compra')).rejects.toThrow('no hay un buzón IMAP configurado')
  })

  it('T17 · a fallback search states the window it scanned instead of claiming exhaustiveness', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 1, messageId: 'old@x', from: 'a@x', subject: 'Marcador viejo' },
      { uid: 2, messageId: 'mid@x', from: 'b@x', subject: 'Otro asunto' },
      { uid: 3, messageId: 'new@x', from: 'c@x', subject: 'Reciente' },
    ], log, null, true)
    servers.push(fake.server)

    const found = await searchMessages({
      host: '127.0.0.1', port: fake.port, secure: false, starttls: false,
      user: 'u', password: 's', mailbox: 'INBOX',
      query: 'Marcador', maxMessages: 10, scanMessages: 2, timeoutMs: 2_000,
    })

    // The server refused the text search; the window of two misses the oldest.
    expect(found.messages).toEqual([])
    expect(found.complete).toBe(false)
    expect(found.total).toBe(3)
    expect(found.scanned).toBe(2)
    expect(log.some(command => /UID SEARCH CHARSET/u.test(command))).toBe(true)
    expect(log.some(command => /^UID SEARCH ALL$/u.test(command))).toBe(true)
  })
})
