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
})

/** One stored token, inferred from {@link tokenRecord}. */
export type TokenRecord = z.infer<typeof tokenRecord>

/** The MCP server domain spec: one `tokens` table keyed by token. */
export const mcpServerDomainSpec = defineDomain({
  name: 'faberloom_mcp',
  version: 1,
  tables: { tokens: domainTable<string, TokenRecord>(tokenRecord) },
})
