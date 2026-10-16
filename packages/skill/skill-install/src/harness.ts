/**
 * The harness installer: one folder, or one `.zip`, that carries a whole team's
 * setup — skills, agents, rules, commands, scripts, hooks, and MCP server
 * configurations — installed into the user's own Harness home, where every
 * session of every Workspace and Space already reads it.
 *
 * Each part is recognised by the directory the convention gives it and written
 * to the root the product already reads that kind from, so the running
 * deployment changes nothing: skills land where the skill provider scans,
 * agents where the preset discovery reads, rules in the managed block of the
 * home's own `AGENTS.md` (the user-level instructions the first request of
 * every session carries), and the remaining kinds are copied whole and
 * reported with their destination.
 *
 * A name that appears under two skill or agent roots is installed once, from
 * the first root in convention order: a harness that keeps `.agents/skills`
 * beside `skills/` describes the same set twice, and the second copy is
 * covered by the first, not refused.
 *
 * @module @deepseek-ai/dsh-skill-install/harness
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseSkillFrontmatter, userSkillRoot } from '@deepseek-ai/dsh-skill-filesystem'
import { AGENT_PRESETS_DIRNAME, detectAgents, installAgents } from './agents.ts'
import { ARCHIVE_EXTENSION, readZipArchive } from './archive.ts'
import { detectSkillFolder } from './detect.ts'
import { installSkillFolder, summarizeOutcomes } from './install.ts'
import type {
  DetectedAgent, DetectedSkill, HarnessCopy, HarnessDetection, HarnessInstallReport, HarnessPartKind,
  HarnessPartOutcome, HarnessPartStatus, HarnessRuleGroup, HarnessRuleRoot, HarnessRuleText, HarnessSourceRefusal,
  RefusedAgent, RefusedSkill, SkillInstallOutcome,
} from './types.ts'

/** Skill roots a harness may carry, in the order that decides a duplicate name. */
export const HARNESS_SKILL_ROOTS = ['skills', 'skills-shared', '.agents/skills'] as const

/** Role-scoped skill catalog: every immediate subdirectory is a skill root of its own. */
export const HARNESS_SKILL_CATALOG = 'skills-catalog'

/** Agent roots a harness may carry, in the order that decides a duplicate id. */
export const HARNESS_AGENT_ROOTS = ['agents', 'agents-shared', '.agents/agents'] as const

/** Rule roots whose top-level Markdown is always on and whose subdirectories are named groups. */
export const HARNESS_RULE_ROOTS = ['rules', '.agents/rules'] as const

/** Kinds a harness carries as a whole directory, copied under the home unchanged. */
export const HARNESS_COPY_ROOTS: readonly { readonly kind: HarnessPartKind; readonly directory: string }[] = [
  { kind: 'commands', directory: 'commands' },
  { kind: 'scripts', directory: 'scripts' },
  { kind: 'hooks', directory: 'hooks' },
  { kind: 'mcp-configs', directory: 'mcp-configs' },
]

/** Instructions file a harness may carry at its root. */
export const HARNESS_INSTRUCTIONS = 'AGENTS.md'

/** Opening mark of the managed rule block inside the home's instructions file. */
export const RULE_BLOCK_BEGIN = '<!-- faberloom-harness:begin -->'

/** Closing mark of the managed rule block. */
export const RULE_BLOCK_END = '<!-- faberloom-harness:end -->'

/** Prefix the harness archive is extracted under. */
const ARCHIVE_PREFIX = 'dsh-harness-'

/**
 * Inspect one source: a folder, or a `.zip` that is expanded into a temporary
 * directory first. The temporary directory is named on the detection so the
 * caller removes it once the install is done, whichever way the install ends.
 * @param source - absolute folder or `.zip` the operator chose.
 * @returns what the source carries, or why it cannot be installed.
 */
