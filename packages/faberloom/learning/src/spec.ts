/**
 * The memory domain declaration: teaching, performance, and late-error record
 * schemas; the correction registry, learning candidates, and item outcomes;
 * plus the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-memory/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomCandidateId, FaberLoomCorrectionId, FaberLoomTeachingId } from './types.ts'

/** Teaching id at the durable boundary; branding has no runtime representation. */
const teachingId = z.string().transform(value => value as FaberLoomTeachingId)

/** Correction id at the durable boundary; branding has no runtime representation. */
const correctionId = z.string().transform(value => value as FaberLoomCorrectionId)

/** Candidate id at the durable boundary; branding has no runtime representation. */
const candidateId = z.string().transform(value => value as FaberLoomCandidateId)

/** Durable teaching record. */
export const teachingRecord = z.object({
  ownerId: z.string(),
  scope: z.union([z.literal('case'), z.literal('space'), z.literal('agent'), z.literal('skill'), z.literal('global')]),
  spaceId: z.string().nullable(),
  agentId: z.string().nullable(),
  skill: z.string().nullable(),
  task: z.string().nullable(),
  text: z.string(),
  source: z.string(),
  author: z.string(),
  status: z.union([z.literal('candidate'), z.literal('active'), z.literal('superseded'), z.literal('revoked')]),
  version: z.number(),
  supersedes: z.number().nullable(),
  uses: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored teaching, inferred from {@link teachingRecord}. */
export type TeachingRecord = z.infer<typeof teachingRecord>

/** Durable performance record. */
export const performanceRecord = z.object({
  ownerId: z.string(),
  agentId: z.string().nullable(),
  modelId: z.string().nullable(),
  task: z.string(),
  spaceId: z.string().nullable(),
  outcome: z.union([z.literal('approved'), z.literal('corrected')]),
  cause: z.union([z.literal('error'), z.literal('preference'), z.literal('requirement-change')]).nullable(),
  cost: z.number().nullable(),
  at: z.string(),
})

/** One stored performance record, inferred from {@link performanceRecord}. */
export type PerformanceRecord = z.infer<typeof performanceRecord>

/** Durable late-error record. */
export const lateErrorRecord = z.object({
  ownerId: z.string(),
  caseRef: z.string(),
  detail: z.string(),
  teachingId: teachingId.nullable(),
  author: z.string(),
  at: z.string(),
})

/** One stored late error, inferred from {@link lateErrorRecord}. */
export type LateErrorRecord = z.infer<typeof lateErrorRecord>

/** Data classification at the durable boundary (§5.2). */
const dataClassRecord = z.enum(['N0', 'N1', 'N2', 'N3', 'N4'])

/** Correction payload, discriminated by the origin that produced it (§6.3). */
export const correctionDetailRecord = z.discriminatedUnion('origin', [
  z.object({
    origin: z.literal('edit'),
    field: z.string(),
    previous: z.string().nullable(),
    next: z.string().nullable(),
  }),
  z.object({
    origin: z.literal('answer_doubt'),
    question: z.string(),
    answer: z.string(),
  }),
  z.object({
    origin: z.literal('iterate'),
    instructions: z.string(),
    diffs: z.array(z.string()),
    rounds: z.number(),
  }),
])

/** Durable human correction; every origin uses this one record. */
export const correctionRecord = z.object({
  tenantId: z.string().nullable(),
  spaceId: z.string().nullable(),
  accountRef: z.string().nullable(),
  agentId: z.string().nullable(),
  itemId: z.string(),
  actor: z.string(),
  scope: z.enum(['puntual', 'cuenta', 'espacio', 'agente']),
  dataClasses: z.array(dataClassRecord),
  fieldsUsed: z.array(z.string()),
  detail: correctionDetailRecord,
  at: z.string(),
})

/** One stored correction, inferred from {@link correctionRecord}. */
export type CorrectionRecord = z.infer<typeof correctionRecord>

/** Durable learning candidate with its lineage and allowed destination (W-46). */
export const candidateRecord = z.object({
  tenantId: z.string().nullable(),
  spaceId: z.string().nullable(),
  accountRef: z.string().nullable(),
  agentId: z.string().nullable(),
  itemId: z.string(),
  correctionId,
  dataClass: dataClassRecord,
  originDataClasses: z.array(dataClassRecord),
  fieldsUsed: z.array(z.string()),
  scope: z.enum(['cuenta', 'espacio', 'agente']),
  allowedDestination: z.enum(['cuenta', 'espacio', 'agente']),
  text: z.string(),
  status: z.enum(['candidate', 'promoted']),
  derivedFrom: candidateId.nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  promotedBy: z.string().nullable(),
  promotedAt: z.string().nullable(),
  promotionDataClasses: z.array(dataClassRecord).nullable(),
})

/** One stored candidate, inferred from {@link candidateRecord}. */
export type CandidateRecord = z.infer<typeof candidateRecord>

/** Durable item outcome that the maturity metrics read. */
export const outcomeRecord = z.object({
  tenantId: z.string().nullable(),
  spaceId: z.string().nullable(),
  itemId: z.string(),
  artifactType: z.string(),
  actionType: z.string(),
  result: z.enum(['approved', 'discarded', 'skipped', 'delegated', 'delegated-reversed']),
  at: z.string(),
})

/** One stored outcome, inferred from {@link outcomeRecord}. */
export type OutcomeRecord = z.infer<typeof outcomeRecord>

/**
 * The memory domain spec: teachings, performance, late errors, corrections,
 * candidates, and outcomes. The three newer tables are additive at the same
 * version: an older medium holds no rows for them and opens unchanged.
 */
export const memoryDomainSpec = defineDomain({
  name: 'faberloom_memory',
  version: 1,
  tables: {
    teachings: domainTable<string, TeachingRecord>(teachingRecord),
    teaching_versions: domainTable<string, TeachingRecord>(teachingRecord),
    performance: domainTable<string, PerformanceRecord>(performanceRecord),
    late_errors: domainTable<string, LateErrorRecord>(lateErrorRecord),
    corrections: domainTable<string, CorrectionRecord>(correctionRecord),
    candidates: domainTable<string, CandidateRecord>(candidateRecord),
    outcomes: domainTable<string, OutcomeRecord>(outcomeRecord),
  },
})
