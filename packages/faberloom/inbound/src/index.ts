/**
 * Native product inbound receiver (`ctx.faberloomInbound`): the component that
 * turns the owner's own mailbox into routine events.
 *
 * The owner configures an IMAP connection in Conexiones, or mounts an MCP
 * server that carries their mail; this service polls both on a timer, reads the
 * message envelopes above each durable cursor, and hands each one to the
 * routines engine's ingest. A trigger that matches the message subject
 * therefore starts its routine with nobody watching, which is what closes the
 * plan's promise that work does not stop when the panel closes.
 *
 * The first view of a mailbox stores its top as the baseline and ingests
 * nothing, so installing the watcher never answers the history. A poll keeps
 * reading past a full batch until the mailbox has nothing above its cursor, and
 * persists the cursor after each batch. A slower sweep walks the mailbox from
 * that baseline in bounded cycles and asks `hasEvent` before re-ingesting, so a
 * message the poll skipped is recovered without growing a case that already
 * holds it.
 *
 * The receiver itself polls read-only: it does not mark messages read, move
 * them, or delete them, so the owner's own mail client is unaffected. Two
 * explicit user gestures write to the mailbox through the same protocol client:
 * `markSeen` sets `\Seen` and `moveToTrash` moves the message to the Trash
 * mailbox. Idempotency is the engine's: the event key is `mail:msg:` plus the
 * message's `Message-ID` when it has one — for IMAP and MCP alike — and the
 * mailbox generation plus UID otherwise, so re-reading a message never starts a
 * run twice.
 * @module @deepseek-ai/dsh-faberloom-inbound
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type { FaberLoomConnection } from '@deepseek-ai/dsh-faberloom-connections'
import type { IngestEvent } from '@deepseek-ai/dsh-faberloom-routines'
import { LIVE_MAIL_ROUTINE, marluvasExpedienteRoutine, routineDefinitionsMatch, vpsOwnsCloudRuns } from '@deepseek-ai/dsh-faberloom-routines'
import type { RoutineInput } from '@deepseek-ai/dsh-faberloom-routines'
import type { FaberLoomMcpRegistry } from '@deepseek-ai/dsh-faberloom-mcp-registry'
import { appendMessage, fetchContent, fetchMessages, latestUid, listFolders, markMessageSeen, moveMessage, searchMessages, type ImapBodyOptions, type ImapFolder, type ImapMessage, type ImapMessageContent, type ImapOptions } from './imap.ts'
import {
  MCP_MAX_PAGES,
  MCP_MAIL_PREFIX,
  MCP_PAGE_SIZE,
  mcpCursorKey,
  mcpEventKey,
  mcpMailboxTargets,
  mcpMailConnectionId,
  mcpMessagePage,
  mcpNewestEntries,
  mcpOriginId,
  type McpMailboxTarget,
  type McpMailEntry,
} from './mcp.ts'
import { inboundDomainSpec, type CursorRecord } from './spec.ts'

export type { ImapMessage } from './imap.ts'

/** What the panel asks for: a page of a mailbox, a criterion and a query. */
export interface InboxPageOptions {
  /** Page size, capped at 500. */
  readonly limit?: number
  /** 1-based page number. */
  readonly page?: number
  /** Mailbox to read; the configured inbox otherwise. */
  readonly mailbox?: string
  /** Everything, unread only, flagged only, or the server's important/unanswered marks. */
  readonly filter?: 'all' | 'unread' | 'flagged' | 'important' | 'awaiting'
  /** Text query; empty means the mailbox's newest mail. */
  readonly query?: string
}

/** Where a mailbox write applies: the account and the folder the message lives in. */
export interface MailWriteOptions {
  /** IMAP connection, or undefined for the account's default one. */
  readonly connectionId?: string
  /** Folder holding the message; the configured inbox otherwise. */
  readonly mailbox?: string
}

/** One page of mail and the numbers a pager needs. */
export interface InboxPage {
  /** The page's envelopes, newest first. */
  readonly messages: readonly ImapMessage[]
  /** Messages the selected mailbox or criterion holds. */
  readonly total: number
  /** The page that was returned. */
  readonly page: number
  /** The page size. */
  readonly pageSize: number
  /** Whether an older page exists. */
  readonly hasNext: boolean
}
export type * from './spec.ts'
// Attachment ingestion lives with the mail reader so every consumer (the Email
// panel, the model tools) converts a document through one implementation.
export { convertAttachments, formatForAttachment, imageMediaType, markdownFromAttachments, resolveAnyDocBin, resolveOcrMode } from './documents.ts'
export type { AttachmentConversion, AttachmentSkipReason, ConvertedDocument, DocumentIngestOptions, EmailAttachmentBytes } from './documents.ts'
// Local OCR for attachments without a text layer: Tesseract for one image, and
// `pdftoppm` plus Tesseract per page for a scanned PDF.
export { ocrImage, ocrPdf, resolveOcrBinaries } from './ocr.ts'
export type { OcrBinaries, OcrFailure, OcrMode, OcrOptions, OcrOutcome } from './ocr.ts'
// A scanned Word, Excel, PowerPoint, OpenDocument, or RTF file has no text anydoc
// can read: LibreOffice renders it to PDF, then the PDF takes the same OCR path.
export { ocrOffice, resolveOfficeBin } from './office.ts'
export type { OfficeOcrOptions } from './office.ts'
export {
  PUBLIC_RESOURCE_MAX_REDIRECTS,
  fetchPublicResource,
  isBlockedAddress,
  publicAddress,
  publicUrl,
  readLimited,
} from './net-guard.ts'
export type { PublicFetchDeps, PublicFetchOptions, PublicResource, PublicResponse, ResolvedAddress } from './net-guard.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomInbound: FaberLoomInbound
  }
}

