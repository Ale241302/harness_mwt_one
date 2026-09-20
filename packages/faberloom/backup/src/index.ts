/**
 * Native product backup (`ctx.faberloomBackup`): captures the durable
 * FaberLoom domains into one portable, integrity-checked snapshot and restores
 * them. The snapshot is domain-level (the authoritative in-memory state read
 * through `ctx.storageDomain`), so it survives without the product services
 * each owning bespoke export code. Encryption and off-host copies belong to
 * the platform backup (gpg, rclone); this service owns the product snapshot,
 * its manifest, and its integrity.
 * @module @deepseek-ai/dsh-faberloom-backup
 */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { backupDomainSpec, FABERLOOM_BACKUP_DOMAINS, type AppliedMigrationRecord, type BackupRecord } from './spec.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  FaberLoomBackupDomainDigest,
  FaberLoomBackupManifest,
  FaberLoomBackupTableDigest,
  FaberLoomBackupTableVerdict,
  FaberLoomBackupVerifyResult,
  FaberLoomDataMigration,
  FaberLoomMigrationInfo,
  FaberLoomMigrationReport,
  FaberLoomRestoreResult,
  FaberLoomRestoreSkip,
  FaberLoomRestoreTable,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomBackup: FaberLoomBackup
  }
}

/** Snapshot format version; bump only on an incompatible manifest change. */
export const FABERLOOM_BACKUP_FORMAT_VERSION = 1

/**
 * The product's declarative data-migration registry. It stays empty while the
 * pilot has no shipped schema to move on from; each future incompatible record
 * change adds one idempotent entry here instead of an ad-hoc script, and the
 * runner applies it exactly once per owner and records that fact.
 */
export const FABERLOOM_DATA_MIGRATIONS: readonly FaberLoomDataMigration[] = []

/** Canonical payload shape: domain name to table name to record key to value. */
type BackupPayload = Record<string, Record<string, Record<string, unknown>>>

/** The untyped live domain surface this service reads and writes. */
interface LiveDomain {
  table(name: string): KvTable<string, unknown>
}

/** Options accepted when capturing a backup. */
export interface CreateBackupOptions {
  /** Operator note stored with the snapshot. */
  note?: string
  /** Restrict the capture to these domain names; every known domain when absent. */
  include?: readonly string[]
}

/** Options accepted when restoring a backup. */
export interface RestoreBackupOptions {
  /** Count what would be written without touching the medium. */
  dryRun?: boolean
}

