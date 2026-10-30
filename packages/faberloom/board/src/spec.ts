/**
 * The board domain declaration: the item record schema, the key-claim table,
 * and the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-board/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomBoardItemId } from './types.ts'

/** Durable revision. */
const revisionRecord = z.object({
  version: z.number(),
  summary: z.string(),
  evidence: z.array(z.string()),
  /** Editable artifact content; null in revisions written before the draft carried content. */
  content: z.record(z.string(), z.unknown()).nullable().default(null),
  documentRef: z.string().nullable(),
  at: z.string(),
})

/** Durable review. */
const reviewRecord = z.object({
  decision: z.union([z.literal('approve'), z.literal('reject')]),
  version: z.number(),
  note: z.string().nullable(),
  at: z.string(),
})

/** Durable effect. */
const effectRecord = z.object({
  ref: z.string(),
  detail: z.string().nullable(),
  authorization: z.string().nullable(),
  at: z.string(),
})

/** Durable audit event. */
const eventRecord = z.object({
  id: z.string(),
  command: z.string(),
  actor: z.string(),
  fromState: z.string().nullable(),
  toState: z.string(),
  revision: z.number().nullable(),
  artifactHash: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
})

/** Durable candidate. */
const candidateRecord = z.object({
  id: z.string(),
  hash: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
  at: z.string(),
})

/**
 * Durable origin of one editable field: `source: null` means the field has no
 * origin (a human wrote it), which is the explicit mark W-36 requires.
 */
const fieldOriginRecord = z.object({
  field: z.string(),
  source: z.string().nullable(),
  ref: z.string().nullable(),
  at: z.string().nullable(),
})

