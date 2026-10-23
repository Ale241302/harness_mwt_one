/**
 * One session's Space scope: the Space its working directory belongs to, every
 * readable sub-Space below it, and the Spaces this session was explicitly
 * granted read access to.
 *
 * A Space session reads its own Space and its whole descendant subtree by
 * default: memory, curated context, agent catalog entries, skills, the harness
 * files the scope projects (`AGENTS.md`, `.agents/`, `.claude/`), and the files
 * in each folder. A Space outside that subtree — a sibling, an uncle, an
 * unrelated Space — stays out until the session is granted read access, which
 * is recorded as one durable session event. Read access never widens writing:
 * the file sandbox keeps the session's own working directory as the only
 * writable root.
 *
 * @module @deepseek-ai/dsh-faberloom-session-agent/scope
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { FaberLoomAgent } from '@deepseek-ai/dsh-faberloom-agents'
import type {
  EffectiveContext,
  FaberLoomSpace,
  FaberLoomSpaceId,
  FaberLoomSpaceMemory,
  SpaceActor,
} from '@deepseek-ai/dsh-faberloom-spaces'

/** Default ceiling on the rendered scope text, in characters. */
export const DEFAULT_MAX_SCOPE_CHARS = 24_000

/** Default ceiling on the Spaces one scope lists, including sub-Spaces. */
export const DEFAULT_MAX_SCOPE_SPACES = 40

/** Most characters read from one generated instruction file. */
const MAX_INSTRUCTION_CHARS = 4_000

/** Most entries rendered from one list (memory, context, agents, files). */
const MAX_LIST_ITEMS = 12

/** Most names read from one harness directory. */
const MAX_DIRECTORY_NAMES = 20

/** Most characters kept from one free-text value. */
const MAX_VALUE_CHARS = 600

/** The harness artifacts a projected scope carries, in the order it checks them. */
const HARNESS_DIRECTORIES = ['.agents', '.claude'] as const

/** One curated context entry as the scope renders it. */
export interface SpaceScopeEntry {
  /** Entry title. */
  readonly title: string
  /** Entry body. */
  readonly body: string
}

/** One catalog agent responsible for a Space in the scope. */
export interface SpaceScopeAgent {
  /** Agent name. */
  readonly name: string
  /** Agent responsibility. */
  readonly responsibility: string
  /** Skills the agent declares. */
  readonly skills: readonly string[]
}

/** One Space the session may read, with everything the model needs to use it. */
export interface SpaceScopeNode {
  /** Space id. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Parent Space id, or null for a root. */
  readonly parentId: string | null
  /** Absolute folder of the Space. */
  readonly path: string
  /** Whether the Space is the session's own Space. */
  readonly current: boolean
  /** Owner directive for this Space's agent, when set. */
  readonly directive: string
  /** Memory visible to the acting identity. */
  readonly memory: readonly string[]
  /** Resolved context keys. */
  readonly context: readonly { readonly key: string; readonly value: string }[]
  /** Curated context entries the actor may read. */
  readonly entries: readonly SpaceScopeEntry[]
  /** Responsible agents of this Space. */
  readonly agents: readonly SpaceScopeAgent[]
  /** Skill names declared by those agents. */
  readonly skills: readonly string[]
  /** Harness artifacts present in the folder. */
  readonly harness: readonly string[]
  /** Top-level entries of the Space folder. */
  readonly files: readonly string[]
  /** The Space's `AGENTS.md` text, capped. */
  readonly instructions: string
  /** Sub-Spaces of this node, in creation order. */
  readonly children: readonly SpaceScopeNode[]
}

/** The complete readable scope of one session. */
export interface SpaceScope {
  /** The Space whose folder is the session's working directory. */
  readonly space: SpaceScopeNode
  /** Granted Space subtrees outside the session's own subtree. */
  readonly granted: readonly SpaceScopeNode[]
  /** Other readable Spaces the session may ask to read. */
  readonly others: readonly { readonly id: string; readonly title: string }[]
  /**
   * Folders of readable Spaces outside the session scope. File tools refuse
   * reads under them until the session records a grant; the paths are never
   * rendered, so a Space the user did not open is not discoverable from the
   * prompt.
   */
  readonly foreign: readonly { readonly id: string; readonly title: string; readonly path: string }[]
  /** Model-facing text naming every readable Space and its artifacts. */
  readonly text: string
}

