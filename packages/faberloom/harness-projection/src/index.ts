/**
 * FaberLoom harness projection (`ctx.faberloomHarnessProjection`): materializes
 * a Workspace's or Space's harness inside that scope's own directory — the
 * agents and skills the scope's records register, plus its work flows,
 * routines, memory, and context, as the instruction files every client reads
 * (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.gemini/`, `.agents/`, `.claude/`,
 * `.kimi/`) and one manifest at `.faberloom/harness.json`.
 *
 * The projection belongs to the scope, not to the whole catalog: it reads the
 * product domains through `ctx.storageDomain.get`, the traversal
 * `faberloom-backup` and `faberloom-mirror` use, so a domain this process does
 * not hold open is reported as unread rather than read as empty. The manifest
 * is the ownership record: the next run deletes only the paths it declares and
 * no longer writes, so files the user keeps in the same folder are never
 * touched.
 * @module @deepseek-ai/dsh-faberloom-harness-projection
 */

import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
// Type-only: resolves the ctx.storageDomain declaration and the optional
// ctx.skills and ctx.workspaceRegistry services read through ctx.get.
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-skill'
import { HARNESS_PROJECTION_VERSION, planProjection } from './render.ts'
import { readScopeUsage, resolveScopeSpace, type HarnessDomainSource, type HarnessSkillLookup } from './usage.ts'
import type { HarnessProjectionReport, HarnessScope, HarnessUsage } from './types.ts'

export type * from './types.ts'
export { HARNESS_PROJECTION_VERSION } from './render.ts'
export { HARNESS_SKILL_NAME, readScopeUsage, resolveScopeSpace } from './usage.ts'
export type { HarnessDomainSource, HarnessDomainView, HarnessSkillLookup, HarnessSpaceView, HarnessScopeSpace, HarnessTableView } from './usage.ts'
export { planProjection, renderAgentDocument, renderAgentsIndex, renderInstructions, renderManifest, renderSettings, renderSkillDocument } from './render.ts'
export type { HarnessPlanInput, HarnessProjectionFile, HarnessProjectionPlan } from './render.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomHarnessProjection: FaberLoomHarnessProjection
  }
}

/** Manifest path inside a scope directory, relative to that directory. */
export const MANIFEST_PATH = '.faberloom/harness.json'

/** Most entries one generated list renders before it names the remainder. */
export const DEFAULT_MAX_LIST_ENTRIES = 20

/** A manifest path this service is willing to delete: a plain relative path inside the scope. */
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

/** Deployment-supplied wiring of the harness projection. */
export interface Config {
  /**
   * Whether {@link FaberLoomHarnessProjection.refresh} writes a projection at
   * all. Absent means off, so a deployment that does not want folder digests
   * does not get them; the explicit `project`, `readUsage`, and `clean` calls
   * always act.
   */
  enabled?: boolean
  /** Most entries one generated list renders; defaults to {@link DEFAULT_MAX_LIST_ENTRIES}. */
  maxListEntries?: number
}

/** Schemastery configuration for the harness projection. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  maxListEntries: z.number(),
})

/** One registered Workspace, as this service resolves a folder from it. */
interface WorkspaceEntry {
  /** Canonical directory of the Workspace. */
  readonly path: string
}

/**
 * The workspace registry read structurally by service name. The registry is an
 * optional service: when it is not mounted, no scope has a folder and
 * `refresh` reports that rather than guessing a path.
 */
interface WorkspaceRegistryView {
  /**
   * Read one registered Workspace.
   * @param id - the Workspace id.
   * @returns the Workspace, or undefined when it is not registered.
   */
  get(id: WorkspaceId): WorkspaceEntry | undefined
}

/** The paths one previous manifest declared, or the reason it cannot be trusted. */
type ManifestRead =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Admit one manifest path, or refuse it. Only a plain relative path inside the
 * scope directory is ever deleted, so a manifest that was edited, moved, or
 * written by another tool can never name a file outside the scope.
 * @param path - the declared path.
 * @returns the admitted path, or undefined when it must not be deleted.
 */
