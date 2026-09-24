/**
 * The routines domain declaration: routine, version, execution, effect, source,
 * and event-key record schemas plus the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-routines/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomRoutineId } from './types.ts'

/** Routine id at the durable boundary; branding has no runtime representation. */
const routineId = z.string().transform(value => value as FaberLoomRoutineId)

/** Durable step. */
const stepRecord = z.object({
  id: z.string(),
  instruction: z.string(),
  handler: z.string(),
  dependsOn: z.array(z.string()),
  waitFor: z.string().nullable(),
  effect: z.boolean(),
  revalidateKey: z.string().nullable(),
  revalidateExpect: z.string().nullable(),
})

/** Durable trigger. */
const triggerRecord = z.object({
  kind: z.union([
    z.literal('manual'), z.literal('event'), z.literal('email'), z.literal('date'), z.literal('recurrence'),
  ]),
  match: z.string().nullable(),
})

/** Durable routine definition. */
const definitionRecord = z.object({
  intent: z.string(),
  triggers: z.array(triggerRecord),
  steps: z.array(stepRecord),
  expectedResult: z.string(),
  permissions: z.array(z.string()),
  failurePolicy: z.union([z.literal('stop'), z.literal('continue'), z.literal('review')]),
})

/** Durable routine record. */
export const routineRecord = z.object({
  ownerId: z.string(),
  name: z.string(),
  status: z.union([z.literal('draft'), z.literal('active'), z.literal('paused')]),
  version: z.number(),
  definition: definitionRecord,
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored routine, inferred from {@link routineRecord}. */
export type RoutineRecord = z.infer<typeof routineRecord>

/** Durable immutable routine version. */
export const routineVersionRecord = z.object({
  routineId,
  version: z.number(),
  definition: definitionRecord,
  createdAt: z.string(),
})

/** Durable step state. */
const stepStateRecord = z.object({
  status: z.union([
    z.literal('pending'), z.literal('running'), z.literal('waiting'), z.literal('completed'), z.literal('failed'),
  ]),
  result: z.unknown(),
  reason: z.string().nullable(),
})

/** Durable ingested event. */
export const eventRecord = z.object({
  key: z.string(),
  type: z.union([z.literal('event'), z.literal('email'), z.literal('date'), z.literal('recurrence')]),
  subject: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
})

/** One stored event, inferred from {@link eventRecord}. */
export type EventRecord = z.infer<typeof eventRecord>

/** Durable evidence entry. */
const evidenceRecord = z.object({
  channel: z.string(),
  eventKey: z.string().nullable(),
  at: z.string(),
})

/** Durable execution record. */
export const executionRecord = z.object({
  routineId,
  routineVersion: z.number(),
  ownerId: z.string(),
  status: z.union([
    z.literal('running'), z.literal('waiting'), z.literal('completed'), z.literal('failed'), z.literal('needs_review'),
  ]),
  idempotencyKey: z.string(),
  steps: z.record(z.string(), stepStateRecord),
  evidence: z.array(evidenceRecord),
  event: eventRecord.nullable(),
  // Every event the execution has received, oldest first; defaulted so rows
  // written before the field existed keep validating under the same version.
  events: z.array(eventRecord).default([]),
  waitingFor: z.string().nullable(),
  /**
   * When the wait the execution is parked on stops being reasonable, as an
   * ISO-8601 instant, or null when it is not waiting or waits without a
   * deadline. Rows written before this field existed read back as null, so the
   * table keeps its schema version.
   */
  deadlineAt: z.string().nullable().default(null),
  reason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored execution, inferred from {@link executionRecord}. */
export type ExecutionRecord = z.infer<typeof executionRecord>

/** Durable effect ledger entry. */
export const effectRecord = z.object({
  state: z.union([z.literal('pending'), z.literal('applied'), z.literal('cancelled')]),
  result: z.unknown(),
  at: z.string(),
})

/** One stored effect, inferred from {@link effectRecord}. */
export type EffectLedgerRecord = z.infer<typeof effectRecord>

/** Durable per-user event source. */
export const sourceRecord = z.object({
  ownerId: z.string(),
  kind: z.union([z.literal('email'), z.literal('webhook')]),
  label: z.string(),
  token: z.string(),
  createdAt: z.string(),
})

/** One stored event key for cross-channel dedupe. */
export const eventKeyRecord = z.object({
  ownerId: z.string(),
  eventKey: z.string(),
})

/**
 * The routines domain spec: routines, versions, executions, effects, sources,
 * and event keys. The service opens this through `ctx.storageDomain`.
 */
export const routinesDomainSpec = defineDomain({
  name: 'faberloom_routines',
  version: 1,
  tables: {
    routines: domainTable<string, RoutineRecord>(routineRecord),
    routine_versions: domainTable<string, z.infer<typeof routineVersionRecord>>(routineVersionRecord),
    executions: domainTable<string, ExecutionRecord>(executionRecord),
    effects: domainTable<string, EffectLedgerRecord>(effectRecord),
    sources: domainTable<string, z.infer<typeof sourceRecord>>(sourceRecord),
    event_keys: domainTable<string, z.infer<typeof eventKeyRecord>>(eventKeyRecord),
  },
})
