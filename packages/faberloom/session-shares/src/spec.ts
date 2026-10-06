/**
 * The shared-Session domain declaration: the durable record and the
 * `defineDomain` spec the session-shares service opens. Records captured on
 * this host and records imported from the console share one table.
 * @module @deepseek-ai/dsh-faberloom-session-shares/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable shared-Session record. */
export const sharedSessionRecord = z.object({
  spaceId: z.string(),
  ownerId: z.string(),
  sessionId: z.string(),
  title: z.string(),
  workspaceId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
  content: z.string(),
  origin: z.union([z.literal('owner'), z.literal('console')]),
  consoleId: z.string().nullable().default(null),
})

/** One stored shared Session, inferred from {@link sharedSessionRecord}. */
export type SharedSessionRecord = z.infer<typeof sharedSessionRecord>

/** The shared-Session domain spec: one `sessions` table. */
export const sessionSharesDomainSpec = defineDomain({
  name: 'faberloom_session_shares',
  version: 1,
  tables: {
    sessions: domainTable<string, SharedSessionRecord>(sharedSessionRecord),
  },
})
