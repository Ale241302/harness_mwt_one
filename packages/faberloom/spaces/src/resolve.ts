/**
 * Pure contribution resolver for one Space. It takes the candidate contributions
 * the caller may already read, applies child precedence, explicit exclusions,
 * dependency resolution, name-conflict rejection, and a context budget. It never
 * reads a Space, a share, or a title the caller did not supply: the service
 * builds the candidate list after authorization, and a private parent simply
 * never enters it.
 * @module @deepseek-ai/dsh-faberloom-spaces/src/resolve
 */

/** Kind of one resolved contribution. */
export type ContributionKind = 'rule' | 'document' | 'skill' | 'context' | 'memory'

/** One contribution offered to the resolver. */
export interface SpaceContribution {
  /** Stable identifier; a child with the same id replaces the parent. */
  readonly id: string
  /** Kind of material. */
  readonly kind: ContributionKind
  /** Display title used for the name-conflict check. */
  readonly title: string
  /** Body carried into the effective context. */
  readonly body: string
  /** Space that owns this contribution. */
  readonly spaceId: string
  /** Whether a child may inherit it. */
  readonly inheritable: boolean
  /** Whether this actor has access to it by contribution. */
  readonly granted: boolean
  /** Contribution ids this one requires. */
  readonly dependsOn?: readonly string[]
}

/** One contribution that survived resolution. */
export interface ResolvedContribution {
  /** Stable identifier. */
  readonly id: string
  /** Kind of material. */
  readonly kind: ContributionKind
  /** Display title. */
  readonly title: string
  /** Body. */
  readonly body: string
  /** Space that owns it. */
  readonly spaceId: string
}

/** One refusal, named by id and reason rather than by a private title. */
export interface ContributionIssue {
  /** Contribution id, or `(restricted)` when naming it would leak a private parent. */
  readonly id: string
  /** Stable reason. */
  readonly reason: string
}

/** One child affected by a parent change. */
export interface ParentImpactChild {
  /** Child Space id. */
  readonly id: string
  /** Whether this actor may publish a new child revision. */
  readonly permitted: boolean
  /** Revision the child would carry after reapplying the parent. */
  readonly revision: string
}

/** Result of one parent-change impact query. */
export interface ParentChangeImpact {
  /** Parent Space id. */
  readonly parentId: string
  /** Parent version observed. */
  readonly parentVersion: number
  /** Direct and indirect children that inherit the parent. */
  readonly children: readonly ParentImpactChild[]
}
export interface ContributionResolution {
  /** Contributions ordered by id. */
  readonly contributions: readonly ResolvedContribution[]
  /** Contributions refused with their reason. */
  readonly issues: readonly ContributionIssue[]
  /** Ids that participate in a dependency cycle. */
  readonly cycles: readonly string[]
  /** Ids excluded by the child. */
  readonly excluded: readonly string[]
  /** Owners that contributed material, nearest first. */
  readonly sources: readonly string[]
}

/** Options for one resolution. */
export interface ResolveContributionsOptions {
  /** Ids the child explicitly excludes. */
  readonly excluded?: readonly string[]
  /** Byte ceiling for the resolved bodies. */
  readonly maxBytes?: number
}

/** Default context budget. */
export const DEFAULT_CONTEXT_BUDGET = 64 * 1024

/**
 * Resolve one root Space from already-authorized candidates.
 * @param rootId - Space whose effective context is built.
 * @param candidates - root and parent contributions the caller may read.
 * @param options - exclusions and byte ceiling.
 * @returns the resolved contributions, issues, cycles, exclusions, and sources.
 */
export function resolveSpaceContributions(
  rootId: string,
  candidates: readonly SpaceContribution[],
  options: ResolveContributionsOptions = {},
): ContributionResolution {
  const excluded = new Set(options.excluded ?? [])
  const maxBytes = options.maxBytes ?? DEFAULT_CONTEXT_BUDGET
  const eligible = new Map<string, SpaceContribution>()
  const issues = new Map<string, ContributionIssue>()
  const sources: string[] = []
  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue
    if (candidate.spaceId !== rootId && (!candidate.inheritable || !candidate.granted)) {
      // A private parent is absent from the result and from the issue list:
      // naming it here would leak its existence or title.
      continue
    }
    const previous = eligible.get(candidate.id)
    // The root candidate is offered before its ancestors; a child replaces the
    // parent's contribution with the same identifier.
    if (previous === undefined || candidate.spaceId === rootId) eligible.set(candidate.id, candidate)
  }

  const byName = new Map<string, string[]>()
  for (const contribution of eligible.values()) {
    const key = `${contribution.kind}\u0000${contribution.title}`
    const list = byName.get(key) ?? []
    list.push(contribution.id)
    byName.set(key, list)
  }
  for (const ids of byName.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      eligible.delete(id)
      issues.set(id, { id, reason: 'name-conflict' })
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [id, contribution] of [...eligible.entries()]) {
      const failing = (contribution.dependsOn ?? []).find(dependency => (
        dependency === id || !eligible.has(dependency)
      ))
      if (failing === undefined) continue
      eligible.delete(id)
      issues.set(id, { id, reason: failing === id ? 'dependency-cycle' : 'dependency-missing' })
      changed = true
    }
  }

  const state = new Map<string, 'visiting' | 'done'>()
  const cycles = new Set<string>()
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      for (const member of trail.slice(trail.indexOf(id))) cycles.add(member)
      return
    }
    state.set(id, 'visiting')
    for (const dependency of eligible.get(id)?.dependsOn ?? []) {
      if (eligible.has(dependency)) visit(dependency, [...trail, id])
    }
    state.set(id, 'done')
  }
  for (const id of [...eligible.keys()].sort()) visit(id, [])
  for (const id of cycles) {
    const contribution = eligible.get(id)
    if (contribution === undefined) continue
    eligible.delete(id)
    issues.set(id, { id, reason: 'dependency-cycle' })
  }
  for (const id of [...eligible.keys()]) {
    if ((eligible.get(id)?.dependsOn ?? []).some(dependency => !eligible.has(dependency))) {
      eligible.delete(id)
      issues.set(id, { id, reason: 'dependency-blocked' })
    }
  }

  const ordered = [...eligible.values()].sort((left, right) => left.id.localeCompare(right.id))
  let used = 0
  const contributions: ResolvedContribution[] = []
  for (const contribution of ordered) {
    const bytes = Buffer.byteLength(contribution.body, 'utf8')
    if (used + bytes > maxBytes) {
      issues.set(contribution.id, { id: contribution.id, reason: 'context-budget' })
      continue
    }
    used += bytes
    contributions.push({
      id: contribution.id,
      kind: contribution.kind,
      title: contribution.title,
      body: contribution.body,
      spaceId: contribution.spaceId,
    })
    if (!sources.includes(contribution.spaceId)) sources.push(contribution.spaceId)
  }
  return {
    contributions,
    issues: [...issues.values()].sort((left, right) => left.id.localeCompare(right.id)),
    cycles: [...cycles].sort(),
    excluded: [...excluded].sort(),
    sources,
  }
}
