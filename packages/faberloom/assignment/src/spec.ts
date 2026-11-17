/**
 * Durable assignment-rule records: one `rules` table, version 1.
 * @module @deepseek-ai/dsh-faberloom-assignment/spec
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable record of one assignment rule. */
export const assignmentRuleRecord = z.object({
  ownerId: z.string(),
  criterion: z.object({
    field: z.enum(['from', 'subject', 'account', 'company']),
    operator: z.enum(['equals', 'contains', 'startsWith']),
    value: z.string(),
  }),
  target: z.object({
    spaceId: z.string().nullable(),
    agentId: z.string().nullable(),
  }),
  origin: z.object({
    kind: z.enum(['human', 'learned']),
    by: z.string(),
    at: z.string(),
    itemId: z.string().nullable(),
  }),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revokedAt: z.string().nullable(),
})

/** One stored rule, inferred from {@link assignmentRuleRecord}. */
export type AssignmentRuleRecord = z.infer<typeof assignmentRuleRecord>

/**
 * The assignment domain: one `rules` table. Revocation is a field, not a
 * delete, so a rule that stopped classifying stays auditable.
 */
export const assignmentDomainSpec = defineDomain({
  name: 'faberloom_assignment',
  version: 1,
  tables: {
    rules: domainTable<string, AssignmentRuleRecord>(assignmentRuleRecord),
  },
})
