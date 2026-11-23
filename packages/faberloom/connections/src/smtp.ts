/**
 * Minimal SMTP sending: enough to verify an outgoing server and to deliver a
 * message with Cc/Bcc, thread headers, file attachments, and an HTML
 * alternative whose inline images travel as related parts. It speaks the
 * reply-code subset the sender needs — greeting, `EHLO`, optional `STARTTLS`,
 * `AUTH LOGIN`, `MAIL FROM`, `RCPT TO`, `DATA`, `QUIT` — over `node:tls` or
 * `node:net`. The body is UTF-8 text sent base64; attachments travel as a
 * `multipart/mixed` body.
 * @module @deepseek-ai/dsh-faberloom-connections/smtp
 */

import { randomUUID } from 'node:crypto'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { extractInlineImages } from './signature.ts'
import type { ConnectionProbe, OutgoingMail, SmtpCredentials } from './types.ts'

/** Raised when the server answers with an unexpected reply code. */
export class SmtpError extends Error {
  /** @param message - human-readable failure. */
  constructor(message: string) {
    super(message)
    this.name = 'SmtpError'
  }
}

/**
 * A delivery failure that states whether the message may have left: a failure
 * before `DATA` never sent; a failure after the server accepted `DATA` may have.
 */
export class SmtpDeliveryError extends Error {
  /**
   * @param message - human-readable failure.
   * @param mayHaveSent - whether the transport may have accepted the message.
   */
  constructor(message: string, readonly mayHaveSent: boolean) {
    super(message)
    this.name = 'SmtpDeliveryError'
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
  async command(line: string, code: number, step?: string): Promise<Reply> {
    if (this.closed) throw new SmtpError('conexión cerrada')
    this.socket.write(`${line}\r\n`)
    return await this.expect(code, step ?? line.split(' ')[0] ?? line)
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
  // The step names are explicit: the default is the line's first token, and for
  // an AUTH exchange that token is the base64 credential. A rejected login must
  // never carry the secret into an error or a log.
  await session.command('AUTH LOGIN', 334, 'AUTH LOGIN')
  await session.command(Buffer.from(user, 'utf8').toString('base64'), 334, 'AUTH usuario')
  await session.command(Buffer.from(password, 'utf8').toString('base64'), 235, 'AUTH contraseña')
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

/** Normalize one `Message-ID` to its angle-bracketed form. */
function messageIdValue(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`
}

/** Encode one UTF-8 body as base64 with CRLF breaks every 76 characters. */
function encoded(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
}

/**
 * One `text/html` part, wrapping its inline images in `multipart/related` when
 * the markup carried any `data:image` source.
 * @param html - the HTML alternative.
 * @returns the part block, headers included.
 */
function htmlPart(html: string): string {
  const { html: markup, images } = extractInlineImages(html, () => randomUUID())
  const head = ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded(markup)]
  if (images.length === 0) return head.join('\r\n')
  const boundary = `faberloom-related-${randomUUID()}`
  const parts = [
    `--${boundary}`,
    ...head,
    ...images.flatMap(image => [
      `--${boundary}`,
      `Content-Type: ${image.mediaType}`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${image.id}>`,
      'Content-Disposition: inline',
      '',
      image.contentBase64.replace(/.{76}/g, '$&\r\n'),
    ]),
    `--${boundary}--`,
    '',
  ]
  return [`Content-Type: multipart/related; boundary="${boundary}"`, '', ...parts].join('\r\n')
}

