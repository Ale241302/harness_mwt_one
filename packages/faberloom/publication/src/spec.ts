/**
 * The publication domain declaration: the durable row per publication identity
 * and the commit index that makes a revision addressable after a restart.
 * @module @deepseek-ai/dsh-faberloom-publication/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { PublicationState } from './types.ts'

/** Durable states, in the order the chain visits them. */
const PUBLICATION_STATES = [
  'pending',
  'committed',
  'uploaded',
  'activated',
  'failed',
] as const satisfies readonly PublicationState[]

/**
 * One publication, keyed by `itemId\0revision\0artifactHash`. The effect fields
 * (`commit`, `objectKey`, `sha256`, `bytes`) are written before the effect they
 * describe, so a crash resumes from the last durable fact instead of repeating
 * an applied patch, a commit, or an upload.
 */
export const publicationRecord = z.object({
  /** Publication identity: `itemId\0revision\0artifactHash`. */
  key: z.string(),
  itemId: z.string(),
  /** Base commit the diff was applied to. */
  revision: z.string(),
  /** Repository-relative target path. */
  path: z.string(),
  motivo: z.string(),
  evidence: z.array(z.string()),
  artifactHash: z.string(),
  /** SHA-256 of the exact diff text, so a replay with another diff conflicts. */
  diffSha256: z.string(),
  state: z.enum(PUBLICATION_STATES),
  /** Commit the applied diff produced, once committed. */
  commit: z.string().nullable(),
  /** Immutable object key, once uploaded. */
  objectKey: z.string().nullable(),
  /** SHA-256 of the published bytes, once uploaded. */
  sha256: z.string().nullable(),
  /** Published byte length, once uploaded. */
  bytes: z.number().int().nonnegative().nullable(),
  /** ISO-8601 instant activation committed, once activated. */
  activatedAt: z.string().nullable(),
  /** Last refusal, cleared when a later attempt succeeds. */
  failure: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored publication, inferred from {@link publicationRecord}. */
export type PublicationRecord = z.infer<typeof publicationRecord>

/** One file the application commit changed, as the durable row records it. */
export const applicationFileRecord = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
  sha256: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
})

/**
 * One durable application of an approved diff. It is separate from a
 * publication because the Git commit exists before any object is uploaded.
 */
export const applicationRecord = z.object({
  /** Application identity: `itemId\0revision\0artifactHash`. */
  key: z.string(),
  itemId: z.string(),
  revision: z.string(),
  artifactHash: z.string(),
  /** SHA-256 of the exact approved diff, so a changed diff is a new review. */
  diffSha256: z.string(),
  motivo: z.string(),
  evidence: z.array(z.string()),
  /** Every path the diff claims; validated against the server inventory. */
  paths: z.array(z.string()),
  state: z.enum(['pending', 'applied', 'conflict', 'failed']),
  /** Commit the applied diff produced, once applied. */
  commit: z.string(),
  /** Files the commit changed, once applied. */
  files: z.array(applicationFileRecord),
  /** Why the last attempt conflicted, or null. */
  reason: z.string().nullable(),
  /** ISO-8601 instant the commit was recorded, or null. */
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored application, inferred from {@link applicationRecord}. */
export type ApplicationRecord = z.infer<typeof applicationRecord>

/**
 * Index from a publication commit to its row, so `status`, `receipt`, and
 * `read` address a revision without scanning every publication.
 */
export const revisionIndexRecord = z.object({
  /** Key of the row in `publications`. */
  publication: z.string(),
})

/** One index row, inferred from {@link revisionIndexRecord}. */
export type RevisionIndexRecord = z.infer<typeof revisionIndexRecord>

/** The publication domain: one `publications` table and one `revisions` index. */
export const publicationDomainSpec = defineDomain({
  name: 'faberloom_publication',
  version: 1,
  tables: {
    publications: domainTable<string, PublicationRecord>(publicationRecord),
    revisions: domainTable<string, RevisionIndexRecord>(revisionIndexRecord),
    applications: domainTable<string, ApplicationRecord>(applicationRecord),
  },
})
