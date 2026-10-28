/**
 * Native product board (`ctx.faberloomBoard`): the WorkLoom work table. Items
 * carry a persisted state, an optimistic `rowVersion`, an audit event per
 * command, a version-bound artifact hash, candidates, and the tenant company.
 * Reads and writes require a `BoardActor`; there is no unfiltered listing.
 * Commands mutate through `KvTable.update`, so state and audit commit in one
 * record. Records are durable through `ctx.storageDomain`.
 *
 * Iteration (§9.7.1) adds one attempt with its lock, its generation, its base
 * version, and a working draft stored apart from the item, so an exit or an
 * expiry ends the attempt without touching the artifact. `iteration.ts` holds
 * the machine; this service authorizes the actor and commits each step.
 * @module @deepseek-ai/dsh-faberloom-board
 */

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  boardDomainSpec,
  type BoardDraftRecord,
  type BoardIterationDraftRecord,
  type BoardItemRecord,
  type BoardKeyRecord,
  type BoardReferenceRecord,
} from './spec.ts'
import { submittedSeverity } from './classify.ts'
import { orderBoardItems } from './order.ts'
import { CHECKS_VERSION, artifactOf, checkClass, checkKey, declaredChecks } from './checks.ts'
import { fieldOriginsOf, mergeOrigins, revisionContent } from './projection.ts'
import {
  attemptFields,
  attemptRejection,
  draftDifferences,
  draftIsRetained,
  draftOf,
  draftRecordFor,
  iterationDraftKeyOf,
  iterationStatusOf,
  lockDeadline,
  releasedFields,
  requireAttemptBase,
  requireAttemptHolder,
  requireBaseVersion,
  requireCandidateChoice,
  requireLiveAttempt,
  requirePausableAttempt,
  requirePending,
  retainUntil,
  stateAfterExpiry,
  type IterationPolicy,
} from './iteration.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  BoardActor,
  BoardApplyIterationInput,
  BoardApproveInput,
  BoardArtifact,
  BoardAssignment,
  BoardCandidate,
  BoardCancelIterationInput,
  BoardCheckFn,
  BoardCheckOptions,
  BoardCheckOutcome,
  BoardCheckReport,
  BoardCheckResult,
  BoardCheckSource,
  BoardCheckStatusEntry,
  BoardColumn,
  BoardCreateInput,
  BoardDataClass,
  BoardDiscardInput,
  BoardEditDraft,
  BoardEditsInput,
  BoardEffectInput,
  BoardEvent,
  BoardFieldOriginEntry,
  BoardIterateInput,
  BoardIterateWithEditsInput,
  BoardIterationDraft,
  BoardIterationDraftInput,
  BoardIterationDraftOutcome,
  BoardIterationLockInput,
  BoardIterationResult,
  BoardIterationStatus,
  BoardPauseIterationInput,
  BoardRecoverDraftInput,
  BoardRecoverDraftResult,
  BoardResumeIterationInput,
  BoardResumeIterationResult,
  BoardReviewInput,
  BoardSeverity,
  BoardState,
  BoardStatus,
  BoardSubmitInput,
  BoardSubmitRequest,
  BoardTransferredDraft,
  BoardWriter,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

export type * from './types.ts'
export * from './checks.ts'
export * from './projection.ts'
export * from './classify.ts'
export * from './order.ts'
export * from './iteration.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomBoard: FaberLoomBoard
  }
}

/** Board configuration accepted by the plugin row. */
export interface Config {
  /** Maximum inline audit events kept per item. */
  readonly eventCap?: number
  /**
   * Minimum classifier confidence accepted as a severity. A proposal below it
   * leaves the item unclassified; the signed pilot value is 0.80 (D-08).
   */
  readonly classifierConfidenceThreshold?: number
  /**
   * Seconds a client waits between iteration lock renewals. D-09 signs 30; the
   * board exposes it so the panel schedules from one value.
   */
  readonly iterationRenewalSeconds?: number
  /** Seconds an iteration attempt lives without activity. D-09 signs 15 minutes. */
  readonly iterationLockSeconds?: number
  /** Days an iteration draft stays recoverable. D-09 signs 30. */
  readonly iterationDraftRetentionDays?: number
  /**
   * Applied iteration rounds after which the panel suggests rewriting or
   * discarding. D-10 signs 5; the counter only suggests and never blocks.
   */
  readonly iterationRoundLimit?: number
}

/** Validated board configuration. */
export const Config = z.object({
  eventCap: z.number().int().positive().default(200),
  classifierConfidenceThreshold: z.number().min(0).max(1).default(0.8),
  iterationRenewalSeconds: z.number().int().positive().default(30),
  iterationLockSeconds: z.number().int().positive().default(900),
  iterationDraftRetentionDays: z.number().int().positive().default(30),
  iterationRoundLimit: z.number().int().positive().default(5),
})

/** Discard reasons signed in the specification. */
export const DISCARD_REASONS = [
  'CLIENTE_CANCELO', 'DUPLICADO', 'ERROR_ORIGEN', 'NO_CORRESPONDE', 'RESUELTO_FUERA', 'OTRA',
] as const

const TERMINAL: readonly BoardState[] = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']
/**
 * States that accept a new artifact as a candidate instead of being replaced
 * (W-03, W-40, W-55, W-76). `DESCONOCIDO` belongs here: the effect may already
 * have happened, so the item must stay traceable.
 */
const NOT_SUBSTITUTABLE: readonly BoardState[] = ['ITERANDO', 'EJECUCION_PENDIENTE', 'DESCONOCIDO']

/** Reference kinds the board records a tenant claim for. */
type ReferenceKind = 'run' | 'execution' | 'account'

/** References one create or submit carries, as the caller supplied them. */
interface BoardReferences {
  readonly spaceId?: string | undefined
  readonly runId?: string | undefined
  readonly executionId?: string | undefined
  readonly accountRef?: string | undefined
}

/** One commercial source a Space declares. */
interface BoardSpaceSource {
  readonly kind: string
  readonly id: string
}

/** The Space fields the board reads to verify a tenant reference. */
interface BoardSpace {
  readonly companyId?: string | undefined
  readonly sources?: readonly BoardSpaceSource[] | undefined
}

/** The `faberloomSpaces` surface the board reads through `ctx.get`. */
interface BoardSpaces {
  get(actor: { id: string; companyId?: string | undefined; role: string; readOnly: boolean }, id: string): Promise<BoardSpace>
}

/** One registered check implementation and the source port it reads. */
interface RegisteredCheck {
  /** The implementation. */
  readonly fn: BoardCheckFn
  /** Source port the registration supplied, or undefined when it supplied none. */
  readonly source: BoardCheckSource | undefined
}

/** The revision one edit produces, before it is appended to the item. */
interface BoardEdit {
  /** Version of the new revision. */
  readonly version: number
  /** The revision record to append. */
  readonly revision: BoardItemRecord['revisions'][number]
  /** Editable content the revision fixes. */
  readonly content: Record<string, unknown>
  /** Origins to persist with the revision. */
  readonly fieldOrigins: BoardFieldOriginEntry[]
  /** Hash that binds the content the caller reviewed. */
  readonly artifactHash: string
}

/**
 * Audit detail of one command: a literal record, nothing, or a callback over the
 * record at its queue slot and the transformed one. The callback exists so an
 * iteration event names the generation and draft the commit actually wrote.
 */
type MutateData =
  | Record<string, unknown>
  | null
  | ((current: BoardItemRecord, next: BoardItemRecord) => Record<string, unknown> | null)

const LEGACY_STATE: Record<BoardStatus, BoardState> = {
  in_progress: 'PENDIENTE_CRITERIO',
  waiting_data: 'PENDIENTE_CRITERIO',
  waiting_approval: 'PENDIENTE_CRITERIO',
  approved: 'APROBADO',
  completed: 'EJECUTADO',
  failed: 'ERROR_RECUPERABLE',
  reopened: 'PENDIENTE_CRITERIO',
  needs_review: 'PENDIENTE_CRITERIO',
}

/**
 * The persisted state, falling back to the legacy status for old records. An
 * attempt whose lock deadline passed already ended, so the item reads as
 * `PENDIENTE_CRITERIO` (W-44); the expiry is derived, never written by a read.
 */
function stateOf(record: BoardItemRecord): BoardState {
  const state = (record.state as BoardState | null) ?? LEGACY_STATE[record.status]
  return stateAfterExpiry(state, record, new Date())
}

/** The visible column, derived from the state. */
function columnOf(state: BoardState): BoardColumn {
  switch (state) {
    case 'PENDIENTE_CRITERIO':
    case 'ITERANDO':
      return 'TU_CRITERIO'
    case 'ESPERANDO_OTRO':
      return 'ESPERANDO_CRITERIO'
    case 'DELEGADO_EN_VENTANA':
    case 'EJECUCION_PENDIENTE':
      return 'DELEGADO'
    case 'ERROR_RECUPERABLE':
    case 'ERROR_SIN_SALIDA':
    case 'DESCONOCIDO':
      return 'ERROR_ACCIONABLE'
    case 'APROBADO':
    case 'EJECUTADO':
    case 'DESCARTADO':
    case 'SUSTITUIDO':
      return 'CERRADO'
    default:
      return 'TU_CRITERIO'
  }
}

/** A stable hash of one artifact payload. */
function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Require at least one real evidence reference. */
function requireEvidence(evidence: readonly string[] | undefined): string[] {
  const list = evidence !== undefined ? [...evidence].filter(entry => entry.trim().length > 0) : []
  if (list.length === 0) throw new Error('faberloom: NO_EVIDENCE — a prepared result requires real evidence')
  return list
}

/**
 * The opaque references one command carries, skipping empty values.
 * @param refs - the references the caller supplied.
 * @returns kind and value pairs.
 */
function opaqueReferences(refs: BoardReferences): [ReferenceKind, string][] {
  const pairs: [ReferenceKind, string | undefined][] = [
    ['run', refs.runId],
    ['execution', refs.executionId],
    ['account', refs.accountRef],
  ]
  return pairs.filter((pair): pair is [ReferenceKind, string] => pair[1] !== undefined && pair[1].trim().length > 0)
}

/** Map one durable record to the consumer-facing item. */
function toItem(id: FaberLoomBoardItemId, record: BoardItemRecord): FaberLoomBoardItem {
  const state = stateOf(record)
  const content = revisionContent(record.revisions[record.revisions.length - 1])
  return {
    id,
    ...record,
    state,
    column: columnOf(state),
    content,
    fieldOrigins: fieldOriginsOf(content, record.fieldOrigins),
    events: record.events.map(event => ({
      ...event,
      fromState: event.fromState as BoardState | null,
      toState: event.toState as BoardState,
    })),
  }
}

