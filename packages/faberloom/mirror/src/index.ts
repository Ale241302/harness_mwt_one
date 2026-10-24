/**
 * FaberLoom mirror (`ctx.faberloomMirror`): keeps the desktop's local product
 * home and the deployed gateway's per-user home carrying the same rows.
 *
 * The gateway reads and writes its owner's rows through the `dsh` process it
 * already runs, over the native MCP server's unix socket; this service is the
 * other half. It pulls the remote document at boot and on an interval, applies
 * the rows into the local storage domains, writes the skill files, listens to
 * `domain/changed` for the mirrored domains and pushes local changes with a
 * debounce, and keeps a per-row hash journal so it never overwrites a row the
 * other side changed since the last sync.
 *
 * The mirror is off unless the deployment enables it. A failure logs and
 * retries; it never breaks the Host.
 * @module @deepseek-ai/dsh-faberloom-mirror
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { DomainChanged, KvTable } from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import {
  FABERLOOM_MIRROR_DOMAINS,
  FABERLOOM_MIRROR_FORMAT_VERSION,
  MIRROR_ROUTE_PATH,
  SKILL_BUNDLE_NAME,
  checkMirrorDocument,
  deriveMirrorOrigin,
  hashRow,
  hashSkill,
} from './document.ts'
import { MirrorHomeStore } from './store.ts'
import { applyMirrorDocument, readMirrorDocument, type MirrorDomainSource } from './sync.ts'
import type {
  FaberLoomMirrorDocument,
  FaberLoomMirrorRowChange,
  FaberLoomMirrorSkip,
  FaberLoomMirrorSyncResult,
} from './types.ts'

export type * from './types.ts'
export { FABERLOOM_MIRROR_DOMAINS, MIRROR_ROUTE_PATH, deriveMirrorOrigin } from './document.ts'
export {
  FABERLOOM_MIRROR_FORMAT_VERSION,
  SKILL_BUNDLE_NAME,
  checkMirrorDocument,
  hashRow,
  hashSkill,
} from './document.ts'
export { MirrorHomeStore } from './store.ts'
export type { MirrorHomeStoreOptions } from './store.ts'
export { applyMirrorDocument, readMirrorDocument } from './sync.ts'
export type { MirrorDomainSource, MirrorLiveDomain } from './sync.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomMirror: FaberLoomMirror
  }
}

/** Repeating interval between two mirror cycles, in milliseconds. */
export const DEFAULT_MIRROR_INTERVAL_MS = 120_000

/**
 * Quiet window a local change waits before it is pushed, in milliseconds.
 * A panel that polls every five seconds can republish an unchanged Space row
 * and wake the mirror constantly; one minute coalesces those no-op writes while
 * still carrying a routine or Work Flow to the VPS promptly.
 */
export const DEFAULT_MIRROR_DEBOUNCE_MS = 60_000

/** Longest one mirror request may take, in milliseconds. */
export const DEFAULT_MIRROR_TIMEOUT_MS = 180_000

/**
 * Largest apply body the desktop sends in one request. A home can hold tens of
 * megabytes of Session shares, routine history, and skills; the gateway's
 * route and the owner's MCP server both cap a request body, so a first sync
 * that sent the whole home answered 413 and never moved a routine. Splitting
 * the same document into bounded apply calls keeps every request small while
 * preserving the row-journal rule, because each chunk records its own rows.
 */
export const DEFAULT_MIRROR_CHUNK_BYTES = 3 * 1024 * 1024

/** Name of the status document the mirror keeps in its home. */
export const MIRROR_STATUS_FILE = 'mirror-status.json'

/** Deployment-supplied wiring of the desktop side of the mirror. */
export interface Config {
  /** Whether the mirror runs at all. It is off when absent. */
  enabled?: boolean
  /** Gateway origin holding the mirror route, for example `https://harness.mwt.one`. */
  gatewayUrl?: string
  /** Owning account email the gateway resolves the socket and rows from. */
  ownerId?: string
  /** Console bearer token the gateway authenticates the owner with. */
  consoleToken?: string
  /** Console API base the installation signs in with; the harness origin is derived from it. */
  consoleBase?: string
  /** Internal credential the owner's product MCP server accepts on its socket. */
  mirrorKey?: string
  /** Owner skills root; defaults to `<home>/skills`. */
  skillsRoot?: string
  /**
   * Root holding the product's `single`-layout domain documents; defaults to
   * `<home>/storages`, where the JSON backend keeps them. A deployment that
   * routes its domains to another medium names it here, and the mirror then
   * reaches only the domains this process holds open.
   */
  storagesRoot?: string
  /** Which side this process is, as the transfer document reports it. */
  platform?: 'web' | 'desktop'
  /** Milliseconds between two cycles. */
  intervalMs?: number
  /** Milliseconds a local change waits before it is pushed. */
  debounceMs?: number
  /** Milliseconds one request may take. */
  timeoutMs?: number
  /** Largest apply body sent in one request, in bytes. */
  chunkBytes?: number
}

/** Schemastery configuration for the mirror. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  gatewayUrl: z.string(),
  ownerId: z.string(),
  consoleToken: z.string(),
  consoleBase: z.string(),
  mirrorKey: z.string(),
  skillsRoot: z.string(),
  storagesRoot: z.string(),
  platform: z.union(['web', 'desktop']),
  intervalMs: z.number(),
  debounceMs: z.number(),
  timeoutMs: z.number(),
  chunkBytes: z.number(),
})

/** One journal entry: the digest of the row as of the last sync that touched it. */interface JournalEntry {
  /** sha256 of the local value the last sync recorded for this row. */
  readonly syncedLocalHash: string
  /** sha256 of the remote value the last sync recorded for this row. */
  readonly syncedRemoteHash: string
}

