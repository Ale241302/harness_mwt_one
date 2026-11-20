/**
 * O7-02 · the owner's mailbox writes.
 *
 * A fake IMAP server observes the commands: mark read and unread travel as
 * `UID STORE ±FLAGS`, a move as `UID MOVE` (with the COPY/EXPUNGE fallback),
 * and restore copies the message from Trash back to the inbox. The tools keep
 * refusing, so the agent still never mutates a mailbox on its own.
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
import FaberLoomInbound, { MIN_INTERVAL_MS } from '../src/index.ts'

const OWNER = 'compras2@sondelsa.com'

interface FakeOptions {
  /** Folders the server advertises, with their role. */
  readonly folders?: readonly { name: string; role: string | null }[]
  /** Whether `UID MOVE` works; false exercises the COPY fallback. */
  readonly move?: boolean
}

/** A minimal IMAP server that records every command it receives. */
function fakeServer(log: string[], options: FakeOptions = {}): Promise<{ server: Server; port: number }> {
  const folders = options.folders ?? [
    { name: 'INBOX', role: '\\Inbox' },
    { name: 'Sent', role: '\\Sent' },
    { name: 'Trash', role: '\\Trash' },
    { name: 'INBOX.Archivo', role: null },
  ]
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
        else if (/^SELECT/i.test(command)) socket.write(`* 3 EXISTS\r\n${String(tag)} OK [READ-WRITE] SELECT completed\r\n`)
        else if (/^LIST/i.test(command)) {
          const rows = folders.map(folder => `* LIST (${folder.role ?? ''}) "/" "${folder.name}"\r\n`).join('')
          socket.write(`${rows}${String(tag)} OK LIST completed\r\n`)
        } else if (/^UID MOVE/i.test(command)) {
          socket.write(options.move === false ? `${String(tag)} BAD unknown command\r\n` : `${String(tag)} OK MOVE completed\r\n`)
        } else if (/^UID STORE/i.test(command) || /^UID COPY/i.test(command) || /^UID EXPUNGE/i.test(command)
          || /^EXPUNGE/i.test(command)) {
          socket.write(`${String(tag)} OK completed\r\n`)
        } else if (/^LOGOUT/i.test(command)) {
          socket.write(`* BYE bye\r\n${String(tag)} OK LOGOUT completed\r\n`)
          socket.end()
        } else socket.write(`${String(tag)} BAD unknown\r\n`)
      }
    })
  })
  return new Promise((resolve) => {
    servers.push(server)
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

/** Boot the connections, access, routines and inbound services over one IMAP row. */
async function harness(port: number) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomInbound, {
    ownerId: OWNER,
    enabled: false,
    intervalMs: MIN_INTERVAL_MS,
    timeoutMs: 2_000,
  })
  const connection = await ctx.faberloomConnections.save(OWNER, {
    kind: 'imap', label: 'Entrada', host: '127.0.0.1', port, secure: false,
    username: '506@muitowork.com', secret: 'secreta', primary: true,
  })
  return { inbound: ctx.faberloomInbound, connectionId: connection.id }
}

describe('O7 mailbox writes', () => {
  it('marks read and unread in the folder the panel names', async () => {
    const log: string[] = []
    const fake = await fakeServer(log)
    const { inbound, connectionId } = await harness(fake.port)

    await expect(inbound.markSeenFromOwner(OWNER, 5, { connectionId, mailbox: 'INBOX.Archivo' }, true)).resolves.toBe(true)
    expect(log).toContain('UID STORE 5 +FLAGS (\\Seen)')
    await inbound.markSeenFromOwner(OWNER, 5, { connectionId, mailbox: 'INBOX.Archivo' }, false)
    expect(log).toContain('UID STORE 5 -FLAGS (\\Seen)')
    // The SELECT names the folder the message lives in, not the inbox.
    expect(log).toContain('SELECT "INBOX.Archivo"')
  })

  it('moves to Trash, to a named folder, and restores from Trash to the inbox', async () => {
    const log: string[] = []
    const fake = await fakeServer(log)
    const { inbound, connectionId } = await harness(fake.port)

    await expect(inbound.trashFromOwner(OWNER, 9, { connectionId, mailbox: 'INBOX' })).resolves.toBe('Trash')
    expect(log).toContain('UID MOVE 9 "Trash"')

    await expect(inbound.moveFromOwner(OWNER, 9, 'INBOX.Archivo', { connectionId, mailbox: 'INBOX' })).resolves.toBe('INBOX.Archivo')
    expect(log).toContain('UID MOVE 9 "INBOX.Archivo"')

    await expect(inbound.restoreFromOwner(OWNER, 9, { connectionId })).resolves.toBe('INBOX')
    // Restore reads Trash and writes back to the inbox, so the UID is the Trash one.
    expect(log).toContain('SELECT "Trash"')
    expect(log).toContain('UID MOVE 9 "INBOX"')
  })

  it('falls back to COPY + \\Deleted + expunge when the server has no MOVE', async () => {
    const log: string[] = []
    const fake = await fakeServer(log, { move: false })
    const { inbound, connectionId } = await harness(fake.port)

    await expect(inbound.trashFromOwner(OWNER, 4, { connectionId, mailbox: 'INBOX' })).resolves.toBe('Trash')
    expect(log).toContain('UID COPY 4 "Trash"')
    expect(log).toContain('UID STORE 4 +FLAGS (\\Deleted)')
    expect(log.some(command => /^(UID EXPUNGE 4|EXPUNGE)$/u.test(command))).toBe(true)
  })

  it('refuses to trash a message when the server declares no Trash folder', async () => {
    const log: string[] = []
    const fake = await fakeServer(log, { folders: [{ name: 'INBOX', role: '\\Inbox' }] })
    const { inbound, connectionId } = await harness(fake.port)

    await expect(inbound.trashFromOwner(OWNER, 1, { connectionId })).rejects.toThrow(/NO_TRASH_FOLDER/u)
    expect(log.some(command => /^UID MOVE/u.test(command))).toBe(false)
  })

  it('keeps the agent out of the mailbox: tools and routine steps still refuse', async () => {
    const log: string[] = []
    const fake = await fakeServer(log)
    const { inbound } = await harness(fake.port)
    const before = log.length

    await expect(inbound.markSeen(OWNER, 1)).rejects.toThrow(/WRITE_NOT_APPROVED/u)
    await expect(inbound.moveToTrash(OWNER, 1)).rejects.toThrow(/WRITE_NOT_APPROVED/u)
    expect(log).toHaveLength(before)
  })
})