/** Build the RFC 5322 message: headers, blank line, base64 body. */
function buildMessage(mail: OutgoingMail, from: string, messageId: string): string {
  const inReplyTo = mail.inReplyTo === undefined || mail.inReplyTo === null || mail.inReplyTo.trim().length === 0
    ? null
    : messageIdValue(mail.inReplyTo)
  const references = (mail.references ?? []).filter(value => value.trim().length > 0).map(messageIdValue)
  if (inReplyTo !== null && references.length === 0) references.push(inReplyTo)
  const headers = [
    `From: ${headerValue(from)}`,
    `To: ${mail.to.map(headerValue).join(', ')}`,
    ...(mail.cc ?? []).length === 0 ? [] : [`Cc: ${(mail.cc ?? []).map(headerValue).join(', ')}`],
    `Subject: ${headerValue(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...inReplyTo === null ? [] : [`In-Reply-To: ${inReplyTo}`],
    ...references.length === 0 ? [] : [`References: ${references.join(' ')}`],
    'MIME-Version: 1.0',
  ]
  const text = encoded(mail.text)
  const attachments = mail.attachments ?? []
  const html = mail.html?.trim() ?? ''
  // Without an HTML alternative the message keeps its plain-text shape.
  const alternative = html.length === 0
    ? null
    : (() => {
      const boundary = `faberloom-alt-${randomUUID()}`
      return [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        text,
        `--${boundary}`,
        htmlPart(html),
        `--${boundary}--`,
        '',
      ].join('\r\n')
    })()
  if (alternative === null && attachments.length === 0) {
    const plain = [
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ]
    return `${[...headers, ...plain].join('\r\n')}\r\n\r\n${text}`
  }
  if (attachments.length === 0 && alternative !== null) {
    return [...headers, alternative].join('\r\n')
  }
  // One multipart body: the message first, then one part per attachment. The
  // filename parameter follows RFC 2231 when the name is not printable ASCII.
  const boundary = `faberloom-${randomUUID()}`
  const parts: string[] = alternative === null
    ? [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      text,
    ]
    : [`--${boundary}`, alternative]
  for (const attachment of attachments) {
    const name = attachment.name.replace(/[\r\n"]/g, '_')
    const disposition = /^[\x20-\x7e]*$/u.test(name)
      ? `filename="${name}"`
      : `filename*=UTF-8''${encodeURIComponent(name)}`
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mediaType.replace(/[\r\n]/g, '')}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${disposition}`,
      '',
      attachment.contentBase64.replace(/.{76}/g, '$&\r\n'),
    )
  }
  parts.push(`--${boundary}--`, '')
  return `${[...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n')}\r\n\r\n${parts.join('\r\n')}`
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
): Promise<{ messageId: string; accepted: readonly string[]; raw: string }> {
  const from = mail.from ?? credentials.username
  // The envelope is line-oriented: a CR/LF or an angle bracket in an address
  // would inject a second command, so the sender refuses it before writing.
  const envelopeSafe = (value: string): boolean => !/[\r\n<>]/u.test(value)
  if (!envelopeSafe(from)) throw new Error('faberloom: el remitente SMTP contiene caracteres no válidos')
  const recipients = [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])]
  for (const recipient of recipients) {
    if (!envelopeSafe(recipient)) throw new Error('faberloom: un destinatario SMTP contiene caracteres no válidos')
  }
  const messageId = `<${randomUUID()}@faberloom.local>`
  const session = await SmtpSession.open({ ...credentials, timeoutMs })
  // The envelope is accepted before DATA; a failure after DATA is ambiguous.
  let mayHaveSent = false
  try {
    await authenticate(session, credentials.username, credentials.password)
    await session.command(`MAIL FROM:<${from}>`, 250)
    const accepted: string[] = []
    for (const recipient of recipients) {
      await session.command(`RCPT TO:<${recipient}>`, 250)
      accepted.push(recipient)
    }
    await session.command('DATA', 354)
    mayHaveSent = true
    // Dot-stuffing: a body line that starts with '.' gets one more, so the
    // terminator line is unambiguous.
    const raw = buildMessage(mail, from, messageId)
    const stuffed = raw.split('\r\n').map(line => line.startsWith('.') ? `.${line}` : line).join('\r\n')
    session.writeRaw(`${stuffed}\r\n.\r\n`)
    await session.expect(250, 'DATA')
    try { await session.command('QUIT', 221) } catch { /* many servers drop the session instead */ }
    return { messageId, accepted, raw }
  } catch (error) {
    if (error instanceof SmtpDeliveryError) throw error
    throw new SmtpDeliveryError(error instanceof Error ? error.message : String(error), mayHaveSent)
  } finally {
    session.close()
  }
}
