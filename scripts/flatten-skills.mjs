/**
 * Aplana el catálogo de skills del MCP a la forma que el proveedor
 * `skill-filesystem` del harness descubre: `<rol>/<skill-name>/SKILL.md`.
 *
 *   node flatten-skills.mjs <origen Skills-MCP> <destino skills-catalog>
 *
 * El `name` del frontmatter es único por rol, así que sirve de carpeta. Se
 * conserva el cuerpo tal cual (sin re-encode: se copian bytes).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'

const [src, dest] = process.argv.slice(2)
if (!src || !dest) { console.error('uso: node flatten-skills.mjs <origen> <destino>'); process.exit(1) }

const SKIP_DIRS = new Set(['_contratos', 'node_modules', '.git'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(full)
    }
  }
  return out
}

function frontmatterName(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return undefined
  const line = match[1].split('\n').find(l => l.trimStart().startsWith('name:'))
  return line?.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '')
}

// El harness exige nombres kebab-case (/^[a-z0-9]+(-[a-z0-9]+)*$/) y YAML
// válido: las descripciones con dos puntos deben ir citadas o el frontmatter
// no parsea y el skill se ignora en silencio.
const kebab = (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const yamlQuote = (value) => `"${value.trim().replace(/^["']|["']$/g, '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

function repairFrontmatter(text) {
  const match = text.match(/^(---\s*\n)([\s\S]*?)(\n---)/)
  if (!match) return { text, name: undefined }
  let name
  const lines = match[2].split('\n').map((line) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('name:')) {
      name = kebab(line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, ''))
      return `${line.slice(0, line.indexOf(':') + 1)} ${name}`
    }
    if (trimmed.startsWith('description:')) {
      return `${line.slice(0, line.indexOf(':') + 1)} ${yamlQuote(line.slice(line.indexOf(':') + 1))}`
    }
    return line
  })
  return { text: `${match[1]}${lines.join('\n')}${match[3]}${text.slice(match[0].length)}`, name }
}

rmSync(dest, { recursive: true, force: true })
let written = 0
const roles = readdirSync(src, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
for (const role of roles) {
  const roleDir = join(src, role.name)
  for (const file of walk(roleDir)) {
    const repaired = repairFrontmatter(readFileSync(file, 'utf8'))
    const name = repaired.name ?? kebab(basename(join(file, '..')))
    const target = join(dest, role.name, name)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), repaired.text, 'utf8')
    written++
  }
}
console.log(`aplanadas ${written} skills en ${dest}`)
for (const role of roles) {
  const dir = join(dest, role.name)
  console.log(`  ${role.name}: ${statSync(dir).isDirectory() ? readdirSync(dir).length : 0}`)
}
