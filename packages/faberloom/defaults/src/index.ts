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

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-faberloom-agents'
import type {} from '@deepseek-ai/dsh-faberloom-routines'
import { SEED_AGENTS, SEED_ROUTINES } from './catalog.ts'

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
}

/** Schemastery configuration for the defaults seeder. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  role: z.string(),
  readOnly: z.boolean(),
  skillsCatalogRoot: z.string(),
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
    const marker = this.markerPath()
    if (existsSync(marker)) return { seeded: false, skipped: 'already seeded', agents: [], routines: [] }
    if (!this.claim()) return { seeded: false, skipped: 'another pass is seeding', agents: [], routines: [] }

    try {
      const available = new Set(this.availableSkills())
      const agents = await this.seedAgents(available)
      const routines = await this.seedRoutines(ownerId)
      mkdirSync(this.dshHome(), { recursive: true })
      writeFileSync(marker, `${JSON.stringify({
        seededAt: new Date().toISOString(),
        role: this.config.role ?? '',
        agents,
        routines,
      }, null, 2)}\n`, 'utf8')
      this.ctx.logger.info(`faberloom: seeded ${String(agents.length)} agent(s) and ${String(routines.length)} routine(s) for ${ownerId}`)
      return { seeded: agents.length > 0 || routines.length > 0, skipped: null, agents, routines }
    } finally {
      rmSync(this.claimPath(), { force: true })
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

  private async seedAgents(available: ReadonlySet<string>): Promise<string[]> {
    const existing = new Set((await this.ctx.faberloomAgents.listAgents()).map(agent => agent.name))
    const created: string[] = []
    for (const seed of SEED_AGENTS) {
      if (existing.has(seed.name)) continue
      await this.ctx.faberloomAgents.createAgent({
        name: seed.name,
        responsibility: seed.responsibility,
        origin: 'scratch',
        skills: seed.skills.filter(skill => available.has(skill)),
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

  /** Skill names the owner can use: their own uploads plus the role catalogue. */
  private availableSkills(): string[] {
    const names: string[] = []
    for (const root of [join(this.dshHome(), 'skills'), this.roleSkillsDir()]) {
      if (root === undefined || !existsSync(root)) continue
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md'))) names.push(entry.name)
      }
    }
    return names
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