/** Deterministic JSON: object keys sorted at every level, so hashes are stable. */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`
}

/** sha256 hex digest of one string. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Digest of one table's records, bound to its domain and table names. */
function hashTable(domain: string, table: string, records: Record<string, unknown>): string {
  return sha256(`${domain}\n${table}\n${canonicalStringify(records)}`)
}

/**
 * The product backup service: capture, list, verify, restore, and delete
 * integrity-checked snapshots of the FaberLoom domains.
 */
export class FaberLoomBackup extends Service {
  static inject = ['storageDomain']

  private domainPromise: Promise<Domain<typeof backupDomainSpec>> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomBackup')
  }

  private domain(): Promise<Domain<typeof backupDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(backupDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.backupDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async backups(): Promise<KvTable<string, BackupRecord>> { return (await this.domain()).table('backups') }

  private async migrationsTable(): Promise<KvTable<string, AppliedMigrationRecord>> {
    return (await this.domain()).table('migrations')
  }

  private liveDomain(name: string): LiveDomain | undefined {
    return this.ctx.storageDomain.get(name) as unknown as LiveDomain | undefined
  }

  private async requireBackup(ownerId: string, id: string): Promise<BackupRecord> {
    const record = (await this.backups()).get(id)
    if (record === undefined) throw new Error(`faberloom: backup ${id} not found`)
    if (record.ownerId !== ownerId) throw new Error('faberloom: only the owner can use this backup')
    return record
  }

  /**
   * Capture the currently open FaberLoom domains into one durable snapshot and
   * return its manifest. Domains that are not mounted in this process are
   * omitted from the manifest rather than reported as empty.
   * @param ownerId - the owning identity the snapshot belongs to.
   * @param options - optional note and domain restriction.
   * @returns the manifest of the captured snapshot.
   */
  async createBackup(ownerId: string, options: CreateBackupOptions = {}): Promise<FaberLoomBackupManifest> {
    const include = options.include === undefined ? undefined : new Set(options.include)
    const payload: BackupPayload = {}
    const domains: FaberLoomBackupDomainDigest[] = []
    for (const [domainName, tables] of Object.entries(FABERLOOM_BACKUP_DOMAINS)) {
      if (include !== undefined && !include.has(domainName)) continue
      const live = this.liveDomain(domainName)
      if (live === undefined) continue
      const domainPayload: Record<string, Record<string, unknown>> = {}
      const tableDigests: FaberLoomBackupTableDigest[] = []
      for (const tableName of tables) {
        const records: Record<string, unknown> = {}
        for (const [key, value] of live.table(tableName).entries()) records[key] = value
        domainPayload[tableName] = records
        tableDigests.push({
          domain: domainName,
          table: tableName,
          recordCount: Object.keys(records).length,
          sha256: hashTable(domainName, tableName, records),
        })
      }
      payload[domainName] = domainPayload
      domains.push({ domain: domainName, tables: tableDigests })
    }
    const payloadJson = canonicalStringify(payload)
    const digest = sha256(payloadJson)
    const id = randomUUID()
    const manifest: FaberLoomBackupManifest = {
      id,
      ownerId,
      createdAt: new Date().toISOString(),
      formatVersion: FABERLOOM_BACKUP_FORMAT_VERSION,
      note: options.note ?? null,
      domains,
      digest,
    }
    await (await this.backups()).put(id, {
      ownerId,
      createdAt: manifest.createdAt,
      formatVersion: manifest.formatVersion,
      note: manifest.note,
      digest,
      payload: payloadJson,
      manifest: JSON.stringify(manifest),
    })
    return manifest
  }

  /**
   * List one owner's backup manifests, newest first.
   * @param ownerId - the owning identity.
   * @returns the manifests, newest first.
   */
  async listBackups(ownerId: string): Promise<FaberLoomBackupManifest[]> {
    const out: FaberLoomBackupManifest[] = []
    for (const [, record] of (await this.backups()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push(JSON.parse(record.manifest) as FaberLoomBackupManifest)
    }
    out.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return out
  }

  /**
   * Read one backup manifest.
   * @param ownerId - the owning identity.
   * @param id - backup id.
   * @returns the manifest.
   */
  async getBackup(ownerId: string, id: string): Promise<FaberLoomBackupManifest> {
    return JSON.parse((await this.requireBackup(ownerId, id)).manifest) as FaberLoomBackupManifest
  }

  /**
   * Recompute the stored payload's digests and compare them with the manifest.
   * @param ownerId - the owning identity.
   * @param id - backup id.
   * @returns the per-table verdicts and the overall verdict.
   */
  async verifyBackup(ownerId: string, id: string): Promise<FaberLoomBackupVerifyResult> {
    const record = await this.requireBackup(ownerId, id)
    const manifest = JSON.parse(record.manifest) as FaberLoomBackupManifest
    const payload = JSON.parse(record.payload) as BackupPayload
    const tables: FaberLoomBackupTableVerdict[] = []
    for (const domain of manifest.domains) {
      for (const table of domain.tables) {
        const records = payload[domain.domain]?.[table.table] ?? {}
        const actual = hashTable(domain.domain, table.table, records)
        tables.push({
          domain: domain.domain,
          table: table.table,
          expected: table.sha256,
          actual,
          recordCount: Object.keys(records).length,
          ok: actual === table.sha256,
        })
      }
    }
    const actualDigest = sha256(canonicalStringify(payload))
    const ok = actualDigest === record.digest && actualDigest === manifest.digest && tables.every(table => table.ok)
    return { id, ok, expectedDigest: manifest.digest, actualDigest, tables }
  }

  /**
   * Restore one backup into the domains open in this process. Every record is
   * written with `put` (upsert); domains the process does not have open are
   * reported and skipped. A backup whose payload fails its integrity check is
   * refused before any write.
   * @param ownerId - the owning identity.
   * @param id - backup id.
   * @param options - `dryRun` counts the writes without performing them.
   * @returns the tables written or counted and the domains skipped.
   */
  async restoreBackup(ownerId: string, id: string, options: RestoreBackupOptions = {}): Promise<FaberLoomRestoreResult> {
    const record = await this.requireBackup(ownerId, id)
    if (sha256(record.payload) !== record.digest) {
      throw new Error(`faberloom: backup ${id} failed its integrity check; refusing to restore`)
    }
    const payload = JSON.parse(record.payload) as BackupPayload
    const tables: FaberLoomRestoreTable[] = []
    const skipped: FaberLoomRestoreSkip[] = []
    for (const [domainName, domainTables] of Object.entries(payload)) {
      const live = this.liveDomain(domainName)
      if (live === undefined) {
        skipped.push({ domain: domainName, reason: 'domain-not-open' })
        continue
      }
      for (const [tableName, records] of Object.entries(domainTables)) {
        let table: KvTable<string, unknown>
        try {
          table = live.table(tableName)
        } catch {
          skipped.push({ domain: domainName, reason: `table-unknown:${tableName}` })
          continue
        }
        let written = 0
        for (const [key, value] of Object.entries(records)) {
          if (options.dryRun !== true) await table.put(key, value)
          written += 1
        }
        tables.push({ domain: domainName, table: tableName, written })
      }
    }
    return { id, dryRun: options.dryRun === true, tables, skipped }
  }

  /**
   * List the migration registry and whether this owner already applied each
   * entry.
   * @param ownerId - the owning identity.
   * @param registry - the migrations to report; defaults to the product registry.
   * @returns one info row per migration, in registry order.
   */
  async listMigrations(
    ownerId: string,
    registry: readonly FaberLoomDataMigration[] = FABERLOOM_DATA_MIGRATIONS,
  ): Promise<FaberLoomMigrationInfo[]> {
    const table = await this.migrationsTable()
    return registry.map((migration) => {
      const record = table.get(`${ownerId}:${migration.id}`)
      return {
        id: migration.id,
        domain: migration.domain,
        describe: migration.describe,
        applied: record !== undefined,
        appliedAt: record === undefined ? null : record.appliedAt,
      }
    })
  }

  /**
   * Apply every registry migration this owner has not applied yet. Each rewrite
   * runs through the same domain handles the services use, and the applied id is
   * recorded only after a successful rewrite, so an interrupted pass re-runs
   * safely and a domain that is not open is reported rather than skipped.
   * @param ownerId - the owning identity.
   * @param registry - the migrations to apply; defaults to the product registry.
   * @returns the ids applied in this pass and the domains that were not open.
   */
  async runMigrations(
    ownerId: string,
    registry: readonly FaberLoomDataMigration[] = FABERLOOM_DATA_MIGRATIONS,
  ): Promise<FaberLoomMigrationReport> {
    const table = await this.migrationsTable()
    const applied: string[] = []
    const skipped: string[] = []
    for (const migration of registry) {
      const key = `${ownerId}:${migration.id}`
      if (table.get(key) !== undefined) continue
      const live = this.liveDomain(migration.domain)
      if (live === undefined) {
        if (!skipped.includes(migration.domain)) skipped.push(migration.domain)
        continue
      }
      let target: KvTable<string, unknown>
      try {
        target = live.table(migration.table)
      } catch {
        if (!skipped.includes(migration.domain)) skipped.push(migration.domain)
        continue
      }
      for (const [recordKey, record] of target.entries()) {
        const next = migration.apply(record as Record<string, unknown>)
        if (next === null) await target.delete(recordKey)
        else await target.put(recordKey, next)
      }
      await table.put(key, { ownerId, id: migration.id, appliedAt: new Date().toISOString() })
      applied.push(migration.id)
    }
    return { applied, skipped }
  }

  /**
   * Delete one backup record.
   * @param ownerId - the owning identity.
   * @param id - backup id.
   * @returns nothing.
   */
  async deleteBackup(ownerId: string, id: string): Promise<void> {
    await this.requireBackup(ownerId, id)
    await (await this.backups()).delete(id)
  }
}

export default FaberLoomBackup
