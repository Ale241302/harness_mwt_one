/**
 * The deployment baseline agents as one owner's homes share them.
 *
 * Every home seeds the baseline (`seeded`, no owner) under its own ids, so the
 * `agents` rows of the baseline stay local: carrying them by id gave each home a
 * second row of every name. What the owner edits on one of them — the provider,
 * the model, the mail connections, the skills — must still reach the owner's
 * other home. This module exposes those settings as the virtual `baseline`
 * table of `faberloom_agents`, keyed by agent name: reading it projects each
 * local baseline row to its owner-editable fields, and writing it patches the
 * local row of that name. The mirror's row journal then decides the direction
 * exactly as it does for every other row.
 *
 * The provider API key travels in the same row, because a provider switch
 * without its key leaves the agent unable to call the provider. It lives in the
 * credential seam on both sides, never in the `agents` row; the store preloads
 * the keys it can read so the table answers synchronously.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/baseline
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

/** Domain holding the agent rows. */
export const BASELINE_DOMAIN = 'faberloom_agents'
/** The real table of agent rows. */
export const BASELINE_SOURCE_TABLE = 'agents'
/** The virtual table of baseline settings, keyed by agent name. */
export const BASELINE_TABLE = 'baseline'

/**
 * The fields of a baseline agent its owner edits and both homes share. Ids,
 * timestamps, the Space binding, and the seeding marks are home-local.
 */
const SHARED_FIELDS = [
  'responsibility', 'skills', 'tools', 'provider', 'model', 'webAccess', 'mwtMcp', 'sicopMcp',
  'mailConnectionIds', 'policy', 'lessons', 'active',
] as const

/** Reads and writes the provider key of one agent in the credential seam. */
export interface BaselineSecrets {
  /**
   * @param agentId - the local agent id.
   * @returns the stored key, or undefined when none is stored.
   */
  read(agentId: string): Promise<string | undefined>
  /**
   * @param agentId - the local agent id.
   * @param key - the key to store.
   */
  write(agentId: string, key: string): Promise<void>
}

/**
 * Whether one agent row is part of the deployment baseline of this home.
 * @param value - the stored agent row.
 * @returns true for a seeded row without an owner.
 */
export function isBaselineAgent(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record['seeded'] === true && (typeof record['ownerId'] !== 'string' || record['ownerId'].length === 0)
}

/**
 * The local baseline row for each name. Two seeded rows of one name are a
 * transient state the defaults seeder collapses; until then the row holding a
 * key, then the oldest, answers for the name.
 * @param agents - the real agent table.
 * @returns name to `[id, row]`.
 */
export function baselineByName(agents: KvTable<string, unknown>): Map<string, [string, Record<string, unknown>]> {
  const byName = new Map<string, [string, Record<string, unknown>]>()
  for (const [id, value] of agents.entries()) {
    if (!isBaselineAgent(value)) continue
    const name = value['name']
    if (typeof name !== 'string' || name.length === 0) continue
    const current = byName.get(name)
    if (current === undefined || prefer(value, current[1])) byName.set(name, [id, value])
  }
  return byName
}

/** Whether `candidate` should answer for a name instead of `current`. */
function prefer(candidate: Record<string, unknown>, current: Record<string, unknown>): boolean {
  if ((candidate['hasApiKey'] === true) !== (current['hasApiKey'] === true)) return candidate['hasApiKey'] === true
  return String(candidate['createdAt'] ?? '') < String(current['createdAt'] ?? '')
}

/**
 * The virtual table over one home's agent rows. `get`, `entries`, and `keys`
 * project the baseline rows; `put` patches the local row of the name and stores
 * the key; `delete` never removes a baseline agent, since each home seeds and
 * owns its rows.
 */
export class BaselineAgentTable implements KvTable<string, unknown> {
  /**
   * @param agents - the real agent table of this home.
   * @param secretCache - the preloaded provider keys by local agent id.
   * @param secrets - the credential seam, when this process mounts one.
   */
  constructor(
    private readonly agents: KvTable<string, unknown>,
    private readonly secretCache: Map<string, string>,
    private readonly secrets: BaselineSecrets | undefined,
  ) {}

  /** @param name - agent name. @returns the shared settings, or undefined when this home has no such baseline agent. */
  get(name: string): unknown {
    const found = baselineByName(this.agents).get(name)
    return found === undefined ? undefined : this.project(found[0], found[1])
  }

