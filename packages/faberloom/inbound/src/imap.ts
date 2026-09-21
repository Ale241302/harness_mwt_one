/**
 * Minimal IMAP reading: enough to turn a mailbox's new messages into routine
 * events. It speaks the tagged-command subset the receiver needs — greeting,
 * `LOGIN`, `SELECT`, `UID SEARCH`, `UID FETCH` of message headers, `LOGOUT` —
 * over `node:tls` or `node:net`, and never mutates the mailbox: it neither marks
 * messages read nor moves them, so the owner's mail client is unaffected.
 *
 * The fetch asks for header fields only. Decoding message bodies (transfer
 * encodings, multiparts) is deliberately absent: an event carries the envelope,
 * which is what a trigger matches and what a step needs to locate the message.
 * @module @deepseek-ai/dsh-faberloom-inbound/imap
 */

import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'

/** One message envelope the receiver turns into an event. */
export interface ImapMessage {
  /** Mailbox UID, stable for the lifetime of the mailbox. */
  readonly uid: number
  /** `Message-ID` header value, or null when the message carried none. */
  readonly messageId: string | null
  /** `From` header value, or null. */
  readonly from: string | null
  /** `Subject` header value, or null. */
  readonly subject: string | null
  /** `Date` header value, or null. */
  readonly date: string | null
}

/** How to reach one mailbox. */
export interface ImapOptions {
  /** Server host. */
  readonly host: string
  /** Server port. */
  readonly port: number
  /** Whether the connection starts TLS immediately (implicit TLS). */
  readonly secure: boolean
  /** Whether the connection upgrades with STARTTLS after the greeting. */
  readonly starttls?: boolean
  /** Account name. */
  readonly user: string
  /** Account password; never logged. */
  readonly password: string
  /** Mailbox to read. */
  readonly mailbox: string
  /** Highest UID already seen, or null to look for unseen messages instead. */
  readonly since: number | null
  /** Most messages one pass reads. */
  readonly maxMessages: number
  /** Milliseconds before the connection is abandoned. */
  readonly timeoutMs: number
}

/** One tagged IMAP exchange, with the server's final response line. */
interface Exchange {
  readonly status: string
  readonly lines: readonly string[]
}

/** Raised when the server answers a command with `NO` or `BAD`. */
export class ImapError extends Error {
  /** @param message - human-readable failure. */
  constructor(message: string) {
    super(message)
    this.name = 'ImapError'
  }
}

/** The protocol state: one socket, one accumulation buffer, one command at a time. */
class ImapSession {
  private buffer = ''
  private tag = 0
  private pending: { tag: string; resolve: (exchange: Exchange) => void; reject: (error: Error) => void } | undefined
  private closed = false
  private onData: (chunk: Buffer) => void = () => { /* replaced once a socket is wired */ }

  private constructor(private socket: Socket) {}

  /**
   * Open a session, read the greeting, and upgrade it with STARTTLS when asked.
   * @param options - connection settings.
   * @returns the connected session.
   */
  static async open(options: ImapOptions): Promise<ImapSession> {
    const first = options.secure
      ? connectTls({ host: options.host, port: options.port, servername: options.host })
      : connectTcp({ host: options.host, port: options.port })
    const session = new ImapSession(first)
    await session.waitConnected(first, options.timeoutMs)
    await session.readGreeting()
    if (options.starttls === true) await session.startTls(options.host, options.timeoutMs)
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
    socket.setTimeout(timeoutMs, () => { this.fail(new ImapError('tiempo de espera agotado')) })
    return new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.off('error', reject)
        socket.on('error', (error: Error) => { this.fail(error) })
        socket.on('close', () => { this.closed = true; this.fail(new ImapError('conexión cerrada')) })
        socket.on('data', onData)
        resolve()
      })
    })
  }

  /**
   * Upgrade the plaintext connection with `STARTTLS` and keep using the
   * encrypted socket. Servers commonly offer this on port 143.
   * @param host - server name used to validate the certificate.
   * @param timeoutMs - milliseconds before the handshake is abandoned.
   */
  private async startTls(host: string, timeoutMs: number): Promise<void> {
    await this.command('STARTTLS')
    const plain = this.socket
    plain.off('data', this.onData)
    plain.setTimeout(0)
    const encrypted = connectTls({ socket: plain, servername: host })
    this.socket = encrypted
    const onData = (chunk: Buffer): void => { this.consume(chunk.toString('utf8')) }
    this.onData = onData
    encrypted.setTimeout(timeoutMs, () => { this.fail(new ImapError('tiempo de espera agotado')) })
    await new Promise<void>((resolve, reject) => {
      encrypted.once('secureConnect', () => {
        encrypted.off('error', reject)
        encrypted.on('error', (error: Error) => { this.fail(error) })
        encrypted.on('close', () => { this.closed = true; this.fail(new ImapError('conexión cerrada')) })
        encrypted.on('data', onData)
        resolve()
      })
      encrypted.once('error', reject)
    })
  }

  /** Wait for the server's `* OK` greeting. */
  private readGreeting(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (/^\* (OK|PREAUTH)/m.test(this.buffer)) {
          this.buffer = this.buffer.slice(this.buffer.indexOf('\n') + 1)
          resolve()
        } else requestAnimationFrameish(check)
      }
      check()
    })
  }

  /**
   * Send one command and resolve with its responses.
   * @param command - the command text without a tag.
   * @returns the server's lines and the tagged status.
   */
  async command(command: string): Promise<Exchange> {
    if (this.closed) throw new ImapError('conexión cerrada')
    const tag = `f${String(++this.tag)}`
    return await new Promise<Exchange>((resolve, reject) => {
      this.pending = { tag, resolve, reject }
      this.socket.write(`${tag} ${command}\r\n`)
    })
  }

  /** Append bytes and settle the pending command when its tagged line arrives. */
  private consume(chunk: string): void {
    this.buffer += chunk
    const pending = this.pending
    if (pending === undefined) return
    const tagged = new RegExp(`^${pending.tag} (OK|NO|BAD)(?: .*)?$`, 'm')
    const match = tagged.exec(this.buffer)
    if (match === null) return
    const index = this.buffer.indexOf(match[0])
    const lines = this.buffer.slice(0, index).split('\r\n').filter(Boolean)
    this.buffer = this.buffer.slice(index + match[0].length).replace(/^\r\n/, '')
    this.pending = undefined
    const exchange: Exchange = { status: match[1] ?? 'BAD', lines }
    if (exchange.status === 'OK') pending.resolve(exchange)
    else pending.reject(new ImapError(`el servidor respondió ${exchange.status}: ${lines.at(-1) ?? ''}`))
  }

  /** Reject the pending command and stop using the socket. */
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

