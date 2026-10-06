/**
 * The share domain declaration: the durable grant record and the `defineDomain`
 * spec the shares service opens. The portable resource snapshot travels in the
 * same row so an imported grant can materialize without a second read.
 * @module @deepseek-ai/dsh-faberloom-shares/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable share grant. */
export const shareGrantRecord = z.object({
  ownerId: z.string(),
  resourceKind: z.union([z.literal('space'), z.literal('workflow')]),
  resourceId: z.string(),
  resourceName: z.string(),
  granteeEmail: z.string(),
  permissions: z.array(z.string()),
  status: z.union([z.literal('pending'), z.literal('active'), z.literal('revoked')]),
  // A console round-trip may have stored the snapshot as its JSON text; the
  // reader normalizes it, so the schema tolerates the legacy form and a later
  // sync rewrites the record with a parsed object.
  snapshot: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable().default(null),
  // Console-side share id, when the grant was published to the console.
  consoleId: z.string().nullable().default(null),
  createdAt: z.string(),
  acceptedAt: z.string().nullable().default(null),
})

/** One stored grant, inferred from {@link shareGrantRecord}. */
export type ShareGrantRecord = z.infer<typeof shareGrantRecord>

/** The share domain spec: one `grants` table. */
export const sharesDomainSpec = defineDomain({
  name: 'faberloom_shares',
  version: 1,
  tables: { grants: domainTable<string, ShareGrantRecord>(shareGrantRecord) },
})
