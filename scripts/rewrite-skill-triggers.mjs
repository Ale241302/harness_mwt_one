/**
 * Inserta el trigger de enrutado ("Úsala cuando…") en la descripción de cada
 * skill del catálogo, derivado de su módulo y acción. Idempotente: una
 * descripción que ya contiene el trigger no se toca. El trigger va dentro del
 * escalar YAML citado; los ejemplos usan comillas simples para no escapar.
 *
 *   node scripts/rewrite-skill-triggers.mjs [skills-catalog]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const catalog = process.argv[2] ?? 'skills-catalog'

const TRIGGERS = {
  view: module => `Úsala cuando el usuario quiera consultar, listar, ver, buscar o revisar ${module} (por ejemplo 'muéstrame ${module}' o 'busca en ${module}').`,
  create: module => `Úsala cuando el usuario quiera crear, registrar o dar de alta algo en ${module}.`,
  update: module => `Úsala cuando el usuario quiera editar, actualizar, corregir o cambiar algo en ${module}.`,
  delete: module => `Úsala cuando el usuario quiera eliminar o borrar algo de ${module}.`,
  download_doc: module => `Úsala cuando el usuario quiera descargar un documento o archivo de ${module}.`,
  view_doc: module => `Úsala cuando el usuario quiera ver o listar los documentos de ${module}.`,
  upload_doc: module => `Úsala cuando el usuario quiera subir o adjuntar un documento a ${module}.`,
}

const field = (front, key) => {
  const line = front.split('\n').find(l => l.trimStart().startsWith(`${key}:`))
  return line === undefined ? undefined : line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '')
}

let touched = 0
let skipped = 0
const problems = []
for (const role of readdirSync(catalog, { withFileTypes: true })) {
  if (!role.isDirectory()) continue
  const roleDir = join(catalog, role.name)
  for (const entry of readdirSync(roleDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(roleDir, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const match = text.match(/^(---\s*\n)([\s\S]*?)(\n---)/)
    if (!match) { problems.push(`${file}: sin frontmatter`); continue }
    const descriptionLine = match[2].split('\n').find(l => l.trimStart().startsWith('description:'))
    if (descriptionLine === undefined) { problems.push(`${file}: sin description`); continue }
    if (descriptionLine.includes('Úsala cuando')) { skipped++; continue }
    const module = field(match[2], 'module')
    const action = field(match[2], 'action')
    const build = TRIGGERS[action ?? '']
    if (module === undefined || build === undefined) { problems.push(`${file}: module/action desconocido (${String(module)}/${String(action)})`); continue }
    const trigger = build(module)
    // Inserta el trigger antes de "Herramientas MCP:" si existe; si no, al final
    // del escalar de la descripción (antes de la comilla de cierre).
    let next
    const marker = ' Herramientas MCP:'
    const at = descriptionLine.indexOf(marker)
    if (at >= 0) {
      next = `${descriptionLine.slice(0, at)} ${trigger}${descriptionLine.slice(at)}`
    } else {
      next = descriptionLine.replace(/"\s*$/, ` ${trigger}"`)
    }
    if (next === descriptionLine) { problems.push(`${file}: no se pudo insertar el trigger`); continue }
    writeFileSync(file, text.replace(descriptionLine, next), 'utf8')
    touched++
  }
}
console.log(`triggers insertados: ${touched}, ya los tenían: ${skipped}, problemas: ${problems.length}`)
for (const problem of problems.slice(0, 10)) console.log(`  ${problem}`)
process.exit(problems.length === 0 ? 0 : 1)
