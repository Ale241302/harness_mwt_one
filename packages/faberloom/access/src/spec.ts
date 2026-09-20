/**
 * The access domain declaration: the grant record schema and the
 * `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-access/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable grant record. */
export const grantRecord = z.object({
  ownerId: z.string(),
  action: z.string(),
  agentId: z.string().nullable(),
  context: z.string().nullable(),
  note: z.string().nullable(),
  grantedAt: z.string(),
  expiresAt: z.string().nullable(),
  revoked: z.boolean(),
})

/** One stored grant, inferred from {@link grantRecord}. */
export type GrantRecord = z.infer<typeof grantRecord>

/**
 * The access domain spec: one `grants` table.
 */
export const accessDomainSpec = defineDomain({
  name: 'faberloom_grants',
  version: 1,
  tables: { grants: domainTable<string, GrantRecord>(grantRecord) },
})
