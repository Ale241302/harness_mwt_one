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

/** The MCP client's server-name grammar, shared by the registry and the editor. */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

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
 * @param label - the server name as typed; it is also the tool namespace.
 * @param url - the server URL as typed.
 * @returns the localized reason key, or null when the draft is usable.
 */
export function mcpDraftProblem(label: string, url: string): FaberloomKey | null {
  if (!MCP_SERVER_NAME.test(label.trim())) return 'connections.mcpInvalidName'
  if (!isHttpUrl(url.trim())) return 'connections.mcpInvalidUrl'
  return null
}
