/**
 * Native product spaces (`ctx.faberloomSpaces`): thematic spaces, sub-spaces,
 * configurable inheritance with explicit exclusions, the isolated personal
 * scope, opaque work-directory references, audience preview, and console-role
 * access control. Records are durable through `ctx.storageDomain`; reads are
 * synchronous from memory and writes resolve after durability.
 * @module @deepseek-ai/dsh-faberloom-spaces
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { spacesDomainSpec, type SpaceFileRecord, type SpaceMemoryRecord, type SpaceRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: pulls the shares service's Context merge for the access check.
import type {} from '@deepseek-ai/dsh-faberloom-shares'
import type {
  CreateSpaceInput,
  FaberLoomSpaceMemory,
  EffectiveContext,
  EffectiveContextConflict,
  FaberLoomSpace,
  FaberLoomSpaceId,
  ImportSharedSpaceInput,
  LinkPreview,
  PersonalScope,
  SpaceActor,
  SpaceContext,
  SpaceFile,
  SpaceFileContent,
  SpaceFileInput,
  SpaceIndex,
  SpaceIndexEntry,
  SpaceMatch,
  SpaceReference,
  SpaceSource,
  UpdateSpaceInput,
  WorkdirReference,
} from './types.ts'

/** Largest file this slice stores inline in the domain (1 MiB). */
const MAX_FILE_BYTES = 1_000_000

/** Score added when a query token matches the space title. */
const TITLE_WEIGHT = 3

/** Score added when a query token matches a space context value or memory entry. */
const CONTEXT_WEIGHT = 2

/**
 * Fold one text for language-tolerant comparison: lowercased in Spanish and
 * stripped of combining diacritics, so `Cartón` and `carton` match.
 * @param value - the text to fold.
 * @returns the folded text.
 */
function foldText(value: string): string {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/**
 * Split a query into folded, non-empty terms.
 * @param query - the raw query text.
 * @returns the folded terms.
 */
function normalizeTerms(query: string): string[] {
  return foldText(query).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0)
}

/** The space fields the lexical ranker scores. */
type SpaceScoreTarget = { title: string; context: SpaceContext }

/**
 * Score one space against the query terms: each term contributes the title
 * weight for a title hit and the context weight for a context or memory hit.
 * @param target - the space title and context to score.
 * @param memoryText - the folded text of the space's effective memory.
 * @param tokens - the folded query terms.
 * @returns the total score and the matched field names.
 */
function scoreSpace(target: SpaceScoreTarget, memoryText: string, tokens: readonly string[]): { score: number; reasons: string[] } {
  const title = foldText(target.title)
  const context = foldText(Object.values(target.context).join(' '))
  const memory = foldText(memoryText)
  let score = 0
  const reasons = new Set<string>()
  for (const token of tokens) {
    if (title.includes(token)) { score += TITLE_WEIGHT; reasons.add('title') }
    if (context.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('context') }
    if (memory.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('memory') }
  }
  return { score, reasons: [...reasons] }
}

/**
 * The built-in lexical ranker, used when no `ctx.spaceIndex` provider is
 * mounted. It scores each entry and orders by score, then most recent first.
 * @param entries - readable candidate entries.
 * @param query - free-text query; an empty query lists recent entries.
 * @param limit - most matches to return.
 * @returns matches, best score first, then most recent first.
 */
function rankLexically(entries: readonly SpaceIndexEntry[], query: string, limit: number): SpaceMatch[] {
  const tokens = normalizeTerms(query)
  const scored: { match: SpaceMatch; createdAt: string }[] = entries.map((entry) => {
    const { score, reasons } = scoreSpace(entry, entry.memory, tokens)
    return { match: { id: entry.id, title: entry.title, score, reasons }, createdAt: entry.createdAt }
  })
  const matches = tokens.length > 0 ? scored.filter(entry => entry.match.score > 0) : scored
  matches.sort((left, right) => right.match.score - left.match.score || right.createdAt.localeCompare(left.createdAt))
  return matches.slice(0, Math.max(0, limit)).map(entry => entry.match)
}

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomSpaces: FaberLoomSpaces
    /**
     * Optional ranker a deployment may mount to replace the built-in lexical
     * ranking. The spaces service reads it through `ctx.get`; when absent it
     * falls back to the lexical ranker.
     */
    spaceIndex: SpaceIndex
  }
}

