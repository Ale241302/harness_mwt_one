/**
 * Native product memory (`ctx.faberloomMemory`): versioned teachings with
 * scope, source, and usage traceability; contextual performance that
 * separates agent errors from requirement changes; late errors that update a
 * teaching without erasing its history; and a portable knowledge snapshot.
 * Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-memory
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { memoryDomainSpec, type LateErrorRecord, type PerformanceRecord, type TeachingRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  FaberLoomTeaching,
  FaberLoomTeachingId,
  KnowledgeSnapshot,
  LateErrorInput,
  PerformanceInput,
  PerformanceSummary,
  TeachingEditInput,
  TeachingFilter,
  TeachingInput,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomMemory: FaberLoomMemory
  }
}

/** Map one durable teaching to the consumer-facing teaching. */
function toTeaching(id: FaberLoomTeachingId, record: TeachingRecord): FaberLoomTeaching {
  return { id, ...record }
}

/**
 * The product memory service: versioned teachings, contextual performance,
 * late errors, and portable knowledge.
 */
export class FaberLoomMemory extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof memoryDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomMemory')
  }

  private domain(): Promise<Domain<typeof memoryDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.memoryDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async teachings(): Promise<KvTable<string, TeachingRecord>> { return (await this.domain()).table('teachings') }
  private async versions(): Promise<KvTable<string, TeachingRecord>> {
    return (await this.domain()).table('teaching_versions') as unknown as KvTable<string, TeachingRecord>
  }
  private async performanceTable(): Promise<KvTable<string, PerformanceRecord>> { return (await this.domain()).table('performance') }
  private async lateErrors(): Promise<KvTable<string, LateErrorRecord>> { return (await this.domain()).table('late_errors') }

  private async requireTeaching(id: FaberLoomTeachingId): Promise<TeachingRecord> {
    const record = (await this.teachings()).get(id)
    if (record === undefined) throw new Error(`faberloom: teaching ${id} not found`)
    return record
  }

  /**
   * Record one teaching. An explicit instruction (`active: true`) is remembered
   * active; an inferred one stays a candidate.
   * @param ownerId - the owning identity.
   * @param input - scope, text, source, and scoping.
   * @returns the created teaching.
   */
  async createTeaching(ownerId: string, input: TeachingInput): Promise<FaberLoomTeaching> {
    const id = brandString<FaberLoomTeachingId>(randomUUID())
    const now = new Date().toISOString()
    const record: TeachingRecord = {
      ownerId,
      scope: input.scope,
      spaceId: input.spaceId ?? null,
      agentId: input.agentId ?? null,
      skill: input.skill ?? null,
      task: input.task ?? null,
      text: input.text,
      source: input.source,
      author: input.author,
      status: input.active === true ? 'active' : 'candidate',
      version: 1,
      supersedes: null,
      uses: input.caseRef === undefined ? [] : [input.caseRef],
      createdAt: now,
      updatedAt: now,
    }
    await (await this.teachings()).put(id, record)
    return toTeaching(id, record)
  }

  /**
   * Edit one teaching, producing a new version and preserving the previous as
   * superseded history.
   * @param ownerId - the acting identity.
   * @param id - teaching id.
   * @param input - new text, reason, and author.
   * @returns the updated teaching.
   */
  async editTeaching(ownerId: string, id: FaberLoomTeachingId, input: TeachingEditInput): Promise<FaberLoomTeaching> {
    const table = await this.teachings()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: teaching ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can edit this teaching')
    if (record.status === 'revoked') throw new Error('faberloom: a revoked teaching cannot be edited')
    const now = new Date().toISOString()
    await (await this.versions()).put(`${id}:${String(record.version)}`, { ...record, status: 'superseded', updatedAt: now })
    const next: TeachingRecord = {
      ...record,
      text: input.text,
      source: `edit:${input.reason}`,
      author: input.author,
      status: record.status === 'candidate' ? 'candidate' : 'active',
      version: record.version + 1,
      supersedes: record.version,
      updatedAt: now,
    }
    await table.update(id, () => next)
    return toTeaching(id, next)
  }

  /**
   * Revoke one teaching: it disappears from new decisions and its history stays.
   * @param ownerId - the acting identity.
   * @param id - teaching id.
   * @returns the revoked teaching.
   */
  async revokeTeaching(ownerId: string, id: FaberLoomTeachingId): Promise<FaberLoomTeaching> {
    const table = await this.teachings()
    const record = table.get(id)
    if (record === undefined) throw new Error(`faberloom: teaching ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can revoke this teaching')
    const next: TeachingRecord = { ...record, status: 'revoked', updatedAt: new Date().toISOString() }
    await table.update(id, () => next)
    return toTeaching(id, next)
  }

  /**
   * Read one teaching.
   * @param id - teaching id.
   * @returns the teaching.
   */
  async getTeaching(id: FaberLoomTeachingId): Promise<FaberLoomTeaching> {
    return toTeaching(id, await this.requireTeaching(id))
  }

  /**
   * List teachings including history, optionally filtered.
   * @param ownerId - the owning identity.
   * @param filter - optional scope filters.
   * @returns the teachings, oldest first.
   */
  async listTeachings(ownerId: string, filter: Pick<TeachingFilter, 'scope' | 'spaceId' | 'agentId' | 'skill' | 'task'> = {}): Promise<FaberLoomTeaching[]> {
    const out: FaberLoomTeaching[] = []
    for (const [id, record] of (await this.teachings()).entries()) {
      if (record.ownerId !== ownerId) continue
      if (!matchesFilter(record, filter)) continue
      out.push(toTeaching(id as FaberLoomTeachingId, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * List every stored version of one teaching.
   * @param ownerId - the owning identity.
   * @param id - teaching id.
   * @returns superseded versions plus the current one.
   */
  async listVersions(ownerId: string, id: FaberLoomTeachingId): Promise<FaberLoomTeaching[]> {
    const out: FaberLoomTeaching[] = []
    for (const [key, record] of (await this.versions()).entries()) {
      if (key.startsWith(`${id}:`) && record.ownerId === ownerId) out.push(toTeaching(id, record))
    }
    out.sort((left, right) => left.version - right.version)
    out.push(toTeaching(id, await this.requireTeaching(id)))
    return out
  }

  /**
   * Recover the active teachings that apply to a context, and record the use
   * when a case reference is supplied.
   * @param ownerId - the owning identity.
   * @param filter - scope filters and optional case reference.
   * @returns the recovered teachings, current version only.
   */
  async retrieve(ownerId: string, filter: TeachingFilter = {}): Promise<FaberLoomTeaching[]> {
    const table = await this.teachings()
    const out: FaberLoomTeaching[] = []
    for (const [rawId, record] of table.entries()) {
      if (record.ownerId !== ownerId) continue
      if (record.status !== 'active' && !(record.status === 'candidate' && filter.includeCandidates === true)) continue
      if (!matchesFilter(record, filter)) continue
      const id = rawId as FaberLoomTeachingId
      if (filter.caseRef !== undefined && !record.uses.includes(filter.caseRef)) {
        const next: TeachingRecord = { ...record, uses: [...record.uses, filter.caseRef], updatedAt: new Date().toISOString() }
        await table.update(rawId, () => next)
        out.push(toTeaching(id, next))
      } else {
        out.push(toTeaching(id, record))
      }
    }
    return out
  }

  /**
   * Record one contextual outcome.
   * @param ownerId - the owning identity.
   * @param input - task, outcome, and cause.
   * @returns nothing.
   */
  async recordPerformance(ownerId: string, input: PerformanceInput): Promise<void> {
    const cause = input.cause ?? (input.outcome === 'corrected' ? 'error' : null)
    const record: PerformanceRecord = {
      ownerId,
      agentId: input.agentId ?? null,
      modelId: input.modelId ?? null,
      task: input.task,
      spaceId: input.spaceId ?? null,
      outcome: input.outcome,
      cause,
      cost: input.cost ?? null,
      at: new Date().toISOString(),
    }
    await (await this.performanceTable()).put(randomUUID(), record)
  }

  /**
   * Aggregate contextual performance. Correction causes are separated so a
   * requirement change is never counted as an agent failure.
   * @param ownerId - the owning identity.
   * @param filter - optional agent, task, and space filters.
   * @returns the summary.
   */
  async performance(ownerId: string, filter: { agentId?: string; task?: string; spaceId?: string } = {}): Promise<PerformanceSummary> {
    let uses = 0
    let approved = 0
    let corrected = 0
    let agentFailures = 0
    const correctionsByCause: Record<string, number> = {}
    for (const [, record] of (await this.performanceTable()).entries()) {
      if (record.ownerId !== ownerId) continue
      if (filter.agentId !== undefined && record.agentId !== filter.agentId) continue
      if (filter.task !== undefined && record.task !== filter.task) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      uses += 1
      if (record.outcome === 'approved') { approved += 1; continue }
      corrected += 1
      const cause = record.cause ?? 'error'
      correctionsByCause[cause] = (correctionsByCause[cause] ?? 0) + 1
      if (cause === 'error') agentFailures += 1
    }
    return {
      uses,
      approved,
      corrected,
      agentFailures,
      correctionsByCause,
      correctionRate: uses === 0 ? undefined : corrected / uses,
    }
  }

  /**
   * Record a late error. When it targets a teaching, the teaching gets a new
   * version carrying the correction; the original history stays.
   * @param ownerId - the owning identity.
   * @param input - case reference, detail, optional teaching, author.
   * @returns the updated teaching when one was corrected.
   */
  async recordLateError(ownerId: string, input: LateErrorInput): Promise<FaberLoomTeaching | undefined> {
    await (await this.lateErrors()).put(randomUUID(), {
      ownerId,
      caseRef: input.caseRef,
      detail: input.detail,
      teachingId: input.teachingId ?? null,
      author: input.author,
      at: new Date().toISOString(),
    })
    if (input.teachingId === undefined) return undefined
    return this.editTeaching(ownerId, input.teachingId, { text: input.detail, reason: `late-error:${input.caseRef}`, author: input.author })
  }

  /**
   * Export a portable knowledge snapshot; credentials are never included.
   * @param ownerId - the owning identity.
   * @returns the snapshot of teachings, performance, and late errors.
   */
  async exportKnowledge(ownerId: string): Promise<KnowledgeSnapshot> {
    const teachings: unknown[] = []
    for (const [, record] of (await this.teachings()).entries()) if (record.ownerId === ownerId) teachings.push(record)
    const performance: unknown[] = []
    for (const [, record] of (await this.performanceTable()).entries()) if (record.ownerId === ownerId) performance.push(record)
    const lateErrors: unknown[] = []
    for (const [, record] of (await this.lateErrors()).entries()) if (record.ownerId === ownerId) lateErrors.push(record)
    return { teachings, performance, lateErrors }
  }

  /**
   * Restore a knowledge snapshot for one owner, keeping versions and statuses.
   * @param ownerId - the destination identity.
   * @param snapshot - the snapshot to import.
   * @returns how many records were restored.
   */
  async importKnowledge(
    ownerId: string,
    snapshot: KnowledgeSnapshot,
  ): Promise<{ teachings: number; performance: number; lateErrors: number }> {
    const table = await this.teachings()
    let teachings = 0
    for (const raw of snapshot.teachings) {
      const record = { ...(raw as TeachingRecord), ownerId }
      await table.put(brandString<FaberLoomTeachingId>(randomUUID()), record)
      teachings += 1
    }
    const perf = await this.performanceTable()
    let performance = 0
    for (const raw of snapshot.performance) {
      await perf.put(randomUUID(), { ...(raw as PerformanceRecord), ownerId })
      performance += 1
    }
    const late = await this.lateErrors()
    let lateErrors = 0
    for (const raw of snapshot.lateErrors) {
      await late.put(randomUUID(), { ...(raw as LateErrorRecord), ownerId })
      lateErrors += 1
    }
    return { teachings, performance, lateErrors }
  }
}

/** Whether a teaching record satisfies the scope filters. */
function matchesFilter(record: TeachingRecord, filter: Pick<TeachingFilter, 'scope' | 'spaceId' | 'agentId' | 'skill' | 'task'>): boolean {
  if (filter.scope !== undefined && record.scope !== filter.scope) return false
  if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) return false
  if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false
  if (filter.skill !== undefined && record.skill !== filter.skill) return false
  if (filter.task !== undefined && record.task !== filter.task) return false
  return true
}

export default FaberLoomMemory
