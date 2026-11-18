/**
 * Native product notices (`ctx.faberloomNotices`): durable, owner-scoped notices
 * that replace the automatic emails E1 retires.
 *
 * A notice is what an automatic email used to be, minus the SMTP: a routine that
 * needs review, a share invitation the owner must forward by hand, a refresh that
 * used to reactivate a thread. It is stored, listed, marked read, and never sent.
 *
 * Records are durable through `ctx.storageDomain`. A dedupe key collapses an
 * unread duplicate instead of piling one row per failure.
 * @module @deepseek-ai/dsh-faberloom-notices
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'

/** Durable notice record. */
export const noticeRecord = z.object({
  ownerId: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  source: z.string().nullable(),
  dedupeKey: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})

/** One stored notice, inferred from {@link noticeRecord}. */
export type NoticeRecord = z.infer<typeof noticeRecord>

/**
 * The notices domain: one `notices` table, version 1.
 */
export const noticesDomainSpec = defineDomain({
  name: 'faberloom_notices',
  version: 1,
  tables: {
    notices: domainTable<string, NoticeRecord>(noticeRecord),
  },
})

/** What a caller publishes. */
export interface NoticeInput {
  /** Owner the notice belongs to. */
  readonly ownerId: string
  /** Machine kind: `routine-review`, `share-invitation`, `transition`. */
  readonly kind: string
  /** One line the panel shows. */
  readonly title: string
  /** Body text; the link or the reason. */
  readonly body: string
  /** Optional source reference (routine, execution, grant). */
  readonly source?: string | null
  /** When set, an unread notice with the same owner and key is reused. */
  readonly dedupeKey?: string | null
}

/** One notice as the product reads it. */
export interface FaberLoomNotice {
  readonly id: string
  readonly ownerId: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly source: string | null
  readonly createdAt: string
  readonly readAt: string | null
}

/** Notices service. */
export class FaberLoomNotices extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof noticesDomainSpec>> | undefined

  constructor(ctx: Context) {
    super(ctx, 'faberloomNotices')
  }

  private domain(): Promise<Domain<typeof noticesDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(noticesDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.noticesDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async notices(): Promise<KvTable<string, NoticeRecord>> {
    return (await this.domain()).table('notices')
  }

  /**
   * Publish one notice.
   * @param input - owner, kind, title, body, and optional source and dedupe key.
   * @returns the stored notice, or the unread duplicate the key collapsed into.
   * @throws when the owner is empty.
   */
  async publish(input: NoticeInput): Promise<FaberLoomNotice> {
    if (input.ownerId.trim() === '') throw new Error('faberloom: a notice needs an owner')
    const table = await this.notices()
    const dedupe = input.dedupeKey ?? null
    if (dedupe !== null) {
      for (const [id, record] of table.entries()) {
        if (record.ownerId === input.ownerId && record.dedupeKey === dedupe && record.readAt === null) {
          return toNotice(id, record)
        }
      }
    }
    const id = randomUUID()
    const record: NoticeRecord = {
      ownerId: input.ownerId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      source: input.source ?? null,
      dedupeKey: dedupe,
      createdAt: new Date().toISOString(),
      readAt: null,
    }
    await table.put(id, record)
    return toNotice(id, record)
  }

  /**
   * List one owner's notices, newest first.
   * @param ownerId - owning identity.
   * @param options - `unreadOnly` hides read notices.
   * @returns the notices.
   */
  async list(ownerId: string, options: { unreadOnly?: boolean } = {}): Promise<FaberLoomNotice[]> {
    const out: FaberLoomNotice[] = []
    for (const [id, record] of (await this.notices()).entries()) {
      if (record.ownerId !== ownerId) continue
      if (options.unreadOnly === true && record.readAt !== null) continue
      out.push(toNotice(id, record))
    }
    return out.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Count one owner's unread notices.
   * @param ownerId - owning identity.
   * @returns the count.
   */
  async unreadCount(ownerId: string): Promise<number> {
    return (await this.list(ownerId, { unreadOnly: true })).length
  }

  /**
   * Mark one notice read.
   * @param ownerId - owning identity.
   * @param id - notice id.
   * @returns the notice, or undefined when it does not belong to that owner.
   */
  async markRead(ownerId: string, id: string): Promise<FaberLoomNotice | undefined> {
    const table = await this.notices()
    const record = table.get(id)
    if (record === undefined || record.ownerId !== ownerId) return undefined
    const next: NoticeRecord = { ...record, readAt: record.readAt ?? new Date().toISOString() }
    await table.update(id, () => next)
    return toNotice(id, next)
  }

  /**
   * Mark every unread notice of one owner as read.
   * @param ownerId - owning identity.
   * @returns how many notices changed.
   */
  async markAllRead(ownerId: string): Promise<number> {
    const table = await this.notices()
    const now = new Date().toISOString()
    let changed = 0
    for (const [id, record] of table.entries()) {
      if (record.ownerId !== ownerId || record.readAt !== null) continue
      await table.update(id, () => ({ ...record, readAt: now }))
      changed += 1
    }
    return changed
  }
}

/** Public view of a stored record. */
function toNotice(id: string, record: NoticeRecord): FaberLoomNotice {
  return {
    id,
    ownerId: record.ownerId,
    kind: record.kind,
    title: record.title,
    body: record.body,
    source: record.source,
    createdAt: record.createdAt,
    readAt: record.readAt,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomNotices: FaberLoomNotices
  }
}

export default FaberLoomNotices
