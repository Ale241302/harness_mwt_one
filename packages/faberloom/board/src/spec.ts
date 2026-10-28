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
  dataClass: z.union([z.literal('N0'), z.literal('N1'), z.literal('N2'), z.literal('N3'), z.literal('N4')]).default('N2'),
  dataClassProvisional: z.boolean().default(true),
  runId: z.string().nullable().default(null),
  idempotencyKey: z.string().nullable().default(null),
  businessKey: z.string().nullable().default(null),
  supersedesItemId: z.string().nullable().default(null),
  artifactType: z.string().default(''),
  accountRef: z.string().nullable().default(null),
  artifactHash: z.string().nullable().default(null),
  /** Origins the run declared for the fields of its content; the item projects one entry per field. */
  fieldOrigins: z.array(fieldOriginRecord).default([]),
  pendingCandidate: candidateRecord.nullable().default(null),
  events: z.array(eventRecord).default([]),
  discardReason: z.string().nullable().default(null),
  discardNote: z.string().nullable().default(null),
  iterationId: z.string().nullable().default(null),
  iterationDraftKey: z.string().nullable().default(null),
  iterationLockUntil: z.string().nullable().default(null),
  iterationLockGeneration: z.number().default(0),
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
  userId: z.string(),
  baseVersion: z.number(),
  revision: z.number(),
  writerSession: z.string(),
  changes: z.record(z.string(), z.string()),
  updatedAt: z.string(),
})

/** One stored edit draft. */
export type BoardDraftRecord = z.infer<typeof boardDraftRecord>

/**
 * The board domain spec: item aggregates, the key-claim table, the draft table,
 * and the tenant claims on opaque references.
 */
export const boardDomainSpec = defineDomain({
  name: 'faberloom_board',
  version: 1,
  tables: {
    items: domainTable<FaberLoomBoardItemId, BoardItemRecord>(boardItemRecord),
    keys: domainTable<string, BoardKeyRecord>(boardKeyRecord),
    drafts: domainTable<string, BoardDraftRecord>(boardDraftRecord),
    references: domainTable<string, BoardReferenceRecord>(boardReferenceRecord),
  },
})
