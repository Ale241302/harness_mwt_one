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
  /**
   * Console role (`admin`, `client_b2b`, `viewer`, ...) when the deployment
   * carries one. An administrator of the tenant may close an item
   * administratively without owning it (D-9, W-65); every other command still
   * requires the owner.
   */
  readonly role?: string | undefined
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
  /**
   * Effect key of the accepted execution (E15), or null when nothing was
   * authorized. It identifies the reservation that this item owns.
   */
  readonly effectKey: string | null
  /**
   * Instant the delegated reversal window closes, or null outside
   * `DELEGADO_EN_VENTANA`. The window postpones the effect: nothing is emitted
   * before it (D-4, W-19), and a delegated item without a deadline is refused
   * (W-17).
   */
  readonly reversalDeadline: string | null
  /** Last reported outcome of the external effect, or null while none was reported. */
  readonly executionOutcome: BoardEffectOutcome | null
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
 * is kept without touching the item (W-57). An archived draft the item never
 * linked stays offered, so its text is reachable through `resumeIteration`;
 * `superseded` marks the one case that is not: a newer attempt over the item
 * replaced it.
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
  /** True when the attempt that produced the draft is no longer live (W-57). */
  readonly archived: boolean
  /** True when a newer attempt over the item replaced this draft, so nothing offers it again. */
  readonly superseded: boolean
  /** True when a resume found the draft written against an older version (W-68). */
  readonly outdated: boolean
  /** ISO-8601 instant of the last draft write. */
  readonly updatedAt: string
  /** ISO-8601 instant after which the draft is not offered again (D-09). */
  readonly retainUntil: string
  /** Whether `retainUntil` is still ahead of the clock the draft was read at (D-09). */
  readonly retained: boolean
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
  /**
   * The latest draft the item offers: the linked one while it is retained, else
   * the retained draft of an attempt the item no longer links, which is how a
   * late answer for a dead attempt stays reachable (W-57). A draft a newer
   * attempt replaced, and one past its retention window, are not offered.
   */
  readonly draft: BoardIterationDraft | null
  /** True when the item links `draft`; false means it is retained work of a dead attempt. */
  readonly draftLinked: boolean
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

/** Input for `recoverTransferredDraft`: the draft a collision moved here and the tab opening the attempt. */
export interface BoardRecoverDraftInput {
  /** Key `transferredDrafts` listed for this item. */
  readonly draftKey: string
  /** Tab session opening the attempt; it becomes the attempt's holder. */
  readonly actorSession: string
}

/**
 * Result of `recoverTransferredDraft`, with the two outcomes `resumeIteration`
 * has: `started` links the transferred draft as the live attempt's draft, and
 * `outdated` returns the differences without writing the item (W-68, W-98).
 * Neither outcome writes the artifact version; only `applyIteration` does.
 */
export type BoardRecoverDraftResult = BoardResumeIterationResult

// ── External effects (E15) ───────────────────────────────────────────

/**
 * What a destination said about one effect (§10.1). `CONFIRMADO` is the only
 * outcome that leads to `EJECUTADO`; `DESCONOCIDO` keeps the item recoverable
 * and verifiable, never executed (W-22).
 */
export type BoardEffectOutcome = 'CONFIRMADO' | 'FALLIDO' | 'DESCONOCIDO'

/**
 * State of one effect reservation. Only `RESERVADA` (and `DESPACHADA`) blocks a
 * competing execution; `CONCILIADA` and `LIBERADA` are terminal for the key.
 */
export type BoardReservationStatus = 'RESERVADA' | 'DESPACHADA' | 'CONCILIADA' | 'LIBERADA'

/**
 * State of one outbox message. `CANCELADO` is not dispatchable and the consumer
 * ignores it; `DESPACHADO` means the effect went out and awaits a confirmation.
 */
export type BoardOutboxStatus = 'PENDIENTE' | 'DESPACHADO' | 'CONFIRMADO' | 'FALLIDO' | 'CANCELADO'

/**
 * One reservation of one effect, as the panel and the consumer read it. The
 * contract fixes the identity of the row: one per tenant and `effectKey`, tied
 * to the execution that owns it.
 */
