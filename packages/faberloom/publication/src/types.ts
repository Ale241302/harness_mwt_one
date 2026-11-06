/**
 * The publication contract: one approved diff becomes one Git commit, one
 * immutable object, and one activated revision. Types only; the service,
 * the Git adapter, and the object-store adapter carry the behavior.
 * @module @deepseek-ai/dsh-faberloom-publication/src/types
 */

/**
 * One request to publish an approved change. The caller supplies the approval
 * identity (`itemId`, `artifactHash`), the base commit the change was reviewed
 * against, the repository-relative target, and the unified diff; it never
 * supplies a repository path or a resulting commit.
 */
export interface PublicationRequest {
  /** Board item whose approval this publication carries. */
  readonly itemId: string
  /** Base commit the diff was reviewed against; must be the current HEAD. */
  readonly revision: string
  /** Repository-relative path the diff touches. */
  readonly path: string
  /** Unified diff produced from the approved artifact. */
  readonly diff: string
  /** Why the change is published. */
  readonly motivo: string
  /** Evidence references carried by the approval. */
  readonly evidence: readonly string[]
  /** Version-bound content hash of the approved artifact. */
  readonly artifactHash: string
}

/** Durable stage of one publication. */
export type PublicationState = 'pending' | 'committed' | 'uploaded' | 'activated' | 'failed'

/** What one finished publication fixed. */
export interface PublicationReceipt {
  /** Base revision the diff was applied to. */
  readonly revision: string
  /** Commit the applied diff produced. */
  readonly commit: string
  /** Immutable object key, `publications/<commit>/<path>`. */
  readonly objectKey: string
  /** Lowercase SHA-256 of the published bytes. */
  readonly sha256: string
  /** Published byte length. */
  readonly bytes: number
  /** Stage at the moment the receipt was read. */
  readonly state: PublicationState
  /** ISO-8601 instant activation committed, or null before activation. */
  readonly activatedAt: string | null
}

/** One file read back from a published revision. */
export interface PublicationRead {
  /** Commit the bytes were read from. */
  readonly revision: string
  /** Repository-relative path. */
  readonly path: string
  /** Verified byte length. */
  readonly bytes: number
  /** Verified lowercase SHA-256 of the bytes. */
  readonly sha256: string
  /** UTF-8 text of the bytes. */
  readonly text: string
}

/** One immutable object a publication stores. */
export interface PublicationObject {
  /** Immutable key, `publications/<commit>/<path>`. */
  readonly key: string
  /** Exact bytes to store. */
  readonly bytes: Uint8Array
  /** Media type the object is served as. */
  readonly contentType: string
  /** Object metadata; carries `sha256` and `itemId`. */
  readonly metadata: Readonly<Record<string, string>>
}

/**
 * The object-store capability the publication service needs. The production
 * mount is the S3/MinIO store in `s3-store.ts`; the in-memory implementation is
 * a test adapter and is never selected by configuration.
 */
export interface PublicationObjectStore {
  /**
   * Store one immutable object at its key.
   * @param object - key, bytes, media type, and metadata.
   * @returns resolution once the object is durable.
   */
  put(object: PublicationObject): Promise<void>
  /**
   * Read one object.
   * @param key - immutable key.
   * @returns the bytes, or undefined when the object does not exist.
   */
  get(key: string): Promise<Uint8Array | undefined>
}

/** Whether the service can run, and what configuration it is missing. */
export interface PublicationAvailability {
  /** True when the repository, endpoint, and bucket are configured. */
  readonly available: boolean
  /** Operator-facing reason the service is disabled, or null when it is available. */
  readonly reason: string | null
}
