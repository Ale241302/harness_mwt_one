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
  type BoardViewRecord,
  type ShadowEvaluationRecord,
  type EffectAlertRecord,
  type EffectEventRecord,
  type EffectOutboxRecord,
  type EffectReservationRecord,
  type IterationChatRecord,
} from './spec.ts'
import { routeFieldInstruction, type BoardFieldChange } from './router.ts'
import { businessKeyOf, sourceRefOf } from './keys.ts'
import { submittedSeverity, classifyDataClass, resolveSeverity, DATA_CLASS_POLICY_VERSION, CLASSIFY_RULES_VERSION } from './classify.ts'
import { orderBoardItems } from './order.ts'
import { CHECKS_VERSION, artifactOf, checkClass, checkKey, declaredChecks } from './checks.ts'
import { fieldOriginsOf, mergeOrigins, revisionContent } from './projection.ts'
import {
  alertKeyOf,
  effectCommandFor,
  effectEventKeyOf,
  effectKeyOf,
  legacyStatusOf,
  messageIsDispatchable,
  messageStatusFor,
  normaliseDestination,
  outboxKeyOf,
  reservationIsLive,
  reservationIsSettled,
  reservationKeyOf,
  reservationLeaseExpired,
  retainUntilOf,
  reversalDeadlineOf,
  reversalWindowMs,
  stateForOutcome,
  type EffectIdentity,
  type EffectPolicy,
} from './effects.ts'
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
  BoardAdminCloseInput,
  BoardAdminCloseResult,
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
  BoardClassifierPort,
  BoardClassifierResult,
  BoardClassificationCacheEntry,
  BoardColumn,
  BoardCreateInput,
  BoardDataClass,
  BoardDiscardInput,
  BoardDispatchCode,
  BoardDispatchOutcome,
  BoardEditDraft,
  BoardEditValue,
  BoardEditsInput,
  BoardFxPort,
  BoardEffectAdapter,
  BoardEffectAdapterStatus,
  BoardEffectAlert,
  BoardEffectAlertKind,
  BoardEffectDispatch,
  BoardEffectEvent,
  BoardEffectExecution,
  BoardEffectInput,
  BoardEffectOutcome,
  BoardEffectReservation,
  BoardEffectResult,
  BoardEffectRevalidation,
  BoardEffectStatus,
  BoardEvent,
  BoardExecutionInput,
  BoardFieldOriginEntry,
  BoardInstructionOutcome,
  BoardIterateInput,
  BoardIterateWithEditsInput,
  BoardIterationDraft,
  BoardIterationContext,
  BoardIterationChat,
  BoardIterationDraftInput,
  BoardIterationDraftOutcome,
  BoardIterationLockInput,
  BoardIterationResult,
  BoardIterationStatus,
  BoardOrphanRecovery,
  BoardOutboxMessage,
  BoardOutboxStatus,
  BoardPauseIterationInput,
  BoardReconcileInput,
  BoardRecoverDraftInput,
  BoardRecoverDraftResult,
  BoardResumeIterationInput,
  BoardResumeIterationResult,
  BoardRetryInput,
  BoardRekeyEntry,
  BoardRekeyReport,
  BoardRevertInput,
  BoardSeverity,
  BoardBulkApproveInput,
  BoardBulkApproveResult,
  BoardBulkRejection,
  BoardShadowEvaluation,
  BoardShadowReport,
  BoardSeverityDecision,
  BoardState,
  BoardStatus,
  BoardSubmitInput,
  BoardSubmitRequest,
  BoardTransferredDraft,
  BoardView,
  BoardViewFilters,
  BoardWriter,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

export type * from './types.ts'
export * from './router.ts'
export * from './keys.ts'
export * from './checks.ts'
export * from './projection.ts'
export * from './classify.ts'
export * from './order.ts'
export * from './iteration.ts'
export * from './effects.ts'

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
  /**
   * Reversal window per action type, in milliseconds (D-12). The signed values
   * are 15 minutes for `mail.send` and none for money, inventory, and shipments;
   * a deployment maps `FABERLOOM_REVERSAL_WINDOW_MS` onto this field for mail.
   */
  readonly effectReversalWindowMs?: Record<string, number>
  /**
   * Action types an acceptance may name. D-12 signs the three defaults, so a
   * deployment extends the list instead of letting `Mail Send` and `mail.send`
   * become two effects; an unlisted type is refused with `EFFECT_ACTION_UNKNOWN`.
   */
  readonly effectActionTypes?: readonly string[]
  /** Days a settled effect record stays stored before `pruneEffects` may delete it. */
  readonly effectRetentionDays?: number
  /** Milliseconds one dispatch attempt may take before the outcome is `DESCONOCIDO`. */
  readonly effectDispatchTimeoutMs?: number
  /**
   * Milliseconds a `RESERVADA` row may sit unreachable before
   * `recoverOrphanedReservations` releases it. It must outlast the three writes
   * one acceptance makes, so a row younger than the lease is never swept.
   */
  readonly effectReservationLeaseMs?: number
  /**
   * Milliseconds between outbox sweeps. Zero keeps the consumer idle, which is
   * what a deployment with no effect adapter wants; the acceptance still records
   * its intention and an operator can dispatch it by hand.
   */
  readonly effectDispatchIntervalMs?: number
  /** Milliseconds a refused dispatch waits before the consumer retries it. */
  readonly effectDispatchBackoffMs?: number
  /** Milliseconds the classifier port may take before its answer is a timeout (W-37). */
  readonly classifierTimeoutMs?: number
  /**
   * Whether `approveBulk` is offered. D-11 keeps the batch outside the pilot;
   * a deployment enables it explicitly when volume justifies it.
   */
  readonly bulkApprovalEnabled?: boolean
}

/** Validated board configuration. */
export const Config = z.object({
  eventCap: z.number().int().positive().default(200),
  classifierConfidenceThreshold: z.number().min(0).max(1).default(0.8),
  iterationRenewalSeconds: z.number().int().positive().default(30),
  iterationLockSeconds: z.number().int().positive().default(900),
  iterationDraftRetentionDays: z.number().int().positive().default(30),
  iterationRoundLimit: z.number().int().positive().default(5),
  effectReversalWindowMs: z.record(z.string(), z.number().int().min(0)).default({ 'mail.send': 900_000 }),
  effectActionTypes: z.array(z.string().min(1)).default(['mail.send', 'inventory.reserve', 'shipment.create']),
  effectRetentionDays: z.number().int().positive().default(90),
  effectDispatchTimeoutMs: z.number().int().positive().default(30_000),
  effectReservationLeaseMs: z.number().int().positive().default(300_000),
  effectDispatchIntervalMs: z.number().int().min(0).default(0),
  effectDispatchBackoffMs: z.number().int().positive().default(60_000),
  classifierTimeoutMs: z.number().int().positive().default(3_000),
  /**
   * Whether `approveBulk` is offered. D-11 keeps the batch outside the pilot, so
   * the default is false; W-15's behavior is implemented and tested behind it.
   */
  bulkApprovalEnabled: z.boolean().default(false),
})

/** Discard reasons signed in the specification. */
export const DISCARD_REASONS = [
  'CLIENTE_CANCELO', 'DUPLICADO', 'ERROR_ORIGEN', 'NO_CORRESPONDE', 'RESUELTO_FUERA', 'OTRA',
] as const

const TERMINAL: readonly BoardState[] = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']
/** Identity the outbox consumer writes into the audit and the alerts. */
const EFFECT_CONSUMER = 'faberloom-effect-consumer'
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

/**
 * The `faberloomAccess` surface the board reads through `ctx.get` (T5.7). The
 * board declares the obligation W-16 puts on an acceptance and lets the access
 * service decide which action types are protected and whether a signature covers
 * one; a refusal propagates unchanged.
 */
interface BoardAccess {
  requireSignature(
    actor: { id: string; companyId?: string | undefined },
    actionType: string,
  ): Promise<unknown>
}

/** One registered check implementation and the source port it reads. */
interface RegisteredCheck {
  /** The implementation. */
  readonly fn: BoardCheckFn
  /** Source port the registration supplied, or undefined when it supplied none. */
  readonly source: BoardCheckSource | undefined
}

/**
 * The identity of one accepted effect, resolved from the item and the caller's
 * input: the five signed components, the key they hash to, and the execution
 * identity that owns the reservation.
 */
