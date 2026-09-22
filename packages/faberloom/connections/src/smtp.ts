/**
 * Minimal SMTP sending: enough to verify an outgoing server and to deliver a
 * plain-text message. It speaks the reply-code subset the sender needs —
 * greeting, `EHLO`, optional `STARTTLS`, `AUTH LOGIN`, `MAIL FROM`, `RCPT TO`,
 * `DATA`, `QUIT` — over `node:tls` or `node:net`. There is no MIME multipart:
 * the body is UTF-8 text sent base64 so any relay preserves it.
 * @module @deepseek-ai/dsh-faberloom-connections/smtp
 */

import { randomUUID } from 'node:crypto'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type { ConnectionProbe, OutgoingMail, SmtpCredentials } from './types.ts'

/** Raised when the server answers with an unexpected reply code. */
export class SmtpError extends Error {
  /** @param message - human-readable failure. */
  constructor(message: string) {
    super(message)
    this.name = 'SmtpError'
  }
}

/** One server reply: the three-digit code and the complete text. */
interface Reply {
  readonly code: number
  readonly text: string
}

/** The protocol state: one socket, one accumulation buffer, one reply at a time. */
class SmtpSession {
  private buffer = ''
  private pending: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | undefined
  private closed = false
  private onData: (chunk: Buffer) => void = () => { /* replaced once a socket is wired */ }

  private constructor(private socket: Socket) {}

  /**
   * Open a session, read the greeting, and say `EHLO`; upgrades with STARTTLS
   * when asked and greets again on the encrypted socket.
   * @param options - how to reach the server.
   * @param options.host - server host.
   * @param options.port - server port.
   * @param options.secure - whether the connection starts TLS immediately (465).
   * @param options.starttls - whether the connection upgrades after the greeting (587).
   * @param options.timeoutMs - milliseconds before the connection is abandoned.
   * @returns the connected session.
   */
  static async open(options: {
    readonly host: string
    readonly port: number
    readonly secure: boolean
    readonly starttls: boolean
    readonly timeoutMs: number
  }): Promise<SmtpSession> {
    const first = options.secure
      ? connectTls({ host: options.host, port: options.port, servername: options.host })
      : connectTcp({ host: options.host, port: options.port })
    const session = new SmtpSession(first)
    await session.waitConnected(first, options.timeoutMs)
    await session.expect(220, 'saludo')
    await session.command('EHLO faberloom.local', 250)
    if (options.starttls) {
      await session.command('STARTTLS', 220)
      await session.upgrade(options.host, options.timeoutMs)
      await session.command('EHLO faberloom.local', 250)
    }
    return session
  }

  /**
   * Attach this session to one socket and wait for the TCP connection.
   * @param socket - the socket to read from.
   * @param timeoutMs - milliseconds before the connection is abandoned.
   */
  private waitConnected(socket: Socket, timeoutMs: number): Promise<void> {
    this.socket = socket
    const onData = (chunk: Buffer): void => { this.consume(chunk.toString('utf8')) }
    this.onData = onData
    socket.setTimeout(timeoutMs, () => { this.fail(new SmtpError('tiempo de espera agotado')) })
    return new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.off('error', reject)
        socket.on('error', (error: Error) => { this.fail(error) })
        socket.on('close', () => { this.closed = true; this.fail(new SmtpError('conexión cerrada')) })
        socket.on('data', onData)
        resolve()
      })
    })
  }

  /**
   * Continue the session on a TLS layer over the current socket.
   * @param host - server name used to validate the certificate.
   * @param timeoutMs - milliseconds before the handshake is abandoned.
   */
  private upgrade(host: string, timeoutMs: number): Promise<void> {
    const plain = this.socket
    plain.off('data', this.onData)
    plain.setTimeout(0)
    const encrypted = connectTls({ socket: plain, servername: host })
    this.socket = encrypted
    const onData = (chunk: Buffer): void => { this.consume(chunk.toString('utf8')) }
    this.onData = onData
    encrypted.setTimeout(timeoutMs, () => { this.fail(new SmtpError('tiempo de espera agotado')) })
    return new Promise<void>((resolve, reject) => {
      encrypted.once('secureConnect', () => {
        encrypted.off('error', reject)
        encrypted.on('error', (error: Error) => { this.fail(error) })
        encrypted.on('close', () => { this.closed = true; this.fail(new SmtpError('conexión cerrada')) })
        encrypted.on('data', onData)
        resolve()
      })
      encrypted.once('error', reject)
    })
  }

  /** Wait for the next reply and require one code, naming the step on failure. */
  async expect(code: number, step: string): Promise<Reply> {
    const reply = await this.nextReply()
    if (reply.code !== code) throw new SmtpError(`${step}: el servidor respondió ${String(reply.code)} ${reply.text}`)
    return reply
  }

  /**
   * Write raw bytes outside the one-line command discipline (the DATA body).
   * @param data - the exact bytes to send.
   */
  writeRaw(data: string): void {
    if (this.closed) throw new SmtpError('conexión cerrada')
    this.socket.write(data)
  }

  /**
   * Send one command line and require one reply code.
   * @param line - the command text.
   * @param code - the expected reply code.
   * @returns the server reply.
   */
  async command(line: string, code: number): Promise<Reply> {
    if (this.closed) throw new SmtpError('conexión cerrada')
    this.socket.write(`${line}\r\n`)
    return await this.expect(code, line.split(' ')[0] ?? line)
  }

  /** Resolve with the next complete reply (multiline replies joined). */
  private nextReply(): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { resolve, reject }
      this.drain()
    })
  }

  /** Append bytes and settle the pending read when a complete reply arrived. */
  private consume(chunk: string): void {
    this.buffer += chunk
    this.drain()
  }

  /** Settle the pending read when the buffer holds a complete reply. */
  private drain(): void {
    const pending = this.pending
    if (pending === undefined) return
    const lines = this.buffer.split('\r\n')
    // A reply ends at the first line `<code><space>`; `<code>-` continues it.
    let code: number | null = null
    for (const line of lines) {
      const match = /^(\d{3})([ -])/.exec(line)
      if (match === null) continue
      code = Number(match[1])
      if (match[2] === ' ') {
        this.pending = undefined
        this.buffer = this.buffer.slice(this.buffer.indexOf(line) + line.length + 2)
        pending.resolve({ code, text: lines.filter(entry => entry.startsWith(String(code))).join(' | ') })
        return
      }
    }
    if (this.buffer.length > 64 * 1024) {
      this.pending = undefined
      this.buffer = ''
      pending.reject(new SmtpError('respuesta del servidor demasiado larga'))
    }
  }

  /** Reject the pending read and stop using the socket. */
  private fail(error: Error): void {
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined) pending.reject(error)
  }

  /** Close the session. */
  close(): void {
    this.closed = true
    try { this.socket.destroy() } catch { /* the socket may already be gone */ }
  }
}

