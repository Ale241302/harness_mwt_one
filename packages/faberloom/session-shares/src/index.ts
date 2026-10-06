/**
 * Shared Session catalog (`ctx.faberloomSessionShares`): the Sessions a Space's
 * members hold, synced between their hosts. Capturing a local Session records
 * its portable log text under the Space and publishes it to the MWT.ONE
 * console; syncing imports the Sessions other members published, so the owner
 * sees a guest's Sessions and the guest sees the owner's. Records are durable
 * through `ctx.storageDomain`, and the console is the cross-host transport.
 * @module @deepseek-ai/dsh-faberloom-session-shares
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { sessionSharesDomainSpec, type SharedSessionRecord } from './spec.ts'
import type {
  FaberLoomSharedSession, FaberLoomSharedSessionCapture, FaberLoomSharedSessionContent,
} from './types.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-spaces'
import type {} from '@deepseek-ai/dsh-faberloom-shares'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomSessionShares: FaberLoomSessionShares
  }
}

/** Deployment-supplied console configuration. */
export interface Config {
  /** MWT.ONE console base URL; empty falls back to `CONSOLA_API_BASE`. */
  consoleBase?: string
  /** Console bearer token; empty falls back to `CONSOLA_TOKEN`. */
  consoleToken?: string
}

/** Schemastery configuration for the session-shares service. */
export const Config: z<Config> = z.object({
  consoleBase: z.string().default(''),
  consoleToken: z.string().default(''),
})

/** The acting identity every call carries. */
export interface FaberLoomSessionActor {
  /** Signed-in email. */
  readonly id: string
}

/** Map one durable record to the consumer-facing row, dropping the content. */
function toRow(record: SharedSessionRecord): FaberLoomSharedSession {
  return {
    sessionId: record.sessionId,
    ownerId: record.ownerId,
    spaceId: record.spaceId,
    title: record.title,
    workspaceId: record.workspaceId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    origin: record.origin,
  }
}

/** The local-capture row key for one Session. */
function localKey(spaceId: string, ownerId: string, sessionId: string): string {
  return `owner:${spaceId}\u0000${ownerId}\u0000${sessionId}`
}

/** The imported row key for one reader and console id. */
function importedPrefix(readerId: string): string {
  return `console:${readerId}\u0000`
}

/**
 * The shared Session catalog: durable, per-Space, and console-synced.
 */
