/**
 * The medium's own view of the mirrored product rows: the `single`-layout JSON
 * documents under `<home>/storages`, read and written the way the JSON backend
 * keeps them (`{unit:{name,version}, global, tables}`).
 *
 * A product domain opens lazily — `ctx.storageDomain.get(name)` answers
 * undefined until its owning service first touches it — so a traversal that
 * only asks the facility sees the handful of domains some other code happened
 * to open, and reports every other domain as `domain-not-open` in a home that
 * holds its records. This store answers for every mirrored domain: the open
 * domain when the process holds one, whose in-memory state is authoritative and
 * whose writes run on the domain's own write chain, and the medium's document
 * otherwise, which is the very file that domain loads on its first open. A row
 * written to the medium is therefore visible to a domain opened later, and a
 * row written through an open domain is published by that domain as usual.
 *
 * Creating a document needs the format version its owner stamps, and only the
 * medium carries it. {@link MirrorHomeStore.materialize} takes that version from
 * the document a peer sent; a domain neither side has materialized stays
 * unaddressed and is reported, never guessed.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/store
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { BASELINE_DOMAIN, BASELINE_SOURCE_TABLE, BASELINE_TABLE, BaselineAgentTable, preloadBaselineKeys, type BaselineSecrets } from './baseline.ts'
import { FABERLOOM_MIRROR_DOMAINS } from './domains.ts'
import type { MirrorDomainSource, MirrorLiveDomain } from './sync.ts'
import type { FaberLoomMirrorDocument, FaberLoomMirrorSkip } from './types.ts'

/** Error codes Windows reports while another handle (antivirus, indexer) holds the target. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Rename one temp file over its target, retrying Windows' transient refusals.
 *
 * `MoveFileExW(REPLACE_EXISTING)` fails with `EPERM`/`EBUSY` while another
 * process holds the destination open for a moment (a scanner reading the file
 * that was just written). The replacement is still the right publication, so a
 * short bounded backoff rides out the scan instead of failing a mirror cycle.
 * @param from - temporary path.
 * @param to - target path.
 * @param operation - the rename to attempt; tests inject a failing one.
 * @param wait - the backoff; tests inject a resolved one.
 * @returns resolution after the replacement.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  operation: (from: string, to: string) => Promise<void> = rename,
  wait: (ms: number) => Promise<void> = async (ms) => { await new Promise(resolve => setTimeout(resolve, ms)) },
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!RENAME_RETRY_CODES.has(code) || attempt >= 8) throw error
      await wait(20 * (attempt + 1))
    }
  }
}

/** One domain document as the medium holds it, with the path it is published under. */
interface OpenDocument extends ParsedDocument {
  /** Declared domain name; also the unit name in the file header. */
  readonly name: string
  /** Absolute path of the document. */
  readonly path: string
}

/** The state one medium document holds, as this store keeps it in memory. */
interface ParsedDocument {
  /** Format version stamped by the domain's owner. */
  readonly version: number
  /** Stored global singleton; `null` until first written. */
  global: unknown
  /** Table name to records, including tables this mirror does not carry. */
  readonly tables: Map<string, Map<string, unknown>>
}

/** Wiring of one home store. */
export interface MirrorHomeStoreOptions {
  /** Absolute root holding the `single`-layout documents; defaults to `<DSH_HOME>/storages`. */
  readonly storagesRoot?: string
  /** The open-domain facility of this process; a domain it holds wins over the medium. */
  readonly facility?: MirrorDomainSource
  /** The credential seam for baseline agent keys; without it the keys stay where they are. */
  readonly secrets?: BaselineSecrets
}

/**
 * The mirrored rows of one home, addressed by domain and table, answering from
 * the open domain when there is one and from the medium otherwise.
 */
export class MirrorHomeStore implements MirrorDomainSource {
  private readonly documents = new Map<string, OpenDocument>()
  private readonly handles = new Map<string, DocumentTable>()
  /** Baseline agent keys read at the start of the cycle, by local agent id. */
  private baselineKeys = new Map<string, string>()

  /**
   * @param options - the medium root and, when available, this process's open-domain facility.
   */
  constructor(private readonly options: MirrorHomeStoreOptions = {}) {}

  /**
   * Absolute root this store reads and writes.
   * @returns the absolute storage root.
   */
  root(): string {
    const configured = this.options.storagesRoot
    if (configured !== undefined && configured.length > 0) return configured
    const home = process.env['DSH_HOME']
    return join(home === undefined || home.length === 0 ? process.cwd() : home, 'storages')
  }

