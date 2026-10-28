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
import {
  boardDomainSpec,
  type BoardDraftRecord,
  type BoardItemRecord,
  type BoardKeyRecord,
  type BoardReferenceRecord,
} from './spec.ts'
import { submittedSeverity } from './classify.ts'
import { orderBoardItems } from './order.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  BoardActor,
  BoardApproveInput,
  BoardCandidate,
  BoardColumn,
  BoardCreateInput,
  BoardDataClass,
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
export * from './classify.ts'
export * from './order.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomBoard: FaberLoomBoard
  }
}

/** Board configuration accepted by the plugin row. */
export interface Config {
  /** Maximum inline audit events kept per item. */
  readonly eventCap?: number
  /**
   * Minimum classifier confidence accepted as a severity. A proposal below it
   * leaves the item unclassified; the signed pilot value is 0.80 (D-08).
   */
  readonly classifierConfidenceThreshold?: number
}

/** Validated board configuration. */
export const Config = z.object({
  eventCap: z.number().int().positive().default(200),
  classifierConfidenceThreshold: z.number().min(0).max(1).default(0.8),
})

/** Discard reasons signed in the specification. */
export const DISCARD_REASONS = [
  'CLIENTE_CANCELO', 'DUPLICADO', 'ERROR_ORIGEN', 'NO_CORRESPONDE', 'RESUELTO_FUERA', 'OTRA',
] as const

const TERMINAL: readonly BoardState[] = ['APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO']
/**
 * States that accept a new artifact as a candidate instead of being replaced
 * (W-03, W-40, W-55, W-76). `DESCONOCIDO` belongs here: the effect may already
 * have happened, so the item must stay traceable.
 */
const NOT_SUBSTITUTABLE: readonly BoardState[] = ['ITERANDO', 'EJECUCION_PENDIENTE', 'DESCONOCIDO']

/** Reference kinds the board records a tenant claim for. */
type ReferenceKind = 'run' | 'execution' | 'account'

/** References one create or submit carries, as the caller supplied them. */
interface BoardReferences {
  readonly spaceId?: string | undefined
  readonly runId?: string | undefined
  readonly executionId?: string | undefined
  readonly accountRef?: string | undefined
}

/** One commercial source a Space declares. */
interface BoardSpaceSource {
  readonly kind: string
  readonly id: string
}

/** The Space fields the board reads to verify a tenant reference. */
interface BoardSpace {
  readonly companyId?: string | undefined
  readonly sources?: readonly BoardSpaceSource[] | undefined
}

/** The `faberloomSpaces` surface the board reads through `ctx.get`. */
interface BoardSpaces {
  get(actor: { id: string; companyId?: string | undefined; role: string; readOnly: boolean }, id: string): Promise<BoardSpace>
}

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
    case 'DESCONOCIDO':
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

/**
 * The opaque references one command carries, skipping empty values.
 * @param refs - the references the caller supplied.
 * @returns kind and value pairs.
 */
