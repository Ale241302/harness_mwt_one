/**
 * Folder detection for the native skill installer: decide whether a folder the
 * caller named is an installable skill, and say which validation rule it
 * failed when it is not.
 *
 * The acceptance rules mirror the filesystem skill provider exactly — `SKILL.md`
 * at the folder root (a single skill) or one directory below (a catalog of
 * skills) with readable YAML front matter whose `name` and `description` are
 * present and whose `name` is kebab-case — so a folder this module accepts is
 * one the provider will load once it lands in a scanned root.
 *
 * @module @deepseek-ai/dsh-skill-install/detect
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseSkillFrontmatter } from '@deepseek-ai/dsh-skill-filesystem'
import { detectAgents } from './agents.ts'
import type { DetectedSkill, RefusedSkill, SkillFolderDetection, SkillFolderRejection } from './types.ts'

/** Instruction file every skill directory must hold. */
const SKILL_FILE = 'SKILL.md'

/** Directory a knowledge base keeps its skill catalog in. */
const SKILLS_DIR = 'skills'

/** Directory a knowledge base keeps its agents in. */
const AGENTS_DIR = 'agents'

/**
 * Whether a path exists and is a directory.
 * @param path - absolute path to probe.
 * @returns whether the path is an existing directory.
 */
export async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Validate one directory that holds `SKILL.md`.
 * @param directory - absolute directory to inspect.
 * @returns the detected skill, or the reason the directory is not one.
 */
async function inspectSkillDirectory(directory: string): Promise<DetectedSkill | SkillFolderRejection> {
  let raw: string
  try {
    raw = await readFile(join(directory, SKILL_FILE), 'utf8')
  } catch {
    return 'missing-skill-md'
  }
  const data = parseSkillFrontmatter(raw)?.data
  if (data === undefined) return 'bad-frontmatter'
  const name = data.name
  const description = data.description
  if (typeof name !== 'string' || name.length === 0
    || typeof description !== 'string' || description.length === 0) {
    return 'missing-name'
  }
  if (!isSkillName(name)) return 'invalid-name'
  return { name, description, directory }
}

/**
 * Decide whether a folder is an installable skill, a catalog of skills, or
 * neither. A folder holding `SKILL.md` is one skill; otherwise each immediate
 * subdirectory holding `SKILL.md` is a candidate. Hidden subdirectories are
 * skipped, matching the provider's own root scan.
 * @param source - folder to inspect.
 * @param cwd - directory a relative `source` resolves against; defaults to the process cwd.
 * @returns the detected skills plus refused candidates, or one rejection reason.
 */
export async function detectSkillFolder(source: string, cwd?: string): Promise<SkillFolderDetection> {
  const resolved = resolve(cwd ?? process.cwd(), source)
  let entries
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) return { kind: 'invalid', source: resolved, reason: 'not-a-directory' }
    entries = await readdir(resolved, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return { kind: 'invalid', source: resolved, reason: 'missing' }
  }
  if (entries.length === 0) return { kind: 'invalid', source: resolved, reason: 'empty' }

  if (entries.some(entry => entry.isFile() && entry.name === SKILL_FILE)) {
    const inspected = await inspectSkillDirectory(resolved)
    return typeof inspected === 'string'
      ? { kind: 'invalid', source: resolved, reason: inspected }
      : { kind: 'found', source: resolved, skills: [inspected], refused: [] }
  }

  const candidates = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const skills: DetectedSkill[] = []
  const refused: RefusedSkill[] = []
  let sawSkillFile = false
  for (const entry of candidates) {
    const directory = join(resolved, entry.name)
    const inspected = await inspectSkillDirectory(directory)
    // A subdirectory without a readable SKILL.md is not a candidate at all.
    if (inspected === 'missing-skill-md') continue
    sawSkillFile = true
    if (typeof inspected === 'string') refused.push({ directory, reason: inspected })
    else skills.push(inspected)
  }
  if (!sawSkillFile) {
    // Una carpeta KB trae el catalogo en `skills/` y los agentes en `agents/`:
    // elegir la carpeta KB instala las dos cosas, que es lo que el dueño de un
    // KB espera al elegir su carpeta entera.
    const base = await detectKnowledgeBase(resolved)
    if (base !== undefined) return base
    return { kind: 'invalid', source: resolved, reason: 'missing-skill-md' }
  }
  return { kind: 'found', source: resolved, skills, refused }
}

/**
 * Inspect a folder as a knowledge base: `skills/` holds the skill catalog and
 * `agents/` the agents, and either one alone is enough to be installable.
 * @param directory - absolute candidate directory holding no `SKILL.md` itself.
 * @returns the combined detection, or undefined when neither directory exists or both are empty.
 */
async function detectKnowledgeBase(directory: string): Promise<SkillFolderDetection | undefined> {
  const skillsDir = join(directory, SKILLS_DIR)
  const agentsDir = join(directory, AGENTS_DIR)
  const [hasSkills, hasAgents] = await Promise.all([pathIsDirectory(skillsDir), pathIsDirectory(agentsDir)])
  if (!hasSkills && !hasAgents) return undefined
  const nested = hasSkills ? await detectSkillFolder(skillsDir) : undefined
  const agents = hasAgents ? await detectAgents(agentsDir) : { agents: [], refused: [] }
  const skills = nested?.kind === 'found' ? nested.skills : []
  const refused = nested?.kind === 'found' ? nested.refused : []
  if (skills.length === 0 && agents.agents.length === 0) return undefined
  return { kind: 'found', source: directory, skills, refused, agents: agents.agents, refusedAgents: agents.refused }
}

/**
 * The base name used to name a refused candidate whose front matter gave no name.
 * @param directory - candidate directory that failed validation.
 * @returns its base name.
 */
export function refusedCandidateName(directory: string): string {
  return basename(directory)
}