/** Map one durable record to the consumer-facing space. */
function toSpace(id: FaberLoomSpaceId, record: SpaceRecord): FaberLoomSpace {
  return {
    id,
    ownerId: record.ownerId,
    companyId: record.companyId ?? undefined,
    title: record.title,
    parentId: record.parentId ?? undefined,
    inheritContext: record.inheritContext,
    excluded: record.excluded,
    members: record.members,
    context: record.context,
    sources: record.sources,
    agentId: record.agentId ?? undefined,
    workspaceId: record.workspaceId ?? undefined,
    archived: record.archived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  }
}

/** Map one durable memory record to the consumer-facing entry. */
function toMemory(id: string, record: SpaceMemoryRecord): FaberLoomSpaceMemory {
  return {
    id,
    spaceIds: record.spaceIds,
    text: record.text,
    createdAt: record.createdAt,
  }
}

/** Map one durable file record to its metadata. */
function toFile(id: string, record: SpaceFileRecord): SpaceFile {
  return {
    id,
    spaceId: record.spaceId,
    name: record.name,
    mediaType: record.mediaType,
    size: record.size,
    sha256: record.sha256,
    createdAt: record.createdAt,
  }
}

/** Build the model-facing directive for one commercial source. */
function directiveFor(source: SpaceSource): string {
  if (source.kind === 'mwt-company') {
    return `Directiva MWT: consulta el MCP de MWT.ONE para la empresa ${source.id} y usa precios y condiciones vigentes; no uses valores copiados ni en cache.`
  }
  if (source.kind === 'mwt-client') {
    return `Directiva MWT: consulta el MCP de MWT.ONE para el cliente ${source.id} (pedidos, condiciones y permisos) antes de actuar.`
  }
  return `Directiva MWT: consulta el MCP de MWT.ONE para el SKU ${source.id} (precio y disponibilidad vigentes).`
}

/** Reject a company source outside a non-admin actor's company scope. */
function assertSourcesAllowed(actor: SpaceActor, sources: readonly SpaceSource[]): SpaceSource[] {
  for (const source of sources) {
    if (source.kind !== 'mwt-company' || actor.role === 'admin') continue
    if (actor.companyId === undefined || source.id !== actor.companyId) {
      throw new Error('faberloom: source company outside the identity scope')
    }
  }
  return sources.map(source => ({ ...source }))
}

/** Whether the actor's company scope admits the record's company. */
function tenantAdmits(record: SpaceRecord, actor: SpaceActor): boolean {
  if (record.companyId === null || actor.companyId === undefined || actor.role === 'admin') return true
  return record.companyId === actor.companyId
}

/** Whether one identity may read a space: tenant scope, then admin/owner/member. */
function canRead(record: SpaceRecord, actor: SpaceActor): boolean {
  if (!tenantAdmits(record, actor)) return false
  if (actor.role === 'admin') return true
  return record.ownerId === actor.id || record.members.includes(actor.id)
}

/**
 * Whether one identity may mutate a space: tenant scope, then admin or owner.
 * A console read-only role still manages its own spaces: a space is the user's
 * own container, not company data.
 */
function canManage(record: SpaceRecord, actor: SpaceActor): boolean {
  if (!tenantAdmits(record, actor)) return false
  return actor.role === 'admin' || record.ownerId === actor.id
}

/**
 * The product spaces service. It owns the durable space records, the effective
 * context resolution, the personal scope, the opaque work-directory
 * references, and console-role access control; every operation carries the
 * authenticated actor.
 */
