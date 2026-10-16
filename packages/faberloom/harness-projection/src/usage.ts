/**
 * Reading the product records of one scope. The traversal walks the same
 * untyped storage-domain surface `faberloom-backup` and `faberloom-mirror`
 * walk — a declared domain name and its table names — so a domain this process
 * does not hold open is reported instead of read as empty. Records are
 * validated as they are read: the durable medium is a boundary, and a row
 * written by an older build must not reach a generated file unchecked.
 * @module @deepseek-ai/dsh-faberloom-harness-projection/src/usage
 */

import type {
  HarnessAgentUsage,
  HarnessContextUsage,
  HarnessMemoryUsage,
  HarnessRoutineUsage,
  HarnessScope,
  HarnessSkillUsage,
  HarnessUsage,
  HarnessWorkflowUsage,
} from './types.ts'

/** The product domains one projection reads, in traversal order. */
export const HARNESS_PROJECTION_DOMAINS: readonly string[] = [
  'faberloom_spaces',
  'faberloom_agents',
  'faberloom_workflows',
  'faberloom_routines',
  'faberloom_memory',
  'faberloom_context',
]

/** A skill name the shipped skill grammar accepts. */
export const HARNESS_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One declared table as this traversal reaches it. */
export interface HarnessTableView {
  /** Snapshot iterator over the table's `[key, record]` pairs. */
  entries(): IterableIterator<[string, unknown]>
}

/** One open domain as this traversal reaches it. */
export interface HarnessDomainView {
  /** One declared table handle. */
  table(name: string): HarnessTableView
}

/**
 * The storage-domain facility as this traversal reads it: `get` returns the
 * open handle of a declared domain, or undefined when this process did not
 * open it. The projection never opens a domain itself, so an unwired product
 * service reads as unreadable rather than as an empty scope.
 */
export interface HarnessDomainSource {
  /** One open domain, or undefined when this process did not mount it. */
  get(name: string): HarnessDomainView | undefined
}

/** The skill registry as this traversal reads it. */
export interface HarnessSkillLookup {
  /**
   * Load one skill by name.
   * @param name - kebab-case skill name.
   * @param options - lookup options; the projection passes no workspace.
   * @returns the skill, or undefined when no provider resolves it.
   */
  get(
    name: string,
    options: { readonly cwd?: string | undefined },
  ): Promise<{ readonly name: string; readonly description: string; readonly content: string } | undefined>
}

/** One stored Space as the projection reads it. */
export interface HarnessSpaceView {
  /** Stable space id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** The agent in charge of the Space, or null when none is assigned. */
  readonly agentId: string | null
  /** The Workspace this Space mirrors, or null for a Space outside a Workspace. */
  readonly workspaceId: string | null
  /** ISO-8601 creation instant, which breaks the tie when two Spaces mirror one Workspace. */
  readonly createdAt: string
}

/**
 * What the scope resolved to in the Space records: the mirrored Space, no
 * Space at all, or a domain this process cannot read.
 */
export type HarnessScopeSpace =
  | { readonly kind: 'found'; readonly space: HarnessSpaceView }
  | { readonly kind: 'absent' }
  | { readonly kind: 'projectionless' }
  | { readonly kind: 'unreadable' }

/** Whether a value is a plain record read from a durable medium. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one field of a durable record as a string.
 * @param record - the record read from the medium.
 * @param field - the field name.
 * @param fallback - the value used when the field is absent or not a string.
 * @returns the field value or its fallback.
 */
function text(record: Record<string, unknown>, field: string, fallback: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : fallback
}

/**
 * Read one field of a durable record as a nullable string.
 * @param record - the record read from the medium.
 * @param field - the field name.
 * @returns the string, or undefined when the field is absent or not a string.
 */
