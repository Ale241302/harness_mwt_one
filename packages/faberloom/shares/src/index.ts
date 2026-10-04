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
import { SHARE_PERMISSIONS, type FaberLoomShareGrant, type FaberLoomShareInput, type FaberLoomShareList, type FaberLoomSharePermission, type FaberLoomShareResource } from './types.ts'
import { sharesDomainSpec, type ShareGrantRecord } from './spec.ts'
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
  }

  /** Open the shares domain once and keep its handle. */
  private domain(): Promise<Domain<typeof sharesDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(sharesDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.sharesDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  /** The grants table handle. */
  private async grants(): Promise<KvTable<string, ShareGrantRecord>> {
    return (await this.domain()).table('grants')
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
    await this.notify(ownerId, toGrant(id, record), this.acceptUrl(id))
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
   * List the permissions one grantee holds on one resource, unioned over every
   * active grant.
   * @param granteeEmail - the identity acting.
   * @param resource - the resource being touched.
   * @returns the active permissions, in display order.
   */
  async permissionsFor(granteeEmail: string, resource: FaberLoomShareResource): Promise<readonly FaberLoomSharePermission[]> {
    const email = granteeEmail.trim().toLowerCase()
    const held = new Set<FaberLoomSharePermission>()
    for (const [, record] of (await this.grants()).entries()) {
      if (record.status !== 'active' || record.granteeEmail !== email) continue
      if (!sameResource({ kind: record.resourceKind, id: record.resourceId }, resource)) continue
      for (const permission of record.permissions) {
        if (KNOWN_PERMISSIONS.has(permission)) held.add(permission as FaberLoomSharePermission)
      }
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
        snapshot: row.payload ?? null,
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
  readonly payload?: Record<string, unknown>
  /** Granted permissions. */
  readonly permissions?: readonly string[]
  /** Console-side status. */
  readonly status?: string
}

export default FaberLoomShares
