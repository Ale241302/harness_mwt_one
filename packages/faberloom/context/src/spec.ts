/**
 * The context domain declaration: the durable entry record, its immutable
 * version rows, and the `defineDomain` spec the context service opens. Version
 * rows are append-only so any earlier context can be restored.
 * @module @deepseek-ai/dsh-faberloom-context/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable context entry. */
export const contextEntryRecord = z.object({
  spaceId: z.string().nullable().default(null),
  title: z.string(),
  body: z.string(),
  version: z.number(),
  visibility: z.union([z.literal('local'), z.literal('pending'), z.literal('shared')]),
  authorId: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  origin: z.union([z.literal('local'), z.literal('console')]).default('local'),
  consoleId: z.string().nullable().default(null),
})

/** One stored entry, inferred from {@link contextEntryRecord}. */
export type ContextEntryRecord = z.infer<typeof contextEntryRecord>

/** Append-only context version row, keyed by `${entryId}:${version}`. */
export const contextVersionRecord = z.object({
  entryId: z.string(),
  version: z.number(),
  title: z.string(),
  body: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
})

/** One stored version, inferred from {@link contextVersionRecord}. */
export type ContextVersionRecord = z.infer<typeof contextVersionRecord>

/** The context domain spec: an `entries` table and its `versions` table. */
export const contextDomainSpec = defineDomain({
  name: 'faberloom_context',
  version: 2,
  tables: {
    entries: domainTable<string, ContextEntryRecord>(contextEntryRecord),
    versions: domainTable<string, ContextVersionRecord>(contextVersionRecord),
  },
})
