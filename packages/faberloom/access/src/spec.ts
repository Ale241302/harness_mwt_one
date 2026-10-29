/**
 * The access domain declaration: the grant and signature record schemas and the
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

/** Durable CEO signature record, scoped to one tenant and its covered action types. */
export const signatureRecord = z.object({
  tenantId: z.string().nullable(),
  signedBy: z.string(),
  signedAt: z.string(),
  active: z.boolean(),
  expiresAt: z.string().nullable(),
  actionTypes: z.array(z.string()),
  wildcard: z.boolean(),
  revokedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
})

/** One stored signature, inferred from {@link signatureRecord}. */
export type SignatureRecord = z.infer<typeof signatureRecord>

/**
 * The access domain spec: one `grants` table and one `signatures` table.
 *
 * The version stays 1 because the added table is additive: a stored document
 * without `signatures` opens with that table empty, and no stored field changed
 * meaning. Bumping it would make every existing document fail `version-mismatch`,
 * and this backend layout has no migration hook to rewrite the stamp.
 */
export const accessDomainSpec = defineDomain({
  name: 'faberloom_grants',
  version: 1,
  tables: {
    grants: domainTable<string, GrantRecord>(grantRecord),
    signatures: domainTable<string, SignatureRecord>(signatureRecord),
  },
})
