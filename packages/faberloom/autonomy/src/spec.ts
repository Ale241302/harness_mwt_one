/**
 * The autonomy domain declaration: one durable unit record per
 * `(tenant, space, agent, actionType)`, the sample reviews of delegated items,
 * and the append-only audit of promotions, supervision, and suspensions; plus
 * the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-autonomy/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Numbers a promotion stored (§7.2). */
export const thresholdNumbersRecord = z.object({
  realRuns: z.number(),
  approvedWithoutIntervention: z.number(),
  approvalShare: z.number(),
  technicalFailures: z.number(),
  minimumRealRuns: z.number(),
  minimumApprovalShare: z.number(),
  statisticalMinimum: z.number().nullable(),
  period: z.string().nullable(),
})

/** Numbers a delegation-rate suspension stored (§7.3). */
export const delegationSuspensionRecord = z.object({
  delegations: z.number(),
  reversed: z.number(),
  failed: z.number(),
  technicalFailures: z.number(),
  rate: z.number(),
  suspensionRate: z.number(),
  period: z.string().nullable(),
})

/** Numbers a sample-rejection suspension stored (D-13). */
export const sampleSuspensionRecord = z.object({
  period: z.string(),
  sampleSize: z.number(),
  rejectedSampleItems: z.number(),
  sampleRejectionsToSuspend: z.number(),
})

/** Automatic return to `SUPERVISADO`, discriminated by its cause. */
export const suspensionRecord = z.discriminatedUnion('cause', [
  z.object({
    at: z.string(),
    cause: z.literal('delegation-rate'),
    numbers: delegationSuspensionRecord,
  }),
  z.object({
    at: z.string(),
    cause: z.literal('sample-rejected'),
    numbers: sampleSuspensionRecord,
  }),
])

/** One durable unit record. */
export const unitRecord = z.object({
  tenantId: z.string(),
  spaceId: z.string(),
  agentId: z.string(),
  actionType: z.string(),
  level: z.enum(['SHADOW', 'SUPERVISADO', 'DELEGADO']),
  createdAt: z.string(),
  updatedAt: z.string(),
  promotion: z.object({ by: z.string(), at: z.string(), numbers: thresholdNumbersRecord }).nullable(),
  suspension: suspensionRecord.nullable(),
})

/** One stored unit, inferred from {@link unitRecord}. */
export type UnitRecord = z.infer<typeof unitRecord>

/** One durable sample review of one delegated item. */
export const sampleReviewRecord = z.object({
  unitId: z.string(),
  tenantId: z.string(),
  period: z.string(),
  itemId: z.string(),
  delegatedAt: z.string(),
  selectedAt: z.string(),
  verdict: z.enum(['pending', 'accepted', 'rejected']),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  note: z.string().nullable(),
})

/** One stored sample review, inferred from {@link sampleReviewRecord}. */
export type SampleReviewRecord = z.infer<typeof sampleReviewRecord>

/** One durable audit entry. */
export const auditRecord = z.object({
  unitId: z.string(),
  tenantId: z.string(),
  at: z.string(),
  event: z.enum(['promoted', 'supervised', 'suspended', 'sample-planned', 'sample-reviewed']),
  actor: z.string(),
  cause: z.string().nullable(),
  detail: z.string().nullable(),
  numbers: z.record(z.string(), z.number()),
})

/** One stored audit entry, inferred from {@link auditRecord}. */
export type AuditRecord = z.infer<typeof auditRecord>

/** The autonomy domain spec: units, sample reviews, and audit entries. */
export const autonomyDomainSpec = defineDomain({
  name: 'faberloom_autonomy',
  version: 1,
  tables: {
    units: domainTable<string, UnitRecord>(unitRecord),
    sample_reviews: domainTable<string, SampleReviewRecord>(sampleReviewRecord),
    audit: domainTable<string, AuditRecord>(auditRecord),
  },
})
