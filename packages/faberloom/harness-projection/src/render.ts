/**
 * Rendering one projection: the instruction files every client reads, the
 * per-agent and per-skill definitions, the Claude settings file, and the
 * manifest. Every renderer is pure, so the written set is a function of the
 * usage read and the scope alone.
 *
 * The lists in the generated instructions are capped at
 * {@link HarnessPlanInput.maxListEntries} entries: those files reach a model's
 * request through the folder's own instructions, so a scope with hundreds of
 * records must not inject all of them.
 * @module @deepseek-ai/dsh-faberloom-harness-projection/src/render
 */

import type {
  HarnessAgentUsage,
  HarnessManifestAgent,
  HarnessManifestSkill,
  HarnessProjectionManifest,
  HarnessScope,
  HarnessSkillUsage,
  HarnessUsage,
} from './types.ts'

/** Longest slug one agent name renders to, so a file name stays readable. */
const MAX_SLUG_LENGTH = 60

/** Slug used when a display name carries no usable character. */
const FALLBACK_SLUG = 'agente'

/** Projection format version; bump only on an incompatible manifest change. */
export const HARNESS_PROJECTION_VERSION = 1

/** One file of a projection, addressed relative to the scope directory. */
export interface HarnessProjectionFile {
  /** Path relative to the scope directory, with `/` separators. */
  readonly path: string
  /** Complete file text. */
  readonly content: string
}

/** Everything the plan of one projection derives from. */
export interface HarnessPlanInput {
  /** The scope being projected. */
  readonly scope: HarnessScope
  /** Absolute scope directory the files land in. */
  readonly root: string
  /** ISO-8601 instant the projection ran. */
  readonly generatedAt: string
  /** The records the projection includes. */
  readonly usage: HarnessUsage
  /** Most entries one generated list renders. */
  readonly maxListEntries: number
}

/** The files of one projection plus the manifest that records them. */
export interface HarnessProjectionPlan {
  /** Files to write, in write order. */
  readonly files: readonly HarnessProjectionFile[]
  /** The manifest to write last. */
  readonly manifest: HarnessProjectionManifest
}

/**
 * Fold one display name into a file-name slug: lowercased in Spanish, stripped
 * of combining diacritics, with every other run of characters collapsed to one
 * hyphen.
 * @param name - the agent display name.
 * @returns the slug, never empty and never longer than {@link MAX_SLUG_LENGTH}.
 */
function slugOf(name: string): string {
  const folded = name
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/gu, '')
  return folded.length === 0 ? FALLBACK_SLUG : folded
}

/**
 * Assign one file-name slug per agent. Agents arrive ordered by name then id,
 * so the first agent keeps the plain slug and a later one whose name folds to
 * the same slug takes the next free numbered suffix.
 * @param agents - the scope's agents, ordered by name then id.
 * @returns agent id to slug.
 */
function slugsOf(agents: readonly HarnessAgentUsage[]): Map<string, string> {
  const used = new Set<string>()
  const slugs = new Map<string, string>()
  for (const agent of agents) {
    const base = slugOf(agent.name)
    let slug = base
    let suffix = 2
    while (used.has(slug)) {
      slug = `${base}-${String(suffix)}`
      suffix += 1
    }
    used.add(slug)
    slugs.set(agent.id, slug)
  }
  return slugs
}

/**
 * Fold one record text to a single line, so a multi-line value cannot break
 * the generated list or the YAML frontmatter scalar it lands in.
 * @param value - the text to fold.
 * @returns the text with every whitespace run collapsed to one space.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * Render one capped list: at most `cap` entries, then a line naming the
 * remainder, so the section states what it left out.
 * @param lines - the rendered entry lines, in order.
 * @param cap - most entries to render.
 * @returns the rendered lines, with a remainder line when the list is longer.
 */
function capped(lines: readonly string[], cap: number): string[] {
  if (lines.length <= cap) return [...lines]
  return [...lines.slice(0, cap), `- … y ${String(lines.length - cap)} más.`]
}

/**
 * Render one list section, or nothing when every entry was dropped.
 * @param title - section heading text.
 * @param lines - the rendered entry lines.
 * @param cap - most entries to render.
 * @returns the section lines, or an empty list when there is nothing to say.
 */
