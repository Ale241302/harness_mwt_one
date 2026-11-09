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
  /** Whether the caller authorized this contribution; a Space-level read decides it before the resolver runs. */
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
  /** Current child revision the consumer bases the new revision on. */
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
  /** Space ids that contributed material, in contribution id order. */
  readonly sources: readonly string[]
}

/** Options for one resolution. */
export interface ResolveContributionsOptions {
  /** Ids the child explicitly excludes: a Space hides its context, or one contribution id. */
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
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError('faberloom: context budget must be a finite non-negative byte count')
  }
  const eligible = new Map<string, SpaceContribution>()
  const issues = new Map<string, ContributionIssue>()
  for (const candidate of candidates) {
    // An exclusion names either one contribution or a whole Space; a Space id
    // excludes every context contribution that Space owns. Memory is an explicit
    // capture, so it survives a Space exclusion while the Space is readable.
    if (excluded.has(candidate.id)) continue
    if (candidate.kind !== 'memory' && excluded.has(candidate.spaceId)) continue
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
    // The child's contribution wins a name conflict. An ancestor cannot erase a
    // root contribution by reusing its title; two root contributions with the
    // same title remain an unresolved conflict.
    const roots = ids.filter(id => eligible.get(id)?.spaceId === rootId)
    if (roots.length === 1) {
      for (const id of ids) {
        if (id === roots[0]) continue
        eligible.delete(id)
        issues.set(id, { id, reason: 'name-conflict' })
      }
      continue
    }
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
  const dependencies = new Map<string, readonly string[]>()
  for (const contribution of ordered) {
    const bytes = Buffer.byteLength(contribution.body, 'utf8')
    if (used + bytes > maxBytes) {
      issues.set(contribution.id, { id: contribution.id, reason: 'context-budget' })
      continue
    }
    used += bytes
    dependencies.set(contribution.id, contribution.dependsOn ?? [])
    contributions.push({
      id: contribution.id,
      kind: contribution.kind,
      title: contribution.title,
      body: contribution.body,
      spaceId: contribution.spaceId,
    })
  }
  // The budget can remove a dependency after its dependents were admitted.
  // Re-close the graph until no admitted contribution misses a dependency.
  let changedAfterBudget = true
  while (changedAfterBudget) {
    changedAfterBudget = false
    const admitted = new Set(contributions.map(contribution => contribution.id))
    for (let index = contributions.length - 1; index >= 0; index -= 1) {
      const contribution = contributions[index]
      if (contribution === undefined) continue
      if (!(dependencies.get(contribution.id) ?? []).some(dependency => !admitted.has(dependency))) continue
      contributions.splice(index, 1)
      issues.set(contribution.id, { id: contribution.id, reason: 'dependency-blocked' })
      changedAfterBudget = true
    }
  }
  const sources: string[] = []
  for (const contribution of contributions) {
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
