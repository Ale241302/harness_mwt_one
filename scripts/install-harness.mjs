#!/usr/bin/env node
/**
 * Instalador de harness: una carpeta, o un `.zip`, que trae el juego completo de
 * un equipo —skills, agentes, reglas, comandos y scripts— y lo instala en la casa
 * del usuario, que es donde toda sesión de todo Workspace y Espacio ya los lee.
 *
 * Es el motor que el panel usará cuando el botón «Instalar harness» sustituya al
 * bloque de skills: el mapeo de cada pieza a su raíz y a su lector vive aquí, una
 * vez, y la interfaz solo aporta la carpeta y muestra el informe.
 *
 * Uso:
 *   node scripts/install-harness.mjs <carpeta-o-zip> [--home <dir>] [--replace] [--dry-run]
 *
 * Sin `--home` usa `%USERPROFILE%\.dsh` (o `$DSH_HOME`). Sale 0 cuando instaló o no
 * había nada que hacer, 1 cuando alguna pieza se rechazó y 2 cuando la invocación
 * no nombra un origen legible.
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Nombre del archivo de instrucciones globales que el harness lee en cada petición. */
const INSTRUCTIONS_FILE = 'AGENTS.md'

/** Marcas del bloque gestionado del archivo de instrucciones. */
const BLOCK_BEGIN = '<!-- faberloom-harness:begin -->'
const BLOCK_END = '<!-- faberloom-harness:end -->'

/** Nombre kebab-case que el harness acepta para una skill o un agente. */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Raíces de skills, en orden de preferencia, dentro de un harness. */
const SKILL_DIRS = ['skills', 'skills-shared', 'skills-catalog']

/** Raíces de agentes, en orden de preferencia, dentro de un harness. */
const AGENT_DIRS = ['agents', 'agents-shared']

/** Raíces de reglas siempre-activas, en orden de preferencia. */
const RULE_DIRS = ['rules', '.agents/rules']

/** Carpetas que se copian tal cual al home, con su nombre, sin lector propio todavía. */
const OPAQUE_DIRS = ['commands', 'scripts', 'hooks', 'mcp-configs']

/**
 * Punto de entrada.
 * @returns {Promise<number>} el código de salida.
 */