/** The journal digest of a row that does not exist on a side. */
const DELETED = 'deleted'

/** What the remote answered one mirror request with. */
interface MirrorResponse {
  /** The document the remote holds. */
  readonly document: FaberLoomMirrorDocument
  /** Row locations the remote wrote from the pushed document. */
  readonly applied: readonly FaberLoomMirrorRowChange[]
  /** Skill bundles the remote wrote from the pushed document. */
  readonly skillsApplied: readonly string[]
  /** Locations the remote could not reach. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
}

/** What one local read produced. */
export interface FaberLoomMirrorExportResult {
  /** The local rows and skill files as one document. */
  readonly document: FaberLoomMirrorDocument
  /** Locations this process could not reach. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
}

/** What applying one received document onto this home produced. */
export interface FaberLoomMirrorImportResult {
  /** Row locations the document addressed. */
  readonly rows: readonly FaberLoomMirrorRowChange[]
  /** Row locations written (a tombstone counts as applied). */
  readonly applied: readonly FaberLoomMirrorRowChange[]
  /** Row locations a domain or table of this process does not expose. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
  /** Skill bundles written from the document. */
  readonly skillsApplied: readonly string[]
}

/** What one local push produced. */
interface PushResult {
  /** Locations the push addressed. */
  readonly rows: readonly FaberLoomMirrorRowChange[]
  /** Locations the remote wrote. */
  readonly applied: readonly FaberLoomMirrorRowChange[]
  /** Skill bundles the remote wrote. */
  readonly skillsApplied: readonly string[]
  /** Locations that could not be reached. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
}

/** One bounded apply body: rows grouped by domain and table, plus skills. */
interface MirrorPushChunk {
  /** Domain name to its version stamp and pending table rows. */
  readonly domains: Record<string, {
    readonly version?: number
    readonly tables: Record<string, Record<string, { readonly deleted: boolean; readonly value?: unknown }>>
  }>
  /** Skill bundle name to `SKILL.md` text. */
  readonly skills: Record<string, string>
}

/** The same shape while a chunk is being filled. */
interface MutableMirrorPushChunk {
  domains: Record<string, {
    version?: number
    tables: Record<string, Record<string, { deleted: boolean; value?: unknown }>>
  }>
  skills: Record<string, string>
}

/** What one local pull-apply produced. */
interface PullResult {
  /** Locations the remote document addressed. */
  readonly rows: readonly FaberLoomMirrorRowChange[]
  /** Locations written into the local domains. */
  readonly applied: readonly FaberLoomMirrorRowChange[]
  /** Locations the local journal protected from overwrite. */
  readonly kept: readonly FaberLoomMirrorRowChange[]
  /** Skill bundles written locally. */
  readonly skillsApplied: readonly string[]
  /** Locations that could not be reached. */
  readonly skipped: readonly FaberLoomMirrorSkip[]
}

/**
 * The desktop side of the product mirror. It owns the compare-and-apply rule,
 * the row journal, and the push debounce; the gateway owns the transport and
 * the owner's own home.
 */
export class FaberLoomMirror extends Service {
  static inject = ['storageDomain']

  private readonly journal = new Map<string, JournalEntry>()
  /** The last remote address of every journaled row, so a local deletion is pushable. */
  private readonly synced = new Map<string, FaberLoomMirrorRowChange>()
  private readonly changed = new Set<string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private stopped = false
  /** The home store of this side, built once so its medium reads stay coherent. */
  private storeInstance: MirrorHomeStore | undefined
  /** When this process mounted the mirror, as the status reports it. */
  private readonly startedAt: string
  private cycles = 0
  private failedCycles = 0
  private lastCycleAt: string | undefined
  private lastError: string | undefined
  /** Why the cycle in flight failed at the transport, if it did. */
  private cycleError: string | undefined
  private lastResult: FaberLoomMirrorSyncResult | undefined
  /** What the last answered pull held, so an operator sees what the peer offered. */
  private lastRemote: Record<string, unknown> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the deployment's wiring of this side.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomMirror')
    this.startedAt = new Date().toISOString()
    if (this.config.enabled !== true) {
      this.ctx.logger.info('faberloom: mirror off (enabled is not true); the local home is not mirrored')
      void this.refreshStatus()
      return
    }
    const missing = this.missingWiring()
    if (missing.length > 0) {
      this.ctx.logger.warn(
        `faberloom: mirror off (missing ${missing.join(', ')}); set FABERLOOM_MIRROR_URL, FABERLOOM_MIRROR_OWNER, CONSOLA_TOKEN and FABERLOOM_MIRROR_KEY (the per-account key the gateway prints) and restart`,
      )
      void this.refreshStatus()
      return
    }
    const interval = this.config.intervalMs ?? DEFAULT_MIRROR_INTERVAL_MS
    this.ctx.on('domain/changed', (change: DomainChanged) => { this.observe(change) })
    this.ctx.effect(() => {
      // Keep the interval referenced: an unref'd timer is not enough to wake an
      // otherwise idle host (the Desktop's main process), so a routine created
      // on the Web only arrived when some local change happened to tick it.
      this.timer = setInterval(() => { void this.tick() }, interval)
      void this.tick()
      return () => { this.stop() }
    }, 'faberloom.mirror.lifecycle')
  }

