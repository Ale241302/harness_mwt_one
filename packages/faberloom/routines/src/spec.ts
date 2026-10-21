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

/** Coerce legacy permissions into the string list stored today. */
function storedPermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return typeof value === 'string' && value.trim().length > 0 ? [value.trim()] : []
}

/** Coerce a legacy failure policy, including the nested object shape. */
function storedFailurePolicy(value: unknown): 'stop' | 'continue' | 'review' {
  if (value === 'stop' || value === 'continue' || value === 'review') return value
  if (typeof value === 'object' && value !== null) {
    const nested = value as { onStepFailure?: unknown; onFailure?: unknown; policy?: unknown }
    const candidate = nested.onStepFailure ?? nested.onFailure ?? nested.policy
    if (candidate === 'stop' || candidate === 'continue' || candidate === 'review') return candidate
  }
  return 'review'
}

/** Coerce a legacy trigger kind. */
function storedTriggerKind(value: unknown): 'manual' | 'event' | 'email' | 'date' | 'recurrence' {
  if (value === 'manual' || value === 'event' || value === 'email' || value === 'date' || value === 'recurrence') return value
  if (value === 'webhook' || value === 'hook') return 'event'
  if (value === 'mail' || value === 'imap') return 'email'
  if (value === 'schedule' || value === 'scheduled' || value === 'interval' || value === 'cron' || value === 'hourly' || value === 'daily') return 'recurrence'
  return 'manual'
}

/** Coerce the handler words older model writes used. */
function storedHandler(value: unknown): string {
  if (value === 'manual' || value === 'manual_step' || value === 'manual-step' || value === 'human' || value === 'approval' || value === 'approve' || value === 'review' || value === 'task') return 'agent'
  if (value === 'mcp.call' || value === 'mcp_call') return 'mcp'
  if (value === 'email' || value === 'send') return 'email.send'
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'agent'
}

/** Durable step. Legacy rows default every field the current engine requires. */
const stepRecord = z.object({
  id: z.string().default('step'),
  instruction: z.string().default(''),
  handler: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  // Kind-specific configuration; defaulted so routine versions written before
  // the field existed keep loading under the same domain version.
  config: z.record(z.string(), z.unknown()).default({}),
  // Gate fields default so routine versions written before them keep loading.
  gateStepId: z.string().nullable().default(null),
  gateExpect: z.boolean().nullable().default(null),
  waitFor: z.string().nullable().default(null),
  effect: z.boolean().default(false),
  revalidateKey: z.string().nullable().default(null),
  revalidateExpect: z.string().nullable().default(null),
  // Handler attempts allowed before the step fails; defaulted for pre-field rows.
  maxAttempts: z.number().default(1),
  // Legacy authoring aliases; the transform folds the first text into instruction.
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
}).transform(({ title, description, type, ...step }) => ({
  ...step,
  handler: storedHandler(step.handler ?? type),
  instruction: step.instruction.trim().length > 0 ? step.instruction : (title ?? description ?? '').trim(),
}))

/** Durable trigger. */
const triggerRecord = z.object({
  kind: z.union([
    z.literal('manual'), z.literal('event'), z.literal('email'), z.literal('date'), z.literal('recurrence'),
  ]).optional(),
  type: z.string().optional(),
  match: z.string().nullable().default(null),
  // Schedule fields default so routine versions written before them keep loading.
  timezone: z.string().nullable().default(null),
  days: z.array(z.number()).default([]),
  windowFrom: z.number().nullable().default(null),
  windowTo: z.number().nullable().default(null),
  businessDays: z.boolean().default(false),
}).transform(({ type, ...trigger }) => ({
  ...trigger,
  kind: storedTriggerKind(trigger.kind ?? type),
}))

/** Durable routine definition. */
const definitionRecord = z.object({
  intent: z.string().default(''),
  triggers: z.array(triggerRecord).default([]),
  steps: z.array(stepRecord).default([]),
  expectedResult: z.string().default(''),
  permissions: z.preprocess(storedPermissions, z.array(z.string())).default([]),
  failurePolicy: z.preprocess(storedFailurePolicy, z.union([z.literal('stop'), z.literal('continue'), z.literal('review')])),
  // Concurrency cap; null is unlimited. Defaulted for pre-field records.
  maxConcurrency: z.number().nullable().default(null),
})

/** Durable routine record. */
export const routineRecord = z.object({
  ownerId: z.string(),
  name: z.string(),
  status: z.union([z.literal('draft'), z.literal('active'), z.literal('paused')]),
  version: z.number(),
  definition: definitionRecord,
  // The Space the routine belongs to, or null for the personal scope. A routine
  // publishes only into the Space it names, so a personal one stays unshared.
  // Defaulted so routines written before the field keep loading as personal.
  spaceId: z.string().nullable().default(null),
  // Who may see the routine. `private` keeps it to its owner: it is never
  // published to a shared Space and no other member, or their agent, reads or
  // edits it. Defaulted so routines written before the field keep loading.
  visibility: z.enum(['shared', 'private']).default('shared'),
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
    z.literal('skipped'),
  ]),
  result: z.unknown(),
  reason: z.string().nullable(),
  // Handler attempts made; defaulted for rows written before the field existed.
  attempts: z.number().default(0),
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