async function main() {
  const argv = process.argv.slice(2)
  const source = argv.find(argument => !argument.startsWith('--'))
  if (source === undefined) {
    process.stderr.write('uso: node scripts/install-harness.mjs <carpeta-o-zip> [--home <dir>] [--replace] [--dry-run]\n')
    return 2
  }
  const home = resolve(flagValue(argv, '--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const replace = argv.includes('--replace')
  const dryRun = argv.includes('--dry-run')

  let root = resolve(source)
  let scratch
  if (!existsSync(root)) {
    process.stderr.write(`origen no encontrado: ${root}\n`)
    return 2
  }
  if (extname(root).toLowerCase() === '.zip') {
    scratch = await mkdtemp(join(tmpdir(), 'faberloom-harness-'))
    const unpacked = unpackArchive(root, scratch)
    if (unpacked !== 0) return 2
    root = await singleDirectory(scratch)
  }
  const info = await stat(root)
  if (!info.isDirectory()) {
    process.stderr.write(`el origen no es una carpeta ni un .zip: ${root}\n`)
    return 2
  }

  const detected = await detect(root)
  process.stdout.write(`harness: ${root}\n`)
  process.stdout.write(`destino: ${home}${dryRun ? '  (ensayo: no se escribe nada)' : ''}\n`)
  const report = await install(detected, home, { replace, dryRun })
  for (const line of report.lines) process.stdout.write(`${line}\n`)
  process.stdout.write(
    `skills ${report.counts.skills} · agentes ${report.counts.agents} · reglas ${report.counts.rules}`
    + ` · comandos ${report.counts.commands} · scripts ${report.counts.scripts} · rechazados ${report.counts.refused}\n`,
  )
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
  return report.counts.refused > 0 ? 1 : 0
}

/**
 * El valor de un flag con forma `--flag valor`.
 * @param {string[]} argv - argumentos del proceso.
 * @param {string} flag - el flag buscado.
 * @returns {string | undefined} el valor, o undefined.
 */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index < 0 ? undefined : argv[index + 1]
}

/**
 * Descomprime un `.zip` con la herramienta del sistema: `tar` (bsdtar en Windows 10+
 * y cualquier Linux/macOS moderno) lo entiende sin dependencias nuevas.
 * @param {string} archive - ruta del archivo.
 * @param {string} into - carpeta destino, ya creada.
 * @returns {number} el código de salida del desempaquetado.
 */
function unpackArchive(archive, into) {
  const tar = spawnSync('tar', ['-xf', archive, '-C', into], { stdio: 'inherit' })
  if (tar.status === 0) return 0
  const unzip = spawnSync('unzip', ['-o', '-q', archive, '-d', into], { stdio: 'inherit' })
  if (unzip.status === 0) return 0
  process.stderr.write('no se pudo descomprimir: hace falta `tar` o `unzip` en el PATH\n')
  return 2
}

/**
 * La única carpeta de nivel uno dentro de otra, que es lo que deja un `.zip` que
 * empaqueta su raíz.
 * @param {string} parent - carpeta que contiene lo descomprimido.
 * @returns {Promise<string>} la carpeta del harness.
 */
async function singleDirectory(parent) {
  const entries = await readdir(parent, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory())
  if (directories.length === 1 && entries.length === 1) return join(parent, directories[0].name)
  return parent
}

/**
 * Reconoce qué trae un harness: qué roots de cada tipo existen y qué candidatas
 * válidas hay dentro.
 * @param {string} root - carpeta del harness.
 * @returns {Promise<object>} el inventario.
 */
async function detect(root) {
  const inventory = {
    root, skills: [], agents: [], rules: [], refused: [], opaque: {},
  }
  for (const directory of SKILL_DIRS) {
    const path = join(root, directory)
    if (!await isDirectory(path)) continue
    // `skills-catalog/<rol>/<skill>/SKILL.md` es el catalogo por rol del despliegue:
    // sus subcarpetas son roots de skills, no skills.
    const roots = directory === 'skills-catalog'
      ? (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))
      : [path]
    for (const candidateRoot of roots) {
      for (const candidate of await skillCandidates(candidateRoot)) inventory.skills.push(candidate)
    }
  }
  if (!inventory.skills.some(skill => skill.directory === root)) {
    const single = await readSkill(join(root, 'SKILL.md'))
    if (single !== undefined) inventory.skills.push({ ...single, directory: root })
  }
  for (const directory of AGENT_DIRS) {
    const path = join(root, directory)
    if (!await isDirectory(path)) continue
    const found = await agentCandidates(path)
    inventory.agents.push(...found.agents)
    inventory.refused.push(...found.refused)
  }
  for (const directory of RULE_DIRS) {
    const path = join(root, directory)
    if (!await isDirectory(path)) continue
    inventory.rules.push(...await markdownFiles(path))
  }
  if (existsSync(join(root, INSTRUCTIONS_FILE))) inventory.rules.push(join(root, INSTRUCTIONS_FILE))
  for (const directory of OPAQUE_DIRS) {
    const path = join(root, directory)
    if (await isDirectory(path)) inventory.opaque[directory] = path
    else if (await isFile(path)) inventory.opaque[directory] = path
  }
  for (const skill of inventory.skills) {
    if (!NAME_RE.test(skill.name)) inventory.refused.push(`skill ${skill.name} (nombre no kebab-case)`)
  }
  return inventory
}

/**
 * Las skills de una carpeta de skills: la carpeta es una skill cuando lleva su
 * propio `SKILL.md`, y si no lo es cada subcarpeta con `SKILL.md` es una.
 * @param {string} directory - la raíz de skills.
 * @returns {Promise<object[]>} las skills encontradas.
 */
