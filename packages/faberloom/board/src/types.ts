/**
 * Public type vocabulary of the native product board (work table): items with
 * their states, versioned revisions, evidence-gated submits, version-bound
 * approvals, revalidation, and authorization-gated effects. Types only — the
 * service and id factory live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-board/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one board item. */
export type FaberLoomBoardItemId = Branded<'FaberLoomBoardItemId'>

/**
 * The identity reading the board. `companyId` is the tenant scope the
 * deployment resolved for the caller; it is optional because a single-tenant
 * desktop deployment may not configure one.
 */
export interface BoardActor {
  /** Authenticated identity. */
  readonly id: string
  /** Company scope, when the deployment knows it. */
  readonly companyId?: string | undefined
}

/**
 * A write identity. A bare id is a legacy single-tenant actor with no company;
 * it can mutate only items that carry no company scope.
 */
export type BoardWriter = BoardActor | string

/** Board item lifecycle. */
export type BoardStatus =
  | 'in_progress' | 'waiting_data' | 'waiting_approval' | 'approved'
  | 'completed' | 'failed' | 'reopened' | 'needs_review'

/**
 * Persisted WorkLoom state (§3.1). `DESCONOCIDO` is the state of an item whose
 * external effect may or may not have happened (W-22): it is recoverable and
 * verifiable, never `EJECUTADO`, and it accepts a candidate but not a
 * substitution, a correction, or a discard (W-76).
 */
export type BoardState =
  | 'PENDIENTE_CRITERIO' | 'ITERANDO' | 'ESPERANDO_OTRO' | 'DELEGADO_EN_VENTANA'
  | 'EJECUCION_PENDIENTE' | 'ERROR_RECUPERABLE' | 'ERROR_SIN_SALIDA' | 'DESCONOCIDO'
  | 'APROBADO' | 'EJECUTADO' | 'DESCARTADO' | 'SUSTITUIDO'

/** Visible column, derived from the state and never written by a caller. */
export type BoardColumn = 'TU_CRITERIO' | 'ESPERANDO_CRITERIO' | 'DELEGADO' | 'ERROR_ACCIONABLE' | 'CERRADO'

/** Severity a rule, a model, or a human assigned. */
export type BoardSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

/** Data classification of the artifact. */
export type BoardDataClass = 'N0' | 'N1' | 'N2' | 'N3' | 'N4'

/** One immutable audit event, stored inside the item aggregate. */
export interface BoardEvent {
  /** Stable event id. */
  readonly id: string
  /** Command that produced it. */
  readonly command: string
  /** Actor identity. */
  readonly actor: string
  /** State before the command, or null on creation. */
  readonly fromState: BoardState | null
  /** State after the command. */
  readonly toState: BoardState
  /** Artifact revision at the event. */
  readonly revision: number | null
  /** Artifact hash at the event. */
  readonly artifactHash: string | null
  /** Optional reason (discard, stale, migration). */
  readonly reason: string | null
  /** ISO-8601 instant. */
  readonly at: string
  /** Extra structured detail. */
  readonly data: Record<string, unknown> | null
}

/** One candidate artifact that arrived while the item could not be replaced. */
export interface BoardCandidate {
  /** Candidate id. */
  readonly id: string
  /** Hash of the candidate content. */
  readonly hash: string
  /** Candidate summary. */
  readonly summary: string
  /** Evidence references. */
  readonly evidence: string[]
  /** ISO-8601 instant. */
  readonly at: string
}

/**
 * One draft an assignment moved from the item a collision closed to the live
 * item (§2.3, W-98). The receiving item lists it so the panel can offer the
 * work with "Esto se hizo sobre una versión anterior"; `baseVersion` is the
 * version the draft was written on.
 */
export interface BoardTransferredDraft {
  /** Table that holds the draft: `iteration_drafts` or `drafts`. */
  readonly kind: 'iteration' | 'edit'
  /** The live item that now holds the draft. */
  readonly itemId: FaberLoomBoardItemId
  /** Storage key inside that table. */
  readonly key: string
  /** Attempt that produced an iteration draft, or null for an edit draft. */
  readonly iterationId: string | null
  /** Owner of an edit draft, or null for an iteration draft. */
  readonly userId: string | null
  /** Artifact version the draft was written on. */
  readonly baseVersion: number
  /** Item the draft was made on, which the collision closed. */
  readonly transferredFrom: FaberLoomBoardItemId
}

/**
 * Result of `assignWorkspace`: the item a reader opens and the drafts a
 * collision moved to it. `transferredDrafts` is empty when no collision closed
 * a peer; a draft that cannot be attributed stays on the closed item.
 */
