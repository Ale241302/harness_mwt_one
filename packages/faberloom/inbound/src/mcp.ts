/**
 * The mail watcher's MCP half: which mounted servers carry mail, and how their
 * mailboxes are read without mutating anything.
 *
 * A Hostinger-style mail server answers every tool with one JSON envelope
 * `{ status, headers, body: { data, pagination } }`. `account_current` names the
 * mailboxes the token manages, `folders_list` their folders, and
 * `messages_list` one page of a folder newest-first. Message ids are synthetic
 * and carry the server, mailbox, folder, and the server's own uid, so an event
 * can name the exact message the reply tools must read, in the same format the
 * Correo panel already parses.
 * @module @deepseek-ai/dsh-faberloom-inbound/mcp
 */

import type { FaberLoomMcpRegistry } from '@deepseek-ai/dsh-faberloom-mcp-registry'

/** Prefix of every synthetic MCP mailbox and message id. */
export const MCP_MAIL_PREFIX = 'mcp-mail:'

/** Raw tool names a mounted server must publish to be watched as a mailbox. */
export const MCP_MAIL_TOOLS = ['account_current', 'folders_list', 'messages_list', 'messages_text'] as const

/** Messages one `messages_list` page returns; the server's own maximum. */
export const MCP_PAGE_SIZE = 100

/** Pages one poll reads before leaving the rest of a large hole to the sweep. */
export const MCP_MAX_PAGES = 20

/** One mailbox of one server, reduced to what the watcher reads. */
export interface McpMailboxTarget {
  /** Saved MCP server name. */
  readonly server: string
  /** Opaque mailbox resource id every tool requires. */
  readonly resourceId: string
  /** Address the server reports for this mailbox. */
  readonly address: string
  /** Folder path as the server spells it. */
  readonly folder: string
}

/** One listed message, reduced to the envelope the event carries. */
export interface McpMailEntry {
  /** The server's own message uid. */
  readonly uid: number
  /** `Message-ID` header value, or null when the server reported none. */
  readonly messageId: string | null
  /** Rendered `From`, or null. */
  readonly from: string | null
  /** Rendered `To`, or null. */
  readonly to: string | null
  /** Rendered `Cc`, or null. */
  readonly cc: string | null
  /** Subject, or null. */
  readonly subject: string | null
  /** `Date` header value, or null. */
  readonly date: string | null
}

/** One page of `messages_list`, with the page count the server reported. */
export interface McpMailPage {
  /** The page's messages, newest first. */
  readonly entries: readonly McpMailEntry[]
  /** Pages the folder holds, or null when the server did not say. */
  readonly totalPages: number | null
}

/**
 * Whether a mounted server publishes every tool the watcher reads.
 * @param tools - raw tool names the server advertises.
 * @returns true when `account_current`, `folders_list`, `messages_list`, and
 *   `messages_text` are all present.
 */
export function isMailServer(tools: readonly string[]): boolean {
  return MCP_MAIL_TOOLS.every(name => tools.includes(name))
}

/**
 * The synthetic connection id one mailbox is keyed by. It matches the account
 * id the Correo panel builds, so both name the same mailbox.
 * @param server - saved MCP server name.
 * @param resourceId - mailbox resource id inside that server.
 * @returns `mcp-mail:<server>:<resourceId>`, both parts encoded.
 */
export function mcpMailConnectionId(server: string, resourceId: string): string {
  return `${MCP_MAIL_PREFIX}${encodeURIComponent(server)}:${encodeURIComponent(resourceId)}`
}

/**
 * The cursor table key of one mailbox folder. The cursor record keeps the real
 * connection id; the table key stays unique per folder.
 * @param target - the mailbox to watch.
 * @returns `mcp:<server>:<resourceId>:<folder>`.
 */
export function mcpCursorKey(target: McpMailboxTarget): string {
  return `mcp:${target.server}:${target.resourceId}:${target.folder}`
}