export async function detectHarness(source: string): Promise<HarnessDetection> {
  const info = await statOrUndefined(source)
  if (info === undefined) return refusal(source, source, 'missing')
  let root = source
  let temporary: string | undefined
  if (!info.isDirectory()) {
    // A non-directory is either an archive or not a harness at all; a zip the
    // operator picked is expanded and then treated exactly like a folder.
    if (!source.toLowerCase().endsWith(ARCHIVE_EXTENSION)) return refusal(source, source, 'not-a-harness')
    temporary = await mkdtemp(join(tmpdir(), ARCHIVE_PREFIX))
    try {
      await readZipArchive(source, temporary)
    } catch {
      await rm(temporary, { recursive: true, force: true })
      return refusal(source, source, 'archive-unreadable')
    }
    root = temporary
  }

  const found = await scanHarness(root)
  let scan = found
  // Un archivo comprimido que envuelve su propio arbol (`equipo/...`) se
  // desenvuelve solo cuando la raiz extraida no trae nada: asi un archivo que
  // empieza directamente en `skills/` no se confunde con una carpeta contenedora.
  if (temporary !== undefined && !recognised(found)) {
    const inner = await singleDirectory(temporary)
    if (inner !== undefined) {
      const nested = await scanHarness(inner)
      if (recognised(nested)) {
        root = inner
        scan = nested
      }
    }
  }
  if (!recognised(scan)) {
    const empty = refusal(source, root, 'not-a-harness')
    return temporary === undefined ? empty : { ...empty, temporary }
  }
  // El propio `AGENTS.md` del harness son sus instrucciones, y entran como
  // regla siempre-activa: solo se lee cuando la carpeta trae algo mas, para no
  // confundir un proyecto cualquiera con un harness.
  const instructions = join(root, HARNESS_INSTRUCTIONS)
  const rules = await isFile(instructions) ? [instructions, ...scan.rules] : scan.rules
  return {
    source,
    root,
    ...temporary === undefined ? {} : { temporary },
    ...scan,
    rules,
  }
}

/** Whether a scan found anything a harness install can write. */
function recognised(scan: HarnessScan): boolean {
  return scan.skills.length + scan.agents.length + scan.rules.length + scan.ruleGroups.length
    + scan.copies.length + scan.refusedSkills.length + scan.refusedAgents.length > 0
}

/**
 * Install every part one detection carries into the Harness home.
 * @param detection - what {@link detectHarness} found.
 * @param dshHome - resolved Harness home every part is written under.
 * @param replace - rewrite a piece that is already there instead of skipping it.
 * @returns one outcome per part and per candidate.
 */
export async function installHarness(
  detection: HarnessDetection,
  dshHome: string,
  replace: boolean,
): Promise<HarnessInstallReport> {
  const parts: HarnessPartOutcome[] = []
  const outcomes: SkillInstallOutcome[] = []

  if (detection.skills.length > 0 || detection.refusedSkills.length > 0) {
    const root = userSkillRoot(dshHome)
    const results: SkillInstallOutcome[] = []
    for (const skill of detection.skills) results.push(await installSkillFolder(skill, root, 'global', replace))
    results.push(...detection.refusedSkills.map(refusedSkillOutcome))
    outcomes.push(...results)
    parts.push({ kind: 'skills', status: partStatus(results), count: detection.skills.length, target: root })
  }

  if (detection.agents.length > 0 || detection.refusedAgents.length > 0) {
    const root = join(dshHome, AGENT_PRESETS_DIRNAME)
    const results = await installAgents({ agents: detection.agents, refused: detection.refusedAgents }, root, replace)
    outcomes.push(...results)
    parts.push({ kind: 'agents', status: partStatus(results), count: detection.agents.length, target: root })
  }

  if (detection.rules.length > 0 || detection.ruleGroups.length > 0) {
    const copies: SkillInstallOutcome[] = []
    for (const ruleRoot of detection.ruleRoots) {
      copies.push(await copyChoice(
        { kind: 'rules', directory: ruleRoot.directory, relative: ruleRoot.relative },
        dshHome,
        replace,
      ))
    }
    const block = renderRuleBlock(detection.source, await readRuleTexts(detection.rules), detection.ruleGroups.map(group => ({
      name: group.name,
      path: join(dshHome, group.relative, group.name),
    })))
    copies.push(await writeRuleBlock(join(dshHome, HARNESS_INSTRUCTIONS), block, replace))
    parts.push({
      kind: 'rules',
      status: partStatus(copies),
      count: detection.rules.length + detection.ruleGroups.length,
      target: join(dshHome, HARNESS_INSTRUCTIONS),
    })
  }

  for (const copy of detection.copies) {
    const outcome = await copyChoice(copy, dshHome, replace)
    parts.push({
      kind: copy.kind,
      status: partStatus([outcome]),
      count: await countFiles(copy.directory),
      target: join(dshHome, copy.relative),
    })
  }

  return {
    status: summarizeOutcomes(parts.map(part => ({ name: part.kind, status: part.status }))),
    source: detection.source,
    root: detection.root,
    parts,
    outcomes,
  }
}

/**
 * Merge one managed block into the home's instructions file: the block is
 * replaced in place and every other line is left exactly as the user wrote it.
 * @param existing - the file's current text, empty when it does not exist.
 * @param block - the complete managed block, marks included.
 * @returns the text to write back.
 */
export function mergeRuleBlock(existing: string, block: string): string {
  const { before, after } = splitManagedBlock(existing)
  const kept = [before.replace(/\s+$/u, ''), after.replace(/^\s+/u, '')].filter(part => part.length > 0)
  return `${kept.join('\n\n')}${kept.length > 0 ? '\n\n' : ''}${block.trimEnd()}\n`
}