/** Log in with `AUTH LOGIN` (base64 user, base64 password). */
async function authenticate(session: SmtpSession, user: string, password: string): Promise<void> {
  await session.command('AUTH LOGIN', 334)
  await session.command(Buffer.from(user, 'utf8').toString('base64'), 334)
  await session.command(Buffer.from(password, 'utf8').toString('base64'), 235)
}

/**
 * Verify an outgoing server for real: greet, authenticate, and leave without
 * sending anything.
 * @param credentials - how to reach and log in to the server.
 * @param timeoutMs - milliseconds before the attempt is abandoned.
 * @returns the probe outcome.
 */
export async function probeSmtp(credentials: SmtpCredentials, timeoutMs = 8000): Promise<ConnectionProbe> {
  const insecure = !credentials.secure && !credentials.starttls
  try {
    const session = await SmtpSession.open({ ...credentials, timeoutMs })
    try {
      await authenticate(session, credentials.username, credentials.password)
    } finally {
      session.close()
    }
    return { ok: true, detail: insecure ? 'inicio de sesión SMTP correcto (sin cifrado)' : 'inicio de sesión SMTP correcto' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Encode one header value per RFC 2047 when it is not plain ASCII. */
function headerValue(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** Build the RFC 5322 message: headers, blank line, base64 body. */
function buildMessage(mail: OutgoingMail, from: string, messageId: string): string {
  const headers = [
    `From: ${headerValue(from)}`,
    `To: ${mail.to.map(headerValue).join(', ')}`,
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  const body = Buffer.from(mail.text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
  return `${headers.join('\r\n')}\r\n\r\n${body}`
}

/**
 * Deliver one plain-text message through the owner's outgoing server.
 * @param credentials - how to reach and log in to the server.
 * @param mail - the message; an omitted `from` sends as the account name.
 * @param timeoutMs - milliseconds before the attempt is abandoned.
 * @returns the generated `Message-ID` and the accepted recipients.
 */
export async function sendSmtp(
  credentials: SmtpCredentials,
  mail: OutgoingMail,
  timeoutMs = 15_000,
): Promise<{ messageId: string; accepted: readonly string[] }> {
  const from = mail.from ?? credentials.username
  const messageId = `<${randomUUID()}@faberloom.local>`
  const session = await SmtpSession.open({ ...credentials, timeoutMs })
  try {
    await authenticate(session, credentials.username, credentials.password)
    await session.command(`MAIL FROM:<${from}>`, 250)
    const accepted: string[] = []
    for (const recipient of mail.to) {
      await session.command(`RCPT TO:<${recipient}>`, 250)
      accepted.push(recipient)
    }
    await session.command('DATA', 354)
    // Dot-stuffing: a body line that starts with '.' gets one more, so the
    // terminator line is unambiguous.
    const stuffed = buildMessage(mail, from, messageId).split('\r\n').map(line => line.startsWith('.') ? `.${line}` : line).join('\r\n')
    session.writeRaw(`${stuffed}\r\n.\r\n`)
    await session.expect(250, 'DATA')
    try { await session.command('QUIT', 221) } catch { /* many servers drop the session instead */ }
    return { messageId, accepted }
  } finally {
    session.close()
  }
}
