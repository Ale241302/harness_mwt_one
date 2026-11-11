/**
 * FaberLoom for Claude Code.
 *
 * A Space or Workspace folder carries the projection the product wrote:
 * `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, and one manifest at
 * `.faberloom/harness.json`. Claude Code loads those definitions on its own, so
 * this mod adds what the folder cannot show by itself: the Mesa's real queue
 * from the product storage, a status line naming the scope, MWT.ONE per company
 * through that company's MCP endpoint, the product catalog installed as the
 * operator's own agents and skills, and commands that report all of it.
 */
import {
  BOARD_UNIT, MANIFEST_PATH, SPACES_UNIT, boardReport, parseBoard, parseProjection, parseSpaces,
  scopeFolder, statusLine, statusReport, type ProjectionSummary,
} from './manifest.ts'
import { ACTIVE_KEY, COMPANIES_KEY, DEFAULT_CONSOLA_BASE, callTool, signIn, type MwtCompany } from './mwt.ts'

/** Commands this mod contributes. */
const COMMANDS = [
  { name: 'faberloom', description: 'Report the FaberLoom Space projected into this folder' },
  { name: 'agentes', description: "List the Space's agents and where each definition lives" },
  { name: 'faberloom-skills', description: "List the Space's skills" },
  { name: 'mesa', description: 'Show the Mesa queue the product storage holds' },
  { name: 'mwt', description: 'Sign in to MWT.ONE, list its companies, or pick the active one' },
  { name: 'faberloom-install', description: "Install FaberLoom's agents and skills into this Claude Code" },
] as const

/** Catalog generation this mod installs; a new value reinstalls once. */
const CATALOG_VERSION = '0.2.0'

/** Storage key recording the catalog already installed. */
const CATALOG_KEY = 'catalog.version'

/** Values Claude Code collected for `userConfig`; empty names are unset. */
let settings: Readonly<Record<string, unknown>> = {}