interface ResolvedEffect extends EffectIdentity {
  /** The signed effect key. */
  readonly effectKey: string
  /** Execution that owns the reservation. */
  readonly executionId: string
  /** Idempotency key the destination receives. */
  readonly idempotencyKey: string
  /** Explicit authorization recorded with the acceptance, or null. */
  readonly authorization: string | null
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

/** One durable reservation, as the panel reads it. */
function toReservation(record: EffectReservationRecord): BoardEffectReservation {
  return { ...record }
}

/** One durable outbox message, as the panel reads it. */
function toMessage(record: EffectOutboxRecord): BoardOutboxMessage {
  return { ...record }
}

/** One durable alert, as the panel reads it. */
function toAlert(record: EffectAlertRecord): BoardEffectAlert {
  return { ...record }
}

/** A consumer attempt that emitted nothing. */
function refusal(code: BoardDispatchCode, item: FaberLoomBoardItem | null, detail: string | null): BoardDispatchOutcome {
  return { dispatched: false, code, item, outcome: null, detail }
}

/** The stable code of one board refusal, or `UNKNOWN` for an unexpected error. */
function errorCodeOf(error: unknown): string {
  const match = /^faberloom: ([A-Z0-9_]+)/u.exec(error instanceof Error ? error.message : String(error))
  return match?.[1] ?? 'UNKNOWN'
}

/** The operator detail of one refusal. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compare one shadow answer with the human label. A confidence below the floor
 * is an abstention, not a disagreement; a failed answer is an error, not a match.
 * @param item - the item whose severity the human confirmed.
 * @param result - what the shadow evaluator answered.
 * @param modelVersion - the shadow model identity.
 * @param threshold - the board's confidence floor.
 * @returns the evaluation to store.
 */
function shadowEvaluationOf(
  item: FaberLoomBoardItem,
  result: BoardClassifierResult,
  modelVersion: string,
  threshold: number,
): BoardShadowEvaluation {
  const base = {
    itemId: item.id,
    humanSeverity: item.severity as BoardSeverity,
    shadowSeverity: null,
    modelVersion,
    at: new Date().toISOString(),
  }
  if (result.status === 'timeout') return { ...base, status: 'timeout' }
  if (result.status === 'invalid') return { ...base, status: 'invalid' }
  if (result.confidence < threshold) return { ...base, status: 'abstained' }
  return {
    ...base,
    shadowSeverity: result.severity,
    status: result.severity === item.severity ? 'matched' : 'mismatched',
  }
}

/** The fields one item declares: its summary, its artifact content, and its origins. */
function declaredItemFields(record: BoardItemRecord): readonly string[] {  const last = record.revisions[record.revisions.length - 1]
  return [...new Set([
    'summary',
    ...Object.keys(last?.content ?? {}),
    ...record.fieldOrigins.map(origin => origin.field),
  ])]
}

/** Map one durable record to the consumer-facing item. */

/** Storage key of one saved view, scoped to its owner. */
function viewKeyOf(ownerId: string, name: string): string {
  return `${ownerId}\u0000${name}`
}

/** Project one stored view into the surface the panel reads. */
function toView(record: BoardViewRecord): BoardView {
  return {
    name: record.name,
    filters: {
      spaceId: record.filters.spaceId,
      accountRef: record.filters.accountRef,
      assigneeId: record.filters.assigneeId,
      severity: record.filters.severity,
      due: record.filters.due === 'overdue' || record.filters.due === 'none' ? record.filters.due : 'all',
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
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
  private readonly effectConfig: EffectPolicy
  /** Milliseconds the classifier port may take before the answer counts as a timeout. */
  private readonly classifierTimeoutMs: number
  private readonly bulkApprovalEnabled: boolean
  /** Outbox sweep cadence; zero keeps the consumer idle. */
  private readonly dispatchIntervalMs: number
  /** How long a refused dispatch waits before the consumer retries it. */
  private readonly dispatchBackoffMs: number
  /** Action types this deployment accepts for an acceptance (D-12). */
  private readonly effectActionTypes: ReadonlySet<string>
  private readonly claims = new Map<string, Promise<unknown>>()
  /**
   * Registered check implementations, keyed by artifact type and check id. The
   * map is empty until an adapter mounts its controls, so a deployment without
   * adapters never runs a control it did not ask for; a declared control with
   * no entry refuses approval with `CHECK_UNAVAILABLE`.
   */
  private readonly checks = new Map<string, RegisteredCheck>()
  /**
   * Effect adapters, one per action type. The board owns no mail, inventory, or
   * shipment client: a deployment mounts the adapter from `ctx.effect`, and a
   * dispatch of an action type with no adapter is refused with
   * `EFFECT_NO_ADAPTER` instead of being silently dropped.
   */
  private readonly adapters = new Map<string, BoardEffectAdapter>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - inline audit cap, classifier threshold, iteration policy, and effect policy.
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
    this.effectConfig = {
      actionTypes: [...resolved.effectActionTypes],
      reversalWindowMs: { ...resolved.effectReversalWindowMs },
      retentionDays: resolved.effectRetentionDays,
      dispatchTimeoutMs: resolved.effectDispatchTimeoutMs,
      reservationLeaseMs: resolved.effectReservationLeaseMs,
    }
    this.effectActionTypes = new Set(resolved.effectActionTypes)
    this.classifierTimeoutMs = resolved.classifierTimeoutMs
    this.bulkApprovalEnabled = resolved.bulkApprovalEnabled
    this.dispatchIntervalMs = resolved.effectDispatchIntervalMs
    this.dispatchBackoffMs = resolved.effectDispatchBackoffMs
    this.startEffectConsumer()
  }

  /**
   * Run the outbox consumer on the configured cadence. The timer is part of the
   * service fiber, so disposing the plugin stops it; `unref` keeps a host that
   * forgot to dispose from being held open by it.
   */
  private startEffectConsumer(): void {
    if (this.dispatchIntervalMs === 0) return
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void this.sweepEffects().catch((error: unknown) => {
        this.ctx.logger.warn(`faberloom: outbox sweep failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, this.dispatchIntervalMs)
    if (typeof timer === 'object') timer.unref()
    this.ctx.effect(() => () => clearInterval(timer), 'faberloom.boardEffectConsumer')
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

  private async effectReservations(): Promise<KvTable<string, EffectReservationRecord>> {
    return (await this.domain()).table('effect_reservations')
  }

  private async effectMessages(): Promise<KvTable<string, EffectOutboxRecord>> {
    return (await this.domain()).table('effect_outbox')
  }

  private async effectAlerts(): Promise<KvTable<string, EffectAlertRecord>> {
    return (await this.domain()).table('effect_alerts')
  }

  private async effectEvents(): Promise<KvTable<string, EffectEventRecord>> {
    return (await this.domain()).table('effect_events')
  }

  /** The saved-view table of this domain. */
  private async views(): Promise<KvTable<string, BoardViewRecord>> {
    return (await this.domain()).table('views')
  }

  /** The iteration-chat attachments, keyed by session id. */
  private async iterationChats(): Promise<KvTable<string, IterationChatRecord>> {
    return (await this.domain()).table('iteration_chats')
  }

  /** The shadow evaluations that measure a classifier without deciding anything. */
  private async shadowEvaluations(): Promise<KvTable<string, ShadowEvaluationRecord>> {
    return (await this.domain()).table('severity_shadow')
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
    await this.authorizeRead(record, actor)
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
   * Apply one command inside a single `update` transform: optimistic check,
   * state change, and appended event commit together. A `data` callback receives
   * the record at its queue slot and the transformed one, so an audit event
   * names the values the command actually wrote.
   *
   * Authorization stays in the caller: {@link mutate} derives it from the owner,
   * while an administrative close and the outbox consumer check a role or the
   * tenant before they commit.
   * @param id - item id.
   * @param command - audit command name.
   * @param actorId - identity the audit event names.
   * @param transform - the transition, re-validated at its queue slot.
   * @param options - expected row token, reason, and audit detail.
   * @returns the item after the commit.
   */
  private async commitItem(
    id: FaberLoomBoardItemId,
    command: string,
    actorId: string,
    transform: (current: BoardItemRecord) => BoardItemRecord,
    options: {
      expectedRowVersion?: number | undefined
      reason?: string | null | undefined
      data?: MutateData
    } = {},
  ): Promise<FaberLoomBoardItem> {
    const table = await this.items()
    let next: BoardItemRecord | undefined
    await table.update(id, (current) => {
      this.requireRowVersion(current, options.expectedRowVersion)
      const candidate = transform(current)
      const fromState = stateOf(current)
      const toState = stateOf(candidate)
      const event = this.event({
        command,
        actor: actorId,
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

  /**
   * Apply one command on behalf of the item's owner: authorization, optimistic
   * check, state change, and the appended event commit in one `update`.
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
    return await this.commitItem(id, command, actor.id, (current) => {
      this.authorizeWrite(current, writer)
      return transform(current, actor)
    }, options)
  }

  /**
   * Convert an amount to USD at the rate the producer names, and keep the rate,
   * source, and date beside it (D-3). The board never invents a rate: an amount
   * in another currency without one is refused, so the queue never orders by a
   * converted value nobody can reproduce.
   * @param input - amount, currency, and the rate the producer used.
   * @returns the USD amount and the provenance to persist.
   */
  private async convertAmount(input: {
    valueAmount?: number | undefined
    valueCurrency?: string | undefined
    valueFxRate?: number | undefined
    valueFxSource?: string | undefined
    valueFxDate?: string | undefined
  }): Promise<{ usd: number | null; rate: number | null; source: string | null; date: string | null }> {
    if (input.valueAmount === undefined) return { usd: null, rate: null, source: null, date: null }
    const currency = input.valueCurrency?.trim().toUpperCase()
    if (currency === undefined || currency.length === 0) {
      throw new Error('faberloom: CURRENCY_REQUIRED — an amount needs the currency it is quoted in')
    }
    if (currency === 'USD') {
      return {
        usd: Math.round(input.valueAmount * 100) / 100,
        rate: 1,
        source: input.valueFxSource ?? 'identity',
        date: input.valueFxDate ?? new Date().toISOString().slice(0, 10),
      }
    }
    // The deployment may quote the rate itself (MWT ONE); the producer's rate
    // still wins, and an unquoted currency is refused instead of converted at
    // an invented value (D-3).
    let rate = input.valueFxRate
    let source = input.valueFxSource
    let date = input.valueFxDate
    if (rate === undefined) {
      const fx = this.ctx.get('faberloomBoardFx') as BoardFxPort | undefined
      const quote = fx === undefined ? undefined : await fx.usdRate(currency).catch(() => undefined)
      if (quote !== undefined) {
        rate = quote.rate
        source = quote.source
        date = quote.date
      }
    }
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(
        `faberloom: FX_RATE_REQUIRED — ${currency} needs the MWT ONE rate that converts it to USD (D-3)`,
      )
    }
    if (source === undefined || source.trim().length === 0) {
      throw new Error('faberloom: FX_SOURCE_REQUIRED — the rate must name the source it came from (D-3)')
    }
    if (date === undefined || date.trim().length === 0) {
      throw new Error('faberloom: FX_DATE_REQUIRED — the rate must name the date it was quoted (D-3)')
    }
    return {
      usd: Math.round(input.valueAmount * rate * 100) / 100,
      rate,
      source,
      date,
    }
  }

  /**
   * Severity for an item whose run reported none: deterministic rules first,
   * then the classifier port, with the answer cached under the full §5.1 key.
   * Without a mounted port nothing resolves and the item stays unclassified
   * (W-37), which is why the board imports no model.
   * @param companyId - tenant that owns the item.
   * @param spaceId - space of the item, or null.
   * @param artifactType - type the rules match.
   * @param accountRef - account the rules match.
   * @param summary - text the classifier may read.
   * @param contentHash - artifact hash, part of the cache key.
   * @returns the severity to persist.
   */
  private async resolveEntrySeverity(
    companyId: string | null,
    spaceId: string | null,
    artifactType: string,
    accountRef: string | null,
    summary: string,
    contentHash: string,
  ): Promise<BoardSeverityDecision> {
    const rules = resolveSeverity({ artifactType, accountRef }, { confidenceThreshold: this.confidenceThreshold })
    if (rules.severity !== null) return rules
    const classifier = this.ctx.get('faberloomBoardClassifier') as BoardClassifierPort | undefined
    const modelVersion = classifier?.modelVersion ?? ''
    const key = [
      companyId ?? 'sin-empresa', spaceId ?? 'sin-espacio', accountRef ?? 'sin-cuenta',
      artifactType, 'severity', contentHash, CLASSIFY_RULES_VERSION, DATA_CLASS_POLICY_VERSION,
      modelVersion.length === 0 ? 'sin-modelo' : modelVersion,
    ].join('\u0000')
    const table = await (await this.domain()).table('classification_cache')
    const cached = table.get(key)
    if (cached !== undefined) {
      return { severity: cached.severity, source: cached.source, confidence: cached.confidence }
    }
    let result: BoardClassifierResult | undefined
    if (classifier !== undefined) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.classifierTimeoutMs)
      try {
        result = await classifier.classifySeverity(
          { artifactType, accountRef, contentHash, summary },
          { signal: controller.signal, confidenceThreshold: this.confidenceThreshold },
        )
      } catch (error) {
        // A port that throws is a timeout: the item still enters (W-37).
        result = { status: 'invalid', detail: error instanceof Error ? error.message : String(error) }
      } finally {
        clearTimeout(timer)
      }
    }
    const decision = resolveSeverity(
      { artifactType, accountRef },
      {
        confidenceThreshold: this.confidenceThreshold,
        ...result === undefined ? {} : { classifier: result },
      },
    )
    const entry: BoardClassificationCacheEntry = {
      key,
      field: 'severity',
      companyId,
      severity: decision.severity,
      source: decision.source,
      confidence: decision.confidence,
      at: new Date().toISOString(),
    }
    await table.put(key, entry).catch(() => undefined)
    return decision
  }

  private async buildRecord(
    actor: BoardActor,
    input: BoardCreateInput & {
      runId?: string
      idempotencyKey?: string
      businessKey?: string
      sourceRef?: string | null
      state?: BoardState
      supersedesItemId?: string | null
      valueAmount?: number
      valueCurrency?: string
      valueFxRate?: number
      valueFxSource?: string
      valueFxDate?: string
      dueAt?: string
      severity?: BoardSeverity
      severityConfidence?: number
      assigneeId?: string
      actionType?: string
    },
  ): Promise<BoardItemRecord> {
    const now = new Date().toISOString()
    const evidence = requireEvidence(input.evidence)
    const content = input.content === undefined ? null : { ...input.content }
    const fieldOrigins = input.fieldOrigins === undefined ? [] : [...input.fieldOrigins]
    const artifactHash = hashOf({ summary: input.summary, evidence, content })
    // A caller that names no artifact type submitted a task: there is no
    // priced commitment behind it, and D-05 needs a deterministic type
    // before any field may leave for a provider.
    const artifactType = input.artifactType?.trim() || 'tarea'
    const accountRef = input.accountRef ?? null
    // The class is the server's: a caller describes the artifact, never its
    // sensitivity (D-05, D-07).
    const classification = classifyDataClass({ artifactType, accountRef })
    const fx = await this.convertAmount(input)
    // A run that reports a severity is measured against the confidence floor;
    // one that reports none falls to the deterministic rules and then, only if
    // a deployment mounted the port, to the classifier (W-37, W-51).
    const severity = input.severity === undefined
      ? await this.resolveEntrySeverity(
        input.companyId ?? actor.companyId ?? null,
        input.spaceId ?? null,
        artifactType,
        accountRef,
        input.summary,
        artifactHash,
      )
      : submittedSeverity(input.severity, input.severityConfidence ?? null, this.confidenceThreshold)
    return {
      ownerId: actor.id,
      companyId: input.companyId ?? actor.companyId ?? null,
      spaceId: input.spaceId ?? null,
      routineId: input.routineId ?? null,
      assigneeId: input.assigneeId ?? null,
      actionType: input.actionType?.trim() || 'mesa.decide',
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
      valueUsd: fx.usd,
      valueFxRate: fx.rate,
      valueFxSource: fx.source,
      valueFxDate: fx.date,
      dataClass: classification.dataClass,
      dataClassProvisional: classification.provisional,
      runId: input.runId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      businessKey: input.businessKey ?? null,
      sourceRef: input.sourceRef ?? null,
      supersedesItemId: input.supersedesItemId ?? null,
      artifactType,
      accountRef,
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
      effectKey: null,
      reversalDeadline: null,
      executionOutcome: null,
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
    requireEvidence(input.evidence)
    // The business identity is the server's (§2.1): the caller names the source,
    // never the key it hashes. An item with no source cannot be deduplicated.
    const sourceRef = sourceRefOf(input)
    const businessKey = businessKeyOf({
      companyId,
      spaceId: input.spaceId ?? null,
      accountRef: input.accountRef ?? null,
      sourceRef,
      artifactType: input.artifactType?.trim() || 'tarea',
    })
    const record = await this.buildRecord(actor, { ...input, sourceRef, businessKey })
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
    if (input.companyId !== undefined && input.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item company is not the actor company')
    }
    const companyId = input.companyId ?? actor.companyId ?? null
    requireEvidence(input.evidence)
    const sourceRef = sourceRefOf(input)
    const businessKey = businessKeyOf({
      companyId,
      spaceId: input.spaceId ?? null,
      accountRef: input.accountRef ?? null,
      sourceRef,
      artifactType: input.artifactType?.trim() || 'tarea',
    })
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

      const existing = await this.findNonTerminal(companyId, businessKey)
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
          ...current, state: 'SUSTITUIDO', status: 'completed', reversalDeadline: null,
        }), { reason: 'new-artifact' })
        // A substituted item no longer holds an execution: the scheduled effect
        // is cancelled and its reservation released (W-56).
        await this.releaseScheduledExecution(companyId, existing.record.effectKey, 'substituted')
        await this.release(companyId, 'bkey', existing.record.businessKey)
        supersedes = existing.id
      }

      const id = brandString<FaberLoomBoardItemId>(randomUUID())
      const record = await this.buildRecord(actor, {
        ...input,
        sourceRef,
        businessKey,
        title: input.title ?? input.summary.slice(0, 80),
        companyId: companyId ?? undefined,
        supersedesItemId: supersedes,
      })
      // Both keys are claimed before the record exists: a crash between the
      // claim and the put leaves a claim, never a second live item.
      await this.claimKey(companyId, 'idem', input.idempotencyKey, id)
      try {
        await this.claimKey(companyId, 'bkey', businessKey, id)
        await (await this.items()).put(id, record)
      } catch (error) {
        await this.release(companyId, 'idem', input.idempotencyKey)
        await this.release(companyId, 'bkey', businessKey)
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
    const updated = await this.mutate(writer, id, 'set_severity', current => ({
      ...current, severity, severitySource: source, severityConfidence: confidence,
    }), {
      expectedRowVersion,
      data: { previous, source, confidence },
    })
    // A human confirmation is the label the shadow evaluator is measured
    // against (W-63); the evaluation never changes the item.
    if (source === 'HUMAN') await this.evaluateShadow(updated)
    return updated
  }

  /**
   * Run one shadow evaluation of a human severity confirmation (W-63). The
   * result is stored for the report and never applied: the human severity stays
   * the item's severity. N2+ items are skipped because DPA, ZDR, and SOC 2 are
   * not in place for them; no content leaves for a shadow provider.
   * @param item - the item whose severity a human just confirmed.
   */
  private async evaluateShadow(item: FaberLoomBoardItem): Promise<void> {
    const shadow = this.ctx.get('faberloomBoardShadow') as BoardClassifierPort | undefined
    if (shadow === undefined) return
    const record = await this.requireItem(item.id)
    if (record.dataClass !== 'N0' && record.dataClass !== 'N1') return
    const last = record.revisions[record.revisions.length - 1]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.classifierTimeoutMs)
    let result: BoardClassifierResult
    try {
      result = await shadow.classifySeverity({
        artifactType: record.artifactType,
        accountRef: record.accountRef,
        contentHash: record.artifactHash ?? '',
        summary: last?.summary ?? '',
      }, { signal: controller.signal, confidenceThreshold: this.confidenceThreshold })
    } catch (error: unknown) {
      result = { status: 'invalid', detail: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
    const evaluation: BoardShadowEvaluation = shadowEvaluationOf(item, result, shadow.modelVersion, this.confidenceThreshold)
    await (await this.shadowEvaluations()).put(
      `${item.id}\u0000${evaluation.at}`,
      {
        companyId: record.companyId,
        itemId: item.id,
        humanSeverity: evaluation.humanSeverity,
        shadowSeverity: evaluation.shadowSeverity,
        status: evaluation.status,
        modelVersion: evaluation.modelVersion,
        at: evaluation.at,
      },
    ).catch(() => undefined)
  }

  /**
   * The shadow report of one tenant's window (W-63): agreement, abstentions,
   * errors, and the case that matters, a CRITICAL the shadow ranked lower.
   * @param actor - the tenant whose evaluations are read.
   * @param filter - inclusive ISO-8601 window; omitted reads every stored row.
   * @returns the aggregate.
   */
  async shadowReport(
    actor: BoardActor,
    filter: { readonly from?: string; readonly to?: string } = {},
  ): Promise<BoardShadowReport> {
    const byHuman: Record<BoardSeverity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
    const report = { evaluated: 0, matched: 0, mismatched: 0, abstained: 0, invalid: 0, timeout: 0, criticalLowered: 0 }
    for (const [, row] of (await this.shadowEvaluations()).entries()) {
      if (row.companyId !== (actor.companyId ?? null)) continue
      if (filter.from !== undefined && row.at < filter.from) continue
      if (filter.to !== undefined && row.at > filter.to) continue
      const human = row.humanSeverity as BoardSeverity
      report.evaluated += 1
      byHuman[human] += 1
      if (row.status === 'matched') report.matched += 1
      else if (row.status === 'mismatched') report.mismatched += 1
      else if (row.status === 'abstained') report.abstained += 1
      else if (row.status === 'timeout') report.timeout += 1
      else report.invalid += 1
      if (human === 'CRITICAL' && row.shadowSeverity !== null && row.shadowSeverity !== 'CRITICAL') report.criticalLowered += 1
    }
    return { ...report, byHuman }
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
   * Approve a batch under §6.4. Every item is revalidated on the server — state,
   * row, artifact hash, controls, and signatures — and the answer names what was
   * approved and what was refused with its own code. A refusal on one item never
   * rolls back the others.
   *
   * The batch stays off until a deployment enables it (D-11); W-14 records that
   * absence, and this method is the W-15 behavior behind the flag.
   * @param writer - the acting identity.
   * @param input - the items the reviewer saw and the controls they confirmed.
   * @returns approved items and refused items with their reasons.
   */
  async approveBulk(writer: BoardWriter, input: BoardBulkApproveInput): Promise<BoardBulkApproveResult> {
    if (!this.bulkApprovalEnabled) {
      throw new Error('faberloom: BULK_DISABLED — this deployment keeps the batch outside the pilot (D-11)')
    }
    const actor = this.actorOf(writer)
    const approved: { id: string; version: number }[] = []
    const rejected: BoardBulkRejection[] = []
    let first: BoardItemRecord | undefined
    for (const entry of input.items) {
      const id = entry.id as FaberLoomBoardItemId
      let record: BoardItemRecord
      try {
        record = await this.requireItem(id)
        this.authorizeWrite(record, actor)
      } catch (error: unknown) {
        rejected.push({ id: entry.id, code: errorCodeOf(error), detail: messageOf(error) })
        continue
      }
      const ineligible = this.bulkEligibility(record, first)
      if (ineligible !== null) {
        rejected.push({ id: entry.id, code: ineligible, detail: 'the item is not eligible for a batch (§6.4)' })
        continue
      }
      first ??= record
      try {
        const item = await this.approve(writer, id, {
          expectedRowVersion: entry.expectedRowVersion,
          expectedArtifactVersion: entry.expectedArtifactVersion,
          expectedArtifactHash: entry.expectedArtifactHash,
          ...input.confirmations === undefined ? {} : { confirmations: input.confirmations },
        })
        approved.push({ id: entry.id, version: item.approvedRevision ?? item.version })
      } catch (error: unknown) {
        rejected.push({ id: entry.id, code: errorCodeOf(error), detail: messageOf(error) })
      }
    }
    return { approved, rejected }
  }

  /**
   * Why one item may not join the batch, or null when it may.
   * @param record - the stored item.
   * @param first - the first eligible item, which fixes the batch's scope.
   * @returns the refusal code, or null.
   */
  private bulkEligibility(record: BoardItemRecord, first: BoardItemRecord | undefined): string | null {
    if (record.severity !== 'LOW' || record.severitySource === null) return 'BULK_SEVERITY'
    // §6.4 excludes any action that touches money, inventory, or external
    // shipments: a priced item or an effect type is reviewed one at a time.
    if (record.valueUsd !== null) return 'BULK_MONEY'
    if (record.actionType !== 'mesa.decide') return 'BULK_ACTION'
    if (first === undefined) return null
    const sameScope = record.companyId === first.companyId
      && record.spaceId === first.spaceId
      && record.assigneeId === first.assigneeId
      && record.actionType === first.actionType
      && record.artifactType === first.artifactType
    return sameScope ? null : 'BULK_MIXED'
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
      // The key binds the space (§2.1): assigning one recomputes the identity,
      // and a collision with another live item resolves per §2.3.
      const previousKey = current.businessKey
      const key = businessKeyOf({
        companyId,
        spaceId: workspaceId,
        accountRef: current.accountRef,
        sourceRef: sourceRefOf(current),
        artifactType: current.artifactType,
      })
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
          if (previousKey !== null && previousKey !== key) await this.release(companyId, 'bkey', previousKey)
          return { item: toItem(other.id, await this.requireItem(other.id)), transferredDrafts }
        }
        await this.mutate(writer, other.id, 'superseded', item => ({
          ...item, state: 'SUSTITUIDO', status: 'completed', iterationDraftKey: null, reversalDeadline: null,
        }), { reason: 'workspace-collision' })
        await this.releaseScheduledExecution(companyId, other.record.effectKey, 'substituted')
        transferredDrafts = await this.transferDrafts(other.record, other.id, id)
        await this.release(companyId, 'bkey', key)
        superseded = other.id
      }
      await this.claimKey(companyId, 'bkey', key, id)
      const item = await this.mutate(writer, id, 'assign_workspace', entry => ({
        ...entry,
        spaceId: workspaceId,
        businessKey: key,
        supersedesItemId: superseded ?? entry.supersedesItemId,
      }))
      if (previousKey !== null && previousKey !== key) await this.release(companyId, 'bkey', previousKey)
      return { item, transferredDrafts }
    })
  }

  /**
   * Undo a key migration that wrote canonical keys from a source that was not a
   * real identity (for example, the first evidence reference). It releases the
   * claim and returns the row to the keyless legacy state, recording the
   * rollback. Used once to repair a migration whose strict rule was not in
   * place; it never touches a row that already had no key.
   * @param actor - the identity running the rollback; its company bounds it.
   * @returns how many rows were rolled back.
   */
  async rollbackRekey(actor: BoardActor): Promise<{ readonly rolledBack: number }> {
    let rolledBack = 0
    for (const [id, record] of (await this.items()).entries()) {
      if (record.companyId !== null && record.companyId !== actor.companyId) continue
      const key = record.businessKey
      if (key === null || !/^[0-9a-f]{64}$/u.test(key)) continue
      const writer: BoardActor = record.companyId === null
        ? { id: record.ownerId }
        : { id: record.ownerId, companyId: record.companyId }
      await this.release(record.companyId, 'bkey', key)
      await this.mutate(writer, id, 'rekey.rollback', item => ({
        ...item, businessKey: null, sourceRef: null,
      }))
      rolledBack += 1
    }
    return { rolledBack }
  }

  /**
   * Restore the items a key migration closed because their derived key
   * collided. A row with no real source reference was collapsed by a key that
   * hashed its first evidence, which is not an identity; this command returns
   * it to `PENDIENTE_CRITERIO` and records the restoration.
   * @param actor - the identity running the recovery.
   * @returns how many items were restored.
   */
  async restoreRekeyCollisions(actor: BoardActor): Promise<{ readonly restored: number }> {
    let restored = 0
    for (const [id, record] of (await this.items()).entries()) {
      if (record.companyId !== null && record.companyId !== actor.companyId) continue
      const last = record.events[record.events.length - 1]
      if (last?.command !== 'superseded' || last.reason !== 'rekey-collision') continue
      const writer: BoardActor = record.companyId === null
        ? { id: record.ownerId }
        : { id: record.ownerId, companyId: record.companyId }
      await this.mutate(writer, id, 'rekey.restore', item => ({
        ...item, state: 'PENDIENTE_CRITERIO', status: 'waiting_approval',
      }))
      restored += 1
    }
    return { restored }
  }

  /**
   * Recompute every item's business key from §2.1. Only a row that names a real
   * source reference is migrated: its producer key or its recorded `sourceRef`.
   * A row with neither has no identity to dedupe by, so it is reported as
   * skipped instead of being collapsed by its first evidence. A dry run reports
   * what it would do and writes nothing.
   * @param actor - the identity running the migration; its company bounds the run.
   * @param options - `dryRun` reports without writing.
   * @returns what changed, what stayed, and what collided.
   */
  async rekeyAll(actor: BoardActor, options: { readonly dryRun?: boolean } = {}): Promise<BoardRekeyReport> {
    const rows = [...(await this.items()).entries()]
      .sort((left, right) => left[1].updatedAt.localeCompare(right[1].updatedAt) || left[0].localeCompare(right[0]))
    const report = { scanned: rows.length, rekeyed: 0, unchanged: 0, collisions: 0, skipped: 0, entries: [] as BoardRekeyEntry[] }
    for (const [id, record] of rows) {
      // A row scoped to another company is another tenant's: the migration
      // reports it as skipped instead of crossing the boundary.
      if (record.companyId !== null && record.companyId !== actor.companyId) {
        report.skipped += 1
        report.entries.push({ id, from: record.businessKey, to: record.businessKey ?? '', sourceRef: '', action: 'skipped' })
        continue
      }
      // Only an explicit source migrates; evidence is not an identity.
      const sourceRef = record.sourceRef?.trim() || record.businessKey?.trim() || ''
      const to = sourceRef.length === 0
        ? record.businessKey ?? ''
        : businessKeyOf({
          companyId: record.companyId,
          spaceId: record.spaceId,
          accountRef: record.accountRef,
          sourceRef,
          artifactType: record.artifactType,
        })
      if (sourceRef.length === 0) {
        report.skipped += 1
        report.entries.push({ id, from: record.businessKey, to, sourceRef, action: 'skipped' })
        continue
      }
      if (record.businessKey === to && record.sourceRef === sourceRef) {
        report.unchanged += 1
        report.entries.push({ id, from: record.businessKey, to, sourceRef, action: 'unchanged' })
        continue
      }
      if (options.dryRun === true) {
        report.rekeyed += 1
        report.entries.push({ id, from: record.businessKey, to, sourceRef, action: 'rekeyed' })
        continue
      }
      const outcome = await this.serial(record.companyId, async () => await this.rekeyOne(id, to, sourceRef))
      report.rekeyed += 1
      if (outcome === 'collision') report.collisions += 1
      report.entries.push({ id, from: record.businessKey, to, sourceRef, action: outcome })
    }
    return report
  }

  /**
   * Write one canonical key, resolving a §2.3 collision the way a workspace
   * assignment does: a substitutable holder is superseded, a holder inside an
   * attempt or an execution receives the artifact as a candidate.
   * @param actor - the owning identity.
   * @param id - item being rekeyed.
   * @param to - canonical key.
   * @param sourceRef - source reference the key hashes.
   * @returns `rekeyed`, or `collision` when another live item held the key.
   */
  private async rekeyOne(
    id: FaberLoomBoardItemId,
    to: string,
    sourceRef: string,
  ): Promise<'rekeyed' | 'collision'> {
    const current = await this.requireItem(id)
    const ownerOf = (record: BoardItemRecord): BoardActor => record.companyId === null
      ? { id: record.ownerId }
      : { id: record.ownerId, companyId: record.companyId }
    const from = current.businessKey
    let action: 'rekeyed' | 'collision' = 'rekeyed'
    if (!TERMINAL.includes(stateOf(current))) {
      const other = await this.findNonTerminal(current.companyId, to, id)
      if (other !== undefined) {
        action = 'collision'
        if (NOT_SUBSTITUTABLE.includes(stateOf(other.record))) {
          await this.mutate(ownerOf(other.record), other.id, 'candidate_arrived', item => ({
            ...item, pendingCandidate: this.candidateOf(current),
          }))
          await this.mutate(ownerOf(current), id, 'superseded', item => ({
            ...item, state: 'SUSTITUIDO', status: 'completed', iterationDraftKey: null,
          }), { reason: 'rekey-collision' })
          await this.transferDrafts(current, id, other.id)
          await this.claimKey(current.companyId, 'bkey', to, other.id)
          if (from !== null && from !== to) await this.release(current.companyId, 'bkey', from)
          return action
        }
        await this.mutate(ownerOf(other.record), other.id, 'superseded', item => ({
          ...item, state: 'SUSTITUIDO', status: 'completed', iterationDraftKey: null, reversalDeadline: null,
        }), { reason: 'rekey-collision' })
        await this.releaseScheduledExecution(current.companyId, other.record.effectKey, 'substituted')
        await this.transferDrafts(other.record, other.id, id)
        await this.release(current.companyId, 'bkey', to)
      }
    }
    await this.mutate(ownerOf(current), id, 'rekey', item => ({ ...item, businessKey: to, sourceRef }))
    await this.claimKey(current.companyId, 'bkey', to, id)
    if (from !== null && from !== to) await this.release(current.companyId, 'bkey', from)
    return action
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
    await this.authorizeRead(record, actor)
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
    await this.authorizeRead(record, actor)
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
    input: { baseVersion: number; revision: number; writerSession: string; changes: Record<string, BoardEditValue> },
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
    await this.authorizeRead(record, actor)
    return await this.statusOf(id, record)
  }

  /**
   * What one iteration chat pins above the conversation, filtered by the
   * item's class. The panel already holds this in memory; the chat agent reads
   * it through the MCP tool so it never has to ask the user to repeat the item.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the pinned context, or undefined when the item is gone.
   */
  async iterationContext(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardIterationContext | undefined> {
    const record = (await this.items()).get(id)
    if (record === undefined) return undefined
    await this.authorizeRead(record, actor)
    const item = toItem(id, record)
    const restricted = item.dataClassProvisional || item.dataClass === 'N3' || item.dataClass === 'N4'
    const revision = item.revisions[item.revisions.length - 1]
    const draft = await this.getIterationDraft(actor, id).catch(() => undefined)
    return {
      itemId: item.id,
      title: item.title,
      accountRef: item.accountRef,
      spaceId: item.spaceId,
      version: item.version,
      iterationId: item.iterationId,
      generation: item.iterationLockGeneration,
      holderSession: item.iterationLockBy,
      baseVersion: item.iterationBaseVersion,
      rounds: item.iterationRoundCount,
      summary: restricted ? null : revision?.summary ?? '',
      draftSummary: restricted ? null : draft?.summary ?? null,
      evidence: restricted || revision === undefined ? [] : [...revision.evidence],
    }
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
    await this.authorizeRead(record, actor)
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
   * Route one instruction against the fields an item declares, without writing
   * anything. The detail's instruction box and the iteration chat share this
   * parser, so an instruction that works in one works in the other (§9.7).
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @param text - the instruction the user typed.
   * @returns the changes, or null when the router does not own the sentence.
   */
  async routeInstruction(
    actor: BoardActor,
    id: FaberLoomBoardItemId,
    text: string,
  ): Promise<readonly BoardFieldChange[] | null> {
    const record = await this.requireItem(id)
    await this.authorizeRead(record, actor)
    return routeFieldInstruction(text, declaredItemFields(record))
  }

  /**
   * Attach one chat session to the item's live attempt. The panel calls this
   * when it opens the iteration chat, so the host reaches this exact attempt
   * instead of inferring it from the conversation text (§9.7).
   * @param writer - the acting identity that opened the chat.
   * @param id - item id.
   * @param sessionId - chat session the host reads the attachment by.
   * @returns the attachment written.
   */
  async attachIterationChat(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    sessionId: string,
  ): Promise<BoardIterationChat> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    if (current.iterationId === null
      || current.iterationLockBy === null
      || current.iterationLockUntil === null
      || current.iterationBaseVersion === null) {
      throw new Error('faberloom: NO_ITERATION — the item has no live attempt to attach a chat to')
    }
    if (Date.parse(current.iterationLockUntil) <= Date.now()) {
      throw new Error('faberloom: NO_ITERATION — the attempt lock already expired')
    }
    const actor = this.actorOf(writer)
    const chat: BoardIterationChat = {
      ownerId: actor.id,
      companyId: actor.companyId ?? null,
      itemId: id,
      iterationId: current.iterationId,
      generation: current.iterationLockGeneration,
      holderSession: current.iterationLockBy,
      baseVersion: current.iterationBaseVersion,
    }
    await (await this.iterationChats()).put(sessionId, { ...chat, createdAt: new Date().toISOString() })
    return chat
  }

  /**
   * Apply one deterministic field instruction to the draft of the attempt a
   * chat session is attached to. The host calls this before a model step, so a
   * recognized instruction never reaches the provider.
   * @param sessionId - chat session that typed the instruction.
   * @param text - the instruction.
   * @returns what changed, or undefined when the session holds no attempt or the
   * router does not own the sentence.
   */
  async applyIterationInstruction(sessionId: string, text: string): Promise<BoardInstructionOutcome | undefined> {
    const chat = (await this.iterationChats()).get(sessionId)
    if (chat === undefined) return undefined
    const id = chat.itemId as FaberLoomBoardItemId
    const current = await this.requireItem(id)
    // The attempt moved on (applied, cancelled, or replaced): the attachment no
    // longer names a live draft, so the sentence belongs to the agent.
    if (current.iterationId !== chat.iterationId) return undefined
    const writer: BoardActor = chat.companyId === null
      ? { id: chat.ownerId }
      : { id: chat.ownerId, companyId: chat.companyId }
    this.authorizeWrite(current, writer)
    const draft = await this.getIterationDraft(writer, id, chat.iterationId)
    // What the item declares plus what the draft already carries: an instruction
    // may fix a field of the artifact the draft has not touched yet.
    const fields = [...new Set([...declaredItemFields(current), ...Object.keys(draft?.content ?? {})])]
    const changes = routeFieldInstruction(text, fields)
    if (changes === null) return undefined
    const summary = changes.find(change => change.field === 'summary')
    if (summary !== undefined && typeof summary.value !== 'string') return undefined
    const content = Object.fromEntries(
      changes.filter(change => change.field !== 'summary').map(change => [change.field, change.value]),
    )
    const outcome = await this.saveIterationDraft(writer, id, {
      iterationId: chat.iterationId,
      generation: chat.generation,
      actorSession: chat.holderSession,
      baseVersion: chat.baseVersion,
      ...summary === undefined ? {} : { summary: summary.value as string },
      ...Object.keys(content).length === 0 ? {} : { content },
    })
    return { changes, applied: outcome.linked }
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

  // ── Execution (E15) ─────────────────────────────────────────────────

  /**
   * The resolved effect policy (D-12): the action types this deployment accepts,
   * the reversal window per action type, the retention of a settled effect
   * record, the timeout one dispatch attempt gets from its adapter, and the lease
   * a crashed acceptance is given.
   * @returns a copy of the resolved policy.
   */
  effectPolicy(): EffectPolicy {
    return {
      actionTypes: [...this.effectConfig.actionTypes],
      reversalWindowMs: { ...this.effectConfig.reversalWindowMs },
      retentionDays: this.effectConfig.retentionDays,
      dispatchTimeoutMs: this.effectConfig.dispatchTimeoutMs,
      reservationLeaseMs: this.effectConfig.reservationLeaseMs,
    }
  }

  /**
   * The adapters this deployment mounted, one per accepted action type, so an
   * operator can see whether execution is operable before accepting an effect.
   * @returns the registered adapters with their declaration.
   */
  effectAdapters(): readonly { actionType: string; idempotent: boolean; probe: boolean }[] {
    return [...this.adapters.entries()]
      .map(([actionType, adapter]) => ({
        actionType,
        idempotent: adapter.idempotent,
        probe: adapter.probe !== undefined,
      }))
      .sort((left, right) => left.actionType.localeCompare(right.actionType))
  }

  /**
   * Register the adapter of one action type. The registry is mounted from
   * outside the board, the way `registerCheck` mounts a control: a deployment
   * owns the mail, inventory, or shipment client, and the board only decides
   * when to call it. A second adapter for one action type replaces the first.
   * @param actionType - action type the adapter emits (`mail.send`, ...).
   * @param adapter - the implementation.
   * @returns the disposer that removes this registration.
   */
  registerEffectAdapter(actionType: string, adapter: BoardEffectAdapter): () => void {
    const key = this.requireAcceptedActionType(actionType)
    this.adapters.set(key, adapter)
    return () => {
      if (this.adapters.get(key) === adapter) this.adapters.delete(key)
    }
  }

  /**
   * Refuse an action type this deployment does not accept. The accepted set is
   * a Config field whose defaults D-12 signs, so an adapter or an acceptance
   * cannot mint a second spelling of one effect.
   * @param actionType - the caller's action type.
   * @returns the trimmed action type.
   */
  private requireAcceptedActionType(actionType: string): string {
    const key = actionType.trim()
    if (!this.effectActionTypes.has(key)) {
      throw new Error(
        `faberloom: EFFECT_ACTION_UNKNOWN — ${key.length === 0 ? '(empty)' : key} is not an accepted action type,`
        + ` accepted: ${[...this.effectActionTypes].join(', ')}`,
      )
    }
    return key
  }

  /**
   * Ask the mounted access service for the CEO signature W-16 requires before a
   * protected action type leaves. A refusal — missing, revoked, or expired —
   * propagates unchanged, and nothing is written.
   *
   * A composition without `faberloomAccess` enforces no signature: the board
   * does not know which action types are protected, so it cannot decide, and the
   * caller of such a composition owns that gap.
   * @param writer - the acting identity; its company scopes the signature.
   * @param actionType - the action type the acceptance names.
   */
  private async requireActionSignature(writer: BoardWriter, actionType: string): Promise<void> {
    const access = this.ctx.get('faberloomAccess') as BoardAccess | undefined
    if (access === undefined) return
    const actor = this.actorOf(writer)
    await access.requireSignature({ id: actor.id, companyId: actor.companyId }, actionType)
  }

  /**
   * Approve the exact artifact version and accept one execution for it: the
   * approval, the reservation, and the outbox message are acquired in one
   * command, so a crash cannot leave an authorized item without its intention
   * (§10.1). The reservation is per tenant and `effect_key`, so a competing
   * execution of the same effect is refused with `EFFECT_TAKEN` while it is
   * `RESERVADA` or `DESPACHADA`.
   *
   * When the `faberloomAccess` service is mounted, the acceptance asks it for
   * the CEO signature W-16 requires and lets its refusal propagate unchanged;
   * a composition without that service enforces no signature here, because the
   * board cannot tell which action types are protected.
   *
   * The item lands in `DELEGADO_EN_VENTANA` when the action type has a reversal
   * window, and in `EJECUCION_PENDIENTE` when it has none (D-12). The controls
   * run again immediately before the transition, exactly as `approve` does.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - approval expectations, execution identity, and destination.
   * @returns the item, its reservation, and its outbox message.
   */
  async approveWithExecution(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardExecutionInput,
  ): Promise<BoardEffectExecution> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    this.requireRowVersion(current, input.expectedRowVersion)
    this.requireApprovable(current, input)
    const identity = this.requireEffectIdentity(current, input)
    await this.requireActionSignature(writer, identity.actionType)
    const confirmations = input.confirmations ?? []
    const report = await this.evaluateChecks(current, id)
    this.requireChecksPassable(report, confirmations)

    return await this.serial(current.companyId, async () => {
      const latest = await this.requireItem(id)
      this.authorizeWrite(latest, writer)
      this.requireRowVersion(latest, input.expectedRowVersion)
      this.requireApprovable(latest, input)
      const reservations = await this.effectReservations()
      const key = reservationKeyOf(latest.companyId, identity.effectKey)
      const held = reservations.get(key)
      if (held !== undefined && reservationIsLive(held.status) && held.executionId !== identity.executionId) {
        throw new Error(
          `faberloom: EFFECT_TAKEN — the effect ${identity.effectKey} is held by execution ${held.executionId}`,
        )
      }

      const now = new Date()
      const windowMs = reversalWindowMs(this.effectConfig, identity.actionType)
      const deadline = reversalDeadlineOf(this.effectConfig, identity.actionType, now)
      const at = now.toISOString()
      const reservation: EffectReservationRecord = {
        companyId: latest.companyId,
        effectKey: identity.effectKey,
        actionType: identity.actionType,
        destination: identity.destination,
        businessKey: identity.businessKey,
        artifactHash: identity.artifactHash,
        executionId: identity.executionId,
        itemId: id,
        idempotencyKey: identity.idempotencyKey,
        authorization: identity.authorization,
        status: 'RESERVADA',
        outcome: null,
        reversalDeadline: deadline,
        dispatchedAt: null,
        releasedAt: null,
        releaseReason: null,
        closedAt: null,
        closedBy: null,
        closeReason: null,
        settledAt: null,
        createdAt: held?.createdAt ?? at,
        updatedAt: at,
        retainUntil: retainUntilOf(this.effectConfig, now),
      }
      if (held === undefined) await reservations.put(key, reservation)
      else await reservations.update(key, () => reservation)

      const messages = await this.effectMessages()
      const messageKey = outboxKeyOf(latest.companyId, identity.effectKey)
      const previousMessage = messages.get(messageKey)
      const message: EffectOutboxRecord = {
        companyId: latest.companyId,
        effectKey: identity.effectKey,
        executionId: identity.executionId,
        itemId: id,
        actionType: identity.actionType,
        destination: identity.destination,
        idempotencyKey: identity.idempotencyKey,
        status: 'PENDIENTE',
        dispatchable: true,
        attempts: previousMessage?.attempts ?? 0,
        backoffUntil: null,
        reason: null,
        ref: null,
        createdAt: previousMessage?.createdAt ?? at,
        updatedAt: at,
        dispatchedAt: null,
        settledAt: null,
        retainUntil: retainUntilOf(this.effectConfig, now),
      }
      if (previousMessage === undefined) await messages.put(messageKey, message)
      else await messages.update(messageKey, () => message)

      try {
        const item = await this.mutate(writer, id, 'effect.accepted', (record) => {
          this.requireApprovable(record, input)
          return {
            ...record,
            state: deadline === null ? 'EJECUCION_PENDIENTE' : 'DELEGADO_EN_VENTANA',
            status: 'in_progress',
            approvedRevision: record.version,
            stale: false,
            staleReason: null,
            executionId: identity.executionId,
            effectKey: identity.effectKey,
            actionType: identity.actionType,
            reversalDeadline: deadline,
            executionOutcome: null,
          }
        }, {
          expectedRowVersion: input.expectedRowVersion,
          data: {
            ...this.checkEventData(report, confirmations) ?? {},
            effectKey: identity.effectKey,
            executionId: identity.executionId,
            actionType: identity.actionType,
            destination: identity.destination,
            idempotencyKey: identity.idempotencyKey,
            windowMs,
            reversalDeadline: deadline,
            authorization: identity.authorization,
          },
        })
        return { item, reservation: toReservation(reservation), message: toMessage(message) }
      } catch (error) {
        // The acceptance did not commit, so neither row may outlive it.
        await this.cancelMessage(latest.companyId, identity.effectKey, 'ACCEPTANCE_FAILED')
        await this.releaseReservation(latest.companyId, identity.effectKey, 'acceptance-failed')
        throw error
      }
    })
  }

  /**
   * Revert a delegated execution inside its window. The effect has not happened
   * and cannot have happened, so the reservation is released and the outbox
   * message cancelled; a revert at or after the deadline is refused (W-18) and
   * a delegated item with no recorded deadline is refused outright (W-17).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - optimistic token and optional reason.
   * @returns the item back in `PENDIENTE_CRITERIO`.
   */
  async revert(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRevertInput = {}): Promise<FaberLoomBoardItem> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    const effectKey = current.effectKey
    return await this.serial(current.companyId, async () => {
      const latest = await this.requireItem(id)
      this.authorizeWrite(latest, writer)
      const now = new Date()
      const deadline = this.requireDelegatedDeadline(latest)
      if (now.getTime() >= Date.parse(deadline)) {
        throw new Error('faberloom: WINDOW_EXPIRED — the reversal window closed; only expiry applies')
      }
      if (effectKey !== null) {
        const held = (await this.effectReservations()).get(reservationKeyOf(latest.companyId, effectKey))
        if (held !== undefined && held.status === 'DESPACHADA') {
          throw new Error('faberloom: EFFECT_DISPATCHED — only reconciliation settles a dispatched effect')
        }
      }
      const item = await this.mutate(writer, id, 'revert', (record) => {
        const recordDeadline = this.requireDelegatedDeadline(record)
        if (now.getTime() >= Date.parse(recordDeadline)) {
          throw new Error('faberloom: WINDOW_EXPIRED — the reversal window closed; only expiry applies')
        }
        return {
          ...record,
          state: 'PENDIENTE_CRITERIO',
          status: 'waiting_approval',
          approvedRevision: null,
          effectKey: null,
          reversalDeadline: null,
          executionOutcome: null,
        }
      }, {
        expectedRowVersion: input.expectedRowVersion,
        reason: input.reason ?? null,
        data: { effectKey, reversalDeadline: deadline },
      })
      await this.cancelMessage(latest.companyId, effectKey, 'REVERTED')
      await this.releaseReservation(latest.companyId, effectKey, 'reverted')
      return item
    })
  }

  /**
   * Expire the reversal window: the item moves to `EJECUCION_PENDIENTE` and the
   * effect becomes dispatchable. An item whose window is still open is refused
   * with `WINDOW_OPEN`, and one that is not delegated with `NOT_DELEGATED`, so a
   * revert and an expiry produce exactly one transition (W-18).
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the item in `EJECUCION_PENDIENTE`.
   */
  async expireWindow(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    return await this.serial(current.companyId, async () => {
      const latest = await this.requireItem(id)
      this.authorizeWrite(latest, writer)
      const now = new Date()
      return await this.commitItem(id, 'window.expired', actor.id, (record) => {
        const deadline = this.requireClosedWindow(record, now)
        return this.expiredRecord(record, deadline, actor.id)
      }, { data: { effectKey: latest.effectKey, reversalDeadline: latest.reversalDeadline } })
    })
  }

  /**
   * Run the controls again before the effect leaves (W-50, W-75). A blocking
   * failure, a declared control with no adapter, or a confirmation failure the
   * approval never accepted invalidates the acceptance: the item returns to
   * `PENDIENTE_CRITERIO`, the reservation is released, and the message is
   * cancelled, so a fresh approval of the same effect is accepted (W-95).
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns whether the effect may still leave, and the item after the attempt.
   */
  async revalidateEffect(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<BoardEffectRevalidation> {
    const actor = this.actorOf(writer)
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    this.requireAcceptedExecution(current)
    const failure = await this.revalidateForDispatch(current, id)
    if (failure === null) return { ok: true, item: toItem(id, current) }
    return await this.serial(current.companyId, async () => {
      const latest = await this.requireItem(id)
      this.authorizeWrite(latest, writer)
      const item = await this.invalidateAcceptance(latest, id, actor.id, failure, current.rowVersion)
      await this.cancelMessage(latest.companyId, latest.effectKey, 'REVALIDATION_FAILED')
      await this.releaseReservation(latest.companyId, latest.effectKey, 'revalidation-failed')
      return { ok: false, item }
    })
  }

  /**
   * Consent to emit one effect: the outbox consumer. Before it calls the
   * adapter it verifies, inside one tenant section, that the message is
   * dispatchable, that the reservation is still `RESERVADA` for this execution,
   * that the item still authorizes the effect, and that the controls still
   * pass. Any failed check emits nothing, releases the reservation, and marks
   * the message non-dispatchable (W-95, W-102).
   *
   * An item still inside its reversal window keeps the message `PENDIENTE` and
   * reports `WINDOW_OPEN`: nothing leaves before `reversal_deadline` (W-19).
   * @param actor - the tenant the consumer acts for.
   * @param effectKey - effect to emit.
   * @returns what the attempt produced.
   */
  async dispatchEffect(actor: BoardActor, effectKey: string): Promise<BoardDispatchOutcome> {
    const messageKey = outboxKeyOf(actor.companyId ?? null, effectKey)
    const message = (await this.effectMessages()).get(messageKey)
    if (message === undefined || message.companyId !== (actor.companyId ?? null)) {
      throw new Error(`faberloom: NOT_FOUND — outbox message ${effectKey} not found`)
    }
    return await this.serial(message.companyId, async () => await this.dispatchOne(actor, messageKey, effectKey))
  }

  /**
   * The messages this tenant may still emit, oldest first. A cancelled,
   * dispatched, or failed message is not listed: it is not dispatchable.
   * @param actor - the tenant the consumer acts for.
   * @returns the dispatchable messages.
   */
  async pendingEffects(actor: BoardActor): Promise<readonly BoardOutboxMessage[]> {
    const tenant = actor.companyId ?? null
    const pending: BoardOutboxMessage[] = []
    for (const [, row] of (await this.effectMessages()).entries()) {
      if (row.companyId !== tenant) continue
      if (!messageIsDispatchable(row.status, row.dispatchable)) continue
      pending.push(toMessage(row))
    }
    return pending.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * One outbox pass: try every pending message the backoff allows, oldest
   * first. A refusal raises one visible alert for a missing adapter and waits
   * out the backoff, so a misconfigured deployment is visible instead of
   * retrying in a hot loop. Emitting never crosses tenants: each message is
   * dispatched under the tenant that owns it.
   * @returns how many messages were attempted and how they ended.
   */
  async sweepEffects(): Promise<{ attempted: number; dispatched: number; refused: number }> {
    const messages = await this.effectMessages()
    const now = Date.now()
    const result = { attempted: 0, dispatched: 0, refused: 0 }
    for (const [, row] of messages.entries()) {
      if (!messageIsDispatchable(row.status, row.dispatchable)) continue
      // The first attempt is immediate. A row the consumer already refused keeps
      // quiet until its backoff expires, so a missing adapter cannot spin.
      if (row.backoffUntil !== null && Date.parse(row.backoffUntil) > now) continue
      result.attempted += 1
      const actor: BoardActor = { id: EFFECT_CONSUMER, companyId: row.companyId ?? undefined }
      try {
        const outcome = await this.dispatchEffect(actor, row.effectKey)
        if (outcome.dispatched) {
          result.dispatched += 1
          continue
        }
        result.refused += 1
        await this.recordRefusal(row, outcome)
      } catch (error) {
        result.refused += 1
        await this.recordRefusal(row, {
          dispatched: false,
          code: 'NOT_AUTHORIZED',
          item: null,
          outcome: null,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  }

  /**
   * Keep a refused message pending but quiet for one backoff window, and make a
   * missing adapter visible once.
   * @param message - the outbox row that was refused.
   * @param outcome - what the dispatch attempt answered.
   */
  private async recordRefusal(message: EffectOutboxRecord, outcome: BoardDispatchOutcome): Promise<void> {
    if (outcome.code === 'EFFECT_NO_ADAPTER') {
      await this.raiseAlert({
        companyId: message.companyId,
        effectKey: message.effectKey,
        itemId: message.itemId,
        executionId: message.executionId,
        kind: 'DISPATCH_REFUSED',
        outcome: null,
        detail: outcome.detail ?? 'no adapter serves this action type',
        actorId: EFFECT_CONSUMER,
      }).catch(() => undefined)
    }
    const messages = await this.effectMessages()
    await messages
      .update(outboxKeyOf(message.companyId, message.effectKey), current => ({
        ...current,
        backoffUntil: new Date(Date.now() + this.dispatchBackoffMs).toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      .catch(() => undefined)
  }

  /**
   * Record that an actor opened a restricted item (N3/N4). The audit trail is
   * the requirement, but a panel re-reading the same item must not flood it, so
   * one event per actor, item, and hour is kept. The row version does not move:
   * a read is not a command, and moving it would make every open tab stale.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @param detail - what the read was for (the panel's zone, if known).
   */
  async noteAccess(actor: BoardActor, id: FaberLoomBoardItemId, detail: string): Promise<void> {
    const record = await this.requireItem(id)
    await this.authorizeRead(record, actor)
    if (record.dataClass !== 'N3' && record.dataClass !== 'N4') return
    const hourAgo = Date.now() - 3_600_000
    const recent = record.events.some(event =>
      event.command === 'access'
      && event.actor === actor.id
      && Date.parse(event.at) >= hourAgo,
    )
    if (recent) return
    await this.serial(record.companyId, async () => {
      await (await this.items()).update(id, (current) => {
        const event = this.event({
          command: 'access',
          actor: actor.id,
          fromState: stateOf(current),
          toState: stateOf(current),
          revision: current.version,
          artifactHash: current.artifactHash,
          data: { detail },
        })
        return { ...current, events: [...current.events, event].slice(-this.eventCap) }
      })
    })
  }

  /**
   * The saved views of one identity, by name. A view stores only filters: it
   * never stores items or counts, so a shared item cannot leak through it.
   * @param actor - the owner whose views are read.
   * @returns the views, sorted by name.
   */
  async listViews(actor: BoardActor): Promise<readonly BoardView[]> {
    const table = await this.views()
    const views: BoardView[] = []
    for (const [, record] of table.entries()) {
      if (record.ownerId !== actor.id) continue
      views.push(toView(record))
    }
    return views.sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Save or replace one named view of the identity.
   * @param actor - the owner saving the view.
   * @param name - name the owner chose; empty names are refused.
   * @param filters - filters the view restores.
   * @returns the owner's views after the write.
   */
  async saveView(actor: BoardActor, name: string, filters: BoardViewFilters): Promise<readonly BoardView[]> {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new Error('faberloom: NAME_REQUIRED — a saved view needs a name')
    if (trimmed.length > 64) throw new Error('faberloom: NAME_INVALID — a saved view name is at most 64 characters')
    const table = await this.views()
    const key = viewKeyOf(actor.id, trimmed)
    const previous = table.get(key)
    const at = new Date().toISOString()
    await table.put(key, {
      ownerId: actor.id,
      name: trimmed,
      filters: {
        spaceId: filters.spaceId,
        accountRef: filters.accountRef,
        assigneeId: filters.assigneeId,
        severity: filters.severity,
        due: filters.due,
      },
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    })
    return await this.listViews(actor)
  }

  /**
   * Remove one named view of the identity.
   * @param actor - the owner removing the view.
   * @param name - name to remove.
   * @returns the owner's views after the write.
   */
  async removeView(actor: BoardActor, name: string): Promise<readonly BoardView[]> {
    await (await this.views()).delete(viewKeyOf(actor.id, name.trim()))
    return await this.listViews(actor)
  }

  /**
   * Everything one item's external effect looks like to the panel: the
   * reservation, the outbox message, the visible alerts, whether a dispatched
   * effect still awaits reconciliation, the action type, and the declaration of
   * the adapter that serves it.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the effect projection, or null when the item authorized none.
   */
  async effectStatus(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardEffectStatus | null> {
    const record = await this.requireItem(id)
    await this.authorizeRead(record, actor)
    const effectKey = record.effectKey
    if (effectKey === null) return null
    return await this.projectEffect(record, effectKey)
  }

  /**
   * The effect projection of one item whose key is known. A probe answers with
   * the same projection as a read, so the panel refreshes from one value.
   * @param record - the stored item.
   * @param effectKey - the effect the item authorized.
   * @returns the effect projection.
   */
  private async projectEffect(record: BoardItemRecord, effectKey: string): Promise<BoardEffectStatus> {
    const reservation = (await this.effectReservations()).get(reservationKeyOf(record.companyId, effectKey))
    const message = (await this.effectMessages()).get(outboxKeyOf(record.companyId, effectKey))
    const alerts: BoardEffectAlert[] = []
    for (const [, row] of (await this.effectAlerts()).entries()) {
      if (row.companyId !== record.companyId || row.effectKey !== effectKey) continue
      alerts.push(toAlert(row))
    }
    const actionType = reservation?.actionType ?? message?.actionType ?? null
    return {
      effectKey,
      actionType,
      reversalDeadline: record.reversalDeadline,
      executionOutcome: record.executionOutcome,
      reservation: reservation === undefined ? null : toReservation(reservation),
      message: message === undefined ? null : toMessage(message),
      alerts: alerts.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
      reconciliationOpen: reservation !== undefined && reservation.status === 'DESPACHADA',
      adapter: this.adapterStatusOf(actionType),
    }
  }

  /**
   * The declaration of the adapter that serves one action type, read from the
   * registry the dispatcher itself reads. A client therefore states the
   * destination's idempotency and probe support from the board instead of
   * keeping a list of its own (W-21).
   * @param actionType - action type of the effect, or null when none is known.
   * @returns the adapter status, or null when no adapter serves the type.
   */
  private adapterStatusOf(actionType: string | null): BoardEffectAdapterStatus | null {
    if (actionType === null) return null
    const adapter = this.adapters.get(actionType)
    if (adapter === undefined) return null
    return { actionType, idempotent: adapter.idempotent, probe: adapter.probe !== undefined }
  }

  /**
   * Reconcile a dispatched effect with what the destination reports.
   * `CONFIRMADO` closes the item as `EJECUTADO`; `FALLIDO` moves it to
   * `ERROR_RECUPERABLE` with that outcome, which is what makes a retry legal;
   * `DESCONOCIDO` records the attempt and leaves the item in its unknown state
   * (W-21, W-76).
   *
   * A reconciliation after an administrative close updates the outcome, raises
   * a visible alert, writes an audit event, and never reopens the item (W-85).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - the outcome the destination reported.
   * @returns the item after the reconciliation.
   */
  async reconcile(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReconcileInput): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    const current = await this.requireItem(id)
    this.authorizeOwnerOrAdmin(current, writer, 'settle the item')
    const effectKey = current.effectKey
    if (effectKey === null) throw new Error('faberloom: NO_EFFECT — the item holds no reserved effect')
    const held = (await this.effectReservations()).get(reservationKeyOf(current.companyId, effectKey))
    if (held === undefined) throw new Error('faberloom: NO_EFFECT — the item holds no reserved effect')
    const message = (await this.effectMessages()).get(outboxKeyOf(current.companyId, effectKey))
    const dispatched = held.status === 'DESPACHADA' || message?.status === 'DESPACHADO'
    if (!dispatched) throw new Error('faberloom: NO_EFFECT — the effect was never dispatched')
    const closed = held.closedAt !== null
    const late = closed && input.outcome !== 'DESCONOCIDO'
    const command = late ? 'effect.late_confirmation' : 'effect.reconciled'
    return await this.serial(current.companyId, async () => {
      const item = await this.commitItem(id, command, actor.id, record => this.outcomeRecord(record, {
        command,
        actorId: actor.id,
        outcome: input.outcome,
        detail: input.detail ?? null,
      }), {
        expectedRowVersion: input.expectedRowVersion,
        data: {
          effectKey,
          executionId: held.executionId,
          outcome: input.outcome,
          ref: input.ref ?? null,
          detail: input.detail ?? null,
          closed,
        },
      })
      await this.settleMessage(
        outboxKeyOf(current.companyId, effectKey),
        messageStatusFor(input.outcome),
        input.outcome === 'DESCONOCIDO' ? 'OUTCOME_UNKNOWN' : null,
        input.ref ?? null,
      )
      await this.settleReservation(reservationKeyOf(current.companyId, effectKey), input.outcome)
      if (late) {
        await this.raiseAlert({
          companyId: current.companyId,
          effectKey,
          itemId: id,
          executionId: held.executionId,
          kind: 'LATE_CONFIRMATION',
          outcome: input.outcome,
          detail: input.detail ?? null,
          actorId: actor.id,
        })
      }
      return item
    })
  }

  /**
   * Ask the destination what became of a dispatched effect and settle the
   * answer (§9.8). Only an adapter that declares `probe` can be asked; without
   * one the command writes nothing, so the operator keeps stating the outcome,
   * and the returned projection says so through `adapter.probe`. The answer is
   * one of the three outcomes the contract names: `CONFIRMADO` and `FALLIDO`
   * settle the effect, and `DESCONOCIDO` — including a throw, an abort, or the
   * dispatch timeout — records the attempt and leaves the item where it is
   * (W-21, W-76).
   *
   * The answer is settled through {@link reconcile}, so a probed outcome takes
   * the same audit event, alert, and reservation transition as an operator's.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - optimistic token.
   * @returns the effect projection after the answer.
   */
  async probeEffect(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRetryInput = {}): Promise<BoardEffectStatus> {
    const current = await this.requireItem(id)
    this.authorizeOwnerOrAdmin(current, writer, 'settle the item')
    const effectKey = current.effectKey
    if (effectKey === null) throw new Error('faberloom: NO_EFFECT — the item holds no reserved effect')
    const held = (await this.effectReservations()).get(reservationKeyOf(current.companyId, effectKey))
    if (held === undefined) throw new Error('faberloom: NO_EFFECT — the item holds no reserved effect')
    const adapter = this.adapters.get(held.actionType)
    const probe = adapter?.probe?.bind(adapter)
    if (probe !== undefined) {
      const message = (await this.effectMessages()).get(outboxKeyOf(current.companyId, effectKey))
      // A dispatched effect keeps its message; a reservation that outlived its
      // message still names the effect the destination deduped on.
      const dispatch: BoardEffectDispatch = message === undefined
        ? {
          effectKey,
          executionId: held.executionId,
          itemId: id,
          ownerId: current.ownerId,
          companyId: current.companyId,
          actionType: held.actionType,
          destination: held.destination,
          idempotencyKey: held.idempotencyKey,
          attempt: 0,
        }
        : this.dispatchOf(message, message.attempts, current.ownerId)
      const answer = await this.callAdapter((asked, options) => probe(asked, options), dispatch)
      await this.reconcile(writer, id, {
        ...input.expectedRowVersion === undefined ? {} : { expectedRowVersion: input.expectedRowVersion },
        outcome: answer.status,
        ...answer.ref === undefined ? {} : { ref: answer.ref },
        ...answer.detail === undefined ? {} : { detail: answer.detail },
      })
    }
    const item = await this.requireItem(id)
    return await this.projectEffect(item, effectKey)
  }

  /**
   * Retry a failed execution. The retry keeps the original `executionId`, the
   * same reservation, and the same idempotency key (W-84, W-77); it moves the
   * item back to `EJECUCION_PENDIENTE` so the consumer may emit it again.
   *
   * An unknown outcome is refused with `OUTCOME_UNKNOWN` unless the adapter of
   * that action type declares the destination idempotent, because a destination
   * that may already have the effect cannot be sent twice (W-21).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - optimistic token.
   * @returns the item in `EJECUCION_PENDIENTE`.
   */
  async retry(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardRetryInput = {}): Promise<FaberLoomBoardItem> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    const effectKey = current.effectKey
    if (effectKey === null) throw new Error('faberloom: NO_EFFECT — the item holds no effect to retry')
    const reservations = await this.effectReservations()
    const reservationKey = reservationKeyOf(current.companyId, effectKey)
    const held = reservations.get(reservationKey)
    if (held === undefined) throw new Error('faberloom: NO_EFFECT — the item holds no effect to retry')
    const state = stateOf(current)
    if (state !== 'ERROR_RECUPERABLE' && state !== 'DESCONOCIDO') {
      throw new Error('faberloom: NOT_RETRYABLE — only a failed execution can be retried')
    }
    const unknown = state === 'DESCONOCIDO'
      || current.executionOutcome === 'DESCONOCIDO'
      || held.outcome === 'DESCONOCIDO'
    const adapter = this.adapters.get(held.actionType)
    if (unknown && adapter?.idempotent !== true) {
      throw new Error(
        'faberloom: OUTCOME_UNKNOWN — the destination may hold the effect; reconcile it or declare it idempotent',
      )
    }
    return await this.serial(current.companyId, async () => {
      const now = new Date()
      const at = now.toISOString()
      const item = await this.mutate(writer, id, 'effect.retried', (record) => {
        const currentState = stateOf(record)
        if (currentState !== 'ERROR_RECUPERABLE' && currentState !== 'DESCONOCIDO') {
          throw new Error('faberloom: NOT_RETRYABLE — only a failed execution can be retried')
        }
        return {
          ...record,
          state: 'EJECUCION_PENDIENTE',
          status: 'in_progress',
          reversalDeadline: null,
          executionOutcome: null,
          stale: false,
          staleReason: null,
        }
      }, {
        expectedRowVersion: input.expectedRowVersion,
        data: { effectKey, executionId: held.executionId, idempotencyKey: held.idempotencyKey },
      })
      await reservations.update(reservationKey, record => ({
        ...record,
        status: 'RESERVADA',
        outcome: null,
        reversalDeadline: null,
        dispatchedAt: null,
        settledAt: null,
        updatedAt: at,
        retainUntil: retainUntilOf(this.effectConfig, now),
      }))
      const messageKey = outboxKeyOf(current.companyId, effectKey)
      const messages = await this.effectMessages()
      const previous = messages.get(messageKey)
      if (previous === undefined) {
        await messages.put(messageKey, {
          companyId: current.companyId,
          effectKey,
          executionId: held.executionId,
          itemId: id,
          actionType: held.actionType,
          destination: held.destination,
          idempotencyKey: held.idempotencyKey,
          status: 'PENDIENTE',
          dispatchable: true,
          attempts: 0,
          backoffUntil: null,
          reason: null,
          ref: null,
          createdAt: at,
          updatedAt: at,
          dispatchedAt: null,
          settledAt: null,
          retainUntil: retainUntilOf(this.effectConfig, now),
        })
      } else {
        await messages.update(messageKey, record => ({
          ...record,
          status: 'PENDIENTE',
          dispatchable: true,
          reason: null,
          ref: null,
          dispatchedAt: null,
          settledAt: null,
          updatedAt: at,
        }))
      }
      return item
    })
  }

  /**
   * Close an item administratively while its effect outcome is unknown: Owner
   * or Admin of the tenant, with a reason, and the reservation stays
   * `DESPACHADA` so the reconciliation remains open (D-9, W-65). A pending
   * candidate becomes a new linked item in the same command (W-86).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - optimistic token and the mandatory reason.
   * @returns the closed item and the item the candidate became.
   */
  async adminClose(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardAdminCloseInput,
  ): Promise<BoardAdminCloseResult> {
    const actor = this.actorOf(writer)
    const current = await this.requireItem(id)
    this.requireAdminClose(current, actor)
    const reason = input.reason.trim()
    if (reason.length === 0) {
      throw new Error('faberloom: REASON_REQUIRED — an administrative close needs a reason')
    }
    this.requireUnknownOutcome(current)
    return await this.serial(current.companyId, async () => {
      const latest = await this.requireItem(id)
      this.requireAdminClose(latest, actor)
      const candidate = latest.pendingCandidate
      const item = await this.commitItem(id, 'admin_close', actor.id, (record) => {
        this.requireAdminClose(record, actor)
        this.requireUnknownOutcome(record)
        return { ...record, state: 'DESCARTADO', status: 'completed', pendingCandidate: null }
      }, {
        expectedRowVersion: input.expectedRowVersion,
        reason,
        data: {
          effectKey: latest.effectKey,
          executionOutcome: latest.executionOutcome,
          candidateId: candidate?.id ?? null,
          candidateHash: candidate?.hash ?? null,
        },
      })
      await this.markReservationClosed(latest.companyId, latest.effectKey, actor.id, reason)
      const created = candidate === null ? null : await this.createFromCandidate(actor, id, latest, candidate)
      return { item, created }
    })
  }

  /**
   * The visible alerts of this tenant, newest first. A late confirmation after
   * an administrative close raises one, and the panel reads it here (W-85).
   * @param actor - the tenant the reader acts for.
   * @returns the alerts.
   */
  async alerts(actor: BoardActor): Promise<readonly BoardEffectAlert[]> {
    const tenant = actor.companyId ?? null
    const alerts: BoardEffectAlert[] = []
    for (const [, row] of (await this.effectAlerts()).entries()) {
      if (row.companyId !== tenant) continue
      alerts.push(toAlert(row))
    }
    return alerts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  /**
   * Delete settled effect records past their retention window. A reservation
   * that is still live and a message that was never settled are never pruned:
   * they carry a decision that a human may still need to see. Audit events of
   * effects no item names are pruned by the same window.
   * @param actor - the tenant the operator acts for.
   * @returns how many rows were removed.
   */
  async pruneEffects(actor: BoardActor): Promise<number> {
    const tenant = actor.companyId ?? null
    const now = Date.now()
    const expired = (retainUntil: string | null): boolean =>
      retainUntil !== null && Date.parse(retainUntil) <= now
    let removed = 0
    const reservations = await this.effectReservations()
    for (const [key, row] of [...reservations.entries()]) {
      if (row.companyId !== tenant || !reservationIsSettled(row.status) || !expired(row.retainUntil)) continue
      if (await reservations.delete(key)) removed += 1
    }
    const messages = await this.effectMessages()
    for (const [key, row] of [...messages.entries()]) {
      if (row.companyId !== tenant || row.status === 'PENDIENTE' || row.status === 'DESPACHADO') continue
      if (!expired(row.retainUntil)) continue
      if (await messages.delete(key)) removed += 1
    }
    const alerts = await this.effectAlerts()
    for (const [key, row] of [...alerts.entries()]) {
      if (row.companyId !== tenant) continue
      const limit = Date.parse(row.updatedAt) + this.effectConfig.retentionDays * 86_400_000
      if (limit > now) continue
      if (await alerts.delete(key)) removed += 1
    }
    const events = await this.effectEvents()
    for (const [key, row] of [...events.entries()]) {
      if (row.companyId !== tenant) continue
      const limit = Date.parse(row.at) + this.effectConfig.retentionDays * 86_400_000
      if (limit > now) continue
      if (await events.delete(key)) removed += 1
    }
    return removed
  }

  /**
   * Release the reservations no item reaches and no consumer can emit.
   *
   * An acceptance writes the reservation and its message before it commits the
   * item. A crash in between leaves a `RESERVADA` row whose key no item records:
   * `revert`, `reconcile`, and `pruneEffects` all need an item for it, so the key
   * would stay taken and every other execution of that effect would be refused
   * with `EFFECT_TAKEN`. A row older than `effectReservationLeaseMs` is released,
   * its message cancelled, an audit event stored, and an alert raised (D-12).
   *
   * A row whose key an item records is never swept, in whatever state: a failed
   * execution still needs its reservation to retry (W-84). A row younger than the
   * lease is left alone, because its acceptance may still be committing.
   * @param actor - the tenant the operator acts for.
   * @returns the released keys and the rows the sweep wrote.
   */
  async recoverOrphanedReservations(actor: BoardActor): Promise<BoardOrphanRecovery> {
    const tenant = actor.companyId ?? null
    return await this.serial(tenant, async () => {
      const now = new Date()
      const recorded = await this.recordedEffectKeys(tenant)
      const reservations = await this.effectReservations()
      const audit = await this.effectEvents()
      const released: string[] = []
      const events: BoardEffectEvent[] = []
      let alerts = 0
      for (const [, row] of [...reservations.entries()]) {
        if (row.companyId !== tenant || row.status !== 'RESERVADA') continue
        if (recorded.has(row.effectKey)) continue
        if (!reservationLeaseExpired(row.createdAt, this.effectConfig, now)) continue
        await this.cancelMessage(tenant, row.effectKey, 'ORPHANED_RESERVATION')
        if (!await this.releaseReservation(tenant, row.effectKey, 'orphaned-reservation')) continue
        const at = new Date().toISOString()
        const event: EffectEventRecord = {
          companyId: tenant,
          effectKey: row.effectKey,
          command: 'effect.orphaned',
          actor: actor.id,
          itemId: row.itemId,
          executionId: row.executionId,
          detail: { leaseMs: this.effectConfig.reservationLeaseMs, createdAt: row.createdAt },
          at,
        }
        await audit.put(effectEventKeyOf(tenant, row.effectKey, randomUUID()), event)
        await this.raiseAlert({
          companyId: tenant,
          effectKey: row.effectKey,
          itemId: row.itemId,
          executionId: row.executionId,
          kind: 'ORPHAN_RELEASED',
          outcome: null,
          detail: `the reservation outlived its ${this.effectConfig.reservationLeaseMs} ms lease`
            + ' and no item records its key',
          actorId: actor.id,
        })
        released.push(row.effectKey)
        events.push(event)
        alerts += 1
      }
      return { released, events, alerts }
    })
  }

  /**
   * Every effect key an item of one tenant records. An item keeps its key after
   * a failed or unknown outcome, so only a key no item records is unreachable.
   * @param companyId - the tenant to scan.
   * @returns the effect keys the tenant's items name.
   */
  private async recordedEffectKeys(companyId: string | null): Promise<Set<string>> {
    const keys = new Set<string>()
    for (const [, record] of (await this.items()).entries()) {
      if (record.companyId !== companyId || record.effectKey === null) continue
      keys.add(record.effectKey)
    }
    return keys
  }

  /**
   * Whether the reservation of one effect reached `CONCILIADA`, the only state in
   * which a confirmation settled the effect (contract §2).
   * @param companyId - tenant of the effect.
   * @param effectKey - the effect identity.
   * @returns true when a stored reservation of the key is conciliated.
   */
  private async reservationIsConciliated(companyId: string | null, effectKey: string): Promise<boolean> {
    const held = (await this.effectReservations()).get(reservationKeyOf(companyId, effectKey))
    return held !== undefined && held.status === 'CONCILIADA'
  }

  /**
   * Resolve the five components of the effect identity from the item and the
   * acceptance. The contract never omits the tenant, the business key, or the
   * artifact hash, so an item missing either of the last two is refused here
   * instead of producing a key over a hole; an action type outside the accepted
   * set is refused with `EFFECT_ACTION_UNKNOWN` before anything is hashed.
   * @param record - the item being accepted.
   * @param input - the execution identity the caller supplied.
   * @returns the resolved identity, including the derived idempotency key.
   */
  private requireEffectIdentity(
    record: BoardItemRecord,
    input: BoardExecutionInput,
  ): ResolvedEffect {
    if (input.actionType.trim().length === 0) {
      throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the execution needs an action type')
    }
    const actionType = this.requireAcceptedActionType(input.actionType)
    const executionId = input.executionId.trim()
    if (executionId.length === 0) {
      throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the execution needs an execution id')
    }
    if (record.businessKey === null || record.businessKey.trim().length === 0) {
      throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the item has no business key')
    }
    if (record.artifactHash === null || record.artifactHash.trim().length === 0) {
      throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the item has no artifact hash')
    }
    const destination = normaliseDestination(actionType, input.destination)
    const effectKey = effectKeyOf({
      tenantId: record.companyId,
      actionType,
      destination,
      businessKey: record.businessKey,
      artifactHash: record.artifactHash,
    })
    const submittedKey = (input.idempotencyKey ?? '').trim()
    const authorization = (input.authorization ?? '').trim()
    return {
      tenantId: record.companyId,
      actionType,
      destination,
      businessKey: record.businessKey,
      artifactHash: record.artifactHash,
      effectKey,
      executionId,
      idempotencyKey: submittedKey.length > 0 ? submittedKey : `effect:${effectKey}`,
      authorization: authorization.length > 0 ? authorization : null,
    }
  }

  /**
   * The recorded deadline of a delegated item. An item that is not delegated
   * carries no window (`NOT_DELEGATED`), and one delegated without a deadline is
   * refused outright (W-17).
   * @param record - the stored item.
   * @returns the ISO-8601 deadline.
   */
  private requireDelegatedDeadline(record: BoardItemRecord): string {
    if (stateOf(record) !== 'DELEGADO_EN_VENTANA') {
      throw new Error('faberloom: NOT_DELEGATED — only a delegated item carries a reversal window')
    }
    const deadline = record.reversalDeadline
    if (deadline === null) {
      throw new Error('faberloom: EFFECT_NO_DEADLINE — the delegated item records no reversal deadline')
    }
    return deadline
  }

  /**
   * The deadline of a delegated item whose window is over, so the effect may
   * leave. A window still ahead of the clock is refused with `WINDOW_OPEN`: the
   * window postpones the effect (D-4, W-19).
   * @param record - the stored item.
   * @param now - the server clock.
   * @returns the ISO-8601 deadline the window closed on.
   */
  private requireClosedWindow(record: BoardItemRecord, now: Date): string {
    const deadline = this.requireDelegatedDeadline(record)
    if (now.getTime() < Date.parse(deadline)) {
      throw new Error('faberloom: WINDOW_OPEN — the effect waits until its reversal deadline')
    }
    return deadline
  }

  /**
   * The record of one window expiry: the single transition revert and expiry
   * share, appended once (§3.2, W-18).
   * @param record - the delegated record.
   * @param deadline - the deadline it closed on.
   * @param actorId - identity the audit event names.
   * @returns the record in `EJECUCION_PENDIENTE`.
   */
  private expiredRecord(record: BoardItemRecord, deadline: string, actorId: string): BoardItemRecord {
    const event = this.event({
      command: 'window.expired',
      actor: actorId,
      fromState: 'DELEGADO_EN_VENTANA',
      toState: 'EJECUCION_PENDIENTE',
      revision: record.version,
      artifactHash: record.artifactHash,
      data: { effectKey: record.effectKey, reversalDeadline: deadline },
    })
    return {
      ...record,
      state: 'EJECUCION_PENDIENTE',
      status: 'in_progress',
      rowVersion: record.rowVersion + 1,
      events: [...record.events, event].slice(-this.eventCap),
      updatedAt: event.at,
    }
  }

  /**
   * The record of one reported outcome. A closed item keeps its state and only
   * gains the outcome, which is how a late confirmation never reopens it
   * (W-85); every other state follows the outcome (W-22).
   * @param record - the record at its queue slot.
   * @param input - the command, the actor, the outcome, and the detail.
   * @returns the record after the outcome.
   */
  private outcomeRecord(
    record: BoardItemRecord,
    input: {
      readonly command: string
      readonly actorId: string
      readonly outcome: BoardEffectOutcome
      readonly detail: string | null
    },
  ): BoardItemRecord {
    const state = stateOf(record)
    const closed = state === 'DESCARTADO' || state === 'SUSTITUIDO' || state === 'EJECUTADO'
    const target = stateForOutcome(input.outcome)
    const toState = closed ? state : target
    const event = this.event({
      command: input.command,
      actor: input.actorId,
      fromState: state,
      toState,
      revision: record.version,
      artifactHash: record.artifactHash,
      data: { outcome: input.outcome, detail: input.detail, closed },
    })
    return {
      ...record,
      state: toState,
      status: legacyStatusOf(toState),
      executionOutcome: input.outcome,
      rowVersion: record.rowVersion + 1,
      events: [...record.events, event].slice(-this.eventCap),
      updatedAt: event.at,
    }
  }

  /**
   * Refuse a command that needs an accepted, still-executing item.
   * @param record - the stored item.
   */
  private requireAcceptedExecution(record: BoardItemRecord): void {
    const state = stateOf(record)
    if (state !== 'EJECUCION_PENDIENTE' && state !== 'DELEGADO_EN_VENTANA') {
      throw new Error('faberloom: NO_EFFECT — the item holds no accepted execution')
    }
    if (record.effectKey === null) {
      throw new Error('faberloom: NO_EFFECT — the item holds no effect key')
    }
  }

  /**
   * The control verdict of a dispatch revalidation: null when the effect may
   * leave, or the stable reason it may not.
   * @param record - the record under review.
   * @param id - item id.
   * @returns the failure detail, or null.
   */
  private async revalidateForDispatch(record: BoardItemRecord, id: FaberLoomBoardItemId): Promise<string | null> {
    const report = await this.evaluateChecks(record, id)
    try {
      this.requireChecksPassable(report, this.confirmationsOf(record))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * The confirmations the last acceptance recorded, so a revalidation does not
   * count a `confirmacion` failure the human already accepted as new (W-75).
   * @param record - the stored item.
   * @returns the control ids the acceptance confirmed.
   */
  private confirmationsOf(record: BoardItemRecord): string[] {
    for (let index = record.events.length - 1; index >= 0; index -= 1) {
      const event = record.events[index]
      if (event === undefined) continue
      if (event.command !== 'approve' && event.command !== 'approve_with_edits' && event.command !== 'effect.accepted') {
        continue
      }
      const confirmed = event.data?.['confirmed']
      if (!Array.isArray(confirmed)) return []
      return confirmed.filter((entry): entry is string => typeof entry === 'string')
    }
    return []
  }

  /**
   * Invalidate one acceptance because its controls no longer pass: the item
   * returns to the pending column with no effect key, and the caller releases
   * the reservation and cancels the message (W-75, W-95).
   * @param record - the item as the revalidation read it.
   * @param id - item id.
   * @param actorId - identity the audit event names.
   * @param detail - the failed control.
   * @param expectedRowVersion - the row the controls evaluated.
   * @returns the item back in `PENDIENTE_CRITERIO`.
   */
  private async invalidateAcceptance(
    record: BoardItemRecord,
    id: FaberLoomBoardItemId,
    actorId: string,
    detail: string,
    expectedRowVersion: number,
  ): Promise<FaberLoomBoardItem> {
    return await this.commitItem(id, 'effect.revalidation_failed', actorId, (current) => {
      this.requireAcceptedExecution(current)
      return {
        ...current,
        state: 'PENDIENTE_CRITERIO',
        status: 'waiting_approval',
        approvedRevision: null,
        effectKey: null,
        reversalDeadline: null,
        executionOutcome: null,
        stale: false,
        staleReason: null,
      }
    }, {
      expectedRowVersion,
      data: { effectKey: record.effectKey, detail },
    })
  }

  /**
   * Emit one effect for its tenant. Everything up to the claim runs inside the
   * tenant section; the adapter call does not, because it is the external
   * boundary the outbox exists for.
   * @param actor - the tenant the consumer acts for.
   * @param messageKey - outbox row key.
   * @param effectKey - the effect identity.
   * @returns what the attempt produced.
   */
  private async dispatchOne(
    actor: BoardActor,
    messageKey: string,
    effectKey: string,
  ): Promise<BoardDispatchOutcome> {
    const messages = await this.effectMessages()
    const message = messages.get(messageKey)
    if (message === undefined) throw new Error(`faberloom: NOT_FOUND — outbox message ${effectKey} not found`)
    if (!messageIsDispatchable(message.status, message.dispatchable)) {
      return refusal('OUTBOX_NOT_PENDING', null, `the message is ${message.status}`)
    }
    const id = brandString<FaberLoomBoardItemId>(message.itemId)
    let record = (await this.items()).get(id)
    if (record === undefined) {
      await this.settleMessage(messageKey, 'CANCELADO', 'ITEM_MISSING')
      return refusal('ITEM_MISSING', null, `board item ${message.itemId} is gone`)
    }
    const now = new Date()
    if (stateOf(record) === 'DELEGADO_EN_VENTANA') {
      const deadline = record.reversalDeadline
      if (deadline === null) {
        await this.settleMessage(messageKey, 'CANCELADO', 'EFFECT_NO_DEADLINE')
        await this.releaseReservation(message.companyId, effectKey, 'no-deadline')
        return refusal('NOT_AUTHORIZED', toItem(id, record), 'the delegated item records no reversal deadline')
      }
      if (now.getTime() < Date.parse(deadline)) {
        return refusal('WINDOW_OPEN', toItem(id, record), 'the reversal window postpones the effect')
      }
      const expired = await this.expireForDispatch(id, actor.id, now).catch(() => undefined)
      const latest = expired ?? (await this.items()).get(id)
      if (latest === undefined) {
        await this.settleMessage(messageKey, 'CANCELADO', 'ITEM_MISSING')
        return refusal('ITEM_MISSING', null, `board item ${message.itemId} is gone`)
      }
      record = latest
    }
    const state = stateOf(record)
    if (state !== 'EJECUCION_PENDIENTE') {
      await this.settleMessage(messageKey, 'CANCELADO', 'NOT_AUTHORIZED')
      await this.releaseReservation(message.companyId, effectKey, 'not-authorized')
      return refusal('NOT_AUTHORIZED', toItem(id, record), `the item is ${state}`)
    }
    const reservations = await this.effectReservations()
    const reservationKey = reservationKeyOf(message.companyId, effectKey)
    const reservation = reservations.get(reservationKey)
    if (reservation === undefined
      || reservation.status !== 'RESERVADA'
      || reservation.executionId !== message.executionId
      || reservation.itemId !== message.itemId) {
      await this.settleMessage(messageKey, 'CANCELADO', 'RESERVATION_RELEASED')
      return refusal('NOT_AUTHORIZED', toItem(id, record), 'the reservation is not RESERVADA for this execution')
    }
    const failure = await this.revalidateForDispatch(record, id)
    const latest = (await this.items()).get(id)
    if (latest === undefined || latest.rowVersion !== record.rowVersion) {
      return refusal(
        'STALE_REVALIDATION',
        latest === undefined ? null : toItem(id, latest),
        'the item moved while its controls ran',
      )
    }
    if (failure !== null) {
      const item = await this.invalidateAcceptance(record, id, actor.id, failure, record.rowVersion)
      await this.cancelMessage(message.companyId, effectKey, 'REVALIDATION_FAILED')
      await this.releaseReservation(message.companyId, effectKey, 'revalidation-failed')
      return refusal('REVALIDATION_FAILED', item, failure)
    }
    const adapter = this.adapters.get(reservation.actionType)
    if (adapter === undefined) {
      return refusal('EFFECT_NO_ADAPTER', toItem(id, record), `no adapter for ${reservation.actionType}`)
    }

    const at = new Date().toISOString()
    const attempt = message.attempts + 1
    // The message is the dispatch gate: claiming it first means a crash after
    // the claim can never emit the effect twice. The reservation follows it.
    await messages.update(messageKey, (current) => {
      if (!messageIsDispatchable(current.status, current.dispatchable)) {
        throw new Error('faberloom: OUTBOX_NOT_PENDING — the message stopped being dispatchable')
      }
      return {
        ...current,
        status: 'DESPACHADO',
        dispatchable: false,
        attempts: current.attempts + 1,
        reason: null,
        dispatchedAt: at,
        updatedAt: at,
      }
    })
    await reservations.update(reservationKey, (current) => {
      if (current.status !== 'RESERVADA') {
        throw new Error('faberloom: NOT_AUTHORIZED — the reservation is no longer live')
      }
      return { ...current, status: 'DESPACHADA', dispatchedAt: at, updatedAt: at }
    })

    const result = await this.sendEffect(adapter, message, attempt, record.ownerId)
    const item = await this.commitItem(id, effectCommandFor(result.status), actor.id, current =>
      this.outcomeRecord(current, {
        command: effectCommandFor(result.status),
        actorId: actor.id,
        outcome: result.status,
        detail: result.detail ?? null,
      }))
    await this.settleMessage(
      messageKey,
      messageStatusFor(result.status),
      result.status === 'DESCONOCIDO' ? 'OUTCOME_UNKNOWN' : null,
      result.ref ?? null,
    )
    await this.settleReservation(reservationKey, result.status)
    return {
      dispatched: true,
      code: 'DISPATCHED',
      item,
      outcome: result.status,
      detail: result.detail ?? null,
    }
  }

  /**
   * The dispatch identity one outbox row names.
   * @param message - the stored message.
   * @param attempt - one-based attempt count.
   * @returns the message an adapter receives.
   */
  private dispatchOf(message: EffectOutboxRecord, attempt: number, ownerId: string): BoardEffectDispatch {
    return {
      effectKey: message.effectKey,
      executionId: message.executionId,
      itemId: message.itemId,
      ownerId,
      companyId: message.companyId,
      actionType: message.actionType,
      destination: message.destination,
      idempotencyKey: message.idempotencyKey,
      attempt,
    }
  }

  /**
   * Call one adapter under the configured dispatch timeout. A throw, an aborted
   * signal, or an expired timeout is `DESCONOCIDO`: the board cannot claim an
   * effect it did not confirm (W-22).
   * @param call - the adapter method, sent or probed.
   * @param dispatch - the message identity it receives.
   * @returns what the destination reported.
   */
  private async callAdapter(
    call: (dispatch: BoardEffectDispatch, options: { readonly signal: AbortSignal }) => Promise<BoardEffectResult>,
    dispatch: BoardEffectDispatch,
  ): Promise<BoardEffectResult> {
    const controller = new AbortController()
    const timeoutMs = this.effectConfig.dispatchTimeoutMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<BoardEffectResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve({ status: 'DESCONOCIDO', detail: 'TIMEOUT' })
      }, timeoutMs)
    })
    const answered = call(dispatch, { signal: controller.signal }).catch((error: unknown): BoardEffectResult => ({
      status: 'DESCONOCIDO',
      detail: error instanceof Error ? error.message : String(error),
    }))
    try {
      return await Promise.race([answered, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Emit one effect through its adapter.
   * @param adapter - the registered adapter.
   * @param message - the stored message.
   * @param attempt - one-based attempt count.
   * @returns what the destination reported.
   */
  private async sendEffect(
    adapter: BoardEffectAdapter,
    message: EffectOutboxRecord,
    attempt: number,
    ownerId: string,
  ): Promise<BoardEffectResult> {
    return await this.callAdapter((dispatch, options) => adapter.send(dispatch, options), this.dispatchOf(message, attempt, ownerId))
  }

  /**
   * Commit the window expiry the consumer needs before it may emit. A concurrent
   * revert or expiry makes the update refuse; the caller re-reads the item.
   * @param id - item id.
   * @param actorId - identity the audit event names.
   * @param now - the server clock.
   * @returns the record in `EJECUCION_PENDIENTE`.
   */
  private async expireForDispatch(
    id: FaberLoomBoardItemId,
    actorId: string,
    now: Date,
  ): Promise<BoardItemRecord> {
    const items = await this.items()
    let next: BoardItemRecord | undefined
    await items.update(id, (current) => {
      const deadline = this.requireClosedWindow(current, now)
      next = this.expiredRecord(current, deadline, actorId)
      return next
    })
    if (next === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} disappeared during the window expiry`)
    return next
  }

  /**
   * Cancel one message before the effect leaves: the reservation is released in
   * the same command, so a CANCELADO message is never dispatchable (W-56, W-102).
   * A message that already left is left alone.
   * @param companyId - tenant of the effect.
   * @param effectKey - the effect identity, or null when the item holds none.
   * @param reason - stable reason the message stopped being dispatchable.
   * @returns whether a message was cancelled.
   */
  private async cancelMessage(companyId: string | null, effectKey: string | null, reason: string): Promise<boolean> {
    if (effectKey === null) return false
    const key = outboxKeyOf(companyId, effectKey)
    const table = await this.effectMessages()
    const record = table.get(key)
    if (record === undefined || record.status !== 'PENDIENTE') return false
    const at = new Date().toISOString()
    await table.update(key, current => ({
      ...current,
      status: 'CANCELADO',
      dispatchable: false,
      reason,
      updatedAt: at,
      settledAt: at,
    }))
    return true
  }

  /**
   * Release one reservation that has not been dispatched. A synthetic release
   * of an already dispatched effect is refused by returning false: only
   * reconciliation settles that one.
   * @param companyId - tenant of the effect.
   * @param effectKey - the effect identity, or null when the item holds none.
   * @param reason - stable reason of the release.
   * @returns whether a reservation was released.
   */
  private async releaseReservation(companyId: string | null, effectKey: string | null, reason: string): Promise<boolean> {
    if (effectKey === null) return false
    const key = reservationKeyOf(companyId, effectKey)
    const table = await this.effectReservations()
    const record = table.get(key)
    if (record === undefined || record.status !== 'RESERVADA') return false
    const at = new Date().toISOString()
    await table.update(key, current => ({
      ...current,
      status: 'LIBERADA',
      releasedAt: at,
      releaseReason: reason,
      settledAt: at,
      updatedAt: at,
    }))
    return true
  }

  /**
   * Cancel the scheduled execution of an item that stops being the live one:
   * the message first, then the reservation (W-56).
   * @param companyId - tenant of the effect.
   * @param effectKey - the effect identity, or null.
   * @param reason - stable reason of the release.
   */
  private async releaseScheduledExecution(
    companyId: string | null,
    effectKey: string | null,
    reason: string,
  ): Promise<void> {
    if (effectKey === null) return
    await this.cancelMessage(companyId, effectKey, reason)
    await this.releaseReservation(companyId, effectKey, reason)
  }

  /**
   * Move one message to its reported state.
   * @param key - outbox row key.
   * @param status - the state to store.
   * @param reason - stable reason, or null when none applies.
   * @param ref - destination reference, or null.
   */
  private async settleMessage(
    key: string,
    status: BoardOutboxStatus,
    reason: string | null,
    ref: string | null = null,
  ): Promise<void> {
    const table = await this.effectMessages()
    if (table.get(key) === undefined) return
    const at = new Date().toISOString()
    await table.update(key, current => ({
      ...current,
      status,
      dispatchable: status === 'PENDIENTE',
      reason,
      ref,
      updatedAt: at,
      settledAt: status === 'PENDIENTE' || status === 'DESPACHADO' ? current.settledAt : at,
    }))
  }

  /**
   * Record the outcome one reservation settles on. `DESCONOCIDO` keeps the
   * reservation dispatched, so the effect stays open for reconciliation.
   * @param key - reservation row key.
   * @param outcome - the reported outcome.
   */
  private async settleReservation(key: string, outcome: BoardEffectOutcome): Promise<void> {
    const table = await this.effectReservations()
    if (table.get(key) === undefined) return
    const at = new Date().toISOString()
    await table.update(key, current => outcome === 'DESCONOCIDO'
      ? { ...current, outcome, updatedAt: at }
      : { ...current, status: 'CONCILIADA', outcome, settledAt: at, updatedAt: at })
  }

  /**
   * Record that a human closed the item administratively: the reservation keeps
   * its state, so the reconciliation stays open and a competing execution keeps
   * being refused (W-65, W-84).
   * @param companyId - tenant of the effect.
   * @param effectKey - the effect identity, or null.
   * @param actorId - identity that closed the item.
   * @param reason - the reason it recorded.
   */
  private async markReservationClosed(
    companyId: string | null,
    effectKey: string | null,
    actorId: string,
    reason: string,
  ): Promise<void> {
    if (effectKey === null) return
    const key = reservationKeyOf(companyId, effectKey)
    const table = await this.effectReservations()
    if (table.get(key) === undefined) return
    const at = new Date().toISOString()
    await table.update(key, current => ({
      ...current, closedAt: at, closedBy: actorId, closeReason: reason, updatedAt: at,
    }))
  }

  /**
   * Raise one visible alert for an effect, or update the one it already holds.
   * A late confirmation after an administrative close raises
   * `LATE_CONFIRMATION` (W-85); the recovery sweep raises `ORPHAN_RELEASED`.
   * @param input - the effect, the alert class, its outcome, and the identity that acted.
   */
  private async raiseAlert(input: {
    readonly companyId: string | null
    readonly effectKey: string
    readonly itemId: string
    readonly executionId: string
    readonly kind: BoardEffectAlertKind
    readonly outcome: BoardEffectOutcome | null
    readonly detail: string | null
    readonly actorId: string
  }): Promise<void> {
    const key = alertKeyOf(input.companyId, input.effectKey)
    const table = await this.effectAlerts()
    const previous = table.get(key)
    const at = new Date().toISOString()
    const record: EffectAlertRecord = {
      companyId: input.companyId,
      effectKey: input.effectKey,
      itemId: input.itemId,
      executionId: input.executionId,
      kind: input.kind,
      outcome: input.outcome,
      detail: input.detail,
      actor: input.actorId,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    }
    if (previous === undefined) await table.put(key, record)
    else await table.update(key, () => record)
  }

  /**
   * Refuse a write unless the actor owns the item or administers its tenant.
   * The administrative close and the reconciliation that settles a closed
   * effect accept both (D-9, W-65); the tenant must match in every case.
   * @param record - the stored item.
   * @param writer - the acting identity.
   * @param action - what the caller is about to do, for the refusal message.
   */
  private authorizeOwnerOrAdmin(record: BoardItemRecord, writer: BoardWriter, action: string): void {
    const actor = this.actorOf(writer)
    if ((actor.companyId ?? null) !== record.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
    if (record.ownerId === actor.id || actor.role === 'admin') return
    throw new Error(`faberloom: NO_ACCESS — only the owner or an administrator of the tenant may ${action}`)
  }

  /**
   * Refuse an administrative close by anyone but the owner or a tenant
   * administrator, or across tenants.
   * @param record - the stored item.
   * @param actor - the acting identity.
   */
  private requireAdminClose(record: BoardItemRecord, actor: BoardActor): void {
    this.authorizeOwnerOrAdmin(record, actor, 'close the item')
  }

  /**
   * Refuse an administrative close of an item whose outcome is known: only an
   * unknown effect needs it (D-9, W-65).
   * @param record - the stored item.
   */
  private requireUnknownOutcome(record: BoardItemRecord): void {
    const unknown = stateOf(record) === 'DESCONOCIDO'
      || (stateOf(record) === 'ERROR_RECUPERABLE' && record.executionOutcome === 'DESCONOCIDO')
    if (!unknown) {
      throw new Error('faberloom: OUTCOME_KNOWN — only an item with an unknown effect outcome can be closed')
    }
  }

  /**
   * Turn the pending candidate of an administratively closed item into a new
   * item linked to it, claiming the business key the closed item released
   * (W-86). The candidate carries the artifact hash the user saw.
   * @param actor - identity that closes the item.
   * @param closed - record of the item being closed.
   * @param candidate - the candidate it held.
   * @returns the new item.
   */
  private async createFromCandidate(
    actor: BoardActor,
    closedId: FaberLoomBoardItemId,
    closed: BoardItemRecord,
    candidate: BoardCandidate,
  ): Promise<FaberLoomBoardItem> {
    const evidence = candidate.evidence.length > 0
      ? [...candidate.evidence]
      : requireEvidence(closed.revisions[closed.revisions.length - 1]?.evidence)
    const id = brandString<FaberLoomBoardItemId>(randomUUID())
    const base = await this.buildRecord(actor, {
      title: candidate.summary.slice(0, 80),
      summary: candidate.summary,
      evidence,
      artifactType: closed.artifactType,
      supersedesItemId: closedId,
      ...closed.companyId === null ? {} : { companyId: closed.companyId },
      ...closed.spaceId === null ? {} : { spaceId: closed.spaceId },
      ...closed.businessKey === null ? {} : { businessKey: closed.businessKey },
      ...closed.sourceRef === null ? {} : { sourceRef: closed.sourceRef },
      ...closed.accountRef === null ? {} : { accountRef: closed.accountRef },
    })
    // The successor is the same artifact, so it keeps the class settled for the
    // closed item instead of re-deriving it from a type alone.
    const record: BoardItemRecord = {
      ...base,
      dataClass: closed.dataClass,
      dataClassProvisional: closed.dataClassProvisional,
      severity: closed.severity,
      severitySource: closed.severitySource,
      severityConfidence: closed.severityConfidence,
      artifactHash: candidate.hash,
    }
    const businessKey = record.businessKey
    if (businessKey !== null) await this.claimKey(closed.companyId, 'bkey', businessKey, id)
    try {
      await (await this.items()).put(id, record)
    } catch (error) {
      if (businessKey !== null) await this.release(closed.companyId, 'bkey', businessKey)
      throw error
    }
    return toItem(id, record)
  }

  /**
   * Read the audit history of one item.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the events, oldest first.
   */
  async events(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardEvent[]> {
    const record = await this.requireItem(id)
    await this.authorizeRead(record, actor)
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
   * Complete an approved item that carries no live effect.
   *
   * An item that accepted an execution closes through its reconciliation, never
   * through this command: it is refused with `EFFECT_NOT_CONCILIATED` unless the
   * reservation of its `effectKey` is `CONCILIADA` (W-84). An item that never had
   * an effect keeps the legacy path around `complete`.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async complete(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    const effectKey = record.effectKey
    if (effectKey !== null && !await this.reservationIsConciliated(record.companyId, effectKey)) {
      throw new Error(
        'faberloom: EFFECT_NOT_CONCILIATED — an item with a reserved effect closes through its reconciliation',
      )
    }
    return await this.mutate(writer, id, 'complete', (current) => {
      if (stateOf(current) !== 'APROBADO') throw new Error('faberloom: NO_ACCESS — item is not approved')
      if (current.effectKey !== effectKey) {
        throw new Error('faberloom: STALE_ROW — the item effect changed since it was read')
      }
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
   * Set the definitive data class of an item, for governance. Raising the class
   * invalidates the tenant's classification cache, because an answer computed
   * under the old class context must not be reused (W-94); the projections are
   * derived live, so they redact on the next read without another write.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param dataClass - class to settle.
   * @returns the item with its definitive class.
   */
  async reclassify(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    dataClass: BoardDataClass,
  ): Promise<FaberLoomBoardItem> {
    const current = await this.requireItem(id)
    this.authorizeWrite(current, writer)
    if (TERMINAL.includes(stateOf(current))) {
      throw new Error('faberloom: NO_ACCESS — a closed item cannot be reclassified')
    }
    const order: readonly BoardDataClass[] = ['N0', 'N1', 'N2', 'N3', 'N4']
    const raised = order.indexOf(dataClass) > order.indexOf(current.dataClass)
    const item = await this.mutate(writer, id, 'reclassify', record => ({
      ...record,
      dataClass,
      dataClassProvisional: false,
    }), { data: { from: current.dataClass, to: dataClass, raised } })
    if (raised) await this.purgeClassificationCache(current.companyId)
    return item
  }

  /**
   * Drop the classification answers of one tenant. Used when a definitive class
   * changes the context an answer was computed in (W-94).
   * @param companyId - tenant whose entries go, or null for the single-tenant store.
   */
  private async purgeClassificationCache(companyId: string | null): Promise<void> {
    const table = await (await this.domain()).table('classification_cache')
    for (const [key, entry] of [...table.entries()]) {
      if (entry.companyId !== companyId) continue
      await table.delete(key)
    }
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
   * Record an effect on an item that never had a reserved one. Approval never
   * sends: an explicit authorization is required, and a stale or unapproved item
   * refuses.
   *
   * An item that carries an `effectKey` is refused with `EFFECT_VIA_OUTBOX`: its
   * effect has a reservation and a message, so it is recorded by the consumer's
   * outcome, and this path would bypass `EFFECT_TAKEN` (W-84).
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
      if (current.effectKey !== null) {
        throw new Error(
          'faberloom: EFFECT_VIA_OUTBOX — an item with a reserved effect records it through the outbox',
        )
      }
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
   * Refuse a read the actor may not make. The tenant rule comes first; an item
   * without a space stays owner-only, and an item inside a space is readable by
   * whoever the Spaces service lets read that space (owner, member, admin, or a
   * `view` grant). That is W-23: no scope, no read, no count, no list.
   * @param record - the stored item.
   * @param actor - the authenticated reader.
   */
  private async authorizeRead(record: BoardItemRecord, actor: BoardActor): Promise<void> {
    if (record.companyId !== null && record.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
    if (record.ownerId === actor.id) return
    if (record.spaceId === null || !await this.spaceReadable(record.spaceId, actor)) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another owner')
    }
  }

  /**
   * Whether the actor may read one Space. The Spaces service owns the rule
   * (owner, member, admin, or a `view` grant); a composition without that
   * service grants nothing, so no read widens by accident.
   * @param spaceId - the space the item belongs to.
   * @param actor - the authenticated reader.
   * @returns true when the space is readable.
   */
  private async spaceReadable(spaceId: string, actor: BoardActor): Promise<boolean> {
    const spaces = this.ctx.get('faberloomSpaces') as {
      get(actor: { id: string; companyId?: string | undefined; role?: string; readOnly?: boolean }, id: string): Promise<unknown>
    } | undefined
    if (spaces === undefined) return false
    try {
      await spaces.get({ id: actor.id, companyId: actor.companyId, role: actor.role ?? 'client_b2b', readOnly: true }, spaceId)
      return true
    } catch {
      return false
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
    await this.authorizeRead(record, actor)
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
    // One Space lookup per distinct space: a member's queue may hold hundreds of
    // items from the same space, and W-23 asks for scope, not per-row calls.
    const readable = new Map<string, boolean>()
    for (const [id, record] of (await this.items()).entries()) {
      if (record.companyId !== null && record.companyId !== actor.companyId) continue
      if (record.ownerId !== actor.id) {
        if (record.spaceId === null) continue
        let allowed = readable.get(record.spaceId)
        if (allowed === undefined) {
          allowed = await this.spaceReadable(record.spaceId, actor)
          readable.set(record.spaceId, allowed)
        }
        if (!allowed) continue
      }
      if (filter.status !== undefined && record.status !== filter.status) continue
      if (filter.state !== undefined && stateOf(record) !== filter.state) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      out.push(toItem(id, record))
    }
    return orderBoardItems(out)
  }
}

export default FaberLoomBoard