export interface BoardAssignment {
  /** The live item: the assigned one, or the peer that received the candidate. */
  readonly item: FaberLoomBoardItem
  /** Drafts moved from the closed item, with their base version and origin. */
  readonly transferredDrafts: readonly BoardTransferredDraft[]
}

/** One in-progress inline edit, owned by one browser tab. */
export interface BoardEditDraft {
  /** Item the draft edits. */
  readonly itemId: string
  /**
   * Item the draft was made on when a collision transferred it here (§2.3,
   * W-98), or null for a draft made on `itemId` itself.
   */
  readonly transferredFrom: string | null
  /** Owner of the draft. */
  readonly userId: string
  /** Version the edit started from. */
  readonly baseVersion: number
  /** Monotonic revision; a stale write is rejected. */
  readonly revision: number
  /** Tab that currently holds the writer seat. */
  readonly writerSession: string
  /** Changed fields. */
  readonly changes: Record<string, string>
  /** ISO-8601 instant. */
  readonly updatedAt: string
}

/** One immutable revision of an item. */
export interface BoardRevision {
  /** Revision number; every correction increments it. */
  readonly version: number
  /** Summary of what the revision contains. */
  readonly summary: string
  /** Real evidence references; a revision requires at least one. */
  readonly evidence: readonly string[]
  /**
   * Editable artifact content this revision fixed, or null for a revision
   * written before the draft carried content. Immutable with the revision, so
   * the hash binds the content the checks and the human reviewed.
   */
  readonly content: Readonly<Record<string, unknown>> | null
  /** Opaque document reference, or `null`. */
  readonly documentRef: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** One review decision over an exact revision. */
export interface BoardReview {
  /** Decision. */
  readonly decision: 'approve' | 'reject'
  /** The exact revision reviewed. */
  readonly version: number
  /** Optional note. */
  readonly note: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** One recorded external effect, gated by an explicit authorization. */
export interface BoardEffect {
  /** External reference the effect created. */
  readonly ref: string
  /** Detail for the effect. */
  readonly detail: string | null
  /** The explicit authorization that permitted it. */
  readonly authorization: string | null
  /** ISO-8601 instant. */
  readonly at: string
}

/**
 * Where one editable field of the draft came from. `source: null` is the
 * explicit "no origin" mark W-36 requires: a human wrote the value, so no
 * commercial source backs it.
 */
export interface BoardFieldOriginEntry {
  /** Field path inside the artifact content, e.g. `lines[0].unitPrice`. */
  readonly field: string
  /** Source identifier, e.g. `mwt.unit_price`, or null when the field has no origin. */
  readonly source: string | null
  /** Reference inside that source (document, key, selector), or null. */
  readonly ref: string | null
  /** ISO-8601 instant the source was read, or null. */
  readonly at: string | null
}

/** One board item. */
export interface FaberLoomBoardItem {
  /** Stable item id. */
  readonly id: FaberLoomBoardItemId
  /** Owning identity. */
  readonly ownerId: string
  /** Company scope that owns the item, or null when the deployment has none. */
  readonly companyId: string | null
  /** Optional owning space id. */
  readonly spaceId: string | null
  /** Routine this task feeds, or null when it is standalone. */
  readonly routineId: string | null
  /** Display title. */
  readonly title: string
  /** Current status. */
  readonly status: BoardStatus
  /** Persisted WorkLoom state; `status` remains for records written before E10. */
  readonly state: BoardState
  /** Visible column, derived from `state`. */
  readonly column: BoardColumn
  /** Current revision number. */
  readonly version: number
  /** Optimistic concurrency token. */
  readonly rowVersion: number
  /** Severity, or null while unclassified. */
  readonly severity: BoardSeverity | null
  /** Who assigned the severity. */
  readonly severitySource: 'RULE' | 'LLM' | 'HUMAN' | null
  /** Classifier confidence, or null. */
  readonly severityConfidence: number | null
  /** Deadline in UTC, or null. */
  readonly dueAt: string | null
  /** Amount in the original currency, or null. */
  readonly valueAmount: number | null
  /** Original currency, or null. */
  readonly valueCurrency: string | null
  /** Amount in USD at creation, or null. */
  readonly valueUsd: number | null
  /** Data classification. */
  readonly dataClass: BoardDataClass
  /** True while the classification is provisional (N2 by default). */
  readonly dataClassProvisional: boolean
  /** Action Engine run that created the item, or null. */
  readonly runId: string | null
  /** Idempotency key of the run step, or null. */
  readonly idempotencyKey: string | null
  /** Business identity, or null. */
  readonly businessKey: string | null
  /** Item this one replaces, or null. */
  readonly supersedesItemId: string | null
  /** Artifact type (`proforma`, `respuesta`, ...). */
  readonly artifactType: string
  /** Account/client reference, or null. */
  readonly accountRef: string | null
  /** Hash of the current artifact version, or null. */
  readonly artifactHash: string | null
  /** Editable content of the current revision; `{}` when the artifact has none. */
  readonly content: Readonly<Record<string, unknown>>
  /**
   * One entry per editable field of `content`: the source the value came from,
   * or an explicit no-origin mark (W-36).
   */
  readonly fieldOrigins: readonly BoardFieldOriginEntry[]
  /** Candidate waiting for an explicit choice, or null. */
  readonly pendingCandidate: BoardCandidate | null
  /** Audit events, oldest first. */
  readonly events: readonly BoardEvent[]
  /** Discard reason, or null. */
  readonly discardReason: string | null
  /** Discard note, or null. */
  readonly discardNote: string | null
  /** Current iteration id, or null. */
  readonly iterationId: string | null
  /** Saved iteration draft key, or null. */
  readonly iterationDraftKey: string | null
  /** Iteration lock expiry, or null. */
  readonly iterationLockUntil: string | null
  /** Iteration lock generation. */
  readonly iterationLockGeneration: number
  /** Version the current attempt started from, or null outside an attempt. */
  readonly iterationBaseVersion: number | null
  /**
   * Tab session that opened the current attempt, or null. The attempt, not the
   * user, is the lock subject: two tabs of one user are two attempts (§9.7.1).
   */
  readonly iterationLockBy: string | null
  /** Applied iteration rounds of this item; the panel suggests a rewrite at the limit (D-10). */
  readonly iterationRoundCount: number
  /** Every revision, ascending. */
  readonly revisions: readonly BoardRevision[]
  /** The revision currently approved, or `null`. */
  readonly approvedRevision: number | null
  /** Whether the item changed after its approval and must be revalidated. */
  readonly stale: boolean
  /** Why the item went stale, or `null`. */
  readonly staleReason: string | null
  /** Recorded effects; empty until an authorized effect runs. */
  readonly effects: readonly BoardEffect[]
  /** Review history. */
  readonly reviews: readonly BoardReview[]
  /** Originating execution id, when created from one. */
  readonly executionId: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
}

/** Submit input for one revision. */
export interface BoardSubmitInput {
  /** Short summary of the prepared result. */
  readonly summary: string
  /** Real evidence references; at least one is required. */
  readonly evidence: readonly string[]
  /** Opaque document reference. */
  readonly documentRef?: string
  /**
   * Editable artifact content of this revision (a proforma carries `lines`,
   * `total`, `orderRef`, and `separation`). Omitted keeps the previous content.
   */
  readonly content?: Record<string, unknown>
  /** Where each content field came from; a field absent here is marked without origin. */
  readonly fieldOrigins?: readonly BoardFieldOriginEntry[]
}

/** Create input for an item. */
export interface BoardCreateInput extends BoardSubmitInput {
  /** Display title. */
  readonly title: string
  /** Company scope, when the deployment resolved one. */
  readonly companyId?: string | undefined
  /** Optional owning space id. */
  readonly spaceId?: string
  /** Optional routine this task feeds. */
  readonly routineId?: string
  /** Originating execution id. */
  readonly executionId?: string
  /** Artifact type. */
  readonly artifactType?: string
  /** Business identity. */
  readonly businessKey?: string
  /** Account/client reference. */
  readonly accountRef?: string
}

/** Review input. */
export interface BoardReviewInput {
  /** Decision. */
  readonly decision: 'approve' | 'reject'
  /** The exact revision reviewed. */
  readonly version: number
  /**
   * The artifact hash the caller saw. Required for `approve`, so an approval
   * names its content instead of accepting whatever is current (W-09).
   */
  readonly hash?: string
  /** Optional note. */
  readonly note?: string
}

/** Effect input. */
export interface BoardEffectInput {
  /** External reference the effect created. */
  readonly ref: string
  /** Explicit authorization; required, since approval alone never sends. */
  readonly authorization?: string
  /** Detail for the effect. */
  readonly detail?: string
}

/** Input for a new item created by an Action Engine run. */
export interface BoardSubmitRequest extends BoardSubmitInput {
  /** Action Engine run id. */
  readonly runId: string
  /** Unique per run step. */
  readonly idempotencyKey: string
  /** Business identity of the artifact. */
  readonly businessKey: string
  /** Artifact type. */
  readonly artifactType?: string
  /** Account/client reference. */
  readonly accountRef?: string
  /** Amount in the original currency. */
  readonly valueAmount?: number
  /** Original currency. */
  readonly valueCurrency?: string
  /** Deadline in UTC. */
  readonly dueAt?: string
  /** Data classification. */
  readonly dataClass?: BoardDataClass
  /** Classifier severity. */
  readonly severity?: BoardSeverity
  /** Classifier confidence. */
  readonly severityConfidence?: number
  /** Owning space. */
  readonly spaceId?: string
  /** Company scope. */
  readonly companyId?: string
  /** Originating execution id. */
  readonly executionId?: string
  /** Human-readable title. */
  readonly title?: string
}

/** Input for inline edits saved as a new version. */
export interface BoardEditsInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion: number
  /** Version the edits were made against. */
  readonly baseVersion: number
  /** Changed fields, as a JSON-compatible record. */
  readonly changes: Record<string, unknown>
}

/** Input for an approval. */
export interface BoardApproveInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion: number
  /** Expected artifact version. */
  readonly expectedArtifactVersion: number
  /** Expected artifact hash. */
  readonly expectedArtifactHash: string
  /**
   * Ids of the `confirmacion` controls whose failure the human explicitly
   * accepted. A failed `confirmacion` control that is absent here rejects the
   * approval (spec §9.6; D-02 never approves silently).
   */
  readonly confirmations?: readonly string[]
}