/** One collected option as trimmed text, or an empty string. */
function option(name: string): string {
  const value = settings[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The harness home that holds the product storage.
 * @param $ - the mods API.
 * @returns the home path.
 */
async function harnessHome($): Promise<string> {
  const declared = await $.env.get('DSH_HOME')
  if (typeof declared === 'string' && declared.length > 0) return declared.replace(/[\\/]+$/u, '')
  const home = await $.env.get('USERPROFILE') ?? await $.env.get('HOME') ?? ''
  return `${String(home).replace(/[\\/]+$/u, '')}/.dsh-oficial`
}

/**
 * The user's Claude directory, where native agents and skills live.
 * @param $ - the mods API.
 * @returns the path.
 */
async function claudeHome($): Promise<string> {
  const home = await $.env.get('USERPROFILE') ?? await $.env.get('HOME') ?? ''
  return `${String(home).replace(/[\\/]+$/u, '')}/.claude`
}

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
 * Read one storage unit, or undefined when the product never wrote it.
 * @param $ - the mods API.
 * @param unit - unit name (`faberloom_board`).
 * @returns the document text.
 */
async function readUnit($, unit: string): Promise<string | undefined> {
  const file = `${await harnessHome($)}/storages/${unit}.json`
  if (!(await $.fs.exists(file))) return undefined
  return await $.fs.read(file)
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
 * Copy the catalog the plugin carries into the user's own Claude directory, so
 * the agents are native subagents and the skills are native skills.
 *
 * The copy never overwrites: a name already present, including one the operator
 * edited, stays as it is. One shell process does the whole tree because the
 * hooks API copies one file at a time.
 * @param $ - the mods API.
 * @returns how many entries the destination holds afterwards.
 */
async function installCatalog($): Promise<{ agents: number; skills: number; target: string }> {
  const root = String(await $.plugin.root ?? '').replace(/[\\/]+$/u, '')
  const windows = (await $.env.get('OS')) === 'Windows_NT'
  // robocopy and cp run without a shell: `cmd /c` reinterpreted the quotes and
  // handed robocopy a mangled source path.
  const join = (base: string, ...parts: readonly string[]): string =>
    `${base.replace(/[\\/]+$/u, '')}${windows ? '\\' : '/'}${parts.join(windows ? '\\' : '/')}`
  const target = windows
    ? (await claudeHome($)).replace(/\//gu, '\\')
    : await claudeHome($)
  try {
    if (windows) {
      for (const part of ['skills', 'agents']) {
        const result = await $.process.run(
          ['robocopy', join(root, 'catalog', part), join(target, part), '/E', '/XC', '/XN', '/XO', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
          { timeoutMs: 300_000 },
        )
        // robocopy reports 0–7 for success; 8 and above are failures.
        if (typeof result.exitCode === 'number' && result.exitCode >= 8) {
          throw new Error(`robocopy ${part} exit ${String(result.exitCode)}`)
        }
      }
    } else {
      const script = ["mkdir -p", `"${target}/skills"`, `"${target}/agents"`, '&&', 'cp', '-Rn', `"${root}/catalog/skills/."`, `"${target}/skills/"`, '&&', 'cp', '-Rn', `"${root}/catalog/agents/."`, `"${target}/agents/"`].join(' ')
      const result = await $.process.run(['sh', '-c', script], { timeoutMs: 300_000 })
      if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
        throw new Error(`cp exit ${String(result.exitCode)}`)
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
  const count = async (dir: string): Promise<number> => {
    try {
      return (await $.fs.list(dir)).length
    } catch {
      return 0
    }
  }
  return { agents: await count(join(target, 'agents')), skills: await count(join(target, 'skills')), target }
}

/**
 * Sign in to the console with the credentials Claude Code collected, and keep
 * one company per credential. A stored file is the fallback for a headless run.
 * @param $ - the mods API.
 * @returns the company rows.
 */
async function connectCompanies($): Promise<readonly MwtCompany[]> {
  let usuario = option('mwt_usuario')
  let password = option('mwt_password')
  let base = option('mwt_consola_base')
  if (usuario.length === 0 || password.length === 0) {
    const home = await $.env.get('USERPROFILE') ?? await $.env.get('HOME') ?? ''
    const file = `${String(home).replace(/[\\/]+$/u, '')}/.faberloom/mwt.json`
    if (!(await $.fs.exists(file))) {
      throw new Error('Faltan las credenciales de MWT.ONE: ejecutá /plugin configure faberloom@faberloom y cargá usuario y contraseña, o guardalas en ~/.faberloom/mwt.json.')
    }
    const stored = JSON.parse(await $.fs.read(file)) as { usuario?: unknown; password?: unknown; consolaBase?: unknown }
    usuario = typeof stored.usuario === 'string' ? stored.usuario : ''
    password = typeof stored.password === 'string' ? stored.password : ''
    base = typeof stored.consolaBase === 'string' ? stored.consolaBase : ''
  }
  if (usuario.length === 0 || password.length === 0) throw new Error('El usuario o la contraseña de MWT.ONE están vacíos.')
  const companies = await signIn($, base.length === 0 ? DEFAULT_CONSOLA_BASE : base, usuario, password)
  await $.store.set(COMPANIES_KEY, companies)
  if ((await $.store.get(ACTIVE_KEY)) === undefined) await $.store.set(ACTIVE_KEY, companies[0]?.key ?? '')
  return companies
}

/**
 * Read the companies the store holds.
 * @param $ - the mods API.
 * @returns the company rows.
 */
async function storedCompanies($): Promise<readonly MwtCompany[]> {
  const stored = await $.store.get(COMPANIES_KEY)
  return Array.isArray(stored) ? stored as MwtCompany[] : []
}

/**
 * Register the mod.
 * @param on - the hook registrar Claude Code calls once at load.
 * @param options - collected `userConfig` values, defaults already filled.
 */
export function register(on, options = {}): void {
  settings = options as Readonly<Record<string, unknown>>

  on('session.start', async ($, e, next) => {
    // A command name already taken throws and would skip the rest of this hook.
    for (const command of COMMANDS) {
      try {
        await $.command.register({ name: command.name, description: command.description })
      } catch {
        // The command stays absent; the others still register.
      }
    }
    try {
      await $.tool.register({
        name: 'mwt',
        description: 'Call one MWT.ONE MCP tool for the active company. Use it for clientes, pedidos, expedientes, proformas, inventario y facturas.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'MCP tool name, as the company endpoint lists it' },
            input: { type: 'object', description: 'Tool arguments' },
          },
          required: ['name'],
        },
      })
    } catch {
      // A taken tool name leaves the rest of the mod working.
    }
    // One background pass per catalog generation: copying the tree is work the
    // hook budget should not hold.
    if ((await $.store.get(CATALOG_KEY)) !== CATALOG_VERSION) {
      $.clock.after(0, async () => {
        try {
          const installed = await installCatalog($)
          await $.store.set(CATALOG_KEY, CATALOG_VERSION)
          await $.ui.log(`faberloom: catálogo instalado en ${installed.target} (${String(installed.agents)} agentes, ${String(installed.skills)} skills)`)
        } catch (error) {
          await $.ui.log(`faberloom: no se pudo instalar el catálogo: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    await refreshStatus($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__faberloom__mwt' }, async ($, e) => {
    const companies = await storedCompanies($)
    const active = await $.store.get(ACTIVE_KEY)
    const company = companies.find(row => row.key === active) ?? companies[0]
    if (company === undefined) return { result: 'No hay empresa MWT conectada. Ejecutá /mwt para iniciar sesión.' }
    const name = typeof e.name === 'string' ? e.name : ''
    if (name.length === 0) return { result: 'Falta el nombre de la herramienta MWT.' }
    const input = e.input !== null && typeof e.input === 'object' ? e.input as Record<string, unknown> : {}
    try {
      return { result: await callTool($, company, name, input) }
    } catch (error) {
      return { result: error instanceof Error ? error.message : String(error) }
    }
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

  on('command.run', { command: 'faberloom-skills' }, async ($) => {
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined || summary.skills.length === 0) return { text: 'No hay skills proyectadas en esta carpeta.' }
    return { text: summary.skills.map(skill => `- ${skill} — .claude/skills/${skill}/SKILL.md`).join('\n') }
  })

  on('command.run', { command: 'faberloom-install' }, async ($) => {
    try {
      const installed = await installCatalog($)
      await $.store.set(CATALOG_KEY, CATALOG_VERSION)
      return {
        text: [
          `Catálogo instalado en ${installed.target}`,
          `Agentes: ${String(installed.agents)} · Skills: ${String(installed.skills)}`,

          'Lo que ya existía no se tocó. Los agentes se invocan con @agent-<nombre> y las skills con /<nombre>.',
        ].join('\n'),
      }
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) }
    }
  })

  on('command.run', { command: 'mesa' }, async ($) => {
    try {
      const board = await readUnit($, BOARD_UNIT)
      if (board !== undefined) {
        const spaces = await readUnit($, SPACES_UNIT)
        const items = parseBoard(board, spaces === undefined ? new Map() : parseSpaces(spaces))
        if (items !== undefined) return { text: boardReport(items) }
      }
    } catch {
      // A storage the product holds open falls through to the projection.
    }
    const summary = await readProjection($, await $.session.cwd())
    if (summary === undefined) return { text: 'No encuentro la Mesa: ni el storage del producto ni una proyección en esta carpeta.' }
    return {
      text: [
        `Mesa de ${summary.scope} (proyección)`,
        `Flujos: ${summary.workflows.length === 0 ? 'ninguno' : summary.workflows.join(', ')}`,
        `Rutinas: ${summary.routines.length === 0 ? 'ninguna' : summary.routines.join(', ')}`,
        `Memoria: ${summary.memory} entradas · Contexto: ${summary.context} entradas`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'mwt' }, async ($, e) => {
    // A thrown command surfaces as "no command.run hook answered it", so every
    // failure becomes the text the operator reads.
    try {
      const wanted = (typeof e.args === 'string' ? e.args : '').trim()
      const companies = await storedCompanies($)
      if (wanted.length === 0) {
        if (companies.length === 0) {
          const fresh = await connectCompanies($)
          const active = await $.store.get(ACTIVE_KEY)
          return {
            text: [
              `Conectado a MWT.ONE: ${fresh.map(row => row.name).join(', ')}`,
              `Empresa activa: ${String(active)}`,
              'Cambiá de empresa con /mwt <clave>.',
            ].join('\n'),
          }
        }
        const active = String(await $.store.get(ACTIVE_KEY) ?? '')
        return {
          text: [
            `Empresas conectadas: ${companies.map(row => `${row.key} (${row.name})`).join(', ')}`,
            `Activa: ${active.length === 0 ? 'ninguna' : active}`,
          ].join('\n'),
        }
      }
      const match = companies.find(row => row.key === wanted)
      if (match === undefined) {
        return { text: `No hay una empresa "${wanted}". Conectadas: ${companies.map(row => row.key).join(', ')}` }
      }
      await $.store.set(ACTIVE_KEY, match.key)
      return { text: `Empresa activa: ${match.name} (${match.key})` }
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) }
    }
  })

  on('turn.complete', async ($, e, next) => {
    await refreshStatus($)
    return next(e)
  })
}
