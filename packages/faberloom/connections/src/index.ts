/**
 * Native product connections (`ctx.faberloomConnections`): the per-user IMAP,
 * SMTP, and knowledge-backup settings the owner enters. They are FaberLoom's
 * own data and never an MWT.ONE MCP operation: each identity keeps its own
 * rows, the password is stored but never returned, and `probe` checks the
 * configuration for real (an IMAP or SMTP login, or a writable backup
 * destination). `sendMail` delivers a message through the owner's SMTP row.
 * @module @deepseek-ai/dsh-faberloom-connections
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { Context, Service } from '@deepseek-ai/cordis'
import { connectionsDomainSpec, type ConnectionRecord, type DraftRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { probeSmtp, sendSmtp } from './smtp.ts'
import type { ConnectionInput, ConnectionProbe, EmailDraftInput, FaberLoomConnection, FaberLoomEmailDraft, ImapCredentials, OutgoingMail, SentMail, SmtpCredentials } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomConnections: FaberLoomConnections
  }
}

/** Map one durable draft record to the consumer-facing draft. */
function toDraft(id: string, record: DraftRecord): FaberLoomEmailDraft {
  return {
    id,
    to: record.to,
    cc: record.cc,
    subject: record.subject,
    text: record.text,
    status: record.status,
    inReplyTo: record.inReplyTo,
    spaceId: record.spaceId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sentAt: record.sentAt,
  }
}

/** Map one durable record to the consumer-facing connection (secret omitted). */
function toConnection(id: string, record: ConnectionRecord): FaberLoomConnection {
  return {
    id,
    kind: record.kind,
    label: record.label,
    host: record.host,
    port: record.port,
    secure: record.secure,
    starttls: record.starttls === true,
    primary: record.primary === true,
    username: record.username,
    hasSecret: record.secret !== null && record.secret.length > 0,
    destination: record.destination,
    retentionDays: record.retentionDays,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** How one IMAP probe reaches the server. */
interface ImapTarget {
  readonly host: string
  readonly port: number
  /** Implicit TLS from the first byte (993). */
  readonly secure: boolean
  /** Upgrade a plaintext connection with STARTTLS after the greeting (143). */
  readonly starttls: boolean
  readonly user: string
  readonly password: string
}

/** Logs in over IMAP (implicit TLS, STARTTLS, or plaintext) and reports the outcome. */
async function probeImap(target: ImapTarget): Promise<ConnectionProbe> {
  const { host, port, secure, starttls, user, password } = target
  const insecure = !secure && !starttls
  return await new Promise<ConnectionProbe>((resolve) => {
    let settled = false
    let socket: Socket
    try {
      socket = secure
        ? connectTls({ host, port, servername: host, timeout: 8000 })
        : connectTcp({ host, port, timeout: 8000 })
    } catch (error) {
      resolve({ ok: false, detail: String(error) })
      return
    }
    const finish = (result: ConnectionProbe): void => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* the socket may already be gone */ }
      resolve(result)
    }
    let stage: 'greeting' | 'starttls' | 'login' = 'greeting'
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      if (stage === 'greeting' && /^\* OK/m.test(buffer)) {
        buffer = ''
        if (starttls) {
          stage = 'starttls'
          socket.write('a0 STARTTLS\r\n')
          return
        }
        stage = 'login'
        socket.write(`a1 LOGIN "${user}" "${password}"\r\n`)
        return
      }
      if (stage === 'starttls' && /^a0 (OK|NO|BAD)/m.test(buffer)) {
        if (!/^a0 OK/m.test(buffer)) {
          finish({ ok: false, detail: 'el servidor no aceptó STARTTLS' })
          return
        }
        buffer = ''
        // Stop reading the plaintext stream before handing the socket to TLS.
        socket.off('data', onData)
        const encrypted = connectTls({ socket, servername: host })
        encrypted.setTimeout(8000, () => { finish({ ok: false, detail: 'tiempo de espera agotado' }) })
        encrypted.on('error', (error: Error) => { finish({ ok: false, detail: error.message }) })
        encrypted.on('data', onData)
        socket = encrypted
        stage = 'login'
        socket.write(`a1 LOGIN "${user}" "${password}"\r\n`)
        return
      }
      if (stage === 'login' && /^a1 (OK|NO|BAD)/m.test(buffer)) {
        finish(/^a1 OK/m.test(buffer)
          ? { ok: true, detail: insecure ? 'inicio de sesión IMAP correcto (sin cifrado)' : 'inicio de sesión IMAP correcto' }
          : { ok: false, detail: 'el servidor rechazó las credenciales' })
      }
    }
    socket.setTimeout(8000, () => { finish({ ok: false, detail: 'tiempo de espera agotado' }) })
    socket.on('error', (error: Error) => { finish({ ok: false, detail: error.message }) })
    socket.on('data', onData)
  })
}