/**
 * Split a file into the text around its managed block. A block whose closing
 * mark is missing runs to the end of the file; a lone closing mark is removed
 * without taking the text before it; and marks in the wrong order are treated
 * as no block at all, so nothing of the user's is dropped.
 * @param existing - the file's current text.
 * @returns the text before and after the block.
 */
function splitManagedBlock(existing: string): { readonly before: string; readonly after: string } {
  const begin = existing.indexOf(RULE_BLOCK_BEGIN)
  const end = existing.indexOf(RULE_BLOCK_END)
  if (begin < 0 && end < 0) return { before: existing, after: '' }
  if (begin < 0) return { before: existing.slice(0, end), after: existing.slice(end + RULE_BLOCK_END.length) }
  if (end >= 0 && end < begin) return { before: existing, after: '' }
  return {
    before: existing.slice(0, begin),
    after: end < 0 ? '' : existing.slice(end + RULE_BLOCK_END.length),
  }
}

/**
 * Render the managed block for one harness: its always-on rules, then the rule
 * groups it carries by language or domain, named by their installed path so an
 * agent can read the group a task needs.
 * @param source - the folder or archive the rules came from.
 * @param rules - the always-on rules, in detection order.
 * @param groups - the installed rule groups and their absolute directories.
 * @returns the complete block, marks included.
 */
export function renderRuleBlock(
  source: string,
  rules: readonly HarnessRuleText[],
  groups: readonly { readonly name: string; readonly path: string }[],
): string {
  const body = [
    '## Reglas del harness',
    '',
    `Instaladas desde \`${source}\`. Este bloque lo reescribe el instalador al reinstalar; lo que escribas fuera de el no se toca.`,
    '',
    ...rules.flatMap(rule => [`### ${rule.name}`, '', rule.body.trim(), '']),
    ...groups.length === 0
      ? []
      : [
        '## Grupos de reglas por lenguaje o dominio',
        '',
        'Lee el grupo que corresponda a la tarea; no estan activos todos a la vez.',
        '',
        ...groups.map(group => `- \`${group.name}\`: \`${group.path}\``),
        '',
      ],
  ]
  return [RULE_BLOCK_BEGIN, ...body, RULE_BLOCK_END].join('\n')
}

/** What one scan of a harness root found, before the refusal decision. */
interface HarnessScan {
  readonly skills: DetectedSkill[]
  readonly refusedSkills: RefusedSkill[]
  readonly agents: DetectedAgent[]
  readonly refusedAgents: RefusedAgent[]
  readonly rules: string[]
  readonly ruleGroups: HarnessRuleGroup[]
  readonly ruleRoots: HarnessRuleRoot[]
  readonly copies: HarnessCopy[]
}

/**
 * Read every part a harness root carries, each kind from the directories the
 * convention gives it. Duplicate skill names and agent ids are dropped from the
 * later root.
 * @param root - absolute harness root.
 * @returns the recognised parts.
 */
async function scanHarness(root: string): Promise<HarnessScan> {
  const scan: HarnessScan = {
    skills: [], refusedSkills: [], agents: [], refusedAgents: [], rules: [], ruleGroups: [], ruleRoots: [], copies: [],
  }

  const skillRoots: string[] = []
  if (await isFile(join(root, 'SKILL.md'))) skillRoots.push(root)
  for (const directory of HARNESS_SKILL_ROOTS) {
    const candidate = join(root, directory)
    if (await isRealDirectory(candidate)) skillRoots.push(candidate)
  }
  const catalog = join(root, HARNESS_SKILL_CATALOG)
  if (await isRealDirectory(catalog)) {
    for (const role of await directoryNames(catalog)) skillRoots.push(join(catalog, role))
  }
  const seenSkills = new Set<string>()
  for (const skillRoot of skillRoots) {
    const found = await detectSkillFolder(skillRoot)
    if (found.kind !== 'found') continue
    for (const skill of found.skills) {
      if (seenSkills.has(skill.name)) continue
      seenSkills.add(skill.name)
      scan.skills.push(skill)
    }
    scan.refusedSkills.push(...found.refused)
  }

  const seenAgents = new Set<string>()
  for (const directory of HARNESS_AGENT_ROOTS) {
    const candidate = join(root, directory)
    if (!await isRealDirectory(candidate)) continue
    const found = await detectAgents(candidate)
    for (const agent of found.agents) {
      if (seenAgents.has(agent.id)) continue
      seenAgents.add(agent.id)
      scan.agents.push(agent)
    }
    scan.refusedAgents.push(...found.refused)
  }

  for (const directory of HARNESS_RULE_ROOTS) {
    const candidate = join(root, directory)
    if (!await isRealDirectory(candidate)) continue
    scan.ruleRoots.push({ directory: candidate, relative: directory })
    for (const entry of await readdir(candidate, { withFileTypes: true, encoding: 'utf8' })) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) scan.rules.push(join(candidate, entry.name))
      else if (entry.isDirectory()) scan.ruleGroups.push({ name: entry.name, directory: join(candidate, entry.name), relative: directory })
    }
  }

  for (const copy of HARNESS_COPY_ROOTS) {
    const candidate = join(root, copy.directory)
    if (!await isRealDirectory(candidate)) continue
    scan.copies.push({ kind: copy.kind, directory: candidate, relative: copy.directory })
  }

  return scan
}

