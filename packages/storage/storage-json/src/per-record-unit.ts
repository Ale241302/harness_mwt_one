/**
 * One opened JSON unit in `per-record` layout: the unit is a directory at
 * `dir`, holding one document per record under `<dir>/<table>/<key>.json`
 * plus `global.json` for the global slot. The directory is the state — this
 * unit holds NO in-memory state of its own: `loadAll` re-reads the tree and
 * every write is one durable file operation. The domain layer owns the live
 * in-memory tables (seeded by the open-time `loadAll`) and serializes writes
 * through its write chain, so this unit never mutates memory and needs no
 * rollback — a failed write simply leaves both the file and the domain's
 * memory unchanged.
 *
 * Per-record contract: a record document that is malformed or stamped with a
 * version outside the accepted set (the descriptor's current version plus
 * its `compatibleVersions`) reads as an absent record — one bad or stale
 * file never bricks the whole unit, and an unaccepted version stamp discards
 * the record instead of migrating it. Record keys are opaque strings: a
 * path-safe key (`[a-zA-Z0-9_-]+`) keeps its name, and any other key is stored
 * as `~<base64url(utf8 key)>`, so a composite key with separators (a shared
 * Session's NUL-joined identity) survives the layout change unchanged.
 *
 * Legacy bootstrap: when the new tree has no document path, a legacy
 * whole-unit file `<root>/<name>.json` (the pre-per-record layout) seeds
 * per-record documents, provided its stored unit version is in the accepted
 * set — a legacy file stamped with any other version is left alone and reads
 * as the empty unit. Any new document path, including one whose contents are
 * unreadable or stale, suppresses the bootstrap for the whole unit; the
 * bootstrap writes `.bootstrap-incomplete` first and removes it last, so a
 * crash midway discards the partial tree instead of suppressing the retry.
 * Migrated documents skip the per-file durability barrier for that reason.
 * The legacy file is never changed or deleted.
 * @module @deepseek-ai/dsh-storage-json/src/per-record-unit
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Dirent } from 'node:fs'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { parseRecord, serializeRecord } from './format.ts'
import type { UnitState } from './format.ts'

/** Keys that need no encoding: they are their own file name. */
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/
/** Prefix marking a base64url-encoded key; `~` is outside the safe set, so no key collides with an encoded name. */
const ENCODED_KEY_PREFIX = '~'
/**
 * Marks a bootstrap that has not finished. A crash between the first migrated
 * document and the last would otherwise leave documents behind that suppress
 * the retry, silently dropping every unmigrated record.
 */
const BOOTSTRAP_MARKER = '.bootstrap-incomplete'

/**
 * The document file name for one record key: the key itself when it is
 * path-safe, otherwise a reversible base64url of its UTF-8 bytes.
 * @param key - the opaque record key.
 * @returns a file name ending in `.json` that holds `key`.
 */
function recordFileName(key: string): string {
  if (SAFE_KEY_RE.test(key)) return `${key}.json`
  return `${ENCODED_KEY_PREFIX}${Buffer.from(key, 'utf8').toString('base64url')}.json`
}

/**
 * Recover the record key a document file name holds.
 * @param fileName - one directory entry name.
 * @returns the key, or `undefined` when the name is not a document of this unit.
 */
function recordKeyOf(fileName: string): string | undefined {
  if (!fileName.endsWith('.json')) return undefined
  const stem = fileName.slice(0, -'.json'.length)
  if (!stem.startsWith(ENCODED_KEY_PREFIX)) {
    return SAFE_KEY_RE.test(stem) ? stem : undefined
  }
  const encoded = stem.slice(ENCODED_KEY_PREFIX.length)
  const key = Buffer.from(encoded, 'base64url').toString('utf8')
  // Only a canonical encoding maps back: rejects stray files that merely start with `~`.
  return Buffer.from(key, 'utf8').toString('base64url') === encoded ? key : undefined
}

/**
 * Open one `per-record`-layout unit under `root`: the unit directory is
 * `<root>/<name>/`. Loads lazily on the first `loadAll` — this unit holds no
 * state, so opening touches nothing on the medium.
 * @param descriptor - Static identity and shape of the unit.
 * @param root - Absolute backend root directory.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 */
