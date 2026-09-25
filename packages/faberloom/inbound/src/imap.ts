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
  /** The raw response text with CRLFs and blank lines preserved. */
  readonly raw: string
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
    const onData = (chunk: Buffer): void => { this.consume(chunk.toString('latin1')) }
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
    const onData = (chunk: Buffer): void => { this.consume(chunk.toString('latin1')) }
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
    const raw = this.buffer.slice(0, index)
    const lines = raw.split('\r\n').filter(Boolean)
    this.buffer = this.buffer.slice(index + match[0].length).replace(/^\r\n/, '')
    this.pending = undefined
    const exchange: Exchange = { status: match[1] ?? 'BAD', lines, raw }
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

/** How to read one message body. */
export interface ImapBodyOptions {
  /** Server host. */
  readonly host: string
  /** Server port. */
  readonly port: number
  /** Whether the connection starts TLS immediately. */
  readonly secure: boolean
  /** Whether the connection upgrades with STARTTLS after the greeting. */
  readonly starttls?: boolean
  /** Account name. */
  readonly user: string
  /** Account password; never logged. */
  readonly password: string
  /** Mailbox to read. */
  readonly mailbox: string
  /** UID of the message to read. */
  readonly uid: number
  /** Milliseconds before the connection is abandoned. */
  readonly timeoutMs: number
}

/** One decoded attachment part of a message. */
export interface ImapAttachment {
  /** File name from `Content-Disposition`/`Content-Type`, or a fallback. */
  readonly name: string
  /** Media type. */
  readonly mediaType: string
  /** Byte length. */
  readonly size: number
  /** Decoded bytes, base64-encoded. */
  readonly contentBase64: string
}

/** One decoded message: the best text/html plus its attachments. */
export interface ImapMessageContent {
  /** Plain-text body, empty when the message carried none. */
  readonly text: string
  /** HTML body, or null when the message carried none. */
  readonly html: string | null
  /** Attachment parts, in order. */
  readonly attachments: readonly ImapAttachment[]
}

/**
 * Read one full message (headers, multipart body, attachments). Read-only:
 * `BODY.PEEK[]` never marks the message seen.
 * @param options - connection settings and the message UID.
 * @returns the decoded content, or an empty content when the server returned no literal.
 */
export async function fetchContent(options: ImapBodyOptions): Promise<ImapMessageContent> {
  const session = await ImapSession.open({ ...options, since: null, maxMessages: 1 })
  try {
    await session.command(`LOGIN ${quote(options.user)} ${quote(options.password)}`)
    await session.command(`SELECT ${quote(options.mailbox)}`)
    const fetch = await session.command(`UID FETCH ${String(options.uid)} (BODY.PEEK[])`)
    const raw = literalOf(fetch.raw)
    return raw === null ? { text: '', html: null, attachments: [] } : parseMessage(raw)
  } finally {
    try { await session.command('LOGOUT') } catch { /* the server may drop the session first */ }
    session.close()
  }
}

/** Cut the `{size}` literal out of a raw FETCH response. */
function literalOf(raw: string): string | null {
  const marker = /\{(\d+)\}\r?\n/.exec(raw)
  if (marker === null) return null
  const size = Number(marker[1])
  const start = marker.index + marker[0].length
  return raw.slice(start, start + size)
}

/**
 * Parse one raw RFC 822 message into display content and attachments.
 * @param message - the raw message bytes decoded as UTF-8.
 * @returns the plain text, HTML, and attachment parts.
 */
export function parseMessage(message: string): ImapMessageContent {
  const out: { text: string; html: string | null; attachments: ImapAttachment[] } = {
    text: '',
    html: null,
    attachments: [],
  }
  collectPart(message, out)
  return out
}

