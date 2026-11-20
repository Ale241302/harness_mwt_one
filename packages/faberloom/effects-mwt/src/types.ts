/**
 * Client-safe shapes of one expediente write against MWT.ONE.
 *
 * A proposal names the exact expediente, the fields with their units, the
 * documents with their bytes and digest, the version it was prepared against,
 * and the ambiguities that must be resolved before anyone authorizes it. An
 * authorization covers one revision, once. The write reports what the
 * destination said, and a lost answer stays `unknown` until a person reconciles.
 */

/** Expediente the write targets. */
export interface MwtTarget {
  /** Stable MWT.ONE identifier of the expediente. */
  readonly expedienteId: string
  /** Human label the panel shows, e.g. `PO 505433 — Marluvas`. */
  readonly label: string
  /** Collection the write reaches, e.g. `purchase-orders`. */
  readonly collection: string
}

/** One field the proposal changes. */
export interface MwtFieldChange {
  /** Field identifier on the destination. */
  readonly field: string
  /** Human label of the field. */
  readonly label: string
  /** Value read before the write, or null when it was empty. */
  readonly before: string | null
  /** Value the write sets. */
  readonly after: string
  /** Unit the value carries (`USD`, `kg`, `unidad`), or null when it carries none. */
  readonly unit: string | null
}

/** One document the proposal adds or replaces. */
export interface MwtDocumentChange {
  /** File name. */
  readonly name: string
  /** Media type. */
  readonly mediaType: string
  /** SHA-256 of the exact bytes. */
  readonly sha256: string
  /** Byte length. */
  readonly bytes: number
  /** Whether the document adds a new file or supersedes one. */
  readonly operation: 'add' | 'replace'
  /** Name of the document this one supersedes, when replacing. */
  readonly replaces: string | null
}

/** What the caller asks to write. */
export interface MwtProposalInput {
  /** Board item that requested the write, when one exists. */
  readonly itemId?: string | null
  /** Expediente the write targets. */
  readonly target: MwtTarget
  /** Fields to set. */
  readonly fields: readonly { field: string; label: string; value: string; unit?: string | null }[]
  /** Documents to add or replace, with their bytes. */
  readonly documents?: readonly {
    name: string
    mediaType: string
    contentBase64: string
    operation?: 'add' | 'replace'
    replaces?: string | null
  }[]
  /** Why the change is proposed. */
  readonly reason: string
  /** Sources the proposal rests on (mail, document, conversation). */
  readonly sources: readonly string[]
}

/** Lifecycle of one proposal. */
export type MwtProposalStatus = 'proposed' | 'executing' | 'written' | 'unknown' | 'failed' | 'discarded'

/** One stored proposal, as the panel reads it. */
export interface FaberLoomMwtProposal {
  /** Proposal id. */
  readonly id: string
  /** Board item that requested it, or null. */
  readonly itemId: string | null
  /** Expediente it targets. */
  readonly target: MwtTarget
  /** SHA-256 of the exact write: target, version and every changed byte. */
  readonly revision: string
  /** Destination version read before preparing. */
  readonly versionBefore: string
  /** Fields with their before/after values. */
  readonly fields: readonly MwtFieldChange[]
  /** Documents with their digests. */
  readonly documents: readonly MwtDocumentChange[]
  /** What blocks authorization, in panel-readable codes. */
  readonly ambiguities: readonly string[]
  /** Sources the proposal rests on. */
  readonly sources: readonly string[]
  /** Why the change is proposed. */
  readonly reason: string
  /** Where the proposal is. */
  readonly status: MwtProposalStatus
  /** Destination reference the write returned, when it did. */
  readonly ref: string | null
  /** Failure or unknown reason, when any. */
  readonly error: string | null
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
  /** Last change, ISO-8601. */
  readonly updatedAt: string
}

/** One single-use authorization for one proposal revision. */
export interface FaberLoomMwtAuthorization {
  /** Authorization id. */
  readonly id: string
  /** Proposal it covers. */
  readonly proposalId: string
  /** Revision it covers; a changed proposal invalidates it. */
  readonly revision: string
  /** Scope the approver recorded, e.g. `PO 505433 · campos y PDF`. */
  readonly scope: string
  /** Instant it stops being usable, ISO-8601. */
  readonly expiresAt: string
  /** Instant the executor consumed it, or null. */
  readonly usedAt: string | null
  /** Creation instant, ISO-8601. */
  readonly createdAt: string
}

/** What one destination read answers. */
export interface MwtRemoteState {
  /** Destination version or ETag. */
  readonly version: string
  /** Field values, keyed by field id. */
  readonly fields: Readonly<Record<string, string | null>>
  /** Document names with their digests. */
  readonly documents: readonly { name: string; sha256: string; bytes: number }[]
}

/** The destination seam: reads, one write and an optional read-after. */
export interface MwtTransport {
  /**
   * Read the expediente as it is now.
   * @param target - expediente to read.
   * @returns its version, fields and documents.
   */
  read(target: MwtTarget): Promise<MwtRemoteState>
  /**
   * Write the approved revision once.
   * @param target - expediente to write.
   * @param body - the revision to write.
   * @param options - idempotency key the destination dedupes on.
   * @returns the destination reference.
   */
  write(
    target: MwtTarget,
    body: {
      readonly fields: readonly { field: string; value: string; unit: string | null }[]
      readonly documents: readonly { name: string; mediaType: string; contentBase64: string; operation: 'add' | 'replace'; replaces: string | null }[]
      readonly expectedVersion: string
    },
    options: { readonly idempotencyKey: string },
  ): Promise<{ ref: string }>
}

/** Actor writing through the service. */
export interface MwtActor {
  /** Authenticated identity. */
  readonly id: string
  /** Tenant the expediente belongs to. */
  readonly companyId?: string | undefined
  /** Console role, when the deployment carries one. */
  readonly role?: string | undefined
}

/** Raised when the write cannot proceed, with a stable code. */
export class FaberLoomMwtRefusal extends Error {
  /**
   * @param code - stable reason the panel maps to copy.
   * @param message - human-readable detail.
   */
  constructor(readonly code: MwtRefusalCode, message: string) {
    super(message)
    this.name = 'FaberLoomMwtRefusal'
  }
}

/** Stable refusal codes. */
export type MwtRefusalCode =
  | 'TARGET_MISSING'
  | 'AMBIGUOUS'
  | 'NO_AUTHORIZATION'
  | 'AUTHORIZATION_CONSUMED'
  | 'AUTHORIZATION_EXPIRED'
  | 'REVISION_CHANGED'
  | 'VERSION_CONFLICT'
  | 'ALREADY_SETTLED'
  | 'RESULT_UNKNOWN'
  | 'NO_TRANSPORT'

/** Raised when the destination may have accepted the write but did not answer. */
export class MwtDeliveryUnknown extends Error {
  /** @param message - human-readable detail. */
  constructor(message: string) {
    super(message)
    this.name = 'MwtDeliveryUnknown'
  }
}
