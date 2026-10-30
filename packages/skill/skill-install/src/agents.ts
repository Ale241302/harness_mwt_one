/**
 * The agent side of the native installer: a KB folder's `agents/` holds preset
 * folders or single Markdown agents, and installing them writes the same
 * `$DSH_HOME/.agent-presets/<id>/` layout the deployment seeds and
 * `@deepseek-ai/dsh-agent-presets` discovers.
 *
 * A preset folder is copied whole. A Markdown agent becomes a preset whose
 * `persona` prefix is the file body: the product's agent registry holds a name
 * and a responsibility and no prompt, so an agent's own words reach the model
 * through the composition, and a KB that needs a different toolset ships a
 * preset folder instead — the installer never invents a toolset.
 *
 * @module @deepseek-ai/dsh-skill-install/agents
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseSkillFrontmatter } from '@deepseek-ai/dsh-skill-filesystem'
import type { AgentDetection, AgentRejection, DetectedAgent, RefusedAgent, SkillInstallOutcome } from './types.ts'

/** Directory the deployment and the preset discovery agree on, under the Harness home. */
export const AGENT_PRESETS_DIRNAME = '.agent-presets'

/** Preset descriptor every installable agent folder must hold. */
const PRESET_FILE = 'preset.yml'

/**
 * Inspect one `agents/` directory: every immediate subdirectory holding a
 * readable `preset.yml` is a preset folder, every immediate Markdown file with
 * usable front matter is a Markdown agent, and anything else is refused with
 * its reason.
 * @param directory - absolute `agents/` directory to inspect.
 * @returns the detected agents and the refused entries.
 */
export async function detectAgents(directory: string): Promise<AgentDetection> {
  const agents: DetectedAgent[] = []
  const refused: RefusedAgent[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return { agents, refused }
  }
  const ordered = entries
    .filter(entry => !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of ordered) {
    const source = join(directory, entry.name)
    if (entry.isDirectory()) {
      const inspected = await inspectPresetFolder(source)
      if (inspected === undefined) refused.push({ source, reason: 'missing-preset-yml' })
      else if (typeof inspected === 'string') refused.push({ source, reason: inspected })
      else agents.push(inspected)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const inspected = await inspectMarkdownAgent(source)
    if (typeof inspected === 'string') refused.push({ source, reason: inspected })
    else agents.push(inspected)
  }
  return { agents, refused }
}

/**
 * Read one preset folder's descriptor.
 * @param directory - absolute candidate directory.
 * @returns the detected agent, a refusal reason, or undefined when the folder is not a preset at all.
 */
async function inspectPresetFolder(directory: string): Promise<DetectedAgent | AgentRejection | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, PRESET_FILE), 'utf8')
  } catch {
    return undefined
  }
  const values = parsePresetYaml(raw)
  if (values === undefined) return 'bad-preset'
  const name = values['name']
  const description = values['description']
  if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string' || description.length === 0) {
    return 'missing-name'
  }
  return { id: basename(directory), name, description, source: directory, prompt: null }
}

/**
 * Read one Markdown agent: its front matter names it and its body is the prompt.
 * @param file - absolute Markdown file.
 * @returns the detected agent or a refusal reason.
 */
async function inspectMarkdownAgent(file: string): Promise<DetectedAgent | AgentRejection> {
  const raw = await readFile(file, 'utf8')
  const parsed = parseSkillFrontmatter(raw)
  if (parsed === undefined) return 'bad-frontmatter'
  const name = parsed.data['name']
  const description = parsed.data['description']
  if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string' || description.length === 0) {
    return 'missing-name'
  }
  const id = basename(file).replace(/\.md$/iu, '')
  if (!isSkillName(id)) return 'invalid-name'
  return { id, name, description, source: file, prompt: parsed.body.trim() }
}

/**
 * Install every detected agent into a Harness home's preset directory, where
 * the preset discovery reads it.
 * @param detection - what {@link detectAgents} found.
 * @param presetsRoot - absolute `.agent-presets` directory of the home.
 * @param replace - whether an agent of the same id is rewritten instead of skipped.
 * @returns one outcome per agent, in detection order.
 */
export async function installAgents(
  detection: AgentDetection,
  presetsRoot: string,
  replace: boolean,
): Promise<SkillInstallOutcome[]> {
  const outcomes: SkillInstallOutcome[] = []
  for (const agent of detection.agents) {
    const target = join(presetsRoot, agent.id)
    const exists = await pathExists(target)
    if (exists && !replace) {
      outcomes.push({ name: agent.id, status: 'already-installed', reason: 'exists' })
      continue
    }
    try {
      if (agent.prompt === null) await cp(agent.source, target, { recursive: true, force: true })
      else await writeMarkdownAgent(agent, target)
      outcomes.push({ name: agent.id, status: exists ? 'replaced' : 'installed' })
    } catch {
      outcomes.push({ name: agent.id, status: 'skipped', reason: 'exists' })
    }
  }
  for (const refused of detection.refused) {
    outcomes.push({ name: basename(refused.source), status: 'refused', reason: refused.reason })
  }
  return outcomes
}

/**
 * Write one Markdown agent as a preset folder: a descriptor plus the
 * composition that carries its body as the persona.
 * @param agent - the detected Markdown agent.
 * @param target - absolute preset directory to create.
 */
async function writeMarkdownAgent(agent: DetectedAgent, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await writeFile(join(target, PRESET_FILE), renderPresetYaml(agent), 'utf8')
  await writeFile(join(target, 'agent.cordis.yml'), renderAgentComposition(agent), 'utf8')
}

/**
 * Render one preset descriptor.
 * @param agent - the detected agent.
 * @returns the `preset.yml` content.
 */
export function renderPresetYaml(agent: DetectedAgent): string {
  return `name: ${scalar(agent.name)}\ndescription: ${scalar(agent.description)}\n`
}

/**
 * Render the composition of a Markdown agent: its body is the persona prefix,
 * followed by the instructions row that reads the workspace's `AGENTS.md`.
 * @param agent - the detected Markdown agent.
 * @returns the `agent.cordis.yml` content.
 */
export function renderAgentComposition(agent: DetectedAgent): string {
  const body = (agent.prompt ?? '').split('\n').map(line => (line.length === 0 ? '' : `      ${line}`)).join('\n')
  return [
    `# Escrito por el instalador desde ${basename(agent.source)}; el cuerpo del agente es la persona.`,
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |-',
    body,
    '- id: agent-instructions',
    "  name: '@deepseek-ai/dsh-agent-instructions'",
    '  config:',
    '    maxBytes: 65536',
    '',
  ].join('\n')
}

/** One YAML scalar quoted safely for any JSON string. */
function scalar(value: string): string {
  return JSON.stringify(value)
}

/**
 * Read the flat `name`/`description` pairs a preset descriptor holds. Only the
 * two fields this installer consumes are read, from the same flat mapping the
 * preset discovery reads; anything nested or malformed is refused.
 * @param raw - the `preset.yml` content.
 * @returns the pairs, or undefined when the document is not a flat mapping.
 */
function parsePresetYaml(raw: string): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(line)
    if (match === null || match[1] === undefined || match[2] === undefined) return undefined
    const quoted = /^(['"])(.*)\1$/u.exec(match[2].trim())
    values[match[1]] = (quoted?.[2] ?? match[2].trim()).replace(/\\"/gu, '"')
  }
  return values
}

/** Whether a path exists, whatever its kind. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