export interface BoardEffectReservation {
  /** Tenant that owns the reservation; null is the single-tenant deployment. */
  readonly companyId: string | null
  /** Effect the reservation protects. */
  readonly effectKey: string
  /** Action type of the effect (`mail.send`, `inventory.reserve`, ...). */
  readonly actionType: string
  /** Normalised destination. */
  readonly destination: string
  /** Business identity the effect belongs to. */
  readonly businessKey: string
  /** Exact artifact version the effect was authorized for. */
  readonly artifactHash: string
  /** Execution that owns the reservation; its retries keep this id (W-84). */
  readonly executionId: string
  /** Item that authorized the effect. */
  readonly itemId: string
  /** Idempotency key the destination receives; a retry keeps it (W-77). */
  readonly idempotencyKey: string
  /** Explicit authorization recorded with the acceptance, or null. */
  readonly authorization: string | null
  /** Reservation state. */
  readonly status: BoardReservationStatus
  /** Last reported outcome, or null while none was reported. */
  readonly outcome: BoardEffectOutcome | null
  /** Instant the delegated window closes, or null when the action type has no window. */
  readonly reversalDeadline: string | null
  /** Instant the effect was dispatched, or null. */
  readonly dispatchedAt: string | null
  /** Instant the reservation was released, or null. */
  readonly releasedAt: string | null
  /** Why it was released, or null. */
  readonly releaseReason: string | null
  /** Instant the item was closed administratively, or null. */
  readonly closedAt: string | null
  /** Identity that closed the item administratively, or null. */
  readonly closedBy: string | null
  /** Reason the item was closed administratively, or null. */
  readonly closeReason: string | null
  /** Instant the reservation reached a terminal state, or null. */
  readonly settledAt: string | null
  /** ISO-8601 instant the reservation was first acquired. */
  readonly createdAt: string
  /** ISO-8601 instant of the last mutation. */
  readonly updatedAt: string
  /** Instant after which a settled reservation may be pruned, or null. */
  readonly retainUntil: string | null
}

/** One outbox message: the durable intention to emit one effect (§5 of the contract). */
export interface BoardOutboxMessage {
  /** Tenant that owns the message. */
  readonly companyId: string | null
  /** Effect the message emits; one message per effect. */
  readonly effectKey: string
  /** Execution the message belongs to. */
  readonly executionId: string
  /** Item that authorized the effect. */
  readonly itemId: string
  /** Action type of the effect. */
  readonly actionType: string
  /** Normalised destination. */
  readonly destination: string
  /** Idempotency key the destination receives. */
  readonly idempotencyKey: string
  /** Message state. */
  readonly status: BoardOutboxStatus
  /** Whether the consumer may emit it; false once cancelled, dispatched, or failed. */
  readonly dispatchable: boolean
  /** Dispatch attempts so far. */
  readonly attempts: number
  /** Stable reason the message stopped being dispatchable, or null. */
  readonly reason: string | null
  /** Destination reference the adapter reported, or null. */
  readonly ref: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last mutation. */
  readonly updatedAt: string
  /** Instant the message was handed to the adapter, or null. */
  readonly dispatchedAt: string | null
  /** Instant the message reached a terminal state, or null. */
  readonly settledAt: string | null
  /** Instant after which a settled message may be pruned, or null. */
  readonly retainUntil: string | null
}

/**
 * One visible alert. A late confirmation after an administrative close raises
 * it (W-85); the recovery sweep raises `ORPHAN_RELEASED` when it frees a
 * reservation no item reaches, so the key does not change hands unremarked.
 */
