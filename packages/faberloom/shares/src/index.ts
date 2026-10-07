/**
 * Native product sharing (`ctx.faberloomShares`): durable, per-action share
 * grants on Spaces and Work Flows. An owner grants named emails a permission
 * subset, the grantee is notified through the owner's own SMTP connection with
 * an acceptance link, and the grant authorizes each action only once it is
 * active. Cross-user shares publish to the MWT.ONE console and import into the
 * grantee's process; revoking propagates. Records are durable through
 * `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-shares
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SHARE_PERMISSIONS, type FaberLoomShareGrant, type FaberLoomShareInput, type FaberLoomShareList, type FaberLoomSharePermission, type FaberLoomShareRepublishInput, type FaberLoomShareResource, type FaberLoomSharedContentInput, type FaberLoomSharedContentKind, type FaberLoomSharedContentRow } from './types.ts'
import { sharesDomainSpec, type ShareGrantRecord, type SharedContentRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-connections'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomShares: FaberLoomShares
  }
}

/** Deployment-supplied console and acceptance configuration. */
export interface Config {
  /** MWT.ONE console base URL; empty falls back to `CONSOLA_API_BASE`. */
  consoleBase?: string
  /** Console bearer token; empty falls back to `CONSOLA_TOKEN`. */
  consoleToken?: string
  /** Base URL the acceptance link points at; empty reuses the console base. */
  acceptBase?: string
}

/** Schemastery configuration for the shares service. */
export const Config: z<Config> = z.object({
  consoleBase: z.string().default(''),
  consoleToken: z.string().default(''),
  acceptBase: z.string().default(''),
})

/** The known permissions, as a set for input filtering. */
const KNOWN_PERMISSIONS = new Set<string>(SHARE_PERMISSIONS)

/** The closed set of shared-content families. */
const CONTENT_KINDS = new Set<string>(['memory', 'context', 'workflow', 'routine'])

/** Map one durable record to the consumer-facing grant. */
function toGrant(id: string, record: ShareGrantRecord): FaberLoomShareGrant {
  return {
    id,
    resource: { kind: record.resourceKind, id: record.resourceId },
    resourceName: record.resourceName,
    ownerId: record.ownerId,
    granteeEmail: record.granteeEmail,
    permissions: record.permissions.filter((permission): permission is FaberLoomSharePermission => KNOWN_PERMISSIONS.has(permission)),
    status: record.status,
    createdAt: record.createdAt,
    acceptedAt: record.acceptedAt,
  }
}

/** Whether two resources name the same target. */
function sameResource(left: FaberLoomShareResource, right: FaberLoomShareResource): boolean {
  return left.kind === right.kind && left.id === right.id
}

/** One shared-content item's logical key within its Space. */
function contentKey(kind: FaberLoomSharedContentKind, itemKey: string): string {
  return `${kind}\u0000${itemKey}`
}

/** The local-capture row key for one shared-content item. */
function ownedContentKey(spaceId: string, kind: FaberLoomSharedContentKind, itemKey: string): string {
  return `owner:${spaceId}\u0000${kind}\u0000${itemKey}`
}

/** The imported-row key prefix for one reader. */
function importedContentPrefix(readerId: string): string {
  return `console:${readerId}\u0000`
}

/** Map one durable shared-content record to the consumer-facing row. */
function toContentRow(record: SharedContentRecord): FaberLoomSharedContentRow {
  return {
    spaceId: record.spaceId,
    kind: record.kind,
    itemKey: record.itemKey,
    authorId: record.authorId,
    payload: record.payload,
    origin: record.origin,
    consoleId: record.consoleId,
    localId: record.localId,
  }
}

/**
 * Read a console payload into a portable snapshot object. The console's raw
 * cursor can return a `jsonb` column as its JSON text, so a string payload is
 * parsed once; anything that is not a JSON object becomes null.
 * @param payload - the console row's payload column.
 * @returns the snapshot object, or null when there is none.
 */
