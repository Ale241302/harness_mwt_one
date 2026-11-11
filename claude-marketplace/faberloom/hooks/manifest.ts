/**
 * Reading the FaberLoom projection a Space or Workspace folder carries.
 *
 * `@deepseek-ai/dsh-faberloom-harness-projection` writes the scope's agents,
 * skills, workflows, routines, memory, and context into the folder itself:
 * `CLAUDE.md`, `.claude/agents/<slug>.md`, `.claude/skills/<name>/SKILL.md`,
 * and one manifest at `.faberloom/harness.json`. Claude Code already loads the
 * instruction file and the agent and skill definitions from that folder, so the
 * mod reads the manifest only to report what the product put there.
 *
 * Pure: no filesystem and no mods API, so `claude plugin test` drives it
 * directly.
 */

/** Where the projection records what it wrote, relative to the scope folder. */
export const MANIFEST_PATH = '.faberloom/harness.json'

/** The board unit the product writes under `<DSH_HOME>/storages`. */
export const BOARD_UNIT = 'faberloom_board'

/** The spaces unit, read only to name the Space an item belongs to. */
export const SPACES_UNIT = 'faberloom_spaces'

/** One work item the Mesa holds. */
export interface BoardItem {
  /** Item title as the Mesa shows it. */
  readonly title: string
  /** WorkLoom status (`waiting_approval`, `needs_review`, `approved`, …). */
  readonly status: string
  /** Severity, or an empty string when the item carries none. */
  readonly severity: string
  /** Due date, or an empty string. */
  readonly dueAt: string
  /** Space title, or the id when the Space is unknown. */
  readonly space: string
}

/** The open states the Mesa's queue is made of. */
const OPEN_STATUSES: ReadonlySet<string> = new Set(['waiting_approval', 'needs_review', 'reopened', 'in_progress', 'waiting_data'])

/** Severity order for the queue: the worst first. */
const SEVERITY_RANK: Readonly<Record<string, number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/**
 * Read the board unit's item table from one JSON storage document.
 * @param source - the `faberloom_board.json` text.
 * @param spaces - space id → title, for naming each item's Space.
 * @returns the items, worst first, or undefined when the document is not a unit.
 */
export function parseBoard(source: string, spaces: ReadonlyMap<string, string> = new Map()): readonly BoardItem[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return undefined
  }
  const tables = field(parsed, 'tables')
  const items = field(tables, 'items')
  if (items === null || typeof items !== 'object') return undefined
  const rows: BoardItem[] = []
  for (const value of Object.values(items as Record<string, unknown>)) {
    const title = text(value, 'title')
    if (title.length === 0) continue
    const spaceId = text(value, 'spaceId')
    rows.push({
      title,
      status: text(value, 'status') || text(value, 'state') || 'in_progress',
      severity: text(value, 'severity'),
      dueAt: text(value, 'dueAt'),
      space: spaces.get(spaceId) ?? (spaceId.length === 0 ? 'sin espacio' : spaceId),
    })
  }
  return rows.sort((left, right) => {
    const open = Number(!OPEN_STATUSES.has(left.status)) - Number(!OPEN_STATUSES.has(right.status))
    if (open !== 0) return open
    const severity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
    if (severity !== 0) return severity
    return left.dueAt.localeCompare(right.dueAt)
  })
}

/**
 * Read the space table from one JSON storage document.
 * @param source - the `faberloom_spaces.json` text.
 * @returns space id → title.
 */
export function parseSpaces(source: string): ReadonlyMap<string, string> {
  const spaces = new Map<string, string>()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return spaces
  }
  const table = field(field(parsed, 'tables'), 'spaces')
  if (table === null || typeof table !== 'object') return spaces
  for (const [id, value] of Object.entries(table as Record<string, unknown>)) {
    const title = text(value, 'title')
    if (title.length > 0) spaces.set(id, title)
  }
  return spaces
}

/**
 * The queue report `/mesa` prints.
 * @param items - every item the board holds.
 * @param limit - most rows to list.
 * @returns the transcript text.
 */
export function boardReport(items: readonly BoardItem[], limit = 20): string {
  const open = items.filter(item => OPEN_STATUSES.has(item.status))
  if (open.length === 0) return 'La Mesa no tiene ítems abiertos.'
  const rows = open.slice(0, limit).map((item) => {
    const severity = item.severity.length === 0 ? '—' : item.severity
    const due = item.dueAt.length === 0 ? '' : ` · vence ${item.dueAt.slice(0, 10)}`
    return `- [${severity}] ${item.title} · ${item.status} · ${item.space}${due}`
  })
  const rest = open.length > rows.length ? `\n… y ${String(open.length - rows.length)} más` : ''
  return [`Mesa de trabajo — ${String(open.length)} ítems abiertos`, ...rows].join('\n') + rest
}

