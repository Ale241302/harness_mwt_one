import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomConnections from '../src/index.ts'

/** Boot the real storage/domain composition plus the connections service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  return { ctx, connections: ctx.faberloomConnections }
}

/** A minimal plaintext SMTP server; rejects the password "bad" and records the DATA bodies. */
function fakeSmtpServer(received: string[]): Promise<{ server: Server; port: number }> {
  const server = createServer((socket: Socket) => {
    socket.write('220 fake SMTP ready\r\n')
    let buffer = ''
    let data = ''
    let inData = false
    // AUTH LOGIN dialogue position: 1 = waiting for the user, 2 = the password.
    let authStep = 0
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let end = buffer.indexOf('\r\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\r\n')
        if (inData) {
          if (line === '.') {
            inData = false
            received.push(data)
            data = ''
            socket.write('250 2.0.0 queued as fake-id\r\n')
          } else data += `${line}\r\n`
          continue
        }
        if (authStep === 1) {
          authStep = 2
          socket.write('334 UGFzc3dvcmQ6\r\n')
          continue
        }
        if (authStep === 2) {
          authStep = 0
          const password = Buffer.from(line, 'base64').toString('utf8')
          socket.write(password === 'bad' ? '535 5.7.8 bad credentials\r\n' : '235 2.7.0 authenticated\r\n')
          continue
        }
        if (/^EHLO/i.test(line)) socket.write('250-fake greets you\r\n250 AUTH LOGIN\r\n')
        else if (/^AUTH LOGIN$/i.test(line)) { authStep = 1; socket.write('334 VXNlcm5hbWU6\r\n') }
        else if (/^MAIL FROM/i.test(line)) socket.write('250 2.1.0 sender ok\r\n')
        else if (/^RCPT TO/i.test(line)) socket.write('250 2.1.5 recipient ok\r\n')
        else if (/^DATA$/i.test(line)) { inData = true; socket.write('354 end with <CR><LF>.<CR><LF>\r\n') }
        else if (/^QUIT/i.test(line)) { socket.write('221 2.0.0 bye\r\n'); socket.end() }
        else socket.write('502 5.5.2 command not recognized\r\n')
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

describe('FaberLoomConnections', () => {
  it('stores several mailboxes per owner with their encryption mode', async () => {
    const { connections } = await harness()
    const first = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Personal', host: 'imap.example.com', port: 993, secure: true, starttls: false, username: 'a@example.com', secret: 'one',
    })
    const second = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Trabajo', host: 'imap.hostinger.com', port: 143, secure: false, starttls: true, username: 'b@example.com', secret: 'two',
    })
    const rows = await connections.list('owner@example.com')
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.id === first.id)).toMatchObject({ secure: true, starttls: false, primary: false })
    expect(rows.find(row => row.id === second.id)).toMatchObject({ secure: false, starttls: true })
    // The browser never receives the stored password.
    expect(JSON.stringify(rows)).not.toContain('one')
  })

  it('keeps one primary mailbox and hands its credentials to the receiver', async () => {
    const { connections } = await harness()
    const first = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Personal', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one', primary: true,
    })
    const second = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Trabajo', host: 'imap.hostinger.com', port: 143, starttls: true, username: 'b@example.com', secret: 'two', primary: true,
    })
    const rows = await connections.list('owner@example.com')
    expect(rows.find(row => row.id === first.id)?.primary).toBe(false)
    expect(rows.find(row => row.id === second.id)?.primary).toBe(true)

    const chosen = await connections.imap('owner@example.com')
    expect(chosen).toMatchObject({ id: second.id, host: 'imap.hostinger.com', port: 143, secure: false, starttls: true, username: 'b@example.com', password: 'two' })
    // An explicit id still wins over the flag.
    expect(await connections.imap('owner@example.com', first.id)).toMatchObject({ id: first.id, password: 'one' })
    // Another owner sees nothing.
    expect(await connections.imap('other@example.com')).toBeUndefined()
  })

  it('falls back to the first complete mailbox when none is flagged', async () => {
    const { connections } = await harness()
    const incomplete = await connections.save('owner@example.com', { kind: 'imap', label: 'Sin secreto', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com' })
    expect(await connections.imap('owner@example.com')).toBeUndefined()
    const complete = await connections.save('owner@example.com', { kind: 'imap', label: 'Completo', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one' })
    expect(await connections.imap('owner@example.com')).toMatchObject({ id: complete.id, secure: true, starttls: false })
    expect(incomplete.id).not.toBe(complete.id)
  })

  it('refuses to probe an incomplete mailbox without touching the network', async () => {
    const { connections } = await harness()
    const row = await connections.save('owner@example.com', { kind: 'imap', label: 'A medias', host: 'imap.example.com', username: 'a@example.com' })
    expect(await connections.probe('owner@example.com', row.id)).toEqual({ ok: false, detail: 'faltan host, puerto, usuario o contraseña' })
    expect(await connections.probe('owner@example.com', 'missing')).toEqual({ ok: false, detail: 'conexión no encontrada' })
  })

  it('keeps one primary row per kind: an SMTP default never clears the mailbox', async () => {
    const { connections } = await harness()
    const imap = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Buzón', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one', primary: true,
    })
    const smtp = await connections.save('owner@example.com', {
      kind: 'smtp', label: 'Saliente', host: 'smtp.example.com', port: 465, secure: true, username: 'a@example.com', secret: 'two', primary: true,
    })
    const rows = await connections.list('owner@example.com')
    expect(rows.find(row => row.id === imap.id)?.primary).toBe(true)
    expect(rows.find(row => row.id === smtp.id)?.primary).toBe(true)
    expect(await connections.imap('owner@example.com')).toMatchObject({ id: imap.id, password: 'one' })
    expect(await connections.smtp('owner@example.com')).toMatchObject({ id: smtp.id, password: 'two' })
    // The browser never receives the stored password of either kind.
    expect(JSON.stringify(rows)).not.toContain('two')
  })

  it('probes an SMTP server for real and reports rejected credentials', async () => {
    const received: string[] = []
    const fake = await fakeSmtpServer(received)
    servers.push(fake.server)
    const { connections } = await harness()
    const good = await connections.save('owner@example.com', {
      kind: 'smtp', label: 'Saliente', host: '127.0.0.1', port: fake.port, secure: false, username: 'a@example.com', secret: 'secreta',
    })
    const probe = await connections.probe('owner@example.com', good.id)
    expect(probe).toEqual({ ok: true, detail: 'inicio de sesión SMTP correcto (sin cifrado)' })

    const bad = await connections.save('owner@example.com', {
      kind: 'smtp', label: 'Mala', host: '127.0.0.1', port: fake.port, secure: false, username: 'a@example.com', secret: 'bad',
    })
    const rejected = await connections.probe('owner@example.com', bad.id)
    expect(rejected.ok).toBe(false)
    expect(rejected.detail).toContain('535')
    // A probe never sends a message.
    expect(received).toHaveLength(0)
  })

  it('delivers a message through the primary SMTP row, UTF-8 subject encoded', async () => {
    const received: string[] = []
    const fake = await fakeSmtpServer(received)
    servers.push(fake.server)
    const { connections } = await harness()
    await connections.save('owner@example.com', {
      kind: 'smtp', label: 'Saliente', host: '127.0.0.1', port: fake.port, secure: false, username: '506@muitowork.com', secret: 'secreta', primary: true,
    })
    const sent = await connections.sendMail('owner@example.com', {
      to: ['cliente@eguisa.example'],
      subject: 'Proforma lista para revisión',
      text: 'Hola,\nla proforma está lista.\n',
    })
    expect(sent.accepted).toEqual(['cliente@eguisa.example'])
    expect(sent.via).toBe('Saliente')
    expect(sent.messageId).toMatch(/^<.+@faberloom\.local>$/)
    expect(received).toHaveLength(1)
    const wire = received[0] ?? ''
    expect(wire).toContain('From: 506@muitowork.com')
    expect(wire).toContain('To: cliente@eguisa.example')
    expect(wire).toContain('Subject: =?UTF-8?B?')
    expect(wire).toContain('Content-Transfer-Encoding: base64')
  })

  it('fails loud when no SMTP server is configured', async () => {
    const { connections } = await harness()
    await expect(connections.sendMail('owner@example.com', { to: ['x@y.z'], subject: 's', text: 't' }))
      .rejects.toThrow('no hay un servidor SMTP configurado')
    const imapOnly = await connections.save('owner@example.com', {
      kind: 'imap', label: 'Buzón', host: 'imap.example.com', port: 993, secure: true, username: 'a@example.com', secret: 'one',
    })
    expect(await connections.smtp('owner@example.com')).toBeUndefined()
    expect(imapOnly.kind).toBe('imap')
  })
})
