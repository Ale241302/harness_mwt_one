/**
 * Read-only mail over an MCP server, mapped onto the Correo surface's own
 * values.
 *
 * The Hostinger mail endpoint answers every tool with one text block holding a
 * JSON envelope `{ status, headers, body: { data } }`; `account_current` lists
 * the mailboxes the bearer token can manage, and every other tool addresses one
 * by its opaque `resourceId`. Message ids are synthetic and carry the server,
 * the mailbox resource, the folder, and the server's own uid, so a read never
 * needs a second lookup and can never collide with an IMAP uid.
 *
 * Reads name only `account_current`, `folders_list`, `messages_list`, and
 * `messages_text`. The owner's reversible gestures (seen flag and folder move)
 * go through the registry's owner-action path, and a draft composed from this
 * mailbox leaves through the server's own send tool on the owner's approval; the
 * model-facing policy still refuses every mutating name.
 *
 * @module @deepseek-ai/dsh-faberloom-view/mcp-mail
 */

import type { FaberLoomInboxRow, FaberLoomMailActions, FaberLoomMailboxFolder } from './types.ts'

/** Prefix of every synthetic MCP mailbox and message id. */
export const MCP_MAIL_PREFIX = 'mcp-mail:'

/** Page size requested when one mailbox's folders are listed. */
export const MCP_FOLDERS_PER_PAGE = 100

/**
 * Derive the owner gestures a server advertises from its raw tool names and the
 * folders it reported. A server without the move tools, or without a Trash or
 * Inbox folder, keeps that action unavailable instead of failing on click.
 * @param tools - raw tool names the mounted server publishes.
 * @param folders - folders the mailbox reported.
 * @returns the actions the Correo panel may offer.
 */
export function mcpMailActions(
  tools: readonly string[],
  folders: readonly FaberLoomMailboxFolder[],
): FaberLoomMailActions {
  const has = (name: string): boolean => tools.includes(name)
  const move = has('messages_move') || has('messages_move-bulk')
  return {
    markSeen: has('messages_patch') || has('messages_update-flags'),
    move,
    trash: move && folders.some(folder => folder.specialUse === 'trash'),
    restore: move && folders.some(folder => folder.specialUse === 'inbox'),
    send: has('send_email'),
  }
}

/**
 * Whether a mounted server speaks the mail protocol this panel reads.
 *
 * Every saved MCP server is mounted for the model, and only some of them are
 * mailboxes: the company endpoint publishes 189 business tools and no
 * `account_current`, so probing it as a mailbox answers `Unknown tool` and the
 * panel presented that as a broken mail account. A server without the two tools
 * the listing is built on is simply not a mail account.
 * @param tools - raw tool names the mounted server publishes.
 * @returns whether the server can answer the mailbox listing.
 */
export function mcpIsMailServer(tools: readonly string[]): boolean {
  return tools.includes('account_current') && tools.includes('messages_list')
}

/**
 * Budget for one MCP read issued while rendering Correo. The panel fans out
 * across mailboxes; without a short budget an unreachable server would hold the
 * whole surface for the deployment timeout instead of showing what IMAP already has.
 */
export const MCP_PANEL_CALL_TIMEOUT_MS = 5_000

/**
 * Budget for one message body. A body is a single gesture the owner waits for,
 * and a large newsletter can take the server several seconds to render, so this
 * read is not held to the listing budget.
 */
export const MCP_BODY_CALL_TIMEOUT_MS = 20_000

/**
 * Budget for one MCP send. The owner waits for a whole message to leave, and the
 * server writes its Sent copy before it answers.
 */
export const MCP_SEND_CALL_TIMEOUT_MS = 60_000

/**
 * How long one MCP body stays reusable. A message body does not change while the
 * owner reads it, and re-opening the same mail must not pay the server again.
 */
export const MCP_BODY_CACHE_TTL_MS = 10 * 60_000

/** Bodies kept at once; the oldest is dropped past this bound. */
export const MCP_BODY_CACHE_LIMIT = 50

/** One mailbox inside an MCP server's account. */
export interface McpMailbox {
  /** Opaque resource id every other tool requires. */
  readonly resourceId: string
  /** Address the server reports for this mailbox. */
  readonly address: string
}

/** The server and mailbox one MCP mail id addresses. */
export interface McpMailRoute {
  /** Saved MCP server name. */
  readonly server: string
  /** Mailbox resource id inside that server. */
  readonly resourceId: string
}

/** One MCP message's complete route, as its synthetic id carries it. */
export interface McpMailMessageRoute extends McpMailRoute {
  /** Folder path as the server spells it. */
  readonly folder: string
  /** The server's own message uid. */
  readonly uid: number
}

