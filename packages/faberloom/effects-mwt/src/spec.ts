/**
 * The MWT.ONE write domain: the proposals prepared from sources and the
 * single-use authorizations that allow exactly one of them to execute.
 * @module @deepseek-ai/dsh-faberloom-effects-mwt/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** One stored proposal, kept until its expediente is written or discarded. */
export const proposalRecord = z.object({
  ownerId: z.string(),
  companyId: z.string().nullable(),
  itemId: z.string().nullable(),
  target: z.object({
    expedienteId: z.string(),
    label: z.string(),
    collection: z.string(),
  }),
  revision: z.string(),
  versionBefore: z.string(),
  fields: z.array(z.object({
    field: z.string(),
    label: z.string(),
    before: z.string().nullable(),
    after: z.string(),
    unit: z.string().nullable(),
  })),
  documents: z.array(z.object({
    name: z.string(),
    mediaType: z.string(),
    sha256: z.string(),
    bytes: z.number(),
    operation: z.enum(['add', 'replace']),
    replaces: z.string().nullable(),
  })),
  // Bytes stay out of the list: a draft re-reads them by digest when it writes.
  documentBytes: z.array(z.object({
    name: z.string(),
    contentBase64: z.string(),
  })),
  ambiguities: z.array(z.string()),
  sources: z.array(z.string()),
  reason: z.string(),
  status: z.enum(['proposed', 'executing', 'written', 'unknown', 'failed', 'discarded']),
  ref: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored proposal, inferred from {@link proposalRecord}. */
export type ProposalRecord = z.infer<typeof proposalRecord>

/** One single-use authorization bound to a proposal revision. */
export const authorizationRecord = z.object({
  ownerId: z.string(),
  proposalId: z.string(),
  revision: z.string(),
  scope: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  createdAt: z.string(),
})

/** One stored authorization, inferred from {@link authorizationRecord}. */
export type AuthorizationRecord = z.infer<typeof authorizationRecord>

/** The write domain: proposals and their authorizations. */
export const mwtDomainSpec = defineDomain({
  name: 'faberloom_effects_mwt',
  version: 1,
  tables: {
    proposals: domainTable<string, ProposalRecord>(proposalRecord),
    authorizations: domainTable<string, AuthorizationRecord>(authorizationRecord),
  },
})
