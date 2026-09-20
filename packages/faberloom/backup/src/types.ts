/**
 * Public types of the FaberLoom backup service: the portable manifest, the
 * integrity-check result, and the restore result. The manifest is the stable
 * cross-channel identifier other surfaces (UI, MCP) use to reference one
 * captured snapshot.
 * @module @deepseek-ai/dsh-faberloom-backup/src/types
 */

/** Integrity digest of one backed-up table. */
export interface FaberLoomBackupTableDigest {
  /** Declared storage-domain name. */
  domain: string
  /** Declared table name inside the domain. */
  table: string
  /** Number of records captured. */
  recordCount: number
  /** sha256 over the canonical records of this table. */
  sha256: string
}

/** One captured domain with the digests of its tables. */
export interface FaberLoomBackupDomainDigest {
  /** Declared storage-domain name. */
  domain: string
  /** Tables captured from this domain. */
  tables: FaberLoomBackupTableDigest[]
}

/**
 * The portable manifest of one backup: identity, scope, per-table digests, and
 * the overall payload digest. It is durable with the snapshot and is what
 * `listBackups` returns.
 */
export interface FaberLoomBackupManifest {
  /** Stable backup id. */
  id: string
  /** Owning identity the snapshot belongs to. */
  ownerId: string
  /** Capture instant, ISO 8601. */
  createdAt: string
  /** Snapshot format version. */
  formatVersion: number
  /** Optional operator note. */
  note: string | null
  /** Captured domains and their table digests, in the fixed domain order. */
  domains: FaberLoomBackupDomainDigest[]
  /** sha256 over the canonical payload. */
  digest: string
}

/** Integrity verdict for one table. */
export interface FaberLoomBackupTableVerdict {
  /** Declared storage-domain name. */
  domain: string
  /** Declared table name. */
  table: string
  /** Digest recorded in the manifest. */
  expected: string
  /** Digest recomputed from the stored payload. */
  actual: string
  /** Number of records in the stored payload. */
  recordCount: number
  /** Whether the recomputed digest matches the recorded one. */
  ok: boolean
}

/** Result of verifying one backup's integrity. */
export interface FaberLoomBackupVerifyResult {
  /** Backup id verified. */
  id: string
  /** Whether every table matched and the overall digest matched. */
  ok: boolean
  /** Recorded overall digest. */
  expectedDigest: string
  /** Recomputing the stored payload overall digest. */
  actualDigest: string
  /** Per-table verdicts. */
  tables: FaberLoomBackupTableVerdict[]
}

/** One table restored (or, in a dry run, that would be restored). */
export interface FaberLoomRestoreTable {
  /** Declared storage-domain name. */
  domain: string
  /** Declared table name. */
  table: string
  /** Records written (or, in a dry run, that would be written). */
  written: number
}

/** Domains named by the backup but not open in this process. */
export interface FaberLoomRestoreSkip {
  /** Declared storage-domain name. */
  domain: string
  /** Why the domain was skipped. */
  reason: string
}

/** Result of restoring one backup. */
export interface FaberLoomRestoreResult {
  /** Backup id restored. */
  id: string
  /** True when nothing was written. */
  dryRun: boolean
  /** Tables written or counted by the dry run. */
  tables: FaberLoomRestoreTable[]
  /** Domains the process did not have open. */
  skipped: FaberLoomRestoreSkip[]
}

/**
 * One declarative data migration over a product domain: it transforms each
 * record of one table, or returns `null` to drop it. The runner applies it once
 * per owner and records that fact, so re-running is always safe.
 */
export interface FaberLoomDataMigration {
  /** Stable migration id. */
  readonly id: string
  /** Declared storage-domain name it rewrites. */
  readonly domain: string
  /** Declared table name inside the domain. */
  readonly table: string
  /** One-line description shown to the owner. */
  readonly describe: string
  /** Transform one record, or return `null` to drop it. */
  readonly apply: (record: Record<string, unknown>) => Record<string, unknown> | null
}

/** One migration and whether this owner already applied it. */
export interface FaberLoomMigrationInfo {
  /** Stable migration id. */
  readonly id: string
  /** Declared storage-domain name. */
  readonly domain: string
  /** One-line description. */
  readonly describe: string
  /** Whether the owner already applied it. */
  readonly applied: boolean
  /** ISO-8601 instant it was applied, when it was. */
  readonly appliedAt: string | null
}

/** Result of one migration pass. */
export interface FaberLoomMigrationReport {
  /** Ids applied during this pass, in registry order. */
  readonly applied: string[]
  /** Domains named by pending migrations that were not open in this process. */
  readonly skipped: string[]
}