/** Verifies a backup destination is writable when it is a host path. */
async function probeBackup(destination: string): Promise<ConnectionProbe> {
  if (!destination.startsWith('/')) {
    return { ok: false, detail: 'un destino remoto (rclone) se comprueba desde el flujo de respaldo, no aquí' }
  }
  const probe = join(destination, `.faberloom-probe-${randomUUID().slice(0, 8)}`)
  try {
    await mkdir(destination, { recursive: true })
    await writeFile(probe, 'ok', 'utf8')
    await rm(probe, { force: true })
    return { ok: true, detail: 'destino escribible' }
  } catch (error) {
    return { ok: false, detail: `no se puede escribir en el destino: ${String(error)}` }
  }
}

/**
 * The product connections service: per-user integrations owned by FaberLoom.
 */
export class FaberLoomConnections extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof connectionsDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomConnections')
  }

  private domain(): Promise<Domain<typeof connectionsDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(connectionsDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.connectionsDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async table(): Promise<KvTable<string, ConnectionRecord>> { return (await this.domain()).table('connections') }

  /** The owner's email-draft table handle. */
  private async draftTable(): Promise<KvTable<string, DraftRecord>> { return (await this.domain()).table('drafts') }

  /**
   * List one owner's email drafts, newest first.
   * @param ownerId - the owning identity.
   * @returns the drafts.
   */
  async listDrafts(ownerId: string): Promise<FaberLoomEmailDraft[]> {
    const out: FaberLoomEmailDraft[] = []
    for (const [id, record] of (await this.draftTable()).entries()) {
      if (record.ownerId === ownerId) out.push(toDraft(id, record))
    }
    out.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return out
  }

  /**
   * Create or replace one email draft.
   * @param ownerId - the owning identity.
   * @param input - the draft fields.
   * @returns the stored draft.
   */
  async saveDraft(ownerId: string, input: EmailDraftInput): Promise<FaberLoomEmailDraft> {
    const table = await this.draftTable()
    const now = new Date().toISOString()
    const id = input.id ?? randomUUID()
    const existing = input.id === undefined ? undefined : table.get(id)
    const record: DraftRecord = {
      ownerId,
      to: [...input.to],
      cc: input.cc === undefined ? [] : [...input.cc],
      subject: input.subject,
      text: input.text,
      status: 'draft',
      inReplyTo: input.inReplyTo ?? null,
      spaceId: input.spaceId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sentAt: null,
    }
    await table.put(id, record)
    return toDraft(id, record)
  }

  /**
   * Remove one draft the owner may discard.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @returns true when a record was removed.
   */
  async removeDraft(ownerId: string, id: string): Promise<boolean> {
    const table = await this.draftTable()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return false
    return await table.delete(id)
  }

  /**
   * Send one draft through the owner's SMTP connection and mark it sent.
   * @param ownerId - the owning identity.
   * @param id - the draft id.
   * @returns the sent draft.
   * @throws when the draft is absent, already settled, or the send fails.
   */
  async sendDraft(ownerId: string, id: string): Promise<FaberLoomEmailDraft> {
    const table = await this.draftTable()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) throw new Error(`faberloom: draft ${id} not found`)
    if (record.status !== 'draft') throw new Error(`faberloom: draft ${id} is already ${record.status}`)
    await this.sendMail(ownerId, { to: record.to, subject: record.subject, text: record.text })
    const now = new Date().toISOString()
    const next: DraftRecord = { ...record, status: 'sent', sentAt: now, updatedAt: now }
    await table.update(id, () => next)
    return toDraft(id, next)
  }

  /**
   * List one owner's connections.
   * @param ownerId - the owning identity.
   * @returns the connections, oldest first.
   */
  async list(ownerId: string): Promise<FaberLoomConnection[]> {
    const out: FaberLoomConnection[] = []
    for (const [id, record] of (await this.table()).entries()) {
      if (record.ownerId === ownerId) out.push(toConnection(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Create or replace one connection. An omitted secret keeps the stored one.
   * @param ownerId - the owning identity.
   * @param input - the configuration to store.
   * @returns the stored connection.
   */
  async save(ownerId: string, input: ConnectionInput): Promise<FaberLoomConnection> {
    const table = await this.table()
    const existing = input.id === undefined ? undefined : table.get(input.id)
    if (existing !== undefined && existing.ownerId !== ownerId) throw new Error('faberloom: connection belongs to another owner')
    const now = new Date().toISOString()
    const id = existing === undefined ? randomUUID() : input.id as string
    const record: ConnectionRecord = {
      ownerId,
      kind: input.kind,
      label: input.label,
      host: input.host === undefined ? existing?.host ?? null : input.host,
      port: input.port === undefined ? existing?.port ?? null : input.port,
      secure: input.secure === undefined ? existing?.secure ?? null : input.secure,
      starttls: input.starttls === undefined ? existing?.starttls ?? false : input.starttls === true,
      primary: input.primary === undefined ? existing?.primary ?? false : input.primary === true,
      username: input.username === undefined ? existing?.username ?? null : input.username,
      secret: input.secret === undefined || input.secret === null || input.secret.length === 0
        ? existing?.secret ?? null
        : input.secret,
      destination: input.destination === undefined ? existing?.destination ?? null : input.destination,
      retentionDays: input.retentionDays === undefined ? existing?.retentionDays ?? null : input.retentionDays,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await table.put(id, record)
    // Only one row per kind is the default: one mailbox feeds the inbound
    // receiver and one SMTP server carries outbound mail, so making this row
    // primary clears the flag only on the owner's rows of the same kind.
    if (record.primary === true) {
      for (const [otherId, other] of table.entries()) {
        if (otherId === id || other.ownerId !== ownerId || other.kind !== record.kind || other.primary !== true) continue
        await table.update(otherId, current => ({ ...current, primary: false, updatedAt: now }))
      }
    }
    return toConnection(id, record)
  }

  /**
   * Remove one connection.
   * @param ownerId - the owning identity.
   * @param id - connection id.
   * @returns true when it existed.
   */
  async remove(ownerId: string, id: string): Promise<boolean> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return false
    return await table.delete(id)
  }

  /**
   * Check one connection for real: an IMAP or SMTP login, or a writable backup destination.
   * @param ownerId - the owning identity.
   * @param id - connection id.
   * @returns the probe outcome.
   */
  async probe(ownerId: string, id: string): Promise<ConnectionProbe> {
    const record = (await this.table()).get(id)
    if (record === undefined || record.ownerId !== ownerId) return { ok: false, detail: 'conexión no encontrada' }
    if (record.kind === 'imap') {
      if (record.host === null || record.port === null || record.username === null || record.secret === null) {
        return { ok: false, detail: 'faltan host, puerto, usuario o contraseña' }
      }
      return await probeImap({
        host: record.host,
        port: record.port,
        secure: record.secure === true,
        starttls: record.starttls === true,
        user: record.username,
        password: record.secret,
      })
    }
    if (record.kind === 'smtp') {
      const credentials = await this.smtp(ownerId, id)
      if (credentials === undefined) return { ok: false, detail: 'faltan host, puerto, usuario o contraseña' }
      return await probeSmtp(credentials)
    }
    if (record.destination === null) return { ok: false, detail: 'falta el destino del respaldo' }
    return await probeBackup(record.destination)
  }

  /**
   * Read one of the owner's outgoing-server credentials.
   *
   * Like {@link imap}, this accessor returns a stored secret and exists for
   * host-side consumers that send mail as the owner; the browser never sees it.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary SMTP row
   *   (the owner's flagged one, otherwise the first complete row).
   * @returns the credentials, or undefined when the owner has no usable server.
   */
  async smtp(ownerId: string, id?: string): Promise<SmtpCredentials | undefined> {
    const rows: { readonly credentials: SmtpCredentials; readonly primary: boolean }[] = []
    for (const [key, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'smtp') continue
      if (id !== undefined && key !== id) continue
      if (record.host === null || record.port === null || record.username === null || record.secret === null) continue
      rows.push({
        credentials: {
          id: key,
          label: record.label,
          host: record.host,
          port: record.port,
          secure: record.secure === true,
          starttls: record.starttls === true,
          username: record.username,
          password: record.secret,
        },
        primary: record.primary === true,
      })
    }
    const chosen = rows.find(row => row.primary) ?? rows.at(0)
    return chosen?.credentials
  }

  /**
   * Deliver one message through the owner's outgoing server.
   * @param ownerId - the owning identity.
   * @param mail - the message to send.
   * @param connectionId - a specific SMTP connection, or undefined for the
   *   primary (or first complete) one.
   * @returns the generated `Message-ID` and the accepted recipients.
   */
  async sendMail(ownerId: string, mail: OutgoingMail, connectionId?: string): Promise<SentMail> {
    if (mail.to.length === 0) throw new Error('faberloom: el mensaje no tiene destinatarios')
    const credentials = await this.smtp(ownerId, connectionId)
    if (credentials === undefined) throw new Error('faberloom: no hay un servidor SMTP configurado; añádelo en Conexiones')
    const sent = await sendSmtp(credentials, mail)
    return { messageId: sent.messageId, accepted: sent.accepted, via: credentials.label }
  }
  /**
   * Read one of the owner's mailbox credentials.
   *
   * This is the only accessor that returns a stored secret, and it exists for
   * the inbound receiver, which has to log in to the owner's mailbox. The
   * browser never sees it: the panel reads {@link list}, which omits the secret.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the primary mailbox
   *   (the owner's flagged one, otherwise the first complete row).
   * @returns the credentials, or undefined when the owner has no usable mailbox.
   */
  async imap(ownerId: string, id?: string): Promise<ImapCredentials | undefined> {
    const rows: { readonly credentials: ImapCredentials; readonly primary: boolean }[] = []
    for (const [key, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'imap') continue
      if (id !== undefined && key !== id) continue
      if (record.host === null || record.port === null || record.username === null || record.secret === null) continue
      rows.push({
        credentials: {
          id: key,
          label: record.label,
          host: record.host,
          port: record.port,
          secure: record.secure === true,
          starttls: record.starttls === true,
          username: record.username,
          password: record.secret,
        },
        primary: record.primary === true,
      })
    }
    const chosen = rows.find(row => row.primary) ?? rows.at(0)
    return chosen?.credentials
  }
}

export default FaberLoomConnections
