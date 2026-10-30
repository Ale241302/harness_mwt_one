/**
 * The MCP-registry domain declaration: one durable record per owner and server.
 * The record holds the transport, the non-secret entry names with the credential
 * references their values live under, the enabled flag, and the timestamps; no
 * secret value is ever written here.
 * @module @deepseek-ai/dsh-faberloom-mcp-registry/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable stdio transport. */
const stdioTransportRecord = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
})

/** Durable Streamable HTTP transport. */
const httpTransportRecord = z.object({
  transport: z.literal('streamable-http'),
  url: z.string(),
})

/** Durable environment or header entry: the name and the reference its value lives under. */
const secretEntryRecord = z.object({
  name: z.string(),
  credentialRef: z.string(),
})

/** Durable shape of one saved MCP server. */
export const mcpServerRecord = z.object({
  ownerId: z.string(),
  name: z.string(),
  transport: z.union([stdioTransportRecord, httpTransportRecord]),
  env: z.array(secretEntryRecord),
  headers: z.array(secretEntryRecord),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored server, inferred from {@link mcpServerRecord}. */
export type McpServerRecord = z.infer<typeof mcpServerRecord>

/** The MCP-registry domain spec: a `servers` table keyed per owner and server name. */
export const mcpRegistryDomainSpec = defineDomain({
  name: 'faberloom_mcp_registry',
  version: 1,
  tables: {
    servers: domainTable<string, McpServerRecord>(mcpServerRecord),
  },
})