  /**
   * Write the status document and say where it lives, so an operator reading a
   * host log has the state in one line instead of guessing from the panels. A
   * panel may call it too; the cycle calls it after every attempt.
   * @returns resolution after the document is written.
   */
  async refreshStatus(): Promise<void> {
    const path = this.statusPath()
    try {
      await this.writeStatus()
      this.ctx.logger.info(`faberloom: mirror ${this.active() ? 'active' : 'off'}; state in ${path}`)
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: mirror could not write its state to ${path}: ${String(error)}`)
    }
  }

  /** Whether the mirror is wired and enabled, so a cycle runs. */
  private active(): boolean {
    return this.config.enabled === true && this.missingWiring().length === 0
  }

  /** The wiring names this side is still missing, in configuration order. */
  private missingWiring(): string[] {
    const missing: string[] = []
    if (this.base() === undefined) missing.push('gatewayUrl')
    if (this.owner() === undefined) missing.push('ownerId')
    if (this.token() === undefined) missing.push('consoleToken')
    // The internal credential is optional: the gateway validates the console
    // token, and a value installed here is checked only when present.
    return missing
  }

  /** Resolve the mirror route URL, or undefined when unwired. */
  private base(): string | undefined {
    const configured = this.setting('gatewayUrl', 'FABERLOOM_MIRROR_URL')
    if (configured !== undefined) return `${configured.replace(/\/+$/u, '')}${MIRROR_ROUTE_PATH}`
    // No FABERLOOM_MIRROR_URL: derive the harness origin from the console base
    // the Desktop already wrote, which is `consola.<host>` for `https://<host>`.
    return deriveMirrorOrigin(this.setting('consoleBase', 'CONSOLA_API_BASE'))
  }

  /** Resolve the owning account email, or undefined when unwired. */
  private owner(): string | undefined {
    return this.setting('ownerId', 'FABERLOOM_MIRROR_OWNER')
  }

  /** Resolve the console bearer token, or undefined when unwired. */
  private token(): string | undefined {
    return this.setting('consoleToken', 'CONSOLA_TOKEN')
  }

  /** Resolve the internal credential, or undefined when unwired. */
  private key(): string | undefined {
    return this.setting('mirrorKey', 'FABERLOOM_MIRROR_KEY')
  }

  /** One configured value, falling back to the environment name the deployment injects. */
  private setting(name: keyof Config, environment: string): string | undefined {
    const configured = this.config[name]
    if (typeof configured === 'string' && configured.length > 0) return configured
    const inherited = process.env[environment]
    return inherited === undefined || inherited.length === 0 ? undefined : inherited
  }

  /**
   * The owner skills root this side reads and writes.
   * @returns the absolute skills root.
   */
  skillsRoot(): string {
    const configured = this.config.skillsRoot
    if (configured !== undefined && configured.length > 0) return configured
    return join(this.harnessHome(), 'skills')
  }

  /** The harness home this side runs under: `DSH_HOME`, or the process directory. */
  private harnessHome(): string {
    const inherited = process.env['DSH_HOME']
    return inherited === undefined || inherited.length === 0 ? process.cwd() : inherited
  }

  /**
   * The home this side mirrors: the storage root's parent when a deployment named
   * one, and the harness home otherwise. The status document belongs to the
   * medium's home, which is why the two are separate.
   * @returns the absolute home directory.
   */
  home(): string {
    const configured = this.config.storagesRoot
    if (configured !== undefined && configured.length > 0) return dirname(configured)
    return this.harnessHome()
  }

  /**
   * Absolute path of the status document this side keeps.
   * @returns the absolute path.
   */
  statusPath(): string {
    return join(this.home(), MIRROR_STATUS_FILE)
  }

  /**
   * The rows of this home: the domains this process holds open, and every other
   * mirrored domain read from its own document on the medium.
   */
  private store(): MirrorHomeStore {
    this.storeInstance ??= new MirrorHomeStore({
      ...this.config.storagesRoot === undefined ? {} : { storagesRoot: this.config.storagesRoot },
      facility: this.ctx.storageDomain as unknown as MirrorDomainSource,
    })
    return this.storeInstance
  }

  /** Which side this process reports itself as in the transfer document. */
  private platform(): 'web' | 'desktop' {
    const configured = this.config.platform
    if (configured !== undefined) return configured
    return process.env['FABERLOOM_MIRROR_PLATFORM'] === 'web' ? 'web' : 'desktop'
  }

  /**
   * One status snapshot: what the mirror is wired to and what its last cycle did.
   * @returns the document written to {@link statusPath}.
   */
  status(): Record<string, unknown> {
    const missing = this.missingWiring()
    const last = this.lastResult
    return {
      enabled: this.config.enabled === true,
      active: this.active(),
      missing,
      url: this.base() ?? null,
      owner: this.owner() ?? null,
      platform: this.platform(),
      home: this.home(),
      storagesRoot: this.store().root(),
      skillsRoot: this.skillsRoot(),
      intervalMs: this.config.intervalMs ?? DEFAULT_MIRROR_INTERVAL_MS,
      startedAt: this.startedAt,
      lastCycleAt: this.lastCycleAt ?? null,
      cycles: this.cycles,
      failedCycles: this.failedCycles,
      lastError: this.lastError ?? null,
      lastRemote: this.lastRemote ?? null,
      lastCycle: last === undefined ? null : {
        rows: last.rows.length,
        applied: last.applied.length,
        keptLocal: last.keptLocal.length,
        pushed: last.pushed.length,
        skillsApplied: last.skillsApplied,
        skipped: last.skipped,
      },
    }
  }

  /** Write the status document; a failure is logged, never fatal to a cycle. */
  async writeStatus(): Promise<void> {
    const target = this.statusPath()
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(this.status(), null, 2)}\n`, 'utf8')
  }

  /** Clear the running timers without ending the mirror, for a service this process keeps. */
  clearTimers(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.timer = undefined
    this.flushTimer = undefined
  }

  /** Stop the timers; a stopped mirror never starts another cycle. */
  stop(): void {
    this.stopped = true
    this.clearTimers()
  }

  /**
   * One full cycle: read this home, pull the remote document and apply it, then
   * push every local row the journal does not already match.
   * @returns what the cycle did, or undefined when the mirror is unwired or the peer refused.
   */
  async sync(): Promise<FaberLoomMirrorSyncResult | undefined> {
    if (!this.active()) return undefined
    // One cycle owns one failure: the transport records a reason here and the
    // guard that runs the cycle reads it, so a reason never outlives its cycle.
    this.cycleError = undefined
    const store = this.store()
    const medium = await store.load()
    const remote = await this.pull()
    if (remote === undefined) return undefined
    this.lastRemote = describeDocument(remote)
    // A row can only land in a document the medium holds, and only the peer
    // knows the version its owner stamped; this is where that version arrives.
    store.materialize(remote)
    const pulled = await this.applyPulled(store, remote)
    // Two homes that provisioned the same built-in routine independently give
    // it two ids. The rows are not equal, so the conflict rule keeps both and
    // the panels show duplicates. Reconcile same-name routines once, keeping
    // the most evolved row and tombstoning the other side's id.
    const tombstones = [
      ...await this.reconcileRoutineNames(store, remote),
      ...await this.reconcileWorkflowNames(store, remote),
    ]
    // Read the local side AFTER the apply: what the apply wrote is now the
    // local value, and reading it before would read the overwritten rows as
    // local changes and push them back over the pull.
    const local = await this.localDocument(store)
    const pushed = await this.pushLocal(local, remote, tombstones)
    return {
      rows: [...pulled.rows, ...pushed.rows],
      applied: pulled.applied,
      keptLocal: pulled.kept,
      pushed: pushed.applied,
      skillsApplied: [...pulled.skillsApplied, ...pushed.skillsApplied],
      skipped: [...medium, ...pulled.skipped, ...pushed.skipped],
    }
  }

  /**
   * Read this home's rows and skill files as one transfer document.
   * @param store - the home store this cycle reads.
   * @returns the local document and the locations this process cannot reach.
   */
  private async localDocument(store: MirrorHomeStore): Promise<FaberLoomMirrorExportResult> {
    const read = readMirrorDocument(store, this.platform())
    const skills = await this.readSkills()
    const document: FaberLoomMirrorDocument = {
      version: read.document.version,
      platform: read.document.platform,
      domains: read.document.domains,
      skills: skills.skills,
    }
    return { document, skipped: [...read.skipped, ...skills.skipped] }
  }

  /**
   * Apply one document another side sent, without a cycle of this process:
   * validate the version, write or delete the rows, and write the skill files.
   * @param received - the parsed document the caller sent.
   * @returns what landed and the locations this process could not reach.
   * @throws when the document version or its structure is refused.
   */
  async importDocument(received: unknown): Promise<FaberLoomMirrorImportResult> {
    const checked = checkMirrorDocument(received)
    if (!checked.ok) {
      throw new Error(`mirror document refused: ${describeProblems(checked.problems)}`)
    }
    const store = this.store()
    const medium = await store.load()
    // The document names the version its owner stamps, which is what a
    // document this home does not hold yet must be created with.
    store.materialize(checked.document)
    const applied = await applyMirrorDocument(store, checked.document)
    const skills = await this.writeMirroredSkills(checked.document.skills)
    return {
      rows: applied.rows,
      applied: applied.applied,
      skipped: [...medium, ...applied.skipped, ...skills.skipped],
      skillsApplied: skills.written,
    }
  }

  /**
   * Read this home as one transfer document, for the side that serves it.
   * @returns the document and the locations this process cannot reach.
   */
  async exportDocument(): Promise<FaberLoomMirrorExportResult> {
    const store = this.store()
    const medium = await store.load()
    const local = await this.localDocument(store)
    return { document: local.document, skipped: [...medium, ...local.skipped] }
  }

  /**
   * Write the skill bundles one received document carries.
   * @param skills - bundle name to `SKILL.md` text; a null entry is skipped.
   * @returns the bundles written and the names refused or unreadable.
   */
  async writeMirroredSkills(
    skills: Readonly<Record<string, string | null>>,
  ): Promise<{ written: string[]; skipped: FaberLoomMirrorSkip[] }> {
    const written: string[] = []
    const skipped: FaberLoomMirrorSkip[] = []
    for (const [name, content] of Object.entries(skills)) {
      if (content === null) continue
      try {
        await this.writeSkill(name, content)
        written.push(name)
      } catch (error: unknown) {
        skipped.push({ domain: 'skills', table: name, reason: String(error) })
      }
    }
    return { written, skipped }
  }
  /**
   * Read the remote document from the gateway.
   * @returns the parsed document, or undefined when the request failed.
   */
  async pull(): Promise<FaberLoomMirrorDocument | undefined> {
    const response = await this.request({ action: 'pull' })
    if (response === undefined) return undefined
    return response.document
  }

  /** Digest of the row one document carries at a location; `deleted` when it carries none or a tombstone. */
  private remoteDigest(document: FaberLoomMirrorDocument, change: FaberLoomMirrorRowChange): string {
    const row = document.domains[change.domain]?.tables[change.table]?.[change.key]
    return row === undefined || row.deleted ? DELETED : hashRow(row.value)
  }

  /** Apply one already-read remote document under the journal rule. */
  private async applyPulled(store: MirrorHomeStore, remote: FaberLoomMirrorDocument): Promise<PullResult> {
    const result = await applyMirrorDocument(store, remote, {
      overwrite: (domain, table, key) => this.shouldOverwrite(
        store,
        domain,
        table,
        key,
        this.remoteDigest(remote, { domain, table, key }),
      ),
    })
    for (const change of result.applied) {
      const key = journalKey(change.domain, change.table, change.key)
      const row = remote.domains[change.domain]?.tables[change.table]?.[change.key]
      if (row === undefined || row.deleted) {
        this.journal.delete(key)
        this.synced.delete(key)
      } else {
        this.recordSynced(key, change, hashRow(row.value), hashRow(row.value))
      }
    }
    // Una fila que ambos lados ya tienen igual no se escribe (una publicacion
    // del documento por fila y por ciclo es I/O puro) pero tampoco es un
    // rechazo que un operador deba leer: `keptLocal` queda para las filas que
    // de verdad difieren.
    const kept = result.kept.filter(change => (
      (this.currentRowHash(store, change.domain, change.table, change.key) ?? DELETED)
      !== this.remoteDigest(remote, change)
    ))
    const skillsApplied: string[] = []
    const skipped: FaberLoomMirrorSkip[] = [...result.skipped]
    const nonNull: Record<string, string> = {}
    for (const [name, content] of Object.entries(remote.skills)) {
      if (content === null) continue
      nonNull[name] = content
    }
    const skills = await this.writeMirroredSkills(nonNull)
    for (const name of skills.written) {
      const hash = hashSkill(nonNull[name] as string)
      this.journal.set(skillJournalKey(name), { syncedLocalHash: hash, syncedRemoteHash: hash })
      skillsApplied.push(name)
    }
    skipped.push(...skills.skipped)
    return { rows: result.rows, applied: result.applied, kept, skillsApplied, skipped }
  }

  /**
   * Collapse routines that share a name after the pull. The surviving row is
   * the one with the highest version (then the latest update), and it is
   * written under a local key when one exists so the desktop keeps the id its
   * Sessions and grants already reference. Every removed remote key becomes a
   * tombstone in this cycle, so the VPS deletes its duplicate instead of
   * receiving it back on the next pull.
   * @param store - this home's rows, after the remote document landed.
   * @param remote - the document just applied, used to tell remote keys from local ones.
   * @returns tombstones for the duplicate remote keys that were removed.
   */
  private async reconcileRoutineNames(
    store: MirrorHomeStore,
    remote: FaberLoomMirrorDocument,
  ): Promise<FaberLoomMirrorRowChange[]> {
    return await this.reconcileNames(store, remote, 'faberloom_routines', 'routines')
  }

  /** Collapse same-name Work Flows after the pull, keeping the most evolved one. */
  private async reconcileWorkflowNames(
    store: MirrorHomeStore,
    remote: FaberLoomMirrorDocument,
  ): Promise<FaberLoomMirrorRowChange[]> {
    return await this.reconcileNames(store, remote, 'faberloom_workflows', 'workflows')
  }

  /**
   * Collapse same-name rows of one mirrored table after the pull.
   * @param store - this home's rows, after the remote document landed.
   * @param remote - the document just applied.
   * @param domain - mirrored domain holding the table.
   * @param tableName - table to reconcile.
   * @returns tombstones for the duplicate remote keys that were removed.
   */
  private async reconcileNames(
    store: MirrorHomeStore,
    remote: FaberLoomMirrorDocument,
    domain: string,
    tableName: string,
  ): Promise<FaberLoomMirrorRowChange[]> {
    const table = store.get(domain)?.table(tableName) as KvTable<string, unknown> | undefined
    if (table === undefined) return []
    const remoteRows = remote.domains[domain]?.tables[tableName] ?? {}
    const remoteKeys = new Set(Object.keys(remoteRows))
    const groups = new Map<string, { key: string; value: Record<string, unknown> }[]>()
    for (const [key, raw] of table.entries()) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const value = raw as Record<string, unknown>
      const name = typeof value['name'] === 'string' ? value['name'].trim() : ''
      if (name.length === 0) continue
      const group = groups.get(name) ?? []
      group.push({ key, value })
      groups.set(name, group)
    }
    const tombstones: FaberLoomMirrorRowChange[] = []
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const rank = (entry: { value: Record<string, unknown> }): [number, string] => [
        typeof entry.value['version'] === 'number' ? entry.value['version'] : 0,
        typeof entry.value['updatedAt'] === 'string' ? entry.value['updatedAt'] : '',
      ]
      const ordered = [...group].sort((left, right) => {
        const [leftVersion, leftAt] = rank(left)
        const [rightVersion, rightAt] = rank(right)
        return rightVersion - leftVersion || rightAt.localeCompare(leftAt)
      })
      const winner = ordered[0] as { key: string; value: Record<string, unknown> }
      // A desktop key wins the id when the group has one: the PC's Sessions,
      // grants and board rows already point at it. With no local key, the
      // remote winner keeps its own id.
      const local = ordered.find(entry => !remoteKeys.has(entry.key))
      const canonical = local ?? winner
      if (canonical.key !== winner.key) await table.put(canonical.key, winner.value)
      for (const entry of ordered) {
        if (entry.key === canonical.key) continue
        await table.delete(entry.key)
        if (remoteKeys.has(entry.key)) {
          tombstones.push({ domain, table: tableName, key: entry.key })
        }
      }
    }
    return tombstones
  }

  /** Push every locally changed row and skill, recording what landed. */
  private async pushLocal(
    local: FaberLoomMirrorExportResult,
    remote: FaberLoomMirrorDocument,
    tombstones: readonly FaberLoomMirrorRowChange[] = [],
  ): Promise<PushResult> {
    const pending = this.pendingRows(local.document, remote)
    const seen = new Set(pending.map(change => journalKey(change.domain, change.table, change.key)))
    for (const change of tombstones) {
      const key = journalKey(change.domain, change.table, change.key)
      if (seen.has(key)) continue
      seen.add(key)
      pending.push(change)
    }
    const skills: Record<string, string | null> = {}
    for (const [name, content] of Object.entries(local.document.skills)) {
      /* v8 ignore next -- readSkills returns only strings; null is the wire form of a deletion. */
      if (content === null) continue
      if (this.journal.get(skillJournalKey(name))?.syncedLocalHash === hashSkill(content)) continue
      if (remote.skills[name] === content) continue
      skills[name] = content
    }
    if (pending.length === 0 && Object.keys(skills).length === 0) {
      return { rows: [], applied: [], skillsApplied: [], skipped: [] }
    }
    // The home can exceed the route's body cap by an order of magnitude (Session
    // shares alone are tens of megabytes). Each chunk is a complete apply
    // document, so a row that landed is journaled before the next request and a
    // failed chunk never makes the previous ones look unsent.
    const chunks = this.pushChunks(pending, local.document, skills)
    const applied: FaberLoomMirrorRowChange[] = []
    const skillsApplied: string[] = []
    const skipped: FaberLoomMirrorSkip[] = [...local.skipped]
    for (const chunk of chunks) {
      const document: FaberLoomMirrorDocument = {
        version: FABERLOOM_MIRROR_FORMAT_VERSION,
        platform: this.platform(),
        domains: chunk.domains,
        skills: chunk.skills,
      }
      const response = await this.request({ action: 'apply', document })
      if (response === undefined) break
      applied.push(...response.applied)
      skillsApplied.push(...response.skillsApplied)
      skipped.push(...response.skipped)
      for (const change of response.applied) {
        const key = journalKey(change.domain, change.table, change.key)
        const localRow = local.document.domains[change.domain]?.tables[change.table]?.[change.key]
        const remoteRow = response.document.domains[change.domain]?.tables[change.table]?.[change.key]
        if (localRow === undefined || localRow.deleted) {
          this.journal.delete(key)
          this.synced.delete(key)
          continue
        }
        // The pushed value is what the local side holds; the remote value is what
        // the remote echoes back, which may differ when the remote refused or
        // merged the write. Recording both keeps the next pull from reading the
        // push as a remote change.
        const localHash = hashRow(localRow.value)
        const remoteHash = remoteRow === undefined || remoteRow.deleted ? DELETED : hashRow(remoteRow.value)
        this.recordSynced(key, change, localHash, remoteHash)
      }
      for (const name of response.skillsApplied) {
        const content = skills[name]
        /* v8 ignore next -- the remote confirms only bundles this push sent, and those are strings. */
        if (typeof content === 'string') {
          const hash = hashSkill(content)
          this.journal.set(skillJournalKey(name), { syncedLocalHash: hash, syncedRemoteHash: hash })
        }
      }
    }
    return { rows: pending, applied, skillsApplied, skipped }
  }

  /** Largest apply body this side sends, in bytes. */
  private chunkBytes(): number {
    const configured = this.config.chunkBytes
    if (configured !== undefined && Number.isSafeInteger(configured) && configured >= 64 * 1024) return configured
    return DEFAULT_MIRROR_CHUNK_BYTES
  }

  /**
   * Split the pending rows and skills into apply documents no larger than
   * {@link chunkBytes}. One oversized row still gets its own chunk: it is the
   * smallest unit that can be written, and refusing it here would leave the
   * journal stuck on every cycle.
   * @param pending - row locations to send.
   * @param local - the local document the row values come from.
   * @param skills - changed skill bundles, sent in their own chunks.
   * @returns ready-to-send chunks, in local document order.
   */
  private pushChunks(
    pending: readonly FaberLoomMirrorRowChange[],
    local: FaberLoomMirrorDocument,
    skills: Readonly<Record<string, string | null>>,
  ): MirrorPushChunk[] {
    const max = this.chunkBytes()
    const chunks: MirrorPushChunk[] = []
    let current: MutableMirrorPushChunk = { domains: {}, skills: {} }
    let size = 0
    const flush = (): void => {
      if (Object.keys(current.domains).length > 0 || Object.keys(current.skills).length > 0) chunks.push(current)
      current = { domains: {}, skills: {} }
      size = 0
    }
    for (const change of pending) {
      const row = local.domains[change.domain]?.tables[change.table]?.[change.key] ?? { deleted: true }
      const bytes = byteLength(JSON.stringify(row)) + byteLength(change.domain) + byteLength(change.table) + byteLength(change.key) + 64
      if (size > 0 && size + bytes > max) flush()
      const source = local.domains[change.domain]
      const domain = current.domains[change.domain] ?? {
        ...source?.version === undefined ? {} : { version: source.version },
        tables: {},
      }
      const table = domain.tables[change.table] ?? {}
      table[change.key] = row
      domain.tables[change.table] = table
      current.domains[change.domain] = domain
      size += bytes
      // A row larger than the chunk budget is still a legal one-row document.
      if (bytes > max) flush()
    }
    for (const [name, content] of Object.entries(skills)) {
      if (content === null) continue
      const bytes = byteLength(name) + byteLength(content) + 32
      if (size > 0 && size + bytes > max) flush()
      current.skills[name] = content
      size += bytes
      if (bytes > max) flush()
    }
    flush()
    return chunks
  }

  /** Record one row as synced: both sides now hold the same digest. */
  private recordSynced(key: string, change: FaberLoomMirrorRowChange, localHash: string, remoteHash: string): void {
    this.journal.set(key, { syncedLocalHash: localHash, syncedRemoteHash: remoteHash })
    this.synced.set(key, change)
  }

  /**
   * The conflict rule for one incoming row: the remote value lands only when the
   * local side still holds what the last sync left there and the remote value
   * moved since then. A row changed on both sides keeps the local value, which
   * is then pushed back. A row this side never journaled lands when it is absent
   * or when both sides already agree on it, so a first cycle over two homes that
   * were filled independently records the agreement instead of sending every
   * equal row back over the wire.
   */
  private shouldOverwrite(store: MirrorHomeStore, domain: string, table: string, key: string, remoteHash: string): boolean {
    const entry = this.journal.get(journalKey(domain, table, key))
    const localHash = this.currentRowHash(store, domain, table, key) ?? DELETED
    if (entry === undefined) return localHash === DELETED || localHash === remoteHash
    return entry.syncedLocalHash === localHash && entry.syncedRemoteHash !== remoteHash
  }

  /**
   * Every row whose value moved since the journal recorded it, deletions
   * included, plus every journaled row the peer's own document no longer holds:
   * a medium rewritten from an older state loses rows the journal had already
   * recorded, and re-sending them is what makes a cycle self-healing.
   */
  private pendingRows(document: FaberLoomMirrorDocument, remote: FaberLoomMirrorDocument): FaberLoomMirrorRowChange[] {
    const pending: FaberLoomMirrorRowChange[] = []
    const seen = new Set<string>()
    for (const [domain, domainDocument] of Object.entries(document.domains)) {
      for (const [table, rows] of Object.entries(domainDocument.tables)) {
        for (const [key, row] of Object.entries(rows)) {
          const journal = journalKey(domain, table, key)
          if (this.journal.get(journal)?.syncedLocalHash === hashRow(row.value)) continue
          /* v8 ignore next -- a local document holds each coordinate once, so `seen` cannot repeat here. */
          if (seen.has(journal)) continue
          // A first sync between two homes that already hold the same row does
          // not need to send it: the peer's document carries the same hash.
          // Without this, the first push sent the whole 45 MB Session-share
          // domain and the owner's per-row apply spent an hour rewriting it.
          const remoteRow = remote.domains[domain]?.tables[table]?.[key]
          if (remoteRow !== undefined && !remoteRow.deleted && hashRow(remoteRow.value) === hashRow(row.value)) continue
          seen.add(journal)
          pending.push({ domain, table, key })
        }
      }
    }
    for (const [journal, change] of this.synced) {
      if (seen.has(journal)) continue
      seen.add(journal)
      const local = this.currentRowHash(this.store(), change.domain, change.table, change.key)
      if (local === undefined) {
        // Deleted here: the peer still holds the value it knew, and a tombstone
        // is what tells it so.
        pending.push(change)
        continue
      }
      // Still here, and the peer answered for that domain without the row: it
      // held the row once and its medium no longer does, so this cycle sends it
      // again. A domain the peer could not read at all is not evidence of a
      // deletion, and neither is a peer that never answered.
      const peerDomain = remote.domains[change.domain]
      if (peerDomain === undefined) continue
      if (peerDomain.tables[change.table]?.[change.key] !== undefined) continue
      pending.push(change)
    }
    return pending
  }

  /** The digest of one local row, or undefined when it is absent. */
  private currentRowHash(store: MirrorHomeStore, domain: string, table: string, key: string): string | undefined {
    const live = store.get(domain)
    /* v8 ignore next -- A journaled row's domain is open: localDocument read it in this same cycle. */
    if (live === undefined) return undefined
    let target
    try {
      target = live.table(table)
    } catch {
      /* v8 ignore next -- Same: a declared table the domain opened cannot be missing mid-cycle. */
      return undefined
    }
    const value = target.get(key)
    if (value === undefined) return undefined
    return hashRow(value)
  }

  /** Record one local change and schedule a debounced push. */
  private observe(change: DomainChanged): void {
    /* v8 ignore next -- A stopped service keeps its listener until the fiber unloads. */
    if (this.stopped) return
    if (!(change.domain in FABERLOOM_MIRROR_DOMAINS)) return
    if (change.table === '') return
    this.changed.add(journalKey(change.domain, change.table, change.key))
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    const debounce = this.config.debounceMs ?? DEFAULT_MIRROR_DEBOUNCE_MS
    this.flushTimer = setTimeout(() => { void this.flush() }, debounce)
  }

  /** Run one cycle for the observed changes. */
  private async flush(): Promise<void> {
    this.flushTimer = undefined
    /* v8 ignore next -- A stopped service keeps its listener until the fiber unloads. */
    if (this.stopped) return
    const touched = [...this.changed]
    this.changed.clear()
    /* v8 ignore next -- observe always adds a key before it schedules, so a flush sees one. */
    if (touched.length === 0) return
    await this.tick()
  }

  /** One guarded cycle: a failure is logged, recorded in the status, and the next attempt retries. */
  private async tick(): Promise<void> {
    /* v8 ignore next -- The interval and the debounce can overlap; one guard skips the surplus cycle. */
    if (this.stopped || this.running) return
    this.running = true
    this.cycles += 1
    try {
      this.lastResult = await this.sync()
      if (this.cycleError === undefined) {
        this.lastError = undefined
      } else {
        // A refused request is not a thrown cycle: the transport answered and
        // named a reason, and that reason is what an operator needs to read.
        this.failedCycles += 1
        this.lastError = this.cycleError
      }
    } catch (error: unknown) {
      this.failedCycles += 1
      this.lastError = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`faberloom: mirror cycle failed: ${this.lastError}`)
    } finally {
      this.running = false
      this.lastCycleAt = new Date().toISOString()
      try {
        await this.writeStatus()
      } catch (error: unknown) {
        this.ctx.logger.warn(`faberloom: mirror could not write its state to ${this.statusPath()}: ${String(error)}`)
      }
    }
  }

  /** Send one mirror request, or undefined when the wiring or the transport failed. */
  private async request(body: { action: 'pull' | 'apply'; document?: FaberLoomMirrorDocument }): Promise<MirrorResponse | undefined> {
    const base = this.base()
    const owner = this.owner()
    const token = this.token()
    const key = this.key()
    if (base === undefined || owner === undefined || token === undefined) return undefined
    const document = body.document
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'x-faberloom-owner': encodeURIComponent(owner),
      ...(key === undefined ? {} : { 'x-faberloom-mirror-key': key }),
      'x-faberloom-mirror-action': body.action,
    }
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers,
        ...document === undefined ? {} : { body: JSON.stringify(document) },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_MIRROR_TIMEOUT_MS),
      })
      const text = await response.text()
      if (!response.ok) {
        this.cycleError = `${body.action} refused (${String(response.status)}) ${text.slice(0, 200)}`
        this.ctx.logger.warn(`faberloom: mirror ${body.action} refused (${String(response.status)}) ${text.slice(0, 200)}`)
        return undefined
      }
      const parsed: unknown = parseJson(text)
      const checked = checkMirrorDocument(parsed)
      if (!checked.ok) {
        this.cycleError = `${body.action} answered an unusable document: ${describeProblems(checked.problems)}`
        this.ctx.logger.warn(`faberloom: mirror ${body.action} answered an unusable document: ${describeProblems(checked.problems)}`)
        return undefined
      }
      return {
        document: checked.document,
        applied: readChanges(parsed, 'applied'),
        skillsApplied: readStrings(parsed, 'skillsApplied'),
        skipped: readSkips(parsed),
      }
    } catch (error: unknown) {
      this.cycleError = `${body.action} failed: ${String(error)}`
      this.ctx.logger.warn(`faberloom: mirror ${body.action} failed: ${String(error)}`)
      return undefined
    }
  }

  /** Write one skill bundle's `SKILL.md` under the owner's skills root. */
  private async writeSkill(name: string, content: string): Promise<void> {
    if (!SKILL_BUNDLE_NAME.test(name)) throw new Error('invalid skill bundle name')
    const directory = join(this.skillsRoot(), name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), content, 'utf8')
  }

  /**
   * Read every skill bundle this owner holds as `name -> SKILL.md` text.
   * @returns the bundle texts and the bundles with no readable `SKILL.md`.
   */
  async readSkills(): Promise<{ skills: Record<string, string>; skipped: readonly FaberLoomMirrorSkip[] }> {
    const root = this.skillsRoot()
    const skills: Record<string, string> = {}
    const skipped: FaberLoomMirrorSkip[] = []
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return { skills, skipped }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!SKILL_BUNDLE_NAME.test(entry.name)) continue
      let content
      try {
        content = await readFile(join(root, entry.name, 'SKILL.md'), 'utf8')
      } catch {
        skipped.push({ domain: 'skills', table: entry.name, reason: 'SKILL.md-not-readable' })
        continue
      }
      skills[entry.name] = content
    }
    return { skills, skipped }
  }
}

/** Parse a response body, or undefined when the body is empty or not JSON. */
function parseJson(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Render one document check's problems as one diagnostic line. */
function describeProblems(problems: readonly { readonly path: string; readonly detail: string }[]): string {
  return problems.map(problem => `${problem.path} ${problem.detail}`).join('; ')
}

/** UTF-8 byte length of one string, the unit the request cap uses. */
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Read one row-change list from a response body, ignoring malformed entries. */
function readChanges(body: unknown, field: string): FaberLoomMirrorRowChange[] {
  const raw = (body as Record<string, unknown> | null)?.[field]
  if (!Array.isArray(raw)) return []
  const changes: FaberLoomMirrorRowChange[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const domain = record['domain']
    const table = record['table']
    const key = record['key']
    if (typeof domain !== 'string' || typeof table !== 'string' || typeof key !== 'string') continue
    changes.push({ domain, table, key })
  }
  return changes
}

/** Read a string list field from a response body. */
function readStrings(body: unknown, field: string): string[] {
  const raw = (body as Record<string, unknown> | null)?.[field]
  if (!Array.isArray(raw)) return []
  const values: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') values.push(entry)
  }
  return values
}

/** Read the skip list of a response body. */
function readSkips(body: unknown): FaberLoomMirrorSkip[] {
  const raw = (body as Record<string, unknown> | null)?.['skipped']
  if (!Array.isArray(raw)) return []
  const skips: FaberLoomMirrorSkip[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const domain = record['domain']
    const table = record['table']
    const reason = record['reason']
    if (typeof domain !== 'string' || typeof table !== 'string' || typeof reason !== 'string') continue
    skips.push({ domain, table, reason })
  }
  return skips
}

/** One journal key: the transfer coordinates of one row. */
function journalKey(domain: string, table: string, key: string): string {
  return `${domain}\u0000${table}\u0000${key}`
}

/** One journal key for a skill bundle. */
function skillJournalKey(name: string): string {
  return `skills\u0000${name}\u0000${name}`
}

/** One document as the status reports it: what a cycle's peer offered, in counts. */
function describeDocument(document: FaberLoomMirrorDocument): Record<string, unknown> {
  const domains: Record<string, number> = {}
  for (const [name, domain] of Object.entries(document.domains)) {
    domains[name] = Object.values(domain.tables).reduce((total, rows) => total + Object.keys(rows).length, 0)
  }
  return {
    version: document.version,
    platform: document.platform,
    domains,
    skills: Object.keys(document.skills),
  }
}

export default FaberLoomMirror
