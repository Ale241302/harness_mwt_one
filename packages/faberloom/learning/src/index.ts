/**
 * Native product memory (`ctx.faberloomMemory`): versioned teachings with
 * scope, source, and usage traceability; contextual performance that
 * separates agent errors from requirement changes; the correction registry
 * with its scope taxonomy; learning candidates with lineage and an allowed
 * destination; per-task-type maturity metrics; late errors that update a
 * teaching without erasing its history; and a portable knowledge snapshot.
 * Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-memory
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  memoryDomainSpec,
  type CandidateRecord,
  type CorrectionRecord,
  type LateErrorRecord,
  type OutcomeRecord,
  type PerformanceRecord,
  type TeachingRecord,
} from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  CandidateFilter,
  CandidatePromotionInput,
  CandidateWideningInput,
  CorrectionDetail,
  CorrectionFilter,
  CorrectionInput,
  CorrectionOutcome,
  FaberLoomCandidate,
  FaberLoomCandidateId,
  FaberLoomCorrection,
  FaberLoomCorrectionId,
  FaberLoomTeaching,
  FaberLoomTeachingId,
  KnowledgeSnapshot,
  LateErrorInput,
  LearningActor,
  LearningDataClass,
  LearningDestination,
  LearningOrigin,
  LearningOutcomeInput,
  MaturityFilter,
  MaturityTaskType,
  MaturityTaskTypeMetrics,
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

/** Map one durable correction to the consumer-facing correction. */
function toCorrection(id: FaberLoomCorrectionId, record: CorrectionRecord): FaberLoomCorrection {
  return { id, ...record, origin: record.detail.origin }
}

/** Map one durable candidate to the consumer-facing candidate. */
function toCandidate(id: FaberLoomCandidateId, record: CandidateRecord): FaberLoomCandidate {
  return { id, ...record }
}

