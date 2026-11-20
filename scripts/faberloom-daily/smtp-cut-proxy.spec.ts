import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import {
  createConnection,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net'
import { createServer as createTlsServer } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'

const { createSmtpCutProxy } = createRequire(import.meta.url)('./smtp-cut-proxy.cjs') as {
  createSmtpCutProxy: (options: {
    targetSubject: string
    upstreamHost?: string
    upstreamPort?: number
    rejectUnauthorized?: boolean
    writeLog?: (line: string) => void
  }) => Server
}

const key = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCnW6IIL94xNz/0
ZpaR/tlAu9DdHUkGDI9IoXXiSRqeaLfLnLuD65DLLgFLmJY7OSua9rubqNA2flTp
XUeOWHgN5TUjSyqGrMF9sIbmqwsFfNMz5tBSr7JRmYge+8hVPsEOi8d67QhQJ2v4
612+HmJM8Pr2hSDtIPze39anPtHpMrr0mpe01nYS5Gvd4iGPFHGqie3KG9Z/55K/
gZngDz/mhIlHBEIDEO9tk+moaCwfKfhzAd5+v44iR/1OwwrgAYtRmUYIiglys3XX
ssZvMGAEktzUEDA+WfYUmJitA5+9vBw4V9gjsKQ3w0W1tzLtz8WSPgsAO3ey85Y9
WFc/vuErAgMBAAECggEAMbwVhwFSsqWMqADktjZaMdae11cgoF+TJS52bezzsCfG
lwfY4fdbbEYbtG+AFdGDl+XDExsz5T3d1gwWe8LmyppXFEn+NU+ZoNSZAmvKNrNF
wKLTPf9gqsdJoIuKmWqwzLXVbj6Kvec5OxwXG6zD4cGrkx81DcND4qf6jnEoyHgD
+Bzbbjp3oYsapWauSQ8kOrx8T39kcP4X4sdi+N2y7GFKnaiuryTz4ptskOZYuOE5
iVnTvjEhT8fIekbYw+JM4+eu2J93qgNBITon99f9/AjR8LXV0JF8t18qfiziRPId
jB23JfZ/M3SERl9tENXkndYXenG+bdSvuCLWXXmEwQKBgQDQZQVT6DgVgWi18HRO
h9dNMyWKNRc/zQbGEtCkNbTtLwscRsSstlNzewMd+gIBpGLO6x/rJPPgV2wgTiPQ
vEuGsEzPbrMUqwMYJcgzK6rtmn9Nq9TslLi4oRxn7Rnf5fSI0USvFiyUpQyFAA9f
lEGAMbzjPGMG71vs0FpcXCfMAwKBgQDNlsZ7wPldTu/MomIn/zpxrZcWFUIoYtJh
uGz0MKCEUpNBKkRc/dN5bfliGe822HIPXavVfImzWonxsN7pPUamERIr1OgKQ8k/
FqoMAhAR4bS8aALQv8YvZtDDXuptUx8VqRHAHL3hfVGLaRtLEL/illxi6F7sHdO8
0OiMUHrRuQKBgCLYIVHsTCRcZPO25tuSnw9LdAVt5xtF3tITp0stp7jY2tS5iH0Q
Z1exw82pVdiMcfEDI20f2p8yPuQP7LEkKsS0icNNUSgth/DrsFPOA2CDKrID/zAn
ldNZLPS7kk37ly2hQAi+fmnERxmd7vQeR+11Y43jNPOd5hLsq48x4X2dAoGAb0my
38KyOcRFIqy0HZqXdHnXU2jmix4TbDp9ICJCgd6BP8E1iHEOTKkvWd9YEoRQGelG
3yWvFJtqGJ75y6AT4klTYM67XPMcuT33htCHCmb3gxV6kK1/BqHNWDTFCbD5HqyK
o0frsWg5ABJBZ/0FIg7qq8/FsmLi/07G002tbmECgYA3Rnvm6N7j9B2cJ8uY5iZm
5ims0DbZFgcWKkUyZaK2z2Cnay5us/6CiRSPg7ZD1w9bqHiFNYkXvf6T8kWj/8q2
68dbVgs4chzxpxGQG9PJkHkbTY0G4diOpHi7kKGQiFgzn2cpuFN6w5VVlOHaXE7w
4RmjPlV/1xjcnKic+jmb2g==
-----END PRIVATE KEY-----`

const certificate = `-----BEGIN CERTIFICATE-----
MIIC7DCCAdSgAwIBAgIUIHqLMB3Fsvll7i5PyxO1ASfCwDgwDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTc210cC1jdXQtcHJveHkudGVzdDAeFw0yNjExMTkyMTU1
MTBaFw0zNjExMTcyMTU1MTBaMB4xHDAaBgNVBAMME3NtdHAtY3V0LXByb3h5LnRl
c3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCnW6IIL94xNz/0ZpaR
/tlAu9DdHUkGDI9IoXXiSRqeaLfLnLuD65DLLgFLmJY7OSua9rubqNA2flTpXUeO
WHgN5TUjSyqGrMF9sIbmqwsFfNMz5tBSr7JRmYge+8hVPsEOi8d67QhQJ2v4612+
HmJM8Pr2hSDtIPze39anPtHpMrr0mpe01nYS5Gvd4iGPFHGqie3KG9Z/55K/gZng
Dz/mhIlHBEIDEO9tk+moaCwfKfhzAd5+v44iR/1OwwrgAYtRmUYIiglys3XXssZv
MGAEktzUEDA+WfYUmJitA5+9vBw4V9gjsKQ3w0W1tzLtz8WSPgsAO3ey85Y9WFc/
vuErAgMBAAGjIjAgMB4GA1UdEQQXMBWCE3NtdHAtY3V0LXByb3h5LnRlc3QwDQYJ
KoZIhvcNAQELBQADggEBAJQFbZqo4bpjW8cVHr3pN3c0UkntBa2kLb4PLAa50ubv
JOmoaapaZ/N4G57YVfltse9h25A5DCaJEtSsLQCc1CzGjMH16a0rtckVmeMPshjZ
NWuWawZuft0eZ1yUIUVcsX8qmzdKuHhgWZa7j4CK0oEBAyDZdE/SyEAZK6aiCObG
YFLeMgy0YtqIXJu1Vy9j8gJmJVRX7L6fLIIR/dnn+GXUiUutS5mAZwPe6U2XXVO+
GS23O8WEkRZeih5PDo9JhjpjFTrKw3l5ImTM9z1NrPSPVyj2/SzTEUAqFRhHIJ0S
SRB+eF9uN8E9LAHdbR5Du9+l8LiuELNxyTWSiKn5kqI=
-----END CERTIFICATE-----`

const targetSubject = 'PC4 smoke sintético: corte después de DATA'
const syntheticUser = 'usuario-sintetico@example.test'
const syntheticPassword = 'password-sintetico-no-real'
const authCommand = `AUTH PLAIN ${Buffer.from(`\0${syntheticUser}\0${syntheticPassword}`).toString('base64')}`
const dataTerminator = Buffer.from('\r\n.\r\n')
const servers: Server[] = []
const sockets = new Set<Socket>()

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  for (const server of servers.splice(0).reverse()) {
    if (!server.listening) continue
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
    })
  }
})

async function listen(server: Server): Promise<number> {
  servers.push(server)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

class SmtpClient {
  readonly closed: Promise<void>
  private buffered = ''
  private readonly lines: string[] = []
  private readonly readers: Array<(line: string) => void> = []

  constructor(readonly socket: Socket) {
    socket.on('data', (chunk) => {
      this.buffered += chunk.toString('latin1')
      let end = this.buffered.indexOf('\r\n')
      while (end !== -1) {
        const line = this.buffered.slice(0, end)
        this.buffered = this.buffered.slice(end + 2)
        const reader = this.readers.shift()
        if (reader) reader(line)
        else this.lines.push(line)
        end = this.buffered.indexOf('\r\n')
      }
    })
    socket.on('error', () => {})
    this.closed = new Promise(resolve => socket.once('close', resolve))
  }

  readLine(): Promise<string> {
    const line = this.lines.shift()
    if (line !== undefined) return Promise.resolve(line)
    return new Promise(resolve => this.readers.push(resolve))
  }

  async command(command: string): Promise<string> {
    this.socket.write(`${command}\r\n`)
    return this.readLine()
  }
}

interface UpstreamFixture {
  accepted: Promise<void>
  commands: string[]
  receivedData: Buffer
  server: Server
}

async function startUpstream(): Promise<UpstreamFixture & { port: number }> {
  let markAccepted!: () => void
  const fixture: UpstreamFixture = {
    accepted: new Promise((resolve) => { markAccepted = resolve }),
    commands: [],
    receivedData: Buffer.alloc(0),
    server: createTlsServer({ key, cert: certificate }),
  }
  fixture.server.on('secureConnection', (socket: Socket) => {
    let buffered = Buffer.alloc(0)
    let inData = false
    socket.on('error', () => {})
    socket.write('220 smtp-cut-proxy.test ESMTP synthetic\r\n')
    socket.on('data', (chunk) => {
      if (inData) {
        buffered = Buffer.concat([buffered, chunk])
        const end = buffered.indexOf(dataTerminator)
        if (end === -1) return
        fixture.receivedData = buffered.subarray(0, end + dataTerminator.length)
        buffered = Buffer.alloc(0)
        inData = false
        socket.write('250 2.0.0 synthetic accepted\r\n', markAccepted)
        return
      }
      buffered = Buffer.concat([buffered, chunk])
      let end = buffered.indexOf('\r\n')
      while (end !== -1) {
        const command = buffered.subarray(0, end).toString('latin1')
        buffered = buffered.subarray(end + 2)
        fixture.commands.push(command)
        if (command === 'DATA') {
          inData = true
          socket.write('354 End with CRLF dot CRLF\r\n')
          break
        } else if (command.startsWith('AUTH ')) {
          socket.write('235 2.7.0 synthetic authenticated\r\n')
        } else if (command === 'QUIT') {
          socket.end('221 2.0.0 synthetic bye\r\n')
        } else {
          socket.write('250 2.0.0 synthetic ok\r\n')
        }
        end = buffered.indexOf('\r\n')
      }
    })
  })
  const port = await listen(fixture.server)
  return Object.assign(fixture, { port })
}

async function startMessage(subject: string) {
  const upstream = await startUpstream()
  const logs: string[] = []
  const proxy = createSmtpCutProxy({
    targetSubject,
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.port,
    rejectUnauthorized: false,
    writeLog: line => logs.push(line),
  })
  const proxyPort = await listen(proxy)
  const socket = createConnection({ host: '127.0.0.1', port: proxyPort })
  sockets.add(socket)
  const client = new SmtpClient(socket)
  await once(socket, 'connect')
  expect(await client.readLine()).toBe('220 smtp-cut-proxy.test ESMTP synthetic')
  expect(await client.command('EHLO client.test')).toBe('250 2.0.0 synthetic ok')
  expect(await client.command(authCommand)).toBe('235 2.7.0 synthetic authenticated')
  expect(await client.command('MAIL FROM:<remitente@example.test>')).toBe('250 2.0.0 synthetic ok')
  expect(await client.command('RCPT TO:<destinatario@example.test>')).toBe('250 2.0.0 synthetic ok')
  expect(await client.command('DATA')).toBe('354 End with CRLF dot CRLF')
  const message = [
    'From: remitente@example.test',
    'To: destinatario@example.test',
    `Subject: ${subject}`,
    '',
    'Cuerpo sintético que nunca debe registrarse.',
    '.',
    '',
  ].join('\r\n')
  let afterData = ''
  socket.on('data', (chunk) => { afterData += chunk.toString('latin1') })
  socket.write(message)
  return { afterData: () => afterData, client, logs, message, socket, upstream }
}

describe('smtp-cut-proxy', () => {
  it('control positivo: un Subject no exacto recibe el 250 final y no registra secretos', async () => {
    const fixture = await startMessage(`${targetSubject} pero no coincide`)
    expect(await fixture.client.readLine()).toBe('250 2.0.0 synthetic accepted')
    expect(fixture.upstream.receivedData.toString()).toBe(fixture.message)
    expect(fixture.upstream.commands).toContain(authCommand)
    expect(fixture.logs).toEqual([])
    expect(fixture.afterData()).toBe('250 2.0.0 synthetic accepted\r\n')
  })

  it('control negativo: el Subject exacto entrega DATA completo, upstream responde 250 y el cliente queda sin respuesta', async () => {
    const fixture = await startMessage(targetSubject)
    await fixture.upstream.accepted
    await fixture.client.closed
    expect(fixture.upstream.receivedData.toString()).toBe(fixture.message)
    expect(fixture.upstream.commands).toContain(authCommand)
    expect(fixture.afterData()).toBe('')
    expect(fixture.logs).toHaveLength(1)
    const record = JSON.parse(fixture.logs[0]!) as Record<string, string>
    expect(Object.keys(record).sort()).toEqual(['action', 'subjectHash', 'timestamp'])
    expect(record.action).toBe('cut_after_data_250')
    expect(record.subjectHash).toBe(createHash('sha256').update(targetSubject, 'utf8').digest('hex'))
    expect(Number.isNaN(Date.parse(record.timestamp!))).toBe(false)
    const logged = fixture.logs.join('\n')
    expect(logged).not.toContain(syntheticUser)
    expect(logged).not.toContain(syntheticPassword)
    expect(logged).not.toContain(authCommand)
    expect(logged).not.toContain(targetSubject)
    expect(logged).not.toContain('destinatario@example.test')
    expect(logged).not.toContain('Cuerpo sintético')
  })
})
