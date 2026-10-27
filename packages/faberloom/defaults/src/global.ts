/**
 * The deployment-wide edition of the baseline agents.
 *
 * Every home seeds the baseline (`seeded`, no owner) under its own ids, so an
 * Admin/CEO edit of a baseline agent changes only that Admin's home. On a
 * deployment where every user home shares one disk, this module publishes a
 * privileged owner's edit to one shared file and applies the newest edition
 * there to every home's row of the same name. Global settings win: a
 * non-privileged owner cannot edit a baseline agent, and an edition with a newer
 * revision replaces what a home holds.
 *
 * The mail connections stay out of the shared edition: they name each user's
 * own mailboxes. The provider key travels with it, because a provider switch
 * without its key leaves every home unable to call the provider; each home
 * stores it in its own credential seam and never returns it on a read.
 * @module @deepseek-ai/dsh-faberloom-defaults/src/global
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FaberLoomAgent, FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'

/** The fields of a baseline agent the deployment-wide edition carries. */
const GLOBAL_FIELDS = [
  'responsibility', 'skills', 'tools', 'provider', 'model', 'webAccess', 'mwtMcp', 'sicopMcp', 'policy', 'active',
] as const

/** One published edition of a baseline agent. */
export interface GlobalAgentEdition {
  /** Monotonic revision; a home applies an edition newer than the one it holds. */
  readonly revision: number
  /** The shared settings, with connected agents named. */
  readonly settings: Record<string, unknown>
  /** The provider key of the edition, when the publisher holds one. */
  readonly apiKey?: string
  /** When the edition was published. */
  readonly updatedAt: string
  /** Who published it. */
  readonly by: string
}

/** What one home last published or applied for each name. */
interface HomeEntry {
  readonly revision: number
  readonly hash: string
}

/** The agents service and credential access one pass uses. */
export interface GlobalAgentPorts {
  /** Every agent of this home. */
  listAgents(): Promise<FaberLoomAgent[]>
  /** Patch one agent; an `apiKey` lands in the credential seam. */
  updateAgent(id: FaberLoomAgentId, patch: Record<string, unknown>): Promise<unknown>
  /** The stored provider key of one agent, when the composition can read it. */
  readKey(id: FaberLoomAgentId): Promise<string | undefined>
}

/** What one pass did, by agent name. */
export interface GlobalAgentReport {
  readonly published: readonly string[]
  readonly applied: readonly string[]
}

/**
 * Publish this home's privileged edits and apply newer editions.
 * @param ports - the agents service and key access of this home.
 * @param options - the shared file, this home's state file, and who acts.
 * @returns the names published and applied.
 */
export async function syncGlobalAgents(
  ports: GlobalAgentPorts,
  options: { readonly sharedFile: string; readonly stateFile: string; readonly privileged: boolean; readonly actor: string },
): Promise<GlobalAgentReport> {
  const shared = readJson(options.sharedFile)
  const editions = (typeof shared['agents'] === 'object' && shared['agents'] !== null ? shared['agents'] : {}) as Record<string, GlobalAgentEdition>
  const state = readJson(options.stateFile) as Record<string, HomeEntry>
  const agents = await ports.listAgents()
  const baseline = new Map<string, FaberLoomAgent>()
  for (const agent of agents) {
    if (!agent.seeded || agent.ownerId.length > 0) continue
    const current = baseline.get(agent.name)
    if (current === undefined || (agent.hasApiKey && !current.hasApiKey)) baseline.set(agent.name, agent)
  }
  const published: string[] = []
  const applied: string[] = []
  let sharedDirty = false
  for (const [name, agent] of baseline) {
    const key = await ports.readKey(agent.id)
    const local = project(agent)
    const localHash = digest(local, key)
    const held = state[name]
    const edition = editions[name]
    if (options.privileged && held !== undefined && held.hash !== localHash) {
      // This Admin edited the agent since the last pass: the edit becomes the
      // deployment's edition for every home.
      const revision = Math.max(edition?.revision ?? 0, held.revision) + 1
      editions[name] = {
        revision,
        settings: local,
        ...key === undefined ? {} : { apiKey: key },
        updatedAt: new Date().toISOString(),
        by: options.actor,
      }
      state[name] = { revision, hash: localHash }
      published.push(name)
      sharedDirty = true
      continue
    }
    if (edition !== undefined && (held === undefined || edition.revision > held.revision)) {
      await ports.updateAgent(agent.id, patchFor(edition, agents))
      const after = (await ports.listAgents()).find(candidate => candidate.id === agent.id) ?? agent
      state[name] = { revision: edition.revision, hash: digest(project(after), edition.apiKey ?? key) }
      applied.push(name)
      continue
    }
    if (held === undefined) state[name] = { revision: edition?.revision ?? 0, hash: localHash }
  }
  if (sharedDirty) writeJson(options.sharedFile, { version: 1, agents: editions })
  writeJson(options.stateFile, state)
  return { published, applied }
}

/** The shared settings of one agent, with connected agents named in a stable order. */
function project(agent: FaberLoomAgent): Record<string, unknown> {
  const record = agent as unknown as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const field of GLOBAL_FIELDS) {
    if (record[field] !== undefined) settings[field] = record[field]
  }
  settings['subagents'] = agent.subagents.map(entry => entry.name).sort()
  return settings
}

/** The agent patch that applies one edition, binding connected agents to this home's ids. */
function patchFor(edition: GlobalAgentEdition, agents: readonly FaberLoomAgent[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of GLOBAL_FIELDS) {
    if (field in edition.settings) patch[field] = edition.settings[field]
  }
  const named = Array.isArray(edition.settings['subagents']) ? edition.settings['subagents'] : []
  patch['subagents'] = named
    .filter((name): name is string => typeof name === 'string')
    .flatMap((name) => {
      const partner = agents.find(candidate => candidate.name === name && candidate.seeded && candidate.ownerId.length === 0)
        ?? agents.find(candidate => candidate.name === name)
      return partner === undefined ? [] : [{ name, agentId: partner.id }]
    })
  if (typeof edition.apiKey === 'string' && edition.apiKey.length > 0) patch['apiKey'] = edition.apiKey
  return patch
}

/** A digest of the settings and the key, so a key change counts as an edit. */
function digest(settings: Record<string, unknown>, key: string | undefined): string {
  return createHash('sha256').update(stable({ settings, key: key ?? null })).digest('hex')
}

/** JSON with object keys sorted, so equal values digest equally. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Read one JSON object file; an absent or malformed file reads as empty. */
function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    // A torn or foreign file is replaced by the next write; reading it as empty
    // only makes this pass record the current state.
    return {}
  }
}

/** Write one JSON file through a temporary file in the same directory. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