  /**
   * Absolute path of one domain's document.
   * @param name - declared domain name.
   * @returns the absolute document path.
   */
  documentPath(name: string): string {
    return join(this.root(), `${name}.json`)
  }

  /**
   * Read the medium for every mirrored domain this process does not hold open,
   * so {@link get} can answer for them; called once at the start of a cycle.
   * A document written since the last call is picked up, and a document a
   * domain holds open is not read at all: its in-memory state is the truth.
   * @returns one entry per document the store could not read.
   */
  async load(): Promise<FaberLoomMirrorSkip[]> {
    const skipped: FaberLoomMirrorSkip[] = []
    for (const name of Object.keys(FABERLOOM_MIRROR_DOMAINS)) {
      this.documents.delete(name)
      if (this.options.facility?.get(name) !== undefined) continue
      const document = await this.readDocument(name)
      if (document === 'unreadable') {
        skipped.push({ domain: name, table: '*', reason: 'malformed-medium' })
        continue
      }
      if (document !== undefined) this.documents.set(name, document)
    }
    this.baselineKeys = new Map()
    const secrets = this.options.secrets
    const agents = this.rawDomain(BASELINE_DOMAIN)
    if (secrets !== undefined && agents !== undefined) {
      try {
        this.baselineKeys = await preloadBaselineKeys(agents.table(BASELINE_SOURCE_TABLE), secrets)
      } catch (error) {
        // A credential seam that cannot answer leaves the keys out of this
        // cycle; the settings still travel and the next cycle retries.
        skipped.push({ domain: BASELINE_DOMAIN, table: BASELINE_TABLE, reason: `keys-unreadable: ${String(error)}` })
      }
    }
    return skipped
  }