/** Walk one MIME part, filling the display fields and attachments. */
function collectPart(part: string, out: { text: string; html: string | null; attachments: ImapAttachment[] }): void {
  const split = part.indexOf('\r\n\r\n')
  const headerText = split === -1 ? part : part.slice(0, split)
  const body = split === -1 ? '' : part.slice(split + 4)
  const headers = headerMap(headerText)
  const contentType = headers['content-type'] ?? 'text/plain'
  const disposition = headers['content-disposition'] ?? ''
  const mediaType = (contentType.split(';')[0] ?? 'text/plain').trim().toLowerCase()
  const filename = paramOf(disposition, 'filename') ?? paramOf(contentType, 'name')
  if (mediaType.startsWith('multipart/')) {
    const boundary = paramOf(contentType, 'boundary')
    if (boundary === null) return
    for (const child of body.split(`--${boundary}`)) {
      const trimmed = child.replace(/^\r?\n/, '')
      if (trimmed.trim().length === 0 || trimmed.startsWith('--')) continue
      collectPart(trimmed, out)
    }
    return
  }
  const bytes = decodeTransfer(headers['content-transfer-encoding'], body)
  if (filename !== null || disposition.toLowerCase().startsWith('attachment')) {
    out.attachments.push({
      name: filename ?? `adjunto-${String(out.attachments.length + 1)}`,
      mediaType,
      size: bytes.length,
      contentBase64: bytes.toString('base64'),
    })
    return
  }
  if (mediaType === 'text/html' && out.html === null) out.html = decodeText(bytes, paramOf(contentType, 'charset'))
  else if (mediaType === 'text/plain' && out.text.length === 0) out.text = decodeText(bytes, paramOf(contentType, 'charset'))
}

/**
 * Decode one text part with the charset its `Content-Type` declares. The socket
 * is read byte-for-byte (Latin-1), so the part's bytes are intact here; only the
 * final step needs the declared charset, not an assumed UTF-8.
 * @param bytes - the transfer-decoded part bytes.
 * @param charset - the `charset` parameter, or null when the part named none.
 * @returns the decoded text; an unknown charset falls back to UTF-8.
 */
function decodeText(bytes: Buffer, charset: string | null): string {
  const name = (charset ?? '').trim().toLowerCase()
  if (name.length === 0 || name === 'utf-8' || name === 'utf8') return bytes.toString('utf8')
  try {
    return new TextDecoder(name).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

/** Folded header lines into a lower-case name map. */
function headerMap(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  let name = ''
  for (const line of text.split(/\r?\n/)) {
    const match = /^([!-9;-~]+):\s?(.*)$/.exec(line)
    if (match !== null) {
      name = (match[1] ?? '').toLowerCase()
      map[name] = match[2] ?? ''
    } else if (name !== '' && /^\s/.test(line)) {
      map[name] = `${map[name] ?? ''} ${line.trim()}`
    }
  }
  return map
}

/** One `key=value` (quoted or bare) parameter of a header value. */
function paramOf(value: string, key: string): string | null {
  const match = new RegExp(`${key}\\s*=\\s*"([^"]*)"|${key}\\s*=\\s*([^;\\s]+)`, 'i').exec(value)
  if (match === null) return null
  const found = (match[1] ?? match[2] ?? '').trim()
  return found.length === 0 ? null : found
}

/** Decode one part body by its `Content-Transfer-Encoding`. */
function decodeTransfer(encoding: string | undefined, body: string): Buffer {
  const mode = (encoding ?? '').trim().toLowerCase()
  if (mode === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
  if (mode === 'quoted-printable') {
    const text = body.replace(/=\r?\n/g, '')
    const bytes: number[] = []
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] as string
      if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
        bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16))
        index += 2
      } else {
        bytes.push(char.charCodeAt(0) & 0xff)
      }
    }
    return Buffer.from(bytes)
  }
  return Buffer.from(body, 'latin1')
}

/**
 * Decode a message body literal by its likely transfer encoding.
 * @param raw - the body literal as received.
 * @returns decoded UTF-8 text with the trailing FETCH `)` removed.
 */
export function decodeBodyText(raw: string): string {
  const text = raw.replace(/\r?\n\)\s*$/, '').replace(/\)\s*$/, '')
  const compact = text.replace(/\s/g, '')
  // Base64 bodies have no spaces; requiring that keeps prose from being decoded as base64.
  const looksBase64 = !text.includes(' ') && compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(compact)
  if (looksBase64) {
    const decoded = Buffer.from(compact, 'base64').toString('utf8')
    if (decoded.trim().length > 0) return decoded
  }
  return decodeQuotedPrintable(text)
}

