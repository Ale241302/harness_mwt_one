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
  /** Whether this file came from the child or the fixed parent revision. */
  readonly origin: 'child' | 'inherited'
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

/** What one component field became in a host package. */
export type ConversionDecision = 'preserved' | 'translated' | 'omitted' | 'rejected'

/** One field-level conversion decision. */
export interface ConversionRow {
  /** Portable artifact path, or `(component)` for a whole component. */
  readonly source: string
  /** Portable kind. */
  readonly kind: string
  /** Field or component name. */
  readonly field: string
  /** What happened to it. */
  readonly decision: ConversionDecision
  /** Stable reason for a translation, omission, or rejection. */
  readonly reason?: string
}

/** The conversion and compatibility report for one host. */
export interface ConversionReport {
  /** Host this report covers. */
  readonly host: string
  /** Field-level decisions. */
  readonly rows: readonly ConversionRow[]
  /** Components the host package carries. */
  readonly accepted: number
  /** Components the host package omits. */
  readonly omitted: number
  /** Components refused and kept only in the source artifact. */
  readonly rejected: number
  /** Contributions the planner withheld, by reason; no paths are exposed. */
  readonly withheld: { readonly count: number; readonly reasons: readonly string[] }
  /** Explicit limitations a human must read. */
  readonly limitations: readonly string[]
  /** The legacy generator keeps its consumers until D13 is demonstrated. */
  readonly legacyGenerator: 'retained'
  /** Why the replacement is not claimed. */
  readonly legacyReason: 'D13-open'
}

/** One file the conversion accepts for a host package. */
export interface ConvertedFile {
  /** Portable artifact path. */
  readonly source: string
  /** Package-relative target. */
  readonly target: string
  /** Portable kind. */
  readonly kind: string
  /** File content ready for the host. */
  readonly content: string
  /** Whether the host loads it as a component. */
  readonly loaded: boolean
}

/** One managed file recorded in the destination's ownership manifest. */
export interface PortableOwnershipFile {
  /** Artifact-relative path. */
  readonly path: string
  /** Byte length last written. */
  readonly bytes: number
  /** Lowercase SHA-256 last written. */
  readonly sha256: string
}

/** The local ownership manifest a replace writer leaves inside the destination. */
export interface PortableOwnership {
  /** Ownership format version. */
  readonly formatVersion: 1
  /** Space identity that owns the managed files. */
  readonly spaceId: string
  /** Manifest digest of the artifact that wrote these files. */
  readonly artifactDigest: string
  /** Managed files, ordered by path. */
  readonly files: readonly PortableOwnershipFile[]
}

/** Detached signature over the canonical ownership manifest. */
export interface PortableOwnershipSignature {
  /** Signature algorithm; Ed25519 only. */
  readonly algorithm: 'ed25519'
  /** Trust-anchor key id. */
  readonly keyId: string
  /** Base64 signature over the canonical ownership JSON. */
  readonly value: string
}

/** Test and lifecycle hooks around the replace commit points. */
export interface PortableReplaceHooks {
  /** Called after the staging directory exists and before the first file is written. */
  readonly beforeWrite?: () => void
  /** Called after the previous destination was renamed to the backup. */
  readonly afterBackup?: () => void
  /** Called after the staging directory was renamed to the destination. */
  readonly afterSwap?: () => void
  /** Called after the new destination was verified and before cleanup. */
  readonly beforeCleanup?: () => void
}

/** Deployment wiring of the replace writer. */
export interface PortableReplaceConfig {
  /** Existing directory to create or update in place. */
  readonly destination: string
  /** PKCS#8 Ed25519 private key in PEM form. */
  readonly signingKeyPem: string
  /** Trust-anchor key id written beside the signature. */
  readonly keyId: string
  /** Optional ceiling overriding the request's `maxBytes`. */
  readonly maxBytes?: number
  /** Lifecycle hooks used by recovery tests and host integrations. */
  readonly hooks?: PortableReplaceHooks
}

/** What one replace run wrote, preserved, removed, and backed up. */
export interface PortableReplaceResult {
  /** Destination directory after the swap. */
  readonly path: string
  /** Manifest written into the destination. */
  readonly manifest: PortableManifest
  /** Detached manifest signature. */
  readonly signature: PortableSignature
  /** Manifest digest. */
  readonly digest: string
  /** Contributions refused before writing. */
  readonly rejected: readonly PortableRejection[]
  /** Managed paths written, in write order. */
  readonly written: readonly string[]
  /** Foreign paths copied unchanged. */
  readonly preserved: readonly string[]
  /** Foreign directories copied unchanged, including empty ones. */
  readonly preservedDirectories: readonly string[]
  /** Managed paths removed because the new plan no longer contains them. */
  readonly removed: readonly string[]
  /** Backup path used during the swap, or null for a first install; removed after verification. */
  readonly backup: string | null
  /** Whether the commit verified but cleanup could not finish; the next run recovers. */
  readonly cleanupPending: boolean
  /** Ownership manifest now in force. */
  readonly ownership: PortableOwnership
}