/** The spaces domain reads the scope needs. */
export interface SpaceScopeSpaces {
  /** List every Space the actor may read. */
  list(actor: SpaceActor): Promise<readonly FaberLoomSpace[]>
  /** Read one Space the actor may read. */
  get(actor: SpaceActor, id: FaberLoomSpaceId): Promise<FaberLoomSpace>
  /** Memory one Space sees, including inherited ancestors. */
  effectiveMemory(actor: SpaceActor, id: FaberLoomSpaceId): Promise<readonly FaberLoomSpaceMemory[]>
  /** Memory attached directly to one Space. */
  listMemory(actor: SpaceActor, id: FaberLoomSpaceId): Promise<readonly FaberLoomSpaceMemory[]>
  /** Resolved context of one Space, including inherited ancestors. */
  effectiveContext(actor: SpaceActor, id: FaberLoomSpaceId): Promise<EffectiveContext>
  /** Opaque deterministic area reference of a Space with no workspace mirror. */
  resolveWorkdir(actor: SpaceActor, id: FaberLoomSpaceId): Promise<{ readonly ref: string }>
}

/** The agent catalog reads the scope needs. */
export interface SpaceScopeAgents {
  /** List the catalog agents. */
  listAgents(): Promise<readonly FaberLoomAgent[]>
}

/** One optional curated-context read. */
export interface SpaceScopeContextEntries {
  /** List the curated entries of one Space the actor may read. */
  listForSpace(actor: SpaceActor, spaceId: string): Promise<readonly SpaceScopeEntry[]>
}

/** One registered Workspace, as the scope resolves a folder from it. */
export interface SpaceScopeWorkspace {
  /** Workspace id. */
  readonly id: string
  /** Absolute Workspace folder. */
  readonly path: string
}

/** The workspace registry read structurally by service name. */
export interface SpaceScopeWorkspaceRegistry {
  /** List every registered Workspace. */
  list(): readonly SpaceScopeWorkspace[]
}

/** Everything one scope read needs from the running product. */
export interface SpaceScopeInput {
  /** The acting identity. */
  readonly actor: SpaceActor
  /** The session's working directory. */
  readonly cwd: string
  /** The spaces domain. */
  readonly spaces: SpaceScopeSpaces
  /** The agent catalog, when mounted. */
  readonly agents?: SpaceScopeAgents
  /** The curated-context service, when mounted. */
  readonly contextEntries?: SpaceScopeContextEntries
  /** The workspace registry, when mounted. */
  readonly registry?: SpaceScopeWorkspaceRegistry
  /** Resolved harness home, used for Spaces with no workspace mirror. */
  readonly dshHome: string
  /** Spaces granted read access in this session. */
  readonly grantedSpaceIds?: readonly string[]
  /** Rendered-text ceiling; defaults to {@link DEFAULT_MAX_SCOPE_CHARS}. */
  readonly maxChars?: number
  /** Listed-Space ceiling; defaults to {@link DEFAULT_MAX_SCOPE_SPACES}. */
  readonly maxSpaces?: number
}

/**
 * Whether one path is a folder or lies under it, under the host's filesystem
 * convention. The scope uses this to separate its own subtree from the readable
 * Spaces outside it without resolving either side through the filesystem.
 * @param path - target path.
 * @param root - root folder.
 * @returns `true` when the target is contained.
 */
