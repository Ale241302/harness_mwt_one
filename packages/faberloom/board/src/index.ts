/**
 * Native product board (`ctx.faberloomBoard`): the work table of prepared
 * results and exceptions. Submits require real evidence; approval binds to the
 * exact revision; a change after approval goes stale and blocks approval and
 * effects until revalidated; effects require an explicit authorization, so
 * approving never sends anything. Records are durable through
 * `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-board
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boardDomainSpec, type BoardItemRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  BoardCreateInput,
  BoardEffectInput,
  BoardReviewInput,
  BoardStatus,
  BoardSubmitInput,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomBoard: FaberLoomBoard
  }
}

/** Map one durable record to the consumer-facing item. */
function toItem(id: FaberLoomBoardItemId, record: BoardItemRecord): FaberLoomBoardItem {
  return { id, ...record }
}

/** Require at least one real evidence reference. */
function requireEvidence(evidence: readonly string[] | undefined): string[] {
  const list = evidence !== undefined ? [...evidence].filter(entry => entry.trim().length > 0) : []
  if (list.length === 0) throw new Error('faberloom: NO_EVIDENCE — a prepared result requires real evidence')
  return list
}

/**
 * The product board service: versioned items, evidence-gated submits,
 * version-bound approvals, revalidation, and authorization-gated effects.
 */