export class FaberLoomSpaces extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof spacesDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomSpaces')
  }

  /** Open the spaces domain once and keep its handle. */
  private domain(): Promise<Domain<typeof spacesDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(spacesDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.spacesDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  /** The spaces table handle. */
  private async table(): Promise<KvTable<FaberLoomSpaceId, SpaceRecord>> {
    return (await this.domain()).table('spaces')
  }

  /** The attached-files table handle. */
  private async files(): Promise<KvTable<string, SpaceFileRecord>> {
    return (await this.domain()).table('files')
  }

  /** The space-scoped memory table handle. */
  private async memory(): Promise<KvTable<string, SpaceMemoryRecord>> {
    return (await this.domain()).table('memory')
  }

  /** Read a record or fail loud. */
  private async requireRecord(id: FaberLoomSpaceId): Promise<{ table: KvTable<FaberLoomSpaceId, SpaceRecord>; record: SpaceRecord }> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: space ${id} not found`)
    return { table, record }
  }

  /** Whether the actor may read a space: owner/member/admin, or an active `view` grant. */
  private async mayRead(id: FaberLoomSpaceId, record: SpaceRecord, actor: SpaceActor): Promise<boolean> {
    if (canRead(record, actor)) return true
    const shares = this.ctx.get('faberloomShares')
    return shares !== undefined && await shares.can(actor.id, record.ownerId, { kind: 'space', id }, 'view')
  }

  /** Whether the actor may manage a space: owner/admin, or an active `manage-members` grant. */
  private async mayManage(id: FaberLoomSpaceId, record: SpaceRecord, actor: SpaceActor): Promise<boolean> {
    if (canManage(record, actor)) return true
    const shares = this.ctx.get('faberloomShares')
    return shares !== undefined && await shares.can(actor.id, record.ownerId, { kind: 'space', id }, 'manage-members')
  }

  /**
   * Create one space owned by the actor, scoped to its company, under an
   * optional parent the actor controls. Every identity may create its own
   * space, including a console read-only role.
   * @param actor - the acting identity.
   * @param input - title and optional parent.
   * @returns the created space.
   */
  async create(actor: SpaceActor, input: CreateSpaceInput): Promise<FaberLoomSpace> {
    const table = await this.table()
    if (input.parentId !== undefined) {
      const parent = table.get(input.parentId)
      if (parent === undefined) throw new Error(`faberloom: parent space ${input.parentId} not found`)
      if (!await this.mayManage(input.parentId, parent, actor)) throw new Error('faberloom: identity cannot manage this space')
    }
    const now = new Date().toISOString()
    const id = brandString<FaberLoomSpaceId>(randomUUID())
    const record: SpaceRecord = {
      ownerId: actor.id,
      companyId: actor.companyId ?? null,
      title: input.title,
      parentId: input.parentId ?? null,
      inheritContext: input.inheritContext ?? true,
      excluded: [],
      members: [],
      context: {},
      sources: [],
      agentId: input.agentId ?? null,
      workspaceId: input.workspaceId ?? null,
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    await table.put(id, record)
    return toSpace(id, record)
  }

  /**
   * Materialize a Space another identity shared, under the remote id so the
   * imported record resolves the same `view`/`manage-members` grants. Idempotent:
   * an existing record is returned untouched, so a repeated sync never clobbers
   * the member's own state. The record is owned by the publisher, so the member
   * can never manage or delete it, and it is never a sub-space of a local parent.
   * @param input - remote id, publisher email, title, and the shared context.
   * @returns the imported (or already present) space.
   */
  async importShared(input: ImportSharedSpaceInput): Promise<FaberLoomSpace> {
    const table = await this.table()
    const id = brandString<FaberLoomSpaceId>(input.id)
    const existing = table.get(id)
    if (existing !== undefined) return toSpace(id, existing)
    const now = new Date().toISOString()
    const record: SpaceRecord = {
      ownerId: input.ownerId,
      companyId: null,
      title: input.title,
      parentId: null,
      inheritContext: false,
      excluded: [],
      members: [],
      context: { ...(input.context ?? {}) },
      sources: [],
      agentId: null,
      workspaceId: null,
      archived: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    await table.put(id, record)
    return toSpace(id, record)
  }

  /**
   * List the spaces the actor may read, oldest first.
   * @param actor - the acting identity.
   * @returns the readable spaces.
   */
  async list(actor: SpaceActor): Promise<FaberLoomSpace[]> {
    const table = await this.table()
    const out: FaberLoomSpace[] = []
    for (const [id, record] of table.entries()) {
      if (await this.mayRead(id, record, actor)) out.push(toSpace(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Read one space the actor may see.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns the space.
   * @throws when the space is absent or not readable.
   */
  async get(actor: SpaceActor, id: FaberLoomSpaceId): Promise<FaberLoomSpace> {
    const { record } = await this.requireRecord(id)
    if (!await this.mayRead(id, record, actor)) throw new Error('faberloom: space access denied')
    return toSpace(id, record)
  }

  /**
   * Apply a mutable patch to one space the actor may manage.
   * @param actor - the acting identity.
   * @param id - space id.
   * @param patch - fields to change.
   * @returns the updated space.
   */
  async update(actor: SpaceActor, id: FaberLoomSpaceId, patch: UpdateSpaceInput): Promise<FaberLoomSpace> {
    const { table, record } = await this.requireRecord(id)
    if (!await this.mayManage(id, record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const next: SpaceRecord = {
      ...record,
      title: patch.title ?? record.title,
      inheritContext: patch.inheritContext ?? record.inheritContext,
      excluded: patch.excluded !== undefined ? [...patch.excluded] : record.excluded,
      members: patch.members !== undefined ? [...patch.members] : record.members,
      context: patch.context !== undefined ? { ...patch.context } : record.context,
      sources: patch.sources !== undefined ? assertSourcesAllowed(actor, patch.sources) : record.sources,
      agentId: patch.agentId !== undefined ? patch.agentId : record.agentId,
      workspaceId: patch.workspaceId !== undefined ? patch.workspaceId : record.workspaceId,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    }
    await table.update(id, () => next)
    return toSpace(id, next)
  }

  /**
   * Archive one space the actor may manage; the record is kept, out of the active list.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns the archived space.
   */
  async archive(actor: SpaceActor, id: FaberLoomSpaceId): Promise<FaberLoomSpace> {
    const { table, record } = await this.requireRecord(id)
    if (!await this.mayManage(id, record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const next: SpaceRecord = { ...record, archived: true, updatedAt: new Date().toISOString(), version: record.version + 1 }
    await table.update(id, () => next)
    return toSpace(id, next)
  }

  /**
   * Remove one space the actor may manage, together with every file attached to
   * it. Deletion is permanent: the caller removes the space's conversation area.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns `true` when the stored record was deleted.
   * @throws when the space is absent or not manageable.
   */
  async remove(actor: SpaceActor, id: FaberLoomSpaceId): Promise<boolean> {
    const { table, record } = await this.requireRecord(id)
    if (!await this.mayManage(id, record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const files = await this.files()
    for (const [fileId, file] of files.entries()) {
      if (file.spaceId === id) await files.delete(fileId)
    }
    return await table.delete(id)
  }

  /**
   * Attach one memory entry to one or more spaces the actor may read. A
   * sub-space with inheritance on later reads its ancestors' entries too.
   * @param actor - the acting identity.
   * @param text - the remembered text.
   * @param spaceIds - the spaces the entry is attached to.
   * @returns the created entry.
   */
  async remember(actor: SpaceActor, text: string, spaceIds: readonly FaberLoomSpaceId[]): Promise<FaberLoomSpaceMemory> {
    for (const spaceId of spaceIds) {
      const { record } = await this.requireRecord(spaceId)
      if (!await this.mayRead(spaceId, record, actor)) throw new Error('faberloom: space access denied')
    }
    const id = randomUUID()
    const record: SpaceMemoryRecord = {
      ownerId: actor.id,
      spaceIds: [...spaceIds],
      text,
      createdAt: new Date().toISOString(),
    }
    await (await this.memory()).put(id, record)
    return toMemory(id, record)
  }

  /**
   * Delete one memory entry the actor owns. Deleting a space deliberately does
   * not go through here: removing a space keeps its memory, which retains the
   * space id as the recorded origin of a space that no longer exists.
   * @param actor - the acting identity.
   * @param id - memory entry id.
   * @returns whether the entry existed and was removed.
   * @throws when the entry belongs to another owner.
   */
  async forgetMemory(actor: SpaceActor, id: string): Promise<boolean> {
    const table = await this.memory()
    const record = table.get(id)
    if (record === undefined) return false
    if (record.ownerId !== actor.id) throw new Error('faberloom: memory access denied')
    return await table.delete(id)
  }

  /**
   * List the actor's memory entries, optionally only those attached to one space.
   * @param actor - the acting identity.
   * @param spaceId - when set, only entries attached to this space.
   * @returns entries oldest first.
   */
  async listMemory(actor: SpaceActor, spaceId?: FaberLoomSpaceId): Promise<FaberLoomSpaceMemory[]> {
    const out: FaberLoomSpaceMemory[] = []
    for (const [id, record] of (await this.memory()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (spaceId !== undefined && !record.spaceIds.includes(spaceId)) continue
      out.push(toMemory(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Resolve the memory one space sees: its own entries plus, while inheritance
   * is on, each ancestor's entries.
   * @param actor - the acting identity.
   * @param spaceId - the space to resolve for.
   * @returns entries from the inheriting chain, oldest first.
   * @throws when the space is absent or not readable.
   */
  async effectiveMemory(actor: SpaceActor, spaceId: FaberLoomSpaceId): Promise<FaberLoomSpaceMemory[]> {
    const chain = new Set<FaberLoomSpaceId>()
    let current: FaberLoomSpaceId | undefined = spaceId
    while (current !== undefined) {
      const { record } = await this.requireRecord(current)
      if (!await this.mayRead(current, record, actor)) {
        if (current === spaceId) throw new Error('faberloom: space access denied')
        break
      }
      chain.add(current)
      if (!record.inheritContext) break
      current = record.parentId ?? undefined
    }
    const out: FaberLoomSpaceMemory[] = []
    for (const [id, record] of (await this.memory()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (!record.spaceIds.some(entry => chain.has(entry))) continue
      out.push(toMemory(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * The isolated personal scope of one identity, used when no space is assigned.
   * @param ownerId - the owning identity.
   * @returns the personal scope descriptor (never a shared space).
   */
  personalScope(ownerId: string): PersonalScope {
    return { kind: 'personal', ownerId }
  }

  /**
   * Resolve an opaque working-directory reference for one space; never a path.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns the opaque reference.
   */
  async resolveWorkdir(actor: SpaceActor, id: FaberLoomSpaceId): Promise<WorkdirReference> {
    const { record } = await this.requireRecord(id)
    if (!await this.mayRead(id, record, actor)) throw new Error('faberloom: space access denied')
    const digest = createHash('sha256').update(`${record.ownerId}:${id}`).digest('hex').slice(0, 16)
    return { kind: 'opaque', ref: `fw_${digest}` }
  }

  /**
   * Preview audience and material before linking private work to one space.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns identities that would gain visibility and the context keys shared.
   */
  async previewLink(actor: SpaceActor, id: FaberLoomSpaceId): Promise<LinkPreview> {
    const { record } = await this.requireRecord(id)
    if (!await this.mayRead(id, record, actor)) throw new Error('faberloom: space access denied')
    return { newlyVisibleTo: [...record.members], sharedContextKeys: Object.keys(record.context) }
  }

  /**
   * Resolve the effective context of one space: the space's own context plus,
   * when it inherits, its ancestors' context, minus explicit exclusions, with
   * unresolved key conflicts surfaced instead of silently prioritized.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns resolved values, conflicts, contributing sources, and exclusions.
   */
  async effectiveContext(actor: SpaceActor, id: FaberLoomSpaceId): Promise<EffectiveContext> {
    const { table, record } = await this.requireRecord(id)
    if (!await this.mayRead(id, record, actor)) throw new Error('faberloom: space access denied')

    const excluded = new Set<FaberLoomSpaceId>()
    const sources: FaberLoomSpaceId[] = []
    const order: string[] = []
    const candidates = new Map<string, { spaceId: FaberLoomSpaceId; value: string }[]>()
    const dataSources: SpaceSource[] = []
    const seenSource = new Set<string>()

    let currentId: FaberLoomSpaceId | undefined = id
    let current: SpaceRecord | undefined = record
    while (current !== undefined) {
      for (const excludedId of current.excluded) excluded.add(excludedId)
      if (!excluded.has(currentId)) {
        sources.push(currentId)
        for (const source of current.sources) {
          const sourceKey = `${source.kind}:${source.id}`
          if (seenSource.has(sourceKey)) continue
          seenSource.add(sourceKey)
          dataSources.push(source)
        }
        for (const [key, value] of Object.entries(current.context)) {
          const list = candidates.get(key)
          if (list === undefined) {
            candidates.set(key, [{ spaceId: currentId, value }])
            order.push(key)
          } else {
            list.push({ spaceId: currentId, value })
          }
        }
      }
      if (!current.inheritContext) break
      const parentId = current.parentId
      if (parentId === null) break
      currentId = parentId
      current = table.get(parentId)
    }

    const resolved: SpaceContext = {}
    const conflicts: EffectiveContextConflict[] = []
    for (const key of order) {
      const list = candidates.get(key)
      if (list === undefined) continue
      const distinct = [...new Set(list.map(candidate => candidate.value))]
      const only = distinct[0]
      if (distinct.length === 1 && only !== undefined) resolved[key] = only
      else if (distinct.length > 1) conflicts.push({ key, candidates: list })
    }
    return {
      resolved,
      conflicts,
      sources,
      excluded: [...excluded],
      dataSources,
      directives: dataSources.map(directiveFor),
    }
  }

  /**
   * Rank the actor's readable spaces for a query. It ranks through
   * `ctx.spaceIndex` when a provider is mounted, otherwise through the built-in
   * lexical ranker. An empty query returns the actor's readable, non-archived
   * spaces most recently created first; archived spaces are always excluded.
   * @param actor - the acting identity.
   * @param query - free-text query; an empty query lists the recent spaces.
   * @param limit - most results to return.
   * @returns matched spaces, best score first, then most recent first.
   */
  async find(actor: SpaceActor, query: string, limit: number = 10): Promise<SpaceMatch[]> {
    const entries: SpaceIndexEntry[] = []
    for (const [id, record] of (await this.table()).entries()) {
      if (!await this.mayRead(id, record, actor)) continue
      if (record.archived) continue
      const memory = (await this.effectiveMemory(actor, id)).map(entry => entry.text).join(' ')
      entries.push({ id, title: record.title, context: record.context, memory, createdAt: record.createdAt })
    }
    const index = this.ctx.get('spaceIndex')
    return index === undefined ? rankLexically(entries, query, limit) : index.rank(entries, query, limit)
  }

  /**
   * Resolve one referenced Space into its effective context and memory, its
   * attached-file metadata, and its responsible agent and mirrored workspace.
   * @param actor - the acting identity.
   * @param id - space id.
   * @returns the resolved reference.
   * @throws when the space is absent or not readable.
   */
  async reference(actor: SpaceActor, id: FaberLoomSpaceId): Promise<SpaceReference> {
    const space = await this.get(actor, id)
    const context = await this.effectiveContext(actor, id)
    const memory = await this.effectiveMemory(actor, id)
    const files = await this.listFiles(actor, id)
    return { space, context, memory, files, agentId: space.agentId, workspaceId: space.workspaceId }
  }

  /**
   * Attach one file to a space the actor may manage. Bytes are stored inline
   * for this slice, capped at {@link MAX_FILE_BYTES}.
   * @param actor - the acting identity.
   * @param spaceId - the target space.
   * @param input - file name, media type, and base64 bytes.
   * @returns the stored file metadata.
   */
  async attachFile(actor: SpaceActor, spaceId: FaberLoomSpaceId, input: SpaceFileInput): Promise<SpaceFile> {
    const { record } = await this.requireRecord(spaceId)
    if (!await this.mayManage(spaceId, record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`faberloom: file exceeds the ${String(MAX_FILE_BYTES)}-byte inline limit`)
    }
    const id = randomUUID()
    const fileRecord: SpaceFileRecord = {
      spaceId,
      name: input.name,
      mediaType: input.mediaType,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentBase64: input.contentBase64,
      createdAt: new Date().toISOString(),
    }
    await (await this.files()).put(id, fileRecord)
    return toFile(id, fileRecord)
  }

  /**
   * List the files attached to one space the actor may read.
   * @param actor - the acting identity.
   * @param spaceId - the target space.
   * @returns file metadata, oldest first.
   */
  async listFiles(actor: SpaceActor, spaceId: FaberLoomSpaceId): Promise<SpaceFile[]> {
    const { record } = await this.requireRecord(spaceId)
    if (!await this.mayRead(spaceId, record, actor)) throw new Error('faberloom: space access denied')
    const out: SpaceFile[] = []
    for (const [id, file] of (await this.files()).entries()) {
      if (file.spaceId === spaceId) out.push(toFile(id, file))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Read one attached file, bytes included, when the actor may read its space.
   * @param actor - the acting identity.
   * @param fileId - the file id.
   * @returns the file with its base64 bytes.
   */
  async readFile(actor: SpaceActor, fileId: string): Promise<SpaceFileContent> {
    const file = (await this.files()).get(fileId)
    if (file === undefined) throw new Error(`faberloom: file ${fileId} not found`)
    const { record } = await this.requireRecord(file.spaceId)
    if (!await this.mayRead(file.spaceId, record, actor)) throw new Error('faberloom: space access denied')
    return { ...toFile(fileId, file), contentBase64: file.contentBase64 }
  }
}

export default FaberLoomSpaces
