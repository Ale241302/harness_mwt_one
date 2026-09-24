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
  kind: z.enum(['imap', 'smtp', 'backup']),
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

/** Durable email draft: one message an agent prepared for owner approval. */
export const draftRecord = z.object({
  ownerId: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  status: z.enum(['draft', 'sent', 'rejected']),
  // The AI's original text, kept to capture the owner's correction on send.
  aiText: z.string().nullable().default(null),
  inReplyTo: z.string().nullable(),
  spaceId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
})

/** One stored draft, inferred from {@link draftRecord}. */
export type DraftRecord = z.infer<typeof draftRecord>

/** Durable auto-send policy for one owner (and space, when scoped). */
export const emailPolicyRecord = z.object({
  ownerId: z.string(),
  spaceId: z.string().nullable(),
  enabled: z.boolean(),
  threshold: z.number(),
  // Consecutive AI drafts sent without owner edits.
  cleanSends: z.number(),
  updatedAt: z.string(),
})

/** One stored auto-send policy, inferred from {@link emailPolicyRecord}. */
export type EmailPolicyRecord = z.infer<typeof emailPolicyRecord>

/**
 * The connections domain spec: the `connections` table and the owner's email
 * drafts awaiting approval.
 */
export const connectionsDomainSpec = defineDomain({
  name: 'faberloom_connections',
  version: 1,
  tables: {
    connections: domainTable<string, ConnectionRecord>(connectionRecord),
    drafts: domainTable<string, DraftRecord>(draftRecord),
    policies: domainTable<string, EmailPolicyRecord>(emailPolicyRecord),
  },
})
