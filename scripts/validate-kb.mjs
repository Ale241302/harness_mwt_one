/**
 * Valida una carpeta KB (harness portable) antes de instalarla: comprueba que
 * cada `skills/<nombre>/SKILL.md` cumple las mismas reglas que aplica
 * `@deepseek-ai/dsh-skill-install` al detectar una carpeta (frontmatter YAML
 * legible, `name` y `description` presentes, `name` kebab-case), que cada
 * agente de `agents/` declara nombre y prompt, que `kb.json` describe el
 * contenido y que ningún archivo lleva BOM ni retorno de carro.
 *
 *   node scripts/validate-kb.mjs <carpeta-kb>
 *
 * Los motivos de rechazo de una skill se imprimen con el código que usa el
 * instalador (`missing-skill-md`, `bad-frontmatter`, `missing-name`,
 * `invalid-name`), de modo que el mensaje del validador y el del producto se
 * puedan cotejar.
 *
 * Códigos de salida: 0 sin errores (puede haber avisos), 1 hay errores,
 * 2 invocación incorrecta.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, basename, extname } from 'node:path'

const USO = 'uso: node scripts/validate-kb.mjs <carpeta-kb>'

/** Gramática de nombre del harness: `packages/skill/skill/src/index.ts` (SKILL_NAME). */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Handlers de paso que registra `packages/faberloom/handlers` (HANDLER_NAMES). */
const HANDLERS = new Set([
  'wait', 'agent', 'mcp', 'backup',
  'email.send', 'email.extract-spreadsheet-link', 'email.followup',
])

/** Tipos de nodo del flujo: unión discriminada de `packages/faberloom/workflows/src/spec.ts`. */
const NODE_KINDS = new Set([
  'trigger.manual', 'trigger.schedule', 'trigger.email', 'trigger.event', 'trigger.board',
  'agent', 'skill', 'mcp.call', 'imap.action', 'smtp.send', 'memory.remember',
  'memory.teach', 'board.create', 'space.reference', 'routine.invoke', 'condition',
  'transform', 'wait', 'notify', 'deadletter',
])

const root = process.argv[2]
if (root === undefined || root.length === 0) {
  console.error(USO)
  process.exit(2)
}
const kb = resolve(root)
const cwd = process.cwd()

/** Ruta para mostrar: relativa al directorio de trabajo cuando está dentro. */
function show(path) {
  const rel = relative(cwd, path)
  return (rel.length === 0 ? path : rel).split('\\').join('/')
}

const problems = []
const warn = (file, message) => { problems.push({ level: 'aviso', file, message }) }
const fail = (file, message) => { problems.push({ level: 'error', file, message }) }