function section(title: string, lines: readonly string[], cap: number): string[] {
  if (lines.length === 0) return []
  return [`## ${title}`, '', ...capped(lines, cap), '']
}

/**
 * Render the instructions document one scope's clients read. The same text is
 * written to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.gemini/AGENTS.md`, and
 * `.kimi/AGENTS.md`, because a client reads whichever of those names it knows
 * and none of them is guaranteed to follow a pointer to another.
 * @param input - the scope, directory, instant, usage, and list cap.
 * @returns the complete document.
 */
export function renderInstructions(input: HarnessPlanInput): string {
  const { scope, root, generatedAt, usage, maxListEntries } = input
  const agents = usage.agents.map((agent) => {
    const route = agent.provider !== undefined && agent.model !== undefined
      ? ` (modelo: \`${agent.provider}/${agent.model}\`)`
      : ''
    return `- \`${slugOf(agent.name)}\` — ${oneLine(agent.responsibility)}${route}`
  })
  const skills = usage.skills.map(skill => `- \`${skill.name}\` — ${oneLine(skill.description)}`)
  const workflows = usage.workflows.map(entry => `- \`${oneLine(entry.name)}\` (${entry.status})`)
  const routines = usage.routines.map(entry => `- \`${oneLine(entry.name)}\` (${entry.status})`)
  const memory = usage.memory.map(entry => `- ${oneLine(entry.text)}`)
  const context = usage.context.map(entry => `- \`${oneLine(entry.title)}\``)
  const unresolved = usage.unresolvedSkills.length === 0
    ? []
    : ['', `Skills declaradas sin definición cargable: ${usage.unresolvedSkills.map(name => `\`${name}\``).join(', ')}.`]
  const unreadable = usage.unreadableDomains.length === 0
    ? []
    : ['', `Registros no leídos (dominio no abierto en este proceso): ${usage.unreadableDomains.map(name => `\`${name}\``).join(', ')}.`]
  return [
    `# Harness de ${scope.kind === 'space' ? 'Space' : 'Workspace'}: ${oneLine(scope.title)}`,
    '',
    'Este archivo lo genera FaberLoom desde la proyección del ámbito. No lo edites a mano: la próxima proyección lo reescribe y retira lo que ella misma escribió antes.',
    '',
    `- Ámbito: \`${scope.kind}\` \`${String(scope.id)}\``,
    `- Carpeta: \`${root}\``,
    `- Generado: \`${generatedAt}\``,
    '',
    ...section('Agentes del ámbito', agents, maxListEntries),
    ...section('Skills del ámbito', skills, maxListEntries),
    ...section('Workflows del ámbito', workflows, maxListEntries),
    ...section('Rutinas del ámbito', routines, maxListEntries),
    ...section('Memoria del ámbito', memory, maxListEntries),
    ...section('Contexto del ámbito', context, maxListEntries),
    '## Cómo trabajar en este ámbito',
    '',
    '- Para delegar en un agente, menciónalo por su nombre con `@`; sin mención, el sistema usa el agente responsable del ámbito.',
    '- Para cargar una skill, usa la tool `skill` con su nombre cuando la tarea lo requiera.',
    '- Cada agente tiene su definición en `.agents/<agente>.md`, `.claude/agents/<agente>.md` y `.kimi/agents/<agente>.md`; cada skill, en `.claude/skills/<skill>/SKILL.md` y `.kimi/skills/<skill>/SKILL.md`.',
    ...unresolved,
    ...unreadable,
    '',
  ].join('\n')
}

/**
 * Render the index of the scope's agents.
 * @param input - the scope and the records to index.
 * @returns the complete `.agents/README.md` text.
 */
export function renderAgentsIndex(input: HarnessPlanInput): string {
  const { scope, usage } = input
  const slugs = slugsOf(usage.agents)
  const entries = usage.agents.map(agent => `- \`${String(slugs.get(agent.id))}\` → \`.agents/${String(slugs.get(agent.id))}.md\` — ${oneLine(agent.responsibility)}`)
  const body = entries.length === 0
    ? ['Este ámbito no tiene agentes registrados.']
    : entries
  return [
    `# Agentes del ámbito ${oneLine(scope.title)}`,
    '',
    ...body,
    '',
  ].join('\n')
}