function opaqueReferences(refs: BoardReferences): [ReferenceKind, string][] {
  const pairs: [ReferenceKind, string | undefined][] = [
    ['run', refs.runId],
    ['execution', refs.executionId],
    ['account', refs.accountRef],
  ]
  return pairs.filter((pair): pair is [ReferenceKind, string] => pair[1] !== undefined && pair[1].trim().length > 0)
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
  private readonly confidenceThreshold: number
  private readonly claims = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - inline audit cap and classifier confidence threshold.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomBoard')
    const resolved = Config.parse(config)
    this.eventCap = resolved.eventCap
    this.confidenceThreshold = resolved.classifierConfidenceThreshold
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

  private async references(): Promise<KvTable<string, BoardReferenceRecord>> {
    return (await this.domain()).table('references')
  }

  private draftId(itemId: FaberLoomBoardItemId | string, userId: string): string {
    return `${itemId}:${userId}`
  }

  private keyId(companyId: string | null, kind: string, key: string): string {
    return `${companyId ?? 'sin-empresa'}:${kind}:${key}`
  }

  private referenceKey(companyId: string | null, kind: ReferenceKind, value: string): string {
    return `${companyId ?? 'sin-empresa'}:${kind}:${value}`
  }

  /**
   * Claim one key for an item before its record exists, so a crash leaves a
   * claim without an item rather than two live items on the same key. A claim
   * held by another non-terminal item is a duplicate.
   * @param companyId - the tenant that owns the key space.
   * @param kind - `idem` or `bkey`.
   * @param key - the caller's key.
   * @param itemId - the item the claim names.
   */
  private async claimKey(companyId: string | null, kind: string, key: string, itemId: string): Promise<void> {
    const claimed = (await this.keys()).get(this.keyId(companyId, kind, key))
    if (claimed !== undefined && claimed.itemId !== itemId) {
      const holder = (await this.items()).get(claimed.itemId as FaberLoomBoardItemId)
      if (holder !== undefined && !TERMINAL.includes(stateOf(holder))) {
        throw new Error('faberloom: DUPLICATE — the key already owns a non-terminal item')
      }
    }
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

  /**
   * Refuse an item that names an object of another tenant (W-24). A Space is
   * resolved through the mounted Spaces service, which owns its tenant. The
   * board owns no run, execution, or account registry, so an opaque reference
   * is compared with the tenant that already stored it; a reference whose
   * tenant cannot be established is refused rather than stored.
   * @param actor - the acting identity.
   * @param companyId - the tenant the item will carry.
   * @param refs - the references the caller supplied.
   */
  private async verifyReferences(actor: BoardActor, companyId: string | null, refs: BoardReferences): Promise<void> {
    if (refs.spaceId !== undefined) await this.requireTenantSpace(actor, companyId, refs.spaceId, 'CROSS_TENANT_REFERENCE')
    for (const [kind, value] of opaqueReferences(refs)) {
      const claim = await this.referenceClaim(kind, value)
      if (claim !== undefined && claim.companyId !== companyId) {
        throw new Error(`faberloom: CROSS_TENANT_REFERENCE — the ${kind} reference belongs to another tenant`)
      }
    }
  }

  /** The claim already stored for one opaque reference, when any. */
  private async referenceClaim(kind: ReferenceKind, value: string): Promise<BoardReferenceRecord | undefined> {
    for (const [, record] of (await this.references()).entries()) {
      if (record.kind === kind && record.value === value) return record
    }
    return undefined
  }

  /**
   * Record the tenant of every opaque reference the item now stores.
   * @param companyId - the tenant the item carries.
   * @param itemId - the item that stored the references.
   * @param refs - the references the caller supplied.
   */
  private async claimReferences(companyId: string | null, itemId: string, refs: BoardReferences): Promise<void> {
    const table = await this.references()
    const at = new Date().toISOString()
    for (const [kind, value] of opaqueReferences(refs)) {
      const key = this.referenceKey(companyId, kind, value)
      if (table.get(key) !== undefined) continue
      await table.put(key, { companyId, kind, value, itemId, at })
    }
  }

  /**
   * Resolve one Space inside the actor's tenant. Without a mounted Spaces
   * service the reference cannot be verified, so it is refused.
   * @param actor - the acting identity.
   * @param companyId - the tenant the item carries.
   * @param spaceId - the referenced Space.
   * @param code - contract error code: a stored reference crosses tenants, a destination space is out of scope.
   * @returns the resolved Space.
   */
  private async requireTenantSpace(
    actor: BoardActor,
    companyId: string | null,
    spaceId: string,
    code: 'CROSS_TENANT_REFERENCE' | 'NO_ACCESS',
  ): Promise<BoardSpace> {
    const spaces = this.ctx.get('faberloomSpaces') as BoardSpaces | undefined
    if (spaces === undefined) {
      throw new Error(`faberloom: ${code} — no Spaces service can verify the space ${spaceId}`)
    }
    let space: BoardSpace
    try {
      space = await spaces.get({ id: actor.id, companyId: actor.companyId, role: 'client_b2b', readOnly: false }, spaceId)
    } catch (error) {
      throw new Error(`faberloom: ${code} — the space ${spaceId} is not readable by the actor`, { cause: error })
    }
    const spaceCompany = space.companyId ?? null
    if (spaceCompany !== null && spaceCompany !== companyId) {
      throw new Error(`faberloom: ${code} — the space ${spaceId} belongs to another tenant`)
    }
    return space
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
      valueAmount?: number
      valueCurrency?: string
      dueAt?: string
      dataClass?: BoardDataClass
      severity?: BoardSeverity
      severityConfidence?: number
    },
  ): BoardItemRecord {
    const now = new Date().toISOString()
    const evidence = requireEvidence(input.evidence)
    const artifactHash = hashOf({ summary: input.summary, evidence })
    const severity = submittedSeverity(
      input.severity,
      input.severityConfidence ?? null,
      this.confidenceThreshold,
    )
    return {
      ownerId: actor.id,
      companyId: input.companyId ?? actor.companyId ?? null,
      spaceId: input.spaceId ?? null,
      routineId: input.routineId ?? null,
      title: input.title,
      status: 'waiting_approval',
      state: input.state ?? 'PENDIENTE_CRITERIO',
      rowVersion: 1,
      severity: severity.severity,
      severitySource: severity.source,
      severityConfidence: severity.confidence,
      dueAt: input.dueAt ?? null,
      valueAmount: input.valueAmount ?? null,
      valueCurrency: input.valueCurrency ?? null,
      valueUsd: input.valueCurrency === 'USD' ? input.valueAmount ?? null : null,
      dataClass: input.dataClass ?? 'N2',
      dataClassProvisional: input.dataClass === undefined,
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
    const companyId = input.companyId ?? actor.companyId ?? null
    await this.verifyReferences(actor, companyId, {
      spaceId: input.spaceId,
      executionId: input.executionId,
      accountRef: input.accountRef,
    })
    const id = brandString<FaberLoomBoardItemId>(randomUUID())
    const record = this.buildRecord(actor, input)
    await (await this.items()).put(id, record)
    await this.claimReferences(companyId, id, { executionId: input.executionId, accountRef: input.accountRef })
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
    const references: BoardReferences = {
      spaceId: input.spaceId,
      runId: input.runId,
      executionId: input.executionId,
      accountRef: input.accountRef,
    }
    await this.verifyReferences(actor, companyId, references)

    return await this.serial(companyId, async () => {
      const existingId = await this.claimedItem(companyId, 'idem', input.idempotencyKey)
      if (existingId !== undefined) return toItem(existingId, await this.requireItem(existingId))

      const existing = await this.findNonTerminal(companyId, input.businessKey)
      let supersedes: string | null = null
      if (existing !== undefined) {
        // Uniqueness is per tenant, not per owner: another owner's live item on
        // the same key cannot be superseded by this actor.
        if (existing.record.ownerId !== actor.id) {
          throw new Error('faberloom: DUPLICATE — the business key already owns a non-terminal item')
        }
        const existingState = stateOf(existing.record)
        if (NOT_SUBSTITUTABLE.includes(existingState) || existingState === 'ERROR_RECUPERABLE') {
          const candidate: BoardCandidate = {
            id: randomUUID(),
            hash: hashOf({ summary: input.summary, evidence: input.evidence }),
            summary: input.summary,
            evidence: requireEvidence(input.evidence),
            at: new Date().toISOString(),
          }
          await this.mutate(actor, existing.id, 'candidate_arrived', current => ({ ...current, pendingCandidate: candidate }))
          await this.claimKey(companyId, 'idem', input.idempotencyKey, existing.id)
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
      // Both keys are claimed before the record exists: a crash between the
      // claim and the put leaves a claim, never a second live item.
      await this.claimKey(companyId, 'idem', input.idempotencyKey, id)
      try {
        await this.claimKey(companyId, 'bkey', input.businessKey, id)
        await (await this.items()).put(id, record)
      } catch (error) {
        await this.release(companyId, 'idem', input.idempotencyKey)
        await this.release(companyId, 'bkey', input.businessKey)
        throw error
      }
      await this.claimReferences(companyId, id, references)
      return toItem(id, record)
    })
  }

  /**
   * The non-terminal item of this tenant holding one business key (W-39).
   * @param companyId - the tenant that owns the key space.
   * @param businessKey - the business identity.
   * @param excludeId - an item to skip, typically the one the caller is acting on.
   * @returns the item and its record, or undefined.
   */
  private async findNonTerminal(
    companyId: string | null,
    businessKey: string,
    excludeId?: FaberLoomBoardItemId,
  ): Promise<{ id: FaberLoomBoardItemId; record: BoardItemRecord } | undefined> {
    for (const [id, record] of (await this.items()).entries()) {
      if (id === excludeId) continue
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
   * Refuse an edit while the item is iterating or already closed (W-10). The
   * panel hides the controls; the service is the enforcement point for MCP and
   * agent callers.
   * @param current - the stored record.
   */
  private requireEditable(current: BoardItemRecord): void {
    const state = stateOf(current)
    if (state === 'ITERANDO') throw new Error('faberloom: NO_ACCESS — the item is iterating and cannot be edited')
    if (TERMINAL.includes(state)) throw new Error('faberloom: NO_ACCESS — the item is closed and cannot be edited')
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
      this.requireEditable(current)
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
      const state = stateOf(current)
      if (state === 'ITERANDO') throw new Error('faberloom: NO_ACCESS — the item is iterating and cannot be discarded')
      if (state === 'DESCONOCIDO') throw new Error('faberloom: NO_ACCESS — the item result is unknown and cannot be discarded')
      if (TERMINAL.includes(state)) throw new Error('faberloom: NO_ACCESS — the item is closed and cannot be discarded')
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
   * Assign a space (and its root workspace) to an item. A collision with
   * another live item on the same business key resolves by the §2.3 rule: a
   * substitutable item closes, a non-substitutable one receives the artifact as
   * a candidate and stays open.
   * @param writer - the acting identity.
   * @param id - item id.
   * @param workspaceId - target space/workspace id.
   * @returns the live item: the assigned one, or the item that received the
   * transferred candidate.
   */
  async assignWorkspace(writer: BoardWriter, id: FaberLoomBoardItemId, workspaceId: string): Promise<FaberLoomBoardItem> {
    const actor = this.actorOf(writer)
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    if (TERMINAL.includes(stateOf(record))) {
      throw new Error('faberloom: NO_ACCESS — a closed item cannot be assigned to a space')
    }
    const companyId = record.companyId
    const space = await this.requireTenantSpace(actor, companyId, workspaceId, 'NO_ACCESS')
    this.requireCompatibleAccount(record, space)

    return await this.serial(companyId, async () => {
      const current = await this.requireItem(id)
      this.authorizeWrite(current, writer)
      if (TERMINAL.includes(stateOf(current))) {
        throw new Error('faberloom: NO_ACCESS — a closed item cannot be assigned to a space')
      }
      // The business key is the item's own identity (§2.1); assigning a space
      // never rewrites it, so the key keeps deduping the pair.
      const key = current.businessKey
      if (key === null) {
        return await this.mutate(writer, id, 'assign_workspace', item => ({ ...item, spaceId: workspaceId }))
      }
      const other = await this.findNonTerminal(companyId, key, id)
      let superseded: string | null = null
      if (other !== undefined && other.id !== id) {
        if (other.record.ownerId !== current.ownerId) {
          throw new Error('faberloom: DUPLICATE — the business key already owns a non-terminal item')
        }
        if (NOT_SUBSTITUTABLE.includes(stateOf(other.record))) {
          const candidate = this.candidateOf(current)
          await this.mutate(writer, other.id, 'candidate_arrived', item => ({
            ...item, pendingCandidate: candidate,
          }))
          await this.mutate(writer, id, 'superseded', item => ({
            ...item, state: 'SUSTITUIDO', status: 'completed',
          }), { reason: 'transferred-as-candidate' })
          await this.claimKey(companyId, 'bkey', key, other.id)
          return toItem(other.id, await this.requireItem(other.id))
        }
        await this.mutate(writer, other.id, 'superseded', item => ({
          ...item, state: 'SUSTITUIDO', status: 'completed',
        }), { reason: 'workspace-collision' })
        await this.release(companyId, 'bkey', key)
        superseded = other.id
      }
      await this.claimKey(companyId, 'bkey', key, id)
      return await this.mutate(writer, id, 'assign_workspace', item => ({
        ...item,
        spaceId: workspaceId,
        supersedesItemId: superseded ?? item.supersedesItemId,
      }))
    })
  }

  /** The candidate one item transfers when it cannot replace another (§2.2). */
  private candidateOf(record: BoardItemRecord): BoardCandidate {
    const revision = record.revisions[record.revisions.length - 1]
    return {
      id: randomUUID(),
      hash: record.artifactHash ?? hashOf({ title: record.title }),
      summary: revision?.summary ?? record.title,
      evidence: revision !== undefined ? [...revision.evidence] : [],
      at: new Date().toISOString(),
    }
  }

  /**
   * Refuse an assignment when the destination Space names the accounts it
   * serves and the item belongs to another one (W-59).
   * @param record - the item being assigned.
   * @param space - the resolved destination Space.
   */
  private requireCompatibleAccount(record: BoardItemRecord, space: BoardSpace): void {
    const clients = (space.sources ?? []).filter(source => source.kind === 'mwt-client').map(source => source.id)
    if (clients.length === 0) return
    if (record.accountRef !== null && clients.includes(record.accountRef)) return
    throw new Error('faberloom: ACCOUNT_MISMATCH — the item account is not served by the destination space')
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
      // W-76: an unconfirmed effect keeps its item traceable; reconciling it,
      // not correcting the artifact, is what resolves DESCONOCIDO.
      if (stateOf(current) === 'DESCONOCIDO') {
        throw new Error('faberloom: NO_ACCESS — the item result is unknown and cannot be corrected')
      }
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
   * Mark the item failed. `DESCONOCIDO` records an effect that may or may not
   * have happened: the item stays recoverable and verifiable, and it is never
   * `EJECUTADO` without confirmation (W-22).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param outcome - `FALLIDO` when the destination refused the effect, `DESCONOCIDO` when it did not answer.
   * @returns the updated item.
   */
  async fail(
    writer: BoardWriter,
    id: FaberLoomBoardItemId,
    outcome: 'FALLIDO' | 'DESCONOCIDO' = 'FALLIDO',
  ): Promise<FaberLoomBoardItem> {
    return await this.mutate(writer, id, 'fail', current => ({
      ...current,
      state: outcome === 'DESCONOCIDO' ? 'DESCONOCIDO' : 'ERROR_RECUPERABLE',
      status: 'failed',
    }), { data: { outcome } })
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
    await this.release(record.companyId, 'idem', record.idempotencyKey)
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
   * pending column; an approve follows the WorkLoom preconditions and binds to
   * the hash the caller names, never to whatever is current (W-09).
   * @param writer - the acting identity.
   * @param id - item id.
   * @param input - decision, exact revision, artifact hash, and optional note.
   * @returns the updated item.
   */
  async review(writer: BoardWriter, id: FaberLoomBoardItemId, input: BoardReviewInput): Promise<FaberLoomBoardItem> {
    const record = await this.requireItem(id)
    this.authorizeWrite(record, writer)
    if (input.decision === 'approve') {
      if (input.hash === undefined || input.hash.trim().length === 0) {
        throw new Error('faberloom: STALE_REVISION — an approval must name the artifact hash it reviewed')
      }
      return await this.approve(writer, id, {
        expectedRowVersion: record.rowVersion,
        expectedArtifactVersion: input.version,
        expectedArtifactHash: input.hash,
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
   * @returns items in the canonical queue order (§4): unclassified and
   * space-less first, then the severity, due date, value, creation, and id tuple.
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
    return orderBoardItems(out)
  }
}

export default FaberLoomBoard
