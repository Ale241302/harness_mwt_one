/**
 * Native skill installer (`ctx.skillInstall`): recognise a folder the user
 * points at, install it into the workspace or the user skills root, and remove
 * it again.
 *
 * The installer writes through the exact directories
 * `@deepseek-ai/dsh-skill-filesystem` scans (`<projectRoot>/.dsh/skills` for
 * `project-dsh`, `<dshHome>/skills` for `user-dsh`), so an installed skill is
 * first-class in the provider's catalog and becomes loadable through the
 * provider's watcher without a restart. Installed skills carry a
 * `.dsh-skill-install.json` marker, which makes a repeat install a reported no-op and keeps an uninstall
 * from deleting a hand-authored skill of the same name.
 *
 * The model-facing surface is the `install_skill` and `uninstall_skill` tools.
 * When the caller names no destination, `install_skill` asks the user through
 * the existing `ctx.userQuestions` seam with exactly two choices: the current
 * workspace or the user's global scope.
 *
 * @module @deepseek-ai/dsh-skill-install
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { userSkillRoot } from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Side-effect type import: declaration-merges `ctx.userQuestions` onto Context.
import type {} from '@deepseek-ai/dsh-user-questions'
import { detectSkillFolder, refusedCandidateName } from './detect.ts'
import { AGENT_PRESETS_DIRNAME, installAgents } from './agents.ts'
import {
  installSkillFolder,
  readInstalls,
  removeInstalledSkill,
  resolveScopeRoot,
  summarizeOutcomes,
} from './install.ts'
import type {
  SkillFolderDetection,
  SkillInstallOutcome,
  SkillInstallReport,
  SkillInstallService,
  SkillInstallTargets,
  SkillScope,
  SkillUninstallReport,
} from './types.ts'

export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-install'

/** The tools registry this plugin publishes its model-facing tools on. */
export const inject = ['tools']

/** Stable id of the scope question, echoed in the human's answer. */
const SCOPE_QUESTION_ID = 'skill-install-scope'

/** Option label that selects the workspace scope. */
const WORKSPACE_SCOPE_LABEL = 'This workspace only'

/** Option label that selects the user-global scope. */
const GLOBAL_SCOPE_LABEL = 'Global for your user'

/** Value schema of one install outcome, shared by both tool contracts. */
const OUTCOME_PROPERTIES = {
  name: { type: 'string', required: true },
  status: { type: 'string', required: true, enum: ['installed', 'replaced', 'already-installed', 'skipped', 'refused'] },
  reason: { type: 'string' },
} as const

/** Value schema of the `install_skill` result. */
const INSTALL_OUTPUT_PROPERTIES = {
  status: { type: 'string', required: true, enum: ['installed', 'already-installed', 'skipped', 'refused', 'invalid', 'cancelled'] },
  source: { type: 'string', required: true },
  destination: { type: 'string', enum: ['workspace', 'global'] },
  root: { type: 'string' },
  reason: { type: 'string' },
  outcomes: {
    type: 'array',
    required: true,
    items: { type: 'object', additionalProperties: false, properties: OUTCOME_PROPERTIES },
  },
} as const