/** Input for discard. */
export interface BoardDiscardInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion: number
  /** Closed-list reason. */
  readonly reason: string
  /** Note; required only for `OTRA`. */
  readonly note?: string
}

/** The item fields the canonical queue order reads. */
export interface BoardOrderFields {
  /** Item identity; the final tiebreaker. */
  readonly id: string
  /** Severity, or null while unclassified. */
  readonly severity: BoardSeverity | null
  /** Owning space, or null when the item has none. */
  readonly spaceId: string | null
  /** Deadline in UTC, or null. */
  readonly dueAt: string | null
  /** Amount in USD at creation, or null. */
  readonly valueUsd: number | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/** One space group ordered by the tuple of its first item. */
export interface BoardOrderGroup<T extends BoardOrderFields = BoardOrderFields> {
  /** Space the group belongs to, or null for items without one. */
  readonly spaceId: string | null
  /** Members, in any input order. */
  readonly items: readonly T[]
}

/** Who produced a classification value. */
export type BoardClassifySource = 'RULE' | 'LLM'

/** One deterministic severity rule, keyed by artifact type and optionally by account. */
export interface BoardSeverityRule {
  /** Artifact type the rule matches. */
  readonly artifactType: string
  /** Account the rule is limited to; absent matches every account. */
  readonly accountRef?: string
  /** Severity the rule assigns. */
  readonly severity: BoardSeverity
}

/** A severity rule table with its version. */
export interface BoardClassifyRules {
  /** Rule version; a change invalidates classifications cached under the old version. */
  readonly version: string
  /** Rules in input order; an account-specific rule wins over a type-wide one. */
  readonly rules: readonly BoardSeverityRule[]
}

/** One deterministic data-class rule. */
export interface BoardDataClassRule {
  /** Artifact type the rule matches. */
  readonly artifactType: string
  /** Account the rule is limited to; absent matches every account. */
  readonly accountRef?: string
  /** Class the rule assigns. */
  readonly dataClass: BoardDataClass
  /** Fields the class permits to a provider and to the card. */
  readonly permittedFields: readonly string[]
}

/** A data-class policy with its version. */
export interface BoardDataClassPolicy {
  /** Policy version; a change invalidates classifications cached under the old version. */
  readonly version: string
  /** Rules in input order; an account-specific rule wins over a type-wide one. */
  readonly rules: readonly BoardDataClassRule[]
}

/** What the classifier reported for one field. */
export type BoardClassifierResult =
  | { readonly status: 'classified'; readonly severity: BoardSeverity; readonly confidence: number }
  | { readonly status: 'timeout' }
  | { readonly status: 'invalid'; readonly detail: string }

/** Severity with the provenance to persist beside it. */
export interface BoardSeverityDecision {
  /** Resolved severity, or null when nothing resolved. */
  readonly severity: BoardSeverity | null
  /** Who produced it, or null when nothing resolved. */
  readonly source: BoardClassifySource | null
  /** Confidence of the proposal, or null when nothing resolved. */
  readonly confidence: number | null
}

/** Data class of an item and the provider class it may reach. */
export interface BoardDataClassDecision {
  /** Class assigned by rule, or N2 while provisional. */
  readonly dataClass: BoardDataClass
  /** True while the class is provisional and no field list is defined. */
  readonly provisional: boolean
  /** Highest provider class allowed by this decision. */
  readonly providerClass: BoardDataClass
  /** Fields a deterministic rule enabled; empty while provisional. */
  readonly permittedFields: readonly string[]
}

/** What one item may show, send, and feed into derived products. */
export interface BoardContentProjection {
  /** True when the card may show the item's content. */
  readonly contentVisible: boolean
  /** Fields the card and the provider may receive. */
  readonly fields: readonly string[]
  /** Whether the item enters the search index. */
  readonly indexed: boolean
  /** Whether the item may produce learning candidates. */
  readonly learningCandidates: boolean
  /** Whether the item may enter the classification cache. */
  readonly classificationCache: boolean
  /** Whether the item may enter another item's context. */
  readonly sharedContext: boolean
}

/**
 * Control class of one deterministic check (spec §9.6, signed by D-8). A
 * `bloqueante` failure blocks approval and execution; a `confirmacion` failure
 * requires an explicit confirmation; an `informativo` failure is shown only.
 */
export type BoardCheckClass = 'informativo' | 'confirmacion' | 'bloqueante'

/** Outcome one check reports. */
export type BoardCheckStatus = 'ok' | 'warning' | 'fail'

/**
 * What one check reports. Every result names the source it consulted, that
 * source's version, and when it read it, because the spec requires each control
 * to record which source answered and when.
 */
export interface BoardCheckResult {
  /** Outcome of the control. A source that cannot answer reports `fail`. */
  readonly status: BoardCheckStatus
  /** Source consulted (`mwt.price`, `artifact`, `unavailable`), never empty. */
  readonly source: string
  /** Version or etag the source reported, or null when it reports none. */
  readonly sourceVersion: string | null
  /** ISO-8601 instant of the read. */
  readonly checkedAt: string
  /** Field paths the result applies to, so the panel can link the control to the draft. */
  readonly fields: readonly string[]
  /** Stable reason code when the status is not `ok`, or null. */
  readonly reason?: string | null
  /** Diagnostic detail for operators; never shown as product copy. */
  readonly detail?: string | null
}

/** The exact artifact one check evaluates. */
export interface BoardArtifact {
  /** Artifact type of the item (`proforma`, `respuesta`, ...). */
  readonly type: string
  /** Revision number the content belongs to. */
  readonly version: number
  /** Editable content of that revision. */
  readonly content: Readonly<Record<string, unknown>>
}

/**
 * What one check receives. `source` is the port the registration supplied; a
 * check that needs a source and receives none reports `fail`, never `ok`.
 */
export interface BoardCheckInput {
  /** The item under review, as the panel sees it. */
  readonly item: FaberLoomBoardItem
  /** The exact artifact revision the check evaluates. */
  readonly artifact: BoardArtifact
  /** Source port of the registration, or undefined when it registered none. */
  readonly source: BoardCheckSource | undefined
}

/** One check implementation: deterministic from the board's point of view. */
export type BoardCheckFn = (input: BoardCheckInput) => BoardCheckResult | Promise<BoardCheckResult>

/** One declared control: its stable id and the class D-8 signed. */
export interface BoardCheckDefinition {
  /** Stable id, e.g. `proforma.price`. */
  readonly id: string
  /** Class fixed by D-8; a registration with another class is refused. */
  readonly class: BoardCheckClass
}

/** Registration options of one check. */
export interface BoardCheckOptions {
  /** Class fixed by D-8; must match the declaration. */
  readonly class: BoardCheckClass
  /** Source port the check reads; the registration forwards it into `BoardCheckInput.source`. */
  readonly source?: BoardCheckSource
}

/** Registration state of one declared control. */
export interface BoardCheckStatusEntry {
  /** Declared check id. */
  readonly id: string
  /** Class the control runs under. */
  readonly class: BoardCheckClass
  /** Whether an adapter registered an implementation. */
  readonly registered: boolean
}

/** The registrar a check adapter mounts against (`ctx.faberloomBoard`). */
export interface BoardCheckRegistrar {
  /**
   * Register one check implementation.
   * @param artifactType - artifact type the check applies to.
   * @param checkId - declared check id.
   * @param fn - the implementation.
   * @param options - signed class and the source port the check reads.
   * @returns the disposer that removes the registration.
   */
  registerCheck(
    artifactType: string,
    checkId: string,
    fn: BoardCheckFn,
    options: BoardCheckOptions,
  ): () => void
}

/** One executed control with the class it ran under. */
export interface BoardCheckOutcome {
  /** Declared check id. */
  readonly id: string
  /** Class the control ran under. */
  readonly class: BoardCheckClass
  /** What the implementation reported. */
  readonly result: BoardCheckResult
}

/**
 * The control report of one item. `missing` lists declared controls with no
 * registered adapter: approval refuses such an item with `CHECK_UNAVAILABLE`
 * instead of treating the gap as a pass (ADR-003).
 */
export interface BoardCheckReport {
  /** Executed controls, in declaration order. */
  readonly checks: readonly BoardCheckOutcome[]
  /** Declared check ids without a registration. */
  readonly missing: readonly string[]
}

/** One answer from a commercial source, with the freshness record the spec requires. */
export interface BoardSourceAnswer<T> {
  /** The datum, or null when the source answered "no record". */
  readonly value: T | null
  /** Source identifier, e.g. `mwt.price`. */
  readonly source: string
  /** Version or etag the source reported, or null. */
  readonly version: string | null
  /** ISO-8601 instant of the read. */
  readonly readAt: string
}

/** Catalog facts of one SKU. */
export interface BoardSkuFacts {
  /** Whether the catalog knows the SKU. */
  readonly exists: boolean
}

/**
 * The order total an expediente records, both sides stated. `overcharge` is
 * the difference `totalClient - totalMwt`; the adapter reads both sides so the
 * board never compares against a half-read total (D-01).
 */
export interface BoardOrderTotals {
  /** Amount the client is billed for the order (`total_client`). */
  readonly totalClient: number
  /** Amount the source charges for the order (`total_mwt`). */
  readonly totalMwt: number
}

/** Stock facts of one SKU. */
export interface BoardStockFacts {
  /** Units the source reports as available. */
  readonly available: number
}

/**
 * One line of the original purchase order: the unit D-01's per-line overcharge
 * compares. A source answers one line per SKU and size, so a SKU may own
 * several lines.
 */
export interface BoardOrderLine {
  /** Ordered SKU. */
  readonly sku: string
  /** Size the source states for the line, or null when it states none. */
  readonly size: string | null
  /** Ordered quantity. */
  readonly quantity: number
  /** Price per unit the source charges for the line, or null when unreadable. */
  readonly unitPriceMwt: number | null
  /** Price per unit the client is billed for the line, or null when unreadable. */
  readonly unitPriceClient: number | null
}

/** Whether the account needs a complement letter or a new proforma. */
export interface BoardSeparationFacts {
  /** The separation the account's rule requires for this document. */
  readonly required: 'complement' | 'new'
}

/**
 * The commercial source port a check adapter fills (ADR-003). The adapter owns
 * the calls (`mcp__mwt__expediente_listar`, `mcp__mwt__stock_listar`, ...) and
 * the freshness rule; the board only consumes the answer.
 *
 * A source that cannot answer throws: the board converts that throw into a
 * `fail` result, so an outage is never a skipped control. A source that can
 * answer "no record" returns `value: null`; D-01 makes that a blocking failure
 * and D-02 a confirmation.
 */
export interface BoardCheckSource {
  /** Catalog existence of one SKU. */
  sku(sku: string): Promise<BoardSourceAnswer<BoardSkuFacts>>
  /** Available stock for one SKU. */
  stock(sku: string): Promise<BoardSourceAnswer<BoardStockFacts>>
  /** Lines of the original purchase order the draft answers. */
  orderLines(orderRef: string): Promise<BoardSourceAnswer<readonly BoardOrderLine[]>>
  /** Both sides of the order total the draft answers. */
  orderTotals(orderRef: string): Promise<BoardSourceAnswer<BoardOrderTotals>>
  /** Separation the account rule requires for this document. */
  separation(request: {
    readonly accountRef: string
    readonly businessKey: string | null
  }): Promise<BoardSourceAnswer<BoardSeparationFacts>>
}

/** One line of a proforma draft. */
export interface BoardProformaLine {
  /** Catalog SKU. */
  readonly sku: string
  /** Optional description carried for display only. */
  readonly description?: string
  /** Quantity the draft bills. */
  readonly quantity: number
  /** Unit price the draft bills. */
  readonly unitPrice: number
}

/** The editable content of a proforma draft, as the checks read it. */
export interface BoardProformaContent {
  /** Original purchase order the draft answers. */
  readonly orderRef?: string
  /** Billed lines. */
  readonly lines?: readonly BoardProformaLine[]
  /** Billed total, which must equal the sum of the lines. */
  readonly total?: number
  /** Whether the draft is a complement letter or a new proforma. */
  readonly separation?: 'complement' | 'new'
}

/**
 * Lifecycle of the iteration attempt of one item (§9.7.1). `active` holds a
 * lock with a future deadline; `expired` is an `ITERANDO` record whose deadline
 * passed, which reads and behaves as "Guardar y salir" (W-44); `idle` carries
 * no attempt.
 */
export type BoardIterationPhase = 'idle' | 'active' | 'expired'

/**
 * Why an attempt ended and returned the item to the pending column. All four
 * keep the working draft and leave a pending candidate untouched (W-41, W-97);
 * `lock-vencido` is the same exit the read path applies on expiry.
 */
export type BoardIterationExitReason =
  | 'guardar-y-salir' | 'llevar-a-spaceloom' | 'volver-sin-resolver' | 'lock-vencido'

/**
 * Scope one applied iteration teaches (§6.3). `puntual` teaches nothing; the
 * other three become learning candidates. The board records the choice and the
 * learning registry consumes it; no promotion happens here (W-34, W-35).
 */
export type BoardCorrectionScope = 'puntual' | 'cuenta' | 'espacio' | 'agente'

/**
 * The working draft of one attempt: the work not yet applied, linked to the
 * artifact version it was written against (§9.7.1). `archived` is true when the
 * attempt that produced it is no longer live, which is how a late agent answer
 * is kept without touching the item or resurfacing in the panel (W-57).
 */
export interface BoardIterationDraft {
  /** Storage key of the draft, always `<itemId>:<iterationId>`. */
  readonly key: string
  /** Item the draft edits. */
  readonly itemId: string
  /**
   * Item the draft was made on when a collision transferred it here (§2.3,
   * W-98), or null for a draft made on `itemId` itself.
   */
  readonly transferredFrom: string | null
  /** Attempt that produced the draft. */
  readonly iterationId: string
  /** Artifact version the draft was written against. */
  readonly baseVersion: number
  /** Draft summary, or null when the attempt only changed content. */
  readonly summary: string | null
  /** Evidence references the draft declares. */
  readonly evidence: readonly string[]
  /** Draft artifact content, or null when the attempt only changed the summary. */
  readonly content: Readonly<Record<string, unknown>> | null
  /** True once the base version is no longer the current one, or the attempt is dead. */
  readonly archived: boolean
  /** True when a resume found the draft written against an older version (W-68). */
  readonly outdated: boolean
  /** ISO-8601 instant of the last draft write. */
  readonly updatedAt: string
  /** ISO-8601 instant after which the draft is not offered again (D-09). */
  readonly retainUntil: string
}

/** What one item's iteration attempt looks like to the panel right now. */
export interface BoardIterationStatus {
  /** Attempt lifecycle; an expired attempt already reads as paused. */
  readonly phase: BoardIterationPhase
  /** Attempt id, or null when the item carries none. */
  readonly iterationId: string | null
  /** Lock generation of the attempt; every acquisition bumps it. */
  readonly generation: number
  /** Artifact version the attempt started from, or null. */
  readonly baseVersion: number | null
  /** Lock deadline in UTC, or null. */
  readonly lockUntil: string | null
  /** Tab session holding the attempt, or null. */
  readonly lockBy: string | null
  /** Seconds a client waits between renewals (D-09). */
  readonly renewalSeconds: number
  /** Rounds applied to this item so far. */
  readonly rounds: number
  /** Rounds after which the panel suggests rewriting or discarding (D-10). */
  readonly roundLimit: number
  /** True once the item reached the round limit. It only suggests; nothing blocks (D-10). */
  readonly suggestRewrite: boolean
  /** Retained draft of the attempt, or null. */
  readonly draft: BoardIterationDraft | null
  /** True when the retained draft was written against an older version (W-68). */
  readonly draftOutdated: boolean
  /** True while a candidate artifact waits for an explicit choice. */
  readonly candidatePending: boolean
}

/** One iteration command's answer: the item after the commit and its attempt. */
export interface BoardIterationResult {
  /** Item as the panel reads it after the command. */
  readonly item: FaberLoomBoardItem
  /** Attempt state after the command. */
  readonly status: BoardIterationStatus
}

/** Input for `iterate`: the version the caller saw and the tab opening the attempt. */
export interface BoardIterateInput {
  /** Artifact version the attempt starts from. */
  readonly baseVersion: number
  /** Tab session that opens the attempt, so a second tab is a different attempt. */
  readonly actorSession: string
}

/** Input for `iterateWithEdits`: the edits and the attempt that starts over them. */
export interface BoardIterateWithEditsInput extends BoardEditsInput {
  /** Tab session that opens the attempt. */
  readonly actorSession: string
}

/** The attempt one iteration write targets. */
export interface BoardIterationLockInput {
  /** Attempt the caller believes is current. */
  readonly iterationId: string
  /** Lock generation the caller believes is current. */
  readonly generation: number
  /**
   * Tab session issuing the write. It must equal the live attempt's
   * `iterationLockBy`; another session is refused with `LOCK_HELD` and no
   * effect (§9.7.1).
   */
  readonly actorSession: string
}

/** Input for `pauseIteration`. */
export interface BoardPauseIterationInput extends BoardIterationLockInput {
  /** Exit the user chose, or `lock-vencido` for the expiry path. */
  readonly reason: BoardIterationExitReason
}

/**
 * The explicit choice over a pending candidate (§2.2). A candidate is never
 * adopted implicitly: `keep` discards it and keeps the live version, `adopt`
 * makes it the live version.
 */
export interface BoardCandidateChoice {
  /** Candidate the user saw. */
  readonly id: string
  /** Hash the user saw; a changed candidate rejects the choice. */
  readonly hash: string
  /** Adopt the candidate or keep the current version. */
  readonly decision: 'adopt' | 'keep'
}

/** Input for `cancelIteration`. */
export interface BoardCancelIterationInput extends BoardIterationLockInput {
  /** Required while a candidate is pending; its resolution commits with the cancel. */
  readonly candidate?: BoardCandidateChoice
}

/** Input for `applyIteration`. */
export interface BoardApplyIterationInput extends BoardIterationLockInput {
  /** Artifact version the attempt started from. */
  readonly baseVersion: number
  /** Summary of the applied version; defaults to the draft, then the current revision. */
  readonly summary?: string
  /** Evidence of the applied version; defaults to the draft, then the current revision. */
  readonly evidence?: readonly string[]
  /** Scope the correction teaches; the board records it and learning consumes it (W-34). */
  readonly scope: BoardCorrectionScope
  /** Required while a candidate is pending. */
  readonly candidate?: BoardCandidateChoice
}

/** Input for `resumeIteration`. */
export interface BoardResumeIterationInput {
  /** Base version of the retained draft the caller saw. */
  readonly baseVersion: number
  /** Tab session opening the new attempt; it becomes the attempt's holder. */
  readonly actorSession: string
}

/** Input for `saveIterationDraft`: one validated write of the attempt's work. */
export interface BoardIterationDraftInput extends BoardIterationLockInput {
  /** Artifact version the caller wrote against. */
  readonly baseVersion: number
  /** Draft summary. */
  readonly summary?: string
  /** Draft evidence references. */
  readonly evidence?: readonly string[]
  /** Draft artifact content, merged over the previous draft. */
  readonly content?: Readonly<Record<string, unknown>>
}

/**
 * Result of a draft write. `linked` is true when the attempt was live and the
 * item now points at the draft; false means the draft belongs to a dead
 * attempt, so it is archived and the item was not touched (W-57).
 */
export interface BoardIterationDraftOutcome {
  /** The stored draft. */
  readonly draft: BoardIterationDraft
  /** Whether the item links this draft. */
  readonly linked: boolean
  /** Stable reason the draft was archived instead of linked, or null. */
  readonly code: 'LOCK_LOST' | 'ITERATION_STALE' | null
}

/** One field where a retained draft and the current version disagree (W-68). */
export interface BoardIterationDifference {
  /** Top-level content key. */
  readonly field: string
  /** Value the draft holds. */
  readonly draftValue: unknown
  /** Value the current version holds. */
  readonly currentValue: unknown
}

/**
 * Result of `resumeIteration`. `started` means a new attempt holds the draft;
 * `outdated` means the draft was written against an older version, so the
 * differences are returned and nothing was overwritten (W-68).
 */
export type BoardResumeIterationResult =
  | { readonly item: FaberLoomBoardItem; readonly status: 'started' }
  | {
    readonly item: FaberLoomBoardItem
    readonly status: 'outdated'
    readonly differences: readonly BoardIterationDifference[]
  }
