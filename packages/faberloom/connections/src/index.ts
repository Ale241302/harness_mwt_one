/**
 * Native product connections (`ctx.faberloomConnections`): the per-user IMAP and
 * knowledge-backup settings the owner enters. They are FaberLoom's own data and
 * never an MWT.ONE MCP operation: each identity keeps its own rows, the password
 * is stored but never returned, and `probe` checks the configuration for real
 * (an IMAP login, or a writable backup destination).
 * @module @deepseek-ai/dsh-faberloom-connections
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { Context, Service } from '@deepseek-ai/cordis'
import { connectionsDomainSpec, type ConnectionRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ConnectionInput, ConnectionProbe, FaberLoomConnection, ImapCredentials } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomConnections: FaberLoomConnections
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
    username: record.username,
    hasSecret: record.secret !== null && record.secret.length > 0,
    destination: record.destination,
    retentionDays: record.retentionDays,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Logs in over IMAP and reports whether the server accepted the credentials. */
async function probeImap(host: string, port: number, secure: boolean, user: string, password: string): Promise<ConnectionProbe> {
  return await new Promise<ConnectionProbe>((resolve) => {
    let settled = false
    const finish = (result: ConnectionProbe): void => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* the socket may already be gone */ }
      resolve(result)
    }
    let socket: Socket
    try {
      socket = secure
        ? connectTls({ host, port, servername: host, timeout: 8000 })
        : connectTcp({ host, port, timeout: 8000 })
    } catch (error) {
      resolve({ ok: false, detail: String(error) })
      return
    }
    let stage: 'greeting' | 'login' = 'greeting'
    let buffer = ''
    socket.setTimeout(8000, () => { finish({ ok: false, detail: 'tiempo de espera agotado' }) })
    socket.on('error', (error: Error) => { finish({ ok: false, detail: error.message }) })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (stage === 'greeting' && /^\* OK/m.test(buffer)) {
        stage = 'login'
        buffer = ''
        socket.write(`a1 LOGIN "${user}" "${password}"\r\n`)
        return
      }
      if (stage === 'login' && /^a1 (OK|NO|BAD)/m.test(buffer)) {
        finish(/^a1 OK/m.test(buffer)
          ? { ok: true, detail: 'inicio de sesión IMAP correcto' }
          : { ok: false, detail: 'el servidor rechazó las credenciales' })
      }
    })
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
   * Check one connection for real: an IMAP login, or a writable backup destination.
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
      return await probeImap(record.host, record.port, record.secure === true, record.username, record.secret)
    }
    if (record.destination === null) return { ok: false, detail: 'falta el destino del respaldo' }
    return await probeBackup(record.destination)
  }
  /**
   * Read one of the owner's mailbox credentials.
   *
   * This is the only accessor that returns a stored secret, and it exists for
   * the inbound receiver, which has to log in to the owner's mailbox. The
   * browser never sees it: the panel reads {@link list}, which omits the secret.
   * @param ownerId - the owning identity.
   * @param id - a specific connection, or undefined for the first IMAP one.
   * @returns the credentials, or undefined when the owner has no usable mailbox.
   */
  async imap(ownerId: string, id?: string): Promise<ImapCredentials | undefined> {
    for (const [key, record] of (await this.table()).entries()) {
      if (record.ownerId !== ownerId || record.kind !== 'imap') continue
      if (id !== undefined && key !== id) continue
      if (record.host === null || record.port === null || record.username === null || record.secret === null) continue
      return {
        id: key,
        label: record.label,
        host: record.host,
        port: record.port,
        secure: record.secure === true,
        username: record.username,
        password: record.secret,
      }
    }
    return undefined
  }
}

export default FaberLoomConnections
