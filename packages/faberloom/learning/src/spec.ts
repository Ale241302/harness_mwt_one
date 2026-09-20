/**
 * The memory domain declaration: teaching, performance, and late-error record
 * schemas plus the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-memory/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomTeachingId } from './types.ts'

/** Teaching id at the durable boundary; branding has no runtime representation. */
const teachingId = z.string().transform(value => value as FaberLoomTeachingId)

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

/**
 * The memory domain spec: teachings, performance, and late errors.
 */
export const memoryDomainSpec = defineDomain({
  name: 'faberloom_memory',
  version: 1,
  tables: {
    teachings: domainTable<string, TeachingRecord>(teachingRecord),
    teaching_versions: domainTable<string, TeachingRecord>(teachingRecord),
    performance: domainTable<string, PerformanceRecord>(performanceRecord),
    late_errors: domainTable<string, LateErrorRecord>(lateErrorRecord),
  },
})