/** Deployment-supplied identity and polling policy. */
export interface Config {
  /** The owner whose mailbox this receiver reads; empty disables it. */
  ownerId?: string
  /** Whether the poller runs. A deployment can turn it off and call `runOnce` itself. */
  enabled?: boolean
  /** Milliseconds between polls. Mail arrives on its own schedule, so this is slower than the dispatcher's. */
  intervalMs?: number
  /** Mailbox to read. */
  mailbox?: string
  /** Console role; the Marluvas live routine is only provisioned for privileged roles. */
  role?: string
  /** Most messages one poll batch reads, oldest first. */
  maxMessages?: number
  /** Most messages one sweep batch reads, oldest first. */
  sweepBatch?: number
  /** Milliseconds between head sweeps that recover messages the cursor skipped. */
  sweepIntervalMs?: number
  /** Milliseconds before a mailbox connection is abandoned. */
  timeoutMs?: number
}

/** Schemastery configuration for the inbound receiver. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  enabled: z.boolean(),
  intervalMs: z.number(),
  mailbox: z.string(),
  role: z.string().default(''),
  maxMessages: z.number(),
  sweepBatch: z.number(),
  sweepIntervalMs: z.number(),
  timeoutMs: z.number(),
})

/** The mailbox credentials the connections service hands the receiver. */
interface MailboxCredentials {
  /** Connection id the cursor is keyed by. */
  readonly id: string
  /** Display label the owner gave the connection. */
  readonly label: string
  /** Server host. */
  readonly host: string
  /** Server port. */
  readonly port: number
  /** Whether the connection starts TLS immediately. */
  readonly secure: boolean
  /** Whether the connection upgrades with STARTTLS. */
  readonly starttls: boolean
  /** Account name. */
  readonly username: string
  /** Account password. */
  readonly password: string
}

/** Shortest poll interval the receiver accepts. */
export const MIN_INTERVAL_MS = 10_000

/** Messages a sweep batch reads before the next pass continues the walk. */
const DEFAULT_SWEEP_BATCH = 200

/** Largest sweep batch the receiver accepts. */
export const MAX_SWEEP_BATCH = 1_000

/** Longest connection wait the receiver accepts. */
export const MAX_TIMEOUT_MS = 60_000

/** What one account's poll did. */
export interface InboundAccountReport {
  /** Connection the pass read. */
  readonly connectionId: string
  /** Connection label the account carries. */
  readonly mailbox: string
  /** Messages read from this account this pass. */
  readonly read: number
  /** Runs this pass started for this account, as `<routineId>:<key>`. */
  readonly started: readonly string[]
  /** Failure this account reported, or null. */
  readonly error: string | null
}

/** What one poll did. */
export interface InboundReport {
  /** Why the poll did nothing, when it did nothing. */
  readonly skipped: string | null
  /** Connection labels the poll read, or null when it read none. */
  readonly mailbox: string | null
  /** Messages read from every account this pass. */
  readonly read: number
  /** Runs this pass started, as `<routineId>:<key>`. */
  readonly started: readonly string[]
  /** Failures the accounts reported, joined; null when every account was read. */
  readonly error: string | null
  /** Per-account outcome: one failing mailbox never hides the others. */
  readonly accounts: readonly InboundAccountReport[]
}

/** What one chatbot search reported: matches, account, and coverage. */
export interface MailboxSearch {
  /** Matching envelopes, newest first. */
  readonly messages: readonly ImapMessage[]
  /** Connection the search ran against. */
  readonly connectionId: string
  /** Whether the search covered the whole mailbox. */
  readonly complete: boolean
  /** Envelopes whose headers were examined. */
  readonly scanned: number
  /** Envelopes the mailbox holds, when the path listed them. */
  readonly total: number | null
  /** Matches found before the result limit. */
  readonly matched: number
}

/** The owner's mailbox as a source of routine events. */
export class FaberLoomInbound extends Service {
  static inject = ['faberloomRoutines', 'storageDomain']

