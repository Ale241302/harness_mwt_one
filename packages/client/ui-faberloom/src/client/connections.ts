/**
 * Row model and draft rules for the Conexiones table. The table merges the
 * owner's product connections with the MCP registry's servers, so one row type
 * states which source owns each field and no secret travels with either.
 */

import type { FaberLoomConnection } from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberLoomMcpServerRow } from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberloomKey } from './locales.ts'

/**
 * One row of the Connections table. An MCP server is merged into the same table
 * from the MCP registry, never copied into the connections domain: the union
 * keeps each source's own fields and the secret stays in the secure store.
 */
export type ConnectionRow =
  | { readonly id: string; readonly kind: 'imap' | 'smtp' | 'backup'; readonly connection: FaberLoomConnection }
  | { readonly id: string; readonly kind: 'mcp'; readonly mcp: FaberLoomMcpServerRow }

/** Row-id prefix that keeps a merged MCP server from colliding with a connection id. */
export const MCP_ROW_PREFIX = 'mcp:'

/** Longest server identifier the MCP client's tool namespace accepts. */
const MCP_SERVER_NAME_MAX = 32

/** The MCP client's server-name grammar, shared by the registry and the editor. */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * The identifier a typed name is saved under. The owner types the name they
 * read, with spaces, accents, or punctuation; the identifier keeps only ASCII
 * letters and digits, so a natural name never blocks the form. A name that is
 * already an identifier is kept unchanged, so a saved server such as
 * `hostinger-email` keeps its namespace and its tool names.
 * @param label - the name as typed.
 * @returns the identifier, empty when the name holds no ASCII letter or digit.
 */
export function mcpServerId(label: string): string {
  const trimmed = label.trim()
  if (MCP_SERVER_NAME.test(trimmed)) return trimmed
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/gu, '')
    .replace(/[^A-Za-z0-9]+/gu, '')
    .slice(0, MCP_SERVER_NAME_MAX)
}

/**
 * Whether a value is an absolute HTTP(S) URL the Streamable HTTP transport accepts.
 * @param value - the trimmed URL text.
 * @returns true when the text is an absolute HTTP(S) URL.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_invalidUrl) {
    return false
  }
}

/**
 * The header value the registry stores for one typed credential. The mail MCP
 * server authenticates with the HTTP authorization scheme's bearer token, so
 * the scheme name is added unless the owner pasted a complete value.
 * @param value - the credential value as typed.
 * @returns the header value.
 */
export function bearerCredential(value: string): string {
  return /^bearer\s/i.test(value) ? value : `Bearer ${value}`
}

/**
 * Why the MCP draft cannot be saved or tested yet.
 * @param label - the server name as typed; its identifier becomes the tool namespace.
 * @param url - the server URL as typed.
 * @returns the localized reason key, or null when the draft is usable.
 */
export function mcpDraftProblem(label: string, url: string): FaberloomKey | null {
  if (mcpServerId(label).length === 0) return 'connections.mcpInvalidName'
  if (!isHttpUrl(url.trim())) return 'connections.mcpInvalidUrl'
  return null
}

/** Longest tool name the probe list shows from one server. */
export const MCP_TOOL_LIST_LIMIT = 40

/** Longest description line the probe list shows before it is cut. */
const MCP_TOOL_SUMMARY_CHARS = 140

/**
 * The tool name without the namespace the server name already states. The
 * public name is derived from `(server, rawName)`; a truncated or normalized
 * suffix keeps its public name rather than a wrong one.
 * @param server - the server name as typed in the form.
 * @param publicName - the `mcp__<server>__<raw>` name the probe returned.
 * @returns the name the owner reads.
 */
export function mcpToolLabel(server: string, publicName: string): string {
  const prefix = `mcp__${server.trim()}__`
  return publicName.startsWith(prefix) ? publicName.slice(prefix.length) : publicName
}

/**
 * One bounded line of a tool description.
 * @param description - the server's own description.
 * @returns the text with runs of whitespace collapsed and a hard length bound.
 */
export function mcpToolSummary(description: string): string {
  const text = description.replace(/\s+/gu, ' ').trim()
  return text.length <= MCP_TOOL_SUMMARY_CHARS ? text : `${text.slice(0, MCP_TOOL_SUMMARY_CHARS - 1)}…`
}
