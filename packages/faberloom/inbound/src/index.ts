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
 * The receiver never writes to the mailbox: it does not mark messages read, move
 * them, or delete them, so the owner's own mail client is unaffected. Idempotency
 * is the engine's: the event key is the message's `Message-ID` when it has one,
 * and the mailbox UID otherwise, so re-reading a message never starts a run twice.
 * @module @deepseek-ai/dsh-faberloom-inbound
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type { IngestEvent } from '@deepseek-ai/dsh-faberloom-routines'
import { fetchMessages, searchMessages, type ImapMessage } from './imap.ts'
import { inboundDomainSpec, type CursorRecord } from './spec.ts'

export type { ImapMessage } from './imap.ts'
export type * from './spec.ts'

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
  maxMessages: z.number(),
  timeoutMs: z.number(),
})

/** Shortest poll interval the receiver accepts. */
export const MIN_INTERVAL_MS = 10_000

/** Longest connection wait the receiver accepts. */
export const MAX_TIMEOUT_MS = 60_000

/** What one poll did. */
export interface InboundReport {
  /** Why the poll did nothing, when it did nothing. */
  readonly skipped: string | null
  /** Connection label the poll read, or null when it read none. */
  readonly mailbox: string | null
  /** Messages read from the mailbox this pass. */
  readonly read: number
  /** Runs this pass started, as `<routineId>:<key>`. */
  readonly started: readonly string[]
  /** Failure the mailbox reported, or null. */
  readonly error: string | null
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
    if (this.config.enabled !== true || (this.config.ownerId ?? '').length === 0) return
    this.ctx.effect(() => {
      const timer = setInterval(() => {
        void this.runOnce().catch((error: unknown) => {
          this.ctx.logger.warn(`faberloom: inbound poll failed: ${String(error)}`)
        })
      }, interval)
      return () => { clearInterval(timer) }
    }, 'faberloom.inbound.poller')
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
      return await this.poll(ownerId, now)
    } finally {
      this.running = false
    }
  }

  private async poll(ownerId: string, now: Date): Promise<InboundReport> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) return empty('no connections service')
    const credentials = await connections.imap(ownerId)
    if (credentials === undefined) return empty('no mailbox configured')

    const table = await this.cursors()
    const cursor = table.get(credentials.id)
    let messages: ImapMessage[]
    try {
      messages = await fetchMessages({
        host: credentials.host,
        port: credentials.port,
        secure: credentials.secure,
        starttls: credentials.starttls,
        user: credentials.username,
        password: credentials.password,
        mailbox: this.config.mailbox ?? 'INBOX',
        since: cursor === undefined ? null : cursor.lastUid,
        maxMessages: this.config.maxMessages ?? 20,
        timeoutMs: this.config.timeoutMs ?? 15_000,
      })
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`faberloom: mailbox ${credentials.label} could not be read: ${detail}`)
      return { skipped: null, mailbox: credentials.label, read: 0, started: [], error: detail }
    }

    const started: string[] = []
    for (const message of messages) {
      const event: IngestEvent = {
        key: message.messageId === null ? `imap:${credentials.id}:${String(message.uid)}` : `imap:${message.messageId}`,
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
      for (const result of await this.ctx.faberloomRoutines.ingest(ownerId, event)) {
        if (!result.deduped) started.push(`${String(result.execution.routineId)}:${event.key}`)
      }
    }
    const highest = messages.reduce((max, message) => Math.max(max, message.uid), cursor?.lastUid ?? 0)
    if (messages.length > 0) {
      await table.put(credentials.id, { ownerId, connectionId: credentials.id, lastUid: highest, updatedAt: now.toISOString() })
    }
    return { skipped: null, mailbox: credentials.label, read: messages.length, started, error: null }
  }

  /**
   * Search the owner's mailbox envelopes from the chat, newest first.
   *
   * Read-only like the poller: it neither advances the receiver's cursor nor
   * touches the mailbox flags, so searching never hides mail from the triggers.
   * @param ownerId - the owning identity.
   * @param query - text to look for; empty returns the newest envelopes.
   * @param limit - most envelopes returned.
   * @param connectionId - a specific IMAP connection, or undefined for the
   *   primary mailbox.
   * @returns the matching envelopes.
   */
  async searchMailbox(ownerId: string, query: string, limit = 10, connectionId?: string): Promise<readonly ImapMessage[]> {
    const connections = this.ctx.get('faberloomConnections')
    if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
    const credentials = await connections.imap(ownerId, connectionId)
    if (credentials === undefined) throw new Error('faberloom: no hay un buzón IMAP configurado; añádelo en Conexiones')
    return await searchMessages({
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
  return { skipped, mailbox: null, read: 0, started: [], error: null }
}

export default FaberLoomInbound