function readSnapshot(payload: unknown): Record<string, unknown> | null {
  const value = typeof payload === 'string'
    ? ((): unknown => { try { return JSON.parse(payload) } catch { return null } })()
    : payload
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * The product sharing service: durable per-action grants with console transport
 * and email acceptance.
 */
export class FaberLoomShares extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof sharesDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - console and acceptance configuration.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomShares')
    this.ctx.effect(() => () => this.closeDomain(), 'faberloom.sharesDomainClose')
  }

  /** Close the lazily opened domain, if any, when the service fiber unloads. */
  private async closeDomain(): Promise<void> {
    if (this.domainPromise === undefined) return
    await (await this.domainPromise).close()
  }

  /** Open the shares domain once and keep its handle. */
  private domain(): Promise<Domain<typeof sharesDomainSpec>> {
    this.domainPromise ??= this.ctx.storageDomain.open(sharesDomainSpec)
    return this.domainPromise
  }

  /** The grants table handle. */
  private async grants(): Promise<KvTable<string, ShareGrantRecord>> {
    return (await this.domain()).table('grants')
  }

  /** The shared-content table handle. */
  private async contentTable(): Promise<KvTable<string, SharedContentRecord>> {
    return (await this.domain()).table('content')
  }

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

  /** The acceptance URL one grantee opens. */
  private acceptUrl(id: string): string {
    const base = this.config.acceptBase !== undefined && this.config.acceptBase.length > 0
      ? this.config.acceptBase
      : `${this.consoleBase() ?? 'mwt-one://share'}/harness/shares/accept`
    return `${base}?grant=${encodeURIComponent(id)}`
  }

  /** Call the console share API with the owner's token, or return undefined when unwired. */
  private async consoleShare(suffix: string, init?: { method?: string; body?: string }): Promise<unknown> {
    const base = this.consoleBase()
    const token = this.consoleToken()
    if (base === undefined || token === undefined) return undefined
    const response = await fetch(`${base}/harness/shares/${suffix}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...init?.body === undefined ? {} : { body: init.body },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`faberloom: la consola rechazó la operación de compartir (${String(response.status)})`)
    if (response.status === 204) return undefined
    return await response.json()
  }

  /** Call the console shared-content API with the owner's token, or return undefined when unwired. */
  private async consoleContent(suffix: string, init?: { method?: string; body?: string }): Promise<unknown> {
    const base = this.consoleBase()
    const token = this.consoleToken()
    if (base === undefined || token === undefined) return undefined
    const response = await fetch(`${base}/harness/contents/${suffix}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...init?.body === undefined ? {} : { body: init.body },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`faberloom: la consola rechazó la operación de contenido (${String(response.status)})`)
    if (response.status === 204) return undefined
    return await response.json()
  }

  /**
   * Create one share grant, notify the grantee by email, and publish it to the
   * console when one is configured. The grant starts `pending`; only an
   * accepted (`active`) grant authorizes an action.
   * @param ownerId - the identity granting access.
   * @param input - resource, resource name, grantee email, and permissions.
   * @returns the created grant.
   * @throws when the grantee email is empty.
   */
  async create(ownerId: string, input: FaberLoomShareInput): Promise<FaberLoomShareGrant> {
    const granteeEmail = input.granteeEmail.trim().toLowerCase()
    if (granteeEmail.length === 0) throw new Error('faberloom: share needs a grantee email')
    const permissions = input.permissions.filter(permission => KNOWN_PERMISSIONS.has(permission))
    if (permissions.length === 0) throw new Error('faberloom: share needs at least one permission')
    const id = randomUUID()
    let record: ShareGrantRecord = {
      ownerId,
      resourceKind: input.resource.kind,
      resourceId: input.resource.id,
      resourceName: input.resourceName,
      granteeEmail,
      permissions,
      status: 'pending',
      snapshot: input.snapshot ?? null,
      consoleId: null,
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    }
    const published = await this.consoleShare('', {
      method: 'POST',
      body: JSON.stringify({
        kind: input.resource.kind,
        // La consola devuelve `resource_id` en las filas de `sync`, así que el
        // grantee importa el grant contra el recurso real y no contra su nombre.
        resource_id: input.resource.id,
        name: input.resourceName,
        payload: input.snapshot ?? {},
        shared_emails: [granteeEmail],
        permissions,
        status: 'pending',
      }),
    })
    const consoleId = published !== null && typeof published === 'object' && typeof (published as { id?: unknown }).id === 'string'
      ? (published as { id: string }).id
      : null
    record = { ...record, consoleId }
    await (await this.grants()).put(id, record)
    // El enlace de aceptación apunta a la fila de la consola (id remoto), que es
    // el único identificador que el invitado puede resolver en su propia consola;
    // el id local sólo existe en el proceso del dueño.
    await this.notify(ownerId, toGrant(id, record), this.acceptUrl(record.consoleId ?? id))
    return toGrant(id, record)
  }

  /** Email one grantee the acceptance link through the owner's SMTP connection. */
  private async notify(ownerId: string, grant: FaberLoomShareGrant, url: string): Promise<void> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return
    const text = `Te compartieron ${grant.resource.kind === 'space' ? 'un Space' : 'un Work Flow'} "${grant.resourceName}" con permisos: ${grant.permissions.join(', ')}.\n\nAcepta aquí: ${url}`
    await connections.sendMail(ownerId, { to: [grant.granteeEmail], subject: `Te compartieron "${grant.resourceName}"`, text })
  }

  /**
   * Accept one pending grant addressed to the grantee; a pending grant becomes
   * active and its permissions start authorizing actions.
   * @param granteeEmail - the identity accepting.
   * @param id - grant id.
   * @returns the accepted grant.
   * @throws when the grant is missing or not addressed to the grantee.
   */
  async accept(granteeEmail: string, id: string): Promise<FaberLoomShareGrant> {
    const table = await this.grants()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: share grant ${id} not found`)
    if (record.granteeEmail !== granteeEmail.trim().toLowerCase()) throw new Error('faberloom: only the grantee can accept this grant')
    const next: ShareGrantRecord = { ...record, status: 'active', acceptedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return toGrant(id, next)
  }

  /**
   * Revoke one grant the actor issued; the next permission check denies it and
   * the console mirror is removed.
   * @param ownerId - the identity that granted access.
   * @param id - grant id.
   * @returns the revoked grant.
   * @throws when the grant is missing or the actor did not issue it.
   */
  async revoke(ownerId: string, id: string): Promise<FaberLoomShareGrant> {
    const table = await this.grants()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: share grant ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the grantor can revoke this share')
    const next: ShareGrantRecord = { ...record, status: 'revoked' }
    await table.update(id, () => next)
    if (record.consoleId !== null) {
      await this.consoleShare(`${encodeURIComponent(record.consoleId)}/`, { method: 'DELETE' }).catch(() => undefined)
    }
    return toGrant(id, next)
  }

  /**
   * List the grants the actor issued and the ones addressed to it.
   * @param actorId - the acting identity (owner or grantee email).
   * @returns the outgoing and incoming grants, oldest first.
   */
  async list(actorId: string): Promise<FaberLoomShareList> {
    const email = actorId.trim().toLowerCase()
    const outgoing: FaberLoomShareGrant[] = []
    const incoming: FaberLoomShareGrant[] = []
    for (const [id, record] of (await this.grants()).entries()) {
      const grant = toGrant(id, record)
      if (record.ownerId === actorId) outgoing.push(grant)
      if (record.granteeEmail === email) incoming.push(grant)
    }
    outgoing.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    incoming.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return { outgoing, incoming }
  }

  /**
   * The portable snapshot attached to one grant the actor holds, so a consumer
   * can materialize the shared resource without a second console read.
   * @param granteeEmail - the identity that holds the grant.
   * @param grantId - grant id (the id `list` returned for the incoming grant).
   * @returns the resource snapshot, or null when the actor holds no such grant.
   */
  async snapshotFor(granteeEmail: string, grantId: string): Promise<Record<string, unknown> | null> {
    const record = (await this.grants()).get(grantId)
    if (record === undefined) return null
    if (record.granteeEmail !== granteeEmail.trim().toLowerCase()) return null
    return readSnapshot(record.snapshot)
  }

  /**
   * Replace the portable snapshot the console holds for one of the actor's
   * Space/Work Flow grants, so a grantee's next sync reads the current content.
   * The grant lifecycle and permissions are untouched. A no-op when the console
   * is not configured, so a local-only deployment keeps working.
   * @param input - resource, display name, and the current snapshot.
   */
  async republish(input: FaberLoomShareRepublishInput): Promise<void> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return
    await this.consoleShare('republish', {
      method: 'POST',
      body: JSON.stringify({
        kind: input.resource.kind,
        resource_id: input.resource.id,
        name: input.resourceName,
        payload: input.snapshot ?? {},
      }),
    })
  }

  /**
   * Change the permissions one existing grant carries without re-inviting the
   * grantee: the console upsert keeps the grant active and only the permission
   * set moves, and the published snapshot is preserved. A no-op when the console
   * is not configured.
   * @param ownerId - the identity that owns the resource.
   * @param resource - the resource the grant names.
   * @param resourceName - the resource display name.
   * @param granteeEmail - the grantee whose permissions change.
   * @param permissions - the new permission set.
   */
  async updatePermissions(
    ownerId: string, resource: FaberLoomShareResource, resourceName: string, granteeEmail: string, permissions: readonly string[],
  ): Promise<void> {
    const email = granteeEmail.trim().toLowerCase()
    const next = permissions.filter(permission => KNOWN_PERMISSIONS.has(permission))
    const table = await this.grants()
    let existing: { id: string; record: ShareGrantRecord } | undefined
    for (const [id, record] of table.entries()) {
      if (record.ownerId !== ownerId || record.granteeEmail !== email) continue
      if (!sameResource({ kind: record.resourceKind, id: record.resourceId }, resource)) continue
      existing = { id, record }
      break
    }
    const payload = readSnapshot(existing?.record.snapshot ?? null) ?? {}
    const published = await this.consoleShare('', {
      method: 'POST',
      body: JSON.stringify({
        kind: resource.kind,
        resource_id: resource.id,
        name: resourceName,
        payload,
        shared_emails: [email],
        permissions: next,
        status: 'active',
      }),
    })
    const consoleId = published !== null && typeof published === 'object' && typeof (published as { id?: unknown }).id === 'string'
      ? (published as { id: string }).id
      : existing?.record.consoleId ?? null
    if (existing !== undefined) {
      const record: ShareGrantRecord = { ...existing.record, permissions: next, status: 'active', consoleId }
      await table.update(existing.id, () => record)
    }
  }

  /**
   * List the permissions one grantee holds on one resource, unioned over every
   * active grant.
   * @param granteeEmail - the identity acting.
   * @param resource - the resource being touched.
   * @returns the active permissions, in display order.
   */
  async permissionsFor(granteeEmail: string, resource: FaberLoomShareResource): Promise<readonly FaberLoomSharePermission[]> {
    const email = granteeEmail.trim().toLowerCase()
    const held = new Set<string>()
    for (const [, record] of (await this.grants()).entries()) {
      if (record.status !== 'active' || record.granteeEmail !== email) continue
      if (!sameResource({ kind: record.resourceKind, id: record.resourceId }, resource)) continue
      for (const permission of record.permissions) held.add(permission)
    }
    return SHARE_PERMISSIONS.filter(permission => held.has(permission))
  }

  /**
   * Whether one grantee may perform one action on one resource. The owner is
   * always allowed; a grantee needs an active grant carrying the permission.
   * @param actorId - the acting identity.
   * @param ownerId - the resource owner.
   * @param resource - the resource being touched.
   * @param permission - the action being authorized.
   * @returns true when the action is authorized.
   */
  async can(actorId: string, ownerId: string, resource: FaberLoomShareResource, permission: FaberLoomSharePermission): Promise<boolean> {
    if (actorId === ownerId) return true
    const email = actorId.trim().toLowerCase()
    for (const [, record] of (await this.grants()).entries()) {
      if (record.status !== 'active' || record.granteeEmail !== email || record.ownerId !== ownerId) continue
      if (!sameResource({ kind: record.resourceKind, id: record.resourceId }, resource)) continue
      if (record.permissions.includes(permission)) return true
    }
    return false
  }

  /**
   * Import the grants the console holds for one grantee and prune the local
   * copies the console no longer carries, so a revoked share stops authorizing
   * here. A no-op when the console is not configured.
   * @param granteeEmail - the identity whose incoming grants are imported.
   */
  async sync(granteeEmail: string): Promise<void> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return
    const data = await this.consoleShare('') as { incoming?: readonly ConsoleShareRow[] }
    const email = granteeEmail.trim().toLowerCase()
    const wanted = new Set<string>()
    for (const row of data.incoming ?? []) {
      if (row.kind !== 'space' && row.kind !== 'workflow') continue
      const resource: FaberLoomShareResource = { kind: row.kind, id: row.resource_id ?? row.name }
      wanted.add(`${row.owner_email}\u0000${row.kind}\u0000${resource.id}\u0000${email}`)
      const existing = (await this.grants()).get(`console:${row.id}`)
      const next: ShareGrantRecord = {
        ownerId: row.owner_email,
        resourceKind: row.kind,
        resourceId: resource.id,
        resourceName: row.name,
        granteeEmail: email,
        permissions: (row.permissions ?? ['view']).filter((permission: string) => KNOWN_PERMISSIONS.has(permission)),
        status: row.status === 'active' ? 'active' : 'pending',
        snapshot: readSnapshot(row.payload),
        consoleId: row.id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        acceptedAt: existing?.acceptedAt ?? null,
      }
      await (await this.grants()).put(`console:${row.id}`, next)
    }
    for (const [id, record] of (await this.grants()).entries()) {
      if (!id.startsWith('console:')) continue
      if (record.granteeEmail !== email) continue
      if (wanted.has(`${record.ownerId}\u0000${record.resourceKind}\u0000${record.resourceId}\u0000${email}`)) continue
      await (await this.grants()).delete(id)
    }
  }

  /**
   * Publish one Space's own Memory/Context/Work Flow/Routine items to the
   * console as this member's full set, so the other members read them, and keep
   * the durable owner rows current. The console write replaces the author's set
   * for the Space, so an item dropped here stops reaching the other members.
   * @param actorId - the publishing identity.
   * @param spaceId - the Space the items belong to.
   * @param items - the member's current items for the Space.
   */
  async publishContent(actorId: string, spaceId: string, items: readonly FaberLoomSharedContentInput[]): Promise<void> {
    const table = await this.contentTable()
    const wanted = new Set(items.map(item => contentKey(item.kind, item.itemKey)))
    const consoleIds = new Map<string, string>()
    if (this.consoleBase() !== undefined && this.consoleToken() !== undefined) {
      const data = await this.consoleContent('', {
        method: 'POST',
        body: JSON.stringify({
          space_id: spaceId,
          items: items.map(item => ({ kind: item.kind, item_key: item.itemKey, payload: item.payload })),
        }),
      }) as { rows?: readonly ConsoleContentRow[] } | undefined
      for (const row of data?.rows ?? []) {
        if (!CONTENT_KINDS.has(row.kind)) continue
        consoleIds.set(contentKey(row.kind as FaberLoomSharedContentKind, row.item_key), row.id)
      }
    }
    for (const item of items) {
      const record: SharedContentRecord = {
        spaceId,
        kind: item.kind,
        itemKey: item.itemKey,
        authorId: actorId,
        payload: item.payload,
        origin: 'owner',
        consoleId: consoleIds.get(contentKey(item.kind, item.itemKey)) ?? null,
        localId: null,
      }
      await table.put(ownedContentKey(spaceId, item.kind, item.itemKey), record)
    }
    for (const [key, record] of table.entries()) {
      if (record.origin !== 'owner' || record.authorId !== actorId || record.spaceId !== spaceId) continue
      if (wanted.has(contentKey(record.kind, record.itemKey))) continue
      await table.delete(key)
    }
  }

  /**
   * List the shared-content items one Space carries for one member: the
   * member's own items and the ones imported for it from the console.
   * @param actorId - the member reading.
   * @param spaceId - the Space being read.
   * @returns the rows.
   */
  async listContent(actorId: string, spaceId: string): Promise<readonly FaberLoomSharedContentRow[]> {
    const prefix = importedContentPrefix(actorId)
    const out: FaberLoomSharedContentRow[] = []
    for (const [key, record] of (await this.contentTable()).entries()) {
      if (record.spaceId !== spaceId) continue
      if (record.origin === 'owner') {
        if (record.authorId !== actorId) continue
      } else if (!key.startsWith(prefix)) {
        continue
      }
      out.push(toContentRow(record))
    }
    return out
  }

  /**
   * The logical keys other members published in one Space and this member
   * imported. A member excludes them when publishing, so an imported copy is
   * never echoed back as its own.
   * @param actorId - the member reading.
   * @param spaceId - the Space being read.
   * @returns the imported `kind\itemKey` keys.
   */
  async importedContentKeys(actorId: string, spaceId: string): Promise<ReadonlySet<string>> {
    const prefix = importedContentPrefix(actorId)
    const keys = new Set<string>()
    for (const [key, record] of (await this.contentTable()).entries()) {
      if (record.origin !== 'console' || record.spaceId !== spaceId) continue
      if (!key.startsWith(prefix)) continue
      keys.add(contentKey(record.kind, record.itemKey))
    }
    return keys
  }

  /**
   * The ids of the local copies this member materialized for the items other
   * members shared, across every Space. A panel marks those rows read-only, so
   * a member cannot delete content the author still owns.
   * @param actorId - the member reading.
   * @returns the imported local copy ids.
   */
  async importedLocalIds(actorId: string): Promise<ReadonlySet<string>> {
    const prefix = importedContentPrefix(actorId)
    const ids = new Set<string>()
    for (const [key, record] of (await this.contentTable()).entries()) {
      if (record.origin !== 'console' || !key.startsWith(prefix)) continue
      if (record.localId !== null) ids.add(record.localId)
    }
    return ids
  }

  /**
   * The local copies this member materialized for other members' items, keyed
   * by local copy id, so a panel can decide whether the member holds the
   * module permission that lets it remove the copy.
   * @param actorId - the member reading.
   * @returns local copy id → its Space and resource family.
   */
  async importedLocalCopies(
    actorId: string,
  ): Promise<ReadonlyMap<string, { spaceId: string; kind: FaberLoomSharedContentKind }>> {
    const prefix = importedContentPrefix(actorId)
    const out = new Map<string, { spaceId: string; kind: FaberLoomSharedContentKind }>()
    for (const [key, record] of (await this.contentTable()).entries()) {
      if (record.origin !== 'console' || !key.startsWith(prefix)) continue
      if (record.localId !== null) out.set(record.localId, { spaceId: record.spaceId, kind: record.kind })
    }
    return out
  }

  /**
   * Record the id of the local copy a member materialized for one imported
   * console row, so a later sync removes the copy when its author withdraws the
   * item. A missing row is ignored.
   * @param readerId - the member that materialized the copy.
   * @param consoleId - the console-side row id.
   * @param localId - the id of the local copy.
   */
  async noteContentLocal(readerId: string, consoleId: string, localId: string): Promise<void> {
    const table = await this.contentTable()
    const key = `${importedContentPrefix(readerId)}${consoleId}`
    if (table.get(key) === undefined) return
    await table.update(key, record => ({ ...record, localId }))
  }

  /**
   * Forget the local copy a member materialized for one imported console row, so
   * a later sync materializes it again once the member regains the view
   * permission. A missing row is ignored.
   * @param readerId - the member that materialized the copy.
   * @param consoleId - the console-side row id.
   */
  async clearContentLocal(readerId: string, consoleId: string): Promise<void> {
    const table = await this.contentTable()
    const key = `${importedContentPrefix(readerId)}${consoleId}`
    if (table.get(key) === undefined) return
    await table.update(key, record => ({ ...record, localId: null }))
  }

  /**
   * Import the console's shared-content rows for one member and prune the local
   * rows the console no longer carries, so a withdrawn item stops showing. A
   * no-op when the console is not configured. The reader reads back the removed
   * rows (with their `localId`) before this runs, so it can delete the
   * materialized copies.
   * @param readerId - the identity whose incoming items are imported.
   */
  async syncContent(readerId: string): Promise<void> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return
    const data = await this.consoleContent('') as { incoming?: readonly ConsoleContentRow[] }
    const table = await this.contentTable()
    const prefix = importedContentPrefix(readerId)
    const wanted = new Set<string>()
    for (const row of data.incoming ?? []) {
      if (!CONTENT_KINDS.has(row.kind)) continue
      const key = `${prefix}${row.id}`
      wanted.add(key)
      const existing = table.get(key)
      const record: SharedContentRecord = {
        spaceId: row.space_id,
        kind: row.kind as FaberLoomSharedContentKind,
        itemKey: row.item_key,
        authorId: row.author_email,
        payload: readSnapshot(row.payload) ?? {},
        origin: 'console',
        consoleId: row.id,
        localId: existing?.localId ?? null,
      }
      await table.put(key, record)
    }
    for (const [key] of table.entries()) {
      if (!key.startsWith(prefix)) continue
      if (wanted.has(key)) continue
      await table.delete(key)
    }
  }
}

/** One console share row the import reads. */
interface ConsoleShareRow {
  /** Console-side share id. */
  readonly id: string
  /** Resource family. */
  readonly kind: string
  /** Owner email. */
  readonly owner_email: string
  /** Display name. */
  readonly name: string
  /** Resource id, when the console carries it. */
  readonly resource_id?: string
  /** Portable resource content. */
  readonly payload?: unknown
  /** Granted permissions. */
  readonly permissions?: readonly string[]
  /** Console-side status. */
  readonly status?: string
}

/** One console shared-content row the import reads. */
interface ConsoleContentRow {
  /** Console-side row id. */
  readonly id: string
  /** Space the item belongs to. */
  readonly space_id: string
  /** Resource family. */
  readonly kind: string
  /** Stable key within its family. */
  readonly item_key: string
  /** Author email. */
  readonly author_email: string
  /** Portable item content. */
  readonly payload?: unknown
}

export default FaberLoomShares
