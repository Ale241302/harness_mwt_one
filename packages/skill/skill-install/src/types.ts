/**
 * Consumer-facing types of the native skill installer: the two scopes an
 * install targets, the folder-detection verdict, and the install, uninstall,
 * and listing reports.
 *
 * @module @deepseek-ai/dsh-skill-install/types
 */

/** Where an installed skill is made available. */
export type SkillScope = 'workspace' | 'global'

/**
 * Why a folder, or one candidate inside it, is not an installable skill.
 *
 * - `missing` — the source path does not exist.
 * - `not-a-directory` — the source path is not a directory.
 * - `empty` — the source directory holds no entries.
 * - `missing-skill-md` — no `SKILL.md` exists at the source or one level below it.
 * - `bad-frontmatter` — `SKILL.md` has no readable YAML front matter.
 * - `missing-name` — front matter omits `name` or `description`.
 * - `invalid-name` — `name` is not kebab-case.
 */
export type SkillFolderRejection =
  | 'missing'
  | 'not-a-directory'
  | 'empty'
  | 'missing-skill-md'
  | 'bad-frontmatter'
  | 'missing-name'
  | 'invalid-name'

/** One skill folder the detector accepted. */
export interface DetectedSkill {
  /** Kebab-case name read from the folder's `SKILL.md` front matter. */
  readonly name: string
  /** Routing description read from the same front matter. */
  readonly description: string
  /** Absolute directory holding `SKILL.md`. */
  readonly directory: string
}

/** One candidate the detector rejected, with the reason it is not a skill. */
export interface RefusedSkill {
  /** Absolute candidate directory. */
  readonly directory: string
  /** Why the candidate is not a usable skill. */
  readonly reason: SkillFolderRejection
}

/**
 * Verdict of inspecting a folder the caller named as an install source. A
 * rejected source carries one reason; an accepted source carries at least one
 * skill and any additionally found candidates that failed validation.
 */
export type SkillFolderDetection =
  | { readonly kind: 'invalid'; readonly source: string; readonly reason: SkillFolderRejection }
  | {
    readonly kind: 'found'
    readonly source: string
    readonly skills: readonly DetectedSkill[]
    readonly refused: readonly RefusedSkill[]
  }

/** Per-skill result of one install. */
export type SkillInstallOutcomeStatus = 'installed' | 'replaced' | 'already-installed' | 'skipped' | 'refused'

/** One skill's result within an install call. */
export interface SkillInstallOutcome {
  /** Kebab-case skill name, or the candidate directory base name when refused. */
  readonly name: string
  /** What the install did with this skill. */
  readonly status: SkillInstallOutcomeStatus
  /** Why a `skipped` or `refused` outcome happened. */
  readonly reason?: SkillFolderRejection | 'exists'
}

/** Overall verdict of one install call, derived from its outcomes. */
export type SkillInstallStatus =
  | 'installed'
  | 'already-installed'
  | 'skipped'
  | 'refused'
  | 'invalid'
  | 'cancelled'

/** Why an install could not proceed at all. */
export type SkillInstallRefusal = SkillFolderRejection | 'no-interaction' | 'unknown-scope' | 'unavailable-destination'

/** Result of one install call. */
export interface SkillInstallReport {
  /** Summarised outcome across every candidate. */
  readonly status: SkillInstallStatus
  /** Source the call resolved and inspected. */
  readonly source: string
  /** Scope the skills were written into, when one was chosen. */
  readonly destination?: SkillScope
  /** Resolved destination root, when one was chosen. */
  readonly root?: string
  /** One result per candidate; empty when the source held no skill at all. */
  readonly outcomes: readonly SkillInstallOutcome[]
  /** Set when nothing was installed. */
  readonly reason?: SkillInstallRefusal
}

/** The two resolved roots a scope question offers. */
export interface SkillInstallTargets {
  /** Workspace skills root, or null when the session has no resolvable workspace. */
  readonly workspace: string | null
  /** User skills root, always available. */
  readonly global: string
}

/** One install recorded by a skills-root marker and read back. */
export interface SkillInstallRow {
  /** Installed skill name. */
  readonly name: string
  /** Scope the skill was installed into. */
  readonly destination: SkillScope
  /** Resolved root holding the skill directory. */
  readonly root: string
  /** Folder the skill was copied from. */
  readonly source: string
  /** ISO-8601 instant the install was recorded. */
  readonly installedAt: string
}

/** One install request. */
export interface SkillInstallRequest {
  /** Folder to install from: a skill directory, or a directory of skill directories. */
  readonly source: string
  /** Scope to install into. */
  readonly destination: SkillScope
  /** Session working directory used to resolve the workspace root. */
  readonly cwd?: string
  /** Replace an existing skill of the same name instead of skipping it. */
  readonly replace?: boolean
}

/** One uninstall request. */
export interface SkillUninstallRequest {
  /** Skill name to remove. */
  readonly name: string
  /** Scope the skill was installed into. */
  readonly destination: SkillScope
  /** Session working directory used to resolve the workspace root. */
  readonly cwd?: string
}

/** Outcome of one uninstall request. */
export type SkillUninstallStatus = 'removed' | 'not-found' | 'not-an-install'

/** Result of one uninstall request. */
export interface SkillUninstallReport {
  /** What the uninstall did. */
  readonly status: SkillUninstallStatus
  /** Skill name the call named. */
  readonly name: string
  /** Scope the call named. */
  readonly destination: SkillScope
  /** Resolved root the call inspected, or null when no root could be resolved. */
  readonly root: string | null
}

/**
 * Installer published as `ctx.skillInstall`. Every method writes through the
 * same roots the filesystem skill provider scans, so an installed skill loads
 * without a restart once the provider's watcher observes the new directory.
 */
export interface SkillInstallService {
  /**
   * Resolve the two roots an install may target.
   * @param cwd - session working directory; omitted leaves the workspace root null.
   * @returns the workspace root (null without a workspace) and the global root.
   */
  targets(cwd?: string): Promise<SkillInstallTargets>

  /**
   * Inspect a folder and report whether it is an installable skill.
   * @param source - absolute or `cwd`-relative folder to inspect.
   * @param cwd - session working directory used to resolve a relative source.
   * @returns the detected skills, or the reason the folder is not a skill.
   */
  detect(source: string, cwd?: string): Promise<SkillFolderDetection>

  /**
   * Copy every detected skill into the chosen scope's root.
   * @param request - source, destination, session cwd, and replace flag.
   * @returns the resolved root and one outcome per candidate.
   */
  install(request: SkillInstallRequest): Promise<SkillInstallReport>

  /**
   * Remove one skill previously installed from a folder.
   * @param request - name, destination, and session cwd.
   * @returns whether a marked install was removed.
   */
  uninstall(request: SkillUninstallRequest): Promise<SkillUninstallReport>

  /**
   * List every folder-installed skill across the global root and, when a
   * workspace resolves, the workspace root.
   * @param cwd - session working directory; omitted lists the global root alone.
   * @returns the install rows, name-ascending.
   */
  list(cwd?: string): Promise<readonly SkillInstallRow[]>
}
