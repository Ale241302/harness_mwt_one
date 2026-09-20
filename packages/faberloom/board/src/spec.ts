/**
 * The board domain declaration: the item record schema and the `defineDomain`
 * spec the service opens.
 * @module @deepseek-ai/dsh-faberloom-board/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FaberLoomBoardItemId } from './types.ts'

/** Durable revision. */
const revisionRecord = z.object({
  version: z.number(),
  summary: z.string(),
  evidence: z.array(z.string()),
  documentRef: z.string().nullable(),
  at: z.string(),
})

/** Durable review. */
const reviewRecord = z.object({
  decision: z.union([z.literal('approve'), z.literal('reject')]),
  version: z.number(),
  note: z.string().nullable(),
  at: z.string(),
})

/** Durable effect. */
const effectRecord = z.object({
  ref: z.string(),
  detail: z.string().nullable(),
  authorization: z.string().nullable(),
  at: z.string(),
})

/** Durable board item record. */
export const boardItemRecord = z.object({
  ownerId: z.string(),
  spaceId: z.string().nullable(),
  title: z.string(),
  status: z.union([
    z.literal('in_progress'), z.literal('waiting_data'), z.literal('waiting_approval'), z.literal('approved'),
    z.literal('completed'), z.literal('failed'), z.literal('reopened'), z.literal('needs_review'),
  ]),
  version: z.number(),
  revisions: z.array(revisionRecord),
  approvedRevision: z.number().nullable(),
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  effects: z.array(effectRecord),
  reviews: z.array(reviewRecord),
  executionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored board item, inferred from {@link boardItemRecord}. */
export type BoardItemRecord = z.infer<typeof boardItemRecord>

/**
 * The board domain spec: one `items` table keyed by {@link FaberLoomBoardItemId}.
 */
export const boardDomainSpec = defineDomain({
  name: 'faberloom_board',
  version: 1,
  tables: { items: domainTable<FaberLoomBoardItemId, BoardItemRecord>(boardItemRecord) },
})
