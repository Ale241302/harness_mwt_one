/**
 * Native product board (`ctx.faberloomBoard`): the WorkLoom work table. Items
 * carry a persisted state, an optimistic `rowVersion`, an audit event per
 * command, a version-bound artifact hash, candidates, and the tenant company.
 * Reads and writes require a `BoardActor`; there is no unfiltered listing.
 * Commands mutate through `KvTable.update`, so state and audit commit in one
 * record. Records are durable through `ctx.storageDomain`.
 * @module @deepseek-ai/dsh-faberloom-board
 */

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boardDomainSpec, type BoardDraftRecord, type BoardItemRecord, type BoardKeyRecord } from './spec.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  BoardActor,
  BoardApproveInput,
  BoardCandidate,
  BoardColumn,
  BoardCreateInput,
  BoardDiscardInput,
  BoardEditDraft,
  BoardEditsInput,
  BoardEffectInput,
  BoardEvent,
  BoardReviewInput,
  BoardSeverity,
  BoardState,
  BoardStatus,
  BoardSubmitInput,
  BoardSubmitRequest,
  BoardWriter,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomBoard: FaberLoomBoard
  }
}

/** Board configuration accepted by the plugin row. */
export interface Config {
  /** Maximum inline audit events kept per item. */
  readonly eventCap?: number
}

/** Validated board configuration. */
export const Config = z.object({
  eventCap: z.number().int().positive().default(200),
})

/** Discard reasons signed in the specification. */
export const DISCARD_REASONS = [
  'CLIENTE_CANCELO', 'DUPLICADO', 'ERROR_ORIGEN', 'NO_CORRESPONDE', 'RESUELTO_FUERA', 'OTRA',
] as const

const TERMINAL: readonly BoardState[] = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']
const CANDIDATE_STATES: readonly BoardState[] = ['ITERANDO', 'EJECUCION_PENDIENTE']

const LEGACY_STATE: Record<BoardStatus, BoardState> = {
  in_progress: 'PENDIENTE_CRITERIO',
  waiting_data: 'PENDIENTE_CRITERIO',
  waiting_approval: 'PENDIENTE_CRITERIO',
  approved: 'APROBADO',
  completed: 'EJECUTADO',
  failed: 'ERROR_RECUPERABLE',
  reopened: 'PENDIENTE_CRITERIO',
  needs_review: 'PENDIENTE_CRITERIO',
}

/** The persisted state, falling back to the legacy status for old records. */
function stateOf(record: BoardItemRecord): BoardState {
  return (record.state as BoardState | null) ?? LEGACY_STATE[record.status]
}

/** The visible column, derived from the state. */
function columnOf(state: BoardState): BoardColumn {
  switch (state) {
    case 'PENDIENTE_CRITERIO':
    case 'ITERANDO':
      return 'TU_CRITERIO'
    case 'ESPERANDO_OTRO':
      return 'ESPERANDO_CRITERIO'
    case 'DELEGADO_EN_VENTANA':
    case 'EJECUCION_PENDIENTE':
      return 'DELEGADO'
    case 'ERROR_RECUPERABLE':
    case 'ERROR_SIN_SALIDA':
      return 'ERROR_ACCIONABLE'
    case 'APROBADO':
    case 'EJECUTADO':
    case 'DESCARTADO':
    case 'SUSTITUIDO':
      return 'CERRADO'
    default:
      return 'TU_CRITERIO'
  }
}

/** A stable hash of one artifact payload. */
function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Require at least one real evidence reference. */
function requireEvidence(evidence: readonly string[] | undefined): string[] {
  const list = evidence !== undefined ? [...evidence].filter(entry => entry.trim().length > 0) : []
  if (list.length === 0) throw new Error('faberloom: NO_EVIDENCE — a prepared result requires real evidence')
  return list
}

/** Map one durable record to the consumer-facing item. */
function toItem(id: FaberLoomBoardItemId, record: BoardItemRecord): FaberLoomBoardItem {
  const state = stateOf(record)
  return {
    id,
    ...record,
    state,
    column: columnOf(state),
    events: record.events.map(event => ({
      ...event,
      fromState: event.fromState as BoardState | null,
      toState: event.toState as BoardState,
    })),
  }
}

