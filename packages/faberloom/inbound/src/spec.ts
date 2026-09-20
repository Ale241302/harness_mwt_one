/**
 * The inbound receiver's own durable state: which mailbox message each
 * connection was last read up to. Keeping it apart from the connection row
 * means the receiver never rewrites the owner's configuration, and keeping it
 * out of the mailbox means the owner's mail client sees nothing change.
 * @module @deepseek-ai/dsh-faberloom-inbound/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable read cursor: the highest mailbox UID one connection already produced. */
export const cursorRecord = z.object({
  ownerId: z.string(),
  connectionId: z.string(),
  lastUid: z.number(),
  updatedAt: z.string(),
})

/** One stored cursor, inferred from {@link cursorRecord}. */
export type CursorRecord = z.infer<typeof cursorRecord>

/** The inbound domain spec: one `cursors` table keyed by connection id. */
export const inboundDomainSpec = defineDomain({
  name: 'faberloom_inbound',
  version: 1,
  tables: { cursors: domainTable<string, CursorRecord>(cursorRecord) },
})