/** Small delay used by the greeting poll. */
function requestAnimationFrameish(callback: () => void): void {
  setTimeout(callback, 5)
}

/**
 * Read the new messages of one mailbox, newest last.
 * @param options - connection settings and how far the reader already got.
 * @returns the message envelopes, at most `maxMessages`.
 */
export async function fetchMessages(options: ImapOptions): Promise<ImapMessage[]> {
  const session = await ImapSession.open(options)
  try {
    await session.command(`LOGIN ${quote(options.user)} ${quote(options.password)}`)
    await session.command(`SELECT ${quote(options.mailbox)}`)
    const search = await session.command(options.since === null ? 'UID SEARCH UNSEEN' : `UID SEARCH UID ${String(options.since + 1)}:*`)
    const uids = uidsOf(search.lines).slice(0, options.maxMessages)
    if (uids.length === 0) return []
    const fetch = await session.command(`UID FETCH ${uids.join(',')} (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)])`)
    return messagesOf(fetch.lines).slice(0, options.maxMessages)
  } finally {
    try { await session.command('LOGOUT') } catch { /* the server may drop the session first */ }
    session.close()
  }
}

/** Quote one IMAP string argument. */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Read the UID list out of a `SEARCH` response.
 * @param lines - the server's response lines.
 * @returns the UIDs the server reported, ascending.
 */
export function uidsOf(lines: readonly string[]): number[] {
  const uids: number[] = []
  for (const line of lines) {
    const match = /^\* SEARCH(?: (.*))?$/.exec(line)
    if (match === null) continue
    for (const token of (match[1] ?? '').split(' ')) {
      const uid = Number(token)
      if (Number.isSafeInteger(uid) && uid > 0) uids.push(uid)
    }
  }
  return uids.sort((left, right) => left - right)
}

/**
 * Read the envelopes out of a `FETCH` response.
 * @param lines - the server's response lines, literals included.
 * @returns the envelopes the server reported, by ascending UID.
 */
export function messagesOf(lines: readonly string[]): ImapMessage[] {
  const messages: ImapMessage[] = []
  const joined = lines.join('\n')
  for (const chunk of joined.split(/\* \d+ FETCH/).slice(1)) {
    const uid = Number(/UID (\d+)/.exec(chunk)?.[1] ?? '')
    if (!Number.isSafeInteger(uid) || uid <= 0) continue
    const headers = headerBlock(chunk)
    messages.push({
      uid,
      messageId: headerValue(headers, 'message-id'),
      from: headerValue(headers, 'from'),
      subject: headerValue(headers, 'subject'),
      date: headerValue(headers, 'date'),
    })
  }
  return messages.sort((left, right) => left.uid - right.uid)
}

/** Take the header literal out of one FETCH chunk. */
function headerBlock(chunk: string): string {
  const literal = /\{(\d+)\}\r?\n/.exec(chunk)
  if (literal !== null) {
    const size = Number(literal[1])
    const start = (literal.index ?? 0) + literal[0].length
    return chunk.slice(start, start + size)
  }
  const inline = /"([\s\S]*)"/.exec(chunk)
  return inline?.[1] ?? chunk
}

/**
 * Read one header value, folding its continuation lines into one string.
 * @param block - the raw header block.
 * @param name - lower-case header name.
 * @returns the joined value, or null when the block carried no such header.
 */
export function headerValue(block: string, name: string): string | null {
  const parts: string[] = []
  let collecting = false
  for (const line of block.split(/\r?\n/)) {
    const header = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line)
    if (header !== null) {
      if (collecting) break
      if ((header[1] ?? '').toLowerCase() === name) {
        collecting = true
        parts.push(header[2] ?? '')
      }
      continue
    }
    if (collecting && /^[ \t]/.test(line)) parts.push(line.trim())
  }
  const value = parts.join(' ').trim()
  return value.length === 0 ? null : value
}