export function isUnderFolder(path: string, root: string): boolean {
  const normalize = (value: string): string => {
    const unified = value.replace(/[\\/]+/g, sep)
    return process.platform === 'win32' ? unified.toLowerCase() : unified
  }
  const target = normalize(path)
  const base = normalize(root)
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

/** Mutable build form of {@link SpaceScopeNode}. */
interface MutableNode {
  id: string
  title: string
  parentId: string | null
  path: string
  current: boolean
  directive: string
  memory: string[]
  context: { key: string; value: string }[]
  entries: SpaceScopeEntry[]
  agents: SpaceScopeAgent[]
  skills: string[]
  harness: string[]
  files: string[]
  instructions: string
  children: MutableNode[]
}

/**
 * Bound one free-text value to the render budget.
 * @param value - source text.
 * @param max - most characters kept.
 * @returns the value, with an ellipsis when it was cut.
 */
function clipped(value: string, max = MAX_VALUE_CHARS): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Resolve the absolute folder of one Space: its mirrored Workspace first, the
 * deterministic area otherwise.
 * @param input - the scope read.
 * @param space - the Space to resolve.
 * @param byPath - registered Workspaces keyed by id.
 * @returns the absolute folder.
 */
async function folderOf(
  input: SpaceScopeInput,
  space: FaberLoomSpace,
  byId: ReadonlyMap<string, string>,
): Promise<string> {
  const mirrored = space.workspaceId === undefined ? undefined : byId.get(space.workspaceId)
  if (mirrored !== undefined) return mirrored
  const ref = await input.spaces.resolveWorkdir(input.actor, space.id)
  return join(input.dshHome, 'spaces', ref.ref)
}

/**
 * Read the harness artifacts of one Space folder: the instruction files and the
 * names inside the generated agent/skill directories. A missing path is not an
 * error; a folder with no projection simply carries no artifacts.
 * @param root - absolute Space folder.
 * @returns the artifact labels and the instruction text.
 */
async function readHarness(root: string): Promise<{ harness: string[]; files: string[]; instructions: string }> {
  const harness: string[] = []
  const files: string[] = []
  let instructions = ''
  try {
    const listing = await readdir(root, { withFileTypes: true })
    for (const entry of listing.slice(0, MAX_DIRECTORY_NAMES)) {
      files.push(`${entry.name}${entry.isDirectory() ? '/' : ''}`)
    }
  } catch {
    // A Space whose folder does not exist yet still carries its product records.
  }
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    try {
      const info = await stat(join(root, name))
      if (!info.isFile()) continue
      harness.push(name)
      if (instructions.length === 0) {
        instructions = clipped(await readFile(join(root, name), 'utf8'), MAX_INSTRUCTION_CHARS)
      }
    } catch {
      // A Space with no projected instruction file contributes nothing here.
    }
  }
  for (const directory of HARNESS_DIRECTORIES) {
    try {
      const entries = await readdir(join(root, directory), { withFileTypes: true })
      const names = entries
        .slice(0, MAX_DIRECTORY_NAMES)
        .map(entry => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      harness.push(`${directory}/ (${names.join(', ')})`)
      if (directory === '.claude') {
        try {
          const skills = await readdir(join(root, directory, 'skills'), { withFileTypes: true })
          const skillNames = skills.slice(0, MAX_DIRECTORY_NAMES).map(entry => entry.name)
          if (skillNames.length > 0) harness.push(`${directory}/skills/: ${skillNames.join(', ')}`)
        } catch {
          // A projection without skills has no skills directory.
        }
      }
    } catch {
      // A Space with no projection of this client has no such directory.
    }
  }
  return { harness, files, instructions }
}

/**
 * Build one scope node: identity, folder, product records, and harness
 * artifacts. Record reads that fail contribute nothing rather than failing the
 * whole scope, because one unreadable Space must not hide every other one.
 * @param input - the scope read.
 * @param space - the Space to build.
 * @param byId - registered Workspaces keyed by id.
 * @param catalog - catalog agents keyed by id.
 * @param effective - whether to include inherited ancestors' records.
 * @returns the built node.
 */
async function buildNode(
  input: SpaceScopeInput,
  space: FaberLoomSpace,
  byId: ReadonlyMap<string, string>,
  catalog: ReadonlyMap<string, FaberLoomAgent>,
  effective: boolean,
): Promise<MutableNode> {
  const actor = input.actor
  const path = await folderOf(input, space, byId)
  const memory = effective
    ? await input.spaces.effectiveMemory(actor, space.id)
    : await input.spaces.listMemory(actor, space.id)
  const context = effective
    ? Object.entries((await input.spaces.effectiveContext(actor, space.id)).resolved)
    : Object.entries(space.context)
  const entries = input.contextEntries === undefined
    ? []
    : await input.contextEntries.listForSpace(actor, String(space.id))
  const agent = space.agentId === undefined ? undefined : catalog.get(space.agentId)
  const agents = agent === undefined ? [] : [{ name: agent.name, responsibility: agent.responsibility, skills: [...agent.skills] }]
  const skills = new Set<string>()
  for (const entry of agents) for (const skill of entry.skills) skills.add(skill)
  const harness = await readHarness(path)
  for (const label of harness.harness) {
    const match = /^\.claude\/skills\/: (.*)$/.exec(label)
    if (match?.[1] === undefined) continue
    for (const name of match[1].split(', ')) if (name.length > 0) skills.add(name)
  }
  return {
    id: String(space.id),
    title: space.title,
    parentId: space.parentId === undefined ? null : String(space.parentId),
    path,
    current: false,
    directive: space.prompt,
    memory: memory.slice(0, MAX_LIST_ITEMS).map(entry => clipped(entry.text)),
    context: context.slice(0, MAX_LIST_ITEMS).map(([key, value]) => ({ key, value: clipped(value) })),
    entries: entries.slice(0, MAX_LIST_ITEMS).map(entry => ({ title: clipped(entry.title, 120), body: clipped(entry.body) })),
    agents,
    skills: [...skills].sort(),
    harness: harness.harness,
    files: harness.files,
    instructions: harness.instructions,
    children: [],
  }
}

/**
 * Attach child nodes below one node, breadth first, stopping at the configured
 * Space ceiling.
 * @param root - node receiving children.
 * @param childrenOf - Space children keyed by parent id.
 * @param build - builds one child node.
 * @param seen - ids already rendered anywhere in the scope.
 * @param budget - remaining Space slots; mutated.
 */
async function attachChildren(
  root: MutableNode,
  childrenOf: ReadonlyMap<string, readonly FaberLoomSpace[]>,
  build: (space: FaberLoomSpace) => Promise<MutableNode>,
  seen: Set<string>,
  budget: { left: number },
): Promise<void> {
  const queue: MutableNode[] = [root]
  while (queue.length > 0) {
    const parent = queue.shift()
    if (parent === undefined) break
    for (const child of childrenOf.get(parent.id) ?? []) {
      if (budget.left <= 0) return
      const id = String(child.id)
      if (seen.has(id)) continue
      seen.add(id)
      budget.left -= 1
      const node = await build(child)
      parent.children.push(node)
      queue.push(node)
    }
  }
}

/**
 * Find the Space whose folder is the session's working directory.
 * @param spaces - readable Spaces.
 * @param byId - registered Workspaces keyed by id.
 * @param cwd - the session working directory.
 * @returns the matching Space, or undefined outside a Space.
 */
function currentSpace(
  spaces: readonly FaberLoomSpace[],
  byId: ReadonlyMap<string, string>,
  cwd: string,
): FaberLoomSpace | undefined {
  const workspaceIds = new Set(
    [...byId.entries()].filter(([, path]) => path === cwd).map(([id]) => id),
  )
  return spaces.find(space => space.workspaceId !== undefined && workspaceIds.has(space.workspaceId))
}

/**
 * Render one node and its subtree within a character budget.
 * @param node - node to render.
 * @param budget - remaining characters; mutated.
 * @param lines - destination lines.
 */
function renderNode(node: SpaceScopeNode, budget: { left: number }, lines: string[]): void {
  const heading = node.current ? `Space actual: ${node.title}` : `Sub Space: ${node.title}`
  const block: string[] = [
    `### ${heading} (id: \`${node.id}\`)`,
    `- Carpeta: \`${node.path}\``,
  ]
  if (!node.current && node.directive.length > 0) block.push(`- Directiva del Space: ${clipped(node.directive)}`)
  if (node.memory.length > 0) block.push(`- Memoria: ${node.memory.join(' | ')}`)
  if (node.context.length > 0) block.push(`- Contexto: ${node.context.map(entry => `${entry.key}=${entry.value}`).join(', ')}`)
  if (node.entries.length > 0) block.push(`- Contexto curado: ${node.entries.map(entry => `${entry.title}: ${entry.body}`).join(' | ')}`)
  if (node.agents.length > 0) {
    block.push(`- Agentes: ${node.agents.map(agent => `${agent.name} — ${clipped(agent.responsibility, 200)}`).join(' | ')}`)
  }
  if (node.skills.length > 0) block.push(`- Skills: ${node.skills.join(', ')}`)
  if (node.harness.length > 0) {
    block.push(`- Harness: ${node.harness.join('; ')}`)
    block.push(`- Definiciones: agentes en \`${node.path}/.agents/\` y \`${node.path}/.claude/agents/\`; cada skill en \`${node.path}/.claude/skills/<nombre>/SKILL.md\`. Leelas con \`read\` cuando la tarea las necesite.`)
  }
  if (node.files.length > 0) block.push(`- Archivos en la carpeta: ${node.files.join(', ')}`)
  if (node.instructions.length > 0) block.push(`- Instrucciones (AGENTS.md): ${node.instructions}`)
  block.push('')
  for (const line of block) {
    if (budget.left <= 0) return
    lines.push(line)
    budget.left -= line.length + 1
  }
  for (const child of node.children) {
    if (budget.left <= 0) return
    renderNode(child, budget, lines)
  }
}

/**
 * Render one Space and its subtree for a tool result.
 * @param node - the subtree root.
 * @param maxChars - character ceiling.
 * @returns the model-facing text.
 */
export function renderSpaceNode(node: SpaceScopeNode, maxChars = DEFAULT_MAX_SCOPE_CHARS): string {
  const budget = { left: Math.max(0, maxChars) }
  const lines: string[] = []
  renderNode(node, budget, lines)
  if (budget.left <= 0) lines.push('_(El detalle se truncó por tamaño; leé los archivos indicados para el resto.)_')
  return lines.join('\n').trimEnd()
}

/**
 * Render the complete scope for the model: the current Space, its sub-Spaces,
 * any granted subtrees, and the other Spaces a read grant can open.
 * @param scope - the resolved scope.
 * @param maxChars - character ceiling.
 * @returns the model-facing text.
 */
export function renderSpaceScope(scope: SpaceScope, maxChars = DEFAULT_MAX_SCOPE_CHARS): string {
  const budget = { left: Math.max(0, maxChars) }
  const lines: string[] = [
    '## Ámbito de Spaces de esta sesión',
    '',
    'Esta sesión pertenece a un Space. Podés leer, sin pedir permiso, ese Space y todos sus sub Spaces: su memoria, contexto, agentes, skills, `AGENTS.md`, `.agents/`, `.claude/` y los archivos de sus carpetas. Usá esa información cuando la pregunta la necesite, y leé el archivo concreto con las tools de archivos cuando el detalle importe.',
    '',
  ]
  budget.left -= lines.join('\n').length
  renderNode(scope.space, budget, lines)
  for (const granted of scope.granted) {
    if (budget.left <= 0) break
    lines.push(`> Concedido en esta sesión en solo lectura: ${granted.title} (${granted.id}). No escribas en esta carpeta.`, '')
    renderNode(granted, budget, lines)
  }
  if (scope.others.length > 0 && budget.left > 0) {
    lines.push('### Otros Spaces fuera del ámbito', '')
    lines.push(`- ${scope.others.map(entry => `${entry.title} (id: \`${entry.id}\`)`).join('; ')}`)
    lines.push('')
    lines.push('Un Space fuera del árbol de esta sesión se lee solo con permiso: llamá a `faberloom_spaces_open_read` con su id. Ese permiso es de solo lectura para esta sesión y no habilita escrituras.')
    lines.push('')
  }
  if (budget.left <= 0) lines.push('_(El ámbito se truncó por tamaño; pedí el detalle de un Space con `faberloom_spaces_scope` o `faberloom_spaces_open_read`.)_', '')
  return lines.join('\n').trimEnd()
}

/**
 * Read one session's complete Space scope.
 * @param input - the acting identity, working directory, and mounted services.
 * @returns the scope, or undefined when the working directory is not a Space.
 */
export async function readSpaceScope(input: SpaceScopeInput): Promise<SpaceScope | undefined> {
  const spaces = await input.spaces.list(input.actor)
  const byId = new Map<string, string>()
  for (const workspace of input.registry?.list() ?? []) byId.set(workspace.id, workspace.path)
  const own = currentSpace(spaces, byId, input.cwd)
  if (own === undefined) return undefined

  const catalog = new Map<string, FaberLoomAgent>()
  for (const agent of await input.agents?.listAgents() ?? []) catalog.set(String(agent.id), agent)

  const childrenOf = new Map<string, FaberLoomSpace[]>()
  for (const space of spaces) {
    if (space.parentId === undefined) continue
    const parent = String(space.parentId)
    const list = childrenOf.get(parent)
    if (list === undefined) childrenOf.set(parent, [space])
    else list.push(space)
  }

  const maxSpaces = Math.max(1, input.maxSpaces ?? DEFAULT_MAX_SCOPE_SPACES)
  const budget = { left: maxSpaces - 1 }
  const seen = new Set<string>([String(own.id)])
  const build = (space: FaberLoomSpace): Promise<MutableNode> => buildNode(input, space, byId, catalog, false)
  const root = await buildNode(input, own, byId, catalog, true)
  root.current = true
  await attachChildren(root, childrenOf, build, seen, budget)

  const granted: MutableNode[] = []
  for (const id of input.grantedSpaceIds ?? []) {
    if (seen.has(id) || budget.left <= 0) continue
    const space = spaces.find(candidate => String(candidate.id) === id)
    if (space === undefined) continue
    seen.add(id)
    budget.left -= 1
    const node = await buildNode(input, space, byId, catalog, false)
    node.current = false
    await attachChildren(node, childrenOf, build, seen, budget)
    granted.push(node)
  }

  const outside = spaces.filter(space => !space.archived && !seen.has(String(space.id)))
  const others = outside
    .map(space => ({ id: String(space.id), title: space.title }))
    .slice(0, MAX_LIST_ITEMS)
  const foreign: { id: string; title: string; path: string }[] = []
  for (const space of outside) {
    const path = await folderOf(input, space, byId)
    // An ancestor folder contains the current Space, so it is not foreign: a
    // read of the current tree must not be refused because a parent sits above
    // it. The sibling children of that parent are their own foreign entries.
    if (isUnderFolder(root.path, path)) continue
    foreign.push({ id: String(space.id), title: space.title, path })
  }

  const scope: SpaceScope = {
    space: root,
    granted,
    others,
    foreign,
    text: '',
  }
  return { ...scope, text: renderSpaceScope(scope, input.maxChars ?? DEFAULT_MAX_SCOPE_CHARS) }
}

/**
 * Build one Space's subtree for a tool result. The caller resolves access.
 * @param input - the acting identity, working directory, and mounted services.
 * @param spaceId - the Space to describe.
 * @returns the node, or undefined when the actor cannot read it.
 */
export async function readSpaceNode(input: SpaceScopeInput, spaceId: string): Promise<SpaceScopeNode | undefined> {
  const spaces = await input.spaces.list(input.actor)
  const space = spaces.find(candidate => String(candidate.id) === spaceId)
  if (space === undefined) return undefined
  const byId = new Map<string, string>()
  for (const workspace of input.registry?.list() ?? []) byId.set(workspace.id, workspace.path)
  const catalog = new Map<string, FaberLoomAgent>()
  for (const agent of await input.agents?.listAgents() ?? []) catalog.set(String(agent.id), agent)
  const childrenOf = new Map<string, FaberLoomSpace[]>()
  for (const candidate of spaces) {
    if (candidate.parentId === undefined) continue
    const parent = String(candidate.parentId)
    const list = childrenOf.get(parent)
    if (list === undefined) childrenOf.set(parent, [candidate])
    else list.push(candidate)
  }
  const budget = { left: Math.max(1, input.maxSpaces ?? DEFAULT_MAX_SCOPE_SPACES) - 1 }
  const seen = new Set<string>([spaceId])
  const built = await buildNode(input, space, byId, catalog, false)
  const build = (candidate: FaberLoomSpace): Promise<MutableNode> => buildNode(input, candidate, byId, catalog, false)
  await attachChildren(built, childrenOf, build, seen, budget)
  return built
}
