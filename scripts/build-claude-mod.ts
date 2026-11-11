/**
 * Build the Claude Code mod's catalog from the product's own catalog.
 *
 * `agents-shared/<dir>/{preset.yml,agent.cordis.yml}` and
 * `skills-shared/<name>/` are the catalogs FaberLoom ships. Claude Code reads a
 * plugin's `agents/<slug>.md` (frontmatter + prompt) and `skills/<name>/`, so
 * this script converts one shape into the other instead of keeping a second
 * copy of the text.
 *
 * Run from the repository root: `pnpm exec tsx scripts/build-claude-mod.ts`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PLUGIN = join(ROOT, 'claude-marketplace/faberloom')
const AGENTS_OUT = join(PLUGIN, 'agents')
const SKILLS_OUT = join(PLUGIN, 'skills')

/** Read one optional field of a flat YAML document. */
function scalar(source: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(source)
  if (match === null) return ''
  const raw = (match[1] ?? '').trim()
  if (!raw.startsWith('"')) return raw
  try {
    return String(JSON.parse(raw))
  } catch {
    return raw.replace(/^"|"$/gu, '')
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

/** Write one agent file, or nothing when the preset carries no prompt. */
function writeAgent(dir: string): boolean {
  const presetFile = join(dir, 'preset.yml')
  const agentFile = join(dir, 'agent.cordis.yml')
  if (!existsSync(presetFile) || !existsSync(agentFile)) return false
  const preset = readFileSync(presetFile, 'utf8')
  const prompt = persona(readFileSync(agentFile, 'utf8'))
  if (prompt.length === 0) return false
  const name = slug(basename(dir))
  const display = scalar(preset, 'name') || name
  const description = scalar(preset, 'description') || `Especialista ${display}.`
  const body = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(`${display}. ${description}`)}`,
    '---',
    '',
    prompt,
    '',
    'Trabajás en la carpeta de la sesión: leé el contexto que FaberLoom proyectó ahí antes de responder y no inventes datos que ninguna herramienta devolvió.',
    '',
  ].join('\n')
  writeFileSync(join(AGENTS_OUT, `${name}.md`), body)
  return true
}

/** Copy one skill directory, keeping its resources. */
function copySkill(dir: string): boolean {
  if (!existsSync(join(dir, 'SKILL.md'))) return false
  cpSync(dir, join(SKILLS_OUT, basename(dir)), { recursive: true })
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

let agents = 0
for (const entry of readdirSync(join(ROOT, 'agents-shared'), { withFileTypes: true })) {
  if (entry.isDirectory() && writeAgent(join(ROOT, 'agents-shared', entry.name))) agents += 1
}

let skills = 0
for (const entry of readdirSync(join(ROOT, 'skills-shared'), { withFileTypes: true })) {
  if (entry.isDirectory() && copySkill(join(ROOT, 'skills-shared', entry.name))) skills += 1
}

console.log(`claude mod catalog: ${String(agents)} agent(s), ${String(skills)} skill(s) -> ${PLUGIN}`)
console.log(`on disk: ${String(count(AGENTS_OUT, 'file'))} agents, ${String(count(SKILLS_OUT, 'directory'))} skills`)