/** Installer configuration. */
export interface Config {
  /** DeepSeek Harness home the global scope installs under. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
}

/** Schemastery configuration; `dshHome` is a deployment choice. */
export const Config: Schema<Config> = z.object({
  dshHome: z.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The native skill installer, its detection, and its two scanned roots. */
    skillInstall: SkillInstallService
  }
}

/**
 * Publish the installer as `ctx.skillInstall` and register its two model-facing
 * tools.
 * @param ctx - the plugin's Cordis context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const dshHome = resolveDshHome(config.dshHome)
  const scopeRoot = (destination: SkillScope, cwd: string | undefined): Promise<string | null> =>
    resolveScopeRoot(destination, cwd, dshHome, fsOf(ctx))

  const service: SkillInstallService = {
    async targets(cwd: string | undefined): Promise<SkillInstallTargets> {
      return {
        workspace: await scopeRoot('workspace', cwd),
        global: userSkillRoot(dshHome),
      }
    },

    async detect(source: string, cwd?: string): Promise<SkillFolderDetection> {
      return await detectSkillFolder(source, cwd)
    },

    async install(request): Promise<SkillInstallReport> {
      const detection = await detectSkillFolder(request.source, request.cwd)
      if (detection.kind === 'invalid') {
        return {
          status: 'invalid',
          source: detection.source,
          destination: request.destination,
          reason: detection.reason,
          outcomes: [],
        }
      }
      const root = await scopeRoot(request.destination, request.cwd)
      if (root === null) {
        return {
          status: 'refused',
          source: detection.source,
          destination: request.destination,
          reason: 'unavailable-destination',
          outcomes: [],
        }
      }
      const outcomes: SkillInstallOutcome[] = []
      for (const skill of detection.skills) {
        outcomes.push(await installSkillFolder(skill, root, request.destination, request.replace ?? false))
      }
      for (const refused of detection.refused) {
        outcomes.push({ name: refusedCandidateName(refused.directory), status: 'refused', reason: refused.reason })
      }
      outcomes.sort((left, right) => left.name.localeCompare(right.name))
      // Los agentes de un KB van a la casa del usuario, no al espacio: el
      // descubrimiento de presets los lee de `<DSH_HOME>/.agent-presets`, que es
      // lo que significa "global pero solo para su usuario".
      const agentsRoot = join(dshHome, AGENT_PRESETS_DIRNAME)
      const detectedAgents = { agents: detection.agents ?? [], refused: detection.refusedAgents ?? [] }
      const agents = detectedAgents.agents.length === 0 && detectedAgents.refused.length === 0
        ? []
        : await installAgents(detectedAgents, agentsRoot, request.replace ?? false)
      return {
        status: summarizeOutcomes([...outcomes, ...agents]),
        source: detection.source,
        destination: request.destination,
        root,
        outcomes,
        ...agents.length === 0 ? {} : { agents, agentsRoot },
      }
    },

    async uninstall(request): Promise<SkillUninstallReport> {
      const root = await scopeRoot(request.destination, request.cwd)
      if (root === null) {
        return { status: 'not-found', name: request.name, destination: request.destination, root: null }
      }
      return {
        status: await removeInstalledSkill(root, request.name),
        name: request.name,
        destination: request.destination,
        root,
      }
    },

    async list(cwd?: string) {
      const rows = [...await readInstalls(userSkillRoot(dshHome), 'global')]
      const workspace = await scopeRoot('workspace', cwd)
      if (workspace !== null) rows.push(...await readInstalls(workspace, 'workspace'))
      return rows.sort((left, right) => left.name.localeCompare(right.name))
    },
  }

  ctx.provide('skillInstall', service)
  registerInstallTool(ctx, service)
  registerUninstallTool(ctx, service)
}

/** The optional filesystem service used for the project-root probe. */
function fsOf(ctx: Context): FileSystem | undefined {
  return ctx.get('fs')
}

/** Register the model-facing `install_skill` tool. */
function registerInstallTool(ctx: Context, service: SkillInstallService): void {
  ctx.tools.register(defineTool({
    name: 'install_skill',
    description: 'Install a skill from a folder the user points at. The folder is either one skill directory holding SKILL.md, a directory of skill directories, or a knowledge base holding `skills/` and `agents/` — '
      + 'the agents of a knowledge base are installed alongside its skills, as presets in the user\'s own harness home, and a Markdown agent becomes a preset whose body is its persona. '
      + 'By default the user is asked whether to install it into the current workspace or globally for their user. '
      + 'A folder already installed unchanged is reported, not copied again.',
    parameters: {
      source: { type: 'string', required: true, description: 'Folder to install from.' },
      destination: { type: 'string', enum: ['workspace', 'global'], description: 'Scope to install into. Omit to ask the user which of the two they want.' },
      replace: { type: 'boolean', description: 'Replace an existing skill of the same name instead of skipping it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...INSTALL_OUTPUT_PROPERTIES,
          agents: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, properties: OUTCOME_PROPERTIES },
            description: 'One outcome per agent the source carried.',
          },
          agentsRoot: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      const detection = await service.detect(args.source, cwd)
      if (detection.kind === 'invalid') {
        return { status: 'invalid' as const, source: detection.source, reason: detection.reason, outcomes: [] }
      }
      const destination = args.destination ?? await askScope(ctx, service, exec.agent, exec.signal, cwd)
      if (destination === undefined) {
        return { status: 'cancelled' as const, source: detection.source, outcomes: [] }
      }
      const report = await service.install({
        source: args.source,
        destination,
        ...cwd === undefined ? {} : { cwd },
        ...args.replace === undefined ? {} : { replace: args.replace },
      })
      const { agents, ...rest } = report
      return {
        ...rest,
        outcomes: rest.outcomes.map(outcome => ({ ...outcome })),
        ...agents === undefined ? {} : { agents: agents.map(agent => ({ ...agent })) },
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Install skill ${args.source}`, kind: 'edit', rawInput: args.source }
    },
  }))
}

/** Register the model-facing `uninstall_skill` tool. */
function registerUninstallTool(ctx: Context, service: SkillInstallService): void {
  ctx.tools.register(defineTool({
    name: 'uninstall_skill',
    description: 'Remove a skill that was previously installed from a folder. Only an install recorded by install_skill is removed; a skill authored in place is never deleted.',
    parameters: {
      name: { type: 'string', required: true, description: 'The installed skill name.' },
      destination: { type: 'string', required: true, enum: ['workspace', 'global'], description: 'Scope the skill was installed into.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['removed', 'not-found', 'not-an-install'] },
          name: { type: 'string', required: true },
          destination: { type: 'string', required: true, enum: ['workspace', 'global'] },
          root: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      const report = await service.uninstall({
        name: args.name,
        destination: args.destination,
        ...cwd === undefined ? {} : { cwd },
      })
      return {
        status: report.status,
        name: report.name,
        destination: report.destination,
        ...report.root === null ? {} : { root: report.root },
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Uninstall skill ${args.name}`, kind: 'delete', rawInput: args.name }
    },
  }))
}

