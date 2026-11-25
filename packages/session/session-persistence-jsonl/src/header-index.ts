/**
 * On-disk cache of stored Session headers, keyed by the Session's directory.
 *
 * Listing sessions used to open and decode every generation file to read its
 * first line: a real home with thousands of routine step sessions spent
 * seconds on that scan. A session's header never changes after its generation
 * is published, and a new generation is a new file, so a stat-verified map of
 * directory → (generation path, revision, header) answers a warm or cold
 * listing without touching the log bodies.
 *
 * The file is a derived cache: a missing, malformed, or stale entry costs one
 * header read, never a failure. Every entry is guarded by the same stat-derived
 * revision the rest of this backend uses, so a replaced, migrated, or deleted
 * generation misses through to a fresh read.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/header-index
 */

import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** One Session directory's cached generation and header. */
export interface HeaderIndexEntry {
  /** Absolute path of the selected generation file. */
  readonly path: string
  /** Stat-derived revision of that file when the header was read. */
  readonly revision: string
  /** Physical size of that file when the header was read. */
  readonly sizeBytes: number
  /** The header line, already decoded and validated. */
  readonly header: SessionHeader
}

/** The persisted document: a versioned map of directory → entry. */
interface HeaderIndexDocument {
  readonly version: 1
  readonly entries: Record<string, HeaderIndexEntry>
}

/** File name of the cache inside the sessions root. */
const INDEX_FILE = '.session-headers.json'

/** Whether a parsed value is one entry this cache may serve. */
function isEntry(value: unknown): value is HeaderIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  const header = entry['header']
  return typeof entry['path'] === 'string'
    && typeof entry['revision'] === 'string'
    && typeof entry['sizeBytes'] === 'number'
    && typeof header === 'object'
    && header !== null
    && typeof (header as Record<string, unknown>)['id'] === 'string'
}

/**
 * The Session header cache of one sessions root.
 *
 * One instance owns the whole file; callers load it once per process, record
 * the entries a scan produced, and flush at most once per scan.
 */
export class SessionHeaderIndex {
  private readonly file: string
  private readonly entries = new Map<string, HeaderIndexEntry>()
  private loaded: Promise<void> | undefined
  private dirty = false
  private flushing: Promise<void> | undefined

  /**
   * @param root - absolute sessions root; the cache lives beside the project directories.
   */
  constructor(private readonly root: string) {
    this.file = join(root, INDEX_FILE)
  }

  /** Load the cache once; a missing or unreadable document is an empty cache. */
  async ready(): Promise<void> {
    this.loaded ??= this.load()
    await this.loaded
  }

  /**
   * The cached entry for one Session directory.
   * @param dir - absolute Session directory.
   * @returns the entry, or `undefined` when this process has none.
   */
  lookup(dir: string): HeaderIndexEntry | undefined {
    return this.entries.get(dir)
  }

  /**
   * Remember the header one scan just read.
   * @param dir - absolute Session directory.
   * @param entry - its selected generation and decoded header.
   */
  record(dir: string, entry: HeaderIndexEntry): void {
    this.entries.set(dir, entry)
    this.dirty = true
  }

  /**
   * Drop entries whose Session directory this scan did not see.
   * @param seen - every directory the scan visited.
   */
  prune(seen: ReadonlySet<string>): void {
    for (const dir of [...this.entries.keys()]) {
      if (seen.has(dir)) continue
      this.entries.delete(dir)
      this.dirty = true
    }
  }

  /**
   * Publish the cache when it changed. Writes are serialized per instance and
   * a failure is the caller's to treat as best-effort: the cache is derived.
   */
  async flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = undefined
    })
    await this.flushing
  }

  private async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return // A missing or unreadable cache is the empty cache.
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return // Malformed cache: rebuild from the logs.
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const document = parsed as { version?: unknown; entries?: unknown }
    if (document.version !== 1 || typeof document.entries !== 'object' || document.entries === null) return
    for (const [dir, entry] of Object.entries(document.entries as Record<string, unknown>)) {
      if (isEntry(entry)) this.entries.set(dir, entry)
    }
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false
      await this.write()
    }
  }

  private async write(): Promise<void> {
    const document: HeaderIndexDocument = {
      version: 1,
      entries: Object.fromEntries(this.entries),
    }
    const temporary = join(this.root, `.${randomUUID()}.header-index.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    } catch (error: unknown) {
      this.dirty = true
      await rm(temporary, { force: true })
      throw error
    }
  }
}