// oxlint-disable-next-line typescript/require-await -- async keeps both openers' call sites uniform
export async function openPerRecordUnit(
  descriptor: KvUnitDescriptor,
  root: string,
  onClose: () => void,
): Promise<KvUnit> {
  return new PerRecordJsonUnit(descriptor, join(root, descriptor.name), onClose)
}

/**
 * Read every record document under the unit directory: each declared table's
 * `<key>.json` files plus `global.json`. A missing directory is the empty
 * unit (materialization defers to the first write); a foreign document
 * (missing, malformed, or stamped with an unaccepted version) reads as an absent
 * record, per the per-record contract.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - Absolute unit directory path.
 * @returns the authoritative state reconstructed from the tree.
 */
async function loadPerRecordState(descriptor: KvUnitDescriptor, dir: string): Promise<UnitState> {
  const versions = acceptedStamps(descriptor)
  const state: UnitState = {
    version: descriptor.version,
    global: null,
    tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
  }
  let entries: Dirent[] | undefined
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing directory = empty unit; the legacy bootstrap below still runs
    // (the fresh-upgrade shape is exactly an absent new tree).
  }
  if (entries?.some(entry => entry.name === BOOTSTRAP_MARKER) === true) {
    // A previous bootstrap died midway: discard its partial tree so the
    // legacy file can seed every record again.
    for (const table of descriptor.tables) await rm(join(dir, table), { recursive: true, force: true })
    await rm(join(dir, BOOTSTRAP_MARKER), { force: true })
    entries = undefined
  }
  const hasNewDocuments = entries === undefined
    ? false
    : (await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        const records = state.tables.get(entry.name)
        if (records !== undefined) {
          return loadTableRecords(records, versions, join(dir, entry.name))
        }
      }
      if (entry.name === 'global.json' && descriptor.hasGlobal) {
        const global = await readRecord(join(dir, entry.name), versions)
        if (global !== undefined) state.global = global
        return true
      }
      return false
    }))).some(Boolean)
  if (!hasNewDocuments) await bootstrapLegacyUnit(descriptor, dir, state)
  return state
}

/** The version stamps this unit reads as its own: current plus declared compatible versions. */
function acceptedStamps(descriptor: KvUnitDescriptor): readonly number[] {
  return [descriptor.version, ...descriptor.compatibleVersions ?? []]
}

/**
 * Bootstrap an empty per-record tree from a legacy whole-unit file
 * (`<root>/<name>.json`, the pre-per-record layout). Every declared-table
 * record is copied into a current-version document, while the legacy file is
 * retained unchanged. A missing, foreign (another unit's name), malformed,
 * or non-unit legacy file is left alone, and so is one whose stored unit
 * version is outside the accepted set — migrating records the owner never
 * vouched for would stamp them with the current version and turn a
 * discardable stale cache into schema failures at the domain layer. Other
 * read failures propagate.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - The per-record unit directory (`<root>/<name>`).
 * @param state - The empty tree state; bootstrapped records are added.
 */
