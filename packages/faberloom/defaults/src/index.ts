/**
 * Native product defaults (`ctx.faberloomDefaults`): the agents and routines
 * FaberLoom seeds for a new owner, taken from the product plan and the screen
 * schemas. Seeding runs once per owner — the marker under the owner's home
 * prevents both duplicates and resurrection after a deletion — and only the
 * skills the owner's role actually ships are assigned to the seeded agents.
 *
 * Seeded routines stay `draft`: the owner activates them in the panel.
 * @module @deepseek-ai/dsh-faberloom-defaults
 */

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-faberloom-agents'
import type {} from '@deepseek-ai/dsh-faberloom-routines'
import { SEED_AGENTS, SEED_ROUTINES } from './catalog.ts'
import { PRESET_CURATION } from './preset-curation.ts'
import type { FaberLoomAgent, FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'

export type * from './catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomDefaults: FaberLoomDefaults
  }
}

/** Deployment-supplied identity and skill roots. */
export interface Config {
  /** The authenticated owner the defaults belong to; empty skips seeding. */
  ownerId?: string
  /** Console role whose shipped skills the seeded agents may use. */
  role?: string
  /** Read-only identities never seed. */
  readOnly?: boolean
  /** Root of the role skill catalogue, when the deployment mounts one. */
  skillsCatalogRoot?: string
  /** Root of the curated shared skill catalogue, when the deployment mounts one. */
  skillsSharedRoot?: string
  /** Root of the shared agent presets the deployment seeds for every owner. */
  agentsSharedRoot?: string
  /**
   * Provider every seeded agent runs on (for example `deepseek`). Empty keeps
   * the agent's own default.
   */
  agentProvider?: string
  /** Provider model id every seeded agent runs on (for example `deepseek-v4.1-flash`). */
  agentModel?: string
  /**
   * Name of the environment variable holding the provider API key the seeded
   * agents use. The key is read from the environment, never from configuration,
   * so it does not enter the repository; it is stored per agent and never
   * returned by a read.
   */
  agentApiKeyEnv?: string
}

/** Schemastery configuration for the defaults seeder. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  role: z.string(),
  readOnly: z.boolean(),
  skillsCatalogRoot: z.string(),
  skillsSharedRoot: z.string().default(''),
  agentsSharedRoot: z.string().default(''),
  agentProvider: z.string().default(''),
  agentModel: z.string().default(''),
  agentApiKeyEnv: z.string().default(''),
})

/** How long a claim left by a dead pass blocks the next one. */
const CLAIM_GRACE_MS = 10 * 60 * 1000

/** What one seeding pass did. */
export interface SeedReport {
  /** Whether this pass created anything. */
  readonly seeded: boolean
  /** Why a pass did nothing, when it did not. */
  readonly skipped: string | null
  /** Agents created in this pass. */
  readonly agents: readonly string[]
  /** Routines created in this pass. */
  readonly routines: readonly string[]
}

/** FaberLoom's own default agents and routines for one owner. */
export class FaberLoomDefaults extends Service {
  static inject = ['faberloomAgents', 'faberloomRoutines']