/** One agent the projection listed. */
export interface ProjectedAgent {
  /** Catalog id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** File under `.claude/agents`, when the projection wrote one. */
  readonly file?: string
}

/** What one projection run recorded, as the status line and commands read it. */
export interface ProjectionSummary {
  /** Scope title the product knows, or the folder name when the manifest omits it. */
  readonly scope: string
  /** Scope kind: `space` or `workspace`. */
  readonly kind: string
  /** ISO-8601 instant the projection ran. */
  readonly generatedAt: string
  /** Agents the projection wrote. */
  readonly agents: readonly ProjectedAgent[]
  /** Skill names the projection wrote. */
  readonly skills: readonly string[]
  /** Workflow names the projection recorded. */
  readonly workflows: readonly string[]
  /** Routine names the projection recorded. */
  readonly routines: readonly string[]
  /** Memory entries the projection recorded. */
  readonly memory: number
  /** Context entries the projection recorded. */
  readonly context: number
}

/** Read one field of an unknown object without trusting its shape. */
function field(value: unknown, name: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[name] : undefined
}

/** Read a string field, or an empty string. */
function text(value: unknown, name: string): string {
  const entry = field(value, name)
  return typeof entry === 'string' ? entry : ''
}

/** Read an array field, or an empty array. */
function list(value: unknown, name: string): readonly unknown[] {
  const entry = field(value, name)
  return Array.isArray(entry) ? entry : []
}

/** Read the `name` of every object in one array field. */
function names(value: unknown, name: string): readonly string[] {
  return list(value, name)
    .map(entry => text(entry, 'name'))
    .filter(name => name.length > 0)
}

/**
 * Parse one manifest.
 * @param source - the manifest text.
 * @param fallbackScope - title to report when the manifest names no scope.
 * @returns the summary, or undefined when the text is not a projection manifest.
 */
export function parseProjection(source: string, fallbackScope = 'Espacio'): ProjectionSummary | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return undefined
  }
  const version = field(parsed, 'version')
  if (typeof version !== 'number') return undefined
  const scope = field(parsed, 'scope')
  const agents = list(parsed, 'agents').flatMap((entry): ProjectedAgent[] => {
    const id = text(entry, 'id')
    const name = text(entry, 'name')
    if (name.length === 0) return []
    const file = text(entry, 'file')
    return [{ id: id.length === 0 ? name : id, name, ...(file.length === 0 ? {} : { file }) }]
  })
  return {
    scope: text(scope, 'title') || text(scope, 'id') || fallbackScope,
    kind: text(scope, 'kind') || 'space',
    generatedAt: text(parsed, 'generatedAt'),
    agents,
    skills: names(parsed, 'skills'),
    workflows: names(parsed, 'workflows'),
    routines: names(parsed, 'routines'),
    memory: list(parsed, 'memory').length,
    context: list(parsed, 'context').length,
  }
}

/**
 * The one line the mod keeps under the prompt.
 * @param summary - the projection the folder carries.
 * @returns the status text.
 */
export function statusLine(summary: ProjectionSummary): string {
  const parts = [
    `FaberLoom · ${summary.scope}`,
    `${String(summary.agents.length)} agentes`,
    `${String(summary.skills.length)} skills`,
  ]
  if (summary.workflows.length > 0) parts.push(`${String(summary.workflows.length)} flujos`)
  if (summary.memory > 0) parts.push(`${String(summary.memory)} memoria`)
  return parts.join(' · ')
}

/**
 * The `/faberloom` report.
 * @param summary - the projection the folder carries.
 * @returns the transcript text.
 */
export function statusReport(summary: ProjectionSummary): string {
  const lines = [
    `FaberLoom — ${summary.scope} (${summary.kind})`,
    `Proyección: ${summary.generatedAt.length === 0 ? 'sin fecha' : summary.generatedAt}`,
    `Agentes: ${summary.agents.length === 0 ? 'ninguno' : summary.agents.map(agent => agent.name).join(', ')}`,
    `Skills: ${summary.skills.length === 0 ? 'ninguna' : summary.skills.join(', ')}`,
  ]
  if (summary.workflows.length > 0) lines.push(`Flujos: ${summary.workflows.join(', ')}`)
  if (summary.routines.length > 0) lines.push(`Rutinas: ${summary.routines.join(', ')}`)
  if (summary.memory > 0 || summary.context > 0) {
    lines.push(`Memoria: ${summary.memory} entradas · Contexto: ${summary.context} entradas`)
  }
  lines.push('')
  lines.push('Claude Code ya carga `CLAUDE.md`, `.claude/agents/` y `.claude/skills/` de esta carpeta; el catálogo del Space está activo.')
  return lines.join('\n')
}

/**
 * The folder a hook should read, with no trailing separator.
 * @param cwd - the session's working directory.
 * @returns the folder path.
 */
export function scopeFolder(cwd: string): string {
  return cwd.replace(/[\\/]+$/, '')
}
