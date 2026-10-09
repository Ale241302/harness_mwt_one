/**
 * Workspace/Space Context (`ctx.faberloomContext`): a durable, versioned and
 * approvable store of the facts and rules a Space shares, separate from the
 * episodic Memory. The Space owner indexes a member's contribution into the
 * shared context (`shared`), leaves it private to the member (`local`), or sees
 * it waiting for a decision (`pending`); every change appends an immutable
 * version so any earlier context can be restored. A member's Space entry is
 * published to the MWT.ONE console and the owner's process imports it as
 * `pending`, so approval crosses hosts. Records are durable through
 * `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-context
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-spaces'
import type {} from '@deepseek-ai/dsh-faberloom-shares'
import { contextDomainSpec, type ContextEntryRecord, type ContextVersionRecord } from './spec.ts'
import type {
  FaberLoomContextEdit,
  FaberLoomContextEntry,
  FaberLoomContextExport,
  FaberLoomContextExportEntry,
  FaberLoomContextExportOptions,
  FaberLoomContextImportResult,
  FaberLoomContextInput,
  FaberLoomContextReplaceEntry,
  FaberLoomContextVersion,
} from './types.ts'

/**
 * Render one context record as Markdown: a heading per entry with its title and
 * version, then its body.
 * @param entries - the exported entries.
 * @returns the Markdown body.
 */
function renderMarkdown(entries: readonly FaberLoomContextExportEntry[]): string {
  const sections = entries.map(entry => `## ${entry.title} (v${String(entry.version)})\n\n${entry.body}\n`)
  return ['# FaberLoom · contexto', '', ...sections].join('\n')
}

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

/** Deployment-supplied console configuration for cross-host context sharing. */
export interface Config {
  /** MWT.ONE console base URL; empty falls back to `CONSOLA_API_BASE`. */
  consoleBase?: string
  /** Console bearer token; empty falls back to `CONSOLA_TOKEN`. */
  consoleToken?: string
}

/** Schemastery configuration for the context service. */
export const Config: z<Config> = z.object({
  consoleBase: z.string().default(''),
  consoleToken: z.string().default(''),
})

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

/** Whether an actor may read one entry: its author, its owner, or a readable Space's shared entry. */
function visible(record: ContextEntryRecord, actorId: string, readable: ReadonlySet<string> | undefined): boolean {
  if (record.authorId === actorId || record.ownerId === actorId) return true
  if (record.visibility !== 'shared') return false
  if (record.spaceId === null) return true
  return readable === undefined || readable.has(record.spaceId)
}

/** The imported-row key prefix for one reader. */
function importedPrefix(readerId: string): string {
  return `console:${readerId}\u0000`
}

/**
 * The Workspace/Space Context service: versioned entries with an owner
 * approval gate and console transport.
 */