  /** @returns a snapshot iterator over the shared settings by name. */
  entries(): IterableIterator<[string, unknown]> {
    const rows = new Map<string, unknown>()
    for (const [name, [id, row]] of baselineByName(this.agents)) rows.set(name, this.project(id, row))
    return rows.entries()
  }

  /** @returns a snapshot iterator over the baseline names. */
  keys(): IterableIterator<string> {
    return new Map(baselineByName(this.agents)).keys()
  }

  /** @returns the baseline agent count. */
  get size(): number {
    return baselineByName(this.agents).size
  }

  /**
   * Patch the local baseline row of one name with the peer's settings. A name
   * this home has not seeded is ignored: the seeder creates it, and the next
   * cycle carries the settings.
   * @param name - agent name.
   * @param value - the peer's shared settings.
   */
  async put(name: string, value: unknown): Promise<void> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return
    const byName = baselineByName(this.agents)
    const found = byName.get(name)
    if (found === undefined) return
    const [id, row] = found
    const settings = value as Record<string, unknown>
    const next: Record<string, unknown> = { ...row }
    for (const field of SHARED_FIELDS) {
      if (field in settings) next[field] = settings[field]
    }
    if (Array.isArray(settings['subagents'])) {
      // Connected agents are named on the wire; each home binds them to its own ids.
      next['subagents'] = settings['subagents']
        .filter((entry): entry is string => typeof entry === 'string')
        .flatMap((partner) => {
          const local = byName.get(partner) ?? findByName(this.agents, partner)
          return local === undefined ? [] : [{ name: partner, agentId: local[0] }]
        })
    }
    const key = settings['apiKey']
    if (typeof key === 'string' && key.length > 0 && this.secrets !== undefined && this.secretCache.get(id) !== key) {
      try {
        await this.secrets.write(id, key)
        this.secretCache.set(id, key)
        next['hasApiKey'] = true
        next['apiKeyTail'] = key.slice(-4)
      } catch {
        // A seam that refuses the key leaves this home's key as it was; the
        // settings still land, and the differing projection retries next cycle.
      }
    }
    next['version'] = typeof row['version'] === 'number' ? row['version'] + 1 : 1
    next['updatedAt'] = new Date().toISOString()
    await this.agents.put(id, next)
  }

  /** A baseline agent is never removed by its peer. @returns false. */
  async delete(_name: string): Promise<boolean> {
    return false
  }

  /** Read-modify-write is not part of the mirror's use of this table. */
  async update(name: string, change: (current: unknown) => unknown): Promise<unknown> {
    const next = change(this.get(name))
    await this.put(name, next)
    return next
  }

  /** The shared settings of one row, with connected agents named and the key when this side holds one. */
  private project(id: string, row: Record<string, unknown>): Record<string, unknown> {
    const settings: Record<string, unknown> = {}
    for (const field of SHARED_FIELDS) {
      if (row[field] !== undefined) settings[field] = row[field]
    }
    const subagents = Array.isArray(row['subagents']) ? row['subagents'] : []
    settings['subagents'] = subagents
      .map(entry => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['name'] : undefined))
      .filter((name): name is string => typeof name === 'string')
      .sort()
    const key = this.secretCache.get(id)
    if (key !== undefined) settings['apiKey'] = key
    return settings
  }
}

/** Any agent row of one name (a user's own agent can be connected too). */
function findByName(agents: KvTable<string, unknown>, name: string): [string, unknown] | undefined {
  for (const [id, value] of agents.entries()) {
    if (typeof value === 'object' && value !== null && (value as Record<string, unknown>)['name'] === name) return [id, value]
  }
  return undefined
}

/**
 * Read the provider key of every baseline agent this home holds.
 * @param agents - the real agent table.
 * @param secrets - the credential seam.
 * @returns keys by local agent id.
 */
export async function preloadBaselineKeys(agents: KvTable<string, unknown>, secrets: BaselineSecrets): Promise<Map<string, string>> {
  const keys = new Map<string, string>()
  for (const [id] of baselineByName(agents).values()) {
    const key = await secrets.read(id)
    if (key !== undefined && key.length > 0) keys.set(id, key)
  }
  return keys
}
