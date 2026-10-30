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

/** Why one `agents/` entry is not an installable agent. */
export type AgentRejection =
  | 'missing-preset-yml'
  | 'bad-preset'
  | 'bad-frontmatter'
  | 'missing-name'
  | 'invalid-name'

/** One agent an install source carries: a preset folder, or a Markdown file's body. */
export interface DetectedAgent {
  /** Kebab-case id the preset directory is named by. */
  readonly id: string
  /** Display name from the preset descriptor or the Markdown front matter. */
  readonly name: string
  /** Routing description from the same source. */
  readonly description: string
  /** Absolute preset directory, or the Markdown file it came from. */
  readonly source: string
  /** Markdown file body, which becomes the persona; null for a preset folder. */
  readonly prompt: string | null
}

/** One `agents/` entry the detector refused. */
export interface RefusedAgent {
  /** Absolute candidate path. */
  readonly source: string
  /** Why the entry is not an installable agent. */
  readonly reason: AgentRejection
}

/** Verdict of inspecting one `agents/` directory. */
export interface AgentDetection {
  /** Agents an install can write into the home's preset directory. */
  readonly agents: readonly DetectedAgent[]
  /** Entries refused, with their reasons. */
  readonly refused: readonly RefusedAgent[]
}

/**
 * Verdict of inspecting a folder the caller named as an install source. A
 * rejected source carries one reason; an accepted source carries at least one
 * skill or agent, any additionally found candidates that failed validation,
 * and — when the folder is a knowledge base holding `skills/` and `agents/` —
 * the agents that install alongside the skills.
 */
export type SkillFolderDetection =
  | { readonly kind: 'invalid'; readonly source: string; readonly reason: SkillFolderRejection }
  | {
    readonly kind: 'found'
    readonly source: string
    readonly skills: readonly DetectedSkill[]
    readonly refused: readonly RefusedSkill[]
    /** Agents the source carries; absent when it carries none. */
    readonly agents?: readonly DetectedAgent[]
    /** `agents/` entries refused, with their reasons. */
    readonly refusedAgents?: readonly RefusedAgent[]
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
  readonly reason?: SkillFolderRejection | AgentRejection | 'exists'
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
  /** One result per agent the source carried; absent when it carried none. */
  readonly agents?: readonly SkillInstallOutcome[]
  /** Preset directory the agents were written into, when the source carried any. */
  readonly agentsRoot?: string
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

/** One kind of part a harness carries; each kind has a reader in the running deployment. */
export type HarnessPartKind = 'skills' | 'agents' | 'rules' | 'commands' | 'scripts' | 'hooks' | 'mcp-configs'

/** What one harness install did with one part. */
export type HarnessPartStatus = 'installed' | 'replaced' | 'skipped'

/** Why a named source is not an installable harness at all. */
export type HarnessSourceRefusal = 'missing' | 'not-a-harness' | 'archive-unreadable'

/** One always-on rule whose text goes into the home's managed block. */
export interface HarnessRuleText {
  /** Rule name, from its front matter or its file base name. */
  readonly name: string
  /** Rule body, with any front matter removed. */
  readonly body: string
}

/** One rule group a harness carries by language or domain. */
export interface HarnessRuleGroup {
  /** Group directory name. */
  readonly name: string
  /** Absolute group directory. */
  readonly directory: string
  /** Rule root the group sits under, relative to the Harness home. */
  readonly relative: string
}

/** One rule root copied whole, so the block can name a group by its installed path. */
export interface HarnessRuleRoot {
  /** Absolute source directory. */
  readonly directory: string
  /** Destination, relative to the Harness home. */
  readonly relative: string
}

/** One whole-directory part a harness carries. */
export interface HarnessCopy {
  /** Which kind the directory carries. */
  readonly kind: HarnessPartKind
  /** Absolute source directory. */
  readonly directory: string
  /** Destination, relative to the Harness home. */
  readonly relative: string
}

/**
 * What one source turned out to carry. A source that is not a harness carries
 * no part, names the `reason`, and installs nothing.
 */
export interface HarnessDetection {
  /** The folder or archive the operator chose. */
  readonly source: string
  /** Harness root the parts were read from; the extraction directory for an archive. */
  readonly root: string
  /** Extraction directory the caller removes once the install ends; absent for a folder source. */
  readonly temporary?: string
  /** Why the source is not an installable harness; absent when it carries parts. */
  readonly reason?: HarnessSourceRefusal
  /** Skill candidates, deduplicated by name across roots. */
  readonly skills: readonly DetectedSkill[]
  /** Skill candidates that failed validation. */
  readonly refusedSkills: readonly RefusedSkill[]
  /** Agent candidates, deduplicated by id across roots. */
  readonly agents: readonly DetectedAgent[]
  /** Agent candidates that failed validation. */
  readonly refusedAgents: readonly RefusedAgent[]
  /** Always-on rule files in write order; the harness's own `AGENTS.md` leads. */
  readonly rules: readonly string[]
  /** Rule groups copied whole and named in the block. */
  readonly ruleGroups: readonly HarnessRuleGroup[]
  /** Rule roots copied whole. */
  readonly ruleRoots: readonly HarnessRuleRoot[]
  /** Whole-directory parts copied under the home. */
  readonly copies: readonly HarnessCopy[]
}

/** One part's result within a harness install. */
export interface HarnessPartOutcome {
  /** Which part the outcome is about. */
  readonly kind: HarnessPartKind
  /** What the install did with it. */
  readonly status: HarnessPartStatus
  /** Pieces written, or always-on rules and groups for the `rules` part. */
  readonly count: number
  /** Absolute destination the part landed in. */
  readonly target: string
}

/** One harness install request. */
export interface HarnessInstallRequest {
  /** Absolute folder or `.zip` the operator chose in the host's own dialog. */
  readonly source: string
  /** Rewrite a piece that is already there instead of skipping it. */
  readonly replace?: boolean
}

/** Result of one harness install. */
export interface HarnessInstallReport {
  /** Summarised outcome across every part. */
  readonly status: 'installed' | 'already-installed' | 'skipped' | 'refused'
  /** The source the call inspected. */
  readonly source: string
  /** Harness root the parts were read from. */
  readonly root: string
  /** Why nothing was installed; absent when the call ran. */
  readonly reason?: HarnessSourceRefusal
  /** One result per part the source carried. */
  readonly parts: readonly HarnessPartOutcome[]
  /** One result per skill or agent candidate, refusals included. */
  readonly outcomes: readonly SkillInstallOutcome[]
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
   * Install a whole harness — one folder or one `.zip` — into the user's own
   * Harness home: its skills, agents, rules, commands, scripts, hooks, and MCP
   * server configurations, each into the root the product reads that kind from.
   * @param request - the absolute source and the replace flag.
   * @returns one outcome per part the source carried.
   */
  installHarness(request: HarnessInstallRequest): Promise<HarnessInstallReport>

  /**
   * List every folder-installed skill across the global root and, when a
   * workspace resolves, the workspace root.
   * @param cwd - session working directory; omitted lists the global root alone.
   * @returns the install rows, name-ascending.
   */
  list(cwd?: string): Promise<readonly SkillInstallRow[]>
}
