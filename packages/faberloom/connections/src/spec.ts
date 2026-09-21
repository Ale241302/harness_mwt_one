/**
 * The connections domain declaration: the per-user connection record schema and
 * the `defineDomain` spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-connections/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable connection record: one integration the owner configured. */
export const connectionRecord = z.object({
  ownerId: z.string(),
  kind: z.enum(['imap', 'backup']),
  label: z.string(),
  host: z.string().nullable(),
  port: z.number().nullable(),
  secure: z.boolean().nullable(),
  // Optional so rows written before the field existed still validate; every
  // write fills it in.
  starttls: z.boolean().optional(),
  // The mailbox the inbound receiver reads when the owner has several.
  primary: z.boolean().optional(),
  username: z.string().nullable(),
  secret: z.string().nullable(),
  destination: z.string().nullable(),
  retentionDays: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored connection, inferred from {@link connectionRecord}. */
export type ConnectionRecord = z.infer<typeof connectionRecord>

/**
 * The connections domain spec: one `connections` table keyed by connection id.
 */
export const connectionsDomainSpec = defineDomain({
  name: 'faberloom_connections',
  version: 1,
  tables: { connections: domainTable<string, ConnectionRecord>(connectionRecord) },
})