  private domainPromise: Promise<Domain<typeof inboundDomainSpec>> | undefined
  private running = false
  /** Instant of the last head sweep per connection, in epoch milliseconds. */
  private readonly sweptAt = new Map<string, number>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - identity and polling policy.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomInbound')
    const interval = this.config.intervalMs ?? 300_000
    const timeout = this.config.timeoutMs ?? 15_000
    if (!Number.isSafeInteger(interval) || interval < MIN_INTERVAL_MS) {
      throw new Error(`faberloom: inbound intervalMs must be a whole number of at least ${String(MIN_INTERVAL_MS)} ms`)
    }
    if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT_MS) {
      throw new Error(`faberloom: inbound timeoutMs must be between 1000 and ${String(MAX_TIMEOUT_MS)} ms`)
    }
    const sweep = this.config.sweepIntervalMs ?? 300_000
    if (!Number.isSafeInteger(sweep) || sweep < MIN_INTERVAL_MS) {
      throw new Error(`faberloom: inbound sweepIntervalMs must be a whole number of at least ${String(MIN_INTERVAL_MS)} ms`)
    }
    const batch = this.config.sweepBatch ?? DEFAULT_SWEEP_BATCH
    if (!Number.isSafeInteger(batch) || batch < 1 || batch > MAX_SWEEP_BATCH) {
      throw new Error(`faberloom: inbound sweepBatch must be a whole number between 1 and ${String(MAX_SWEEP_BATCH)}`)
    }
    /* jscpd:ignore-start -- the timer/effect dispatch skeleton mirrors the executions dispatcher; separate cadences and log lines */
    if (this.config.enabled !== true || (this.config.ownerId ?? '').length === 0) return
    this.ctx.effect(() => {
      const timer = setInterval(() => {
        void this.runOnce().catch((error: unknown) => {
          this.ctx.logger.warn(`faberloom: inbound poll failed: ${String(error)}`)
        })
      }, interval)
      return () => { clearInterval(timer) }
    }, 'faberloom.inbound.poller')
    /* jscpd:ignore-end */
  }

  /**
   * Poll the owner's mailbox once.
   * @param now - the instant this pass considers current.
   * @returns what the pass read and started.
   */
  async runOnce(now: Date = new Date()): Promise<InboundReport> {
    const ownerId = this.config.ownerId ?? ''
    if (ownerId.length === 0) return empty('no owner configured')
    if (this.running) return empty('another poll is running')
    this.running = true
    try {
      try {
        await this.ensureLiveMailRoutine(ownerId)
      } catch (error: unknown) {
        this.ctx.logger.warn(`faberloom: live mail routine provisioning failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return await this.poll(ownerId, now)
    } finally {
      this.running = false
    }
  }

  /**
   * Whether this owner is a privileged Marluvas mailbox operator: an admin/CEO
   * role whose saved IMAP account is one of the two shared operations mailboxes.
   * @param connections - the owner's saved connections.
   * @returns true when the Marluvas live routine should replace the generic one.
   */
  private isMarluvasMailbox(connections: readonly FaberLoomConnection[]): boolean {
    const role = (this.config.role ?? '').toLowerCase()
    if (role !== 'admin' && role !== 'superadmin' && role !== 'ceo') return false
    const allowlist = new Set(['alvaro@muitowork.com', '506@muitowork.com'])
    return connections.some(connection => connection.kind === 'imap'
      && typeof connection.username === 'string'
      && allowlist.has(connection.username.trim().toLowerCase()))
  }

  /**
   * Provision and activate the built-in live mail routines once the owner has a
   * mailbox the watcher can read: an IMAP connection, or a mounted MCP server
   * that publishes the mail tools. This is the path that covers connections
   * saved outside the Connections panel, so the routines are always present for
   * every configured mailbox.
   *
   * The reply routine and the Marluvas operator are separate: one leaves drafts,
   * the other keeps the expediente current, and each converges on its own name
   * so neither replaces the other. The operator still needs the privileged IMAP
   * mailbox: an MCP mailbox is an ordinary account, not the operations one.
   * @param ownerId - the owning identity.
   */
  private async ensureLiveMailRoutine(ownerId: string): Promise<void> {
    const connections = this.ctx.get('faberloomConnections')
    const list = connections === undefined ? [] : await connections.list(ownerId)
    if (!list.some(connection => connection.kind === 'imap') && !(await this.hasMcpMailServer(ownerId))) return
    await this.ensureRoutine(ownerId, LIVE_MAIL_ROUTINE)
    if (this.isMarluvasMailbox(list)) await this.ensureRoutine(ownerId, marluvasExpedienteRoutine())
  }

  /**
   * Whether one owner has an enabled MCP server that publishes the mail tools,
   * so the reply routine runs even with no IMAP connection.
   * @param ownerId - the owning identity.
   * @returns true when a mail server is mounted for this owner.
   */
  private async hasMcpMailServer(ownerId: string): Promise<boolean> {
    const registry = this.ctx.get('faberloomMcpRegistry')
    if (registry === undefined) return false
    for (const server of await registry.list(ownerId)) {
      if (!server.enabled) continue
      try {
        if ((await mcpMailboxTargets(registry, ownerId, server.name)).length > 0) return true
      } catch (error: unknown) {
        this.ctx.logger.warn(`faberloom: mcp server ${server.name} could not be inspected: ${detailOf(error)}`)
      }
    }
    return false
  }

  /**
   * Create, update, and activate one built-in routine by its stable name.
   * @param ownerId - the owning identity.
   * @param input - the routine the product provisions.
   */
  private async ensureRoutine(ownerId: string, input: RoutineInput): Promise<void> {
    const routines = this.ctx.faberloomRoutines
    const existing = (await routines.listRoutines(ownerId)).find(routine => routine.name === input.name)
    if (existing === undefined) {
      const created = await routines.createRoutine(ownerId, input)
      await routines.activateRoutine(ownerId, created.id)
      return
    }
    if (!routineDefinitionsMatch(existing.definition, input.definition)) {
      await routines.updateRoutine(ownerId, existing.id, input)
    }
    if (existing.status !== 'active') await routines.activateRoutine(ownerId, existing.id)
  }

  /**
   * List the owner's mailbox envelopes, newest first, without mutating the
   * mailbox. Read-only: never marks, moves, or deletes mail.
   * @param ownerId - the owning identity.
   * @param limit - most envelopes to return.
   * @param connectionId - the mail connection to read, or undefined for the default one.
   * @returns the envelopes, or an empty list when no mailbox is configured.
   */
  async listInbox(ownerId: string, limit?: number, connectionId?: string): Promise<ImapMessage[]> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return []
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) return []
    const max = limit ?? 25
    const found = await searchMessages({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: this.config.mailbox ?? 'INBOX',
      query: '',
      maxMessages: max,
      scanMessages: max,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    })
    return [...found.messages]
  }

  /**
   * One page of a mailbox, with the numbers a pager needs.
   * @param ownerId - the owning identity.
   * @param options - page, folder, criterion and query.
   * @param connectionId - the mail connection to read, or undefined for the default one.
   * @returns the page and its totals.
   */
  async listPage(ownerId: string, options: InboxPageOptions, connectionId?: string): Promise<InboxPage> {
    const connections = this.ctx.get('faberloomConnections')
    const empty: InboxPage = { messages: [], total: 0, page: 1, pageSize: 50, hasNext: false }
    if (connections === undefined) return empty
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) return empty
    const pageSize = Math.min(500, Math.max(1, Math.trunc(options.limit ?? 50)))
    const page = Math.max(1, Math.trunc(options.page ?? 1))
    const found = await searchMessages({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: options.mailbox ?? this.config.mailbox ?? 'INBOX',
      query: options.query ?? '',
      filter: options.filter ?? 'all',
      maxMessages: pageSize,
      scanMessages: pageSize,
      offset: (page - 1) * pageSize,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    })
    return {
      messages: [...found.messages],
      total: found.total ?? found.messages.length,
      page,
      pageSize,
      hasNext: found.hasNext,
    }
  }

  /**
   * List the mailboxes of one account, read-only. A failing account returns its
   * error to the caller; it never pretends to have no folders.
   * @param ownerId - the owning identity.
   * @param connectionId - the connection to list, or undefined for the default one.
   * @returns the mailboxes the server advertised.
   */
  async listFolders(ownerId: string, connectionId?: string): Promise<ImapFolder[]> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return []
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) return []
    return await listFolders({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: this.config.mailbox ?? 'INBOX',
      timeoutMs: this.config.timeoutMs ?? 15_000,
      since: null,
      maxMessages: 1,
    })
  }

  /**
   * Read one mailbox message's body, read-only.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param connectionId - the mail connection to read, or undefined for the default one.
   * @param mailbox - mailbox the message lives in; the configured inbox otherwise.
   * @returns the decoded body, or null when no mailbox is configured or the message has no body.
   */
  async readEmail(ownerId: string, uid: number, connectionId?: string, mailbox?: string): Promise<ImapMessageContent> {
    const empty: ImapMessageContent = { text: '', html: null, attachments: [] }
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return empty
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) return empty
    return await fetchContent({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: mailbox ?? this.config.mailbox ?? 'INBOX',
      uid,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    })
  }

  /**
   * Append one sent message to the account's Sent mailbox, marked seen.
   * Best effort by design: the message already left, so a copy failure is
   * reported to the caller without turning a successful send into a failure.
   * @param ownerId - the owning identity.
   * @param raw - the exact RFC 5322 message.
   * @param account - mailbox address the draft left from; the primary otherwise.
   * @returns the mailbox name, or null when no Sent folder or connection exists.
   */
  async appendSent(ownerId: string, raw: string, account?: string): Promise<string | null> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return null
    const rows = await connections.list(ownerId)
    const mailbox = account === undefined
      ? rows.find(row => row.kind === 'imap' && row.primary) ?? rows.find(row => row.kind === 'imap')
      : rows.find(row => row.kind === 'imap' && row.username === account)
    if (mailbox === undefined) return null
    const credentials = await connections.imap(ownerId, mailbox.id)
    if (credentials === undefined) return null
    const options = {
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: this.config.mailbox ?? 'INBOX',
      since: null,
      maxMessages: 1,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    }
    const folders = await listFolders(options)
    const sent = folders.find(folder => folder.specialUse === 'sent')
    if (sent === undefined) return null
    await appendMessage({ ...options, mailbox: sent.name }, raw)
    return sent.name
  }

  /**
   * Mailbox writes the owner performs from the panel. Tools and routine steps
   * keep calling {@link markSeen} and {@link moveToTrash}, which refuse: the
   * agent never mutates a mailbox on its own.
   */
  private async writeOptions(
    ownerId: string,
    uid: number,
    options: MailWriteOptions,
  ): Promise<ImapBodyOptions | undefined> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return undefined
    const credentials = await connections.imap(ownerId, options.connectionId)
    if (credentials === undefined) return undefined
    return {
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: options.mailbox ?? this.config.mailbox ?? 'INBOX',
      uid,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    }
  }

  /** The account's Trash and Inbox names, or the reason they are missing. */
  private async mailboxRoles(
    ownerId: string,
    connectionId: string | undefined,
  ): Promise<{ trash: string; inbox: string }> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) throw new Error('faberloom: no hay conexiones de correo configuradas')
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) throw new Error('faberloom: la cuenta no tiene una conexión de entrada')
    const folders = await listFolders({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: this.config.mailbox ?? 'INBOX',
      since: null,
      maxMessages: 1,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    })
    const trash = folders.find(folder => folder.specialUse === 'trash')
    if (trash === undefined) {
      throw new Error('faberloom: NO_TRASH_FOLDER - el servidor no declara una carpeta de papelera')
    }
    const inbox = folders.find(folder => folder.specialUse === 'inbox')
    return { trash: trash.name, inbox: inbox?.name ?? this.config.mailbox ?? 'INBOX' }
  }

  /**
   * Mark or unmark one message as read, on the owner's explicit gesture.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param options - connection and mailbox the message lives in.
   * @param seen - true marks read; false marks unread.
   * @returns true after the server accepts the flag change.
   */
  async markSeenFromOwner(
    ownerId: string,
    uid: number,
    options: MailWriteOptions = {},
    seen: boolean = true,
  ): Promise<boolean> {
    const settings = await this.writeOptions(ownerId, uid, options)
    if (settings === undefined) throw new Error('faberloom: la cuenta no tiene una conexión de entrada')
    return await markMessageSeen(settings, seen)
  }

  /**
   * Move one message to another folder of the same account, on the owner's gesture.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param destination - target mailbox name as the server spells it.
   * @param options - connection and source mailbox.
   * @returns the destination mailbox name.
   */
  async moveFromOwner(
    ownerId: string,
    uid: number,
    destination: string,
    options: MailWriteOptions = {},
  ): Promise<string> {
    const settings = await this.writeOptions(ownerId, uid, options)
    if (settings === undefined) throw new Error('faberloom: la cuenta no tiene una conexión de entrada')
    if (settings.mailbox === destination) return destination
    await moveMessage(settings, destination)
    return destination
  }

  /**
   * Move one message to the account's Trash folder.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param options - connection and source mailbox.
   * @returns the Trash folder name.
   */
  async trashFromOwner(ownerId: string, uid: number, options: MailWriteOptions = {}): Promise<string> {
    const roles = await this.mailboxRoles(ownerId, options.connectionId)
    return await this.moveFromOwner(ownerId, uid, roles.trash, options)
  }

  /**
   * Restore one message from Trash back to the account's Inbox, so a misclick
   * is recoverable with the same bytes and the original `Message-ID`.
   * @param ownerId - the owning identity.
   * @param uid - the message UID in Trash.
   * @param options - connection and source mailbox; Trash by default.
   * @returns the destination mailbox name.
   */
  async restoreFromOwner(ownerId: string, uid: number, options: MailWriteOptions = {}): Promise<string> {
    const roles = await this.mailboxRoles(ownerId, options.connectionId)
    return await this.moveFromOwner(ownerId, uid, roles.inbox, {
      ...options,
      mailbox: options.mailbox ?? roles.trash,
    })
  }

  /**
   * Refuse a flag change requested by a tool or a routine step.
   *
   * The agent never mutates a mailbox on its own: marking a message read is a
   * write, and the person performs it from the Correo panel, which calls
   * {@link markSeenFromOwner} instead.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param connectionId - the mail connection, or undefined for the primary one.
   * @returns never; the call refuses.
   * @throws always, with `WRITE_NOT_APPROVED`.
   */
  async markSeen(ownerId: string, uid: number, connectionId?: string): Promise<boolean> {
    void ownerId
    void uid
    void connectionId
    return await Promise.reject(new Error('faberloom: WRITE_NOT_APPROVED - el agente no marca correos; la persona lo hace desde Correo'))
  }

  /**
   * Refuse a move requested by a tool or a routine step.
   *
   * Moving writes the mailbox (COPY + STORE + EXPUNGE); only the owner touches
   * their mail, through the panel.
   * @param ownerId - the owning identity.
   * @param uid - the message UID.
   * @param connectionId - the mail connection, or undefined for the primary one.
   * @returns never; the call refuses.
   * @throws always, with `WRITE_NOT_APPROVED`.
   */
  async moveToTrash(ownerId: string, uid: number, connectionId?: string): Promise<string> {
    void ownerId
    void uid
    void connectionId
    return await Promise.reject(new Error('faberloom: WRITE_NOT_APPROVED - el agente no mueve correos; la persona lo hace desde Correo'))
  }

  private async poll(ownerId: string, now: Date): Promise<InboundReport> {
    const connections = this.ctx.get('faberloomConnections')
    const mailboxes = connections === undefined
      ? []
      : (await connections.list(ownerId)).filter(connection => connection.kind === 'imap')
    const accounts: InboundAccountReport[] = []
    for (const mailbox of mailboxes) accounts.push(await this.pollAccount(ownerId, mailbox, now))
    accounts.push(...await this.pollMcp(ownerId, now))
    if (accounts.length === 0) return empty('no mailbox configured')

    const failed = accounts.filter(account => account.error !== null)
    return {
      skipped: null,
      mailbox: accounts.map(account => account.mailbox).join(', '),
      read: accounts.reduce((total, account) => total + account.read, 0),
      started: accounts.flatMap(account => account.started),
      error: failed.length === 0
        ? null
        : failed.map(account => `${account.mailbox}: ${account.error ?? ''}`).join('; '),
      accounts,
    }
  }

  /**
   * Read one account and ingest what arrived since its own cursor.
   *
   * A failing account keeps the cursor of its last complete batch, so the next
   * pass retries exactly what it did not read. Re-reading is safe: the event key
   * carries the message's own id, so the routine engine dedupes the repeat
   * instead of starting the same work twice.
   * @param ownerId - the owning identity.
   * @param mailbox - the saved IMAP connection to read.
   * @param now - the instant this pass considers current.
   * @returns what this account read and started, or why it failed.
   */
  private async pollAccount(
    ownerId: string,
    mailbox: { readonly id: string; readonly label: string },
    now: Date,
  ): Promise<InboundAccountReport> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) {
      return { connectionId: mailbox.id, mailbox: mailbox.label, read: 0, started: [], error: 'no connections service' }
    }
    let credentials: MailboxCredentials | undefined
    try {
      credentials = await connections.imap(ownerId, mailbox.id)
    } catch (error: unknown) {
      return { connectionId: mailbox.id, mailbox: mailbox.label, read: 0, started: [], error: detailOf(error) }
    }
    if (credentials === undefined) {
      return { connectionId: mailbox.id, mailbox: mailbox.label, read: 0, started: [], error: 'mailbox row is incomplete' }
    }

    const table = await this.cursors()
    const progress: AccountProgress = { read: 0, started: [] }
    let cursor: CursorRecord
    try {
      const stored = table.get(credentials.id)
      cursor = stored === undefined
        ? await this.fixBaseline(table, credentials, ownerId, now)
        : await this.pollNew(ownerId, credentials, stored, now, progress)
    } catch (error: unknown) {
      const detail = detailOf(error)
      this.ctx.logger.warn(`faberloom: mailbox ${credentials.label} could not be read: ${detail}`)
      return { connectionId: credentials.id, mailbox: credentials.label, read: progress.read, started: progress.started, error: detail }
    }
    if (this.sweepDue(credentials.id, now)) await this.sweepAccount(ownerId, credentials, cursor, now, progress.started)
    return { connectionId: credentials.id, mailbox: credentials.label, read: progress.read, started: progress.started, error: null }
  }

  /**
   * Fix one connection's baseline at the mailbox top.
   *
   * Installing the watcher is not a reason to answer yesterday's mail: nothing
   * already in the mailbox is a new event, and the sweep's durable walk starts
   * at this baseline instead of resurrecting the history.
   * @param table - the cursor table.
   * @param credentials - the mailbox to read.
   * @param ownerId - the owning identity.
   * @param now - the instant this pass considers current.
   * @returns the cursor row it stored.
   */
  private async fixBaseline(
    table: KvTable<string, CursorRecord>,
    credentials: MailboxCredentials,
    ownerId: string,
    now: Date,
  ): Promise<CursorRecord> {
    const top = await latestUid(readOptions(credentials, null, 1, this.config))
    const record: CursorRecord = {
      ownerId,
      connectionId: credentials.id,
      lastUid: top.uid,
      uidValidity: top.uidValidity,
      baselineUid: top.uid,
      sweepUid: top.uid,
      updatedAt: now.toISOString(),
    }
    await table.put(credentials.id, record)
    this.ctx.logger.info(`faberloom: mailbox ${credentials.label} baseline at UID ${String(top.uid)}`)
    return record
  }

  /**
   * Read one account's new mail in batches, from its cursor to the top.
   *
   * A full batch is not the end: the next read continues above the highest UID
   * just ingested, and the cursor is persisted after each batch, so an
   * interrupted pass resumes at its last complete batch instead of re-reading
   * the whole gap.
   * @param ownerId - the owning identity.
   * @param credentials - the mailbox to read.
   * @param cursor - the connection's stored cursor.
   * @param now - the instant this pass considers current.
   * @param progress - what this account read and started so far.
   * @returns the cursor row the pass left behind.
   */
  private async pollNew(
    ownerId: string,
    credentials: MailboxCredentials,
    cursor: CursorRecord,
    now: Date,
    progress: AccountProgress,
  ): Promise<CursorRecord> {
    const table = await this.cursors()
    const batchSize = this.config.maxMessages ?? 20
    let current = cursor
    let since = current.lastUid
    for (;;) {
      const fetched = await fetchMessages(readOptions(credentials, since, batchSize, this.config, current.uidValidity))
      // A changed mailbox identity reassigns every UID: the stored numbers name
      // other messages, so the baseline moves to the new top and the mailbox is
      // not read as if all of it were new.
      if (fetched.reset) {
        const reset = await this.fixBaseline(table, credentials, ownerId, now)
        this.ctx.logger.info(`faberloom: mailbox ${credentials.label} changed UIDVALIDITY; baseline moved to its top`)
        return reset
      }
      // `UID SEARCH UID n:*` answers with the highest UID even when it is below
      // `n`; those messages are already history, not this batch.
      const messages = fetched.messages.filter(message => message.uid > since)
      if (messages.length === 0) return current
      for (const message of messages) {
        await this.ingestMessage(ownerId, credentials, message, fetched.uidValidity, now, progress.started)
      }
      const highest = messages.reduce((max, message) => Math.max(max, message.uid), since)
      current = {
        ...current,
        lastUid: highest,
        uidValidity: fetched.uidValidity ?? current.uidValidity,
        updatedAt: now.toISOString(),
      }
      await table.put(credentials.id, current)
      progress.read += messages.length
      if (messages.length < batchSize) return current
      since = highest
    }
  }

  /**
   * Turn one envelope into a routine event. A message with a `Message-ID` is
   * identified by that id alone, so the same mail delivered to several mailboxes
   * or read through both transports starts one run; the event still names the
   * mailbox, uid, and connection the reported copy came from.
   * @param ownerId - the owning identity.
   * @param credentials - the mailbox the message was read from.
   * @param message - the envelope.
   * @param uidValidity - the mailbox generation reported with this read.
   * @param now - the instant this pass considers current.
   * @param started - executions this pass started.
   */
  private async ingestMessage(
    ownerId: string,
    credentials: MailboxCredentials,
    message: ImapMessage,
    uidValidity: number | null | undefined,
    now: Date,
    started: string[],
  ): Promise<void> {
    const event: IngestEvent = {
      key: imapEventKey(credentials.id, uidValidity, message),
      type: 'email',
      ...message.subject === null ? {} : { subject: message.subject },
      data: {
        mailbox: credentials.label,
        connectionId: credentials.id,
        uid: message.uid,
        from: message.from,
        date: message.date,
        receivedAt: now.toISOString(),
      },
    }
    // A desktop mirroring to the VPS reads the same mailbox the VPS reads;
    // the VPS owns the mail-triggered runs of cloud-ready routines, so the
    // same message never starts the same routine on both.
    for (const result of await this.ctx.faberloomRoutines.ingest(ownerId, event, { skipCloudReady: vpsOwnsCloudRuns() })) {
      if (!result.deduped) started.push(`${String(result.execution.routineId)}:${event.key}`)
    }
  }

  /** Whether this mailbox is due for a head sweep. */
  private sweepDue(connectionId: string, now: Date): boolean {
    const last = this.sweptAt.get(connectionId)
    if (last === undefined) {
      this.sweptAt.set(connectionId, now.getTime())
      return false
    }
    const interval = this.config.sweepIntervalMs ?? 300_000
    return now.getTime() - last >= interval
  }

  /**
   * Continue the durable sweep: one bounded read of the mailbox from the last
   * UID it reached, so every message is eventually ingested, read or not,
   * whatever its date.
   *
   * The walk is a cycle. Each pass reads at most `sweepBatch` messages above
   * `sweepUid` and advances it to the highest UID of the batch; a pass that
   * finds nothing resets `sweepUid` to the cycle's floor, and the next cycle
   * starts again from there. The floor is the install baseline, except on a
   * cursor written before the baseline existed: that one starts at the first
   * message and skips only mail at or below its old cursor that was already
   * read, so unread backlog the old sweep never reached still gets its event.
   * `hasEvent` skips what a poll or an earlier cycle already delivered, so
   * re-reading never appends the same evidence twice.
   * @param ownerId - the owning identity.
   * @param credentials - the mailbox to sweep.
   * @param cursor - the cursor row the poll of this pass left behind.
   * @param now - the instant this pass considers current.
   * @param started - executions this pass started.
   */
  private async sweepAccount(
    ownerId: string,
    credentials: MailboxCredentials,
    cursor: CursorRecord,
    now: Date,
    started: string[],
  ): Promise<void> {
    this.sweptAt.set(credentials.id, now.getTime())
    const table = await this.cursors()
    const baseline = cursor.baselineUid ?? cursor.lastUid
    // A cursor written before the baseline existed has no safe floor below
    // `lastUid`: the owner may still hold unread mail the old sweep never
    // reached. Walk from the first message and skip only what was already read.
    const legacy = cursor.baselineUid === undefined
    const floor = legacy ? 0 : baseline
    const since = cursor.sweepUid ?? floor
    let fetched: Awaited<ReturnType<typeof fetchMessages>>
    try {
      fetched = await fetchMessages(readOptions(credentials, since, this.sweepBatch(), this.config, cursor.uidValidity))
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: mailbox ${credentials.label} sweep failed: ${detailOf(error)}`)
      return
    }
    // The poll of this same pass fixed the baseline of a changed generation
    // before the sweep read this cursor, so this re-check is defensive.
    /* v8 ignore next -- unreachable inside one pass: the poll re-baselines a changed generation first */
    if (fetched.reset) { await this.fixBaseline(table, credentials, ownerId, now); return }
    const messages = fetched.messages.filter(message => message.uid > since)
    if (messages.length === 0) {
      // The walk reached the top: the next cycle starts at its floor.
      await table.put(credentials.id, { ...cursor, sweepUid: floor, updatedAt: now.toISOString() })
      return
    }
    for (const message of messages) {
      // History that predates the install is not new work, but unread history
      // is mail the owner never saw: it still gets its event.
      if (legacy && message.uid <= baseline && message.seen) continue
      if (await this.ctx.faberloomRoutines.hasEvent(ownerId, imapEventKey(credentials.id, fetched.uidValidity, message))) continue
      await this.ingestMessage(ownerId, credentials, message, fetched.uidValidity, now, started)
    }
    await table.put(credentials.id, {
      ...cursor,
      sweepUid: messages.reduce((max, message) => Math.max(max, message.uid), since),
      uidValidity: fetched.uidValidity ?? cursor.uidValidity,
      updatedAt: now.toISOString(),
    })
  }

  /**
   * Poll every mounted MCP mail server of this owner.
   *
   * A server or mailbox that fails becomes its own report entry and the rest
   * still run, exactly like the IMAP accounts: one unreachable server never
   * hides the mailbox that answered.
   * @param ownerId - the owning identity.
   * @param now - the instant this pass considers current.
   * @returns one report entry per watched mailbox, plus one per failure.
   */
  private async pollMcp(ownerId: string, now: Date): Promise<InboundAccountReport[]> {
    const registry = this.ctx.get('faberloomMcpRegistry')
    if (registry === undefined) return []
    const accounts: InboundAccountReport[] = []
    for (const server of await registry.list(ownerId)) {
      if (!server.enabled) continue
      let targets: readonly McpMailboxTarget[]
      try {
        targets = await mcpMailboxTargets(registry, ownerId, server.name)
      } catch (error: unknown) {
        const detail = detailOf(error)
        this.ctx.logger.warn(`faberloom: mcp server ${server.name} could not be read: ${detail}`)
        accounts.push({ connectionId: `${MCP_MAIL_PREFIX}${server.name}`, mailbox: server.name, read: 0, started: [], error: detail })
        continue
      }
      for (const target of targets) {
        try {
          accounts.push(await this.watchMcpMailbox(ownerId, registry, target, now))
        } catch (error: unknown) {
          const detail = detailOf(error)
          this.ctx.logger.warn(`faberloom: mcp mailbox ${target.address} could not be read: ${detail}`)
          accounts.push({
            connectionId: mcpMailConnectionId(target.server, target.resourceId),
            mailbox: target.address,
            read: 0,
            started: [],
            error: detail,
          })
        }
      }
    }
    return accounts
  }

  /**
   * Watch one MCP mailbox: fix its baseline on the first view, then read what
   * arrived above its cursor and sweep the newest mail on the sweep cadence.
   * @param ownerId - the owning identity.
   * @param registry - the mounted MCP registry.
   * @param target - the server, mailbox, and folder to read.
   * @param now - the instant this pass considers current.
   * @returns what this mailbox read and started this pass.
   */
  private async watchMcpMailbox(
    ownerId: string,
    registry: FaberLoomMcpRegistry,
    target: McpMailboxTarget,
    now: Date,
  ): Promise<InboundAccountReport> {
    const connectionId = mcpMailConnectionId(target.server, target.resourceId)
    const table = await this.cursors()
    const key = mcpCursorKey(target)
    const cursor = table.get(key)
    const progress: AccountProgress = { read: 0, started: [] }
    let baseline: number
    if (cursor === undefined) {
      // First view: the mailbox already had mail. Its top is the baseline, so
      // installing the watcher never answers the history.
      const newest = await mcpMessagePage(registry, ownerId, target, 1, 1)
      baseline = newest.entries[0]?.uid ?? 0
      await table.put(key, {
        ownerId,
        connectionId,
        lastUid: baseline,
        uidValidity: null,
        baselineUid: baseline,
        sweepUid: baseline,
        updatedAt: now.toISOString(),
      })
      this.ctx.logger.info(`faberloom: mcp mailbox ${target.address} baseline at uid ${String(baseline)}`)
    } else {
      await this.pollMcpNew(ownerId, registry, target, cursor, now, progress)
      baseline = cursor.baselineUid ?? cursor.lastUid
    }
    if (this.sweepDue(key, now)) await this.sweepMcp(ownerId, registry, target, baseline, now, progress.started)
    return { connectionId, mailbox: target.address, read: progress.read, started: progress.started, error: null }
  }

  /**
   * Read the messages above one MCP mailbox's cursor, newest page first.
   *
   * Pages are walked until a UID at or below the cursor appears, the last page
   * is reached, or the pass hits its page budget; the entries are then ingested
   * oldest first. A hole larger than one pass leaves its older mail to the
   * sweep, which re-reads the newest window every cycle.
   * @param ownerId - the owning identity.
   * @param registry - the mounted MCP registry.
   * @param target - the mailbox to read.
   * @param cursor - the mailbox's stored cursor.
   * @param now - the instant this pass considers current.
   * @param progress - what this mailbox read and started so far.
   */
  private async pollMcpNew(
    ownerId: string,
    registry: FaberLoomMcpRegistry,
    target: McpMailboxTarget,
    cursor: CursorRecord,
    now: Date,
    progress: AccountProgress,
  ): Promise<void> {
    const collected: McpMailEntry[] = []
    for (let page = 1; page <= MCP_MAX_PAGES; page += 1) {
      const listed = await mcpMessagePage(registry, ownerId, target, page, MCP_PAGE_SIZE)
      const fresh = listed.entries.filter(entry => entry.uid > cursor.lastUid)
      collected.push(...fresh)
      const reachedCursor = fresh.length < listed.entries.length
      const lastPage = listed.totalPages !== null && page >= listed.totalPages
      if (reachedCursor || lastPage || listed.entries.length < MCP_PAGE_SIZE) break
    }
    // Oldest first: a run sees the messages in the order the mailbox received them.
    collected.sort((left, right) => left.uid - right.uid)
    for (const entry of collected) {
      if (await this.ctx.faberloomRoutines.hasEvent(ownerId, mcpEventKey(target, entry))) continue
      await this.ingestMcp(ownerId, target, entry, now, progress.started)
    }
    progress.read = collected.length
    const highest = collected.at(-1)?.uid
    if (highest === undefined) return
    await (await this.cursors()).put(mcpCursorKey(target), { ...cursor, lastUid: highest, updatedAt: now.toISOString() })
  }

  /**
   * Sweep one MCP mailbox: re-read its newest `sweepBatch` messages, read or
   * not, and ingest the ones above the baseline that no earlier pass delivered,
   * oldest first. Mail already in the mailbox when the watcher was installed
   * stays history.
   * @param ownerId - the owning identity.
   * @param registry - the mounted MCP registry.
   * @param target - the mailbox to sweep.
   * @param baseline - highest UID the mailbox held when the watcher was installed.
   * @param now - the instant this pass considers current.
   * @param started - executions this pass started.
   */
  private async sweepMcp(
    ownerId: string,
    registry: FaberLoomMcpRegistry,
    target: McpMailboxTarget,
    baseline: number,
    now: Date,
    started: string[],
  ): Promise<void> {
    this.sweptAt.set(mcpCursorKey(target), now.getTime())
    const entries = await mcpNewestEntries(registry, ownerId, target, this.sweepBatch())
    for (const entry of [...entries].reverse()) {
      if (entry.uid <= baseline) continue
      if (await this.ctx.faberloomRoutines.hasEvent(ownerId, mcpEventKey(target, entry))) continue
      await this.ingestMcp(ownerId, target, entry, now, started)
    }
  }

  /**
   * Turn one MCP message into a routine event. The event carries the synthetic
   * `originId` the reply tools read and draft by, and the same `mail:msg:` key an
   * IMAP read of the same mail produces.
   * @param ownerId - the owning identity.
   * @param target - the mailbox the message was read from.
   * @param entry - the listed envelope.
   * @param now - the instant this pass considers current.
   * @param started - executions this pass started.
   */
  private async ingestMcp(
    ownerId: string,
    target: McpMailboxTarget,
    entry: McpMailEntry,
    now: Date,
    started: string[],
  ): Promise<void> {
    const event: IngestEvent = {
      key: mcpEventKey(target, entry),
      type: 'email',
      ...entry.subject === null ? {} : { subject: entry.subject },
      data: {
        origin: 'mcp',
        originId: mcpOriginId(target, entry.uid),
        server: target.server,
        resourceId: target.resourceId,
        folder: target.folder,
        uid: entry.uid,
        mailbox: target.address,
        connectionId: mcpMailConnectionId(target.server, target.resourceId),
        from: entry.from,
        to: entry.to,
        cc: entry.cc,
        messageId: entry.messageId,
        date: entry.date,
        receivedAt: now.toISOString(),
      },
    }
    for (const result of await this.ctx.faberloomRoutines.ingest(ownerId, event, { skipCloudReady: vpsOwnsCloudRuns() })) {
      if (!result.deduped) started.push(`${String(result.execution.routineId)}:${event.key}`)
    }
  }

  /** Messages one sweep batch reads. */
  private sweepBatch(): number {
    return this.config.sweepBatch ?? DEFAULT_SWEEP_BATCH
  }

  /**
   * Search the owner's mailbox envelopes from the chat, newest first.
   *
   * Read-only like the poller: it neither advances the receiver's cursor nor
   * touches the mailbox flags, so searching never hides mail from the triggers.
   * The result states how much of the mailbox the search covered, so a caller
   * never reports a partial scan as exhaustive.
   * @param ownerId - the owning identity.
   * @param query - text to look for; empty returns the newest envelopes.
   * @param limit - most envelopes returned.
   * @param connectionId - a specific IMAP connection, or undefined for the
   *   primary mailbox.
   * @returns the matching envelopes, their account, and the coverage.
   */
  async searchMailbox(ownerId: string, query: string, limit: number = 10, connectionId?: string): Promise<MailboxSearch> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) throw new Error('faberloom: no hay un buzón IMAP configurado; añádelo en Conexiones')
    const found = await searchMessages({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      starttls: credentials.starttls,
      user: credentials.username,
      password: credentials.password,
      mailbox: this.config.mailbox ?? 'INBOX',
      query,
      maxMessages: Math.max(1, Math.min(limit, 50)),
      scanMessages: 200,
      timeoutMs: this.config.timeoutMs ?? 15_000,
    })
    return { ...found, connectionId: credentials.id }
  }

  private domain(): Promise<Domain<typeof inboundDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(inboundDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.inbound.domainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async cursors(): Promise<KvTable<string, CursorRecord>> {
    return (await this.domain()).table('cursors')
  }
}