/** ¿Existe y es un directorio? */
function isDir(path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

/** ¿Existe y es un archivo? */
function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

/**
 * Lee un archivo y comprueba el BOM. El texto se devuelve tal cual, sin quitar
 * el BOM: el producto compara la primera línea con `---`, así que un archivo con
 * BOM falla también la comprobación del frontmatter, y conviene que este
 * validador lo diga por las dos vías.
 */
function readText(path) {
  const bytes = readFileSync(path)
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (bom) fail(path, 'lleva BOM al principio: la primera línea no es `---` y el producto ignora el archivo (vuelve a guardarlo en UTF-8 sin BOM)')
  const text = bytes.toString('utf8')
  if (text.includes('\r\n')) warn(path, 'usa retorno de carro (CRLF): el repositorio y los archivos de la KB van con salto de línea LF')
  return text
}

/** Las líneas de un texto, sin el `\r` final. */
function linesOf(text) {
  return text.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
}

/**
 * Parte el frontmatter de un archivo Markdown. Replica el criterio de
 * `parseSkillFrontmatter` (`packages/skill/skill-filesystem`): la primera línea
 * tiene que ser exactamente `---` y el bloque cierra en la siguiente línea que
 * sea exactamente `---`.
 * @returns las líneas del frontmatter y el cuerpo, o undefined si no hay bloque.
 */
function splitFrontmatter(text) {
  const lines = linesOf(text)
  if (lines[0] !== '---') return undefined
  const closing = lines.indexOf('---', 1)
  if (closing < 0) return undefined
  return { front: lines.slice(1, closing), body: lines.slice(closing + 1).join('\n') }
}

/** Bloque escalar de YAML (`|`, `>`, `|-`, `>-`, `|+`, `>+`). */
function isBlockScalar(value) {
  return /^[|>][+-]?$/.test(value)
}

/**
 * Lee el frontmatter como pares clave/valor, con las secuencias de bloque
 * (`- elemento`) unidas por espacio. No es un analizador YAML completo: la
 * comprobación que interesa aquí es la del producto (claves presentes y valor
 * escalar legible), no la del dialecto entero.
 * @returns las entradas `{ key, value, line }` y si el bloque es ilegible.
 */
function readFields(front, file) {
  const fields = new Map()
  const duplicated = new Set()
  let invalid = false
  let current
  for (let index = 0; index < front.length; index++) {
    const raw = front[index]
    const line = index + 1
    if (raw.trim().length === 0 || raw.trimStart().startsWith('#')) continue
    const item = /^\s+-\s*(.*)$/.exec(raw)
    if (item !== null && current !== undefined) {
      const value = item[1].trim()
      if (!/^[\w./-]+$/.test(value)) warn(file, `frontmatter línea ${String(line)}: el elemento de lista ${JSON.stringify(value)} no es un nombre simple`)
      fields.set(current, `${fields.get(current)} ${value}`.trim())
      continue
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw)
    if (pair === null) {
      fail(file, `frontmatter línea ${String(line)}: no es una clave YAML (${JSON.stringify(raw.trim())})`)
      invalid = true
      continue
    }
    const key = pair[1]
    const value = pair[2].trim()
    if (fields.has(key)) duplicated.add(key)
    current = key
    fields.set(key, value)
    if (value.length === 0) continue
    if (isBlockScalar(value)) continue
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    if (value.startsWith('"') !== value.endsWith('"') && value.startsWith('"')) {
      fail(file, `frontmatter línea ${String(line)}: la comilla de ${key} no cierra`)
      invalid = true
    }
    // Un escalar sin citar no puede contener ": " en YAML: es la clase de fallo
    // que dejó el catálogo de skills sin cargar (descripción con dos puntos).
    if (!quoted && value.includes(': ')) {
      fail(file, `frontmatter línea ${String(line)}: ${key} lleva dos puntos sin citar; entrecomilla el valor o el YAML no parsea`)
      invalid = true
    }
    if (value.startsWith('\t')) {
      fail(file, `frontmatter línea ${String(line)}: ${key} usa tabulación, YAML no la admite como sangría`)
      invalid = true
    }
  }
  for (const key of duplicated) warn(file, `frontmatter: la clave ${key} aparece más de una vez; YAML se queda con la última`)
  return { fields, invalid }
}

/** Comprueba el frontmatter común de una skill o de un agente. */
function checkFrontmatter(path, required) {
  const text = readText(path)
  const split = splitFrontmatter(text)
  if (split === undefined) {
    fail(path, '[bad-frontmatter] no tiene bloque de frontmatter YAML (primera línea `---`, cierre en otra línea `---`)')
    return undefined
  }
  const { fields, invalid } = readFields(split.front, path)
  // Un bloque que el producto no puede parsear no aporta nombre ni descripción:
  // los errores ya están registrados y el candidato no cuenta como válido.
  if (invalid) {
    fail(path, '[bad-frontmatter] el frontmatter no parsea como YAML')
    return undefined
  }
  for (const key of required) {
    const value = fields.get(key)
    if (value === undefined) {
      fail(path, `[missing-name] falta ${key} en el frontmatter`)
      continue
    }
    if (value.length === 0) {
      fail(path, `[missing-name] ${key} está vacío`)
      continue
    }
    if (value.startsWith('"') || value.startsWith("'")) fields.set(key, value.slice(1, -1))
  }
  return { fields, body: split.body }
}

/** Nombres de archivo de un directorio, sin lanzar si no existe. */
function entriesOf(path) {
  try { return readdirSync(path, { withFileTypes: true }) } catch { return [] }
}

const report = { skills: [], agents: [], routines: [], workflows: [], context: [] }

// ── Archivos obligatorios de la raíz ──────────────────────────────────────────
if (!isDir(kb)) {
  console.error(`no es una carpeta: ${show(kb)}`)
  console.error(USO)
  process.exit(2)
}
for (const required of ['AGENTS.md', 'kb.json']) {
  if (!isFile(join(kb, required))) fail(join(kb, required), `[missing] falta el archivo obligatorio ${required} en la raíz de la KB`)
}
if (isFile(join(kb, 'AGENTS.md'))) {
  const text = readText(join(kb, 'AGENTS.md'))
  if (text.trim().length === 0) fail(join(kb, 'AGENTS.md'), 'está vacío')
}

// ── skills/<nombre>/SKILL.md ──────────────────────────────────────────────────
const skillsDir = join(kb, 'skills')
if (!isDir(skillsDir)) {
  fail(skillsDir, '[missing-skill-md] falta la carpeta skills/ con al menos una skill')
} else {
  for (const entry of entriesOf(skillsDir).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(skillsDir, entry.name)
    if (!entry.isDirectory()) {
      fail(path, entry.name.endsWith('.md')
        ? '[missing-skill-md] una skill suelta en un único .md no se instala: usa skills/<nombre>/SKILL.md'
        : 'la carpeta skills/ solo admite directorios de skill')
      continue
    }
    const files = entriesOf(path).map(item => item.name)
    const skillFile = files.find(name => name === 'SKILL.md')
    if (skillFile === undefined) {
      const wrongCase = files.find(name => name.toLowerCase() === 'skill.md')
      fail(path, wrongCase === undefined
        ? '[missing-skill-md] el directorio no contiene SKILL.md'
        : `[missing-skill-md] el archivo se llama ${wrongCase}: tiene que llamarse exactamente SKILL.md`)
      continue
    }
    const checked = checkFrontmatter(join(path, skillFile), ['name', 'description'])
    if (checked === undefined) continue
    const name = checked.fields.get('name')
    if (name === undefined) continue
    if (!KEBAB.test(name)) {
      fail(join(path, skillFile), `[invalid-name] ${JSON.stringify(name)} no es kebab-case: minúsculas, dígitos y guiones (por ejemplo ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mi-skill'})`)
    }
    if (name !== entry.name) warn(join(path, skillFile), `el name del frontmatter (${name}) no coincide con la carpeta (${entry.name}); la instalación crea una carpeta con el name`)
    if (checked.body.trim().length === 0) warn(join(path, skillFile), 'el cuerpo está vacío: la skill se enruta pero no explica ningún procedimiento')
    report.skills.push(name)
  }
  if (report.skills.length === 0) fail(skillsDir, '[missing-skill-md] no hay ninguna skill válida en skills/')
}

// ── agents/<nombre>.md (forma propuesta) o agents/<nombre>/AGENT.md ───────────
const agentsDir = join(kb, 'agents')
if (!isDir(agentsDir)) {
  fail(agentsDir, 'falta la carpeta agents/ con al menos un agente')
} else {
  for (const entry of entriesOf(agentsDir).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(agentsDir, entry.name)
    let file
    let stem
    if (entry.isFile() && extname(entry.name) === '.md') {
      file = path
      stem = basename(entry.name, '.md')
    } else if (entry.isDirectory()) {
      const agentFile = entriesOf(path).map(item => item.name).find(name => name === 'AGENT.md')
      if (agentFile === undefined) {
        fail(path, 'un directorio de agente tiene que contener AGENT.md (o usa la forma agents/<nombre>.md)')
        continue
      }
      file = join(path, agentFile)
      stem = entry.name
    } else {
      warn(path, 'no es un agente: en agents/ solo van agents/<nombre>.md o agents/<nombre>/AGENT.md')
      continue
    }
    const checked = checkFrontmatter(file, ['name', 'description'])
    if (checked === undefined) continue
    const name = checked.fields.get('name')
    if (name === undefined) continue
    if (!KEBAB.test(name)) {
      fail(file, `[invalid-name] ${JSON.stringify(name)} no es kebab-case: minúsculas, dígitos y guiones`)
    }
    if (name !== stem) {
      fail(file, `el name del frontmatter (${name}) no coincide con ${stem}; el nombre del archivo (o del directorio) es el nombre del agente`)
    }
    if (checked.body.trim().length === 0) fail(file, 'el cuerpo está vacío: el cuerpo del agente es su prompt')
    const listed = checked.fields.get('skills')
    for (const skill of listed === undefined ? [] : listed.split(' ')) {
      if (!KEBAB.test(skill)) fail(file, `la skill ${JSON.stringify(skill)} del agente no es un nombre kebab-case`)
    }
    report.agents.push(name)
  }
  if (report.agents.length === 0) fail(agentsDir, 'no hay ningún agente válido en agents/')
}

// ── routines/ y workflows/: el formato de definición del producto ─────────────
function readJson(path) {
  if (!isFile(path)) {
    fail(path, '[missing] el manifiesto lo nombra y el archivo no existe')
    return undefined
  }
  const text = readText(path)
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(path, `no es JSON válido: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function checkRoutine(path) {
  const value = readJson(path)
  if (value === undefined) return
  if (typeof value.name !== 'string' || value.name.trim().length === 0) fail(path, 'falta el nombre de la rutina (name)')
  const definition = value.definition
  if (typeof definition !== 'object' || definition === null) {
    fail(path, 'falta la definición (definition)')
    return
  }
  for (const key of ['intent', 'expectedResult']) {
    if (typeof definition[key] !== 'string' || definition[key].length === 0) fail(path, `la definición necesita ${key}`)
  }
  if (definition.failurePolicy !== 'stop' && definition.failurePolicy !== 'continue' && definition.failurePolicy !== 'review') {
    fail(path, 'failurePolicy tiene que ser stop, continue o review')
  }
  if (!Array.isArray(definition.permissions)) fail(path, 'permissions tiene que ser una lista')
  const triggers = definition.triggers
  if (!Array.isArray(triggers) || triggers.length === 0) fail(path, 'triggers tiene que ser una lista con al menos un disparador')
  for (const trigger of Array.isArray(triggers) ? triggers : []) {
    if (!['manual', 'event', 'email', 'date', 'recurrence'].includes(trigger?.kind)) {
      fail(path, `disparador desconocido ${JSON.stringify(trigger?.kind)}: manual, event, email, date o recurrence`)
    }
  }
  const steps = definition.steps
  if (!Array.isArray(steps) || steps.length === 0) fail(path, 'steps tiene que ser una lista con al menos un paso')
  const ids = new Set()
  for (const step of Array.isArray(steps) ? steps : []) {
    if (typeof step?.id !== 'string' || step.id.length === 0) fail(path, 'un paso no tiene id')
    else if (ids.has(step.id)) fail(path, `el paso ${step.id} se repite`)
    else ids.add(step.id)
    if (typeof step?.instruction !== 'string' || step.instruction.length === 0) fail(path, `el paso ${String(step?.id)} no tiene instruction`)
    if (!HANDLERS.has(step?.handler)) fail(path, `el paso ${String(step?.id)} usa el handler ${JSON.stringify(step?.handler)}; los del producto son ${[...HANDLERS].join(', ')}`)
  }
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const dependency of Array.isArray(step?.dependsOn) ? step.dependsOn : []) {
      if (!ids.has(dependency)) fail(path, `el paso ${String(step?.id)} depende de ${dependency}, que no existe`)
    }
  }
  report.routines.push(typeof value.name === 'string' ? value.name : basename(path))
}

function checkWorkflow(path) {
  const value = readJson(path)
  if (value === undefined) return
  if (typeof value.name !== 'string' || value.name.trim().length === 0) fail(path, 'falta el nombre del flujo (name)')
  const definition = value.definition
  if (typeof definition !== 'object' || definition === null) {
    fail(path, 'falta la definición (definition)')
    return
  }
  if (typeof definition.intent !== 'string' || definition.intent.length === 0) fail(path, 'la definición necesita intent')
  if (!['stop', 'continue', 'review'].includes(definition.failurePolicy)) fail(path, 'failurePolicy tiene que ser stop, continue o review')
  if (!Array.isArray(definition.permissions)) fail(path, 'permissions tiene que ser una lista')
  const nodes = definition.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) fail(path, 'nodes tiene que ser una lista con al menos un nodo')
  const nodeIds = new Set()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (typeof node?.id !== 'string' || node.id.length === 0) fail(path, 'un nodo no tiene id')
    else if (nodeIds.has(node.id)) fail(path, `el nodo ${node.id} se repite`)
    else nodeIds.add(node.id)
    if (!NODE_KINDS.has(node?.kind)) fail(path, `el nodo ${String(node?.id)} usa el kind ${JSON.stringify(node?.kind)}, que el producto no conoce`)
    if (typeof node?.title !== 'string' || node.title.length === 0) fail(path, `el nodo ${String(node?.id)} no tiene title`)
    if (typeof node?.position !== 'object' || node.position === null) fail(path, `el nodo ${String(node?.id)} no tiene position`)
  }
  const edges = definition.edges
  if (!Array.isArray(edges)) fail(path, 'edges tiene que ser una lista')
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (typeof edge?.id !== 'string' || edge.id.length === 0) fail(path, 'una arista no tiene id')
    for (const end of ['from', 'to']) {
      if (!nodeIds.has(edge?.[end])) fail(path, `la arista ${String(edge?.id)} apunta con ${end} a ${JSON.stringify(edge?.[end])}, que no es un nodo`)
    }
  }
  report.workflows.push(typeof value.name === 'string' ? value.name : basename(path))
}

// ── kb.json: manifiesto ───────────────────────────────────────────────────────
const manifestPath = join(kb, 'kb.json')
const manifest = isFile(manifestPath) ? readJson(manifestPath) : undefined
if (manifest !== undefined) {
  for (const key of ['name', 'displayName', 'version', 'author', 'description']) {
    const value = manifest[key]
    if (typeof value !== 'string' || value.trim().length === 0) fail(manifestPath, `falta ${key} en el manifiesto`)
  }
  if (typeof manifest.name === 'string' && !KEBAB.test(manifest.name)) {
    fail(manifestPath, `name ${JSON.stringify(manifest.name)} no es kebab-case`)
  }
  if (manifest.schemaVersion !== 1) warn(manifestPath, `schemaVersion es ${JSON.stringify(manifest.schemaVersion)}; este validador conoce la 1`)
  const content = manifest.content
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    fail(manifestPath, 'falta content, el objeto que enumera el contenido de la KB')
  } else {
    for (const key of Object.keys(content)) {
      if (!Array.isArray(content[key]) || !content[key].every(item => typeof item === 'string')) {
        fail(manifestPath, `content.${key} tiene que ser una lista de nombres`)
      }
    }
    // El manifiesto no puede nombrar contenido que no está: es lo que se instala.
    const declared = {
      skills: (content.skills ?? []).map(name => [name, isDir(join(skillsDir, name))]),
      agents: (content.agents ?? []).map(name => [name, isFile(join(agentsDir, `${name}.md`)) || isFile(join(agentsDir, name, 'AGENT.md'))]),
      routines: [...(content.routines ?? []).map(name => [name, isFile(join(kb, 'routines', `${name}.json`))])],
      workflows: [...(content.workflows ?? []).map(name => [name, isFile(join(kb, 'workflows', `${name}.json`))])],
      context: [...(content.context ?? []).map(name => [name, isFile(join(kb, 'context', name))])],
    }
    for (const [kind, rows] of Object.entries(declared)) {
      for (const [name, present] of rows) {
        if (!present) fail(manifestPath, `content.${kind} nombra ${name}, y no existe`)
      }
    }
    for (const [kind, rows] of Object.entries(declared)) {
      const declaredNames = new Set(rows.map(([name]) => name))
      const actual = { skills: report.skills, agents: report.agents, routines: report.routines, workflows: report.workflows, context: report.context }[kind]
      for (const name of actual) {
        if (!declaredNames.has(name)) warn(manifestPath, `content.${kind} no nombra ${name}, que sí existe en la KB`)
      }
    }
    const contextDir = join(kb, 'context')
    for (const entry of entriesOf(contextDir)) {
      if (entry.isFile()) report.context.push(entry.name)
    }
  }
}

// ── routines/ y workflows/ declarados (además de los nombrados) ───────────────
for (const entry of entriesOf(join(kb, 'routines'))) {
  if (entry.isFile() && entry.name.endsWith('.json')) checkRoutine(join(kb, 'routines', entry.name))
}
for (const entry of entriesOf(join(kb, 'workflows'))) {
  if (entry.isFile() && entry.name.endsWith('.json')) checkWorkflow(join(kb, 'workflows', entry.name))
}

// ── Resumen ───────────────────────────────────────────────────────────────────
const errors = problems.filter(problem => problem.level === 'error')
const warnings = problems.filter(problem => problem.level === 'aviso')
console.log(`KB: ${show(kb)}`)
console.log(`skills: ${String(report.skills.length)}${report.skills.length === 0 ? '' : ` (${report.skills.join(', ')})`}`)
console.log(`agentes: ${String(report.agents.length)}${report.agents.length === 0 ? '' : ` (${report.agents.join(', ')})`}`)
console.log(`rutinas: ${String(report.routines.length)} · flujos: ${String(report.workflows.length)} · contexto: ${String(report.context.length)}`)
console.log(`errores: ${String(errors.length)} · avisos: ${String(warnings.length)}`)
for (const problem of [...errors, ...warnings]) {
  console.log(`  ${problem.level}: ${show(problem.file)}: ${problem.message}`)
}
process.exit(errors.length === 0 ? 0 : 1)