/**
 * The product board service: WorkLoom states, commands, audit, candidates, and
 * optimistic concurrency over one key-value aggregate per item.
 */
export class FaberLoomBoard extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof boardDomainSpec>> | undefined
  private readonly eventCap: number
  private readonly claims = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - inline audit cap.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomBoard')
    this.eventCap = config.eventCap ?? 200
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

  private async keys(): Promise<KvTable<string, BoardKeyRecord>> {
    return (await this.domain()).table('keys')
  }

  private async drafts(): Promise<KvTable<string, BoardDraftRecord>> {
    return (await this.domain()).table('drafts')
  }

  private draftId(itemId: FaberLoomBoardItemId | string, userId: string): string {
    return `${itemId}:${userId}`
  }

  private keyId(companyId: string | null, kind: string, key: string): string {
    return `${companyId ?? 'sin-empresa'}:${kind}:${key}`
  }

  private async claim(companyId: string | null, kind: string, key: string, itemId: string): Promise<void> {
    await (await this.keys()).put(this.keyId(companyId, kind, key), { itemId, kind, at: new Date().toISOString() })
  }

  private async release(companyId: string | null, kind: string, key: string | null): Promise<void> {
    if (key === null) return
    await (await this.keys()).delete(this.keyId(companyId, kind, key))
  }

  private async claimedItem(companyId: string | null, kind: string, key: string): Promise<FaberLoomBoardItemId | undefined> {
    const claim = (await this.keys()).get(this.keyId(companyId, kind, key))
    return claim === undefined ? undefined : claim.itemId as FaberLoomBoardItemId
  }

  private async serial<T>(companyId: string | null, task: () => Promise<T>): Promise<T> {
    const id = companyId ?? 'sin-empresa'
    const previous = this.claims.get(id) ?? Promise.resolve()
    const run = previous.then(task, task)
    this.claims.set(id, run.catch(() => undefined))
    return run
  }

  private async requireItem(id: FaberLoomBoardItemId): Promise<BoardItemRecord> {
    const record = (await this.items()).get(id)
    if (record === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} not found`)
    return record
  }

  private event(input: {
    command: string
    actor: string
    fromState: BoardState | null
    toState: BoardState
    revision: number | null
    artifactHash: string | null
    reason?: string | null | undefined
    data?: Record<string, unknown> | null | undefined
  }): BoardEvent {
    return {
      id: randomUUID(),
      command: input.command,
      actor: input.actor,
      fromState: input.fromState,
      toState: input.toState,
      revision: input.revision,
      artifactHash: input.artifactHash,
      reason: input.reason ?? null,
      at: new Date().toISOString(),
      data: input.data ?? null,
    }
  }

  /**
   * Apply one command inside a single `update` transform: authorization,
   * optimistic check, state change, and appended event commit together.
   */
  private async mutate(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    command: string,
    transform: (current: BoardItemRecord, actor: BoardActor) => BoardItemRecord,
    options: {
      expectedRowVersion?: number | undefined
      reason?: string | null | undefined
      data?: Record<string, unknown> | null | undefined
    } = {},
  ): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    const table = await this.items()
    let next: BoardItemRecord | undefined
    await table.update(id, (current) => {
      this.authorizeWrite(current, writer)
      if (options.expectedRowVersion !== undefined && current.rowVersion !== options.expectedRowVersion) {
        throw new Error('faberloom: STALE_ROW — the item changed since it was read')
      }
      const candidate = transform(current, actor)
      const fromState = stateOf(current)
      const toState = stateOf(candidate)
      const event = this.event({
        command,
        actor: actor.id,
        fromState,
        toState,
        revision: candidate.version,
        artifactHash: candidate.artifactHash,
        reason: options.reason,
        data: options.data,
      })
      next = {
        ...candidate,
        rowVersion: current.rowVersion + 1,
        events: [...current.events, event].slice(-this.eventCap),
        updatedAt: event.at,
      }
      return next
    })
    if (next === undefined) throw new Error(`faberloom: NOT_FOUND — board item ${id} disappeared during the command`)
    return toItem(id, next)
  }

  private buildRecord(
    actor: BoardActor,
    input: BoardCreateInput & {
      runId?: string
      idempotencyKey?: string
      businessKey?: string
      state?: BoardState
      supersedesItemId?: string | null
    },
  ): BoardItemRecord {
    const now = new Date().toISOString()
    const evidence = requireEvidence(input.evidence)
    const artifactHash = hashOf({ summary: input.summary, evidence })
    return {
      ownerId: actor.id,
      companyId: input.companyId ?? actor.companyId ?? null,
      spaceId: input.spaceId ?? null,
      routineId: input.routineId ?? null,
      title: input.title,
      status: 'waiting_approval',
      state: input.state ?? 'PENDIENTE_CRITERIO',
      rowVersion: 1,
      severity: null,
      severitySource: null,
      severityConfidence: null,
      dueAt: null,
      valueAmount: null,
      valueCurrency: null,
      valueUsd: null,
      dataClass: 'N2',
      dataClassProvisional: true,
      runId: input.runId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      businessKey: input.businessKey ?? null,
      supersedesItemId: input.supersedesItemId ?? null,
      artifactType: input.artifactType ?? 'provisional',
      accountRef: input.accountRef ?? null,
      artifactHash,
      pendingCandidate: null,
      events: [this.event({
        command: 'submit', actor: actor.id, fromState: null, toState: input.state ?? 'PENDIENTE_CRITERIO',
        revision: 1, artifactHash,
      })],
      discardReason: null,
      discardNote: null,
      iterationId: null,
      iterationDraftKey: null,
      iterationLockUntil: null,
      iterationLockGeneration: 0,
      version: 1,
      revisions: [{ version: 1, summary: input.summary, evidence, documentRef: input.documentRef ?? null, at: now }],
      approvedRevision: null,
      stale: false,
      staleReason: null,
      effects: [],
      reviews: [],
      executionId: input.executionId ?? null,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Create one prepared item awaiting review; evidence is mandatory.
   * @param writer - the owning identity; a bare id is a legacy single-tenant actor.
   * @param input - title, summary, evidence, optional space, document, execution.
   * @returns the created item.
   */
  async create(writer: BoardWriter, input: BoardCreateInput): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    if (input.companyId !== undefined && input.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item company is not the actor company')
    }
    const id = brandString<FaberLoomBoardItemId>(randomUUID())
    const record = this.buildRecord(actor, input)
    await (await this.items()).put(id, record)
    return toItem(id, record)
  }

  /**
   * Create one item from an Action Engine run. `runId`, `idempotencyKey`, and
   * `businessKey` are mandatory; a repeated key returns the existing item.
   * @param writer - the acting identity.
   * @param input - run identity, artifact identity, title, summary, and evidence.
   * @returns the created or deduplicated item.
   */
  async submit(writer: BoardWriter, input: BoardSubmitRequest): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    if (input.runId.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires a run id')
    if (input.idempotencyKey.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires an idempotency key')
    if (input.businessKey.trim().length === 0) throw new Error('faberloom: NO_RUN — an item requires a business key')
    if (input.companyId !== undefined && input.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item company is not the actor company')
    }
    const companyId = input.companyId ?? actor.companyId ?? null

    return await this.serial(companyId, async () => {
      const existingId = await this.claimedItem(companyId, 'idem', input.idempotencyKey)
      if (existingId !== undefined) return toItem(existingId, await this.requireItem(existingId))

      const existing = await this.findNonTerminal(companyId, input.businessKey, actor.id)
      let supersedes: string | null = null
      if (existing !== undefined) {
        const existingState = stateOf(existing.record)
        if (CANDIDATE_STATES.includes(existingState) || existingState === 'ERROR_RECUPERABLE') {
          const candidate: BoardCandidate = {
            id: randomUUID(),
            hash: hashOf({ summary: input.summary, evidence: input.evidence }),
            summary: input.summary,
            evidence: requireEvidence(input.evidence),
            at: new Date().toISOString(),
          }
          await this.mutate(actor, existing.id, 'candidate_arrived', current => ({ ...current, pendingCandidate: candidate }))
          return toItem(existing.id, await this.requireItem(existing.id))
        }
        await this.mutate(actor, existing.id, 'superseded', current => ({
          ...current, state: 'SUSTITUIDO', status: 'completed',
        }), { reason: 'new-artifact' })
        await this.release(companyId, 'bkey', existing.record.businessKey)
        supersedes = existing.id
      }

      const id = brandString<FaberLoomBoardItemId>(randomUUID())
      const record = this.buildRecord(actor, {
        ...input,
        title: input.title ?? input.summary.slice(0, 80),
        companyId: companyId ?? undefined,
        supersedesItemId: supersedes,
      })
      await (await this.items()).put(id, record)
      await this.claim(companyId, 'idem', input.idempotencyKey, id)
      await this.claim(companyId, 'bkey', input.businessKey, id)
      return toItem(id, record)
    })
  }

  private async findNonTerminal(
    companyId: string | null,
    businessKey: string,
    ownerId: string,
  ): Promise<{ id: FaberLoomBoardItemId; record: BoardItemRecord } | undefined> {
    for (const [id, record] of (await this.items()).entries()) {
      if (record.ownerId !== ownerId) continue
      if (record.companyId !== companyId) continue
      if (record.businessKey !== businessKey) continue
      if (TERMINAL.includes(stateOf(record))) continue
      return { id, record }
    }
    return undefined
  }

  /**
   * Record the human severity and its provenance.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param severity - the chosen severity.
   * @param source - who assigned it.
   * @param confidence - original classifier confidence, when known.
   * @param expectedRowVersion - optimistic token.
   * @returns the updated item.
   */
  async setSeverity(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    severity: BoardSeverity,
    source: 'RULE' | 'LLM' | 'HUMAN' = 'HUMAN',
    confidence: number | null = null,
    expectedRowVersion?: number,
  ): Promise<FaberLoomBoardItem> {
    const previous = (await this.requireItem(id)).severity
    return await this.mutate(writer, id, 'set_severity', current => ({
      ...current, severity, severitySource: source, severityConfidence: confidence,
    }), {
      expectedRowVersion,
      data: { previous, source, confidence },
    })
  }

  /**
   * Save inline edits as a new revision and hash.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - base version, expected row version, and changes.
   * @returns the updated item.
   */
  async saveEdits(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEditsInput): Promise<FaberLoomBoardItem> {
    const updated = await this.mutate(writer, id, 'save_edits', (current) => {
      if (current.version !== input.baseVersion) {
        throw new Error('faberloom: STALE_REVISION — the edits were made against an older version')
      }
      const summary = typeof input.changes['summary'] === 'string' ? input.changes['summary'] : current.revisions[current.revisions.length - 1]?.summary ?? ''
      const evidence = current.revisions[current.revisions.length - 1]?.evidence ?? []
      const version = current.version + 1
      const artifactHash = hashOf({ summary, evidence, changes: input.changes })
      return {
        ...current,
        version,
        artifactHash,
        stale: false,
        staleReason: null,
        revisions: [...current.revisions, {
          version, summary, evidence, documentRef: current.revisions[current.revisions.length - 1]?.documentRef ?? null,
          at: new Date().toISOString(),
        }],
      }
    }, { expectedRowVersion: input.expectedRowVersion })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Approve the exact artifact version. It never sends anything.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - expected row, artifact version, and hash.
   * @returns the approved item.
   */
  async approve(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardApproveInput): Promise<FaberLoomBoardItem> {
    const updated = await this.mutate(writer, id, 'approve', (current) => {
      this.requireApprovable(current, input)
      return { ...current, state: 'APROBADO', status: 'approved', approvedRevision: current.version, stale: false, staleReason: null }
    }, { expectedRowVersion: input.expectedRowVersion })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Save edits and approve the resulting version in one command.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - approval expectations plus the edits.
   * @returns the approved item.
   */
  async approveWithEdits(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    input: BoardApproveInput & BoardEditsInput,
  ): Promise<FaberLoomBoardItem> {
    const updated = await this.mutate(writer, id, 'approve_with_edits', (current) => {
      this.requireApprovable(current, input)
      if (current.version !== input.baseVersion) {
        throw new Error('faberloom: STALE_REVISION — the edits were made against an older version')
      }
      const summary = typeof input.changes['summary'] === 'string' ? input.changes['summary'] : current.revisions[current.revisions.length - 1]?.summary ?? ''
      const evidence = current.revisions[current.revisions.length - 1]?.evidence ?? []
      const version = current.version + 1
      const artifactHash = hashOf({ summary, evidence, changes: input.changes })
      return {
        ...current,
        version,
        artifactHash,
        state: 'APROBADO',
        status: 'approved',
        approvedRevision: version,
        stale: false,
        staleReason: null,
        revisions: [...current.revisions, {
          version, summary, evidence, documentRef: current.revisions[current.revisions.length - 1]?.documentRef ?? null,
          at: new Date().toISOString(),
        }],
      }
    }, { expectedRowVersion: input.expectedRowVersion })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  private requireApprovable(current: BoardItemRecord, input: BoardApproveInput): void {
    if (stateOf(current) !== 'PENDIENTE_CRITERIO') {
      throw new Error('faberloom: NO_ACCESS — the item is not waiting for a decision')
    }
    if (current.severity === null) throw new Error('faberloom: SEVERITY_REQUIRED — confirm the severity first')
    if (current.pendingCandidate !== null) throw new Error('faberloom: CANDIDATE_PENDING — resolve the new version first')
    if (current.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
    if (current.version !== input.expectedArtifactVersion) {
      throw new Error('faberloom: STALE_REVISION — the reviewed revision is not current')
    }
    if (current.artifactHash !== input.expectedArtifactHash) {
      throw new Error('faberloom: STALE_REVISION — the reviewed artifact hash is not current')
    }
  }

  /**
   * Discard an item with a signed reason.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - expected row, reason, and optional note.
   * @returns the discarded item.
   */
  async discard(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardDiscardInput): Promise<FaberLoomBoardItem> {
    if (!DISCARD_REASONS.includes(input.reason as typeof DISCARD_REASONS[number])) {
      throw new Error('faberloom: REASON_INVALID — the discard reason is not in the closed list')
    }
    if (input.reason === 'OTRA' && (input.note === undefined || input.note.trim().length === 0)) {
      throw new Error('faberloom: REASON_REQUIRED — OTRA requires a note')
    }
    const updated = await this.mutate(writer, id, 'discard', (current) => {
      if (current.severity === null) throw new Error('faberloom: SEVERITY_REQUIRED — confirm the severity first')
      if (current.pendingCandidate !== null) throw new Error('faberloom: CANDIDATE_PENDING — resolve the new version first')
      return {
        ...current,
        state: 'DESCARTADO',
        status: 'completed',
        discardReason: input.reason,
        discardNote: input.note ?? null,
      }
    }, { expectedRowVersion: input.expectedRowVersion, reason: input.reason })
    await this.clearEditDraft(this.actorOf(writer), id)
    return updated
  }

  /**
   * Adopt or keep the pending candidate.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param candidateId - candidate the user saw.
   * @param candidateHash - hash the user saw.
   * @param decision - adopt or keep.
   * @returns the updated item.
   */
  async resolveCandidate(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    candidateId: string,
    candidateHash: string,
    decision: 'adopt' | 'keep',
  ): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'resolve_candidate', (current) => {
      const candidate = current.pendingCandidate
      if (candidate === null || candidate.id !== candidateId || candidate.hash !== candidateHash) {
        throw new Error('faberloom: CANDIDATE_STALE — the candidate is no longer the last one')
      }
      if (decision === 'keep') return { ...current, pendingCandidate: null }
      const version = current.version + 1
      return {
        ...current,
        version,
        artifactHash: candidate.hash,
        pendingCandidate: null,
        revisions: [...current.revisions, {
          version, summary: candidate.summary, evidence: candidate.evidence, documentRef: null, at: candidate.at,
        }],
      }
    }, { data: { choice: decision } })
  }

  /**
   * Assign a space (and its root workspace) to an item, resolving collisions.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param workspaceId - target space/workspace id.
   * @returns the visible item after the assignment.
   */
  async assignWorkspace(writer: BoardWriter, id: FaberLoomBoardItemId, workspaceId: string): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    const companyId = record.companyId
    const nextKey = record.businessKey === null
      ? null
      : hashOf({ base: record.businessKey, workspaceId })
    const other = nextKey === null
      ? undefined
      : await this.findNonTerminal(companyId, nextKey, record.ownerId)
    if (other !== undefined && other.id !== id) {
      if (CANDIDATE_STATES.includes(stateOf(other.record))) {
        const candidate: BoardCandidate = {
          id: randomUUID(),
          hash: record.artifactHash ?? hashOf({ title: record.title }),
          summary: record.revisions[record.revisions.length - 1]?.summary ?? record.title,
          evidence: record.revisions[record.revisions.length - 1]?.evidence ?? [],
          at: new Date().toISOString(),
        }
        await this.mutate(writer, other.id, 'candidate_arrived', current => ({ ...current, pendingCandidate: candidate }))
        return await this.mutate(writer, id, 'superseded', current => ({
          ...current, state: 'SUSTITUIDO', status: 'completed',
        }), { reason: 'transferred-as-candidate' })
      }
      await this.mutate(writer, other.id, 'superseded', current => ({
        ...current, state: 'SUSTITUIDO', status: 'completed',
      }), { reason: 'workspace-collision' })
      await this.release(companyId, 'bkey', other.record.businessKey)
    }
    return await this.mutate(writer, id, 'assign_workspace', current => ({
      ...current,
      spaceId: workspaceId,
      businessKey: nextKey ?? current.businessKey,
    }))
  }

  /**
   * Read the caller's inline-edit draft for one item.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @returns the draft, or undefined.
   */
  async getEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<BoardEditDraft | undefined> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    const draft = (await this.drafts()).get(this.draftId(id, actor.id))
    return draft === undefined ? undefined : { ...draft }
  }

  /**
   * Save one draft write, conditional on its revision and writer tab.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @param input - base version, revision, tab, and changes.
   * @returns the stored draft.
   */
  async saveEditDraft(
    actor: BoardActor,
    id: FaberLoomBoardItemId,
    input: { baseVersion: number; revision: number; writerSession: string; changes: Record<string, string> },
  ): Promise<BoardEditDraft> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    if (input.baseVersion !== record.version) {
      throw new Error('faberloom: STALE_REVISION — the draft was made against an older version')
    }
    const table = await this.drafts()
    const key = this.draftId(id, actor.id)
    const existing = table.get(key)
    if (existing !== undefined && existing.writerSession !== input.writerSession) {
      throw new Error('faberloom: WRITER_TAKEN — another tab holds the editor')
    }
    if (existing !== undefined && existing.revision !== input.revision) {
      throw new Error('faberloom: STALE_DRAFT — the draft revision is not current')
    }
    const next: BoardDraftRecord = {
      itemId: id,
      userId: actor.id,
      baseVersion: input.baseVersion,
      revision: (existing?.revision ?? 0) + 1,
      writerSession: input.writerSession,
      changes: { ...input.changes },
      updatedAt: new Date().toISOString(),
    }
    await table.put(key, next)
    return { ...next }
  }

  /**
   * Take the writer seat for one item. A second tab becomes read-only until
   * this call succeeds.
   * @param actor - the authenticated editor.
   * @param id - item id.
   * @param writerSession - the requesting tab.
   * @returns the draft with this tab as writer.
   */
  async takeEditDraft(actor: BoardActor, id: FaberLoomBoardItemId, writerSession: string): Promise<BoardEditDraft> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    const table = await this.drafts()
    const key = this.draftId(id, actor.id)
    const existing = table.get(key)
    const next: BoardDraftRecord = {
      itemId: id,
      userId: actor.id,
      baseVersion: existing?.baseVersion ?? record.version,
      revision: (existing?.revision ?? 0) + 1,
      writerSession,
      changes: existing?.changes ?? {},
      updatedAt: new Date().toISOString(),
    }
    await table.put(key, next)
    return { ...next }
  }

  /**
   * Drop the caller's draft.
   * @param actor - the authenticated editor.
   * @param id - item id.
   */
  async discardEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<void> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, actor)
    await (await this.drafts()).delete(this.draftId(id, actor.id))
  }

  private async clearEditDraft(actor: BoardActor, id: FaberLoomBoardItemId): Promise<void> {
    await (await this.drafts()).delete(this.draftId(id, actor.id))
  }

  /**
   * Read the audit history of one item.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the events, oldest first.
   */
  async events(actor: BoardActor, id: FaberLoomBoardItemId): Promise<readonly BoardEvent[]> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return record.events.map(event => ({
      ...event,
      fromState: event.fromState as BoardState | null,
      toState: event.toState as BoardState,
    }))
  }

  /**
   * Submit a correction as the next revision, awaiting a fresh review.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - summary, evidence, and optional document reference.
   * @returns the updated item.
   */
  async submitRevision(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardSubmitInput): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'submit_revision', (current) => {
      const version = current.version + 1
      const evidence = requireEvidence(input.evidence)
      return {
        ...current,
        state: 'PENDIENTE_CRITERIO',
        status: 'waiting_approval',
        version,
        artifactHash: hashOf({ summary: input.summary, evidence }),
        stale: false,
        staleReason: null,
        revisions: [...current.revisions, {
          version, summary: input.summary, evidence, documentRef: input.documentRef ?? null,
          at: new Date().toISOString(),
        }],
      }
    })
  }

  /**
   * Record that the item waits for data.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async requestData(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'request_data', current => ({
      ...current, state: 'PENDIENTE_CRITERIO', status: 'waiting_data',
    }))
  }

  /**
   * Mark the item failed.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async fail(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'fail', current => ({
      ...current, state: 'ERROR_RECUPERABLE', status: 'failed',
    }))
  }

  /**
   * Reopen the item for another attempt.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async reopen(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'reopen', current => ({
      ...current, state: 'PENDIENTE_CRITERIO', status: 'reopened',
    }))
  }

  /**
   * Complete an approved item.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns the updated item.
   */
  async complete(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'complete', (current) => {
      if (stateOf(current) !== 'APROBADO') throw new Error('faberloom: NO_ACCESS — item is not approved')
      return { ...current, state: 'EJECUTADO', status: 'completed' }
    })
  }

  /**
   * Permanently remove one item from the work table, regardless of state.
   * @param writer - the acting identity.
   * @param id - item id.
   * @returns whether the item existed and was removed.
   */
  async remove(writer: BoardWriter, id: FaberLoomBoardItemId): Promise<boolean> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    await this.release(record.companyId, 'bkey', record.businessKey)
    return await (await this.items()).delete(id)
  }

  /**
   * Link the item to the routine that will run it, or unlink it with `null`.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param routineId - routine id to attach, or null to detach.
   * @returns the updated item.
   */
  async setRoutine(writer: BoardWriter, id: FaberLoomBoardItemId, routineId: string | null): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'set_routine', current => ({ ...current, routineId }))
  }

  /**
   * Approve or reject the exact revision. A reject returns the item to the
   * pending column; an approve follows the WorkLoom preconditions.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - decision, exact revision, and optional note.
   * @returns the updated item.
   */
  async review(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem> {
    if (input.decision === 'approve') {
      return await this.approve(writer, id, {
        expectedRowVersion: (await this.requireItem(id)).rowVersion,
        expectedArtifactVersion: input.version,
        expectedArtifactHash: (await this.requireItem(id)).artifactHash ?? '',
      })
    }
    return await this.mutate(writer, id, 'reject', (current) => {
      if (input.version !== current.version) throw new Error('faberloom: STALE_REVISION — the reviewed revision is not current')
      return { ...current, state: 'PENDIENTE_CRITERIO', status: 'reopened' }
    })
  }

  /**
   * Invalidate a current approval: the item must be revalidated before approval
   * or effects.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param reason - why the item went stale.
   * @returns the updated item.
   */
  async markStale(writer: BoardWriter, id: FaberLoomBoardItemId, reason: string): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'mark_stale', current => ({
      ...current,
      stale: true,
      staleReason: reason,
      approvedRevision: null,
      state: 'PENDIENTE_CRITERIO',
      status: 'needs_review',
    }), { reason })
  }

  /**
   * Clear staleness after checking the changed condition.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param changed - whether the underlying condition actually changed.
   * @returns the updated item.
   */
  async revalidate(writer: BoardWriter, id: FaberLoomBoardItemId, changed: boolean): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'revalidate', current => ({
      ...current,
      stale: false,
      staleReason: null,
      state: changed ? 'PENDIENTE_CRITERIO' : stateOf(current),
      status: changed ? 'needs_review' : current.status,
    }))
  }

  /**
   * Record an effect. Approval never sends: an explicit authorization is
   * required, and a stale or unapproved item refuses.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - external reference, authorization, and optional detail.
   * @returns the updated item.
   */
  async recordEffect(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardEffectInput): Promise<FaberLoomBoardItem> {
    if (input.authorization === undefined || input.authorization.trim().length === 0) {
      throw new Error('faberloom: NO_AUTHORIZATION — recording an effect requires an explicit authorization')
    }
    return await this.mutate(writer, id, 'effect', (current) => {
      if (current.stale) throw new Error('faberloom: REVALIDATION_REQUIRED — the item changed after approval')
      if (stateOf(current) !== 'APROBADO') throw new Error('faberloom: NO_ACCESS — item is not approved')
      return {
        ...current,
        effects: [...current.effects, {
          ref: input.ref, detail: input.detail ?? null, authorization: input.authorization ?? null,
          at: new Date().toISOString(),
        }],
      }
    })
  }

  /** Normalize a writer identity: a bare id is a legacy single-tenant actor. */
  private actorOf(writer: BoardActor | string): BoardActor {
    return typeof writer === 'string' ? { id: writer } : writer
  }

  /**
   * Refuse a read when the item belongs to another owner or to another company.
   * @param record - the stored item.
   * @param actor - the authenticated reader.
   */
  private authorizeRead(record: BoardItemRecord, actor: BoardActor): void {
    if (record.ownerId !== actor.id) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another owner')
    }
    if (record.companyId !== null && record.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
  }

  /**
   * Refuse a write with the same owner+company rule as a read. A bare string
   * writer carries no company, so it cannot mutate a company-scoped item.
   * @param record - the stored item.
   * @param writer - the authenticated writer.
   */
  private authorizeWrite(record: BoardItemRecord, writer: BoardWriter): void {
    const actor = this.actorOf(writer)
    if (record.ownerId !== actor.id) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another owner')
    }
    if (record.companyId !== null && record.companyId !== actor.companyId) {
      throw new Error('faberloom: NO_ACCESS — the item belongs to another company')
    }
  }

  /**
   * Read one item the actor is allowed to see.
   * @param actor - the authenticated reader.
   * @param id - item id.
   * @returns the item.
   */
  async get(actor: BoardActor, id: FaberLoomBoardItemId): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeRead(record, actor)
    return toItem(id, record)
  }

  /**
   * List the actor's items. There is no unfiltered listing: every read is
   * scoped to one identity and, when the deployment knows it, one company.
   * @param actor - the authenticated reader.
   * @param filter - optional state, status, and space filters.
   * @returns items oldest first.
   */
  async list(
    actor: BoardActor,
    filter: { status?: BoardStatus; state?: BoardState; spaceId?: string } = {},
  ): Promise<FaberLoomBoardItem[]> {
    const out: FaberLoomBoardItem[] = []
    for (const [id, record] of (await this.items()).entries()) {
      if (record.ownerId !== actor.id) continue
      if (record.companyId !== null && record.companyId !== actor.companyId) continue
      if (filter.status !== undefined && record.status !== filter.status) continue
      if (filter.state !== undefined && stateOf(record) !== filter.state) continue
      if (filter.spaceId !== undefined && record.spaceId !== filter.spaceId) continue
      out.push(toItem(id, record))
    }
    out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return out
  }
}

export default FaberLoomBoard
