/**
 * The backup domain declaration: the durable backup record schema and the
 * `defineDomain` spec the service opens. Payloads and manifests are stored as
 * canonical JSON strings so the record schema never drifts with the product
 * domains it snapshots.
 * @module @deepseek-ai/dsh-faberloom-backup/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * The FaberLoom domains a backup captures, with their declared tables. The
 * backup service reads and restores these through the storage-domain facility;
 * a domain absent from this list is never touched.
 */
export const FABERLOOM_BACKUP_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  faberloom_spaces: ['spaces', 'files'],
  faberloom_agents: ['models', 'agents', 'selections', 'outcomes'],
  faberloom_board: ['items'],
  faberloom_routines: ['routines', 'routine_versions', 'executions', 'effects', 'sources', 'event_keys'],
  faberloom_memory: ['teachings', 'teaching_versions', 'performance', 'late_errors'],
  faberloom_grants: ['grants'],
  faberloom_connections: ['connections'],
  faberloom_mcp: ['tokens'],
  faberloom_inbound: ['cursors'],
}

/** Durable backup record: one captured snapshot with its manifest and digest. */
export const backupRecord = z.object({
  ownerId: z.string(),
  createdAt: z.string(),
  formatVersion: z.number(),
  note: z.string().nullable(),
  /** sha256 over the canonical payload; the integrity anchor. */
  digest: z.string(),
  /** Canonical JSON of `{ domain: { table: { key: value } } }`. */
  payload: z.string(),
  /** JSON manifest: per-domain and per-table record counts and hashes. */
  manifest: z.string(),
})

/** One stored backup, inferred from {@link backupRecord}. */
export type BackupRecord = z.infer<typeof backupRecord>

/**
 * Durable record of one applied data migration: the id and the instant it ran,
 * so the runner applies each migration exactly once per owner.
 */
export const appliedMigrationRecord = z.object({
  /** Owning identity the migration ran for. */
  ownerId: z.string(),
  /** Stable migration id from the registry. */
  id: z.string(),
  /** ISO-8601 instant it was applied. */
  appliedAt: z.string(),
})

/** One applied migration, inferred from {@link appliedMigrationRecord}. */
export type AppliedMigrationRecord = z.infer<typeof appliedMigrationRecord>

/** The backup domain spec: one `backups` table and one `migrations` table. */
export const backupDomainSpec = defineDomain({
  name: 'faberloom_backup',
  version: 1,
  tables: {
    backups: domainTable<string, BackupRecord>(backupRecord),
    migrations: domainTable<string, AppliedMigrationRecord>(appliedMigrationRecord),
  },
})
