/**
 * Workspace/Space Context (`ctx.faberloomContext`): a durable, versioned and
 * approvable store of the facts and rules a Space shares, separate from the
 * episodic Memory. The Space owner indexes a member's contribution into the
 * shared context (`shared`), leaves it private to the member (`local`), or sees
 * it waiting for a decision (`pending`); every change appends an immutable
 * version so any earlier context can be restored. Records are durable through
 * `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-context
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-spaces'
import type {} from '@deepseek-ai/dsh-faberloom-shares'
import { contextDomainSpec, type ContextEntryRecord, type ContextVersionRecord } from './spec.ts'
import type {
  FaberLoomContextEdit,
  FaberLoomContextEntry,
  FaberLoomContextInput,
  FaberLoomContextVersion,
} from './types.ts'

export type * from './types.ts'

/** The acting identity every context call carries. */
export interface FaberLoomContextActor {
  /** Signed-in email. */
  readonly id: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomContext: FaberLoomContext
  }
}

/** Map one durable record to the consumer-facing entry. */
function toEntry(id: string, record: ContextEntryRecord): FaberLoomContextEntry {
  return {
    id,
    spaceId: record.spaceId,
    title: record.title,
    body: record.body,
    version: record.version,
    visibility: record.visibility,
    authorId: record.authorId,
    ownerId: record.ownerId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Map one durable version row to the consumer-facing version. */
function toVersion(record: ContextVersionRecord): FaberLoomContextVersion {
  return {
    version: record.version,
    title: record.title,
    body: record.body,
    authorId: record.authorId,
    createdAt: record.createdAt,
  }
}

/** Whether an actor may read one entry. */
function visible(record: ContextEntryRecord, actorId: string): boolean {
  return record.visibility === 'shared' || record.authorId === actorId || record.ownerId === actorId
}

/**
 * The Workspace/Space Context service: versioned entries with an owner
 * approval gate.
 */
export class FaberLoomContext extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof contextDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomContext')
    this.ctx.effect(() => () => this.closeDomain(), 'faberloom.contextDomainClose')
  }

  /** Close the lazily opened domain, if any, when the service fiber unloads. */
  private async closeDomain(): Promise<void> {
    if (this.domainPromise === undefined) return
    await (await this.domainPromise).close()
  }

  /** Open the context domain once and keep its handle. */
  private domain(): Promise<Domain<typeof contextDomainSpec>> {
    this.domainPromise ??= this.ctx.storageDomain.open(contextDomainSpec)
    return this.domainPromise
  }

  /** The entries table handle. */
  private async entries(): Promise<KvTable<string, ContextEntryRecord>> {
    return (await this.domain()).table('entries')
  }

  /** The versions table handle, keyed by `${entryId}:${version}`. */
  private async versionsTable(): Promise<KvTable<string, ContextVersionRecord>> {
    return (await this.domain()).table('versions')
  }

  /** Append one immutable version row for an entry. */
  private async appendVersion(id: string, record: ContextEntryRecord, authorId: string, at: string): Promise<void> {
    await (await this.versionsTable()).put(`${id}:${String(record.version)}`, {
      entryId: id,
      version: record.version,
      title: record.title,
      body: record.body,
      authorId,
      createdAt: at,
    })
  }

  /**
   * Decide the visibility and owner one new entry gets for an actor: a personal
   * entry stays `local`; a Space entry is `shared` for its owner or a member
   * holding `index-context`, and `pending` for anyone else.
   */
  private async placement(actor: FaberLoomContextActor, spaceId: string | null): Promise<{ visibility: ContextEntryRecord['visibility']; ownerId: string }> {
    if (spaceId === null) return { visibility: 'local', ownerId: actor.id }
    const spaces = this.ctx.get('faberloomSpaces')
    const space = spaces === undefined ? undefined : await spaces.get(actor as never, spaceId as never).catch(() => undefined)
    const ownerId = space?.ownerId ?? actor.id
    if (ownerId === actor.id) return { visibility: 'shared', ownerId }
    const shares = this.ctx.get('faberloomShares')
    const allowed = shares === undefined ? false : await shares.can(actor.id, ownerId, { kind: 'space', id: spaceId }, 'index-context')
    return { visibility: allowed ? 'shared' : 'pending', ownerId }
  }

  /** Read one entry the actor may see, or fail loud. */
  private async requireVisible(actor: FaberLoomContextActor, id: string): Promise<ContextEntryRecord> {
    const record = (await this.entries()).get(id)
    if (record === undefined) throw new Error(`faberloom: context ${id} not found`)
    if (!visible(record, actor.id)) throw new Error('faberloom: context access denied')
    return record
  }

  /**
   * Create one context entry.
   * @param actor - the acting identity.
   * @param input - title, body, and optional Space.
   * @returns the created entry.
   */
  async create(actor: FaberLoomContextActor, input: FaberLoomContextInput): Promise<FaberLoomContextEntry> {
    const spaceId = input.spaceId ?? null
    const { visibility, ownerId } = await this.placement(actor, spaceId)
    const at = new Date().toISOString()
    const id = randomUUID()
    const record: ContextEntryRecord = {
      spaceId, title: input.title, body: input.body, version: 1, visibility,
      authorId: actor.id, ownerId, createdAt: at, updatedAt: at,
    }
    await (await this.entries()).put(id, record)
    await this.appendVersion(id, record, actor.id, at)
    return toEntry(id, record)
  }

  /**
   * List every context entry the actor may see, newest first.
   * @param actor - the acting identity.
   * @returns the visible entries.
   */
  async list(actor: FaberLoomContextActor): Promise<readonly FaberLoomContextEntry[]> {
    const rows: FaberLoomContextEntry[] = []
    for (const [id, record] of (await this.entries()).entries()) {
      if (visible(record, actor.id)) rows.push(toEntry(id, record))
    }
    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Read one entry.
   * @param actor - the acting identity.
   * @param id - entry id.
   * @returns the entry.
   */
  async get(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry> {
    return toEntry(id, await this.requireVisible(actor, id))
  }

  /**
   * Edit one entry, appending a version. A member's edit returns the entry to
   * `pending` until the owner approves it again.
   * @param actor - the acting identity.
   * @param id - entry id.
   * @param edit - the new title and/or body.
   * @returns the updated entry.
   */
  async update(actor: FaberLoomContextActor, id: string, edit: FaberLoomContextEdit): Promise<FaberLoomContextEntry> {
    const record = await this.requireVisible(actor, id)
    if (record.authorId !== actor.id && record.ownerId !== actor.id) throw new Error('faberloom: context edit denied')
    const at = new Date().toISOString()
    const saved: ContextEntryRecord = {
      ...record,
      title: edit.title ?? record.title,
      body: edit.body ?? record.body,
      version: record.version + 1,
      visibility: actor.id === record.ownerId ? (record.spaceId === null ? 'local' : 'shared') : 'pending',
      updatedAt: at,
    }
    await (await this.entries()).put(id, saved)
    await this.appendVersion(id, saved, actor.id, at)
    return toEntry(id, saved)
  }

  /**
   * List one entry's version history, newest first.
   * @param actor - the acting identity.
   * @param id - entry id.
   * @returns the versions.
   */
  async versions(actor: FaberLoomContextActor, id: string): Promise<readonly FaberLoomContextVersion[]> {
    await this.requireVisible(actor, id)
    const rows: FaberLoomContextVersion[] = []
    for (const [, record] of (await this.versionsTable()).entries()) {
      if (record.entryId === id) rows.push(toVersion(record))
    }
    return rows.sort((left, right) => right.version - left.version)
  }

  /**
   * Restore one entry to an earlier version, appending a fresh version.
   * @param actor - the acting identity.
   * @param id - entry id.
   * @param version - version to restore.
   * @returns the restored entry.
   */
  async restore(actor: FaberLoomContextActor, id: string, version: number): Promise<FaberLoomContextEntry> {
    const record = await this.requireVisible(actor, id)
    if (record.authorId !== actor.id && record.ownerId !== actor.id) throw new Error('faberloom: context edit denied')
    const target = (await this.versionsTable()).get(`${id}:${String(version)}`)
    if (target === undefined) throw new Error(`faberloom: context version ${String(version)} not found`)
    const at = new Date().toISOString()
    const saved: ContextEntryRecord = {
      ...record, title: target.title, body: target.body, version: record.version + 1, updatedAt: at,
    }
    await (await this.entries()).put(id, saved)
    await this.appendVersion(id, saved, actor.id, at)
    return toEntry(id, saved)
  }

  /**
   * Index one entry into the Space's shared context (owner only).
   * @param actor - the acting identity.
   * @param id - entry id.
   * @returns the approved entry.
   */
  async approve(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry> {
    const record = await this.requireVisible(actor, id)
    if (record.ownerId !== actor.id) throw new Error('faberloom: only the Space owner may approve context')
    const saved: ContextEntryRecord = { ...record, visibility: 'shared', updatedAt: new Date().toISOString() }
    await (await this.entries()).put(id, saved)
    return toEntry(id, saved)
  }

  /**
   * Keep one entry private to its author, out of the shared context (owner only).
   * @param actor - the acting identity.
   * @param id - entry id.
   * @returns the entry.
   */
  async reject(actor: FaberLoomContextActor, id: string): Promise<FaberLoomContextEntry> {
    const record = await this.requireVisible(actor, id)
    if (record.ownerId !== actor.id) throw new Error('faberloom: only the Space owner may reject context')
    const saved: ContextEntryRecord = { ...record, visibility: 'local', updatedAt: new Date().toISOString() }
    await (await this.entries()).put(id, saved)
    return toEntry(id, saved)
  }

  /**
   * Remove one entry and its history (author or owner).
   * @param actor - the acting identity.
   * @param id - entry id.
   * @returns true when removed.
   */
  async remove(actor: FaberLoomContextActor, id: string): Promise<boolean> {
    const record = await this.requireVisible(actor, id)
    if (record.authorId !== actor.id && record.ownerId !== actor.id) throw new Error('faberloom: context delete denied')
    await (await this.entries()).delete(id)
    for (const [key, version] of (await this.versionsTable()).entries()) {
      if (version.entryId === id) await (await this.versionsTable()).delete(key)
    }
    return true
  }
}

export default FaberLoomContext
