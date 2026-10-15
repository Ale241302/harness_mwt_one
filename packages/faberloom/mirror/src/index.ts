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
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
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
export { applyMirrorDocument, readMirrorDocument } from './sync.ts'
export type { MirrorDomainSource, MirrorLiveDomain } from './sync.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomMirror: FaberLoomMirror
  }
}

/** Repeating interval between two mirror cycles, in milliseconds. */
export const DEFAULT_MIRROR_INTERVAL_MS = 120_000

/** Quiet window a local change waits before it is pushed, in milliseconds. */
export const DEFAULT_MIRROR_DEBOUNCE_MS = 3_000

/** Longest one mirror request may take, in milliseconds. */
export const DEFAULT_MIRROR_TIMEOUT_MS = 30_000

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
  /** Owner skills root; defaults to `$DSH_HOME/skills`. */
  skillsRoot?: string
  /** Milliseconds between two cycles. */
  intervalMs?: number
  /** Milliseconds a local change waits before it is pushed. */
  debounceMs?: number
  /** Milliseconds one request may take. */
  timeoutMs?: number
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
  intervalMs: z.number(),
  debounceMs: z.number(),
  timeoutMs: z.number(),
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

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the deployment's wiring of this side.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomMirror')
    if (this.config.enabled !== true) {
      this.ctx.logger.info('faberloom: mirror off (enabled is not true); the local home is not mirrored')
      return
    }
    const missing = this.missingWiring()
    if (missing.length > 0) {
      this.ctx.logger.warn(
        `faberloom: mirror off (missing ${missing.join(', ')}); set FABERLOOM_MIRROR_URL, FABERLOOM_MIRROR_OWNER, CONSOLA_TOKEN and FABERLOOM_MIRROR_KEY (the per-account key the gateway prints) and restart`,
      )
      return
    }
    const interval = this.config.intervalMs ?? DEFAULT_MIRROR_INTERVAL_MS
    this.ctx.on('domain/changed', (change: DomainChanged) => { this.observe(change) })
    this.ctx.effect(() => {
      this.timer = setInterval(() => { void this.tick() }, interval)
      this.timer.unref()
      void this.tick()
      return () => { this.stop() }
    }, 'faberloom.mirror.lifecycle')
  }

  /** The wiring names this side is still missing, in configuration order. */
  private missingWiring(): string[] {
    const missing: string[] = []
    if (this.base() === undefined) missing.push('gatewayUrl')
    if (this.owner() === undefined) missing.push('ownerId')
    if (this.token() === undefined) missing.push('consoleToken')
    if (this.key() === undefined) missing.push('mirrorKey')
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
    const home = process.env['DSH_HOME']
    return join(home === undefined || home.length === 0 ? process.cwd() : home, 'skills')
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
   * One full cycle: pull and apply the remote document, then push every local
   * row the journal does not already match.
   * @returns what the cycle did, or undefined when the mirror is unwired.
   */
  async sync(): Promise<FaberLoomMirrorSyncResult | undefined> {
    if (this.missingWiring().length > 0) return undefined
    const remote = await this.pull()
    if (remote === undefined) return undefined
    const local = await this.localDocument()
    const pulled = await this.applyPulled(remote)
    const pushed = await this.pushLocal(local)
    return {
      rows: [...pulled.rows, ...pushed.rows],
      applied: pulled.applied,
      keptLocal: pulled.kept,
      pushed: pushed.applied,
      skillsApplied: [...pulled.skillsApplied, ...pushed.skillsApplied],
      skipped: [...pulled.skipped, ...pushed.skipped],
    }
  }

  /**
   * Read this process's own rows and skill files as one transfer document.
   * @returns the local document and the locations this process cannot reach.
   */
  private async localDocument(): Promise<FaberLoomMirrorExportResult> {
    const source = this.ctx.storageDomain as unknown as MirrorDomainSource
    const read = readMirrorDocument(source, 'desktop')
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
    const source = this.ctx.storageDomain as unknown as MirrorDomainSource
    const applied = await applyMirrorDocument(source, checked.document)
    const skills = await this.writeMirroredSkills(checked.document.skills)
    return {
      rows: applied.rows,
      applied: applied.applied,
      skipped: [...applied.skipped, ...skills.skipped],
      skillsApplied: skills.written,
    }
  }

  /**
   * Read this home as one transfer document, for the side that serves it.
   * @returns the document and the locations this process cannot reach.
   */
  async exportDocument(): Promise<FaberLoomMirrorExportResult> {
    return this.localDocument()
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

  /** Apply one already-read remote document under the journal rule. */
  private async applyPulled(remote: FaberLoomMirrorDocument): Promise<PullResult> {
    const source = this.ctx.storageDomain as unknown as MirrorDomainSource
    const result = await applyMirrorDocument(source, remote, {
      overwrite: (domain, table, key) => {
        const row = remote.domains[domain]?.tables[table]?.[key]
        const remoteHash = row === undefined || row.deleted ? DELETED : hashRow(row.value)
        return this.shouldOverwrite(domain, table, key, remoteHash)
      },
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
    return { rows: result.rows, applied: result.applied, kept: result.kept, skillsApplied, skipped }
  }

  /** Push every locally changed row and skill, recording what landed. */
  private async pushLocal(local: FaberLoomMirrorExportResult): Promise<PushResult> {
    const pending = this.pendingRows(local.document)
    const skills: Record<string, string | null> = {}
    for (const [name, content] of Object.entries(local.document.skills)) {
      /* v8 ignore next -- readSkills returns only strings; null is the wire form of a deletion. */
      if (content === null) continue
      if (this.journal.get(skillJournalKey(name))?.syncedLocalHash === hashSkill(content)) continue
      skills[name] = content
    }
    if (pending.length === 0 && Object.keys(skills).length === 0) {
      return { rows: [], applied: [], skillsApplied: [], skipped: [] }
    }
    const document: FaberLoomMirrorDocument = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'desktop',
      domains: buildPendingDomains(pending, local.document),
      skills,
    }
    const response = await this.request({ action: 'apply', document })
    if (response === undefined) return { rows: pending, applied: [], skillsApplied: [], skipped: local.skipped }
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
    return { rows: pending, applied: response.applied, skillsApplied: response.skillsApplied, skipped: response.skipped }
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
   * is then pushed back.
   */
  private shouldOverwrite(domain: string, table: string, key: string, remoteHash: string): boolean {
    const entry = this.journal.get(journalKey(domain, table, key))
    const localHash = this.currentRowHash(domain, table, key) ?? DELETED
    if (entry === undefined) return localHash === DELETED
    return entry.syncedLocalHash === localHash && entry.syncedRemoteHash !== remoteHash
  }

  /** Every row whose value moved since the journal recorded it, deletions included. */
  private pendingRows(document: FaberLoomMirrorDocument): FaberLoomMirrorRowChange[] {
    const pending: FaberLoomMirrorRowChange[] = []
    const seen = new Set<string>()
    for (const [domain, domainDocument] of Object.entries(document.domains)) {
      for (const [table, rows] of Object.entries(domainDocument.tables)) {
        for (const [key, row] of Object.entries(rows)) {
          const journal = journalKey(domain, table, key)
          if (this.journal.get(journal)?.syncedLocalHash === hashRow(row.value)) continue
          /* v8 ignore next -- a local document holds each coordinate once, so `seen` cannot repeat here. */
          if (seen.has(journal)) continue
          seen.add(journal)
          pending.push({ domain, table, key })
        }
      }
    }
    for (const [journal, change] of this.synced) {
      if (seen.has(journal)) continue
      if (this.currentRowHash(change.domain, change.table, change.key) !== undefined) continue
      seen.add(journal)
      pending.push(change)
    }
    return pending
  }

  /** The digest of one local row, or undefined when it is absent. */
  private currentRowHash(domain: string, table: string, key: string): string | undefined {
    const live = (this.ctx.storageDomain as unknown as MirrorDomainSource).get(domain)
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
    this.flushTimer.unref()
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

  /** One guarded cycle: a failure is logged and the next attempt retries. */
  private async tick(): Promise<void> {
    /* v8 ignore next -- The interval and the debounce can overlap; one guard skips the surplus cycle. */
    if (this.stopped || this.running) return
    this.running = true
    try {
      await this.sync()
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: mirror cycle failed: ${String(error)}`)
    } finally {
      this.running = false
    }
  }

  /** Send one mirror request, or undefined when the wiring or the transport failed. */
  private async request(body: { action: 'pull' | 'apply'; document?: FaberLoomMirrorDocument }): Promise<MirrorResponse | undefined> {
    const base = this.base()
    const owner = this.owner()
    const token = this.token()
    const key = this.key()
    if (base === undefined || owner === undefined || token === undefined || key === undefined) return undefined
    const document = body.document
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'x-faberloom-owner': encodeURIComponent(owner),
      'x-faberloom-mirror-key': key,
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
        this.ctx.logger.warn(`faberloom: mirror ${body.action} refused (${String(response.status)}) ${text.slice(0, 200)}`)
        return undefined
      }
      const parsed: unknown = parseJson(text)
      const checked = checkMirrorDocument(parsed)
      if (!checked.ok) {
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

/** Build the pending subset of a document for one push. */
function buildPendingDomains(
  pending: readonly FaberLoomMirrorRowChange[],
  local: FaberLoomMirrorDocument,
): Record<string, { tables: Record<string, Record<string, { deleted: boolean; value?: unknown }>> }> {
  const domains: Record<string, { tables: Record<string, Record<string, { deleted: boolean; value?: unknown }>> }> = {}
  for (const change of pending) {
    const row = local.domains[change.domain]?.tables[change.table]?.[change.key]
    const domain = domains[change.domain] ?? { tables: {} }
    const rows = domain.tables[change.table] ?? {}
    if (row === undefined || row.deleted) rows[change.key] = { deleted: true }
    else rows[change.key] = { deleted: false, value: row.value }
    domain.tables[change.table] = rows
    domains[change.domain] = domain
  }
  return domains
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

export default FaberLoomMirror
