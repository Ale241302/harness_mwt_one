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
import { spacesDomainSpec, type SpaceFileRecord, type SpaceRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  CreateSpaceInput,
  EffectiveContext,
  EffectiveContextConflict,
  FaberLoomSpace,
  FaberLoomSpaceId,
  LinkPreview,
  PersonalScope,
  SpaceActor,
  SpaceContext,
  SpaceFile,
  SpaceFileContent,
  SpaceFileInput,
  SpaceSource,
  UpdateSpaceInput,
  WorkdirReference,
} from './types.ts'

/** Largest file this slice stores inline in the domain (1 MiB). */
const MAX_FILE_BYTES = 1_000_000

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomSpaces: FaberLoomSpaces
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
    archived: record.archived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
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

  /** Read a record or fail loud. */
  private async requireRecord(id: FaberLoomSpaceId): Promise<{ table: KvTable<FaberLoomSpaceId, SpaceRecord>; record: SpaceRecord }> {
    const table = await this.table()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: space ${id} not found`)
    return { table, record }
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
      if (!canManage(parent, actor)) throw new Error('faberloom: identity cannot manage this space')
    }
    const now = new Date().toISOString()
    const id = brandString<FaberLoomSpaceId>(randomUUID())
    const record: SpaceRecord = {
      ownerId: actor.id,
      companyId: actor.companyId ?? null,
      title: input.title,
      parentId: input.parentId ?? null,
      inheritContext: true,
      excluded: [],
      members: [],
      context: {},
      sources: [],
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
      if (canRead(record, actor)) out.push(toSpace(id, record))
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')
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
    if (!canManage(record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const next: SpaceRecord = {
      ...record,
      title: patch.title ?? record.title,
      inheritContext: patch.inheritContext ?? record.inheritContext,
      excluded: patch.excluded !== undefined ? [...patch.excluded] : record.excluded,
      members: patch.members !== undefined ? [...patch.members] : record.members,
      context: patch.context !== undefined ? { ...patch.context } : record.context,
      sources: patch.sources !== undefined ? assertSourcesAllowed(actor, patch.sources) : record.sources,
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
    if (!canManage(record, actor)) throw new Error('faberloom: identity cannot manage this space')
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
    if (!canManage(record, actor)) throw new Error('faberloom: identity cannot manage this space')
    const files = await this.files()
    for (const [fileId, file] of files.entries()) {
      if (file.spaceId === id) await files.delete(fileId)
    }
    return await table.delete(id)
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')

    const excluded = new Set<FaberLoomSpaceId>()
    const sources: FaberLoomSpaceId[] = []
    const order: string[] = []
    const candidates = new Map<string, { spaceId: FaberLoomSpaceId; value: string }[]>()
    const dataSources: SpaceSource[] = []
    const seenSource = new Set<string>()

    let currentId: FaberLoomSpaceId | undefined = id
    let current: SpaceRecord | undefined = record
    while (currentId !== undefined && current !== undefined) {
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
   * Attach one file to a space the actor may manage. Bytes are stored inline
   * for this slice, capped at {@link MAX_FILE_BYTES}.
   * @param actor - the acting identity.
   * @param spaceId - the target space.
   * @param input - file name, media type, and base64 bytes.
   * @returns the stored file metadata.
   */
  async attachFile(actor: SpaceActor, spaceId: FaberLoomSpaceId, input: SpaceFileInput): Promise<SpaceFile> {
    const { record } = await this.requireRecord(spaceId)
    if (!canManage(record, actor)) throw new Error('faberloom: identity cannot manage this space')
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')
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
    if (!canRead(record, actor)) throw new Error('faberloom: space access denied')
    return { ...toFile(fileId, file), contentBase64: file.contentBase64 }
  }
}

export default FaberLoomSpaces