  private pending: Promise<SeedReport> | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - deployment-supplied identity and skill roots.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomDefaults')
    this.ctx.effect(() => {
      void this.seed().catch((error: unknown) => {
        this.ctx.logger.warn(`faberloom: defaults seeding failed: ${String(error)}`)
      })
      return () => {}
    }, 'faberloom.defaults.seed')
  }

  /**
   * Seed the catalogue once for this owner.
   *
   * A pass is a no-op when the identity is read-only, when it has no owner, or
   * when the marker exists. Items are matched by name, so a retry after a
   * partial pass never duplicates what already landed.
   * @returns what the pass created.
   */
  async seed(): Promise<SeedReport> {
    this.pending ??= this.run()
    return await this.pending
  }

  private async run(): Promise<SeedReport> {
    const ownerId = this.config.ownerId ?? ''
    if (this.config.readOnly === true) return { seeded: false, skipped: 'read-only identity', agents: [], routines: [] }
    if (ownerId.length === 0) return { seeded: false, skipped: 'no owner configured', agents: [], routines: [] }
    const available = new Set(this.availableSkills())
    // Shared agent presets are deployment-provided and re-synced on every start
    // (idempotent by name), independent of the one-time plan marker.
    const shared = await this.seedSharedAgents()
    await this.convergeBaselineAgents()
    const marker = this.markerPath()
    let report: SeedReport
    if (existsSync(marker)) {
      report = { seeded: shared.length > 0, skipped: 'already seeded', agents: shared, routines: [] }
    } else if (!this.claim()) {
      report = { seeded: shared.length > 0, skipped: 'another pass is seeding', agents: shared, routines: [] }
    } else {
      try {
        const agents = [...shared, ...await this.seedAgents(available)]
        const routines = await this.seedRoutines(ownerId)
        mkdirSync(this.dshHome(), { recursive: true })
        writeFileSync(marker, `${JSON.stringify({
          seededAt: new Date().toISOString(),
          role: this.config.role ?? '',
          agents,
          routines,
        }, null, 2)}\n`, 'utf8')
        this.ctx.logger.info(`faberloom: seeded ${String(agents.length)} agent(s) and ${String(routines.length)} routine(s) for ${ownerId}`)
        report = { seeded: agents.length > 0 || routines.length > 0, skipped: null, agents, routines }
      } finally {
        rmSync(this.claimPath(), { force: true })
      }
    }
    // Keep the native seeds current on every start, not just the seeding one.
    await this.reconcileNativeSeeds(available)
    return report
  }

  /**
   * Keep the native seed agents current on every start: merge the catalogue's
   * role-available skills into each, and connect its partners when it has none
   * of its own. Idempotent, so a restart adds what a newer catalogue brought.
   * @param available - the skill names the owner's role can use.
   */
  private async reconcileNativeSeeds(available: ReadonlySet<string>): Promise<void> {
    const byName = new Map<string, FaberLoomAgent>((await this.ctx.faberloomAgents.listAgents()).map(agent => [agent.name, agent]))
    for (const seed of SEED_AGENTS) {
      const agent = byName.get(seed.name)
      if (agent === undefined) continue
      const curated = seed.skills.filter(skill => available.has(skill))
      const merged = [...agent.skills, ...curated.filter(skill => !agent.skills.includes(skill))]
      if (merged.length !== agent.skills.length) await this.ctx.faberloomAgents.updateAgent(agent.id, { skills: merged })
      if (agent.subagents.length > 0) continue
      const subagents = seed.connects
        .map(partner => byName.get(partner))
        .filter((partner): partner is FaberLoomAgent => partner !== undefined)
        .map(partner => ({ name: partner.name, agentId: partner.id }))
      if (subagents.length > 0) await this.ctx.faberloomAgents.updateAgent(agent.id, { subagents })
    }
  }

  /**
   * Claim the right to seed this owner. Two deployments can start a process for
   * the same home at once, and their domains read before either flushes, so a
   * read-then-create check alone duplicates rows. The exclusive create decides
   * one winner; a claim left by a pass that died is cleared after
   * {@link CLAIM_GRACE_MS} so the next start retries.
   * @returns whether this pass may seed.
   */
  private claim(): boolean {
    try {
      const fd = openSync(this.claimPath(), 'wx')
      writeSync(fd, `${new Date().toISOString()}\n`)
      closeSync(fd)
      return true
    } catch (error: unknown) {
      if ((error as { readonly code?: string }).code !== 'EEXIST') throw error
      if (Date.now() - statSync(this.claimPath()).mtimeMs < CLAIM_GRACE_MS) return false
      this.ctx.logger.warn('faberloom: a stale seeding claim was cleared; the next start retries')
      rmSync(this.claimPath(), { force: true })
      return false
    }
  }

  /**
   * The provider, model, and API key every seeded agent gets. The key comes from
   * the environment variable the deployment named, so it never enters the
   * repository; a read never returns it.
   * @returns the configured fields, each omitted when unset.
   */
  private agentDefaults(): { provider?: string; model?: string; apiKey?: string } {
    const provider = this.config.agentProvider
    const model = this.config.agentModel
    const envName = this.config.agentApiKeyEnv
    const apiKey = envName === undefined || envName.length === 0 ? undefined : process.env[envName]
    return {
      ...provider === undefined || provider.length === 0 ? {} : { provider },
      ...model === undefined || model.length === 0 ? {} : { model },
      ...apiKey === undefined || apiKey.length === 0 ? {} : { apiKey },
    }
  }

  /**
   * Set the configured provider, model, and API key on the deployment's baseline
   * agents — the native seeds and the shared presets. The deployment owns the
   * baseline, so its provider and model are authoritative and replace an earlier
   * value; a user's own agents are untouched. The key is only written when none
   * is stored, since a stored key can never be read back to compare. Runs on
   * every start, so agents a previous deployment seeded converge in place.
   * @returns the baseline agent names updated in this pass.
   */
  private async convergeBaselineAgents(): Promise<string[]> {
    const defaults = this.agentDefaults()
    if (defaults.provider === undefined && defaults.model === undefined && defaults.apiKey === undefined) return []
    const baseline = this.baselineNames()
    const updated: string[] = []
    for (const agent of await this.ctx.faberloomAgents.listAgents()) {
      if (!baseline.has(agent.name)) continue
      const patch: { provider?: string; model?: string; apiKey?: string } = {}
      if (defaults.provider !== undefined && agent.provider !== defaults.provider) patch.provider = defaults.provider
      if (defaults.model !== undefined && agent.model !== defaults.model) patch.model = defaults.model
      if (defaults.apiKey !== undefined && !agent.hasApiKey) patch.apiKey = defaults.apiKey
      if (patch.provider === undefined && patch.model === undefined && patch.apiKey === undefined) continue
      await this.ctx.faberloomAgents.updateAgent(agent.id, patch)
      updated.push(agent.name)
    }
    if (updated.length > 0) this.ctx.logger.info(`faberloom: configured ${String(updated.length)} baseline agent(s)`)
    return updated
  }

  /**
   * Names of the deployment's baseline agents: the native seeds plus every
   * shared preset the deployment mounts.
   * @returns the baseline names, matched against the catalogue by name.
   */
  private baselineNames(): Set<string> {
    const names = new Set<string>(SEED_AGENTS.map(seed => seed.name))
    const root = this.config.agentsSharedRoot
    if (root === undefined || root.length === 0 || !existsSync(root)) return names
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const preset = this.readPreset(join(root, entry.name, 'preset.yml'))
      if (preset !== undefined) names.add(preset.name)
    }
    return names
  }

  private async seedAgents(available: ReadonlySet<string>): Promise<string[]> {
    const existing = new Set((await this.ctx.faberloomAgents.listAgents()).map(agent => agent.name))
    const created: string[] = []
    for (const seed of SEED_AGENTS) {
      if (existing.has(seed.name)) continue
      await this.ctx.faberloomAgents.createAgent({
        name: seed.name,
        responsibility: seed.responsibility,
        origin: 'scratch',
        seeded: true,
        skills: seed.skills.filter(skill => available.has(skill)),
        ...this.agentDefaults(),
      })
      created.push(seed.name)
    }
    return created
  }

  private async seedRoutines(ownerId: string): Promise<string[]> {
    const existing = new Set((await this.ctx.faberloomRoutines.listRoutines(ownerId)).map(routine => routine.name))
    const created: string[] = []
    for (const seed of SEED_ROUTINES) {
      if (existing.has(seed.name)) continue
      await this.ctx.faberloomRoutines.createRoutine(ownerId, {
        name: seed.name,
        definition: {
          intent: seed.intent,
          triggers: [{ kind: seed.trigger.kind, ...seed.trigger.match === undefined ? {} : { match: seed.trigger.match } }],
          steps: seed.steps.map(step => ({
            id: step.id,
            instruction: step.instruction,
            handler: step.handler,
            dependsOn: [...step.dependsOn],
            ...step.waitFor === undefined ? {} : { waitFor: step.waitFor },
            ...step.effect === undefined ? {} : { effect: step.effect },
          })),
          expectedResult: seed.expectedResult,
          permissions: [...seed.permissions],
          failurePolicy: seed.failurePolicy,
        },
      })
      created.push(seed.name)
    }
    return created
  }

  /**
   * Create the deployment's shared agent presets for this owner. Idempotent by
   * name, so a restart adds new presets without duplicating existing agents.
   * @returns the names created in this pass.
   */
  private async seedSharedAgents(): Promise<string[]> {
    const root = this.config.agentsSharedRoot
    if (root === undefined || root.length === 0 || !existsSync(root)) return []
    const available = new Set(this.availableSkills())
    const existing = await this.ctx.faberloomAgents.listAgents()
    const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
    const byDir = new Map<string, { id: FaberLoomAgentId; name: string; connected: boolean }>()
    const created: string[] = []
    for (const entry of directories) {
      const preset = this.readPreset(join(root, entry.name, 'preset.yml'))
      if (preset === undefined) continue
      const curated = (PRESET_CURATION[entry.name]?.skills ?? []).filter(skill => available.has(skill))
      const found = existing.find(agent => agent.name === preset.name)
      if (found !== undefined) {
        byDir.set(entry.name, { id: found.id, name: found.name, connected: found.subagents.length > 0 })
        // An earlier deployment seeded this before the curation existed: add the
        // curated skills it is still missing, keeping whatever it already has.
        const merged = [...found.skills, ...curated.filter(skill => !found.skills.includes(skill))]
        if (merged.length !== found.skills.length) {
          await this.ctx.faberloomAgents.updateAgent(found.id, { skills: merged })
        }
        continue
      }
      const agent = await this.ctx.faberloomAgents.createAgent({
        name: preset.name, responsibility: preset.description, origin: 'scratch', seeded: true, skills: curated,
        ...this.agentDefaults(),
      })
      byDir.set(entry.name, { id: agent.id, name: agent.name, connected: false })
      created.push(preset.name)
    }
    // Second pass: connect each preset's curated partners that are present, by
    // name, unless the agent already declares its own connections.
    for (const entry of directories) {
      const self = byDir.get(entry.name)
      if (self === undefined || self.connected) continue
      const subagents = (PRESET_CURATION[entry.name]?.connects ?? [])
        .map(partner => byDir.get(partner))
        .filter((partner): partner is { id: FaberLoomAgentId; name: string; connected: boolean } => partner !== undefined)
        .map(partner => ({ name: partner.name, agentId: partner.id }))
      if (subagents.length === 0) continue
      await this.ctx.faberloomAgents.updateAgent(self.id, { subagents })
    }
    return created
  }

  /**
   * Read one shared preset's display name and description.
   * @param file - the preset's `preset.yml` path.
   * @returns the name and description, or undefined when the file is absent or unnamed.
   */
  private readPreset(file: string): { name: string; description: string } | undefined {
    if (!existsSync(file)) return undefined
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { return undefined }
    const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
    if (name.length === 0) return undefined
    const raw = (/^description:\s*(.+)$/m.exec(text)?.[1] ?? '').trim()
    let description = raw
    if (raw.startsWith('"')) {
      try { description = String(JSON.parse(raw)) } catch { description = raw }
    }
    return { name, description: description.length > 0 ? description : `Especialista ${name}.` }
  }

  /** Skill names the owner can use: their own uploads, the role catalogue, and the shared catalogue. */
  private availableSkills(): string[] {
    const names: string[] = []
    for (const root of [join(this.dshHome(), 'skills'), this.roleSkillsDir(), this.sharedSkillsDir()]) {
      if (root === undefined || !existsSync(root)) continue
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md'))) names.push(entry.name)
      }
    }
    return names
  }

  /** The curated shared skill catalogue the deployment mounts, when it mounts one. */
  private sharedSkillsDir(): string | undefined {
    const root = this.config.skillsSharedRoot
    return root === undefined || root.length === 0 ? undefined : root
  }

  /** The role's skill catalog directory, when the deployment mounted one. */
  private roleSkillsDir(): string | undefined {
    const root = this.config.skillsCatalogRoot
    const role = (this.config.role ?? '').toLowerCase()
    if (root === undefined || root.length === 0 || role.length === 0) return undefined
    return join(root, role)
  }

  private dshHome(): string {
    const home = process.env.DSH_HOME
    return home === undefined || home.length === 0 ? join(homedir(), '.dsh') : home
  }

  /** Marker file recording that this owner was seeded. */
  private markerPath(): string {
    return join(this.dshHome(), 'faberloom-defaults.json')
  }

  /** Claim file a running pass holds. */
  private claimPath(): string {
    return join(this.dshHome(), 'faberloom-defaults.claim')
  }
}

export default FaberLoomDefaults