/**
 * Ask the user which of the two scopes an install should target, through the
 * existing user-questions seam. Absent seam or agent means no human can be
 * asked, and the caller reports a cancelled install.
 * @param ctx - plugin context carrying the optional `ctx.userQuestions` service.
 * @param service - installer used to resolve the two destination roots.
 * @param agent - calling agent, required to route the question to its client.
 * @param signal - abort signal of the tool call.
 * @param cwd - session working directory used to resolve the workspace root.
 * @returns the chosen scope, or undefined when no scope was chosen.
 */
async function askScope(
  ctx: Context,
  service: SkillInstallService,
  agent: Agent | undefined,
  signal: AbortSignal,
  cwd: string | undefined,
): Promise<SkillScope | undefined> {
  const interaction = ctx.get('userQuestions')
  if (interaction === undefined || agent === undefined) return undefined
  const targets = await service.targets(cwd)
  const answer = await interaction.ask({
    questions: [{
      id: SCOPE_QUESTION_ID,
      header: 'Install skill',
      question: 'Where should this skill be available?',
      options: [
        { label: WORKSPACE_SCOPE_LABEL, description: 'the workspace this session runs in' },
        { label: GLOBAL_SCOPE_LABEL, description: targets.global },
      ],
    }],
    agent,
    signal,
  })
  const selected = answer.answers.find(item => item.id === SCOPE_QUESTION_ID)?.selected[0]
  if (selected === WORKSPACE_SCOPE_LABEL || selected === 'workspace') return 'workspace'
  if (selected === GLOBAL_SCOPE_LABEL || selected === 'global') return 'global'
  return undefined
}