/** The values one message row adds beside its route. */
export interface McpMailMessageContext extends McpMailRoute {
  /** Folder the message was listed from. */
  readonly folder: string
  /** Account address the server reported for this mailbox. */
  readonly address: string
}

/** The synthetic account id one mailbox is keyed by. */
export function mcpAccountId(server: string, resourceId: string): string {
  return `${MCP_MAIL_PREFIX}${encodeURIComponent(server)}:${encodeURIComponent(resourceId)}`
}

/** The server named by an account id, even when its mailbox part is empty. */
export function mcpAccountServer(account: string): string | null {
  if (!account.startsWith(MCP_MAIL_PREFIX)) return null
  const [server] = account.slice(MCP_MAIL_PREFIX.length).split(':')
  return server === undefined || server.length === 0 ? null : decodeURIComponent(server)
}

/**
 * Parse one synthetic account id.
 * @param account - account id as the panel passes it back.
 * @returns the server and mailbox resource, or null when it names no mailbox.
 */
export function parseMcpAccount(account: string): McpMailRoute | null {
  if (!account.startsWith(MCP_MAIL_PREFIX)) return null
  const parts = account.slice(MCP_MAIL_PREFIX.length).split(':')
  if (parts.length !== 2) return null
  const [server, resourceId] = parts
  if (server === undefined || server.length === 0 || resourceId === undefined || resourceId.length === 0) return null
  return { server: decodeURIComponent(server), resourceId: decodeURIComponent(resourceId) }
}

/**
 * The synthetic id of one MCP message.
 * @param route - server, mailbox, folder, and the server's uid.
 * @returns the stable id the panel selects and reads by.
 */
export function mcpMessageId(route: McpMailMessageRoute): string {
  return `${mcpAccountId(route.server, route.resourceId)}:${encodeURIComponent(route.folder)}:${String(route.uid)}`
}

/**
 * Parse one synthetic MCP message id.
 * @param value - the row id as the panel passes it back.
 * @returns the complete route, or null when the id is not an MCP message.
 */
export function parseMcpMessageId(value: string): McpMailMessageRoute | null {
  if (!value.startsWith(MCP_MAIL_PREFIX)) return null
  const parts = value.slice(MCP_MAIL_PREFIX.length).split(':')
  if (parts.length !== 4) return null
  const [server, resourceId, folder, uidText] = parts
  if (server === undefined || server.length === 0 || resourceId === undefined || resourceId.length === 0) return null
  if (folder === undefined || uidText === undefined) return null
  const uid = Number(uidText)
  if (!Number.isSafeInteger(uid) || uid <= 0) return null
  return { server: decodeURIComponent(server), resourceId: decodeURIComponent(resourceId), folder: decodeURIComponent(folder), uid }
}

/** Narrow one untrusted JSON value to a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One string field, or null when the server omitted it or sent another type. */
function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The `body` of one tool's JSON envelope, falling back to the payload itself
 * so a different MCP server with a flatter result still maps.
 * @param payload - the payload the registry parsed.
 * @returns the object that carries `data`, or null.
 */
export function mcpBody(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  return isRecord(payload['body']) ? payload['body'] : payload
}

/**
 * The array of objects one tool carries in `body.data`.
 * @param payload - the payload the registry parsed.
 * @returns the entries, empty when the payload carries none.
 */
export function mcpDataList(payload: unknown): readonly Record<string, unknown>[] {
  const data = mcpBody(payload)?.['data']
  return Array.isArray(data) ? data.filter(isRecord) : []
}

/**
 * The page the server reports for one list call.
 * @param payload - the payload the registry parsed.
 * @returns the total and page count, or null when the server omitted them.
 */
export function mcpPagination(payload: unknown): { readonly total: number; readonly totalPages: number } | null {
  const pagination = mcpBody(payload)?.['pagination']
  if (!isRecord(pagination)) return null
  const total = pagination['total']
  const totalPages = pagination['totalPages']
  if (typeof total !== 'number' || typeof totalPages !== 'number') return null
  return { total, totalPages }
}

/**
 * The mailboxes `account_current` reports.
 * @param payload - the payload the registry parsed.
 * @returns one entry per mailboxes the token can manage.
 */
export function mcpMailboxes(payload: unknown): readonly McpMailbox[] {
  const data = mcpBody(payload)?.['data']
  if (!isRecord(data) || !Array.isArray(data['mailboxes'])) return []
  return data['mailboxes'].flatMap((entry) => {
    if (!isRecord(entry)) return []
    const resourceId = textOf(entry['resourceId'])
    if (resourceId === null || resourceId.length === 0) return []
    return [{ resourceId, address: textOf(entry['address']) ?? '' }]
  })
}