/** Copy one whole-directory part into the home, reporting what it did. */
async function copyChoice(copy: HarnessCopy, dshHome: string, replace: boolean): Promise<SkillInstallOutcome> {
  const target = join(dshHome, copy.relative)
  const exists = await isRealDirectory(target)
  if (exists && !replace) return { name: copy.kind, status: 'skipped', reason: 'exists' }
  if (exists) await rm(target, { recursive: true, force: true })
  await mkdir(dirname(target), { recursive: true })
  await cp(copy.directory, target, { recursive: true, force: true })
  return { name: copy.kind, status: exists ? 'replaced' : 'installed' }
}

/** Write the managed rule block, reporting what it did. */
async function writeRuleBlock(target: string, block: string, replace: boolean): Promise<SkillInstallOutcome> {
  const existing = await readTextOrEmpty(target)
  const had = existing.includes(RULE_BLOCK_BEGIN)
  if (had && !replace) return { name: 'rules', status: 'skipped', reason: 'exists' }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, mergeRuleBlock(existing, block), 'utf8')
  return { name: 'rules', status: had ? 'replaced' : 'installed' }
}

/** Read every always-on rule's name and body. */
async function readRuleTexts(files: readonly string[]): Promise<HarnessRuleText[]> {
  const rules: HarnessRuleText[] = []
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const parsed = parseSkillFrontmatter(raw)
    const body = parsed === undefined ? raw : parsed.body
    const name = parsed?.data['name']
    rules.push({
      name: typeof name === 'string' && name.length > 0 ? name : basename(file).replace(/\.md$/iu, ''),
      body,
    })
  }
  return rules
}

/** The outcome of one refused skill candidate, named by its directory. */
function refusedSkillOutcome(refused: RefusedSkill): SkillInstallOutcome {
  return { name: basename(refused.directory), status: 'refused', reason: refused.reason }
}

/** How one part's outcomes summarise. */
function partStatus(outcomes: readonly SkillInstallOutcome[]): HarnessPartStatus {
  if (outcomes.some(outcome => outcome.status === 'installed')) return 'installed'
  if (outcomes.some(outcome => outcome.status === 'replaced')) return 'replaced'
  return 'skipped'
}

/** A detection that installs nothing, with the reason. */
function refusal(source: string, root: string, reason: HarnessSourceRefusal): HarnessDetection {
  return {
    source, root, reason,
    skills: [], refusedSkills: [], agents: [], refusedAgents: [], rules: [], ruleGroups: [], ruleRoots: [], copies: [],
  }
}

/** The only subdirectory inside another, or undefined when there is not exactly one. */
async function singleDirectory(parent: string): Promise<string | undefined> {
  const entries = await readdir(parent, { withFileTypes: true, encoding: 'utf8' })
  if (entries.length === 1 && entries[0]?.isDirectory() === true) return join(parent, entries[0].name)
  return undefined
}

/** The names of a directory's subdirectories, name-sorted. */
async function directoryNames(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true, encoding: 'utf8' })
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * How many files a directory holds, recursively.
 * @param directory - absolute directory, or one file, to count.
 * @returns the number of files under it, or 0 when the path is not there.
 */
export async function countFiles(directory: string): Promise<number> {
  if (await isFile(directory)) return 1
  if (!await isRealDirectory(directory)) return 0
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true, encoding: 'utf8' })) {
    total += await countFiles(join(directory, entry.name))
  }
  return total
}

/** One path's status, or undefined when it does not exist. */
async function statOrUndefined(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean } | undefined> {
  try {
    return await stat(path)
  } catch {
    // Unreadable and absent are the same answer here: neither can be installed.
    return undefined
  }
}

/** Whether a path is a real directory, so a symlinked root is not followed twice. */
async function isRealDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Whether a path is an existing file. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** One file's text, or the empty string when it does not exist. */
async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // A missing instructions file is the normal first install.
    return ''
  }
}