/**
 * The product memory service: versioned teachings, contextual performance,
 * the correction registry, learning candidates, maturity metrics, late
 * errors, and portable knowledge.
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
    return (await this.domain()).table('teaching_versions')
  }
  private async performanceTable(): Promise<KvTable<string, PerformanceRecord>> { return (await this.domain()).table('performance') }
  private async lateErrors(): Promise<KvTable<string, LateErrorRecord>> { return (await this.domain()).table('late_errors') }
  private async corrections(): Promise<KvTable<string, CorrectionRecord>> { return (await this.domain()).table('corrections') }
  private async candidates(): Promise<KvTable<string, CandidateRecord>> { return (await this.domain()).table('candidates') }
  private async outcomes(): Promise<KvTable<string, OutcomeRecord>> { return (await this.domain()).table('outcomes') }

  private async requireTeaching(id: FaberLoomTeachingId): Promise<TeachingRecord> {
    const record = (await this.teachings()).get(id)
    if (record === undefined) throw new Error(`faberloom: teaching ${id} not found`)
    return record
  }

  /**
   * Revalidate one candidate against the destination it is about to reach:
   * tenant, actor scope, classification, destination reference, and provenance.
   * @param actor - identity and scope of the caller.
   * @param candidate - the candidate being promoted or widened.
   * @param input - destination and the classifications it accepts.
   * @returns nothing; a failed check throws before any write.
   */
  private async revalidate(
    actor: LearningActor,
    candidate: CandidateRecord,
    input: CandidatePromotionInput,
  ): Promise<void> {
    if (actor.tenantId !== candidate.tenantId) {
      throw new Error('faberloom: TENANT_MISMATCH — a candidate never crosses tenants')
    }
    requireScope(actor, candidate)
    if (!input.acceptedDataClasses.includes(candidate.dataClass)) {
      throw new Error(`faberloom: CLASSIFICATION_NOT_ALLOWED — ${candidate.dataClass} is not accepted at the destination`)
    }
    if (destinationRef(candidate, input.destination) === null) {
      throw new Error(`faberloom: NO_DESTINATION — the candidate carries no ${input.destination} to promote to`)
    }
    const correction = (await this.corrections()).get(candidate.correctionId)
    if (correction === undefined || correction.itemId !== candidate.itemId || !sameOrigin(correction, candidate)) {
      throw new Error('faberloom: PROVENANCE_MISMATCH — the candidate no longer traces to its origin')
    }
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
   * Entry point for every human correction: an inline edit, an answered doubt,
   * or an applied iteration. The record is durable and identical in structure
   * for all three origins. A candidate is created only when the chosen scope is
   * not `puntual`; nothing is promoted here (W-34, W-35).
   *
   * Both writes land on the domain write chain in order: the correction first,
   * because it is the fact, and the candidate second. A candidate write that
   * fails rejects the call and leaves the correction recorded.
   * @param actor - identity and scope of the caller.
   * @param input - origin payload, lineage, classifications, and chosen scope.
   * @returns the correction and the candidate it produced, when it produced one.
   */
  async onCorrection(actor: LearningActor, input: CorrectionInput): Promise<CorrectionOutcome> {
    const scope = input.scope ?? 'puntual'
    if (input.scope === undefined && input.detail.origin === 'iterate') {
      throw new Error('faberloom: SCOPE_REQUIRED — an applied iteration closes with a scope classification')
    }
    if (input.itemId.trim().length === 0) {
      throw new Error('faberloom: NO_ORIGIN — a correction names the item it corrects')
    }
    if (input.actor.trim().length === 0) {
      throw new Error('faberloom: NO_ORIGIN — a correction names the actor who made it')
    }
    if (input.dataClasses.length === 0) {
      throw new Error('faberloom: NO_DATA_CLASS — a correction carries the data classes of its origin')
    }
    validateDetail(input.detail)
    const origin: LearningOrigin = {
      tenantId: input.tenantId ?? null,
      spaceId: input.spaceId ?? null,
      accountRef: input.accountRef ?? null,
      agentId: input.agentId ?? null,
    }
    if (!holdsScope(actor, origin)) {
      throw new Error('faberloom: NO_ACCESS — the correction origin is outside the actor scope')
    }
    // Provisional origins record the correction but feed no derived product (D-10, W-93).
    const plan = scope === 'puntual' || input.dataClassProvisional === true
      ? undefined
      : planCandidate(input, scope, origin)

    const id = brandString<FaberLoomCorrectionId>(randomUUID())
    const now = new Date().toISOString()
    const record: CorrectionRecord = {
      ...origin,
      itemId: input.itemId,
      actor: input.actor,
      scope,
      dataClasses: [...input.dataClasses],
      fieldsUsed: [...(input.fieldsUsed ?? [])],
      detail: toRecordDetail(input.detail),
      at: now,
    }
    await (await this.corrections()).put(id, record)
    const correction = toCorrection(id, record)
    if (plan === undefined) return { correction, candidate: undefined }

    const candidateId = brandString<FaberLoomCandidateId>(randomUUID())
    const candidate: CandidateRecord = {
      ...origin,
      itemId: input.itemId,
      correctionId: id,
      dataClass: highestDataClass(input.dataClasses),
      originDataClasses: [...input.dataClasses],
      fieldsUsed: [...(input.fieldsUsed ?? [])],
      scope: plan.destination,
      allowedDestination: plan.destination,
      text: plan.text,
      status: 'candidate',
      derivedFrom: null,
      createdBy: actor.id,
      createdAt: now,
      promotedBy: null,
      promotedAt: null,
      promotionDataClasses: null,
    }
    await (await this.candidates()).put(candidateId, candidate)
    return { correction, candidate: toCandidate(candidateId, candidate) }
  }

  /**
   * Read one correction. Only an identity holding scope over its origin sees it.
   * @param actor - identity and scope of the caller.
   * @param id - correction id.
   * @returns the correction.
   */
  async getCorrection(actor: LearningActor, id: FaberLoomCorrectionId): Promise<FaberLoomCorrection> {
    const record = (await this.corrections()).get(id)
    if (record === undefined) throw new Error(`faberloom: NOT_FOUND — correction ${id} not found`)
    requireScope(actor, record)
    return toCorrection(id, record)
  }

  /**
   * List the corrections the actor holds scope over.
   * @param actor - identity and scope of the caller.
   * @param filter - optional item, space, account, and agent filters.
   * @returns the corrections, oldest first.
   */
  async listCorrections(actor: LearningActor, filter: CorrectionFilter = {}): Promise<FaberLoomCorrection[]> {
    const out: FaberLoomCorrection[] = []
    for (const [rawId, record] of (await this.corrections()).entries()) {
      if (!holdsScope(actor, record)) continue
      if (!matchesOriginFilter(record, filter)) continue
      out.push(toCorrection(rawId as FaberLoomCorrectionId, record))
    }
    out.sort((left, right) => left.at.localeCompare(right.at))
    return out
  }

  /**
   * Read one candidate. Reading is limited to whoever holds scope over its
   * origin (§6.3).
   * @param actor - identity and scope of the caller.
   * @param id - candidate id.
   * @returns the candidate.
   */
  async getCandidate(actor: LearningActor, id: FaberLoomCandidateId): Promise<FaberLoomCandidate> {
    const record = (await this.candidates()).get(id)
    if (record === undefined) throw new Error(`faberloom: NOT_FOUND — learning candidate ${id} not found`)
    requireScope(actor, record)
    return toCandidate(id, record)
  }

  /**
   * List the candidates the actor holds scope over.
   * @param actor - identity and scope of the caller.
   * @param filter - optional item, space, account, agent, and status filters.
   * @returns the candidates, oldest first.
   */
  async listCandidates(actor: LearningActor, filter: CandidateFilter = {}): Promise<FaberLoomCandidate[]> {
    const out: FaberLoomCandidate[] = []
    for (const [rawId, record] of (await this.candidates()).entries()) {
      if (!holdsScope(actor, record)) continue
      if (!matchesOriginFilter(record, filter)) continue
      if (filter.status !== undefined && record.status !== filter.status) continue
      out.push(toCandidate(rawId as FaberLoomCandidateId, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }

  /**
   * Promote one candidate to its allowed destination. This is the only path
   * that activates learning, and it revalidates tenant, account, space,
   * classification, and provenance against that destination before committing
   * (W-35, W-47, W-60). A destination wider than the allowed one is rejected;
   * widening goes through {@link widenCandidate}.
   * @param actor - identity and scope of the caller.
   * @param id - candidate id.
   * @param input - destination and the classifications it accepts.
   * @returns the promoted candidate.
   */
  async promoteCandidate(
    actor: LearningActor,
    id: FaberLoomCandidateId,
    input: CandidatePromotionInput,
  ): Promise<FaberLoomCandidate> {
    const table = await this.candidates()
    const record = requireScope(actor, requireRecord(table.get(id), id))
    if (record.status !== 'candidate') throw new Error(`faberloom: NOT_CANDIDATE — candidate ${id} is already promoted`)
    if (input.destination !== record.allowedDestination) {
      throw new Error(`faberloom: DESTINATION_NOT_ALLOWED — ${id} allows only ${record.allowedDestination}`)
    }
    await this.revalidate(actor, record, input)
    const next: CandidateRecord = {
      ...record,
      status: 'promoted',
      promotedBy: actor.id,
      promotedAt: new Date().toISOString(),
      promotionDataClasses: [...input.acceptedDataClasses],
    }
    await table.update(id, () => next)
    return toCandidate(id, next)
  }

  /**
   * Widen a candidate to a wider destination. Widening never moves the
   * original candidate: it produces a new candidate with reviewed content,
   * which still needs its own promotion (W-47). The new candidate revalidates
   * tenant, space, account, classification, and provenance against the wider
   * destination.
   * @param actor - identity and scope of the caller.
   * @param id - candidate to widen.
   * @param input - wider destination, reviewed content, and accepted classifications.
   * @returns the new candidate.
   */
  async widenCandidate(
    actor: LearningActor,
    id: FaberLoomCandidateId,
    input: CandidateWideningInput,
  ): Promise<FaberLoomCandidate> {
    const table = await this.candidates()
    const record = requireScope(actor, requireRecord(table.get(id), id))
    if (DESTINATION_RANK[input.destination] <= DESTINATION_RANK[record.allowedDestination]) {
      throw new Error(`faberloom: NOT_WIDER — ${input.destination} does not widen ${record.allowedDestination}`)
    }
    const text = input.text.trim()
    if (text.length === 0) throw new Error('faberloom: NO_TEXT — a widening carries the reviewed content')
    if (text === record.text) {
      throw new Error('faberloom: REVIEW_REQUIRED — widening needs content reviewed for the wider destination')
    }
    await this.revalidate(actor, record, input)
    const next: CandidateRecord = {
      ...record,
      scope: input.destination,
      allowedDestination: input.destination,
      text,
      status: 'candidate',
      derivedFrom: id,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
      promotedBy: null,
      promotedAt: null,
      promotionDataClasses: null,
    }
    const nextId = brandString<FaberLoomCandidateId>(randomUUID())
    await table.put(nextId, next)
    return toCandidate(nextId, next)
  }

  /**
   * Record what happened to one item, for the maturity metrics. Calls append:
   * the latest outcome of an item decides how the item is counted.
   * @param actor - identity and scope of the caller.
   * @param input - item, task type, and result.
   * @returns nothing.
   */
  async recordOutcome(actor: LearningActor, input: LearningOutcomeInput): Promise<void> {
    const tenantId = input.tenantId ?? null
    if (tenantId !== actor.tenantId) {
      throw new Error('faberloom: NO_ACCESS — the outcome tenant is not the actor tenant')
    }
    const spaceId = input.spaceId ?? null
    if (spaceId !== null && !listsScope(actor.spaceIds, spaceId)) {
      throw new Error('faberloom: NO_ACCESS — the outcome space is outside the actor scope')
    }
    if (input.itemId.trim().length === 0) throw new Error('faberloom: NO_ORIGIN — an outcome names the item it closes')
    if (input.artifactType.trim().length === 0) {
      throw new Error('faberloom: NO_TASK_TYPE — an outcome names its artifact type')
    }
    if (input.actionType.trim().length === 0) {
      throw new Error('faberloom: NO_TASK_TYPE — an outcome names its action type')
    }
    await (await this.outcomes()).put(randomUUID(), {
      tenantId,
      spaceId,
      itemId: input.itemId,
      artifactType: input.artifactType,
      actionType: input.actionType,
      result: input.result,
      at: new Date().toISOString(),
    })
  }

  /**
   * Maturity metrics per task type `(space, artifactType, actionType)`. Each
   * metric is reported on its own: there is no composite index, no cohort
   * rule, and no threshold, because the cohort definition and the alert
   * threshold are unsigned (§10.2). Success is an approval with no correction
   * of any origin, so an answered doubt disqualifies it (W-80).
   * @param actor - identity and scope of the caller.
   * @param filter - optional task-type and period filters.
   * @returns one entry per task type, sorted by its three fields.
   */
  async maturity(actor: LearningActor, filter: MaturityFilter = {}): Promise<readonly MaturityTaskTypeMetrics[]> {
    const loadByItem = new Map<string, CorrectionLoad>()
    const correctedItems = new Set<string>()
    for (const [, record] of (await this.corrections()).entries()) {
      if (!holdsScope(actor, record)) continue
      const key = itemKey(record)
      correctedItems.add(key)
      if (!inPeriod(record.at, filter)) continue
      const load = loadByItem.get(key) ?? { iterations: 0, editedFields: 0, answeredDoubts: 0 }
      if (record.detail.origin === 'iterate') load.iterations += 1
      else if (record.detail.origin === 'edit') load.editedFields += 1
      else load.answeredDoubts += 1
      loadByItem.set(key, load)
    }

    const items = new Map<string, ItemRollup>()
    for (const [, record] of (await this.outcomes()).entries()) {
      if (record.tenantId !== actor.tenantId) continue
      if (record.spaceId !== null && !listsScope(actor.spaceIds, record.spaceId)) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      if (filter.artifactType !== undefined && record.artifactType !== filter.artifactType) continue
      if (filter.actionType !== undefined && record.actionType !== filter.actionType) continue
      if (!inPeriod(record.at, filter)) continue
      const key = itemKey(record)
      const rollup = items.get(key) ?? { latest: record, skipped: false, delegated: 0, reversals: 0 }
      if (isLater(record, rollup.latest)) rollup.latest = record
      if (record.result === 'skipped') rollup.skipped = true
      if (record.result === 'delegated') rollup.delegated += 1
      if (record.result === 'delegated-reversed') rollup.reversals += 1
      items.set(key, rollup)
    }

    const totals = new Map<string, TaskTypeTotals>()
    for (const [key, rollup] of items) {
      const latest = rollup.latest
      const taskType: MaturityTaskType = {
        spaceId: latest.spaceId,
        artifactType: latest.artifactType,
        actionType: latest.actionType,
      }
      const groupKey = taskTypeKey(taskType)
      const group = totals.get(groupKey) ?? { ...taskType, volume: 0, closed: 0, successes: 0, discarded: 0,
        skipped: 0, iterations: 0, editedFields: 0, answeredDoubts: 0, delegated: 0, reversals: 0 }
      const load = loadByItem.get(key)
      group.volume += 1
      if (latest.result === 'approved' && !correctedItems.has(key)) group.successes += 1
      if (latest.result === 'approved' || latest.result === 'discarded') {
        group.closed += 1
        if (latest.result === 'discarded') group.discarded += 1
      }
      if (rollup.skipped) group.skipped += 1
      group.iterations += load?.iterations ?? 0
      group.editedFields += load?.editedFields ?? 0
      group.answeredDoubts += load?.answeredDoubts ?? 0
      group.delegated += rollup.delegated
      group.reversals += rollup.reversals
      totals.set(groupKey, group)
    }

    const out = [...totals.values()].map(toMetrics)
    out.sort((left, right) => taskTypeKey(left).localeCompare(taskTypeKey(right)))
    return out
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

/** Whether the actor holds scope over one origin: same tenant, and every named reference held (§6.3). */
function holdsScope(actor: LearningActor, origin: LearningOrigin): boolean {
  if (actor.tenantId !== origin.tenantId) return false
  if (origin.spaceId !== null && !listsScope(actor.spaceIds, origin.spaceId)) return false
  if (origin.accountRef !== null && !listsScope(actor.accountRefs, origin.accountRef)) return false
  if (origin.agentId !== null && !listsScope(actor.agentIds, origin.agentId)) return false
  return true
}

/** Whether a scope list the actor declares contains one reference. */
function listsScope(declared: readonly string[] | undefined, reference: string): boolean {
  return declared !== undefined && declared.includes(reference)
}

/** Read one origin the actor must hold scope over, or throw `NO_ACCESS`. */
function requireScope<T extends LearningOrigin>(actor: LearningActor, record: T): T {
  if (!holdsScope(actor, record)) {
    throw new Error('faberloom: NO_ACCESS — the origin is outside the actor scope')
  }
  return record
}

/** Read one candidate the caller named, or throw `NOT_FOUND`. */
function requireRecord(record: CandidateRecord | undefined, id: FaberLoomCandidateId): CandidateRecord {
  if (record === undefined) throw new Error(`faberloom: NOT_FOUND — learning candidate ${id} not found`)
  return record
}

/** Whether a record satisfies the origin filters shared by corrections and candidates. */
function matchesOriginFilter(record: LearningOrigin & { readonly itemId: string }, filter: CorrectionFilter): boolean {
  if (filter.itemId !== undefined && record.itemId !== filter.itemId) return false
  if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) return false
  if (filter.accountRef !== undefined && record.accountRef !== filter.accountRef) return false
  if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false
  return true
}

/** Order of destinations by width; widening only moves up (cuenta → espacio → agente). */
const DESTINATION_RANK: Readonly<Record<LearningDestination, number>> = { cuenta: 1, espacio: 2, agente: 3 }

/** Order of data classes by sensitivity; a candidate inherits the highest of its origin (§5.2). */
const DATA_CLASS_RANK: Readonly<Record<LearningDataClass, number>> = { N0: 0, N1: 1, N2: 2, N3: 3, N4: 4 }

/** A candidate plan validated before anything is written. */
interface CandidatePlan {
  /** Destination the candidate is allowed to reach. */
  readonly destination: LearningDestination
  /** Content the candidate carries. */
  readonly text: string
}

/** Correction counts of one origin item. */
interface CorrectionLoad {
  iterations: number
  editedFields: number
  answeredDoubts: number
}

/** What the outcomes of one item add up to. */
interface ItemRollup {
  latest: OutcomeRecord
  skipped: boolean
  delegated: number
  reversals: number
}

/** Running totals of one task type while the report is built. */
interface TaskTypeTotals extends MaturityTaskType {
  volume: number
  closed: number
  successes: number
  discarded: number
  skipped: number
  iterations: number
  editedFields: number
  answeredDoubts: number
  delegated: number
  reversals: number
}

/** Validate the candidate a non-`puntual` scope produces, before anything is written. */
function planCandidate(input: CorrectionInput, scope: LearningDestination, origin: LearningOrigin): CandidatePlan {
  const text = (input.text ?? '').trim()
  if (text.length === 0) {
    throw new Error('faberloom: NO_TEXT — a non-puntual scope carries the rule of its candidate')
  }
  if (destinationRef(origin, scope) === null) {
    throw new Error(`faberloom: NO_DESTINATION — a ${scope} scope needs the ${scope} of its origin`)
  }
  return { destination: scope, text }
}

/** Reject a correction payload that names nothing (§6.3). */
function validateDetail(detail: CorrectionDetail): void {
  if (detail.origin === 'edit') {
    if (detail.field.trim().length === 0) throw new Error('faberloom: NO_FIELD — an inline edit names the field it changed')
    return
  }
  if (detail.origin === 'answer_doubt') {
    if (detail.question.trim().length === 0 || detail.answer.trim().length === 0) {
      throw new Error('faberloom: NO_DOUBT — an answered doubt records the question and the answer')
    }
    return
  }
  if (detail.instructions.trim().length === 0) {
    throw new Error('faberloom: NO_INSTRUCTIONS — an iteration records what the human asked')
  }
  if (!Number.isInteger(detail.rounds) || detail.rounds < 1) {
    throw new Error('faberloom: NO_ROUNDS — an applied iteration records at least one round')
  }
}

/** Copy one correction payload into its durable form. */
function toRecordDetail(detail: CorrectionDetail): CorrectionRecord['detail'] {
  if (detail.origin === 'edit') {
    return { origin: 'edit', field: detail.field, previous: detail.previous, next: detail.next }
  }
  if (detail.origin === 'answer_doubt') {
    return { origin: 'answer_doubt', question: detail.question, answer: detail.answer }
  }
  return { origin: 'iterate', instructions: detail.instructions, diffs: [...detail.diffs], rounds: detail.rounds }
}

/** Highest classification of an origin; a candidate never lowers it (§6.3). */
function highestDataClass(classes: readonly LearningDataClass[]): LearningDataClass {
  return classes.reduce((highest, next) => DATA_CLASS_RANK[next] > DATA_CLASS_RANK[highest] ? next : highest)
}

/** Reference a destination names: the account, the space, or the agent of the origin. */
function destinationRef(origin: LearningOrigin, destination: LearningDestination): string | null {
  if (destination === 'cuenta') return origin.accountRef
  if (destination === 'espacio') return origin.spaceId
  return origin.agentId
}

/** Whether two records carry the same lineage. */
function sameOrigin(left: LearningOrigin, right: LearningOrigin): boolean {
  return left.tenantId === right.tenantId
    && left.spaceId === right.spaceId
    && left.accountRef === right.accountRef
    && left.agentId === right.agentId
}

/** Key of one item inside one tenant, for joining corrections with outcomes. */
function itemKey(record: { readonly tenantId: string | null; readonly itemId: string }): string {
  return `${record.tenantId ?? ''}\u0000${record.itemId}`
}

/** Key of one task type, for grouping the report. */
function taskTypeKey(taskType: MaturityTaskType): string {
  return `${taskType.spaceId ?? ''}\u0000${taskType.artifactType}\u0000${taskType.actionType}`
}

/** Whether one instant falls inside the requested period. */
function inPeriod(at: string, filter: MaturityFilter): boolean {
  if (filter.from !== undefined && at < filter.from) return false
  if (filter.until !== undefined && at > filter.until) return false
  return true
}

/** Whether one outcome is later than another; the first outcome seen at the same instant stays. */
function isLater(candidate: OutcomeRecord, current: OutcomeRecord): boolean {
  return candidate.at > current.at
}

/** Project the running totals of one task type onto its report entry. */
function toMetrics(totals: TaskTypeTotals): MaturityTaskTypeMetrics {
  const total = totals.iterations + totals.editedFields + totals.answeredDoubts
  return {
    spaceId: totals.spaceId,
    artifactType: totals.artifactType,
    actionType: totals.actionType,
    volume: totals.volume,
    closed: totals.closed,
    correctionLoad: {
      iterations: totals.iterations,
      editedFields: totals.editedFields,
      answeredDoubts: totals.answeredDoubts,
      total,
      perItem: totals.volume === 0 ? undefined : total / totals.volume,
    },
    resolvedWithoutIntervention: {
      count: totals.successes,
      rate: totals.closed === 0 ? undefined : totals.successes / totals.closed,
    },
    discarded: {
      count: totals.discarded,
      rate: totals.closed === 0 ? undefined : totals.discarded / totals.closed,
    },
    skipped: {
      count: totals.skipped,
      rate: totals.volume === 0 ? undefined : totals.skipped / totals.volume,
    },
    delegated: {
      count: totals.delegated,
      reversals: totals.reversals,
      reversalRate: totals.delegated === 0 ? undefined : totals.reversals / totals.delegated,
    },
  }
}

export default FaberLoomMemory