function safeRelative(path: string): string | undefined {
  if (!SAFE_RELATIVE_PATH.test(path)) return undefined
  return path.split('/').includes('..') ? undefined : path
}

/**
 * Remove one path when it exists.
 * @param path - absolute path to remove.
 * @returns `true` when a file or directory was removed.
 */
async function removePath(path: string): Promise<boolean> {
  try {
    await rm(path)
    return true
  } catch {
    // A missing path, or a directory without `recursive`, is not a removal; the
    // caller reports only what it actually retired.
    return false
  }
}

/**
 * The harness projection service: read one scope's product records, write its
 * harness files, and retire the files the previous projection owned.
 */
export class FaberLoomHarnessProjection extends Service {
  static inject = ['storageDomain']

  private readonly maxListEntries: number

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the deployment's wiring.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomHarnessProjection')
    this.maxListEntries = config.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES
    if (!Number.isInteger(this.maxListEntries) || this.maxListEntries < 1) {
      throw new Error(`faberloom: maxListEntries must be an integer greater than or equal to 1, got ${String(this.maxListEntries)}`)
    }
  }

  /**
   * Read the records one scope registers: its agents and their skills, its work
   * flows, routines, memory, and context. A product domain this process does
   * not hold open is named in `unreadableDomains`; a Space scope naming a Space
   * the open spaces domain does not hold is refused.
   * @param scope - the Workspace or Space to read.
   * @returns the scope's records.
   * @throws when a Space scope names a Space the open spaces domain does not hold.
   */
  async readUsage(scope: HarnessScope): Promise<HarnessUsage> {
    return await readScopeUsage(this.domainSource(), scope, this.skillLookup())
  }

  /**
   * Write the complete projection of one scope into an explicit directory and
   * return what it wrote and retired. The manifest is written last, so an
   * interrupted run leaves the previous ownership record in place and the next
   * run still prunes from it.
   * @param scope - the scope being projected.
   * @param root - absolute scope directory the files land in.
   * @returns the written paths, the pruned paths, and the records included.
   * @throws when a Space scope names a Space the open spaces domain does not hold.
   */
  async project(scope: HarnessScope, root: string): Promise<HarnessProjectionReport> {
    const generatedAt = new Date().toISOString()
    const usage = await this.readUsage(scope)
    const plan = planProjection({ scope, root, generatedAt, usage, maxListEntries: this.maxListEntries })
    const written: string[] = []
    for (const file of plan.files) {
      const absolute = join(root, file.path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, file.content, 'utf8')
      written.push(file.path)
    }
    const pruned = await this.prune(root, new Set(written))
    const manifestPath = join(root, MANIFEST_PATH)
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`, 'utf8')
    return { version: HARNESS_PROJECTION_VERSION, scope, root, generatedAt, written, pruned, usage }
  }

  /**
   * Resolve one scope's real directory and project it. It returns undefined
   * instead of writing when the scope has no registered folder: the projection
   * is disabled, the workspace registry is not mounted, the Workspace is not
   * registered, the Space mirrors no Workspace, or the open spaces domain does
   * not hold the named Space.
   * @param scope - the scope to project.
   * @returns the projection report, or undefined when the scope has no folder.
   */
  async refresh(scope: HarnessScope): Promise<HarnessProjectionReport | undefined> {
    if (this.config.enabled !== true) return undefined
    const root = this.scopeRoot(scope)
    if (root === undefined) return undefined
    return await this.project(scope, root)
  }

  /**
   * Retire every file one projection declared. Only paths that projection's own
   * manifest lists are removed, so a foreign file in the same folder survives;
   * a directory the removal emptied is removed too, and the manifest itself
   * stays as the record of what was owned.
   * @param root - absolute scope directory.
   * @returns the retired paths, relative to that directory.
   * @throws when the manifest exists but is not a readable projection manifest.
   */
  async clean(root: string): Promise<string[]> {
    const manifest = await this.readManifest(root)
    if (!manifest.ok) {
      throw new Error(`faberloom: ${join(root, MANIFEST_PATH)} is not a readable projection manifest: ${manifest.reason}`)
    }
    const removed: string[] = []
    for (const path of manifest.files) {
      const safe = safeRelative(path)
      if (safe === undefined) {
        this.ctx.logger.warn(`faberloom: projection manifest names ${JSON.stringify(path)}, which is not a path inside the scope; nothing was removed`)
        continue
      }
      const absolute = join(root, safe)
      if (!await removePath(absolute)) continue
      removed.push(safe)
      await this.removeEmptyDirectories(root, absolute)
    }
    return removed
  }

  /** The storage-domain facility this service reads product records through. */
  private domainSource(): HarnessDomainSource {
    return this.ctx.storageDomain
  }

  /** The skill registry, or undefined when no provider is mounted. */
  private skillLookup(): HarnessSkillLookup | undefined {
    return this.ctx.get('skills')
  }

  /** The real directory of one scope, or undefined when it has none. */
  private scopeRoot(scope: HarnessScope): string | undefined {
    const registry: WorkspaceRegistryView | undefined = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    if (scope.kind === 'workspace') return registry.get(scope.id)?.path
    const resolved = resolveScopeSpace(this.domainSource(), scope)
    if (resolved.kind !== 'found') return undefined
    const workspaceId = resolved.space.workspaceId
    if (workspaceId === null) return undefined
    return registry.get(brandString<WorkspaceId>(workspaceId))?.path
  }

  /**
   * Read the paths one previous projection declared. A folder that was never
   * projected declares nothing; a manifest that cannot be parsed is refused,
   * because deleting on an untrusted list could reach a file this service never
   * wrote.
   */
  private async readManifest(root: string): Promise<ManifestRead> {
    let raw: string
    try {
      raw = await readFile(join(root, MANIFEST_PATH), 'utf8')
    } catch {
      return { ok: true, files: [] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'the file is not JSON' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'the file is not a JSON object' }
    }
    const files = (parsed as Record<string, unknown>)['files']
    if (!Array.isArray(files) || !files.every(entry => typeof entry === 'string')) {
      return { ok: false, reason: 'the file declares no string file list' }
    }
    return { ok: true, files }
  }

  /** Retire the paths the previous manifest declared and this run does not write. */
  private async prune(root: string, written: ReadonlySet<string>): Promise<string[]> {
    const manifest = await this.readManifest(root)
    if (!manifest.ok) {
      this.ctx.logger.warn(`faberloom: ${join(root, MANIFEST_PATH)} is not a readable projection manifest (${manifest.reason}); nothing was pruned`)
      return []
    }
    const pruned: string[] = []
    for (const path of manifest.files) {
      if (written.has(path)) continue
      const safe = safeRelative(path)
      if (safe === undefined) {
        this.ctx.logger.warn(`faberloom: projection manifest names ${JSON.stringify(path)}, which is not a path inside the scope; nothing was pruned`)
        continue
      }
      const absolute = join(root, safe)
      if (!await removePath(absolute)) continue
      pruned.push(safe)
      await this.removeEmptyDirectories(root, absolute)
    }
    return pruned
  }

  /** Remove the directories one removal emptied, stopping at the scope directory. */
  private async removeEmptyDirectories(root: string, removed: string): Promise<void> {
    const base = root.endsWith(sep) ? root : `${root}${sep}`
    let directory = dirname(removed)
    while (directory.startsWith(base)) {
      try {
        await rmdir(directory)
      } catch {
        // A directory that still holds a user's file, or one already gone, ends
        // the walk: only what this service emptied is removed.
        return
      }
      directory = dirname(directory)
    }
  }
}

export default FaberLoomHarnessProjection
