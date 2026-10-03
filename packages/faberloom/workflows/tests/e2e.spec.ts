import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomConnections from '../../connections/src/index.ts'
import FaberLoomInbound, { MIN_INTERVAL_MS } from '../../inbound/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import { createWorkflowHandlers } from '../../handlers/src/steps.ts'
import FaberLoomWorkflows from '../src/index.ts'
import type { WorkFlowDefinition, WorkFlowEdge, WorkFlowEdgeId, WorkFlowNode, WorkFlowNodeId, WorkFlowNodeKind } from '../src/index.ts'

const OWNER_ID = 'compras2@sondelsa.com'
const OWNER = { id: OWNER_ID }

const nid = (value: string): WorkFlowNodeId => value as WorkFlowNodeId
const eid = (value: string): WorkFlowEdgeId => value as WorkFlowEdgeId

/** Build one test node of any kind. */
function node(id: string, kind: WorkFlowNodeKind, config: Record<string, unknown>): WorkFlowNode {
  return { id: nid(id), title: id, position: { x: 0, y: 0 }, kind, config } as WorkFlowNode
}

/** Build one test edge. */
function edge(id: string, from: string, to: string): WorkFlowEdge {
  return { id: eid(id), from: nid(from), to: nid(to) }
}

/** The acceptance graph: mark matched mail read and notify by email, once per message. */
const antispam: WorkFlowDefinition = {
  intent: 'limpiar el spam del buzón',
  nodes: [
    node('n1', 'trigger.email', { match: 'Antispam' }),
    node('n2', 'imap.action', { op: 'delete' }),
    node('n3', 'smtp.send', { to: [OWNER_ID], subject: '{{event.subject}}', template: 'spam detectado' }),
  ],
  edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
  permissions: ['email:delete'],
  failurePolicy: 'stop',
}

/** A minimal IMAP server: greeting, LOGIN, SELECT, UID SEARCH/FETCH/STORE/MOVE, LOGOUT. */
function fakeImapServer(
  messages: readonly { uid: number; messageId: string; from: string; subject: string }[],
  log: string[],
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
        else if (/^SELECT/i.test(command)) socket.write(`${String(tag)} OK [READ-WRITE] SELECT completed\r\n`)
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
        } else if (/^UID STORE|^UID MOVE/i.test(command)) socket.write(`${String(tag)} OK completed\r\n`)
        else if (/^LOGOUT/i.test(command)) {
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

/** A minimal plaintext SMTP server; records the DATA bodies. */
function fakeSmtpServer(received: string[]): Promise<{ server: Server; port: number }> {
  const server = createServer((socket: Socket) => {
    socket.write('220 fake SMTP ready\r\n')
    let buffer = ''
    let data = ''
    let inData = false
    let authStep = 0
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let end = buffer.indexOf('\r\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\r\n')
        if (inData) {
          if (line === '.') { inData = false; received.push(data); data = ''; socket.write('250 2.0.0 queued as fake-id\r\n') } else data += `${line}\r\n`
          continue
        }
        if (authStep === 1) { authStep = 2; socket.write('334 UGFzc3dvcmQ6\r\n'); continue }
        if (authStep === 2) { authStep = 0; socket.write('235 2.7.0 authenticated\r\n'); continue }
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

/** Boot the whole product composition over one storage pool, with the offline poller. */
async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomConnections)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomWorkflows)
  await ctx.plugin(FaberLoomInbound, { ownerId: OWNER_ID, enabled: false, intervalMs: MIN_INTERVAL_MS, mailbox: 'INBOX' })
  const routines = ctx.faberloomRoutines
  const handlers = createWorkflowHandlers(ctx)
  routines.registerHandler('imap', handlers['imap']!)
  routines.registerHandler('smtp', handlers['smtp']!)
  return {
    ctx,
    routines,
    access: ctx.faberloomAccess,
    connections: ctx.faberloomConnections,
    inbound: ctx.faberloomInbound,
    workflows: ctx.faberloomWorkflows,
  }
}

describe('Work Flow offline runtime (anti-spam acceptance)', () => {
  it('F2 · marks and notifies a matching message with no user connected, exactly once across a restart', async () => {
    const pool = new MemoryMediaPool()
    const imapLog: string[] = []
    const received: string[] = []
    const imap = await fakeImapServer([{ uid: 10, messageId: 'spam-1@eguisa.example', from: 'spammer@eguisa.example', subject: 'Antispam OC 4711' }], imapLog)
    const smtp = await fakeSmtpServer(received)
    servers.push(imap.server, smtp.server)

    const first = await harness(pool)
    await first.connections.save(OWNER_ID, { kind: 'imap', label: 'Correo', host: '127.0.0.1', port: imap.port, secure: false, username: 'u', secret: 's' })
    await first.connections.save(OWNER_ID, { kind: 'smtp', label: 'Saliente', host: '127.0.0.1', port: smtp.port, secure: false, username: 'u', secret: 's', primary: true })

    const flow = await first.workflows.create(OWNER, { name: 'Antispam', definition: antispam })
    const active = await first.workflows.setStatus(OWNER, flow.id, 'active')
    const routineId = active.routineId as never
    await first.access.grant(OWNER_ID, { action: 'email:delete', context: String(active.routineId) })

    const report = await first.inbound.runOnce()
    expect(report).toMatchObject({ skipped: null, mailbox: 'Correo', read: 1, error: null })

    const executions = await first.routines.listExecutions({ routineId })
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({ status: 'completed' })
    expect(imapLog.some(command => /UID MOVE 10/.test(command))).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('Subject: Antispam OC 4711')

    const second = await harness(pool)
    const again = await second.inbound.runOnce()
    expect(again.read).toBe(0)
    expect(await second.routines.listExecutions({ routineId })).toHaveLength(1)
    expect(received).toHaveLength(1)

    const flowId = flow.id
    expect((await second.workflows.get(OWNER, flowId)).status).toBe('active')
  })
})