async function skillCandidates(directory) {
  const single = await readSkill(join(directory, 'SKILL.md'))
  if (single !== undefined) return [{ ...single, directory }]
  const entries = await readdir(directory, { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const candidate = await readSkill(join(directory, entry.name, 'SKILL.md'))
    if (candidate !== undefined) found.push({ ...candidate, directory: join(directory, entry.name) })
  }
  return found
}

/**
 * Un `SKILL.md` legible, con su nombre y su descripción.
 * @param {string} path - ruta del archivo.
 * @returns {Promise<{name: string} | undefined>} lo leído, o undefined.
 */
async function readSkill(path) {
  if (!existsSync(path)) return undefined
  const front = parseFrontmatter(await readFile(path, 'utf8'))
  if (front === undefined || typeof front.data.name !== 'string') return undefined
  return { name: front.data.name }
}

/**
 * Los agentes de una carpeta: carpetas de plantilla (`preset.yml`) y archivos
 * Markdown con frontmatter.
 * @param {string} directory - la raíz de agentes.
 * @returns {Promise<{agents: object[], refused: string[]}>} lo aceptado y lo rechazado.
 */
async function agentCandidates(directory) {
  const agents = []
  const refused = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!existsSync(join(path, 'preset.yml'))) {
        refused.push(`agente ${entry.name} (carpeta sin preset.yml)`)
        continue
      }
      if (!NAME_RE.test(entry.name)) {
        refused.push(`agente ${entry.name} (nombre no kebab-case)`)
        continue
      }
      agents.push({ id: entry.name, source: path, prompt: null })
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const id = basename(entry.name).replace(/\.md$/iu, '')
    const front = parseFrontmatter(await readFile(path, 'utf8'))
    if (front === undefined || typeof front.data.name !== 'string' || typeof front.data.description !== 'string') {
      refused.push(`agente ${entry.name} (sin name y description en el frontmatter)`)
      continue
    }
    if (!NAME_RE.test(id)) {
      refused.push(`agente ${entry.name} (nombre no kebab-case)`)
      continue
    }
    agents.push({ id, source: path, prompt: front.body.trim() })
  }
  return { agents, refused }
}

/**
 * Frontmatter YAML plano de un Markdown: `---`, pares `clave: valor`, `---`.
 * @param {string} text - contenido del archivo.
 * @returns {{data: Record<string, string>, body: string} | undefined} lo leído, o undefined.
 */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/u)
  if (lines[0] !== '---') return undefined
  const data = {}
  let index = 1
  for (; index < lines.length; index += 1) {
    if (lines[index] === '---') break
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(lines[index])
    if (match === null) continue
    const quoted = /^(['"])(.*)\1$/u.exec(match[2].trim())
    data[match[1]] = quoted?.[2] ?? match[2].trim()
  }
  if (index >= lines.length) return undefined
  return { data, body: lines.slice(index + 1).join('\n') }
}

/**
 * Los Markdown de una carpeta.
 * @param {string} directory - carpeta a leer.
 * @returns {Promise<string[]>} rutas de los `.md`, ordenadas.
 */
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => join(directory, entry.name))
    .sort()
}

/**
 * Instala el inventario en la casa: skills y agentes en sus raíces, reglas en el
 * archivo de instrucciones, y el resto copiado tal cual.
 * @param {object} inventory - lo detectado.
 * @param {string} home - casa del harness.
 * @param {{replace: boolean, dryRun: boolean}} options - cómo instalar.
 * @returns {Promise<{lines: string[], counts: Record<string, number>}>} el informe.
 */
async function install(inventory, home, options) {
  const lines = []
  const counts = { skills: 0, agents: 0, rules: 0, commands: 0, scripts: 0, refused: inventory.refused.length }
  for (const refused of inventory.refused) lines.push(`   rechazado: ${refused}`)

  for (const skill of inventory.skills) {
    const target = join(home, 'skills', skill.name)
    const outcome = await copyDirectory(skill.directory, target, options)
    lines.push(`   skill ${skill.name} -> ${target} (${outcome})`)
    if (outcome !== 'omitido') counts.skills += 1
  }

  for (const agent of inventory.agents) {
    const target = join(home, '.agent-presets', agent.id)
    let outcome
    if (agent.prompt === null) {
      outcome = await copyDirectory(agent.source, target, options)
    } else {
      outcome = await writeMarkdownAgent(agent, target, options)
    }
    lines.push(`   agente ${agent.id} -> ${target} (${outcome})`)
    if (outcome !== 'omitido') counts.agents += 1
  }

  if (inventory.rules.length > 0) {
    const outcome = await mergeRules(inventory.rules, join(home, INSTRUCTIONS_FILE), options)
    lines.push(`   reglas -> ${join(home, INSTRUCTIONS_FILE)} (${outcome})`)
    if (outcome !== 'omitido') counts.rules = inventory.rules.length
  }

  for (const [name, source] of Object.entries(inventory.opaque)) {
    const target = join(home, name)
    const outcome = await copyDirectory(source, target, options)
    lines.push(`   ${name} -> ${target} (${outcome})${name === 'hooks' || name === 'mcp-configs' ? '  [copiado: sin lector propio todavía]' : ''}`)
    if (name === 'commands' && outcome !== 'omitido') counts.commands += await countMarkdown(source)
    if (name === 'scripts' && outcome !== 'omitido') counts.scripts += await countFiles(source)
  }
  return { lines, counts }
}

