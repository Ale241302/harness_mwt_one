/** The Sent copy uses IMAP APPEND with a literal; this spec observes the bytes. */
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { appendMessage } from '../src/imap.ts'

/** Fake IMAP: greeting, LOGIN, LIST, APPEND literal, LOGOUT. */
function fakeImap(record: { message?: string }): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.write('* OK fake IMAP ready\r\n')
    let buffer = Buffer.alloc(0)
    let literalSize: number | null = null
    let literal = Buffer.alloc(0)
    let appendTag = ''
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (literalSize !== null) {
        literal = Buffer.concat([literal, buffer])
        buffer = Buffer.alloc(0)
        if (literal.length < literalSize + 2) return
        record.message = literal.subarray(0, literalSize).toString('utf8')
        literalSize = null
        socket.write(`${appendTag} OK APPEND completed\r\n`)
        return
      }
      for (;;) {
        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const line = buffer.subarray(0, end).toString('utf8')
        buffer = buffer.subarray(end + 2)
        const [tag = '', ...rest] = line.split(' ')
        const command = rest.join(' ')
        if (/^LOGIN/i.test(command)) socket.write(`${tag} OK LOGIN completed\r\n`)
        else if (/^LIST/i.test(command)) socket.write(`* LIST (\\Sent) "/" "Sent"\r\n${tag} OK LIST completed\r\n`)
        else if (/^APPEND/i.test(command)) {
          const size = /\{(\d+)\}$/.exec(line)?.[1]
          appendTag = tag
          literalSize = Number(size ?? 0)
          socket.write('+ Ready for literal data\r\n')
        } else if (/^LOGOUT/i.test(command)) { socket.write(`${tag} OK LOGOUT completed\r\n`); socket.end() }
        else socket.write(`${tag} BAD unknown\r\n`)
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

describe('appendMessage', () => {
  it('writes the exact message into the sent mailbox', async () => {
    const record: { message?: string } = {}
    const fake = await fakeImap(record)
    const message = 'From: 506@muitowork.com\r\nTo: cliente@eguisa.example\r\nSubject: OC 4711\r\n\r\nCuerpo enviado.\r\n'
    await appendMessage({
      host: '127.0.0.1', port: fake.port, secure: false, starttls: false,
      user: '506@muitowork.com', password: 'secreta', mailbox: 'Sent',
      since: null, maxMessages: 1, timeoutMs: 5_000,
    }, message)
    expect(record.message).toBe(message)
  })
})
