/**
 * Public type vocabulary of the FaberLoom harness projection: the Workspace or
 * Space scope one projection belongs to, the product records that scope uses,
 * the manifest that records what a projection wrote, and the report one run
 * returns. Types only — the service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-harness-projection/src/types
 */

import type { FaberLoomSpaceId } from '@deepseek-ai/dsh-faberloom-spaces'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** One registered Workspace as the scope of a projection. */
export interface HarnessWorkspaceScope {
  /** Discriminant marking a Workspace scope. */
  readonly kind: 'workspace'
  /** The Workspace whose own directory receives the projection. */
  readonly id: WorkspaceId
  /** Display title the generated instructions carry. */
  readonly title: string
}

/** One product Space as the scope of a projection. */
export interface HarnessSpaceScope {
  /** Discriminant marking a Space scope. */
  readonly kind: 'space'
  /** The Space whose mirrored Workspace directory receives the projection. */
  readonly id: FaberLoomSpaceId
  /** Display title the generated instructions carry. */
  readonly title: string
}

/** The scope one harness projection belongs to: a Workspace or a product Space. */
export type HarnessScope = HarnessWorkspaceScope | HarnessSpaceScope

/** One catalog agent the scope's records register. */
export interface HarnessAgentUsage {
  /** Stable catalog agent id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Responsibility statement, which is also the agent's persona. */
  readonly responsibility: string
  /** Declared provider id, or undefined when unset. */
  readonly provider: string | undefined
  /** Declared model id, or undefined when unset. */
  readonly model: string | undefined
  /** Skill names the agent declares. */
  readonly skills: readonly string[]
}

/** One skill an agent of the scope declares, resolved through `ctx.skills`. */
export interface HarnessSkillUsage {
  /** Kebab-case skill name. */
  readonly name: string
  /** Routing description. */
  readonly description: string
  /** Instruction body, without its own frontmatter. */
  readonly content: string
}

/** One work flow the scope owns. */
export interface HarnessWorkflowUsage {
  /** Stable work-flow id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: string
}

/** One routine the scope owns. */
export interface HarnessRoutineUsage {
  /** Stable routine id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** Lifecycle status. */
  readonly status: string
}

/** One memory entry the scope carries. */
export interface HarnessMemoryUsage {
  /** Stable memory record id. */
  readonly id: string
  /** The remembered text. */
  readonly text: string
  /** Which product table holds the entry: the Space's captured memory or a teaching. */
  readonly source: 'space' | 'teaching'
}

/** One curated context entry the scope carries. */
export interface HarnessContextUsage {
  /** Stable context entry id. */
  readonly id: string
  /** Display title. */
  readonly title: string
}

/**
 * Everything the product records mark as belonging to one scope, plus the
 * domains this process does not hold open. A domain that is not open is
 * reported in {@link HarnessUsage.unreadableDomains} instead of reading as an
 * empty scope, because an absent domain is not an empty one.
 */
export interface HarnessUsage {
  /** The product Space the scope resolves to, or undefined when the scope has none. */
  readonly spaceId: string | undefined
  /** Catalog agents registered by the scope, ordered by name then id. */
  readonly agents: readonly HarnessAgentUsage[]
  /** Skills the scope's agents declare that a skill provider resolves, ordered by name. */
  readonly skills: readonly HarnessSkillUsage[]
  /** Declared skill names no skill provider resolves, or that are not valid skill names. */
  readonly unresolvedSkills: readonly string[]
  /** Work flows scoped to the Space, ordered by name then id. */
  readonly workflows: readonly HarnessWorkflowUsage[]
  /** Routines scoped to the Space, ordered by name then id. */
  readonly routines: readonly HarnessRoutineUsage[]
  /** Memory the Space carries, ordered by source then id. */
  readonly memory: readonly HarnessMemoryUsage[]
  /** Curated context entries of the Space, ordered by title then id. */
  readonly context: readonly HarnessContextUsage[]
  /** Product domains this process does not hold open, in traversal order. */
  readonly unreadableDomains: readonly string[]
}

/** The scope one manifest records, in its durable spelling. */
export interface HarnessManifestScope {
  /** Workspace or Space. */
  readonly kind: 'workspace' | 'space'
  /** Scope id as a plain string. */
  readonly id: string
  /** Display title at the instant the projection ran. */
  readonly title: string
}

/** One agent a manifest records, with the file that defines it. */
export interface HarnessManifestAgent {
  /** Stable catalog agent id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** File name under `.agents`, without its directory. */
  readonly file: string
}

/** One skill a manifest records, with the file that defines it. */
export interface HarnessManifestSkill {
  /** Kebab-case skill name. */
  readonly name: string
  /** `SKILL.md` path relative to the scope directory. */
  readonly file: string
}

/**
 * The durable record of one projection, written to
 * `.faberloom/harness.json`. `files` names every path the projection owns;
 * the manifest is deliberately not listed, because it is never pruned.
 */
export interface HarnessProjectionManifest {
  /** Manifest format version. */
  readonly version: number
  /** The scope the projection belongs to. */
  readonly scope: HarnessManifestScope
  /** ISO-8601 instant the projection ran. */
  readonly generatedAt: string
  /** Every path the projection wrote, relative to the scope directory. */
  readonly files: readonly string[]
  /** Agents the projection wrote. */
  readonly agents: readonly HarnessManifestAgent[]
  /** Skills the projection wrote. */
  readonly skills: readonly HarnessManifestSkill[]
  /** Work flows the projection recorded. */
  readonly workflows: readonly HarnessWorkflowUsage[]
  /** Routines the projection recorded. */
  readonly routines: readonly HarnessRoutineUsage[]
  /** Memory the projection recorded. */
  readonly memory: readonly HarnessMemoryUsage[]
  /** Context the projection recorded. */
  readonly context: readonly HarnessContextUsage[]
}

/** What one projection run wrote and what it retired. */
export interface HarnessProjectionReport {
  /** Manifest format version the run wrote. */
  readonly version: number
  /** The scope the run projected. */
  readonly scope: HarnessScope
  /** Absolute scope directory the run wrote into. */
  readonly root: string
  /** ISO-8601 instant the run started. */
  readonly generatedAt: string
  /** Paths written, relative to the scope directory, in write order. */
  readonly written: readonly string[]
  /** Paths the manifest of the previous run declared and this one does not, removed. */
  readonly pruned: readonly string[]
  /** The records the run included. */
  readonly usage: HarnessUsage
}
