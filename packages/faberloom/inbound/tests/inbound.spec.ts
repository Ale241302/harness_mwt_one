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
import FaberLoomInbound, { MIN_INTERVAL_MS } from '../src/index.ts'
import { fetchMessages, headerValue, messagesOf, searchMessages, uidsOf, uidValidityOf } from '../src/imap.ts'

const OWNER = 'compras2@sondelsa.com'

/** One message the fake server will hand out. */
interface FakeMessage {
  readonly uid: number
  readonly messageId: string
  readonly from: string
  readonly subject: string
  /** Whether the mailbox already carries `\Seen`; absent means unread. */
  readonly seen?: boolean
}

/** A minimal IMAP server: greeting, LOGIN, SELECT, UID SEARCH, UID FETCH, LOGOUT. */
function fakeServer(
  messages: readonly FakeMessage[],
  log: string[],
  uidValidity: number | null = null,
  refuseCharset = false,
): Promise<{ server: Server; port: number }> {
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
          const unseen = /UNSEEN/i.test(command)
          const from = Number(/UID (\d+):\*/.exec(command)?.[1] ?? '0')
          const found = messages.filter(message => unseen || message.uid >= from).map(message => message.uid)
          socket.write(`* SEARCH${found.map(uid => ` ${String(uid)}`).join('')}\r\n${String(tag)} OK SEARCH completed\r\n`)
        } else if (/^UID FETCH/i.test(command)) {
          const asked = (/(\d+(?:,\d+)*) \(/.exec(command)?.[1] ?? '').split(',').map(Number)
          for (const uid of asked) {
            const message = messages.find(entry => entry.uid === uid)
            if (message === undefined) continue
            const header = `Message-ID: <${message.messageId}>\r\nFrom: ${message.from}\r\nSubject: ${message.subject}\r\nDate: Tue, 18 Sep 2026 10:00:00 +0000\r\n\r\n`
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

/** Boot storage, connections, routines, and the receiver over one owner pool. */
async function harness(pool = new MemoryMediaPool(), role = '') {
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
  await ctx.plugin(FaberLoomInbound, { ownerId: OWNER, enabled: false, intervalMs: MIN_INTERVAL_MS, mailbox: 'INBOX', role })
  return { ctx, connections: ctx.faberloomConnections, routines: ctx.faberloomRoutines, inbound: ctx.faberloomInbound }
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
    const fake = await fakeServer([
      { uid: 11, messageId: 'oc-2@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4712' },
    ], log)
    servers.push(fake.server)
    vi.stubEnv('FABERLOOM_MIRROR_ENABLED', '1')
    try {
      const { connections, routines, inbound } = await harness()
      await connections.save(OWNER, { kind: 'imap', label: 'Correo Eguisa', host: '127.0.0.1', port: fake.port, secure: false, username: 'compras2', secret: 'secreta' })
      const cloud = { ...emailRoutine('orden de compra'), steps: [{ id: 's1', instruction: 'atiende el correo', handler: 'agent' }] }
      const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: cloud })
      await routines.activateRoutine(OWNER, routine.id)

      const report = await inbound.runOnce()
      expect(report).toMatchObject({ read: 1, error: null })
      expect(report.started).toEqual([])
      expect(await routines.listExecutions({ routineId: routine.id })).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('F07 � turns a new message of the owner mailbox into one routine run', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo Eguisa', host: '127.0.0.1', port: fake.port, secure: false, username: 'compras2', secret: 'secreta' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)

    const report = await inbound.runOnce()
    expect(report).toMatchObject({ skipped: null, mailbox: 'Correo Eguisa', read: 1, error: null })
    expect(report.started).toHaveLength(1)

    const executions = await routines.listExecutions({ routineId: routine.id })
    expect(executions).toHaveLength(1)
    expect(executions[0]?.event).toMatchObject({ type: 'email', subject: 'Orden de compra 4711' })
    expect(executions[0]?.event?.key).toMatch(/^imap:[^:]+:<oc-1@eguisa\.example>$/u)
    expect(log).toContain('UID SEARCH UNSEEN')
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

  it('reads UIDVALIDITY from the SELECT response and ignores a server that omits it', () => {
    expect(uidValidityOf(['* OK [UIDVALIDITY 1700000000] mailbox ready'])).toBe(1_700_000_000)
    expect(uidValidityOf(['* OK [READ-WRITE] SELECT completed'])).toBeNull()
    expect(uidValidityOf(['* OK [UIDVALIDITY not-a-number] x'])).toBeNull()
  })

  it('provisions the Marluvas live routine for a privileged owner of the operations mailbox', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 20, messageId: 'marluvas-1@marluvas.example', from: 'samuel.fernandes@marluvas.com.br', subject: 'Proforma 2500-2026' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness(new MemoryMediaPool(), 'admin')
    await connections.save(OWNER, { kind: 'imap', label: 'Marluvas', host: '127.0.0.1', port: fake.port, secure: false, username: 'alvaro@muitowork.com', secret: 'secreta' })
    await connections.save(OWNER, { kind: 'smtp', label: 'Marluvas SMTP', host: '127.0.0.1', port: 465, secure: true, username: 'alvaro@muitowork.com', secret: 'secreta' })

    await inbound.runOnce()

    const [routine] = (await routines.listRoutines(OWNER)).filter(candidate => candidate.name === 'Vigía de correo')
    expect(routine?.status).toBe('active')
    expect(routine?.definition.intent).toContain('Marluvas')
    expect(routine?.definition.steps.every(step => step.config['agentName'] === 'Operador Marluvas')).toBe(true)
  })

  it('keeps the generic live mail routine for a non-privileged role on the operations mailbox', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 30, messageId: 'marluvas-2@marluvas.example', from: 'samuel.fernandes@marluvas.com.br', subject: 'Proforma 2501-2026' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness(new MemoryMediaPool(), 'manager')
    await connections.save(OWNER, { kind: 'imap', label: 'Marluvas', host: '127.0.0.1', port: fake.port, secure: false, username: 'alvaro@muitowork.com', secret: 'secreta' })
    await connections.save(OWNER, { kind: 'smtp', label: 'Marluvas SMTP', host: '127.0.0.1', port: 465, secure: true, username: 'alvaro@muitowork.com', secret: 'secreta' })

    await inbound.runOnce()

    const [routine] = (await routines.listRoutines(OWNER)).filter(candidate => candidate.name === 'Vigía de correo')
    expect(routine?.definition.intent).toContain('Clasificar')
    expect(routine?.definition.steps.every(step => step.config['agentName'] === undefined)).toBe(true)
  })

  it('F07 � re-reading the mailbox never starts the same message twice', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' },
      { uid: 11, messageId: 'oc-2@eguisa.example', from: 'otro@eguisa.example', subject: 'Orden de compra 4712' },
    ], log)
    servers.push(fake.server)

    const { connections, routines, inbound } = await harness()
    await connections.save(OWNER, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: fake.port, secure: false, username: 'u', secret: 's' })
    const routine = await routines.createRoutine(OWNER, { name: 'Pedidos por correo', definition: emailRoutine('orden de compra') })
    await routines.activateRoutine(OWNER, routine.id)

    expect((await inbound.runOnce()).read).toBe(2)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(2)

    const again = await inbound.runOnce()
    expect(again.read).toBe(0)
    expect(await routines.listExecutions({ routineId: routine.id })).toHaveLength(2)
    expect(log.some(command => /UID SEARCH UID 12:\*/.test(command))).toBe(true)
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
    const header = 'Message-ID: <a@b>\r\nFrom: "Cliente" <c@d>\r\nSubject: Orden\r\n de compra\r\nDate: hoy\r\n\r\n'
    const messages = messagesOf([`* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (...)] {${String(header.length)}}\r\n${header})`])
    expect(messages).toEqual([{ uid: 7, messageId: '<a@b>', from: '"Cliente" <c@d>', subject: 'Orden de compra', date: 'hoy', seen: true }])
    // A message without the flag is unread, and the list says so.
    const unread = messagesOf([`* 1 FETCH (UID 7 FLAGS () BODY[HEADER.FIELDS (...)] {${String(header.length)}}\r\n${header})`])
    expect(unread[0]?.seen).toBe(false)
    expect(headerValue('Subject: uno\nSubject: dos', 'subject')).toBe('uno')
    expect(headerValue('X: y', 'subject')).toBeNull()
  })

  it('searches the owner mailbox from the chat, newest first, without touching the cursor', async () => {
    const log: string[] = []
    const fake = await fakeServer([
      { uid: 10, messageId: 'oc-1@eguisa.example', from: 'cliente@eguisa.example', subject: 'Orden de compra 4711' },
      { uid: 11, messageId: 'oc-2@eguisa.example', from: 'otro@eguisa.example', subject: 'Orden de compra 4712', seen: true },
      { uid: 12, messageId: 'aviso@example', from: 'avisos@mwt.one', subject: 'Aviso de sistema' },
    ], log)
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

    // Searching never advances the receiver's cursor: the poller still reads them.
    expect((await inbound.runOnce()).read).toBe(3)
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
