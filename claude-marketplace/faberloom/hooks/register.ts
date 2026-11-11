/**
 * FaberLoom for Claude Code.
 *
 * A Space or Workspace folder carries the projection the product wrote:
 * `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, and one manifest at
 * `.faberloom/harness.json`. Claude Code loads those definitions on its own, so
 * this mod adds what the folder cannot show by itself: a status line with the
 * scope the folder belongs to, and commands that report the catalog.
 */
import { MANIFEST_PATH, parseProjection, scopeFolder, statusLine, statusReport, type ProjectionSummary } from './manifest.ts'

/** Commands this mod contributes. */
const COMMANDS = [
  { name: 'faberloom', description: 'Report the FaberLoom Space projected into this folder' },
  { name: 'agentes', description: "List the Space's agents and where each definition lives" },
  { name: 'skills', description: "List the Space's skills" },
  { name: 'mesa', description: 'Summarize the flujos, rutinas, memoria y contexto the projection recorded' },
] as const

/**
 * Read the projection of the folder the session runs in.
 * @param $ - the mods API.
 * @param cwd - the session's working directory.
 * @returns the summary, or undefined when the folder carries no projection.
 */
async function readProjection($, cwd: string): Promise<ProjectionSummary | undefined> {
  const folder = scopeFolder(cwd)
  const file = `${folder}/${MANIFEST_PATH}`
  if (!(await $.fs.exists(file))) return undefined
  const source = await $.fs.read(file)
  const name = folder.split(/[\\/]/).pop() ?? 'Espacio'
  return parseProjection(source, name)
}

/**
 * Publish the status line for one folder, clearing it when the folder carries
 * no projection.
 * @param $ - the mods API.
 */
async function refreshStatus($): Promise<void> {
  try {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined) {
      await $.ui.status('')
      return
    }
    await $.ui.status(statusLine(summary))
  } catch {
    // A status line is decoration: a folder that cannot be read leaves it alone.
  }
}

/**
 * Register the mod.
 * @param on - the hook registrar Claude Code calls once at load.
 */
export function register(on): void {
  on('session.start', async ($, e, next) => {
    // A command name already taken throws and would skip the rest of this hook.
    for (const command of COMMANDS) {
      try {
        await $.command.register({ name: command.name, description: command.description })
      } catch {
        // The command stays absent; the others still register.
      }
    }
    await refreshStatus($)
    return next(e)
  })

  on('command.run', { command: 'faberloom' }, async ($) => {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined) {
      return {
        text: 'Esta carpeta no tiene una proyección de FaberLoom. Elegí la carpeta de un Space en FaberLoom y volvé a abrir la sesión ahí.',
      }
    }
    return { text: statusReport(summary) }
  })

  on('command.run', { command: 'agentes' }, async ($) => {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined || summary.agents.length === 0) return { text: 'No hay agentes proyectados en esta carpeta.' }
    return {
      text: summary.agents
        .map(agent => `- ${agent.name}${agent.file === undefined ? '' : ` — .claude/agents/${agent.file}`}`)
        .join('\n'),
    }
  })

  on('command.run', { command: 'skills' }, async ($) => {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined || summary.skills.length === 0) return { text: 'No hay skills proyectadas en esta carpeta.' }
    return { text: summary.skills.map(skill => `- ${skill} — .claude/skills/${skill}/SKILL.md`).join('\n') }
  })

  on('command.run', { command: 'mesa' }, async ($) => {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined) return { text: 'Esta carpeta no tiene una proyección de FaberLoom.' }
    const lines = [
      `Mesa de ${summary.scope}`,
      `Flujos: ${summary.workflows.length === 0 ? 'ninguno' : summary.workflows.join(', ')}`,
      `Rutinas: ${summary.routines.length === 0 ? 'ninguna' : summary.routines.join(', ')}`,
      `Memoria: ${summary.memory} entradas · Contexto: ${summary.context} entradas`,
      '',
      'La cola de la Mesa vive en la aplicación FaberLoom; esto es lo que la proyección dejó en la carpeta.',
    ]
    return { text: lines.join('\n') }
  })

  on('turn.complete', async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })
}