/** Build the empty report a skipped or failed poll returns. */
function empty(skipped: string): InboundReport {
  return { skipped, mailbox: null, read: 0, started: [], error: null, accounts: [] }
}

/** What one account's pass has read and started so far. */
interface AccountProgress {
  /** Messages ingested by this pass. */
  read: number
  /** Runs this pass started, as `<routineId>:<key>`. */
  readonly started: string[]
}

/** The failure text of a caught value, whether it is an `Error` or not. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The event key of one IMAP message: the mail's own id when it has one, so the
 * same message read through IMAP and MCP is one event; else the mailbox
 * generation and UID that name its copy.
 * @param connectionId - the connection the copy was read from.
 * @param uidValidity - the mailbox generation reported with the read.
 * @param message - the envelope.
 * @returns the event key.
 */
function imapEventKey(
  connectionId: string,
  uidValidity: number | null | undefined,
  message: ImapMessage,
): string {
  return message.messageId === null
    ? `imap:${connectionId}:${String(uidValidity ?? 'n')}:${String(message.uid)}`
    : `mail:msg:${message.messageId}`
}

/**
 * Read settings for one connection: where it is and how far this read goes.
 *
 * `unseenOnly` is false because the watcher always asks by UID range; when a
 * reset ignores the range, the batch is discarded and the baseline is fixed at
 * the top, so asking for unread mail would only narrow a read nobody ingests.
 * @param credentials - the saved mailbox.
 * @param since - highest UID already read, or null to search the mailbox.
 * @param maxMessages - messages this read returns.
 * @param config - the receiver's deployment settings.
 * @param expectedUidValidity - the generation the stored cursor was read under.
 * @returns the IMAP read options.
 */
function readOptions(
  credentials: MailboxCredentials,
  since: number | null,
  maxMessages: number,
  config: Config,
  expectedUidValidity: number | null = null,
): ImapOptions {
  return {
    host: credentials.host,
    port: credentials.port,
    secure: credentials.secure,
    starttls: credentials.starttls,
    user: credentials.username,
    password: credentials.password,
    mailbox: config.mailbox ?? 'INBOX',
    since,
    unseenOnly: false,
    expectedUidValidity,
    maxMessages,
    timeoutMs: config.timeoutMs ?? 15_000,
  }
}

export default FaberLoomInbound