/**
 * Render one agent's definition: the frontmatter clients read, followed by the
 * agent's own responsibility, which is the persona the product installs. A
 * `model` line appears only when the agent declares both a provider and a
 * model; without one the client's own default model applies.
 * @param agent - the agent to render.
 * @param slug - the agent's file-name slug.
 * @returns the complete definition text.
 */
export function renderAgentDocument(agent: HarnessAgentUsage, slug: string): string {
  const description = oneLine(agent.responsibility)
  const model = agent.provider !== undefined && agent.model !== undefined
    ? [`model: ${JSON.stringify(`${agent.provider}/${agent.model}`)}`]
    : []
  const declared = agent.skills.length === 0
    ? []
    : ['', '## Skills declaradas', '', ...agent.skills.map(name => `- \`${name}\``)]
  return [
    '---',
    `name: ${JSON.stringify(slug)}`,
    `description: ${JSON.stringify(description)}`,
    ...model,
    '---',
    '',
    description,
    ...declared,
    '',
  ].join('\n')
}

/**
 * Render one skill's `SKILL.md`: the frontmatter the skill grammar reads, then
 * the instruction body the registry loaded.
 * @param skill - the resolved skill.
 * @returns the complete `SKILL.md` text.
 */
export function renderSkillDocument(skill: HarnessSkillUsage): string {
  return [
    '---',
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(oneLine(skill.description))}`,
    '---',
    '',
    skill.content.trimEnd(),
    '',
  ].join('\n')
}

/**
 * Render the Claude settings file. It carries an explicit empty permission
 * policy: a valid settings document that grants and denies nothing, so the
 * projection never widens what the user's own configuration allows.
 * @returns the complete `settings.json` text.
 */
export function renderSettings(): string {
  return `${JSON.stringify({ permissions: { allow: [], deny: [] } }, null, 2)}\n`
}

/**
 * Render one manifest as canonical JSON.
 * @param manifest - the manifest to render.
 * @returns the complete manifest text.
 */
export function renderManifest(manifest: HarnessProjectionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * Build every file of one projection and the manifest that records it.
 * @param input - the scope, directory, instant, usage, and list cap.
 * @returns the files to write, in write order, and the manifest.
 */
export function planProjection(input: HarnessPlanInput): HarnessProjectionPlan {
  const { scope, generatedAt, usage } = input
  const instructions = renderInstructions(input)
  const slugs = slugsOf(usage.agents)
  const files: HarnessProjectionFile[] = [
    { path: 'AGENTS.md', content: instructions },
    { path: 'CLAUDE.md', content: instructions },
    { path: 'GEMINI.md', content: instructions },
    { path: '.gemini/AGENTS.md', content: instructions },
    { path: '.kimi/AGENTS.md', content: instructions },
    { path: '.agents/README.md', content: renderAgentsIndex(input) },
    { path: '.claude/settings.json', content: renderSettings() },
  ]
  const agents: HarnessManifestAgent[] = []
  for (const agent of usage.agents) {
    const slug = String(slugs.get(agent.id))
    const content = renderAgentDocument(agent, slug)
    files.push({ path: `.agents/${slug}.md`, content })
    files.push({ path: `.claude/agents/${slug}.md`, content })
    files.push({ path: `.kimi/agents/${slug}.md`, content })
    agents.push({ id: agent.id, name: agent.name, file: `${slug}.md` })
  }
  const skills: HarnessManifestSkill[] = []
  for (const skill of usage.skills) {
    const content = renderSkillDocument(skill)
    const claude = `.claude/skills/${skill.name}/SKILL.md`
    files.push({ path: claude, content })
    files.push({ path: `.kimi/skills/${skill.name}/SKILL.md`, content })
    skills.push({ name: skill.name, file: claude })
  }
  return {
    files,
    manifest: {
      version: HARNESS_PROJECTION_VERSION,
      scope: { kind: scope.kind, id: String(scope.id), title: oneLine(scope.title) },
      generatedAt,
      files: files.map(file => file.path),
      agents,
      skills,
      workflows: usage.workflows,
      routines: usage.routines,
      memory: usage.memory,
      context: usage.context,
    },
  }
}