async function bootstrapLegacyUnit(descriptor: KvUnitDescriptor, dir: string, state: UnitState): Promise<void> {
  const legacyPath = join(dirname(dir), `${descriptor.name}.json`)
  let text: string | undefined
  try {
    text = await readFile(legacyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  // The legacy document is runtime data: only `unit.name`, `unit.version`,
  // and the tables map shape are checked here — the record values are
  // migrated as-is and the domain layer's schemas judge them.
  let document: { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  try {
    document = JSON.parse(text) as { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  } catch {
    return // Malformed legacy file: not ours to interpret or delete.
  }
  if (document.unit?.name !== descriptor.name) return
  const stamped = document.unit.version
  if (typeof stamped !== 'number' || !acceptedStamps(descriptor).includes(stamped)) return
  const tables = document.tables
  if (typeof tables !== 'object' || tables === null) return
  const recordsByTable = tables as Record<string, Record<string, unknown>>
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeAtomic(join(dir, BOOTSTRAP_MARKER), '')
  for (const [table, records] of Object.entries(recordsByTable)) {
    const target = state.tables.get(table)
    if (target === undefined) continue
    const tableDir = join(dir, table)
    await mkdir(tableDir, { recursive: true, mode: 0o700 })
    for (const [key, value] of Object.entries(records)) {
      // A migration document is written without per-file fsync: the marker
      // makes a partial tree recoverable, so a crash redoes the copy from the
      // untouched legacy file instead of paying a durability barrier for every
      // record of a large unit.
      await writeFile(join(tableDir, recordFileName(key)), serializeRecord(descriptor.version, value), { encoding: 'utf8', mode: 0o600 })
      target.set(key, value)
    }
  }
  await rm(join(dir, BOOTSTRAP_MARKER), { force: true })
}

/**
 * Read one declared table's record documents into `records`.
 * @returns whether the directory contains any `.json` document path,
 * independently of key safety, readability, or stored version.
 */
async function loadTableRecords(records: Map<string, unknown>, versions: readonly number[], dir: string): Promise<boolean> {
  const files = await readdir(dir, { withFileTypes: true })
  const hasDocuments = files.some(file => file.name.endsWith('.json'))
  const loaded = await Promise.all(files.map(async (file) => {
    const key = recordKeyOf(file.name)
    if (key === undefined) return
    const record = await readRecord(join(dir, file.name), versions)
    if (record !== undefined) return [key, record] as const
  }))
  for (const record of loaded) {
    if (record !== undefined) records.set(...record)
  }
  return hasDocuments
}

/** Read one record document; a foreign (unreadable or stale) one reads as absent. */
async function readRecord(path: string, versions: readonly number[]): Promise<unknown> {
  try {
    return parseRecord(await readFile(path, 'utf8'), versions)
  } catch {
    return undefined
  }
}

/**
 * One opened `per-record`-layout unit. Stateless by design: the directory is
 * the medium, the domain layer owns the live memory, and each method here is
 * a single durable file operation. Write ordering belongs to the caller (the
 * domain layer's write chain), exactly like the `single`-layout unit.
 */
export class PerRecordJsonUnit implements KvUnit {
  private closed = false
  /** In-flight durable writes; close() drains them before releasing the unit. */
  private readonly inFlight = new Set<Promise<void>>()

  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly dir: string,
    private readonly onClose: () => void,
  ) {}

  /** Re-read the tree: the directory is the authoritative state. */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const state = await loadPerRecordState(this.descriptor, this.dir)
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [table, records] of state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: state.global }
  }

  /** Durably replace one record: its own document, atomically. */
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    await this.tracked(this.writeDocument(join(this.tableDir(table), recordFileName(key)), value))
  }

  /** Durably delete one record. Idempotent: a missing key is a no-op. */
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    await this.tracked(rm(join(this.tableDir(table), recordFileName(key)), { force: true }))
  }

  /**
   * Move one record's document aside as `<key>.json.bak.<YYYYMMDDHHmm>`. The
   * moved file no longer ends in `.json`, so every later read ignores it; the
   * bytes stay on disk for inspection. A same-minute backup of the same
   * key overwrites the previous backup (the newer bytes are the ones worth
   * keeping).
   */
  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    const path = join(this.tableDir(table), recordFileName(key))
    const moved = `${path}.bak.${backupStamp(new Date())}`
    await this.tracked(rename(path, moved))
    return moved
  }

  /** Durably replace the global singleton. Only valid when declared. */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.tracked(this.writeDocument(join(this.dir, 'global.json'), value))
  }

  /* jscpd:ignore-start -- the two unit classes are standalone; the drain/guard lifecycle mirrors the shared KvUnit contract */
  /** Drain in-flight writes and release the unit. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }
  /* jscpd:ignore-end */

  /** Resolve a declared table's directory; an undeclared table is a caller bug and throws. */
  private tableDir(table: string): string {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return join(this.dir, table)
  }

  /** Durably replace one document, creating its parent directory. */
  private writeDocument(path: string, value: unknown): Promise<void> {
    return (async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(this.descriptor.version, value))
    })()
  }

  /** Track one durable write so close() drains it. */
  private tracked(write: Promise<void>): Promise<void> {
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}

/** Local-time `YYYYMMDDHHmm` suffix for backed-up documents. */
function backupStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
}
