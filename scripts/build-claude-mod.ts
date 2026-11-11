/**
 * Build the Claude Code mod's catalog from the product's own catalog and the
 * OpenCode catalog on this machine.
 *
 * `agents-shared/<dir>/{preset.yml,agent.cordis.yml}` and
 * `skills-shared/<name>/` are the catalogs FaberLoom ships; `~/.config/opencode`
 * carries the operator's OpenCode agents and skills. Claude Code reads a
 * plugin's `agents/<slug>.md` (frontmatter + prompt) and `skills/<name>/`, so
 * this script converts both sources into that shape instead of keeping a second
 * copy of the text.
 *
 * Run from the repository root: `pnpm exec tsx scripts/build-claude-mod.ts`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PLUGIN = join(ROOT, 'claude-marketplace/faberloom')
// Not `agents/` or `skills/`: Claude Code would load those as plugin components.
// The catalog travels under `catalog/` and the mod installs it as the user's own.
const AGENTS_OUT = join(PLUGIN, 'catalog', 'agents')
const SKILLS_OUT = join(PLUGIN, 'catalog', 'skills')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh-oficial')
const OPENCODE = process.env.OPENCODE_HOME ?? join(homedir(), '.config', 'opencode')

/** Capability flags one seeded agent carries in the product storage. */
interface AgentFlags {
  readonly webAccess: boolean
  readonly mwtMcp: boolean
  readonly sicopMcp: boolean
}

/** Read one optional scalar of a flat YAML document. */
function scalar(source: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(source)
  if (match === null) return ''
  const raw = (match[1] ?? '').trim()
  if (!raw.startsWith('"') && !raw.startsWith("'")) return raw
  try {
    return String(JSON.parse(raw.startsWith("'") ? `"${raw.slice(1, -1).replace(/"/gu, '\\"')}"` : raw))
  } catch {
    return raw.replace(/^["']|["']$/gu, '')
  }
}

/**
 * Read the persona prefix from one `agent.cordis.yml`, which is the agent's
 * prompt. Handles the folded (`>-`) and literal (`|`) block scalars the
 * catalog uses.
 */
function persona(source: string): string {
  const lines = source.split(/\r?\n/u)
  const start = lines.findIndex(line => /^\s+prefix:\s*[>|]-?\s*$/u.test(line))
  if (start < 0) return ''
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      block.push('')
      continue
    }
    if (!/^\s{4,}/u.test(line)) break
    block.push(line.trim())
  }
  return block.join(' ').replace(/\s+/gu, ' ').trim()
}

/** Lowercase slug Claude Code accepts as an agent name. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')
}

/** Read the capability flags of every seeded agent, keyed by display name. */
function readFlags(): ReadonlyMap<string, AgentFlags> {
  const file = join(DSH_HOME, 'storages', 'faberloom_agents.json')
  const flags = new Map<string, AgentFlags>()
  if (!existsSync(file)) return flags
  try {
    const document = JSON.parse(readFileSync(file, 'utf8')) as { tables?: { agents?: Record<string, unknown> } }
    for (const record of Object.values(document.tables?.agents ?? {})) {
      const row = record as Record<string, unknown>
      const name = typeof row['name'] === 'string' ? row['name'] : ''
      if (name.length === 0) continue
      flags.set(name, {
        webAccess: row['webAccess'] === true,
        mwtMcp: row['mwtMcp'] !== false,
        sicopMcp: row['sicopMcp'] !== false,
      })
    }
  } catch {
    // A storage this process cannot read leaves every agent at the default mask.
  }
  return flags
}

/** Built-in tools one product agent may use, from its preset rows and flags. */
function toolsFor(agentSource: string, flags: AgentFlags | undefined): readonly string[] {
  const tools = ['Read', 'Grep', 'Glob']
  if (/name:\s*'@deepseek-ai\/dsh-tool-bash'/u.test(agentSource)) tools.push('Bash')
  if (flags?.webAccess === true && /tool-web|web-search|web-fetch/u.test(agentSource)) tools.push('WebFetch', 'WebSearch')
  return tools
}

/** The model-facing line naming the MCP servers the agent may use. */
function mcpLine(flags: AgentFlags | undefined): string {
  if (flags === undefined) return ''
  const servers: string[] = []
  if (flags.mwtMcp) servers.push('`mwt`')
  if (flags.sicopMcp) servers.push('`sicop`')
  return servers.length === 0
    ? 'Este agente no consulta MCP: trabajá solo con la carpeta y sus archivos.'
    : `Consultá datos con las herramientas de los MCP ${servers.join(' y ')}; no inventes valores que ninguna herramienta devolvió.`
}

