/**
 * The spaces domain declaration: record schema and the `defineDomain` spec the
 * service opens. The zod schema validates the shipped format at the durability
 * boundary.
 * @module @deepseek-ai/dsh-faberloom-spaces/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomSpaceId } from './types.ts'

/** Space id schema at the durable boundary; branding has no runtime representation. */
const spaceId = z.string().transform(value => value as FaberLoomSpaceId)

/** Durable commercial-source reference: a kind plus the MWT.ONE record id. */
const spaceSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mwt-company'), id: z.string() }),
  z.object({ kind: z.literal('mwt-client'), id: z.string() }),
  z.object({ kind: z.literal('mwt-product'), id: z.string() }),
])

/**
 * Durable shape of one space record. `parentId` is `null` (not absent) for a
 * root space so the stored value stays JSON-faithful; timestamps are ISO-8601.
 */
export const spaceRecord = z.object({
  ownerId: z.string(),
  companyId: z.string().nullable(),
  title: z.string(),
  parentId: spaceId.nullable(),
  inheritContext: z.boolean(),
  excluded: z.array(spaceId),
  members: z.array(z.string()),
  context: z.record(z.string(), z.string()),
  sources: z.array(spaceSource).default([]),
  // The agent in charge of this space. Optional so records written before the
  // responsible-agent field keep loading under the same domain version.
  agentId: z.string().nullable().default(null),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
})

/** One stored space record, inferred from {@link spaceRecord}. */
export type SpaceRecord = z.infer<typeof spaceRecord>

/** Durable shape of one file attached to a space; bytes are base64 for this slice. */
export const spaceFileRecord = z.object({
  spaceId: spaceId,
  name: z.string(),
  mediaType: z.string(),
  size: z.number(),
  sha256: z.string(),
  contentBase64: z.string(),
  createdAt: z.string(),
})

/** One stored file record, inferred from {@link spaceFileRecord}. */
export type SpaceFileRecord = z.infer<typeof spaceFileRecord>

/**
 * The spaces domain spec: one `spaces` table keyed by {@link FaberLoomSpaceId}.
 * The service opens this through `ctx.storageDomain`; the spec object is the
 * single source of the domain's identity, version, and schema.
 */
export const spacesDomainSpec = defineDomain({
  name: 'faberloom_spaces',
  // Single-layout units reject a version mismatch outright (they do not read
  // compatibleVersions), so the responsible-agent field stays an optional,
  // defaulted member of the same version.
  version: 1,
  tables: {
    spaces: domainTable<FaberLoomSpaceId, SpaceRecord>(spaceRecord),
    files: domainTable<string, SpaceFileRecord>(spaceFileRecord),
  },
})
