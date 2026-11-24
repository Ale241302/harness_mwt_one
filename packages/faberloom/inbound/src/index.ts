/**
 * Native product inbound receiver (`ctx.faberloomInbound`): the component that
 * turns the owner's own mailbox into routine events.
 *
 * The owner configures an IMAP connection in Conexiones; this service polls it
 * on a timer, reads the message envelopes that arrived since its last cursor,
 * and hands each one to the routines engine's ingest. A trigger that matches the
 * message subject therefore starts its routine with nobody watching, which is
 * what closes the plan's promise that work does not stop when the panel closes.
 *
 * The receiver itself polls read-only: it does not mark messages read, move
 * them, or delete them, so the owner's own mail client is unaffected. Two
 * explicit user gestures write to the mailbox through the same protocol client:
 * `markSeen` sets `\Seen` and `moveToTrash` moves the message to the Trash
 * mailbox. Idempotency is the engine's: the event key is the message's
 * `Message-ID` when it has one, and the mailbox UID otherwise, so re-reading a
 * message never starts a run twice.
 * @module @deepseek-ai/dsh-faberloom-inbound
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type { FaberLoomConnection } from '@deepseek-ai/dsh-faberloom-connections'
import type { IngestEvent } from '@deepseek-ai/dsh-faberloom-routines'
import { LIVE_MAIL_ROUTINE, LIVE_MAIL_ROUTINE_NAME, marluvasLiveMailRoutine, routineDefinitionsMatch, vpsOwnsCloudRuns } from '@deepseek-ai/dsh-faberloom-routines'
import { appendMessage, fetchContent, fetchMessages, listFolders, markMessageSeen, moveMessage, searchMessages, type ImapBodyOptions, type ImapFolder, type ImapMessage, type ImapMessageContent } from './imap.ts'
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
  /** Most messages one pass reads, oldest first. */
  maxMessages?: number
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
   * Provision and activate the built-in live mail routine once the owner has an
   * IMAP and an SMTP connection. This is the path that covers connections saved
   * outside the Connections panel (MCP, an earlier deployment), so the routine
   * is always present for every configured mailbox.
   * @param ownerId - the owning identity.
   */
  private async ensureLiveMailRoutine(ownerId: string): Promise<void> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return
    const list = await connections.list(ownerId)
    if (!list.some(connection => connection.kind === 'imap') || !list.some(connection => connection.kind === 'smtp')) return
    const routines = this.ctx.faberloomRoutines
    const input = this.isMarluvasMailbox(list) ? marluvasLiveMailRoutine() : LIVE_MAIL_ROUTINE
    const existing = (await routines.listRoutines(ownerId)).find(routine => routine.name === LIVE_MAIL_ROUTINE_NAME)
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
    if (connections === undefined) return empty('no connections service')
    const mailboxes = (await connections.list(ownerId)).filter(connection => connection.kind === 'imap')
    if (mailboxes.length === 0) return empty('no mailbox configured')

    const accounts: InboundAccountReport[] = []
    for (const mailbox of mailboxes) accounts.push(await this.pollAccount(ownerId, mailbox, now))
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
   * A failing account keeps its cursor untouched, so the next pass retries
   * exactly what it did not read. Re-reading is safe: the event key carries the
   * connection and the message id, so the routine engine dedupes the repeat
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
      const detail = error instanceof Error ? error.message : String(error)
      return { connectionId: mailbox.id, mailbox: mailbox.label, read: 0, started: [], error: detail }
    }
    if (credentials === undefined) {
      return { connectionId: mailbox.id, mailbox: mailbox.label, read: 0, started: [], error: 'mailbox row is incomplete' }
    }

    const table = await this.cursors()
    const cursor = table.get(credentials.id)
    let fetched: Awaited<ReturnType<typeof fetchMessages>>
    try {
      fetched = await fetchMessages({
        host: credentials.host,
        port: credentials.port,
        secure: credentials.secure,
        starttls: credentials.starttls,
        user: credentials.username,
        password: credentials.password,
        mailbox: this.config.mailbox ?? 'INBOX',
        since: cursor === undefined ? null : cursor.lastUid,
        expectedUidValidity: cursor?.uidValidity ?? null,
        maxMessages: this.config.maxMessages ?? 20,
        timeoutMs: this.config.timeoutMs ?? 15_000,
      })
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`faberloom: mailbox ${credentials.label} could not be read: ${detail}`)
      return { connectionId: credentials.id, mailbox: credentials.label, read: 0, started: [], error: detail }
    }

    const started: string[] = []
    const messages = fetched.messages
    for (const message of messages) {
      // The occurrence is account-scoped, and a message without Message-ID also
      // carries the mailbox identity: two accounts and a re-indexed mailbox are
      // different occurrences, not the same one.
      const key = message.messageId === null
        ? `imap:${credentials.id}:${String(fetched.uidValidity ?? 'n')}:${String(message.uid)}`
        : `imap:${credentials.id}:${message.messageId}`
      const event: IngestEvent = {
        key,
        type: 'email',
        ...message.subject === null ? {} : { subject: message.subject },
        data: {
          mailbox: credentials.label,
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
    const floor = fetched.reset ? 0 : cursor?.lastUid ?? 0
    const highest = messages.reduce((max, message) => Math.max(max, message.uid), floor)
    if (messages.length > 0 || fetched.reset) {
      await table.put(credentials.id, {
        ownerId,
        connectionId: credentials.id,
        lastUid: highest,
        uidValidity: fetched.uidValidity,
        updatedAt: now.toISOString(),
      })
    }
    return { connectionId: credentials.id, mailbox: credentials.label, read: messages.length, started, error: null }
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

export default FaberLoomInbound
