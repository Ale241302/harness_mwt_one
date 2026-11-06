/**
 * The MCP server's own durable state: one bearer token per client an owner
 * connects. Tokens live with the product, not with the agent platform, so an
 * owner can mint one for another AI and revoke it without touching the harness.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable token record: one connected client. */
export const tokenRecord = z.object({
  ownerId: z.string(),
  label: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  /** Tool names this client may call; null means the owner's full surface. */
  scopes: z.array(z.string()).nullable().default(null),
  /** Company scope this client acts for; null when the deployment has none. */
  companyId: z.string().nullable().default(null),
  /**
   * Space this client is confined to. `null` is the legacy owner-wide token: a
   * record written before the field existed keeps that meaning instead of
   * silently gaining or losing a space.
   */
  spaceId: z.string().nullable().default(null),
  /** Work reference this token is bound to; null is the legacy owner-wide token. */
  referenceId: z.string().nullable().default(null),
  /** Instant the token stops working, or null for a token without a fixed life. */
  expiresAt: z.string().nullable().default(null),
})

/** One stored token, inferred from {@link tokenRecord}. */
export type TokenRecord = z.infer<typeof tokenRecord>

/** The MCP server domain spec: one `tokens` table keyed by token. */
export const mcpServerDomainSpec = defineDomain({
  name: 'faberloom_mcp',
  version: 1,
  tables: { tokens: domainTable<string, TokenRecord>(tokenRecord) },
})

/** One pending or decided authorization transaction. */
export const authorizationRecord = z.object({
  id: z.string(),
  ownerId: z.string(),
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  state: z.string(),
  resource: z.string(),
  scopes: z.array(z.string()),
  companyId: z.string().nullable().default(null),
  spaceId: z.string().nullable().default(null),
  revision: z.string().nullable().default(null),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.union([z.literal('pending'), z.literal('approved'), z.literal('denied')]).default('pending'),
  /** Raw one-time code, set only after a human approves; the browser delivers it once. */
  code: z.string().nullable().default(null),
  consumedAt: z.string().nullable().default(null),
})

/** One stored authorization transaction. */
export type AuthorizationRecord = z.infer<typeof authorizationRecord>

/** One one-time authorization code, stored by its SHA-256 hash. */
export const authorizationCodeRecord = z.object({
  transactionId: z.string(),
  ownerId: z.string(),
  clientId: z.string(),
  redirectUri: z.string(),
  resource: z.string(),
  scopes: z.array(z.string()),
  codeChallenge: z.string(),
  companyId: z.string().nullable().default(null),
  spaceId: z.string().nullable().default(null),
  revision: z.string().nullable().default(null),
  createdAt: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable().default(null),
})

/** One stored authorization code. */
export type AuthorizationCodeRecord = z.infer<typeof authorizationCodeRecord>

/** One work reference bound to a connection, a Space, and a revision. */
export const workReferenceRecord = z.object({
  id: z.string(),
  ownerId: z.string(),
  connectionId: z.string(),
  companyId: z.string().nullable().default(null),
  spaceId: z.string().nullable().default(null),
  revision: z.string().nullable().default(null),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  revokedAt: z.string().nullable().default(null),
})

/** One stored work reference. */
export type WorkReferenceRecord = z.infer<typeof workReferenceRecord>

/** OAuth transactions, one-time codes, and work references. */
export const mcpOAuthDomainSpec = defineDomain({
  name: 'faberloom_mcp_oauth',
  version: 1,
  tables: {
    authorizations: domainTable<string, AuthorizationRecord>(authorizationRecord),
    codes: domainTable<string, AuthorizationCodeRecord>(authorizationCodeRecord),
    references: domainTable<string, WorkReferenceRecord>(workReferenceRecord),
  },
})