export class FaberLoomSessionShares extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof sessionSharesDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - console configuration.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomSessionShares')
    this.ctx.effect(() => () => this.closeDomain(), 'faberloom.sessionSharesDomainClose')
  }

  /** Close the lazily opened domain, if any, when the service fiber unloads. */
  private async closeDomain(): Promise<void> {
    if (this.domainPromise === undefined) return
    await (await this.domainPromise).close()
  }

  /** Open the session-shares domain once and keep its handle. */
  private domain(): Promise<Domain<typeof sessionSharesDomainSpec>> {
    this.domainPromise ??= this.ctx.storageDomain.open(sessionSharesDomainSpec)
    return this.domainPromise
  }

  /** The shared Sessions table handle. */
  private async sessions(): Promise<KvTable<string, SharedSessionRecord>> {
    return (await this.domain()).table('sessions')
  }

  /** Find one shared Session by its logical identity, across local and imported rows. */
  private async find(
    spaceId: string, ownerId: string, sessionId: string,
  ): Promise<{ key: string; record: SharedSessionRecord } | undefined> {
    for (const [key, record] of (await this.sessions()).entries()) {
      if (record.spaceId === spaceId && record.ownerId === ownerId && record.sessionId === sessionId) return { key, record }
    }
    return undefined
  }

  /* jscpd:ignore-start -- deliberately mirrors the shares service's console
     resolution: both read the same two configuration keys and the same
     environment fallbacks, and the console base/token contract is shared. */
  /** The console base URL, from config or the gateway's environment. */
  private consoleBase(): string | undefined {
    const base = this.config.consoleBase !== undefined && this.config.consoleBase.length > 0
      ? this.config.consoleBase
      : process.env['CONSOLA_API_BASE'] ?? ''
    return base.length === 0 ? undefined : base.replace(/\/+$/, '')
  }

  /** The console bearer token, from config or the gateway's environment. */
  private consoleToken(): string | undefined {
    const token = this.config.consoleToken !== undefined && this.config.consoleToken.length > 0
      ? this.config.consoleToken
      : process.env['CONSOLA_TOKEN'] ?? ''
    return token.length === 0 ? undefined : token
  }
  /* jscpd:ignore-end */

  /** Call the console session API with the owner's token, or return undefined when unwired. */
  private async consoleSessions(suffix: string, init?: { method?: string; body?: string }): Promise<unknown> {
    const base = this.consoleBase()
    const token = this.consoleToken()
    if (base === undefined || token === undefined) return undefined
    /* jscpd:ignore-start -- mirrors the shares service's console call: the same
       headers, timeout, non-ok contract, and 204 handling over the console
       transport; only the session path and message differ. */
    const response = await fetch(`${base}/harness/sessions/${suffix}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...init?.body === undefined ? {} : { body: init.body },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`faberloom: la consola rechazó la operación de sesiones (${String(response.status)})`)
    if (response.status === 204) return undefined
    return await response.json()
    /* jscpd:ignore-end */
  }

  /**
   * Resolve one Space and require `view` on it: its owner passes, a member needs
   * an active grant. Without the spaces or shares service the actor is trusted,
   * so a bare composition still works.
   * @param actor - the acting identity.
   * @param spaceId - the Space being read or written.
   * @returns the Space's owner email.
   */
  private async authorize(actor: FaberLoomSessionActor, spaceId: string): Promise<string> {
    const spaces = this.ctx.get('faberloomSpaces')
    if (spaces === undefined) return actor.id
    const space = await spaces.get(actor as never, spaceId as never)
    if (space.ownerId === actor.id) return space.ownerId
    const shares = this.ctx.get('faberloomShares')
    const allowed = shares === undefined ? false : await shares.can(actor.id, space.ownerId, { kind: 'space', id: spaceId }, 'view')
    if (!allowed) throw new Error('faberloom: no tienes acceso a las sesiones de este espacio')
    return space.ownerId
  }

  /**
   * Capture one local Session into its Space: store its portable log and publish
   * it to the console when one is configured.
   * @param actor - the acting identity, which must own the Session.
   * @param input - Space, Session identity, title, and canonical log text.
   * @returns the captured row.
   */
  async capture(actor: FaberLoomSessionActor, input: FaberLoomSharedSessionCapture): Promise<FaberLoomSharedSession> {
    await this.authorize(actor, input.spaceId)
    const now = new Date().toISOString()
    const record: SharedSessionRecord = {
      spaceId: input.spaceId,
      ownerId: actor.id,
      sessionId: input.sessionId,
      title: input.title,
      workspaceId: input.workspaceId ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      messageCount: input.messageCount ?? 0,
      content: input.content,
      origin: 'owner',
      consoleId: null,
    }
    const published = await this.consoleSessions('', {
      method: 'POST',
      body: JSON.stringify({
        space_id: input.spaceId,
        session_id: input.sessionId,
        owner_email: actor.id,
        title: record.title,
        workspace_id: record.workspaceId,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        message_count: record.messageCount,
        content: record.content,
      }),
    })
    const consoleId = published !== null && typeof published === 'object' && typeof (published as { id?: unknown }).id === 'string'
      ? (published as { id: string }).id
      : null
    const stored: SharedSessionRecord = { ...record, consoleId }
    await (await this.sessions()).put(localKey(input.spaceId, actor.id, input.sessionId), stored)
    return toRow(stored)
  }

  /**
   * List one Space's shared Sessions, newest first. The actor must be able to
   * view the Space.
   * @param actor - the acting identity.
   * @param spaceId - the Space being listed.
   * @returns the rows, without content.
   */
  async list(actor: FaberLoomSessionActor, spaceId: string): Promise<readonly FaberLoomSharedSession[]> {
    await this.authorize(actor, spaceId)
    const rows: FaberLoomSharedSession[] = []
    for (const [, record] of (await this.sessions()).entries()) {
      // Imported rows keep every Space they name; only the local captures are
      // scoped by the key prefix, so filter by the record's own Space.
      if (record.spaceId === spaceId) rows.push(toRow(record))
    }
    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one shared Session's content.
   * @param actor - the acting identity.
   * @param spaceId - the Space the Session is shared in.
   * @param ownerId - the member whose host holds the Session.
   * @param sessionId - the Session id.
   * @returns the row with its content.
   */
  async content(actor: FaberLoomSessionActor, spaceId: string, ownerId: string, sessionId: string): Promise<FaberLoomSharedSessionContent> {
    await this.authorize(actor, spaceId)
    const found = await this.find(spaceId, ownerId, sessionId)
    if (found === undefined) throw new Error(`faberloom: sesión compartida ${sessionId} no encontrada`)
    return { ...toRow(found.record), content: found.record.content }
  }

  /**
   * Remove one captured Session the actor owns, or any Session when the actor
   * owns the Space.
   * @param actor - the acting identity.
   * @param spaceId - the Space the Session is shared in.
   * @param ownerId - the member whose host holds the Session.
   * @param sessionId - the Session id.
   * @returns true when a row was removed.
   */
  async remove(actor: FaberLoomSessionActor, spaceId: string, ownerId: string, sessionId: string): Promise<boolean> {
    const spaceOwner = await this.authorize(actor, spaceId)
    if (ownerId !== actor.id && spaceOwner !== actor.id) throw new Error('faberloom: solo el autor o el dueño del espacio puede quitar la sesión')
    const found = await this.find(spaceId, ownerId, sessionId)
    if (found === undefined) return false
    if (found.record.consoleId !== null) {
      await this.consoleSessions(`${encodeURIComponent(found.record.consoleId)}/`, { method: 'DELETE' }).catch(() => undefined)
    }
    await (await this.sessions()).delete(found.key)
    return true
  }

  /**
   * Import the console's shared Sessions for one member and prune the local
   * copies the console no longer carries, so a revoked share stops showing.
   * A no-op when the console is not configured.
   * @param readerId - the identity whose incoming Sessions are imported.
   */
  async sync(readerId: string): Promise<void> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return
    const data = await this.consoleSessions('') as { incoming?: readonly ConsoleSessionRow[] }
    const table = await this.sessions()
    const wanted = new Set<string>()
    for (const row of data.incoming ?? []) {
      wanted.add(`${readerId}\u0000${row.id}`)
      const record: SharedSessionRecord = {
        spaceId: row.space_id,
        ownerId: row.owner_email,
        sessionId: row.session_id,
        title: row.title ?? row.session_id,
        workspaceId: row.workspace_id ?? null,
        createdAt: row.created_at ?? new Date().toISOString(),
        updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
        messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
        content: row.content ?? '',
        origin: 'console',
        consoleId: row.id,
      }
      await table.put(`${importedPrefix(readerId)}${row.id}`, record)
    }
    for (const [key] of table.entries()) {
      if (!key.startsWith(importedPrefix(readerId))) continue
      if (wanted.has(`${readerId}\u0000${key.slice(importedPrefix(readerId).length)}`)) continue
      await table.delete(key)
    }
  }
}

/** One console shared-Session row the import reads. */
interface ConsoleSessionRow {
  /** Console-side row id. */
  readonly id: string
  /** Space the Session is shared in. */
  readonly space_id: string
  /** Session id on its author's host. */
  readonly session_id: string
  /** Author email. */
  readonly owner_email: string
  /** Display title. */
  readonly title?: string
  /** Workspace the Session ran in. */
  readonly workspace_id?: string | null
  /** ISO-8601 creation instant. */
  readonly created_at?: string
  /** ISO-8601 last-change instant. */
  readonly updated_at?: string
  /** Committed event count. */
  readonly message_count?: number
  /** Canonical JSONL log text. */
  readonly content?: string
}

export default FaberLoomSessionShares