/**
 * The product board service: WorkLoom states, commands, audit, candidates, and
 * optimistic concurrency over one key-value aggregate per item.
 */
export class FaberLoomBoard extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof boardDomainSpec>> | undefined
  private readonly eventCap: number
  private readonly confidenceThreshold: number
  private readonly iterationConfig: IterationPolicy
  private readonly claims = new Map<string, Promise<unknown>>()
  /**
   * Registered check implementations, keyed by artifact type and check id. The
   * map is empty until an adapter mounts its controls, so a deployment without
   * adapters never runs a control it did not ask for; a declared control with
   * no entry refuses approval with `CHECK_UNAVAILABLE`.
   */
  private readonly checks = new Map<string, RegisteredCheck>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - inline audit cap, classifier threshold, and iteration policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomBoard')
    const resolved = Config.parse(config)
    this.eventCap = resolved.eventCap
    this.confidenceThreshold = resolved.classifierConfidenceThreshold
    this.iterationConfig = {
      renewalSeconds: resolved.iterationRenewalSeconds,
      lockSeconds: resolved.iterationLockSeconds,
      retentionDays: resolved.iterationDraftRetentionDays,
      roundLimit: resolved.iterationRoundLimit,
    }
  }

  private domain(): Promise<Domain<typeof boardDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(boardDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.boardDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async items(): Promise<KvTable<FaberLoomBoardItemId, BoardItemRecord>> {
    return (await this.domain()).table('items')
  }

  private async keys(): Promise<KvTable<string, BoardKeyRecord>> {
    return (await this.domain()).table('keys')
  }

  private async drafts(): Promise<KvTable<string, BoardDraftRecord>> {
    return (await this.domain()).table('drafts')
  }

  private async references(): Promise<KvTable<string, BoardReferenceRecord>> {
    return (await this.domain()).table('references')
  }

  private async iterationDrafts(): Promise<KvTable<string, BoardIterationDraftRecord>> {
    return (await this.domain()).table('iteration_drafts')
  }

  private draftId(itemId: FaberLoomBoardItemId | string, userId: string): string {
    return `${itemId}:${userId}`
  }

  private keyId(companyId: string | null, kind: string, key: string): string {
    return `${companyId ?? 'sin-empresa'}:${kind}:${key}`
  }

  private referenceKey(companyId: string | null, kind: ReferenceKind, value: string): string {
    return `${companyId ?? 'sin-empresa'}:${kind}:${value}`
  }

  /**
   * Claim one key for an item before its record exists, so a crash leaves a
   * claim without an item rather than two live items on the same key. A claim
   * held by another non-terminal item is a duplicate.
   * @param companyId - the tenant that owns the key space.
   * @param kind - `idem` or `bkey`.
   * @param key - the caller's key.
   * @param itemId - the item the claim names.
   */
  private async claimKey(companyId: string | null, kind: string, key: string, itemId: string): Promise<void> {
    const claimed = (await this.keys()).get(this.keyId(companyId, kind, key))
    if (claimed !== undefined && claimed.itemId !== itemId) {
      const holder = (await this.items()).get(claimed.itemId as FaberLoomBoardItemId)
      if (holder !== undefined && !TERMINAL.includes(stateOf(holder))) {
        throw new Error('faberloom: DUPLICATE — the key already owns a non-terminal item')
      }
    }
    await (await this.keys()).put(this.keyId(companyId, kind, key), { itemId, kind, at: new Date().toISOString() })
  }

  private async release(companyId: string | null, kind: string, key: string | null): Promise<void> {
    if (key === null) return
    await (await this.keys()).delete(this.keyId(companyId, kind, key))
  }

  private async claimedItem(companyId: string | null, kind: string, key: string): Promise<FaberLoomBoardItemId | undefined> {
    const claim = (await this.keys()).get(this.keyId(companyId, kind, key))
    return claim === undefined ? undefined : claim.itemId as FaberLoomBoardItemId
  }

  /**
   * Refuse an item that names an object of another tenant (W-24). A Space is
   * resolved through the mounted Spaces service, which owns its tenant. The
   * board owns no run, execution, or account registry, so an opaque reference
   * is compared with the tenant that already stored it; a reference whose
   * tenant cannot be established is refused rather than stored.
   * @param actor - the acting identity.
   * @param companyId - the tenant the item will carry.
   * @param refs - the references the caller supplied.
   */
  private async verifyReferences(actor: BoardActor, companyId: string | null, refs: BoardReferences): Promise<void> {
    if (refs.spaceId !== undefined) await this.requireTenantSpace(actor, companyId, refs.spaceId, 'CROSS_TENANT_REFERENCE')
    for (const [kind, value] of opaqueReferences(refs)) {
      const claim = await this.referenceClaim(kind, value)
      if (claim !== undefined && claim.companyId !== companyId) {
        throw new Error(`faberloom: CROSS_TENANT_REFERENCE — the ${kind} reference belongs to another tenant`)
      }
    }
  }

  /** The claim already stored for one opaque reference, when any. */
  private async referenceClaim(kind: ReferenceKind, value: string): Promise<BoardReferenceRecord | undefined> {
    for (const [, record] of (await this.references()).entries()) {
      if (record.kind === kind && record.value === value) return record
    }
    return undefined
  }

  /**
   * Record the tenant of every opaque reference the item now stores.
   * @param companyId - the tenant the item carries.
   * @param itemId - the item that stored the references.
   * @param refs - the references the caller supplied.
   */
  private async claimReferences(companyId: string | null, itemId: string, refs: BoardReferences): Promise<void> {
    const table = await this.references()
    const at = new Date().toISOString()
    for (const [kind, value] of opaqueReferences(refs)) {
      const key = this.referenceKey(companyId, kind, value)
      if (table.get(key) !== undefined) continue
      await table.put(key, { companyId, kind, value, itemId, at })
    }
  }

  /**
   * Resolve one Space inside the actor's tenant. Without a mounted Spaces
   * service the reference cannot be verified, so it is refused.
   * @param actor - the acting identity.
   * @param companyId - the tenant the item carries.
   * @param spaceId - the referenced Space.
   * @param code - contract error code: a stored reference crosses tenants, a destination space is out of scope.
   * @returns the resolved Space.
   */
  private async requireTenantSpace(
    actor: BoardActor,
    companyId: string | null,
    spaceId: string,
    code: 'CROSS_TENANT_REFERENCE' | 'NO_ACCESS',
  ): Promise<BoardSpace> {
    const spaces = this.ctx.get('faberloomSpaces') as BoardSpaces | undefined
    if (spaces === undefined) {
      throw new Error(`faberloom: ${code} — no Spaces service can verify the space ${spaceId}`)
    }
    let space: BoardSpace
    try {
      space = await spaces.get({ id: actor.id, companyId: actor.companyId, role: 'client_b2b', readOnly: false }, spaceId)
    } catch (error) {
      throw new Error(`faberloom: ${code} — the space ${spaceId} is not readable by the actor`, { cause: error })
    }
    const spaceCompany = space.companyId ?? null
    if (spaceCompany !== null && spaceCompany !== companyId) {
      throw new Error(`faberloom: ${code} — the space ${spaceId} belongs to another tenant`)
    }
    return space
  }

  private async serial<T>(companyId: string | null, task: () => Promise<T>): Promise<T> {
    const id = companyId ?? 'sin-empresa'
    const previous = this.claims.get(id) ?? Promise.resolve()
    const run = previous.then(task, task)
    this.claims.set(id, run.catch(() => undefined))
    return run
  }

  // ── Checks (E12) ────────────────────────────────────────────────────

  /**
   * Register one check implementation for a declared control. The registry is
   * mounted from outside the board (ADR-003): an adapter calls this from
   * `ctx.effect`, exactly like the handlers package mounts its handlers.
   *
   * A pair the board does not declare is refused, so a typo in an artifact type
   * or a check id fails at load instead of silently never running. The class is
   * signed by D-8, and a registration that disagrees is refused.
   * @param artifactType - artifact type the check applies to.
   * @param checkId - declared check id.
   * @param fn - the implementation.
   * @param options - signed class and the source port the check reads.
   * @returns the disposer that removes this registration.
   */
  registerCheck(artifactType: string, checkId: string, fn: BoardCheckFn, options: BoardCheckOptions): () => void {
    const signed = checkClass(artifactType, checkId)
    if (signed === undefined) {
      throw new Error(`faberloom: CHECK_UNKNOWN — ${checkId} is not a declared control of ${artifactType}`)
    }
    if (signed !== options.class) {
      throw new Error(`faberloom: CHECK_CLASS_MISMATCH — ${checkId} is ${signed}, not ${options.class}`)
    }
    const key = checkKey(artifactType, checkId)
    const registration: RegisteredCheck = { fn, source: options.source }
    this.checks.set(key, registration)
    return () => {
      if (this.checks.get(key) === registration) this.checks.delete(key)
    }
  }

  /**
   * Which declared controls of one artifact type have an adapter.
   * @param artifactType - artifact type to inspect.
   * @returns the declared controls with their registration state.
   */
  checkStatus(artifactType: string): readonly BoardCheckStatusEntry[] {
    return declaredChecks(artifactType).map(definition => ({
      id: definition.id,
      class: definition.class,
      registered: this.checks.has(checkKey(artifactType, definition.id)),
    }))
  }

  /**
   * Run every declared control of one item without persisting anything. The
   * panel reads this for its verification zone; approval calls the same path
   * immediately before the transition, with no cache (W-50).
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the executed controls and the declared ones with no adapter.
   */
  async runChecks(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardCheckReport> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return await this.evaluateChecks(record, id)
  }

  /**
   * Execute the declared controls of one item against its current revision.
   * @param record - the stored item.
   * @param id - item id.
   * @returns the results and the declared controls with no adapter.
   */
  private async evaluateChecks(record: BoardItemRecord, id: FaberLoomBoardItemId): Promise<BoardCheckReport> {
    const item = toItem(id, record)
    const artifact = artifactOf(item)
    const outcomes: BoardCheckOutcome[] = []
    const missing: string[] = []
    for (const definition of declaredChecks(item.artifactType)) {
      const registration = this.checks.get(checkKey(item.artifactType, definition.id))
      if (registration === undefined) {
        missing.push(definition.id)
        continue
      }
      const result = await this.runCheck(registration, item, artifact)
      outcomes.push({ id: definition.id, class: definition.class, result })
    }
    return { checks: outcomes, missing }
  }

  /**
   * Run one check. A check that throws — a source timeout, a broken adapter, a
   * registration with no source port — reports `fail`, because an unavailable
   * source counts as a failed control and never as a skipped one (W-50, ADR-003).
   * @param registration - the implementation and its source port.
   * @param item - the item under review.
   * @param artifact - the exact revision under review.
   * @returns the control result.
   */
  private async runCheck(
    registration: RegisteredCheck,
    item: FaberLoomBoardItem,
    artifact: BoardArtifact,
  ): Promise<BoardCheckResult> {
    try {
      return await registration.fn({ item, artifact, source: registration.source })
    } catch (error) {
      return {
        status: 'fail',
        source: 'unavailable',
        sourceVersion: null,
        checkedAt: new Date().toISOString(),
        fields: [],
        reason: 'SOURCE_UNAVAILABLE',
        detail: error instanceof Error ? error.message : null,
      }
    }
  }

  /**
   * Refuse an approval the controls do not allow: a declared control with no
   * adapter, a blocking control in failure, or a confirmation control in
   * failure the caller did not confirm (D-01, D-02, W-49).
   * @param report - the fresh control report of the item.
   * @param confirmations - control ids the caller explicitly confirmed.
   */
  private requireChecksPassable(report: BoardCheckReport, confirmations: readonly string[]): void {
    if (report.missing.length > 0) {
      throw new Error(`faberloom: CHECK_UNAVAILABLE — no adapter registered for ${report.missing.join(', ')}`)
    }
    const blocked = report.checks.filter(outcome => outcome.class === 'bloqueante' && outcome.result.status === 'fail')
    if (blocked.length > 0) {
      const detail = blocked.map(outcome => `${outcome.id} ${outcome.result.reason ?? 'fail'}`).join(', ')
      throw new Error(`faberloom: BLOCKING_CHECK — ${detail}`)
    }
    const confirmed = new Set(confirmations)
    const pending = report.checks.filter(outcome => outcome.class === 'confirmacion'
      && outcome.result.status === 'fail'
      && !confirmed.has(outcome.id))
    if (pending.length > 0) {
      throw new Error(`faberloom: CHECK_CONFIRMATION_REQUIRED — confirm ${pending.map(outcome => outcome.id).join(', ')}`)
    }
  }

  /**
   * The audit detail of one approval: which controls ran, what they answered,
   * from which source and when, and which failures the human confirmed.
   * @param report - the control report the approval used.
   * @param confirmations - control ids the caller confirmed.
   * @returns the event detail, or null when the artifact type declares no control.
   */
  private checkEventData(report: BoardCheckReport, confirmations: readonly string[]): Record<string, unknown> | null {
    if (report.checks.length === 0) return null
    return {
      checksVersion: CHECKS_VERSION,
      checks: report.checks.map(outcome => ({
        id: outcome.id,
        class: outcome.class,
        status: outcome.result.status,
        reason: outcome.result.reason ?? null,
        source: outcome.result.source,
        sourceVersion: outcome.result.sourceVersion,
        checkedAt: outcome.result.checkedAt,
      })),
      confirmed: [...confirmations],
    }
  }

  /**
   * Refuse a write whose row token is not the current one.
   * @param current - the stored record.
   * @param expected - the token the caller read, or undefined when the command carries none.
   */
  private requireRowVersion(current: BoardItemRecord, expected: number | undefined): void {
    if (expected !== undefined && current.rowVersion !== expected) {
      throw new Error('faberloom: STALE_ROW — the item changed since it was read')
    }
  }

  /** The editable content of one record's current revision. */
  private contentOf(record: BoardItemRecord): Record<string, unknown> {
    return revisionContent(record.revisions[record.revisions.length - 1])
  }

  /**
   * The revision one edit produces: content merged over the current revision,
   * the hash that binds it, and the origins the edit invalidates.
   * @param current - the stored record.
   * @param changes - fields the caller wrote.
   * @returns the version, revision record, content, origins, and hash.
   */
  private editRevision(current: BoardItemRecord, changes: Record<string, unknown>): BoardEdit {
    const previous = current.revisions[current.revisions.length - 1]
    const content: Record<string, unknown> = { ...this.contentOf(current), ...changes }
    const summary = typeof content['summary'] === 'string' ? content['summary'] : previous?.summary ?? ''
    const evidence = previous?.evidence ?? []
    const version = current.version + 1
    return {
      version,
      content,
      fieldOrigins: mergeOrigins(current.fieldOrigins, Object.keys(changes)),
      artifactHash: hashOf({ summary, evidence, content }),
      revision: {
        version,
        summary,
        evidence: [...evidence],
        content,
        documentRef: previous?.documentRef ?? null,
        at: new Date().toISOString(),
      },
    }
  }

  private async requireItem(id: FaberLoomBoardItemId): Promise<BoardItemRecord> {
    const record = (await this.items()).get(id)
    if (record === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} not found`)
    return record
  }

  private event(input: {
    command: string
    actor: string
    fromState: BoardState | null
    toState: BoardState
    revision: number | null
    artifactHash: string | null
    reason?: string | null | undefined
    data?: Record<string, unknown> | null | undefined
  }): BoardEvent {
    return {
      id: randomUUID(),
      command: input.command,
      actor: input.actor,
      fromState: input.fromState,
      toState: input.toState,
      revision: input.revision,
      artifactHash: input.artifactHash,
      reason: input.reason ?? null,
      at: new Date().toISOString(),
      data: input.data ?? null,
    }
  }

  /**
   * Apply one command inside a single `update` transform: authorization,
   * optimistic check, state change, and appended event commit together. A
   * `data` callback receives the record at its queue slot and the transformed
   * one, so an audit event names the values the command actually wrote.
   */
  private async mutate(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    command: string,
    transform: (current: BoardItemRecord, actor: BoardActor) => BoardItemRecord,
    options: {
      expectedRowVersion?: number | undefined
      reason?: string | null | undefined
      data?: MutateData
    } = {},
  ): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    const table = await this.items()
    let next: BoardItemRecord | undefined
    await table.update(id, (current) => {
      this.authorizeWrite(current, writer)
      this.requireRowVersion(current, options.expectedRowVersion)
      const candidate = transform(current, actor)
      const fromState = stateOf(current)
      const toState = stateOf(candidate)
      const event = this.event({
        command,
        actor: actor.id,
        fromState,
        toState,
        revision: candidate.version,
        artifactHash: candidate.artifactHash,
        reason: options.reason,
        data: typeof options.data === 'function' ? options.data(current, candidate) : options.data,
      })
      next = {
        ...candidate,
        rowVersion: current.rowVersion + 1,
        events: [...current.events, event].slice(-this.eventCap),
        updatedAt: event.at,
      }
      return next
    })
    if (next === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} disappeared during the command`)
    return toItem(id, next)
  }

  private buildRecord(
    actor: BoardActor,
    input: BoardCreateInput & {
      runId?: string
      idempotencyKey?: string
      businessKey?: string
      state?: BoardState
      supersedesItemId?: string | null
      valueAmount?: number
      valueCurrency?: string
      dueAt?: string
      dataClass?: BoardDataClass
      severity?: BoardSeverity
      severityConfidence?: number
    },
  ): BoardItemRecord {
    const now = new Date().toISOString()
    const evidence = requireEvidence(input.evidence)
    const content = input.content === undefined ? null : { ...input.content }
    const fieldOrigins = input.fieldOrigins === undefined ? [] : [...input.fieldOrigins]
    const artifactHash = hashOf({ summary: input.summary, evidence, content })
    const severity = submittedSeverity(
      input.severity,
      input.severityConfidence ?? null,
      this.confidenceThreshold,
    )
    return {
      ownerId: actor.id,
      companyId: input.companyId ?? actor.companyId ?? null,
      spaceId: input.spaceId ?? null,
      routineId: input.routineId ?? null,
      title: input.title,
      status: 'waiting_approval',
      state: input.state ?? 'PENDIENTE_CRITERIO',
      rowVersion: 1,
      severity: severity.severity,
      severitySource: severity.source,
      severityConfidence: severity.confidence,
      dueAt: input.dueAt ?? null,
      valueAmount: input.valueAmount ?? null,
      valueCurrency: input.valueCurrency ?? null,
      valueUsd: input.valueCurrency === 'USD' ? input.valueAmount ?? null : null,
      dataClass: input.dataClass ?? 'N2',
      dataClassProvisional: input.dataClass === undefined,
      runId: input.runId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      businessKey: input.businessKey ?? null,
      supersedesItemId: input.supersedesItemId ?? null,
      artifactType: input.artifactType ?? 'provisional',
      accountRef: input.accountRef ?? null,
      artifactHash,
      fieldOrigins,
      pendingCandidate: null,
      events: [this.event({
        command: 'submit', actor: actor.id, fromState: null, toState: input.state ?? 'PENDIENTE_CRITERIO',
        revision: 1, artifactHash,
      })],
      discardReason: null,
      discardNote: null,
      iterationId: null,
      iterationDraftKey: null,
      iterationLockUntil: null,
      iterationLockGeneration: 0,
      iterationBaseVersion: null,
      iterationLockBy: null,
      iterationRoundCount: 0,
      version: 1,
      revisions: [{ version: 1, summary: input.summary, evidence, content, documentRef: input.documentRef ?? null, at: now }],
      approvedRevision: null,
      stale: false,
      staleReason: null,
      effects: [],
      reviews: [],
      executionId: input.executionId ?? null,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Create one prepared item awaiting review; evidence is mandatory.
   * @param writer - the owning identity; a bare id is a legacy single-tenant actor.
   * @param input - title, summary, evidence, optional space, document, execution.
   * @returns the created item.
   */
  async create(writer: BoardWriter, input: BoardCreateInput): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    if (input.companyId !== undefined && input.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item company is not the actor company')
    }
    const companyId = input.companyId ?? actor.companyId ?? null
    await this.verifyReferences(actor, companyId, {
      spaceId: input.spaceId,
      executionId: input.executionId,
      accountRef: input.accountRef,
    })
    const id = brandString<FaberLoomBoardItemId>(randomUUID())
    const record = this.buildRecord(actor, input)
    await (await this.items()).put(id, record)
    await this.claimReferences(companyId, id, { executionId: input.executionId, accountRef: input.accountRef })
    return toItem(id, record)
  }

  /**
   * Create one item from an Action Engine run. `runId`, `idempotencyKey`, and
   * `businessKey` are mandatory; a repeated key returns the existing item.
   * @param writer - the acting identity.
   * @param input - run identity, artifact identity, title, summary, and evidence.
   * @returns the created or deduplicated item.
   */
  async submit(writer: BoardWriter, input: BoardSubmitRequest): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    if (input.runId.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires a run id')
    if (input.idempotencyKey.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires an idempotency key')
    if (input.businessKey.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires a business key')
    if (input.companyId !== undefined && input.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item company is not the actor company')
    }
    const companyId = input.companyId ?? actor.companyId ?? null
    const references: BoardReferences = {
      spaceId: input.spaceId,
      runId: input.runId,
      executionId: input.executionId,
      accountRef: input.accountRef,
    }
    await this.verifyReferences(actor, companyId, references)

    return await this.serial(companyId, async () => {
      const existingId = await this.claimedItem(companyId, 'idem', input.idempotencyKey)
      if (existingId !== undefined) return toItem(existingId, await this.requireItem(existingId))

      const existing = await this.findNonTerminal(companyId, input.businessKey)
      let supersedes: string | null = null
      if (existing !== undefined) {
        // Uniqueness is per tenant, not per owner: another owner's live item on
        // the same key cannot be superseded by this actor.
        if (existing.record.ownerId !== actor.id) {
          throw new Error('faberloom: DUPLICATE — the business key already owns a non-terminal item')
        }
        const existingState = stateOf(existing.record)
        if (NOT_SUBSTITUTABLE.includes(existingState) || existingState === 'ERROR_RECUPERABLE') {
          const candidate: BoardCandidate = {
            id: randomUUID(),
            hash: hashOf({ summary: input.summary, evidence: input.evidence }),
            summary: input.summary,
            evidence: requireEvidence(input.evidence),
            at: new Date().toISOString(),
          }
          await this.mutate(actor, existing.id, 'candidate_arrived', current => ({ ...current, pendingCandidate: candidate }))
          await this.claimKey(companyId, 'idem', input.idempotencyKey, existing.id)
          return toItem(existing.id, await this.requireItem(existing.id))
        }
        await this.mutate(actor, existing.id, 'superseded', current => ({
          ...current, state: 'SUSTITUIDO', status: 'completed',
        }), { reason: 'new-artifact' })
        await this.release(companyId, 'bkey', existing.record.businessKey)
        supersedes = existing.id
      }

      const id = brandString<FaberLoomBoardItemId>(randomUUID())
      const record = this.buildRecord(actor, {
        ...input,
        title: input.title ?? input.summary.slice(0, 80),
        companyId: companyId ?? undefined,
        supersedesItemId: supersedes,
      })
      // Both keys are claimed before the record exists: a crash between the
      // claim and the put leaves a claim, never a second live item.
      await this.claimKey(companyId, 'idem', input.idempotencyKey, id)
      try {
        await this.claimKey(companyId, 'bkey', input.businessKey, id)
        await (await this.items()).put(id, record)
      } catch (error) {
        await this.release(companyId, 'idem', input.idempotencyKey)
        await this.release(companyId, 'bkey', input.businessKey)
        throw error
      }
      await this.claimReferences(companyId, id, references)
      return toItem(id, record)
    })
  }

  /**
   * The non-terminal item of this tenant holding one business key (W-39).
   * @param companyId - the tenant that owns the key space.
   * @param businessKey - the business identity.
   * @param excludeId - an item to skip, typically the one the caller is acting on.
   * @returns the item and its record, or undefined.
   */
  private async findNonTerminal(
    companyId: string | null,
    businessKey: string,
    excludeId?: FaberLoomBoardItemId,
  ): Promise<{ id: FaberLoomBoardItemId; record: BoardItemRecord } | undefined> {
    for (const [id, record] of (await this.items()).entries()) {
      if (id === excludeId) continue
      if (record.companyId !== companyId) continue
      if (record.businessKey !== businessKey) continue
      if (TERMINAL.includes(stateOf(record))) continue
      return { id, record }
    }
    return undefined
  }

  /**
   * Record the human severity and its provenance.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param severity - the chosen severity.
   * @param source - who assigned it.
   * @param confidence - original classifier confidence, when known.
   * @param expectedRowVersion - optimistic token.
   * @returns the updated item.
   */
  async setSeverity(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    severity: BoardSeverity,
    source: 'RULE' | 'LLM' | 'HUMAN' = 'HUMAN',
    confidence: number | null = null,
    expectedRowVersion?: number,
  ): Promise<FaberLoomBoardItem> {
    const previous = (await this.requireItem(id)).severity
    return await this.mutate(writer, id, 'set_severity', current => ({
      ...current, severity, severitySource: source, severityConfidence: confidence,
    }), {
      expectedRowVersion,
      data: { previous, source, confidence },
    })
  }

  /**
   * Refuse an edit while the item is iterating or already closed (W-10). The
   * panel hides the controls; the service is the enforcement point for MCP and
   * agent callers.
   * @param current - the stored record.
   */
  private requireEditable(current: BoardItemRecord): void {
    const state = stateOf(current)
    if (state === 'ITERANDO') throw new Error('faberloom: NO_ACCESS — the item is iterating and cannot be edited')
    if (TERMINAL.includes(state)) throw new Error('faberloom: NO_ACCESS — the item is closed and cannot be edited')
  }

  /**
   * Save inline edits as a new revision and hash.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - base version, expected row version, and changes.
   * @returns the updated item.
   */
  async saveEdits(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEditsInput): Promise<FaberLoomBoardItem> {
    const updated = await this.mutate(writer, id, 'save_edits', (current) => {
      this.requireEditable(current)
      if (current.version !== input.baseVersion) {
        throw new Error('faberloom: STALE_REVISION — the edits were made against an older version')
      }
      const edit = this.editRevision(current, input.changes)
      return {
        ...current,
        version: edit.version,
        artifactHash: edit.artifactHash,
        fieldOrigins: edit.fieldOrigins,
        stale: false,
        staleReason: null,
        revisions: [...current.revisions, edit.revision],
      }
    }, { expectedRowVersion: input.expectedRowVersion })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Approve the exact artifact version. It never sends anything, and the
   * blocking and source-changing controls run again immediately before the
   * transition, with no cache (W-49, W-50).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - expected row, artifact version and hash, and confirmed controls.
   * @returns the approved item.
   */
  async approve(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApproveInput): Promise<FaberLoomBoardItem> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    this.requireRowVersion(current, input.expectedRowVersion)
    this.requireApprovable(current, input)
    const confirmations = input.confirmations ?? []
    const report = await this.evaluateChecks(current, id)
    this.requireChecksPassable(report, confirmations)
    const updated = await this.mutate(writer, id, 'approve', (item) => {
      this.requireApprovable(item, input)
      return { ...item, state: 'APROBADO', status: 'approved', approvedRevision: item.version, stale: false, staleReason: null }
    }, { expectedRowVersion: input.expectedRowVersion, data: this.checkEventData(report, confirmations) })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Save edits and approve the resulting version in one command. The controls
   * run against the edited content, because that is the version being approved.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - approval expectations plus the edits.
   * @returns the approved item.
   */
  async approveWithEdits(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardApproveInput & BoardEditsInput,
  ): Promise<FaberLoomBoardItem> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    this.requireRowVersion(current, input.expectedRowVersion)
    this.requireApprovable(current, input)
    if (current.version !== input.baseVersion) {
      throw new Error('faberloom: STALE_REVISION — the edits were made against an older version')
    }
    const confirmations = input.confirmations ?? []
    const preview = this.editRevision(current, input.changes)
    const report = await this.evaluateChecks({
      ...current,
      version: preview.version,
      artifactHash: preview.artifactHash,
      fieldOrigins: preview.fieldOrigins,
      revisions: [...current.revisions, preview.revision],
    }, id)
    this.requireChecksPassable(report, confirmations)

    const updated = await this.mutate(writer, id, 'approve_with_edits', (item) => {
      this.requireApprovable(item, input)
      if (item.version !== input.baseVersion) {
        throw new Error('faberloom: STALE_REVISION — the edits were made against an older version')
      }
      const edit = this.editRevision(item, input.changes)
      return {
        ...item,
        version: edit.version,
        artifactHash: edit.artifactHash,
        fieldOrigins: edit.fieldOrigins,
        state: 'APROBADO',
        status: 'approved',
        approvedRevision: edit.version,
        stale: false,
        staleReason: null,
        revisions: [...item.revisions, edit.revision],
      }
    }, { expectedRowVersion: input.expectedRowVersion, data: this.checkEventData(report, confirmations) })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  private requireApprovable(current: BoardItemRecord, input: BoardApproveInput): void {
    if (stateOf(current) !== 'PENDIENTE_CRITERIO') {
      throw new Error('faberloom: NO_ACCESS — the item is not waiting for a decision')
    }
    if (current.severity === null) throw new Error('faberloom: SEVERITY_REQUIRED — confirm the severity first')
    if (current.pendingCandidate !== null) throw new Error('faberloom: CANDIDATE_PENDING — resolve the new version first')
    if (current.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
    if (current.version !== input.expectedArtifactVersion) {
      throw new Error('faberloom: STALE_REVISION — the reviewed revision is not current')
    }
    if (current.artifactHash !== input.expectedArtifactHash) {
      throw new Error('faberloom: STALE_REVISION — the reviewed artifact hash is not current')
    }
  }

  /**
   * Discard an item with a signed reason.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - expected row, reason, and optional note.
   * @returns the discarded item.
   */
  async discard(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardDiscardInput): Promise<FaberLoomBoardItem> {
    if (!DISCARD_REASONS.includes(input.reason as typeof DISCARD_REASONS[number])) {
      throw new Error('faberloom: REASON_INVALID — the discard reason is not in the closed list')
    }
    if (input.reason === 'OTRA' && (input.note === undefined || input.note.trim().length === 0)) {
      throw new Error('faberloom: REASON_REQUIRED — OTRA requires a note')
    }
    const updated = await this.mutate(writer, id, 'discard', (current) => {
      const state = stateOf(current)
      if (state === 'ITERANDO') throw new Error('faberloom: NO_ACCESS — the item is iterating and cannot be discarded')
      if (state === 'DESCONOCIDO') throw new Error('faberloom: NO_ACCESS — the item result is unknown and cannot be discarded')
      if (TERMINAL.includes(state)) throw new Error('faberloom: NO_ACCESS — the item is closed and cannot be discarded')
      if (current.severity === null) throw new Error('faberloom: SEVERITY_REQUIRED — confirm the severity first')
      if (current.pendingCandidate !== null) throw new Error('faberloom: CANDIDATE_PENDING — resolve the new version first')
      return {
        ...current,
        state: 'DESCARTADO',
        status: 'completed',
        discardReason: input.reason,
        discardNote: input.note ?? null,
      }
    }, { expectedRowVersion: input.expectedRowVersion, reason: input.reason })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Adopt or keep the pending candidate.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param candidateId - candidate the user saw.
   * @param candidateHash - hash the user saw.
   * @param decision - adopt or keep.
   * @returns the updated item.
   */
  async resolveCandidate(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    candidateId: string,
    candidateHash: string,
    decision: 'adopt' | 'keep',
  ): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'resolve_candidate', (current) => {
      const candidate = current.pendingCandidate
      if (candidate === null || candidate.id !== candidateId || candidate.hash !== candidateHash) {
        throw new Error('faberloom: CANDIDATE_STALE — the candidate is no longer the last one')
      }
      if (decision === 'keep') return { ...current, pendingCandidate: null }
      const version = current.version + 1
      return {
        ...current,
        version,
        artifactHash: candidate.hash,
        pendingCandidate: null,
        fieldOrigins: [],
        revisions: [...current.revisions, {
          version, summary: candidate.summary, evidence: candidate.evidence, content: null,
          documentRef: null, at: candidate.at,
        }],
      }
    }, { data: { choice: decision } })
  }

  /**
   * Assign a space (and its root workspace) to an item. A collision with
   * another live item on the same business key resolves by the §2.3 rule: a
   * substitutable item closes, a non-substitutable one receives the artifact as
   * a candidate and stays open. The drafts of the item that closes move to the
   * live one, marked with their base version and origin (W-98).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param workspaceId - target space/workspace id.
   * @returns the live item and the drafts the collision moved to it.
   */
  async assignWorkspace(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    workspaceId: string,
  ): Promise<BoardAssignment> {
    const actor = this.actorOf(writer)
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    if (TERMINAL.includes(stateOf(record))) {
      throw new Error('faberloom: NO_ACCESS — a closed item cannot be assigned to a space')
    }
    const companyId = record.companyId
    const space = await this.requireTenantSpace(actor, companyId, workspaceId, 'NO_ACCESS')
    this.requireCompatibleAccount(record, space)

    return await this.serial(companyId, async () => {
      const current = await this.requireItem(id)
      this.authorizeWrite(current, writer)
      if (TERMINAL.includes(stateOf(current))) {
        throw new Error('faberloom: NO_ACCESS — a closed item cannot be assigned to a space')
      }
      // The business key is the item's own identity (§2.1); assigning a space
      // never rewrites it, so the key keeps deduping the pair.
      const key = current.businessKey
      if (key === null) {
        const item = await this.mutate(writer, id, 'assign_workspace', entry => ({ ...entry, spaceId: workspaceId }))
        return { item, transferredDrafts: [] }
      }
      const other = await this.findNonTerminal(companyId, key, id)
      let superseded: string | null = null
      let transferredDrafts: readonly BoardTransferredDraft[] = []
      if (other !== undefined && other.id !== id) {
        if (other.record.ownerId !== current.ownerId) {
          throw new Error('faberloom: DUPLICATE — the business key already owns a non-terminal item')
        }
        if (NOT_SUBSTITUTABLE.includes(stateOf(other.record))) {
          const candidate = this.candidateOf(current)
          await this.mutate(writer, other.id, 'candidate_arrived', item => ({
            ...item, pendingCandidate: candidate,
          }))
          await this.mutate(writer, id, 'superseded', item => ({
            ...item, state: 'SUSTITUIDO', status: 'completed', iterationDraftKey: null,
          }), { reason: 'transferred-as-candidate' })
          transferredDrafts = await this.transferDrafts(current, id, other.id)
          await this.claimKey(companyId, 'bkey', key, other.id)
          return { item: toItem(other.id, await this.requireItem(other.id)), transferredDrafts }
        }
        await this.mutate(writer, other.id, 'superseded', item => ({
          ...item, state: 'SUSTITUIDO', status: 'completed', iterationDraftKey: null,
        }), { reason: 'workspace-collision' })
        transferredDrafts = await this.transferDrafts(other.record, other.id, id)
        await this.release(companyId, 'bkey', key)
        superseded = other.id
      }
      await this.claimKey(companyId, 'bkey', key, id)
      const item = await this.mutate(writer, id, 'assign_workspace', entry => ({
        ...entry,
        spaceId: workspaceId,
        supersedesItemId: superseded ?? entry.supersedesItemId,
      }))
      return { item, transferredDrafts }
    })
  }

  /**
   * Move the drafts of the item a collision closed to the item that stays live,
   * marked with the version they were written on and the item they came from
   * (§2.3, W-98). A row the source key does not attribute to that item, and a
   * destination key already taken, stay where they are instead of being
   * guessed. The source links no draft afterwards.
   * @param source - record of the item that closed.
   * @param sourceId - its id.
   * @param receivingId - live item that lists the drafts.
   * @returns one reference per moved draft.
   */
  private async transferDrafts(
    source: BoardItemRecord,
    sourceId: FaberLoomBoardItemId,
    receivingId: FaberLoomBoardItemId,
  ): Promise<BoardTransferredDraft[]> {
    const moved: BoardTransferredDraft[] = []
    const iterationDrafts = await this.iterationDrafts()
    const iterationKey = source.iterationDraftKey
    const prefix = `${sourceId}:`
    if (iterationKey !== null && iterationKey.startsWith(prefix)) {
      const iterationId = iterationKey.slice(prefix.length)
      const row = iterationDrafts.get(iterationKey)
      const targetKey = iterationDraftKeyOf(receivingId, iterationId)
      if (row !== undefined && iterationId.length > 0 && row.itemId === sourceId
        && row.iterationId === iterationId && iterationDrafts.get(targetKey) === undefined) {
        const origin = row.transferredFrom === null
          ? sourceId
          : brandString<FaberLoomBoardItemId>(row.transferredFrom)
        await iterationDrafts.put(targetKey, { ...row, itemId: receivingId, transferredFrom: origin })
        await iterationDrafts.delete(iterationKey)
        moved.push({
          kind: 'iteration',
          itemId: receivingId,
          key: targetKey,
          iterationId,
          userId: null,
          baseVersion: row.baseVersion,
          transferredFrom: origin,
        })
      }
    }
    const edits = await this.drafts()
    for (const [key, row] of [...edits.entries()]) {
      if (!key.startsWith(prefix)) continue
      const userId = key.slice(prefix.length)
      const targetKey = this.draftId(receivingId, userId)
      if (userId.length === 0 || row.itemId !== sourceId || row.userId !== userId
        || edits.get(targetKey) !== undefined) continue
      const origin = row.transferredFrom === null
        ? sourceId
        : brandString<FaberLoomBoardItemId>(row.transferredFrom)
      await edits.put(targetKey, { ...row, itemId: receivingId, transferredFrom: origin })
      await edits.delete(key)
      moved.push({
        kind: 'edit',
        itemId: receivingId,
        key: targetKey,
        iterationId: null,
        userId,
        baseVersion: row.baseVersion,
        transferredFrom: origin,
      })
    }
    return moved
  }

  /**
   * Drafts a collision moved to one item from the item it closed (§2.3, W-98).
   * Iteration drafts are listed for every reader of the item; edit drafts only
   * for the caller's own seat, because another user's edits are not theirs to
   * read. Each entry carries the version the draft was written on.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the transferred draft references, empty when none moved here.
   */
  async transferredDrafts(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardTransferredDraft[]> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    const now = new Date()
    const drafts = await this.iterationDrafts()
    const listed: BoardTransferredDraft[] = []
    for (const [key, row] of [...drafts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (row.itemId !== id || row.transferredFrom === null || !draftIsRetained(row, now)) continue
      listed.push({
        kind: 'iteration',
        itemId: id,
        key,
        iterationId: row.iterationId,
        userId: null,
        baseVersion: row.baseVersion,
        transferredFrom: brandString<FaberLoomBoardItemId>(row.transferredFrom),
      })
    }
    const own = (await this.drafts()).get(this.draftId(id, actor.id))
    if (own !== undefined && own.transferredFrom !== null) {
      listed.push({
        kind: 'edit',
        itemId: id,
        key: this.draftId(id, actor.id),
        iterationId: null,
        userId: own.userId,
        baseVersion: own.baseVersion,
        transferredFrom: brandString<FaberLoomBoardItemId>(own.transferredFrom),
      })
    }
    return listed
  }

  /** The candidate one item transfers when it cannot replace another (§2.2). */
  private candidateOf(record: BoardItemRecord): BoardCandidate {
    const revision = record.revisions[record.revisions.length - 1]
    return {
      id: randomUUID(),
      hash: record.artifactHash ?? hashOf({ title: record.title }),
      summary: revision?.summary ?? record.title,
      evidence: revision !== undefined ? [...revision.evidence] : [],
      at: new Date().toISOString(),
    }
  }

  /**
   * Refuse an assignment when the destination Space names the accounts it
   * serves and the item belongs to another one (W-59).
   * @param record - the item being assigned.
   * @param space - the resolved destination Space.
   */
  private requireCompatibleAccount(record: BoardItemRecord, space: BoardSpace): void {
    const clients = (space.sources ?? []).filter(source => source.kind === 'mwt-client').map(source => source.id)
    if (clients.length === 0) return
    if (record.accountRef !== null && clients.includes(record.accountRef)) return
    throw new Error('faberloom: ACCOUNT_MISMATCH — the item account is not served by the destination space')
  }

  /**
   * Read the caller's inline-edit draft for one item.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @returns the draft, or undefined.
   */
  async getEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardEditDraft | undefined> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    const draft = (await this.drafts()).get(this.draftId(id, actor.id))
    return draft === undefined ? undefined : { ...draft }
  }

  /**
   * Save one draft write, conditional on its revision and writer tab.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @param input - base version, revision, tab, and changes.
   * @returns the stored draft.
   */
  async saveEditDraft(
    actor: BoardActor,
    id: FaberLoomBoardItemId,
    input: { baseVersion: number; revision: number; writerSession: string; changes: Record<string, string> },
  ): Promise<BoardEditDraft> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    if (input.baseVersion !== record.version) {
      throw new Error('faberloom: STALE_REVISION — the draft was made against an older version')
    }
    const table = await this.drafts()
    const key = this.draftId(id, actor.id)
    const existing = table.get(key)
    if (existing !== undefined && existing.writerSession !== input.writerSession) {
      throw new Error('faberloom: WRITER_TAKEN — another tab holds the editor')
    }
    if (existing !== undefined && existing.revision !== input.revision) {
      throw new Error('faberloom: STALE_DRAFT — the draft revision is not current')
    }
    const next: BoardDraftRecord = {
      itemId: id,
      transferredFrom: existing?.transferredFrom ?? null,
      userId: actor.id,
      baseVersion: input.baseVersion,
      revision: (existing?.revision ?? 0) + 1,
      writerSession: input.writerSession,
      changes: { ...input.changes },
      updatedAt: new Date().toISOString(),
    }
    await table.put(key, next)
    return { ...next }
  }

  /**
   * Take the writer seat for one item. A second tab becomes read-only until
   * this call succeeds.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @param writerSession - the requesting tab.
   * @returns the draft with this tab as writer.
   */
  async takeEditDraft(actor: BoardActor, id: FaberLoomBoardItemId, writerSession: string): Promise<BoardEditDraft> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    const table = await this.drafts()
    const key = this.draftId(id, actor.id)
    const existing = table.get(key)
    const next: BoardDraftRecord = {
      itemId: id,
      transferredFrom: existing?.transferredFrom ?? null,
      userId: actor.id,
      baseVersion: existing?.baseVersion ?? record.version,
      revision: (existing?.revision ?? 0) + 1,
      writerSession,
      changes: existing?.changes ?? {},
      updatedAt: new Date().toISOString(),
    }
    await table.put(key, next)
    return { ...next }
  }

  /**
   * Drop the caller's draft.
   * @param actor - the authenticated editor.
   * @param id - item id.
   */
  async discardEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<void> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    await (await this.drafts()).delete(this.draftId(id, actor.id))
  }

  private async clearEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<void> {
    await (await this.drafts()).delete(this.draftId(id, actor.id))
  }

  // ── Iteration (E14) ─────────────────────────────────────────────────

  /**
   * The validated iteration policy this deployment runs with (D-09, D-10). The
   * panel reads the renewal cadence and the round limit from here instead of
   * carrying its own copy.
   * @returns a copy of the resolved policy.
   */
  iterationPolicy(): IterationPolicy {
    return { ...this.iterationConfig }
  }

  /**
   * Iteration status of one item: attempt phase, lock, rounds, and the retained
   * draft. An expired attempt already reports as paused, which is how the panel
   * offers the draft for recovery (W-44).
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the attempt projection.
   */
  async iterationStatus(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardIterationStatus> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return await this.statusOf(id, record)
  }

  /**
   * Start an iteration attempt over the current artifact version (§9.7.1). The
   * attempt needs a space (W-31), mints a new `iterationId`, bumps the lock
   * generation, records the base version and the deadline, and leaves the
   * artifact version untouched (W-11).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - artifact version the caller saw and the tab session.
   * @returns the item and the new attempt.
   */
  async iterate(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardIterateInput): Promise<BoardIterationResult> {
    const now = new Date()
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requirePending(stateOf(current))
    requireBaseVersion(current, input.baseVersion)
    this.requireIterationSpace(current)
    const iterationId = randomUUID()
    const previousDraftKey = current.iterationDraftKey
    const item = await this.mutate(writer, id, 'iteration.started', (record) => {
      requirePending(stateOf(record))
      requireBaseVersion(record, input.baseVersion)
      this.requireIterationSpace(record)
      return {
        ...record,
        ...attemptFields(record, this.iterationConfig, now, {
          iterationId,
          baseVersion: record.version,
          session: input.actorSession,
        }),
        iterationDraftKey: null,
      }
    }, {
      data: (previous, next) => ({
        iterationId: next.iterationId,
        generation: next.iterationLockGeneration,
        baseVersion: next.iterationBaseVersion,
        session: input.actorSession,
        lockUntil: next.iterationLockUntil,
        previousIterationId: previous.iterationId,
      }),
    })
    await this.archiveIterationDraft(previousDraftKey)
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /**
   * Save the caller's edits as a new version and start the iteration over it.
   * The edits, the version, and the attempt commit in one transform, so a
   * conflict creates no version, applies no transition, and keeps the caller's
   * edits outside the item (W-69).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - expected row and base version, the changes, and the tab session.
   * @returns the item and the new attempt.
   */
  async iterateWithEdits(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardIterateWithEditsInput,
  ): Promise<BoardIterationResult> {
    const now = new Date()
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requirePending(stateOf(current))
    requireBaseVersion(current, input.baseVersion)
    this.requireIterationSpace(current)
    const iterationId = randomUUID()
    const previousDraftKey = current.iterationDraftKey
    const item = await this.mutate(writer, id, 'iterate_with_edits', (record) => {
      requirePending(stateOf(record))
      requireBaseVersion(record, input.baseVersion)
      this.requireIterationSpace(record)
      const edit = this.editRevision(record, input.changes)
      return {
        ...record,
        ...attemptFields(record, this.iterationConfig, now, {
          iterationId,
          baseVersion: edit.version,
          session: input.actorSession,
        }),
        version: edit.version,
        artifactHash: edit.artifactHash,
        fieldOrigins: edit.fieldOrigins,
        stale: false,
        staleReason: null,
        revisions: [...record.revisions, edit.revision],
        iterationDraftKey: null,
      }
    }, {
      expectedRowVersion: input.expectedRowVersion,
      data: (previous, next) => ({
        iterationId: next.iterationId,
        generation: next.iterationLockGeneration,
        baseVersion: next.iterationBaseVersion,
        version: next.version,
        previousVersion: previous.version,
        session: input.actorSession,
      }),
    })
    await this.archiveIterationDraft(previousDraftKey)
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /**
   * Store one write of the attempt's work as its working draft. A write that no
   * longer matches the live attempt stores the draft of that dead attempt and
   * leaves the item untouched, which is how a late agent answer is kept without
   * reaching the item (W-57). A write from another tab session is refused with
   * `LOCK_HELD` before anything is stored.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - attempt, session, base version, and the fields the caller wrote.
   * @returns the stored draft and whether the item links it.
   */
  async saveIterationDraft(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardIterationDraftInput,
  ): Promise<BoardIterationDraftOutcome> {
    const now = new Date()
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    const drafts = await this.iterationDrafts()
    const key = iterationDraftKeyOf(id, input.iterationId)
    const rejection = attemptRejection(current, input, now)
    const row = (archived: boolean) => draftRecordFor(drafts.get(key), {
      itemId: id,
      iterationId: input.iterationId,
      baseVersion: input.baseVersion,
      summary: input.summary,
      evidence: input.evidence,
      content: input.content,
    }, now, this.iterationConfig, archived)
    if (rejection === 'LOCK_HELD') {
      // Another tab session has no effect: it neither stores a draft nor writes
      // the item, so only the holder's attempt progresses.
      requireAttemptHolder(current, input)
    } else if (rejection !== null) {
      // A dead attempt that the item still links (paused or expired) keeps its
      // draft offered; one the item no longer owns is archived (W-57).
      const stored = row(current.iterationDraftKey !== key)
      await drafts.put(key, stored)
      return { draft: draftOf(key, stored, now), linked: false, code: rejection }
    }
    requireAttemptBase(current, input.baseVersion)
    const stored = row(false)
    await drafts.put(key, stored)
    await this.mutate(writer, id, 'iteration.draft', (record) => {
      requireLiveAttempt(record, input, now)
      requireAttemptBase(record, input.baseVersion)
      return { ...record, iterationDraftKey: key }
    }, { data: { iterationId: input.iterationId, generation: input.generation, draftKey: key } })
    return { draft: draftOf(key, stored, now), linked: true, code: null }
  }

  /**
   * Read one attempt's draft, or the draft the item offers.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @param iterationId - attempt to read; omitted reads the draft the item offers.
   * @returns the draft, or undefined when none is stored or retained.
   */
  async getIterationDraft(
    actor: BoardActor,
    id: FaberLoomBoardItemId,
    iterationId?: string,
  ): Promise<BoardIterationDraft | undefined> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    const now = new Date()
    const drafts = await this.iterationDrafts()
    if (iterationId !== undefined) {
      const key = iterationDraftKeyOf(id, iterationId)
      const storedRow = drafts.get(key)
      return storedRow === undefined || !draftIsRetained(storedRow, now) ? undefined : draftOf(key, storedRow, now)
    }
    return (await this.offeredDraft(id, record, now)) ?? undefined
  }

  /**
   * Extend the lock of the live attempt. A stale attempt id, a stale generation,
   * an expired deadline, or another tab session is refused without effects
   * (W-43).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - attempt id, generation, and tab session.
   * @returns the item and the renewed attempt.
   */
  async renewIteration(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardIterationLockInput,
  ): Promise<BoardIterationResult> {
    const now = new Date()
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requireLiveAttempt(current, input, now)
    const until = lockDeadline(this.iterationConfig, now)
    const item = await this.mutate(writer, id, 'iteration.renewed', (record) => {
      requireLiveAttempt(record, input, now)
      return { ...record, iterationLockUntil: until }
    }, {
      data: { iterationId: input.iterationId, generation: input.generation, lockUntil: until },
    })
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /**
   * Save and exit, carry to SpaceLoom, return without resolving, or record the
   * expiry: the attempt releases its lock and the item returns to the pending
   * column with its draft and any pending candidate untouched (W-67, W-97).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - attempt, generation, session, and the exit the user chose.
   * @returns the item and the released attempt.
   */
  async pauseIteration(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardPauseIterationInput,
  ): Promise<BoardIterationResult> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requirePausableAttempt(current, input)
    const item = await this.mutate(writer, id, 'iteration.paused', (record) => {
      requirePausableAttempt(record, input)
      return { ...record, ...releasedFields() }
    }, {
      reason: input.reason,
      data: (previous, next) => ({
        iterationId: previous.iterationId,
        generation: previous.iterationLockGeneration,
        draftKey: next.iterationDraftKey,
        lockUntil: previous.iterationLockUntil,
        candidatePending: next.pendingCandidate !== null,
      }),
    })
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /**
   * Discard the attempt's work and release the lock. It requires no pending
   * candidate, or the adopt/keep choice that resolves it in the same commit; it
   * deletes the draft and never changes the version except through adoption
   * (W-41).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - attempt, generation, session, and the optional candidate choice.
   * @returns the item and the released attempt.
   */
  async cancelIteration(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardCancelIterationInput,
  ): Promise<BoardIterationResult> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requirePausableAttempt(current, input)
    requireCandidateChoice(current, input.candidate)
    const draftKey = current.iterationDraftKey
    const item = await this.mutate(writer, id, 'iteration.cancelled', (record) => {
      requirePausableAttempt(record, input)
      requireCandidateChoice(record, input.candidate)
      const released: BoardItemRecord = { ...record, ...releasedFields(), iterationDraftKey: null }
      const candidate = record.pendingCandidate
      if (candidate !== null && input.candidate?.decision === 'adopt') {
        const version = record.version + 1
        return {
          ...released,
          version,
          artifactHash: candidate.hash,
          pendingCandidate: null,
          fieldOrigins: [],
          revisions: [...record.revisions, {
            version, summary: candidate.summary, evidence: [...candidate.evidence], content: null,
            documentRef: null, at: candidate.at,
          }],
        }
      }
      return { ...released, pendingCandidate: null }
    }, {
      data: (previous, next) => ({
        iterationId: previous.iterationId,
        generation: previous.iterationLockGeneration,
        draftKey: previous.iterationDraftKey,
        choice: input.candidate?.decision ?? null,
        candidateId: previous.pendingCandidate?.id ?? null,
        candidateHash: previous.pendingCandidate?.hash ?? null,
        version: next.version,
      }),
    })
    await this.deleteIterationDraft(draftKey)
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /**
   * Take a new attempt over the draft the item offers: the linked one, or the
   * retained draft of a dead attempt the item never linked, which is otherwise
   * text no command reaches (W-57). When the draft was written against an older
   * version, it is marked outdated and the differences are returned instead of
   * overwriting the newer content (W-68). Starting an attempt never writes the
   * artifact version, so the draft reaches the item only through `applyIteration`.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - base version of the draft the caller saw and the tab session.
   * @returns the item with `started`, or with `outdated` and the differences.
   */
  async resumeIteration(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardResumeIterationInput,
  ): Promise<BoardResumeIterationResult> {
    const now = new Date()
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    requirePending(stateOf(record))
    const offered = await this.offeredRow(id, record, now)
    if (offered === null) throw new Error('faberloom: NO_DRAFT — the item has no retained iteration draft')
    const draftKey = offered.key
    const drafts = await this.iterationDrafts()
    const draft = draftOf(draftKey, offered.row, now)
    if (draft.baseVersion !== input.baseVersion) {
      throw new Error('faberloom: STALE_REVISION — the draft was not written against the version the caller saw')
    }
    if (draft.baseVersion !== record.version) {
      await drafts.put(draftKey, { ...offered.row, outdated: true, updatedAt: now.toISOString() })
      return {
        item: toItem(id, record),
        status: 'outdated',
        differences: draftDifferences(draft, this.contentOf(record)),
      }
    }
    const iterationId = randomUUID()
    const nextKey = iterationDraftKeyOf(id, iterationId)
    await drafts.put(nextKey, {
      ...offered.row,
      iterationId,
      outdated: false,
      archived: false,
      superseded: false,
      updatedAt: now.toISOString(),
      retainUntil: retainUntil(this.iterationConfig, now),
    })
    const linkedKey = record.iterationDraftKey
    const item = await this.mutate(writer, id, 'iteration.resumed', (current) => {
      requirePending(stateOf(current))
      requireBaseVersion(current, input.baseVersion)
      if (current.iterationDraftKey !== linkedKey) {
        throw new Error('faberloom: ITERATION_STALE — the retained draft is not the one the caller resumed')
      }
      return {
        ...current,
        ...attemptFields(current, this.iterationConfig, now, {
          iterationId,
          baseVersion: current.version,
          session: input.actorSession,
        }),
        iterationDraftKey: nextKey,
      }
    }, {
      data: (previous, next) => ({
        iterationId: next.iterationId,
        generation: next.iterationLockGeneration,
        baseVersion: next.iterationBaseVersion,
        previousIterationId: previous.iterationId,
      }),
    })
    await this.deleteIterationDraft(draftKey)
    return { item, status: 'started' }
  }

  /**
   * Take a new attempt over one draft a collision moved to this item (§2.3,
   * W-98). The key must be a draft `transferredDrafts` listed here and inside its
   * retention window, because a key of another item, or one already past D-09, is
   * not work this item may turn into an attempt. When the draft's base version is
   * still current the item links it under the new attempt's key and the attempt
   * starts; otherwise the draft is marked outdated, the differing fields come
   * back, and the item is not written (W-68). Neither outcome writes the artifact
   * version, so the work reaches the item only through `applyIteration`.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - the transferred draft key and the tab opening the attempt.
   * @returns the item with `started`, or with `outdated` and the differences.
   */
  async recoverTransferredDraft(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardRecoverDraftInput,
  ): Promise<BoardRecoverDraftResult> {
    const now = new Date()
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    requirePending(stateOf(record))
    const drafts = await this.iterationDrafts()
    const stored = drafts.get(input.draftKey)
    if (stored === undefined || stored.itemId !== id || stored.transferredFrom === null) {
      throw new Error('faberloom: NO_DRAFT — the draft is not transferred to this item')
    }
    if (!draftIsRetained(stored, now)) {
      throw new Error('faberloom: DRAFT_EXPIRED — the transferred draft is past its retention window')
    }
    const draft = draftOf(input.draftKey, stored, now)
    if (draft.baseVersion !== record.version) {
      await drafts.put(input.draftKey, { ...stored, outdated: true, updatedAt: now.toISOString() })
      return {
        item: toItem(id, record),
        status: 'outdated',
        differences: draftDifferences(draft, this.contentOf(record)),
      }
    }
    const iterationId = randomUUID()
    const nextKey = iterationDraftKeyOf(id, iterationId)
    // The recovered row stops being transferred work: it is the live attempt's
    // draft from here on, and the audit event keeps the item it came from.
    await drafts.put(nextKey, {
      ...stored,
      transferredFrom: null,
      iterationId,
      outdated: false,
      archived: false,
      superseded: false,
      updatedAt: now.toISOString(),
      retainUntil: retainUntil(this.iterationConfig, now),
    })
    const linkedKey = record.iterationDraftKey
    const item = await this.mutate(writer, id, 'iteration.recovered', (current) => {
      requirePending(stateOf(current))
      requireBaseVersion(current, draft.baseVersion)
      if (current.iterationDraftKey !== linkedKey) {
        throw new Error('faberloom: ITERATION_STALE — the item draft changed while the transferred one was recovered')
      }
      return {
        ...current,
        ...attemptFields(current, this.iterationConfig, now, {
          iterationId,
          baseVersion: current.version,
          session: input.actorSession,
        }),
        iterationDraftKey: nextKey,
      }
    }, {
      data: (previous, next) => ({
        iterationId: next.iterationId,
        generation: next.iterationLockGeneration,
        baseVersion: next.iterationBaseVersion,
        session: input.actorSession,
        transferredFrom: stored.transferredFrom,
        transferredKey: input.draftKey,
        previousIterationId: previous.iterationId,
      }),
    })
    await this.deleteIterationDraft(input.draftKey)
    return { item, status: 'started' }
  }

  /**
   * Apply the live attempt: write a new version and hash, count the round,
   * record the learning scope, release the lock, and return to
   * `PENDIENTE_CRITERIO`. A pending candidate must be resolved in the same call,
   * and only the current attempt applies (W-40, W-57).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - attempt, generation, session, base version, optional summary and
   * evidence, the scope, and the choice.
   * @returns the item and the released attempt.
   */
  async applyIteration(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardApplyIterationInput,
  ): Promise<BoardIterationResult> {
    const now = new Date()
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    requireLiveAttempt(current, input, now)
    requireAttemptBase(current, input.baseVersion)
    requireCandidateChoice(current, input.candidate)
    const draftKey = current.iterationDraftKey
    const drafts = await this.iterationDrafts()
    const stored = draftKey === null ? undefined : drafts.get(draftKey)
    const draft = draftKey !== null && stored !== undefined && draftIsRetained(stored, now)
      ? draftOf(draftKey, stored, now)
      : null
    const item = await this.mutate(writer, id, 'iteration.applied', (record) => {
      requireLiveAttempt(record, input, now)
      requireAttemptBase(record, input.baseVersion)
      requireCandidateChoice(record, input.candidate)
      if (record.iterationDraftKey !== draftKey) {
        throw new Error('faberloom: ITERATION_STALE — the attempt draft changed since it was read')
      }
      const released: BoardItemRecord = {
        ...record,
        ...releasedFields(),
        iterationDraftKey: null,
        iterationRoundCount: record.iterationRoundCount + 1,
      }
      const candidate = record.pendingCandidate
      if (candidate !== null && input.candidate?.decision === 'adopt') {
        const adoptedVersion = record.version + 1
        return {
          ...released,
          version: adoptedVersion,
          artifactHash: candidate.hash,
          pendingCandidate: null,
          fieldOrigins: [],
          revisions: [...record.revisions, {
            version: adoptedVersion, summary: candidate.summary, evidence: [...candidate.evidence], content: null,
            documentRef: null, at: candidate.at,
          }],
        }
      }
      const previous = record.revisions[record.revisions.length - 1]
      const currentContent = this.contentOf(record)
      const content = draft === null || draft.content === null ? currentContent : { ...draft.content }
      const summary = input.summary ?? draft?.summary ?? previous?.summary ?? ''
      const evidence = this.iterationEvidence(record, draft, input.evidence)
      const changed = Object.keys(content).filter(key => JSON.stringify(content[key]) !== JSON.stringify(currentContent[key]))
      const version = record.version + 1
      return {
        ...released,
        version,
        artifactHash: hashOf({ summary, evidence, content }),
        pendingCandidate: null,
        fieldOrigins: mergeOrigins(record.fieldOrigins, changed),
        revisions: [...record.revisions, {
          version, summary, evidence, content, documentRef: previous?.documentRef ?? null, at: now.toISOString(),
        }],
      }
    }, {
      data: (previous, next) => ({
        iterationId: previous.iterationId,
        generation: previous.iterationLockGeneration,
        baseVersion: input.baseVersion,
        scope: input.scope,
        choice: input.candidate?.decision ?? null,
        candidateId: previous.pendingCandidate?.id ?? null,
        candidateHash: previous.pendingCandidate?.hash ?? null,
        rounds: next.iterationRoundCount,
        version: next.version,
      }),
    })
    await this.deleteIterationDraft(draftKey)
    return { item, status: await this.statusOf(id, await this.requireItem(id)) }
  }

  /** Refuse to open the chat of an item with no space: the space is assigned first (W-31). */
  private requireIterationSpace(record: BoardItemRecord): void {
    if (record.spaceId === null) {
      throw new Error('faberloom: NO_SPACE — assign the item to a space before iterating')
    }
  }

  /**
   * The evidence one applied version carries: what the caller supplied, else the
   * draft's, else the current revision's, which a version cannot go without.
   */
  private iterationEvidence(
    record: BoardItemRecord,
    draft: BoardIterationDraft | null,
    submitted?: readonly string[],
  ): string[] {
    if (submitted !== undefined) return requireEvidence(submitted)
    if (draft !== null && draft.evidence.length > 0) return [...draft.evidence]
    return requireEvidence(record.revisions[record.revisions.length - 1]?.evidence)
  }

  /** The attempt status of one stored record. */
  private async statusOf(id: FaberLoomBoardItemId, record: BoardItemRecord): Promise<BoardIterationStatus> {
    const now = new Date()
    const offered = await this.offeredRow(id, record, now)
    return iterationStatusOf(
      record,
      offered === null ? null : draftOf(offered.key, offered.row, now),
      this.iterationConfig,
      now,
    )
  }

  /** The draft the item offers, projected for consumers, or null. */
  private async offeredDraft(
    id: FaberLoomBoardItemId,
    record: BoardItemRecord,
    now: Date,
  ): Promise<BoardIterationDraft | null> {
    const offered = await this.offeredRow(id, record, now)
    return offered === null ? null : draftOf(offered.key, offered.row, now)
  }

  /**
   * The stored row of the draft the item offers: the linked one while it is
   * retained, else the most recently written retained draft of the item that no
   * newer attempt replaced and no collision transferred. A draft the item never
   * linked stays reachable this way, so a late answer for a dead attempt is not
   * stranded (W-57); one past its retention window is not offered (D-09).
   * @param id - item id.
   * @param record - the stored item.
   * @param now - the server clock.
   * @returns the draft key and row, or null when the item offers none.
   */
  private async offeredRow(
    id: FaberLoomBoardItemId,
    record: BoardItemRecord,
    now: Date,
  ): Promise<{ readonly key: string; readonly row: BoardIterationDraftRecord } | null> {
    const drafts = await this.iterationDrafts()
    const linkedKey = record.iterationDraftKey
    if (linkedKey !== null) {
      const linked = drafts.get(linkedKey)
      if (linked !== undefined && linked.itemId === id && draftIsRetained(linked, now)) {
        return { key: linkedKey, row: linked }
      }
    }
    let offered: { readonly key: string; readonly row: BoardIterationDraftRecord } | null = null
    for (const [key, row] of drafts.entries()) {
      if (row.itemId !== id || row.superseded || row.transferredFrom !== null) continue
      if (!draftIsRetained(row, now)) continue
      if (offered !== null && Date.parse(row.updatedAt) < Date.parse(offered.row.updatedAt)) continue
      if (offered !== null && Date.parse(row.updatedAt) === Date.parse(offered.row.updatedAt)
        && key.localeCompare(offered.key) >= 0) continue
      offered = { key, row }
    }
    return offered
  }

  private async deleteIterationDraft(key: string | null): Promise<void> {
    if (key === null) return
    await (await this.iterationDrafts()).delete(key)
  }

  /**
   * Mark the draft of an attempt the item no longer owns, so a fresh attempt does
   * not resurface work written against another version (W-57). `superseded` is
   * what keeps it out of the drafts the item offers; it stays stored for its own
   * attempt id.
   * @param key - draft key the item used to link, or null.
   */
  private async archiveIterationDraft(key: string | null): Promise<void> {
    if (key === null) return
    const drafts = await this.iterationDrafts()
    const stored = drafts.get(key)
    if (stored === undefined || stored.superseded) return
    await drafts.put(key, {
      ...stored, archived: true, superseded: true, updatedAt: new Date().toISOString(),
    })
  }

  /**
   * Read the audit history of one item.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the events, oldest first.
   */
  async events(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardEvent[]> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return record.events.map(event => ({
      ...event,
      fromState: event.fromState as BoardState | null,
      toState: event.toState as BoardState,
    }))
  }

  /**
   * Submit a correction as the next revision, awaiting a fresh review. The
   * revision carries the content the caller supplies, so the controls of the
   * next approval evaluate the corrected artifact.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - summary, evidence, optional document reference, content, and origins.
   * @returns the updated item.
   */
  async submitRevision(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardSubmitInput): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'submit_revision', (current) => {
      // W-76: an unconfirmed effect keeps its item traceable; reconciling it,
      // not correcting the artifact, is what resolves DESCONOCIDO.
      if (stateOf(current) === 'DESCONOCIDO') {
        throw new Error('faberloom: NO_ACCESS — the item result is unknown and cannot be corrected')
      }
      const version = current.version + 1
      const evidence = requireEvidence(input.evidence)
      const content = input.content === undefined ? this.contentOf(current) : { ...input.content }
      const fieldOrigins = input.fieldOrigins === undefined
        ? mergeOrigins(current.fieldOrigins, input.content === undefined ? [] : Object.keys(input.content))
        : [...input.fieldOrigins]
      return {
        ...current,
        state: 'PENDIENTE_CRITERIO',
        status: 'waiting_approval',
        version,
        artifactHash: hashOf({ summary: input.summary, evidence, content }),
        fieldOrigins,
        stale: false,
        staleReason: null,
        revisions: [...current.revisions, {
          version, summary: input.summary, evidence, content, documentRef: input.documentRef ?? null,
          at: new Date().toISOString(),
        }],
      }
    })
  }

  /**
   * Record that the item waits for data.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async requestData(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'request_data', current => ({
      ...current, state: 'PENDIENTE_CRITERIO', status: 'waiting_data',
    }))
  }

  /**
   * Mark the item failed. `DESCONOCIDO` records an effect that may or may not
   * have happened: the item stays recoverable and verifiable, and it is never
   * `EJECUTADO` without confirmation (W-22).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param outcome - `FALLIDO` when the destination refused the effect, `DESCONOCIDO` when it did not answer.
   * @returns the updated item.
   */
  async fail(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    outcome: 'FALLIDO' | 'DESCONOCIDO' = 'FALLIDO',
  ): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'fail', current => ({
      ...current,
      state: outcome === 'DESCONOCIDO' ? 'DESCONOCIDO' : 'ERROR_RECUPERABLE',
      status: 'failed',
    }), { data: { outcome } })
  }

  /**
   * Reopen the item for another attempt.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async reopen(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'reopen', current => ({
      ...current, state: 'PENDIENTE_CRITERIO', status: 'reopened',
    }))
  }

  /**
   * Complete an approved item.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async complete(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'complete', (current) => {
      if (stateOf(current) !== 'APROBADO') throw new Error('faberloom: NO_ACCESS — item is not approved')
      return { ...current, state: 'EJECUTADO', status: 'completed' }
    })
  }

  /**
   * Permanently remove one item from the work table, regardless of state.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns whether the item existed and was removed.
   */
  async remove(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<boolean> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    await this.release(record.companyId, 'bkey', record.businessKey)
    await this.release(record.companyId, 'idem', record.idempotencyKey)
    return await (await this.items()).delete(id)
  }

  /**
   * Link the item to the routine that will run it, or unlink it with `null`.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param routineId - routine id to attach, or null to detach.
   * @returns the updated item.
   */
  async setRoutine(writer: BoardWriter, id: FaberLoomBoardItemId, routineId: string | null): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'set_routine', current => ({ ...current, routineId }))
  }

  /**
   * Approve or reject the exact revision. A reject returns the item to the
   * pending column; an approve follows the WorkLoom preconditions and binds to
   * the hash the caller names, never to whatever is current (W-09).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - decision, exact revision, artifact hash, and optional note.
   * @returns the updated item.
   */
  async review(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    if (input.decision === 'approve') {
      if (input.hash === undefined || input.hash.trim().length === 0) {
        throw new Error('faberloom: STALE_REVISION — an approval must name the artifact hash it reviewed')
      }
      return await this.approve(writer, id, {
        expectedRowVersion: record.rowVersion,
        expectedArtifactVersion: input.version,
        expectedArtifactHash: input.hash,
      })
    }
    return await this.mutate(writer, id, 'reject', (current) => {
      if (input.version !== current.version) throw new Error('faberloom: STALE_REVISION — the reviewed revision is not current')
      return { ...current, state: 'PENDIENTE_CRITERIO', status: 'reopened' }
    })
  }

  /**
   * Invalidate a current approval: the item must be revalidated before approval
   * or effects.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param reason - why the item went stale.
   * @returns the updated item.
   */
  async markStale(writer: BoardWriter, id: FaberLoomBoardItemId, reason: string): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'mark_stale', current => ({
      ...current,
      stale: true,
      staleReason: reason,
      approvedRevision: null,
      state: 'PENDIENTE_CRITERIO',
      status: 'needs_review',
    }), { reason })
  }

  /**
   * Clear staleness after checking the changed condition.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param changed - whether the underlying condition actually changed.
   * @returns the updated item.
   */
  async revalidate(writer: BoardWriter, id: FaberLoomBoardItemId, changed: boolean): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'revalidate', current => ({
      ...current,
      stale: false,
      staleReason: null,
      state: changed ? 'PENDIENTE_CRITERIO' : stateOf(current),
      status: changed ? 'needs_review' : current.status,
    }))
  }

  /**
   * Record an effect. Approval never sends: an explicit authorization is
   * required, and a stale or unapproved item refuses.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - external reference, authorization, and optional detail.
   * @returns the updated item.
   */
  async recordEffect(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEffectInput): Promise<FaberLoomBoardItem> {
    if (input.authorization === undefined || input.authorization.trim().length === 0) {
      throw new Error('faberloom: NO_AUTHORIZATION — recording an effect requires an explicit authorization')
    }
    return await this.mutate(writer, id, 'effect', (current) => {
      if (current.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
      if (stateOf(current) !== 'APROBADO') throw new Error('faberloom: NO_ACCESS — item is not approved')
      return {
        ...current,
        effects: [...current.effects, {
          ref: input.ref, detail: input.detail ?? null, authorization: input.authorization ?? null,
          at: new Date().toISOString(),
        }],
      }
    })
  }

  /** Normalize a writer identity: a bare id is a legacy single-tenant actor. */
  private actorOf(writer: BoardActor | string): BoardActor {
    return typeof writer === 'string' ? { id: writer } : writer
  }

  /**
   * Refuse a read when the item belongs to another owner or to another company.
   * @param record - the stored item.
   * @param actor - the authenticated reader.
   */
  private authorizeRead(record: BoardItemRecord, actor: BoardActor): void {
    if (record.ownerId !== actor.id) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another owner')
    }
    if (record.companyId !== null && record.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
  }

  /**
   * Refuse a write with the same owner+company rule as a read. A bare string
   * writer carries no company, so it cannot mutate a company-scoped item.
   * @param record - the stored item.
   * @param writer - the authenticated writer.
   */
  private authorizeWrite(record: BoardItemRecord, writer: BoardWriter): void {
    const actor = this.actorOf(writer)
    if (record.ownerId !== actor.id) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another owner')
    }
    if (record.companyId !== null && record.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
  }

  /**
   * Read one item the actor is allowed to see.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the item.
   */
  async get(actor: BoardActor, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return toItem(id, record)
  }

  /**
   * List the actor's items. There is no unfiltered listing: every read is
   * scoped to one identity and, when the deployment knows it, one company.
   * @param actor - the authenticated reader.
   * @param filter - optional state, status, and space filters.
   * @returns items in the canonical queue order (§4): unclassified and
   * space-less first, then the severity, due date, value, creation, and id tuple.
   */
  async list(
    actor: BoardActor,
    filter: { status?: BoardStatus; state?: BoardState; spaceId?: string } = {},
  ): Promise<FaberLoomBoardItem[]> {
    const out: FaberLoomBoardItem[] = []
    for (const [id, record] of (await this.items()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (record.companyId !== null && record.companyId !== actor.companyId) continue
      if (filter.status !== undefined && record.status !== filter.status) continue
      if (filter.state !== undefined && stateOf(record) !== filter.state) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      out.push(toItem(id, record))
    }
    return orderBoardItems(out)
  }
}

export default FaberLoomBoard
