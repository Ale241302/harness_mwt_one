/**
 * The portable artifact contract: one Space's allowed contributions become a
 * versioned directory with a complete inventory, a canonical digest, and a
 * detached signature. Types only; the planner and the staging writer carry the
 * behavior.
 * @module @deepseek-ai/dsh-faberloom-portable/src/types
 */

/** Classification the export policy evaluates before a contribution is allowed. */
export type PortableClassification = 'N0' | 'N1' | 'N2' | 'N3' | 'N4' | 'CEO-ONLY'

/** Kind of contribution one artifact file carries. */
export type PortableKind =
  | 'document'
  | 'context'
  | 'skill'
  | 'agent'
  | 'workflow'
  | 'routine'
  | 'memory'
  | 'metadata'
  | 'resource'
  | 'session'
  | 'transcript'

/** One contribution the planner may include. */
export interface PortableContribution {
  /** Stable contribution id, unique in one export. */
  readonly id: string
  /** What the content is, which fixes its path and media type rules. */
  readonly kind: PortableKind
  /** Artifact-relative path with `/` separators. */
  readonly path: string
  /** Display title. It is never written for a rejected contribution. */
  readonly title: string
  /** File body. */
  readonly content: string
  /**
   * Server classification. An absent or unknown value is denied; only `N0`,
   * `N1`, and `N2` are exported.
   */
  readonly classification?: string
  /** Media type; the planner derives one from the kind when absent. */
  readonly mediaType?: string
  /** Whether a child export may inherit this contribution. */
  readonly inheritable?: boolean
  /**
   * Whether the requesting scope has access to this contribution by
   * contribution, not merely by belonging to the organization.
   */
  readonly granted?: boolean
  /** Contribution ids this one references. */
  readonly dependsOn?: readonly string[]
  /** Additional labels the policy and the manifest audit. */
  readonly metadata?: Readonly<Record<string, string>>
}

/** One Space export identity and its fixed revisions. */
export interface PortableIdentity {
  /** Stable Space id. */
  readonly spaceId: string
  /** Display title at the instant of the export. */
  readonly spaceTitle: string
  /** Authorized Git commit the documents were read from. */
  readonly editorialRevision: string
  /** Parent revision this export inherited from, or null when it inherits nothing. */
  readonly parentRevision?: string | null
}

/** Everything one plan needs. */
export interface PortableRequest {
  /** Space identity and the two fixed revisions. */
  readonly identity: PortableIdentity
  /** ISO-8601 instant, supplied by the caller so a replay is reproducible. */
  readonly generatedAt: string
  /** Software version written beside the format and content versions. */
  readonly softwareVersion: string
  /** Contributions owned by the exporting Space. */
  readonly contributions: readonly PortableContribution[]
  /** Contributions offered by the parent revision. */
  readonly inherited?: readonly PortableContribution[]
  /** Ids or paths the child explicitly excludes from inheritance. */
  readonly exclusions?: readonly string[]
  /** Byte ceiling for one artifact file; defaults to 1 MiB. */
  readonly maxBytes?: number
}

/** One file the artifact contains, as the inventory describes it. */
export interface PortableFileEntry {
  /** Artifact-relative path with `/` separators. */
  readonly path: string
  /** Contribution kind. */
  readonly kind: PortableKind
  /** Media type. */
  readonly mediaType: string
  /** UTF-8 byte length. */
  readonly bytes: number
  /** Lowercase SHA-256 of the UTF-8 content. */
  readonly sha256: string
  /** Lowercase SHA-256 of the contribution's canonical metadata. */
  readonly metadataSha256: string
  /** Classification the policy accepted. */
  readonly classification: PortableClassification
}

/** The manifest that authenticates one artifact. */
export interface PortableManifest {
  /** Artifact format version. */
  readonly formatVersion: number
  /** Digest of the inventory, distinct from the software version. */
  readonly contentVersion: string
  /** Software version that produced the artifact. */
  readonly softwareVersion: string
  /** Space identity. */
  readonly space: { readonly id: string; readonly title: string }
  /** Authorized Git commit the documents were read from. */
  readonly editorialRevision: string
  /** Parent revision this artifact inherited from, or null. */
  readonly parentRevision: string | null
  /** ISO-8601 instant supplied by the caller. */
  readonly generatedAt: string
  /** Complete inventory, ordered by path. */
  readonly files: readonly PortableFileEntry[]
  /** Digest of this manifest without `digest`; the signature is detached. */
  readonly digest: string
}

/** A detached signature over the canonical manifest. */
export interface PortableSignature {
  /** Signature algorithm; Ed25519 only. */
  readonly algorithm: 'ed25519'
  /** Trust-anchor key id, selected out of band. */
  readonly keyId: string
  /** Base64 signature value. */
  readonly value: string
}

/** One file the planner will write. */
export interface PortableArtifactFile {
  /** Artifact-relative path. */
  readonly path: string
  /** UTF-8 body. */
  readonly content: string
  /** Contribution kind. */
  readonly kind: PortableKind
  /** Media type. */
  readonly mediaType: string
  /** Accepted classification. */
  readonly classification: PortableClassification
}

/** One contribution the planner refused, named by path and reason. */
export interface PortableRejection {
  /** Artifact path the contribution would have used, or `(restricted)`. */
  readonly path: string
  /** Stable reason: classification, secret, dependency, path, and so on. */
  readonly reason: string
}

/** One complete plan, before anything is written. */
export interface PortablePlan {
  /** The manifest the writer stores last. */
  readonly manifest: PortableManifest
  /** Content files, excluding the manifest itself. */
  readonly files: readonly PortableArtifactFile[]
  /** Manifest digest, repeated for callers that do not read the manifest. */
  readonly digest: string
  /** Contributions refused, with the reason for each. */
  readonly rejected: readonly PortableRejection[]
}

/** What one staging run wrote and signed. */
export interface PortableStageResult {
  /** New staging directory. It is never an existing output. */
  readonly path: string
  /** Manifest written last inside the directory. */
  readonly manifest: PortableManifest
  /** Detached signature; it is not stored inside the artifact. */
  readonly signature: PortableSignature
  /** Manifest digest. */
  readonly digest: string
  /** Contributions refused. */
  readonly rejected: readonly PortableRejection[]
  /** Paths written inside the staging directory, in write order. */
  readonly written: readonly string[]
}

/** Result of verifying an artifact against its signature and public key. */
export interface PortableVerification {
  /** Whether the inventory, digest, and signature all agree. */
  readonly ok: boolean
  /** Named reasons in verification order; empty when `ok`. */
  readonly reasons: readonly string[]
}