/**
 * The synthetic id of one MCP message, the same format the Correo panel parses.
 * @param target - the mailbox the message lives in.
 * @param uid - the server's own message uid.
 * @returns the stable `originId` an event carries.
 */
export function mcpOriginId(target: McpMailboxTarget, uid: number): string {
  return `${mcpMailConnectionId(target.server, target.resourceId)}:${encodeURIComponent(target.folder)}:${String(uid)}`
}

/**
 * The event key of one MCP message: the mail's own id when it has one, so the
 * same message read through MCP and IMAP is one event; else the server,
 * mailbox, folder, and UID that name its copy.
 * @param target - the mailbox the message lives in.
 * @param entry - the listed envelope.
 * @returns the event key.
 */
export function mcpEventKey(target: McpMailboxTarget, entry: McpMailEntry): string {
  return entry.messageId === null
    ? `mcp:${target.server}:${target.resourceId}:${target.folder}:${String(entry.uid)}`
    : `mail:msg:${entry.messageId}`
}

/** Narrow one untrusted JSON value to a string-keyed object. */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** One non-empty string field, or null when the server sent another type. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The `body` of one tool envelope, falling back to the payload itself. */
function bodyOf(payload: unknown): Record<string, unknown> | null {
  const record = recordOf(payload)
  if (record === null) return null
  return recordOf(record['body']) ?? record
}

/** The object array one tool carries in `body.data`. */
function dataList(payload: unknown): readonly Record<string, unknown>[] {
  const data = bodyOf(payload)?.['data']
  if (!Array.isArray(data)) return []
  const entries: Record<string, unknown>[] = []
  for (const value of data) {
    const entry = recordOf(value)
    if (entry !== null) entries.push(entry)
  }
  return entries
}

/** One address, rendered the way a `From` header renders it. */
function addressOf(value: unknown): string | null {
  if (typeof value === 'string') return textOf(value)
  const entry = recordOf(value)
  if (entry === null) return null
  const name = (textOf(entry['name']) ?? '').trim()
  const address = (textOf(entry['address']) ?? '').trim()
  if (address.length === 0) return name.length === 0 ? null : name
  return name.length === 0 ? address : `${name} <${address}>`
}

/** One address list, comma-joined like a header. */
function addressListOf(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const items: string[] = []
  for (const entry of value) {
    const address = addressOf(entry)
    if (address !== null) items.push(address)
  }
  return items.length === 0 ? null : items.join(', ')
}

/**
 * The mailboxes `account_current` reports.
 * @param payload - the payload the registry parsed.
 * @returns one entry per mailbox the token can manage.
 */
export function mcpMailboxes(payload: unknown): readonly { readonly resourceId: string; readonly address: string }[] {
  const data = bodyOf(payload)?.['data']
  const mailboxes = recordOf(data)?.['mailboxes']
  if (!Array.isArray(mailboxes)) return []
  const found: { resourceId: string; address: string }[] = []
  for (const value of mailboxes) {
    const entry = recordOf(value)
    if (entry === null) continue
    const resourceId = textOf(entry['resourceId'])
    if (resourceId === null) continue
    found.push({ resourceId, address: textOf(entry['address']) ?? '' })
  }
  return found
}

/**
 * The folder a mailbox opens on: the server's inbox, else its first folder.
 * @param payload - the `folders_list` payload the registry parsed.
 * @returns the folder path, or null when the mailbox advertised none.
 */
export function mcpInboxFolder(payload: unknown): string | null {
  const folders = dataList(payload)
  const inbox = folders.find(folder => (textOf(folder['specialUse']) ?? '').toLowerCase() === '\\inbox')
  const chosen = textOf(inbox?.['path']) ?? textOf(folders[0]?.['path'])
  return chosen
}

/**
 * Narrow one `messages_list` entry to the envelope the watcher carries.
 * @param value - one entry of the server's page.
 * @returns the entry, or null when it carries no usable uid.
 */