/** Durable board item record. */
export const boardItemRecord = z.object({
  ownerId: z.string(),
  /** Company scope; absent in records written before tenant scoping, and in single-tenant deployments. */
  companyId: z.string().nullable().default(null),
  spaceId: z.string().nullable(),
  /** Routine this task feeds, or null when it is standalone. */
  routineId: z.string().nullable().default(null),
  /** Catalog agent responsible for the item, or null when none is assigned (D-1). */
  assigneeId: z.string().nullable().default(null),
  /** Action type the item decides or executes; the autonomy unit reads it. */
  actionType: z.string().default('mesa.decide'),
  title: z.string(),
  status: z.union([
    z.literal('in_progress'), z.literal('waiting_data'), z.literal('waiting_approval'), z.literal('approved'),
    z.literal('completed'), z.literal('failed'), z.literal('reopened'), z.literal('needs_review'),
  ]),
  /** Persisted WorkLoom state; null only in records written before E10. */
  state: z.string().nullable().default(null),
  /** Optimistic concurrency token. */
  rowVersion: z.number().default(1),
  severity: z.union([z.literal('LOW'), z.literal('MEDIUM'), z.literal('HIGH'), z.literal('CRITICAL')]).nullable().default(null),
  severitySource: z.union([z.literal('RULE'), z.literal('LLM'), z.literal('HUMAN')]).nullable().default(null),
  severityConfidence: z.number().nullable().default(null),
  dueAt: z.string().nullable().default(null),
  valueAmount: z.number().nullable().default(null),
  valueCurrency: z.string().nullable().default(null),
  valueUsd: z.number().nullable().default(null),
  /** Rate, source, and date used to reach `valueUsd` (D-3). */
  valueFxRate: z.number().nullable().default(null),
  valueFxSource: z.string().nullable().default(null),
  valueFxDate: z.string().nullable().default(null),
  dataClass: z.union([z.literal('N0'), z.literal('N1'), z.literal('N2'), z.literal('N3'), z.literal('N4')]).default('N2'),
  dataClassProvisional: z.boolean().default(true),
  runId: z.string().nullable().default(null),
  idempotencyKey: z.string().nullable().default(null),
  businessKey: z.string().nullable().default(null),
  /** Source reference the business key hashes. */
  sourceRef: z.string().nullable().default(null),
  supersedesItemId: z.string().nullable().default(null),
  artifactType: z.string().default(''),
  accountRef: z.string().nullable().default(null),
  artifactHash: z.string().nullable().default(null),
  /** Origins the run declared for the fields of its content; the item projects one entry per field. */
  fieldOrigins: z.array(fieldOriginRecord).default([]),
  /**
   * Questions the classifier left open when it could not decide confidently.
   * A human correction clears them; the panel shows them as the agent's doubts.
   */
  doubts: z.array(z.string()).default([]),
  pendingCandidate: candidateRecord.nullable().default(null),
  events: z.array(eventRecord).default([]),
  discardReason: z.string().nullable().default(null),
  discardNote: z.string().nullable().default(null),
  iterationId: z.string().nullable().default(null),
  iterationDraftKey: z.string().nullable().default(null),
  iterationLockUntil: z.string().nullable().default(null),
  iterationLockGeneration: z.number().default(0),
  /** Artifact version the current attempt started from (§9.7.1). */
  iterationBaseVersion: z.number().nullable().default(null),
  /** Tab session holding the current attempt; the attempt, not the user, is the lock subject. */
  iterationLockBy: z.string().nullable().default(null),
  /** Applied iteration rounds; the panel suggests a rewrite at the configured limit (D-10). */
  iterationRoundCount: z.number().default(0),
  /** Effect key of the accepted execution (E15), or null when nothing was authorized. */
  effectKey: z.string().nullable().default(null),
  /** Instant the delegated reversal window closes, or null outside it (W-17, W-19). */
  reversalDeadline: z.string().nullable().default(null),
  /** Last reported external outcome, or null while none was reported (W-22). */
  executionOutcome: z.union([
    z.literal('CONFIRMADO'), z.literal('FALLIDO'), z.literal('DESCONOCIDO'),
  ]).nullable().default(null),
  version: z.number(),
  revisions: z.array(revisionRecord),
  approvedRevision: z.number().nullable(),
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  effects: z.array(effectRecord),
  reviews: z.array(reviewRecord),
  executionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored board item, inferred from {@link boardItemRecord}. */
export type BoardItemRecord = z.infer<typeof boardItemRecord>

/** One claimed idempotency or business key. */
export const boardKeyRecord = z.object({
  /** Item that owns the claim. */
  itemId: z.string(),
  /** Claim kind: `idem` or `bkey`. */
  kind: z.string(),
  /** ISO-8601 claim instant. */
  at: z.string(),
})

/** One stored key claim. */
export type BoardKeyRecord = z.infer<typeof boardKeyRecord>

/**
 * One tenant claim on an opaque reference (`runId`, `executionId`, or
 * `accountRef`). The board cannot ask another service who owns an opaque id, so
 * the first item that stores it records the tenant that may keep using it; a
 * later item of another tenant is rejected with `CROSS_TENANT_REFERENCE`.
 */
export const boardReferenceRecord = z.object({
  /** Tenant that claimed the reference; null is the single-tenant deployment. */
  companyId: z.string().nullable(),
  /** Reference kind: `run`, `execution`, or `account`. */
  kind: z.string(),
  /** The referenced value. */
  value: z.string(),
  /** Item that first stored the reference. */
  itemId: z.string(),
  /** ISO-8601 claim instant. */
  at: z.string(),
})

/** One stored reference claim. */
export type BoardReferenceRecord = z.infer<typeof boardReferenceRecord>

/** One inline edit draft, keyed by `itemId:userId`. */
export const boardDraftRecord = z.object({
  itemId: z.string(),
  /** Item the draft was made on when a collision transferred it, or null (§2.3, W-98). */
  transferredFrom: z.string().nullable().default(null),
  userId: z.string(),
  baseVersion: z.number(),
  revision: z.number(),
  writerSession: z.string(),
  changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  updatedAt: z.string(),
})

/** One stored edit draft. */
export type BoardDraftRecord = z.infer<typeof boardDraftRecord>

/**
 * The working draft of one iteration attempt, keyed by `<itemId>:<iterationId>`
 * (§9.7.1). It is stored apart from the item so a late answer for a dead attempt
 * can be kept without writing the item, and so cancel can delete exactly one
 * attempt's work.
 */
export const boardIterationDraftRecord = z.object({
  /** Item the draft edits. */
  itemId: z.string(),
  /** Item the draft was made on when a collision transferred it, or null (§2.3, W-98). */
  transferredFrom: z.string().nullable().default(null),
  /** Attempt that produced the draft. */
  iterationId: z.string(),
  /** Artifact version the draft was written against. */
  baseVersion: z.number(),
  /** Draft summary, or null. */
  summary: z.string().nullable(),
  /** Draft evidence references. */
  evidence: z.array(z.string()),
  /** Draft artifact content, or null. */
  content: z.record(z.string(), z.unknown()).nullable(),
  /** True when the attempt is no longer live; such a draft is offered while it is retained. */
  archived: z.boolean().default(false),
  /**
   * True when a newer attempt over the item replaced this draft, so it stays
   * stored for its attempt id and is never offered again (W-57).
   */
  superseded: z.boolean().default(false),
  /** True once a resume found the draft written against an older version (W-68). */
  outdated: z.boolean().default(false),
  /** ISO-8601 instant of the last draft write. */
  updatedAt: z.string(),
  /** ISO-8601 instant after which the draft is not offered again (D-09). */
  retainUntil: z.string(),
})

/** One stored iteration draft. */
export type BoardIterationDraftRecord = z.infer<typeof boardIterationDraftRecord>

/** Outcome of one external effect, as the destination reported it. */
const outcomeRecord = z.union([
  z.literal('CONFIRMADO'), z.literal('FALLIDO'), z.literal('DESCONOCIDO'),
])

/**
 * One effect reservation, keyed `<tenant>:<effect_key>` (E15). The key is the
 * contract's uniqueness rule: one row per tenant and effect key, so a competing
 * execution finds the holder instead of writing a second reservation.
 */
export const effectReservationRecord = z.object({
  /** Tenant that owns the reservation; null is the single-tenant deployment. */
  companyId: z.string().nullable().default(null),
  /** Signed effect identity (`sha256` of tenant, action, destination, business key, artifact hash). */
  effectKey: z.string(),
  /** Action type of the effect. */
  actionType: z.string(),
  /** Normalised destination. */
  destination: z.string(),
  /** Business identity the effect belongs to. */
  businessKey: z.string(),
  /** Exact artifact version the effect was authorized for. */
  artifactHash: z.string(),
  /** Execution that owns the reservation; its retries keep this id (W-84). */
  executionId: z.string(),
  /** Item that authorized the effect. */
  itemId: z.string(),
  /** Idempotency key the destination receives; a retry keeps it (W-77). */
  idempotencyKey: z.string(),
  /** Explicit authorization recorded with the acceptance, or null. */
  authorization: z.string().nullable().default(null),
  /** Reservation state. */
  status: z.union([
    z.literal('RESERVADA'), z.literal('DESPACHADA'), z.literal('CONCILIADA'), z.literal('LIBERADA'),
  ]),
  /** Last reported outcome, or null while none was reported. */
  outcome: outcomeRecord.nullable().default(null),
  /** Instant the delegated window closes, or null when the action type has no window. */
  reversalDeadline: z.string().nullable().default(null),
  /** Instant the effect was dispatched, or null. */
  dispatchedAt: z.string().nullable().default(null),
  /** Instant the reservation was released, or null. */
  releasedAt: z.string().nullable().default(null),
  /** Why it was released, or null. */
  releaseReason: z.string().nullable().default(null),
  /** Instant the item was closed administratively, or null (W-65). */
  closedAt: z.string().nullable().default(null),
  /** Identity that closed the item administratively, or null. */
  closedBy: z.string().nullable().default(null),
  /** Reason the item was closed administratively, or null. */
  closeReason: z.string().nullable().default(null),
  /** Instant the reservation reached a terminal state, or null. */
  settledAt: z.string().nullable().default(null),
  /** ISO-8601 instant the reservation was first acquired. */
  createdAt: z.string(),
  /** ISO-8601 instant of the last mutation. */
  updatedAt: z.string(),
  /** Instant after which a settled reservation may be pruned, or null. */
  retainUntil: z.string().nullable().default(null),
})

/** One stored reservation. */
export type EffectReservationRecord = z.infer<typeof effectReservationRecord>

/**
 * One outbox message, keyed `<tenant>:<effect_key>` (E15): the durable
 * intention to emit one effect, with the identity the consumer verifies before
 * it calls an adapter.
 */
export const effectOutboxRecord = z.object({
  /** Tenant that owns the message. */
  companyId: z.string().nullable().default(null),
  /** Effect the message emits; one message per effect. */
  effectKey: z.string(),
  /** Execution the message belongs to. */
  executionId: z.string(),
  /** Item that authorized the effect. */
  itemId: z.string(),
  /** Action type of the effect. */
  actionType: z.string(),
  /** Normalised destination. */
  destination: z.string(),
  /** Idempotency key the destination receives. */
  idempotencyKey: z.string(),
  /** Message state. */
  status: z.union([
    z.literal('PENDIENTE'), z.literal('DESPACHADO'), z.literal('CONFIRMADO'),
    z.literal('FALLIDO'), z.literal('CANCELADO'),
  ]),
  /** Whether the consumer may emit it; false once cancelled, dispatched, or failed. */
  dispatchable: z.boolean().default(true),
  /** Dispatch attempts so far. */
  attempts: z.number().default(0),
  /** Instant before which the consumer leaves a refused message alone, or null. */
  backoffUntil: z.string().nullable().default(null),
  /** Stable reason the message stopped being dispatchable, or null. */
  reason: z.string().nullable().default(null),
  /** Destination reference the adapter reported, or null. */
  ref: z.string().nullable().default(null),
  /** ISO-8601 creation instant. */
  createdAt: z.string(),
  /** ISO-8601 instant of the last mutation. */
  updatedAt: z.string(),
  /** Instant the message was handed to the adapter, or null. */
  dispatchedAt: z.string().nullable().default(null),
  /** Instant the message reached a terminal state, or null. */
  settledAt: z.string().nullable().default(null),
  /** Instant after which a settled message may be pruned, or null. */
  retainUntil: z.string().nullable().default(null),
})

/** One stored outbox message. */
export type EffectOutboxRecord = z.infer<typeof effectOutboxRecord>

/**
 * One visible alert, keyed `<tenant>:<effect_key>`: a late confirmation after an
 * administrative close must reach a human without reopening the item (W-85), and
 * a reservation the recovery sweep released must not pass unnoticed.
 */
export const effectAlertRecord = z.object({
  /** Tenant that owns the alert. */
  companyId: z.string().nullable().default(null),
  /** Effect the alert is about. */
  effectKey: z.string(),
  /** Item involved, or the item the orphaned reservation named. */
  itemId: z.string(),
  /** Execution that reported the outcome or held the reservation. */
  executionId: z.string(),
  /** Alert class: a late confirmation, or a reservation no item reached. */
  kind: z.union([z.literal('LATE_CONFIRMATION'), z.literal('ORPHAN_RELEASED'), z.literal('DISPATCH_REFUSED')]),
  /** Outcome the destination reported, or null when the alert is not about one. */
  outcome: outcomeRecord.nullable().default(null),
  /** Optional detail from the reconciliation or the sweep. */
  detail: z.string().nullable().default(null),
  /** Identity that reconciled the effect or ran the sweep. */
  actor: z.string(),
  /** ISO-8601 instant the alert was raised. */
  createdAt: z.string(),
  /** ISO-8601 instant of the last update. */
  updatedAt: z.string(),
})

/** One stored effect alert. */
export type EffectAlertRecord = z.infer<typeof effectAlertRecord>

/**
 * One audit event of an effect that no item can hold: the item aggregate is the
 * audit trail of every other command, and an orphaned reservation has no item.
 */
export const effectEventRecord = z.object({
  /** Tenant that owns the event. */
  companyId: z.string().nullable().default(null),
  /** Effect the event is about. */
  effectKey: z.string(),
  /** Command that produced it. */
  command: z.literal('effect.orphaned'),
  /** Identity that ran the command. */
  actor: z.string(),
  /** Item the reservation named, or null when the row carried none. */
  itemId: z.string().nullable().default(null),
  /** Execution that held the reservation. */
  executionId: z.string().nullable().default(null),
  /** Structured detail of the command. */
  detail: z.record(z.string(), z.unknown()).nullable().default(null),
  /** ISO-8601 instant. */
  at: z.string(),
})

/** One stored effect audit event. */
export type EffectEventRecord = z.infer<typeof effectEventRecord>

/**
 * One saved board view: a name and the filters it restores, owned by one
 * identity. Saving the same name again replaces the filters (§9.4).
 */
export const boardViewRecord = z.object({
  /** Owner the view belongs to. */
  ownerId: z.string(),
  /** Name the owner chose. */
  name: z.string(),
  /** Filters the view restores. */
  filters: z.object({
    spaceId: z.string().nullable(),
    accountRef: z.string().nullable(),
    assigneeId: z.string().nullable(),
    severity: z.string().nullable(),
    due: z.string(),
  }),
  /** ISO-8601 creation instant. */
  createdAt: z.string(),
  /** ISO-8601 last write. */
  updatedAt: z.string(),
})

/** One stored saved view. */
export type BoardViewRecord = z.infer<typeof boardViewRecord>

/**
 * One cached classification. The key carries every input that can change the
 * answer, including the rules and policy versions and the model version, so an
 * entry written under other rules is never reused (§5.1, W-51).
 */
export const classificationCacheRecord = z.object({
  /** The full §5.1 key. */
  key: z.string(),
  /** Field the entry classifies. */
  field: z.string(),
  /** Tenant the entry belongs to. */
  companyId: z.string().nullable(),
  /** Resolved severity; null records that nothing resolved. */
  severity: z.union([z.literal('LOW'), z.literal('MEDIUM'), z.literal('HIGH'), z.literal('CRITICAL')]).nullable(),
  /** Who produced it. */
  source: z.union([z.literal('RULE'), z.literal('LLM'), z.literal('HUMAN')]).nullable(),
  /** Proposal confidence. */
  confidence: z.number().nullable(),
  /** ISO-8601 instant the entry was written. */
  at: z.string(),
})

/** One stored classification cache entry. */
export type ClassificationCacheRecord = z.infer<typeof classificationCacheRecord>

/**
 * The attempt one iteration chat writes to, keyed by the chat's session id. The
 * panel creates the mapping when it opens the chat from the item, so the host
 * reaches the exact attempt instead of inferring it from the conversation text
 * (§9.7).
 */
export const iterationChatRecord = z.object({
  /** Owner that opened the chat. */
  ownerId: z.string(),
  /** Company scope carried by the owner, or null. */
  companyId: z.string().nullable(),
  /** Item the attempt iterates. */
  itemId: z.string(),
  /** Live attempt id at attach time. */
  iterationId: z.string(),
  /** Lock generation at attach time. */
  generation: z.number(),
  /** Tab session that held the attempt at attach time. */
  holderSession: z.string(),
  /** Artifact version the attempt started from. */
  baseVersion: z.number(),
  /** ISO-8601 instant. */
  createdAt: z.string(),
})

/** One stored iteration-chat attachment. */
export type IterationChatRecord = z.infer<typeof iterationChatRecord>

/**
 * One severity a human taught for an artifact type and account. The next item
 * of that type and account starts from it, so a correction changes the rule
 * instead of only the item it was made on.
 */
export const severityLearningRecord = z.object({
  /** Tenant the lesson belongs to. */
  companyId: z.string().nullable().default(null),
  /** Artifact type the human corrected. */
  artifactType: z.string(),
  /** Account the correction was made for, or null. */
  accountRef: z.string().nullable(),
  /** Severity the human chose. */
  severity: z.string(),
  /** Corrections that agreed on this severity. */
  count: z.number().default(1),
  /** ISO-8601 instant of the last correction. */
  updatedAt: z.string(),
})

/** One stored severity lesson. */
export type SeverityLearningRecord = z.infer<typeof severityLearningRecord>

/** One stored shadow evaluation of a human severity confirmation (W-63). */
export const shadowEvaluationRecord = z.object({  /** Tenant that owns the item. */
  companyId: z.string().nullable().default(null),
  /** Item the evaluation belongs to. */
  itemId: z.string(),
  /** Severity the human confirmed. */
  humanSeverity: z.string(),
  /** Severity the shadow evaluator proposed, or null when it abstained. */
  shadowSeverity: z.string().nullable(),
  /** How the evaluation compares with the human label. */
  status: z.string(),
  /** Shadow model identity. */
  modelVersion: z.string(),
  /** ISO-8601 instant. */
  at: z.string(),
})

/** One stored shadow evaluation. */
export type ShadowEvaluationRecord = z.infer<typeof shadowEvaluationRecord>

/**
 * The board domain spec: item aggregates, the key-claim table, the edit-draft
 * table, the iteration-draft and iteration-chat tables, the tenant claims on
 * opaque references, the external-effect reservation, outbox, alert, and audit
 * tables, the per-tenant classification cache, and the shadow evaluations that
 * measure a classifier without deciding anything.
 */
export const boardDomainSpec = defineDomain({
  name: 'faberloom_board',
  version: 1,
  tables: {
    items: domainTable<FaberLoomBoardItemId, BoardItemRecord>(boardItemRecord),
    keys: domainTable<string, BoardKeyRecord>(boardKeyRecord),
    drafts: domainTable<string, BoardDraftRecord>(boardDraftRecord),
    iteration_drafts: domainTable<string, BoardIterationDraftRecord>(boardIterationDraftRecord),
    references: domainTable<string, BoardReferenceRecord>(boardReferenceRecord),
    effect_reservations: domainTable<string, EffectReservationRecord>(effectReservationRecord),
    effect_outbox: domainTable<string, EffectOutboxRecord>(effectOutboxRecord),
    effect_alerts: domainTable<string, EffectAlertRecord>(effectAlertRecord),
    effect_events: domainTable<string, EffectEventRecord>(effectEventRecord),
    classification_cache: domainTable<string, ClassificationCacheRecord>(classificationCacheRecord),
    views: domainTable<string, BoardViewRecord>(boardViewRecord),
    iteration_chats: domainTable<string, IterationChatRecord>(iterationChatRecord),
    severity_shadow: domainTable<string, ShadowEvaluationRecord>(shadowEvaluationRecord),
    severity_learning: domainTable<string, SeverityLearningRecord>(severityLearningRecord),
  },
})