/**
 * Decode quoted-printable text (RFC 2045) without external dependencies.
 * @param input - the encoded text.
 * @returns the decoded text; multibyte `=XX` sequences decode byte by byte.
 */
export function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/** Quote one IMAP string argument. */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** How to search one mailbox from the chat. */
export interface ImapSearchOptions {
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
  /** Text to look for in the whole message; empty returns the newest envelopes. */
  readonly query: string
  /** Most envelopes one search returns, newest first. */
  readonly maxMessages: number
  /** How many recent messages the client-side fallback scans. */
  readonly scanMessages: number
  /** Milliseconds before the connection is abandoned. */
  readonly timeoutMs: number
}

/**
 * Search one mailbox's envelopes, newest first, without mutating anything.
 *
 * The primary path is the server's own `UID SEARCH`; servers that refuse a
 * UTF-8 charset fall back to scanning the most recent envelopes and matching
 * `From`/`Subject` here, which is what a chat query needs. Like
 * {@link fetchMessages}, this never marks, moves, or deletes mail.
 * @param options - connection settings and the query.
 * @returns the matching envelopes, newest first, at most `maxMessages`.
 */
export async function searchMessages(options: ImapSearchOptions): Promise<ImapMessage[]> {
  const session = await ImapSession.open({ ...options, since: null })
  try {
    await session.command(`LOGIN ${quote(options.user)} ${quote(options.password)}`)
    await session.command(`SELECT ${quote(options.mailbox)}`)
    let uids: number[]
    let filterLocally = false
    if (options.query.length === 0) {
      uids = uidsOf((await session.command('UID SEARCH ALL')).lines)
    } else {
      try {
        uids = uidsOf((await session.command(`UID SEARCH CHARSET UTF-8 TEXT ${quote(options.query)}`)).lines)
      } catch {
        uids = uidsOf((await session.command('UID SEARCH ALL')).lines)
        filterLocally = true
      }
    }
    const budget = filterLocally ? options.scanMessages : options.maxMessages
    const chosen = uids.slice(-budget)
    if (chosen.length === 0) return []
    const fetch = await session.command(`UID FETCH ${chosen.join(',')} (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)])`)
    let messages = messagesOf(fetch.lines)
    if (filterLocally) {
      const needle = options.query.toLowerCase()
      messages = messages.filter(message =>
        (message.subject ?? '').toLowerCase().includes(needle) || (message.from ?? '').toLowerCase().includes(needle))
    }
    return messages.sort((left, right) => right.uid - left.uid).slice(0, options.maxMessages)
  } finally {
    try { await session.command('LOGOUT') } catch { /* the server may drop the session first */ }
    session.close()
  }
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
      from: decoded(headerValue(headers, 'from')),
      subject: decoded(headerValue(headers, 'subject')),
      date: headerValue(headers, 'date'),
    })
  }
  return messages.sort((left, right) => left.uid - right.uid)
}

/**
 * Decode RFC 2047 encoded-words (`=?utf-8?q?…?=` / `=?utf-8?B?…?=`) in a
 * header value so names and subjects read as text.
 * @param value - the raw header value.
 * @returns the decoded value; unknown charsets fall back to Latin-1.
 */
export function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, text: string) => {
    const latin1 = encoding.toLowerCase() === 'b'
      ? Buffer.from(text, 'base64').toString('latin1')
      : text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_hex, pair: string) => String.fromCharCode(Number.parseInt(pair, 16)))
    const bytes = Buffer.from(latin1, 'latin1')
    return charset.toLowerCase().startsWith('iso-8859') || charset.toLowerCase() === 'latin1'
      ? bytes.toString('latin1')
      : bytes.toString('utf8')
  })
}

/** Decode one optional header value. */
function decoded(value: string | null): string | null {
  return value === null ? null : decodeMimeWords(value)
}

/** Take the header literal out of one FETCH chunk. */
function headerBlock(chunk: string): string {
  const literal = /\{(\d+)\}\r?\n/.exec(chunk)
  if (literal !== null) {
    const size = Number(literal[1])
    const start = literal.index + literal[0].length
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