/**
 * Copia una carpeta al destino.
 * @param {string} source - origen.
 * @param {string} target - destino.
 * @param {{replace: boolean, dryRun: boolean}} options - cómo instalar.
 * @returns {Promise<'instalado' | 'reemplazado' | 'omitido'>} qué hizo.
 */
async function copyDirectory(source, target, options) {
  const exists = existsSync(target)
  if (exists && !options.replace) return 'omitido'
  if (options.dryRun) return exists ? 'reemplazado' : 'instalado'
  await mkdir(dirname(target), { recursive: true })
  if (exists) await rm(target, { recursive: true, force: true })
  await cp(source, target, { recursive: true, force: true })
  return exists ? 'reemplazado' : 'instalado'
}

/**
 * Escribe un agente Markdown como carpeta de plantilla, con el cuerpo como persona.
 * @param {{id: string, prompt: string, source: string}} agent - el agente detectado.
 * @param {string} target - carpeta destino.
 * @param {{replace: boolean, dryRun: boolean}} options - cómo instalar.
 * @returns {Promise<'instalado' | 'reemplazado' | 'omitido'>} qué hizo.
 */
async function writeMarkdownAgent(agent, target, options) {
  const exists = existsSync(target)
  if (exists && !options.replace) return 'omitido'
  if (options.dryRun) return exists ? 'reemplazado' : 'instalado'
  await mkdir(target, { recursive: true })
  const name = basename(agent.source).replace(/\.md$/iu, '')
  await writeFile(join(target, 'preset.yml'), `name: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(`Instalado desde ${basename(agent.source)}`)}\n`, 'utf8')
  const body = agent.prompt.split('\n').map(line => (line.length === 0 ? '' : `      ${line}`)).join('\n')
  await writeFile(join(target, 'agent.cordis.yml'), [
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
  ].join('\n'), 'utf8')
  return exists ? 'reemplazado' : 'instalado'
}

/**
 * Escribe las reglas dentro del archivo de instrucciones del usuario, en un bloque
 * gestionado que una reinstalación reemplaza y nada más del archivo se toca.
 * @param {string[]} files - archivos de reglas.
 * @param {string} target - ruta del `AGENTS.md` del usuario.
 * @param {{replace: boolean, dryRun: boolean}} options - cómo instalar.
 * @returns {Promise<'instalado' | 'reemplazado' | 'omitido'>} qué hizo.
 */
async function mergeRules(files, target, options) {
  const existing = existsSync(target) ? await readFile(target, 'utf8') : ''
  const hasBlock = existing.includes(BLOCK_BEGIN)
  if (hasBlock && !options.replace) return 'omitido'
  const bodies = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    bodies.push(text.startsWith('---') ? (parseFrontmatter(text)?.body ?? text) : text)
  }
  const block = [BLOCK_BEGIN, ...bodies.map(body => body.trim()).filter(body => body.length > 0), BLOCK_END].join('\n')
  const without = hasBlock ? existing.replace(new RegExp(`${BLOCK_BEGIN}[\\s\\S]*?${BLOCK_END}`), '').trimEnd() : existing.trimEnd()
  const next = `${without === '' ? '' : `${without}\n\n`}${block}\n`
  if (options.dryRun) return hasBlock ? 'reemplazado' : 'instalado'
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, next, 'utf8')
  return hasBlock ? 'reemplazado' : 'instalado'
}

/** Cuenta los `.md` de una carpeta. */
async function countMarkdown(directory) {
  if (!(await isDirectory(directory))) return 0
  return (await markdownFiles(directory)).length
}

/** Cuenta los archivos de una carpeta, recursivamente. */
async function countFiles(directory) {
  if (await isFile(directory)) return 1
  if (!(await isDirectory(directory))) return 0
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    total += entry.isDirectory() ? await countFiles(path) : 1
  }
  return total
}

/** Si una ruta es una carpeta. */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Si una ruta es un archivo. */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

process.exitCode = await main()