export class FaberLoomBoard extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof boardDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomBoard')
  }

  private domain(): Promise<Domain<typeof boardDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(boardDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.boardDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async items(): Promise<KvTable<FaberLoomBoardItemId, BoardItemRecord>> {
    return (await this.domain()).table('items')
  }

  private async save(id: FaberLoomBoardItemId, record: BoardItemRecord): Promise<void> {
    await (await this.items()).put(id, record)
  }

  private async requireItem(id: FaberLoomBoardItemId): Promise<BoardItemRecord> {
    const record = (await this.items()).get(id)
    if (record === undefined) throw new Error(`faberloom: board item ${id} not found`)
    return record
  }

  /**
   * Create one prepared item awaiting review; evidence is mandatory.
   * @param ownerId - the owning identity.
   * @param input - title, summary, evidence, optional space, document, execution.
   * @returns the created item.
   */
  async create(ownerId: string, input: BoardCreateInput): Promise<FaberLoomBoardItem> {
    const id = brandString<FaberLoomBoardItemId>(randomUUID())
    const now = new Date().toISOString()
    const record: BoardItemRecord = {
      ownerId,
      spaceId: input.spaceId ?? null,
      title: input.title,
      status: 'waiting_approval',
      version: 1,
      revisions: [{
        version: 1, summary: input.summary, evidence: requireEvidence(input.evidence),
        documentRef: input.documentRef ?? null, at: now,
      }],
      approvedRevision: null,
      stale: false,
      staleReason: null,
      effects: [],
      reviews: [],
      executionId: input.executionId ?? null,
      createdAt: now,
      updatedAt: now,
    }
    await this.save(id, record)
    return toItem(id, record)
  }

  /**
   * Submit a correction as the next revision, awaiting a fresh review.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @param input - summary, evidence, and optional document reference.
   * @returns the updated item.
   */
  async submitRevision(ownerId: string, id: FaberLoomBoardItemId, input: BoardSubmitInput): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can revise this item')
    const version = record.version + 1
    const now = new Date().toISOString()
    const next: BoardItemRecord = {
      ...record,
      status: 'waiting_approval',
      version,
      revisions: [...record.revisions, {
        version, summary: input.summary, evidence: requireEvidence(input.evidence),
        documentRef: input.documentRef ?? null, at: now,
      }],
      stale: false,
      staleReason: null,
      updatedAt: now,
    }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Record that the item waits for data.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async requestData(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return this.setStatus(ownerId, id, 'waiting_data')
  }

  /**
   * Mark the item failed.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async fail(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return this.setStatus(ownerId, id, 'failed')
  }

  /**
   * Reopen the item for another attempt.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async reopen(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return this.setStatus(ownerId, id, 'reopened')
  }

  /**
   * Complete an approved item.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async complete(ownerId: string, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can complete this item')
    if (record.status !== 'approved') throw new Error('faberloom: item is not approved')
    return this.setStatus(ownerId, id, 'completed', record)
  }

  private async setStatus(
    ownerId: string,
    id: FaberLoomBoardItemId,
    status: BoardStatus,
    known?: BoardItemRecord,
  ): Promise<FaberLoomBoardItem> {
    const record = known ?? await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can change this item')
    const next: BoardItemRecord = { ...record, status, updatedAt: new Date().toISOString() }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Approve or reject the exact revision. A stale item refuses; a revision that
   * is not current refuses with `STALE_REVISION`.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @param input - decision, exact revision, and optional note.
   * @returns the updated item.
   */
  async review(ownerId: string, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can review this item')
    if (input.version !== record.version) throw new Error('faberloom: STALE_REVISION — the reviewed revision is not current')
    if (record.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
    const now = new Date().toISOString()
    const next: BoardItemRecord = {
      ...record,
      status: input.decision === 'approve' ? 'approved' : 'reopened',
      approvedRevision: input.decision === 'approve' ? input.version : record.approvedRevision,
      reviews: [...record.reviews, { decision: input.decision, version: input.version, note: input.note ?? null, at: now }],
      updatedAt: now,
    }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Invalidate a current approval: the item must be revalidated before approval
   * or effects.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @param reason - why the item went stale.
   * @returns the updated item.
   */
  async markStale(ownerId: string, id: FaberLoomBoardItemId, reason: string): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can mark this item stale')
    const invalidated = record.approvedRevision !== null
    const next: BoardItemRecord = {
      ...record,
      stale: true,
      staleReason: reason,
      approvedRevision: invalidated ? null : record.approvedRevision,
      status: invalidated ? 'needs_review' : record.status,
      updatedAt: new Date().toISOString(),
    }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Clear staleness after checking the changed condition.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @param changed - whether the underlying condition actually changed.
   * @returns the updated item.
   */
  async revalidate(ownerId: string, id: FaberLoomBoardItemId, changed: boolean): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can revalidate this item')
    const next: BoardItemRecord = {
      ...record,
      stale: false,
      staleReason: null,
      status: changed ? 'needs_review' : record.status,
      updatedAt: new Date().toISOString(),
    }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Record an effect. Approval never sends: an explicit non-empty authorization
   * is required, and a stale or unapproved item refuses.
   * @param ownerId - the acting identity.
   * @param id - item id.
   * @param input - external reference, authorization, and optional detail.
   * @returns the updated item.
   */
  async recordEffect(ownerId: string, id: FaberLoomBoardItemId, input: BoardEffectInput): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can record an effect')
    if (input.authorization === undefined || input.authorization.trim().length === 0) {
      throw new Error('faberloom: NO_AUTHORIZATION — recording an effect requires an explicit authorization')
    }
    if (record.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
    if (record.status !== 'approved') throw new Error('faberloom: item is not approved')
    const next: BoardItemRecord = {
      ...record,
      effects: [...record.effects, {
        ref: input.ref, detail: input.detail ?? null, authorization: input.authorization, at: new Date().toISOString(),
      }],
      updatedAt: new Date().toISOString(),
    }
    await this.save(id, next)
    return toItem(id, next)
  }

  /**
   * Read one item.
   * @param id - item id.
   * @returns the item.
   */
  async get(id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return toItem(id, await this.requireItem(id))
  }

  /**
   * List items, optionally filtered by owner and status.
   * @param filter - optional owner and status filters.
   * @returns items oldest first.
   */
  async list(filter: { ownerId?: string; status?: BoardStatus } = {}): Promise<FaberLoomBoardItem[]> {
    const out: FaberLoomBoardItem[] = []
    for (const [id, record] of (await this.items()).entries()) {
      if (filter.ownerId !== undefined && record.ownerId !== filter.ownerId) continue
      if (filter.status !== undefined && record.status !== filter.status) continue
      out.push(toItem(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }
}

export default FaberLoomBoard