  /**
   * Make a document available for every domain a peer's document names, stamps,
   * and the medium does not hold yet, so the rows that arrive can land. The
   * version comes from the peer because only the medium carries it; a domain the
   * peer did not stamp is left alone.
   * @param document - the peer's transfer document.
   */
  materialize(document: FaberLoomMirrorDocument): void {
    for (const [name, domain] of Object.entries(document.domains)) {
      const version = domain.version
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) continue
      if (this.options.facility?.get(name) !== undefined) continue
      if (this.documents.has(name)) continue
      const declared = FABERLOOM_MIRROR_DOMAINS[name]
      if (declared === undefined) continue
      this.documents.set(name, {
        name,
        path: this.documentPath(name),
        version,
        global: null,
        tables: new Map(declared.map(table => [table, new Map<string, unknown>()])),
      })
    }
  }

  /**
   * The version stamped on one domain's document, when the medium or this
   * cycle's read knows it.
   * @param name - declared domain name.
   * @returns the stamped version, or undefined when neither side has the document.
   */
  versionOf(name: string): number | undefined {
    return this.documents.get(name)?.version
  }

  /**
   * One domain of this home: the open domain when the facility holds one, the
   * medium's document otherwise. Only a domain the transfer scope carries is
   * reachable, so a peer that still sends a record outside the scope cannot
   * reach a service of this process through the store.
   * @param name - declared domain name.
   * @returns the live domain, or undefined when neither the scope nor the medium holds it.
   */
  get(name: string): MirrorLiveDomain | undefined {
    const domain = this.rawDomain(name)
    if (domain === undefined || name !== BASELINE_DOMAIN) return domain
    // The agents domain also answers for the virtual baseline table, projected
    // over its real `agents` table (see baseline.ts).
    return {
      table: (table: string): KvTable<string, unknown> => table === BASELINE_TABLE
        ? new BaselineAgentTable(domain.table(BASELINE_SOURCE_TABLE), this.baselineKeys, this.options.secrets)
        : domain.table(table),
    }
  }

  /** One domain without the virtual tables: the open domain, or the medium's document. */
  private rawDomain(name: string): MirrorLiveDomain | undefined {
    if (FABERLOOM_MIRROR_DOMAINS[name] === undefined) return undefined
    const open = this.options.facility?.get(name)
    if (open !== undefined) return open
    if (!this.documents.has(name)) return undefined
    return { table: (table: string): KvTable<string, unknown> => this.handle(name, table) }
  }

  /**
   * The stable table handle of one medium document. Only a table this mirror
   * carries is reachable — the medium may hold others, and those stay the
   * domain's business — and a declared table the document has not written yet
   * is created empty, exactly as the backend's own open does.
   */
  private handle(name: string, table: string): KvTable<string, unknown> {
    const key = `${name}\u0000${table}`
    const existing = this.handles.get(key)
    if (existing !== undefined) return existing
    const document = this.documents.get(name)
    /* v8 ignore next -- get() checks the document before it builds a handle. */
    if (document === undefined) throw new Error(`mirror: no document for domain ${name}`)
    const declared = FABERLOOM_MIRROR_DOMAINS[name]
    if (declared === undefined || !declared.includes(table)) {
      throw new Error(`mirror: domain ${name} does not declare table ${table}`)
    }
    let records = document.tables.get(table)
    if (records === undefined) {
      records = new Map<string, unknown>()
      document.tables.set(table, records)
    }
    const handle = new DocumentTable(document, records, () => this.write(document))
    this.handles.set(key, handle)
    return handle
  }

  /** Read one domain document, or undefined when the medium holds none. */
  private async readDocument(name: string): Promise<OpenDocument | undefined | 'unreadable'> {
    const path = this.documentPath(name)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // An absent document is an empty domain; the mirror reads it as no rows,
      // which is what the domain itself would find on its first open.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const parsed = parseDocument(name, text)
    if (parsed === undefined) return 'unreadable'
    return { name, path, ...parsed }
  }

  /** Publish one document whole, the way the JSON backend publishes a write. */
  private async write(document: OpenDocument): Promise<void> {
    await mkdir(dirname(document.path), { recursive: true })
    const temporary = join(dirname(document.path), `.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, serializeDocument(document), 'utf8')
      await renameWithRetry(temporary, document.path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }
}

/** One table of a medium document, with the surface the mirror traversal reads and writes. */
class DocumentTable implements KvTable<string, unknown> {
  /**
   * @param document - the document this table belongs to.
   * @param records - the records of this table, mutated in place.
   * @param publish - writes the whole document durably.
   */
  constructor(
    private readonly document: OpenDocument,
    private readonly records: Map<string, unknown>,
    private readonly publish: () => Promise<void>,
  ) {}

  /** @param key - record key. @returns the record, or undefined when absent. */
  get(key: string): unknown {
    return this.records.get(key)
  }

  /** @returns a snapshot iterator over the records. */
  entries(): IterableIterator<[string, unknown]> {
    return new Map(this.records).entries()
  }

  /** @returns a snapshot iterator over the keys. */
  keys(): IterableIterator<string> {
    return new Map(this.records).keys()
  }

  /** @returns the record count. */
  get size(): number {
    return this.records.size
  }

  /** Insert or overwrite one record and publish the document. */
  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, value)
    await this.publish()
  }

  /**
   * Remove one record and publish the document.
   * @returns whether the record existed.
   */
  async delete(key: string): Promise<boolean> {
    if (!this.records.has(key)) return false
    this.records.delete(key)
    await this.publish()
    return true
  }

  /** Read-modify-write one record; a missing key is refused as the domain layer refuses it. */
  async update(key: string, change: (current: unknown) => unknown): Promise<unknown> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`mirror: no record ${key} in ${this.document.name}`)
    const next = change(current)
    this.records.set(key, next)
    await this.publish()
    return next
  }
}

/**
 * Serialize one document exactly as the JSON backend serializes a unit:
 * pretty-printed, with the unit header the domain's open validates.
 * @param document - the document to publish.
 * @returns the file content.
 */
function serializeDocument(document: OpenDocument): string {
  const tables: Record<string, Record<string, unknown>> = {}
  for (const [table, records] of document.tables) tables[table] = Object.fromEntries(records)
  return `${JSON.stringify({ unit: { name: document.name, version: document.version }, global: document.global, tables }, null, 2)}\n`
}

/**
 * Parse one domain document, tolerating anything the domain layer tolerates: a
 * missing table reads as empty, records stay opaque, and a foreign header or an
 * unreadable body is reported instead of guessed.
 * @param name - the domain the document must belong to.
 * @param text - the file content.
 * @returns the document state, or undefined when the medium is foreign or malformed.
 */
function parseDocument(name: string, text: string): ParsedDocument | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { unit, global: globalValue, tables } = parsed as Record<string, unknown>
  if (typeof unit !== 'object' || unit === null) return undefined
  const header = unit as Record<string, unknown>
  if (header['name'] !== name || typeof header['version'] !== 'number' || !Number.isInteger(header['version'])) return undefined
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) return undefined
  const state = new Map<string, Map<string, unknown>>()
  for (const [table, records] of Object.entries(tables as Record<string, unknown>)) {
    if (typeof records !== 'object' || records === null || Array.isArray(records)) return undefined
    state.set(table, new Map(Object.entries(records as Record<string, unknown>)))
  }
  return { version: header['version'], global: globalValue ?? null, tables: state }
}