export class FaberLoomContext extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof contextDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - console configuration.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
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

  /* jscpd:ignore-start -- deliberately mirrors the shares and session-shares
     console resolution: the two keys, their environment fallbacks, and the
     base/token contract are shared across the console transport. */
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

  /** Call the console context API with the owner's token, or return undefined when unwired. */
  private async consoleContext(suffix: string, init?: { method?: string; body?: string }): Promise<unknown> {
    const base = this.consoleBase()
    const token = this.consoleToken()
    /* v8 ignore next -- callers (publish, sync, remove) only reach the console once it is wired; this re-check is defensive. */
    if (base === undefined || token === undefined) return undefined
    /* jscpd:ignore-start -- mirrors the shares and session-shares console call:
       the same headers, timeout, non-ok contract, and 204 handling. */
    const response = await fetch(`${base}/harness/context/${suffix}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...init?.body === undefined ? {} : { body: init.body },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`faberloom: la consola rechazó la operación de contexto (${String(response.status)})`)
    if (response.status === 204) return undefined
    return await response.json()
    /* jscpd:ignore-end */
  }

  /** Publish one entry's state to the console and return its console id. */
  private async publish(record: ContextEntryRecord, consoleId: string | null): Promise<string | null> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return consoleId
    const published = await this.consoleContext(consoleId === null ? '' : `${encodeURIComponent(consoleId)}/`, {
      method: 'POST',
      body: JSON.stringify({
        space_id: record.spaceId,
        owner_email: record.ownerId,
        author_email: record.authorId,
        title: record.title,
        body: record.body,
        version: record.version,
        status: record.visibility,
      }),
    })
    return published !== null && typeof published === 'object' && typeof (published as { id?: unknown }).id === 'string'
      ? (published as { id: string }).id
      : consoleId
  }

  /**
   * Decide the visibility and owner one new entry gets for an actor: a personal
   * entry stays `local`; a Space entry is `shared` for its owner or a member
   * holding `index-context`, and `pending` for anyone else.
   */
  private async placement(actor: FaberLoomContextActor, spaceId: string | null): Promise<{ visibility: ContextEntryRecord['visibility']; ownerId: string }> {
    if (spaceId === null) return { visibility: 'local', ownerId: actor.id }
    const spaces = this.ctx.get('faberloomSpaces')
    // Without the spaces service there is no owner to resolve; the bare
    // composition keeps the historical actor-is-owner behavior.
    if (spaces === undefined) return { visibility: 'shared', ownerId: actor.id }
    // Resolve the Space through its read ACL: an entry cannot be placed into a
    // Space the actor may not read, so a non-member never becomes its owner.
    const space = await spaces.get(actor as never, spaceId as never)
    const ownerId = space.ownerId
    if (ownerId === actor.id) return { visibility: 'shared', ownerId }
    const shares = this.ctx.get('faberloomShares')
    const allowed = shares === undefined ? false : await shares.can(actor.id, ownerId, { kind: 'space', id: spaceId }, 'index-context')
    return { visibility: allowed ? 'shared' : 'pending', ownerId }
  }

  /**
   * The Space ids whose entries the actor may read, or `undefined` when no
   * spaces service is mounted (the bare composition reads every shared entry).
   */
  private async readableSpaces(actor: FaberLoomContextActor): Promise<ReadonlySet<string> | undefined> {
    const spaces = this.ctx.get('faberloomSpaces')
    if (spaces === undefined) return undefined
    const readable = new Set<string>()
    for (const [, record] of (await this.entries()).entries()) {
      const spaceId = record.spaceId
      if (spaceId === null || readable.has(spaceId)) continue
      const space = await spaces.get(actor as never, spaceId as never).catch(() => undefined)
      if (space !== undefined) readable.add(spaceId)
    }
    return readable
  }

  /** Read one entry the actor may see, or fail loud. */
  private async requireVisible(actor: FaberLoomContextActor, id: string): Promise<ContextEntryRecord> {
    const record = (await this.entries()).get(id)
    if (record === undefined) throw new Error(`faberloom: context ${id} not found`)
    if (!visible(record, actor.id, await this.readableSpaces(actor))) throw new Error('faberloom: context access denied')
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
    let record: ContextEntryRecord = {
      spaceId, title: input.title, body: input.body, version: 1, visibility,
      authorId: actor.id, ownerId, createdAt: at, updatedAt: at, origin: 'local', consoleId: null,
    }
    // A member's Space entry crosses hosts; the owner's own stays local.
    if (spaceId !== null && ownerId !== actor.id) {
      record = { ...record, consoleId: await this.publish(record, null) }
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
    const readable = await this.readableSpaces(actor)
    const rows: FaberLoomContextEntry[] = []
    for (const [id, record] of (await this.entries()).entries()) {
      if (visible(record, actor.id, readable)) rows.push(toEntry(id, record))
    }
    return rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * List the context entries attached to one Space that the actor may read,
   * newest first. Visibility is the same as {@link list}: a `shared` entry is
   * visible to any reader, while a `local` or `pending` entry is visible only
   * to its author and the Space owner.
   * @param actor - the acting identity.
   * @param spaceId - the Space whose entries are read.
   * @returns the visible entries of that Space.
   */
  async listForSpace(actor: FaberLoomContextActor, spaceId: string): Promise<readonly FaberLoomContextEntry[]> {
    return (await this.list(actor)).filter(entry => entry.spaceId === spaceId)
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
    const owner = actor.id === record.ownerId
    let saved: ContextEntryRecord = {
      ...record,
      title: edit.title ?? record.title,
      body: edit.body ?? record.body,
      version: record.version + 1,
      visibility: owner ? (record.spaceId === null ? 'local' : 'shared') : 'pending',
      updatedAt: at,
    }
    if (saved.spaceId !== null && saved.ownerId !== actor.id) {
      saved = { ...saved, consoleId: await this.publish(saved, saved.consoleId) }
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
    /* jscpd:ignore-start -- mirrors reject's owner decision below; the two differ only by the visibility they set. */
    const record = await this.requireVisible(actor, id)
    if (record.ownerId !== actor.id) throw new Error('faberloom: only the Space owner may approve context')
    let saved: ContextEntryRecord = { ...record, visibility: 'shared', updatedAt: new Date().toISOString() }
    if (saved.consoleId !== null) saved = { ...saved, consoleId: await this.publish(saved, saved.consoleId) }
    await (await this.entries()).put(id, saved)
    return toEntry(id, saved)
    /* jscpd:ignore-end */
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
    let saved: ContextEntryRecord = { ...record, visibility: 'local', updatedAt: new Date().toISOString() }
    if (saved.consoleId !== null) saved = { ...saved, consoleId: await this.publish(saved, saved.consoleId) }
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
    if (record.consoleId !== null) {
      await this.consoleContext(`${encodeURIComponent(record.consoleId)}/`, { method: 'DELETE' }).catch(() => undefined)
    }
    await (await this.entries()).delete(id)
    for (const [key, version] of (await this.versionsTable()).entries()) {
      if (version.entryId === id) await (await this.versionsTable()).delete(key)
    }
    return true
  }

  /**
   * Export one context record: the entries the actor may read, optionally
   * restricted to one Space, with each entry's version history. JSON is the
   * default; Markdown renders one section per entry.
   * @param actor - the acting identity.
   * @param options - the optional Space and format.
   * @returns the export body and suggested file name.
   */
  async export(actor: FaberLoomContextActor, options: FaberLoomContextExportOptions = {}): Promise<FaberLoomContextExport> {
    const scoped = (await this.list(actor)).filter(entry => options.spaceId === undefined || entry.spaceId === options.spaceId)
    const entries: FaberLoomContextExportEntry[] = []
    for (const entry of scoped) {
      entries.push({
        id: entry.id,
        spaceId: entry.spaceId,
        title: entry.title,
        body: entry.body,
        version: entry.version,
        authorId: entry.authorId,
        updatedAt: entry.updatedAt,
        versions: await this.versions(actor, entry.id),
      })
    }
    const format = options.format ?? 'json'
    const content = format === 'markdown'
      ? renderMarkdown(entries)
      : JSON.stringify({ schemaVersion: 1, spaceId: options.spaceId ?? null, exportedAt: new Date().toISOString(), entries }, null, 2)
    return {
      filename: `faberloom-context-${options.spaceId ?? 'personal'}.${format === 'markdown' ? 'md' : 'json'}`,
      content,
      entries: entries.length,
    }
  }

  /**
   * Import a context record produced by {@link export}. Each entry whose title
   * does not already exist in its Space is created under the actor's placement
   * (an owner writes shared, a member's entry starts pending); an equal title
   * is skipped, so importing the same record twice is idempotent.
   * @param actor - the acting identity.
   * @param payload - the export body.
   * @returns the created and skipped counts.
   */
  async import(actor: FaberLoomContextActor, payload: string): Promise<FaberLoomContextImportResult> {
    let parsed: unknown
    try { parsed = JSON.parse(payload) } catch { throw new Error('faberloom: el contexto importado no es JSON válido') }
    const data = parsed as { schemaVersion?: unknown; entries?: unknown }
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) throw new Error('faberloom: el formato del contexto importado no está soportado')
    const existing = await this.list(actor)
    // Track titles seen in the existing record and earlier in this payload, so a
    // payload repeating a title imports it once.
    const seen = new Set(existing.map(entry => `${entry.spaceId ?? ''}\u0000${entry.title}`))
    let created = 0
    let skipped = 0
    for (const row of data.entries as readonly { title?: unknown; body?: unknown; spaceId?: unknown }[]) {
      const title = typeof row.title === 'string' ? row.title : ''
      const body = typeof row.body === 'string' ? row.body : ''
      const spaceId = typeof row.spaceId === 'string' ? row.spaceId : null
      const key = `${spaceId ?? ''}\u0000${title}`
      if (title.length === 0 || seen.has(key)) {
        skipped += 1
        continue
      }
      await this.create(actor, { title, body, spaceId })
      seen.add(key)
      created += 1
    }
    return { created, skipped }
  }

  /**
   * Replace one Space's context record wholesale (owner only): entries whose
   * title is not in the new set are removed, a retained title gets a new
   * version, and a new title is created.
   * @param actor - the acting identity.
   * @param spaceId - the Space whose record is replaced.
   * @param entries - the new full set of title and body.
   * @returns the resulting entries.
   */
  async replace(
    actor: FaberLoomContextActor,
    spaceId: string,
    entries: readonly FaberLoomContextReplaceEntry[],
  ): Promise<readonly FaberLoomContextEntry[]> {
    const { ownerId } = await this.placement(actor, spaceId)
    if (ownerId !== actor.id) throw new Error('faberloom: only the Space owner may replace context')
    const wanted = new Set(entries.map(entry => entry.title))
    for (const existing of (await this.list(actor)).filter(entry => entry.spaceId === spaceId)) {
      if (!wanted.has(existing.title)) await this.remove(actor, existing.id)
    }
    const result: FaberLoomContextEntry[] = []
    for (const input of entries) {
      const existing = (await this.list(actor)).find(entry => entry.spaceId === spaceId && entry.title === input.title)
      result.push(existing === undefined
        ? await this.create(actor, { spaceId, title: input.title, body: input.body })
        : await this.update(actor, existing.id, { body: input.body }))
    }
    return result
  }

  /**
   * Import the console's shared context for one owner and prune the imported
   * rows the console no longer carries. Each imported row lands `pending` so the
   * owner decides whether to index it. A no-op when the console is not wired.
   * @param readerId - the Space owner importing its members' context.
   */
  async sync(readerId: string): Promise<void> {
    if (this.consoleBase() === undefined || this.consoleToken() === undefined) return
    const data = await this.consoleContext('') as { incoming?: readonly ConsoleContextRow[] }
    const table = await this.entries()
    const wanted = new Set<string>()
    /* jscpd:ignore-start -- mirrors the session-shares import and prune: the
       same upsert-and-prune shape over one reader's imported rows. */
    for (const row of data.incoming ?? []) {
      wanted.add(`${readerId}\u0000${row.id}`)
      const existing = table.get(`${importedPrefix(readerId)}${row.id}`)
      const at = new Date().toISOString()
      const record: ContextEntryRecord = {
        spaceId: row.space_id,
        title: row.title ?? '',
        body: row.body ?? '',
        version: typeof row.version === 'number' ? row.version : 1,
        visibility: row.status === 'shared' ? 'shared' : row.status === 'local' ? 'local' : 'pending',
        authorId: row.author_email,
        ownerId: readerId,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
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
    /* jscpd:ignore-end */
  }
}

/** One console context row the import reads. */
interface ConsoleContextRow {
  /** Console-side row id. */
  readonly id: string
  /** Space the entry belongs to. */
  readonly space_id: string
  /** Author email. */
  readonly author_email: string
  /** Display title. */
  readonly title?: string
  /** Context body. */
  readonly body?: string
  /** Version number. */
  readonly version?: number
  /** Console-side visibility. */
  readonly status?: string
}

export default FaberLoomContext