export function mcpMailEntryOf(value: unknown): McpMailEntry | null {
  const entry = recordOf(value)
  if (entry === null) return null
  const raw = entry['uid']
  const uid = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(uid) || uid <= 0) return null
  return {
    uid,
    messageId: textOf(entry['messageId']),
    from: addressOf(entry['from']),
    to: addressListOf(entry['to']),
    cc: addressListOf(entry['cc']),
    subject: textOf(entry['subject']),
    date: textOf(entry['date']),
  }
}

/**
 * The mailboxes of one mounted server, ready to watch.
 *
 * A server that publishes no mail tools is not a mailbox at all: it answers an
 * empty list instead of failing. A mailbox with no folders is skipped the same
 * way, so an account that lists none does not stop the pass.
 * @param registry - the mounted MCP registry.
 * @param ownerId - the identity whose servers are read.
 * @param server - saved server name.
 * @returns one target per mailbox and folder the watcher reads.
 */
export async function mcpMailboxTargets(
  registry: FaberLoomMcpRegistry,
  ownerId: string,
  server: string,
): Promise<readonly McpMailboxTarget[]> {
  if (!isMailServer(await registry.toolsFor(ownerId, server))) return []
  const mailboxes = mcpMailboxes(await registry.callTool(ownerId, server, 'account_current', {}))
  const targets: McpMailboxTarget[] = []
  for (const mailbox of mailboxes) {
    const folder = mcpInboxFolder(await registry.callTool(ownerId, server, 'folders_list', {
      mailboxResourceId: mailbox.resourceId,
      perPage: MCP_PAGE_SIZE,
    }))
    if (folder === null) continue
    targets.push({ server, resourceId: mailbox.resourceId, address: mailbox.address, folder })
  }
  return targets
}

/**
 * Read one page of a mailbox folder, newest first.
 * @param registry - the mounted MCP registry.
 * @param ownerId - the identity whose server is read.
 * @param target - the mailbox and folder to list.
 * @param page - 1-based page number.
 * @param perPage - page size the server caps itself.
 * @returns the page's envelopes and the folder's page count.
 */
export async function mcpMessagePage(
  registry: FaberLoomMcpRegistry,
  ownerId: string,
  target: McpMailboxTarget,
  page: number,
  perPage: number,
): Promise<McpMailPage> {
  const payload = await registry.callTool(ownerId, target.server, 'messages_list', {
    mailboxResourceId: target.resourceId,
    folder: target.folder,
    page,
    perPage,
    sort: '-uid',
  })
  const totalPages = recordOf(bodyOf(payload)?.['pagination'])?.['totalPages']
  const entries: McpMailEntry[] = []
  for (const value of dataList(payload)) {
    const entry = mcpMailEntryOf(value)
    if (entry !== null) entries.push(entry)
  }
  return { entries, totalPages: typeof totalPages === 'number' ? totalPages : null }
}

/**
 * The newest messages of one mailbox, newest first, reading as many pages as
 * `count` needs. Used by the sweep, which always looks at the head.
 * @param registry - the mounted MCP registry.
 * @param ownerId - the identity whose server is read.
 * @param target - the mailbox to list.
 * @param count - messages to collect.
 * @returns the messages found, newest first.
 */
export async function mcpNewestEntries(
  registry: FaberLoomMcpRegistry,
  ownerId: string,
  target: McpMailboxTarget,
  count: number,
): Promise<readonly McpMailEntry[]> {
  const entries: McpMailEntry[] = []
  // A page holds at most MCP_PAGE_SIZE rows, so this many pages always reaches
  // `count`; the bound keeps a server that never shortens a page from hanging
  // the pass.
  const pages = Math.ceil(count / MCP_PAGE_SIZE) + 1
  for (const page of Array.from({ length: pages }, (_value, index) => index + 1)) {
    const listed = await mcpMessagePage(registry, ownerId, target, page, MCP_PAGE_SIZE)
    entries.push(...listed.entries)
    if (entries.length >= count) break
    const lastPage = listed.totalPages !== null && page >= listed.totalPages
    if (listed.entries.length < MCP_PAGE_SIZE || lastPage) break
  }
  return entries
}