export interface BoardEffectAlert {
  /** Tenant that owns the alert. */
  readonly companyId: string | null
  /** Effect the alert is about. */
  readonly effectKey: string
  /** Item involved, or the item the orphaned reservation named. */
  readonly itemId: string
  /** Execution that reported the outcome or held the reservation. */
  readonly executionId: string
  /** Alert class: a late confirmation, or a reservation no item reached. */
  readonly kind: BoardEffectAlertKind
  /** Outcome the destination reported, or null when the alert is not about one. */
  readonly outcome: BoardEffectOutcome | null
  /** Optional detail from the reconciliation or the sweep. */
  readonly detail: string | null
  /** Identity that reconciled the effect or ran the sweep. */
  readonly actor: string
  /** ISO-8601 instant the alert was raised. */
  readonly createdAt: string
  /** ISO-8601 instant of the last update. */
  readonly updatedAt: string
}

/** Alert classes the board raises for one effect. */
export type BoardEffectAlertKind = 'LATE_CONFIRMATION' | 'ORPHAN_RELEASED'

/**
 * One audit event of an effect no item can hold. Every other command audits
 * inside the item aggregate; an orphaned reservation has no item, so its
 * release is recorded in `effect_events`.
 */
export interface BoardEffectEvent {
  /** Tenant that owns the event. */
  readonly companyId: string | null
  /** Effect the event is about. */
  readonly effectKey: string
  /** Command that produced it. */
  readonly command: 'effect.orphaned'
  /** Identity that ran the command. */
  readonly actor: string
  /** Item the reservation named, or null when the row carried none. */
  readonly itemId: string | null
  /** Execution that held the reservation, or null. */
  readonly executionId: string | null
  /** Structured detail of the command, or null. */
  readonly detail: Record<string, unknown> | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** What one recovery sweep did: the keys it freed and the rows it wrote. */
export interface BoardOrphanRecovery {
  /** Effect keys whose reservation and message the sweep settled. */
  readonly released: readonly string[]
  /** Audit events the sweep stored. */
  readonly events: readonly BoardEffectEvent[]
  /** Alerts the sweep raised, one per released key. */
  readonly alerts: number
}

/** Everything one item's effect looks like to the panel. */
export interface BoardEffectStatus {
  /** Effect key of the accepted execution. */
  readonly effectKey: string
  /** Instant the delegated window closes, or null. */
  readonly reversalDeadline: string | null
  /** Last reported outcome, or null. */
  readonly executionOutcome: BoardEffectOutcome | null
  /** Reservation of the effect, or null when none is stored. */
  readonly reservation: BoardEffectReservation | null
  /** Outbox message of the effect, or null when none is stored. */
  readonly message: BoardOutboxMessage | null
  /** Visible alerts raised for this effect, newest last. */
  readonly alerts: readonly BoardEffectAlert[]
  /**
   * True while the effect went out and no reconciliation settled it. An
   * administratively closed item keeps this true, because the close leaves the
   * reconciliation open (W-65).
   */
  readonly reconciliationOpen: boolean
}

/** One acceptance that reserves an effect: the item, its reservation, and its message. */
export interface BoardEffectExecution {
  /** Item after the acceptance. */
  readonly item: FaberLoomBoardItem
  /** Reservation the acceptance acquired. */
  readonly reservation: BoardEffectReservation
  /** Outbox message the acceptance wrote. */
  readonly message: BoardOutboxMessage
}

/** Why the consumer did or did not emit one effect. */
export type BoardDispatchCode =
  | 'DISPATCHED'
  | 'OUTBOX_NOT_PENDING'
  | 'WINDOW_OPEN'
  | 'EFFECT_NO_ADAPTER'
  | 'REVALIDATION_FAILED'
  | 'NOT_AUTHORIZED'
  | 'STALE_REVALIDATION'
  | 'ITEM_MISSING'

/** What one dispatch attempt produced. */
export interface BoardDispatchOutcome {
  /** Whether the adapter was called. */
  readonly dispatched: boolean
  /** Stable code of the attempt. */
  readonly code: BoardDispatchCode
  /** Item after the attempt, or null when the message names no item. */
  readonly item: FaberLoomBoardItem | null
  /** Outcome the destination reported, or null when nothing was emitted. */
  readonly outcome: BoardEffectOutcome | null
  /** Diagnostic detail of a refused attempt, or null. */
  readonly detail: string | null
}

/** What one dispatch revalidation produced. */
export interface BoardEffectRevalidation {
  /** True when the controls still allow the effect. */
  readonly ok: boolean
  /** Item after the revalidation; it is back in `PENDIENTE_CRITERIO` when `ok` is false. */
  readonly item: FaberLoomBoardItem
}

/** Result of an administrative close: the closed item and the item the candidate became. */
export interface BoardAdminCloseResult {
  /** The item after the close. */
  readonly item: FaberLoomBoardItem
  /** New item the pending candidate became, or null when none was pending (W-86). */
  readonly created: FaberLoomBoardItem | null
}

/**
 * The message one adapter receives. It carries the idempotency key, so a
 * destination that supports retries can dedupe them, and the attempt number.
 */
export interface BoardEffectDispatch {
  /** Effect the message emits. */
  readonly effectKey: string
  /** Execution that owns the effect. */
  readonly executionId: string
  /** Item that authorized the effect. */
  readonly itemId: string
  /** Action type of the effect. */
  readonly actionType: string
  /** Normalised destination. */
  readonly destination: string
  /** Idempotency key the destination dedupes on. */
  readonly idempotencyKey: string
  /** One-based dispatch attempt count. */
  readonly attempt: number
}

/** What one adapter reports. */
export interface BoardEffectResult {
  /** What the destination said; a throw is reported as `DESCONOCIDO`. */
  readonly status: BoardEffectOutcome
  /** Destination reference, when the destination reports one. */
  readonly ref?: string
  /** Diagnostic detail for operators, never product copy. */
  readonly detail?: string
}

/**
 * The port the consumer sends through (E15). The board owns no mail, inventory,
 * or shipment client: a deployment mounts one adapter per action type from
 * `ctx.effect` and the board only decides when to call it.
 */
export interface BoardEffectAdapter {
  /**
   * Whether the destination dedupes a repeated idempotency key. `retry` refuses
   * an unknown outcome unless this is true (W-21); without it only `reconcile`
   * may settle the effect.
   */
  readonly idempotent: boolean
  /**
   * Emit one effect.
   * @param dispatch - the message and the attempt number.
   * @param options - abort signal the board aborts when the dispatch timeout expires.
   * @returns what the destination reported.
   */
  send(
    dispatch: BoardEffectDispatch,
    options: { readonly signal: AbortSignal },
  ): Promise<BoardEffectResult>
}

/** Input for one acceptance that reserves and schedules an effect (§3.2). */
export interface BoardExecutionInput extends BoardApproveInput {
  /** Execution that owns the reservation; its retries keep it (W-84). */
  readonly executionId: string
  /** Action type of the effect (`mail.send`, `inventory.reserve`, `shipment.create`). */
  readonly actionType: string
  /** Destination; an address list is normalised to a sorted lowercase list. */
  readonly destination: string
  /**
   * Explicit authorization recorded with the acceptance. Approval alone never
   * sends, so an execution names the signature or grant that allows it.
   */
  readonly authorization?: string
  /** Idempotency key the destination must dedupe on; derived from the effect key when omitted. */
  readonly idempotencyKey?: string
}

/** Input for `revert`: the optimistic token and an optional reason. */
export interface BoardRevertInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion?: number
  /** Why the item was reverted; recorded on the audit event. */
  readonly reason?: string
}

/** Input for `reconcile`: the outcome the destination reported. */
export interface BoardReconcileInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion?: number
  /**
   * What the destination reported. `DESCONOCIDO` records the attempt and leaves
   * the item in its unknown state (W-76).
   */
  readonly outcome: BoardEffectOutcome
  /** Destination reference, when the reconciliation learned one. */
  readonly ref?: string
  /** Diagnostic detail for operators. */
  readonly detail?: string
}

/** Input for `retry`: the optimistic token only; the execution identity is kept. */
export interface BoardRetryInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion?: number
}

/** Input for `adminClose`: the optimistic token and the mandatory reason. */
export interface BoardAdminCloseInput {
  /** Expected optimistic token. */
  readonly expectedRowVersion?: number
  /** Reason of the administrative close; mandatory (D-9, W-65). */
  readonly reason: string
}