/** Special-use names the server spells with a backslash, mapped onto the panel's roles. */
const SPECIAL_USE: ReadonlyMap<string, FaberLoomMailboxFolder['specialUse']> = new Map([
  ['\\inbox', 'inbox'],
  ['\\sent', 'sent'],
  ['\\drafts', 'drafts'],
  ['\\trash', 'trash'],
  ['\\junk', 'junk'],
])

/**
 * The folders `folders_list` reports.
 * @param payload - the payload the registry parsed.
 * @returns each folder's path and the role the panel shortcuts, when the server names one.
 */
export function mcpFolders(payload: unknown): readonly FaberLoomMailboxFolder[] {
  return mcpDataList(payload).flatMap((entry) => {
    const name = textOf(entry['path']) ?? textOf(entry['name'])
    if (name === null || name.length === 0) return []
    const specialUse = textOf(entry['specialUse'])
    return [{ name, specialUse: specialUse === null ? null : SPECIAL_USE.get(specialUse.toLowerCase()) ?? null }]
  })
}

/**
 * The folder a mailbox opens on: the server's inbox, else its first folder.
 * @param folders - the folders the mailbox advertised.
 * @returns the folder path, or null when the mailbox advertised none.
 */
export function mcpInboxFolder(folders: readonly FaberLoomMailboxFolder[]): string | null {
  return folders.find(folder => folder.specialUse === 'inbox')?.name ?? folders[0]?.name ?? null
}

/** One mailbox address, rendered the way a `From` header renders it. */
function addressText(value: unknown): string | null {
  if (typeof value === 'string') return value.length === 0 ? null : value
  if (!isRecord(value)) return null
  const name = textOf(value['name'])?.trim() ?? ''
  const address = textOf(value['address'])?.trim() ?? ''
  if (address.length === 0) return name.length === 0 ? null : name
  return name.length === 0 ? address : `${name} <${address}>`
}

/** One address list, comma-joined like a header. */
function addressList(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const items = value.map(addressText).filter((entry): entry is string => entry !== null)
  return items.length === 0 ? null : items.join(', ')
}

/** Whether the server already reports the message as read. */
function seenOf(entry: Record<string, unknown>): boolean {
  if (entry['unseen'] === true) return false
  const flags = entry['flags']
  return Array.isArray(flags) ? flags.includes('\\Seen') : true
}

/**
 * Map one `messages_list` entry onto the row the Correo panel renders.
 * @param entry - one message object from the server.
 * @param context - the server, mailbox, folder, and address the listing came from.
 * @returns the row, or null when the entry carries no usable uid.
 */
export function mcpMessageRow(
  entry: Record<string, unknown>,
  context: McpMailMessageContext,
): FaberLoomInboxRow | null {
  const uidValue = entry['uid']
  const uid = typeof uidValue === 'number' ? uidValue : Number(uidValue)
  if (!Number.isSafeInteger(uid) || uid <= 0) return null
  const folder = textOf(entry['path']) ?? context.folder
  const account = mcpAccountId(context.server, context.resourceId)
  return {
    id: mcpMessageId({ server: context.server, resourceId: context.resourceId, folder, uid }),
    connectionId: account,
    account,
    source: 'mcp',
    server: context.server,
    address: context.address,
    messageId: textOf(entry['messageId']),
    from: addressText(entry['from']),
    to: addressList(entry['to']),
    cc: addressList(entry['cc']),
    subject: textOf(entry['subject']),
    date: textOf(entry['date']),
    references: null,
    seen: seenOf(entry),
  }
}

/**
 * The body `messages_text` reports.
 * @param payload - the payload the registry parsed.
 * @returns the plain text and the HTML body, when the server sent one.
 */
export function mcpText(payload: unknown): { readonly text: string; readonly html: string | null } {
  const data = mcpBody(payload)?.['data']
  if (!isRecord(data)) return { text: '', html: null }
  return { text: textOf(data['text']) ?? '', html: textOf(data['html']) }
}

/**
 * The HTTP status one write's envelope reports. The mail server answers a refused
 * write as a successful tool result carrying the API's status, so the caller has
 * to read it instead of relying on the tool-level error variant.
 * @param payload - the payload the registry parsed.
 * @returns the status, or null when the payload carries none.
 */
export function mcpStatus(payload: unknown): number | null {
  if (!isRecord(payload)) return null
  const status = payload['status']
  return typeof status === 'number' ? status : null
}

/**
 * The `Message-ID` a sent message reports, when the server returns one.
 * @param payload - the payload the registry parsed.
 * @returns the identifier, or null when the server did not confirm one.
 */
export function mcpSentId(payload: unknown): string | null {
  const data = mcpBody(payload)?.['data']
  if (!isRecord(data)) return null
  const id = textOf(data['messageId']) ?? textOf(data['message_id'])
  return id === null || id.length === 0 ? null : id
}