function optionalText(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read one field of a durable record as a string list, dropping non-strings.
 * @param record - the record read from the medium.
 * @param field - the field name.
 * @returns the string entries of the field, or an empty list.
 */
function textList(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Read the declared table of one domain, or undefined when the domain is not
 * open or does not expose that table.
 * @param source - the storage-domain facility.
 * @param domain - declared domain name.
 * @param table - declared table name.
 * @returns the table handle, or undefined.
 */
function tableView(source: HarnessDomainSource, domain: string, table: string): HarnessTableView | undefined {
  const live = source.get(domain)
  if (live === undefined) return undefined
  try {
    return live.table(table)
  } catch {
    // A domain this build opened without that table cannot answer this read,
    // which is the same answer as a domain this process never opened.
    return undefined
  }
}

/**
 * Read every record of one domain table, or undefined when the table is not
 * reachable in this process.
 * @param source - the storage-domain facility.
 * @param domain - declared domain name.
 * @param table - declared table name.
 * @returns the `[key, record]` pairs, or undefined.
 */
function rows(source: HarnessDomainSource, domain: string, table: string): [string, Record<string, unknown>][] | undefined {
  const handle = tableView(source, domain, table)
  if (handle === undefined) return undefined
  const out: [string, Record<string, unknown>][] = []
  for (const [key, value] of handle.entries()) {
    if (isRecord(value)) out.push([key, value])
  }
  return out
}

/**
 * Resolve the product Space one scope addresses: the named Space for a Space
 * scope, or the Space mirroring the named Workspace for a Workspace scope. Two
 * Spaces mirroring one Workspace resolve to the oldest, then the lowest id, so
 * a repeated call names the same record; `faberloom-view` resolves the same
 * pair the same way.
 * @param source - the storage-domain facility.
 * @param scope - the scope to resolve.
 * @returns the mirrored Space, or why none could be resolved.
 */
export function resolveScopeSpace(source: HarnessDomainSource, scope: HarnessScope): HarnessScopeSpace {
  const table = rows(source, 'faberloom_spaces', 'spaces')
  if (table === undefined) return { kind: 'unreadable' }
  const mapped = table
    .map(([id, record]) => ({
      id,
      title: text(record, 'title', ''),
      agentId: optionalText(record, 'agentId') ?? null,
      workspaceId: optionalText(record, 'workspaceId') ?? null,
      createdAt: text(record, 'createdAt', ''),
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  if (scope.kind === 'space') {
    const id = String(scope.id)
    const found = mapped.find(space => space.id === id)
    return found === undefined ? { kind: 'absent' } : { kind: 'found', space: found }
  }
  const workspaceId = String(scope.id)
  const mirrored = mapped.find(space => space.workspaceId === workspaceId)
  return mirrored === undefined ? { kind: 'projectionless' } : { kind: 'found', space: mirrored }
}

/**
 * Read the agent rows one Space registers: the agents the catalog stores under
 * the Space, plus the Space's responsible agent. An agent the catalog marks
 * inactive is left out: it cannot run in the scope, so it is not part of the
 * scope's harness. `faberloom_agents` stores no per-session use, and its
 * `selections` and `outcomes` rows carry no scope at all, so this set is the
 * scope's registered agents, not a call history.
 * @param source - the storage-domain facility.
 * @param space - the Space to read agents for.
 * @param unreadable - collects the domains that could not be read.
 * @returns the agents, ordered by name then id.
 */
function readAgents(
  source: HarnessDomainSource,
  space: HarnessSpaceView,
  unreadable: string[],
): HarnessAgentUsage[] {
  const table = rows(source, 'faberloom_agents', 'agents')
  if (table === undefined) {
    unreadable.push('faberloom_agents')
    return []
  }
  const agents: HarnessAgentUsage[] = []
  for (const [id, record] of table) {
    if (record['active'] !== true) continue
    const spaceId = optionalText(record, 'spaceId')
    if (spaceId !== space.id && space.agentId !== id) continue
    agents.push({
      id,
      name: text(record, 'name', id),
      responsibility: text(record, 'responsibility', ''),
      provider: optionalText(record, 'provider'),
      model: optionalText(record, 'model'),
      skills: textList(record, 'skills'),
    })
  }
  return agents.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

/**
 * Resolve every skill the scope's agents declare through the skill registry.
 * A declared name no provider resolves, or one the shipped skill grammar
 * refuses, is reported in `unresolvedSkills`: a name is never written to a
 * directory it could escape.
 * @param lookup - the skill registry, or undefined when no provider is mounted.
 * @param agents - the scope's agents.
 * @returns the resolved skills and the declared names that did not resolve.
 */
async function readSkills(
  lookup: HarnessSkillLookup | undefined,
  agents: readonly HarnessAgentUsage[],
): Promise<{ skills: HarnessSkillUsage[]; unresolvedSkills: string[] }> {
  const declared = new Set<string>()
  for (const agent of agents) for (const name of agent.skills) declared.add(name)
  const names = [...declared].sort()
  if (lookup === undefined) return { skills: [], unresolvedSkills: names }
  const skills: HarnessSkillUsage[] = []
  const unresolvedSkills: string[] = []
  for (const name of names) {
    if (!HARNESS_SKILL_NAME.test(name)) {
      unresolvedSkills.push(name)
      continue
    }
    const found = await lookup.get(name, {})
    if (found === undefined) unresolvedSkills.push(name)
    else skills.push({ name: found.name, description: found.description, content: found.content })
  }
  return { skills, unresolvedSkills }
}

/**
 * Read everything the records of one scope register. A domain this process
 * does not hold open contributes nothing and is named in
 * `unreadableDomains`; a Space scope whose Space is absent from an open
 * `faberloom_spaces` domain throws, because that is a missing referent rather
 * than an unreachable medium.
 * @param source - the storage-domain facility.
 * @param scope - the scope to read.
 * @param lookup - the skill registry, or undefined when no provider is mounted.
 * @returns the scope's agents, skills, work flows, routines, memory, and context.
 * @throws when a Space scope names a Space the open spaces domain does not hold.
 */
export async function readScopeUsage(
  source: HarnessDomainSource,
  scope: HarnessScope,
  lookup?: HarnessSkillLookup,
): Promise<HarnessUsage> {
  const resolved = resolveScopeSpace(source, scope)
  if (resolved.kind === 'absent') throw new Error(`faberloom: space ${String(scope.id)} is not registered`)
  const unreadableDomains: string[] = []
  if (resolved.kind === 'unreadable') unreadableDomains.push('faberloom_spaces')
  const space = resolved.kind === 'found' ? resolved.space : undefined
  const usage: HarnessUsage = {
    spaceId: space?.id,
    agents: space === undefined ? [] : readAgents(source, space, unreadableDomains),
    skills: [],
    unresolvedSkills: [],
    workflows: space === undefined ? [] : readWorkflows(source, space, unreadableDomains),
    routines: space === undefined ? [] : readRoutines(source, space, unreadableDomains),
    memory: space === undefined ? [] : readMemory(source, space, unreadableDomains),
    context: space === undefined ? [] : readContext(source, space, unreadableDomains),
    unreadableDomains,
  }
  const skills = await readSkills(lookup, usage.agents)
  return { ...usage, skills: skills.skills, unresolvedSkills: skills.unresolvedSkills }
}

/**
 * Read the work flows one Space scopes: a flow stores its scope as a
 * discriminated pair, so only a `space` scope names this Space.
 * @param source - the storage-domain facility.
 * @param space - the Space to read flows for.
 * @param unreadable - collects the domains that could not be read.
 * @returns the flows, ordered by name then id.
 */
function readWorkflows(
  source: HarnessDomainSource,
  space: HarnessSpaceView,
  unreadable: string[],
): HarnessWorkflowUsage[] {
  const table = rows(source, 'faberloom_workflows', 'workflows')
  if (table === undefined) {
    unreadable.push('faberloom_workflows')
    return []
  }
  const workflows: HarnessWorkflowUsage[] = []
  for (const [id, record] of table) {
    const scope = record['scope']
    if (!isRecord(scope) || scope['kind'] !== 'space' || scope['spaceId'] !== space.id) continue
    workflows.push({ id, name: text(record, 'name', id), status: text(record, 'status', '') })
  }
  return workflows.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

/**
 * Read the routines one Space owns. A routine stores its Space as a plain
 * field, so a routine with no Space, or another Space, is not part of this
 * scope.
 * @param source - the storage-domain facility.
 * @param space - the Space to read routines for.
 * @param unreadable - collects the domains that could not be read.
 * @returns the routines, ordered by name then id.
 */
function readRoutines(source: HarnessDomainSource, space: HarnessSpaceView, unreadable: string[]): HarnessRoutineUsage[] {
  const table = rows(source, 'faberloom_routines', 'routines')
  if (table === undefined) {
    unreadable.push('faberloom_routines')
    return []
  }
  const routines: HarnessRoutineUsage[] = []
  for (const [id, record] of table) {
    if (optionalText(record, 'spaceId') !== space.id) continue
    routines.push({ id, name: text(record, 'name', id), status: text(record, 'status', '') })
  }
  return routines.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

/**
 * Read the memory one Space carries: the entries attached to it in the spaces
 * domain, and the active teachings scoped to it in the memory domain. A
 * teaching with another scope — a global or agent one — carries no Space and
 * is left out, because the projection includes only what the scope owns.
 * @param source - the storage-domain facility.
 * @param space - the Space to read memory for.
 * @param unreadable - collects the domains that could not be read.
 * @returns the memory entries, ordered by source then id.
 */
function readMemory(source: HarnessDomainSource, space: HarnessSpaceView, unreadable: string[]): HarnessMemoryUsage[] {
  const memory: HarnessMemoryUsage[] = []
  const captured = rows(source, 'faberloom_spaces', 'memory')
  if (captured === undefined) unreadable.push('faberloom_spaces.memory')
  else {
    for (const [id, record] of captured) {
      if (!textList(record, 'spaceIds').includes(space.id)) continue
      memory.push({ id, text: text(record, 'text', ''), source: 'space' })
    }
  }
  const teachings = rows(source, 'faberloom_memory', 'teachings')
  if (teachings === undefined) unreadable.push('faberloom_memory')
  else {
    for (const [id, record] of teachings) {
      if (record['scope'] !== 'space' || optionalText(record, 'spaceId') !== space.id) continue
      if (record['status'] !== 'active') continue
      memory.push({ id, text: text(record, 'text', ''), source: 'teaching' })
    }
  }
  return memory.sort((left, right) => left.source.localeCompare(right.source) || left.id.localeCompare(right.id))
}

/**
 * Read the curated context entries of one Space. An entry staged by the
 * console is part of the Space's context, so no visibility filters it out; a
 * personal entry carries no Space and is excluded.
 * @param source - the storage-domain facility.
 * @param space - the Space to read context for.
 * @param unreadable - collects the domains that could not be read.
 * @returns the entries, ordered by title then id.
 */
function readContext(source: HarnessDomainSource, space: HarnessSpaceView, unreadable: string[]): HarnessContextUsage[] {
  const table = rows(source, 'faberloom_context', 'entries')
  if (table === undefined) {
    unreadable.push('faberloom_context')
    return []
  }
  const context: HarnessContextUsage[] = []
  for (const [id, record] of table) {
    if (optionalText(record, 'spaceId') !== space.id) continue
    context.push({ id, title: text(record, 'title', id) })
  }
  return context.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
}