/** Write one product agent file, or nothing when the preset carries no prompt. */
function writeProductAgent(dir: string, flags: ReadonlyMap<string, AgentFlags>): boolean {
  const presetFile = join(dir, 'preset.yml')
  const agentFile = join(dir, 'agent.cordis.yml')
  if (!existsSync(presetFile) || !existsSync(agentFile)) return false
  const preset = readFileSync(presetFile, 'utf8')
  const agentSource = readFileSync(agentFile, 'utf8')
  const prompt = persona(agentSource)
  if (prompt.length === 0) return false
  const name = slug(basename(dir))
  const display = scalar(preset, 'name') || name
  const description = scalar(preset, 'description') || `Especialista ${display}.`
  const capabilities = flags.get(display)
  const body = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(`${display}. ${description}`)}`,
    `tools: ${toolsFor(agentSource, capabilities).join(', ')}`,
    '---',
    '',
    prompt,
    '',
    mcpLine(capabilities),
    'Trabajás en la carpeta de la sesión: leé el contexto que FaberLoom proyectó ahí antes de responder.',
    '',
  ].filter(line => line !== '').join('\n')
  writeFileSync(join(AGENTS_OUT, `${name}.md`), `${body}\n`)
  return true
}

/** Split one markdown file into frontmatter and body. */
function splitFrontmatter(source: string): { front: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source)
  return match === null ? { front: '', body: source } : { front: match[1] ?? '', body: source.slice(match[0].length) }
}

/** Write one OpenCode agent as a Claude subagent, keeping its prompt. */
function writeOpencodeAgent(file: string): boolean {
  if (!file.endsWith('.md')) return false
  const source = readFileSync(file, 'utf8')
  const { front, body } = splitFrontmatter(source)
  const name = `oc-${slug(basename(file, '.md'))}`
  const display = scalar(front, 'name') || slug(basename(file, '.md'))
  const description = scalar(front, 'description')
  if (description.length === 0 || body.trim().length === 0) return false
  const text = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(`${display}. ${description}`)}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n')
  writeFileSync(join(AGENTS_OUT, `${name}.md`), text)
  return true
}

/**
 * Quote a frontmatter value that YAML would reject unquoted, such as a
 * description carrying `: `. Claude Code drops a skill whose frontmatter does
 * not parse, so the copy normalizes it.
 * @param text - the SKILL.md text.
 * @returns the text with a quoted description when it needed one.
 */
function normalizeFrontmatter(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
  if (match === null) return text
  const block = match[1] ?? ''
  const lines = block.split(/\r?\n/u).map((line) => {
    if (!/^description:\s+\S/u.test(line)) return line
    const value = line.slice('description:'.length).trim()
    if (value.startsWith('"') || value.startsWith("'") || value.startsWith('|') || value.startsWith('>')) return line
    if (!value.includes(': ')) return line
    return `description: ${JSON.stringify(value)}`
  })
  return text.replace(block, lines.join('\n'))
}

/** Copy one skill directory, keeping its resources; a taken name is skipped. */
function copySkill(dir: string): boolean {
  if (!existsSync(join(dir, 'SKILL.md'))) return false
  const target = join(SKILLS_OUT, basename(dir))
  if (existsSync(target)) return false
  cpSync(dir, target, { recursive: true })
  const skillFile = join(target, 'SKILL.md')
  const source = readFileSync(skillFile, 'utf8')
  const normalized = normalizeFrontmatter(source)
  if (normalized !== source) writeFileSync(skillFile, normalized)
  return true
}

/** Count the entries under one directory. */
function count(dir: string, kind: 'file' | 'directory'): number {
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((entry) => {
    const stat = statSync(join(dir, entry))
    return kind === 'file' ? stat.isFile() : stat.isDirectory()
  }).length
}

rmSync(AGENTS_OUT, { recursive: true, force: true })
rmSync(SKILLS_OUT, { recursive: true, force: true })
mkdirSync(AGENTS_OUT, { recursive: true })
mkdirSync(SKILLS_OUT, { recursive: true })

const flags = readFlags()
let productAgents = 0
for (const entry of readdirSync(join(ROOT, 'agents-shared'), { withFileTypes: true })) {
  if (entry.isDirectory() && writeProductAgent(join(ROOT, 'agents-shared', entry.name), flags)) productAgents += 1
}

let opencodeAgents = 0
const opencodeAgentDir = join(OPENCODE, 'agents')
if (existsSync(opencodeAgentDir)) {
  for (const entry of readdirSync(opencodeAgentDir, { withFileTypes: true })) {
    if (entry.isFile() && writeOpencodeAgent(join(opencodeAgentDir, entry.name))) opencodeAgents += 1
  }
}

let productSkills = 0
for (const entry of readdirSync(join(ROOT, 'skills-shared'), { withFileTypes: true })) {
  if (entry.isDirectory() && copySkill(join(ROOT, 'skills-shared', entry.name))) productSkills += 1
}

let opencodeSkills = 0
const opencodeSkillDir = join(OPENCODE, 'skills')
if (existsSync(opencodeSkillDir)) {
  for (const entry of readdirSync(opencodeSkillDir, { withFileTypes: true })) {
    if (entry.isDirectory() && copySkill(join(opencodeSkillDir, entry.name))) opencodeSkills += 1
  }
}

console.log(`claude mod catalog -> ${PLUGIN}`)
console.log(`  agents: ${String(productAgents)} FaberLoom + ${String(opencodeAgents)} OpenCode`)
console.log(`  skills: ${String(productSkills)} FaberLoom + ${String(opencodeSkills)} OpenCode`)
console.log(`  on disk: ${String(count(AGENTS_OUT, 'file'))} agents, ${String(count(SKILLS_OUT, 'directory'))} skills`)
