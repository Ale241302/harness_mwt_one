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
  bcc: z.array(z.string()).default([]),
  subject: z.string(),
  text: z.string(),
  status: z.enum(['draft', 'sent', 'rejected']),
  // Mailbox the draft will be sent from, as the owner sees it in the rail.
  // Legacy rows carry no account and resolve to the primary one on send.
  account: z.string().nullable().default(null),
  // The AI's original text, kept to capture the owner's correction on send.
  aiText: z.string().nullable().default(null),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()).default([]),
  // Files live with the draft so the approved message is the one transmitted:
  // the reviewer sees the bytes before the send.
  attachments: z.array(z.object({
    name: z.string(),
    mediaType: z.string(),
    contentBase64: z.string(),
    size: z.number(),
  })).default([]),
  spaceId: z.string().nullable(),
  // v1 rows predate origin and agent metadata; reads normalize it to null.
  originUid: z.string().nullable().default(null),
  originReason: z.string().nullable().default(null),
  originMailbox: z.string().nullable().default(null),
  agentSessionId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().nullable(),
})

/** One stored draft, inferred from {@link draftRecord}. */
export type DraftRecord = z.infer<typeof draftRecord>

/** Complete restorable contents captured in a draft revision. */
export const draftSnapshotRecord = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  account: z.string().nullable(),
  attachments: z.array(z.object({
    name: z.string(),
    mediaType: z.string(),
    contentBase64: z.string(),
    size: z.number(),
  })),
  aiText: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  spaceId: z.string().nullable(),
  originUid: z.string().nullable(),
  originReason: z.string().nullable(),
  originMailbox: z.string().nullable(),
})

/** One immutable snapshot in a draft's durable, owner-scoped history. */
export const draftRevisionRecord = z.object({
  draftId: z.string(),
  ownerId: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  source: z.enum(['initial', 'human', 'agent', 'restore']),
  instruction: z.string().nullable(),
  snapshot: draftSnapshotRecord,
})

/** One stored draft revision, inferred from {@link draftRevisionRecord}. */
export type DraftRevisionRecord = z.infer<typeof draftRevisionRecord>

/** One attempt to send one approved draft. */
export const sendIntentRecord = z.object({
  ownerId: z.string(),
  draftId: z.string(),
  /** SHA-256 of the exact message the owner reviewed: envelope, body and files. */
  revision: z.string(),
  status: z.enum(['prepared', 'sending', 'sent', 'failed', 'unknown']),
  /** Envelope sender the attempt used, or null while it resolves to primary. */
  from: z.string().nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  textHash: z.string(),
  attachmentHashes: z.array(z.object({ name: z.string(), sha256: z.string() })),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  /** Transport `Message-ID`, once the server accepted the message. */
  messageId: z.string().nullable(),
  /** Failure text, when the attempt failed or stayed unknown. */
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored send attempt, inferred from {@link sendIntentRecord}. */
export type SendIntentRecord = z.infer<typeof sendIntentRecord>

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

/** One stored email signature, keyed by owner and outgoing account. */
export const signatureRecord = z.object({
  ownerId: z.string(),
  /** Mailbox the signature belongs to; null is the primary account. */
  account: z.string().nullable(),
  /** Plain-text signature body, as the owner wrote it. */
  text: z.string(),
  /** Whether a new mail starts with this signature. */
  auto: z.boolean(),
  updatedAt: z.string(),
})

/** One stored signature, inferred from {@link signatureRecord}. */
export type SignatureRecord = z.infer<typeof signatureRecord>

/**
 * The connections domain spec: the `connections` table, the owner's email
 * drafts and revisions, send attempts and per-account signatures. Version 2
 * reads v1 drafts, whose absent origin and session metadata normalize to null.
 */
export const connectionsDomainSpec = defineDomain({
  name: 'faberloom_connections',
  version: 2,
  compatibleVersions: [1],
  tables: {
    connections: domainTable<string, ConnectionRecord>(connectionRecord),
    drafts: domainTable<string, DraftRecord>(draftRecord),
    draft_revisions: domainTable<string, DraftRevisionRecord>(draftRevisionRecord),
    policies: domainTable<string, EmailPolicyRecord>(emailPolicyRecord),
    send_intents: domainTable<string, SendIntentRecord>(sendIntentRecord),
    signatures: domainTable<string, SignatureRecord>(signatureRecord),
  },
})
