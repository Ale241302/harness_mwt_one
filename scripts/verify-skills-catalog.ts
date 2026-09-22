/**
 * Verify the role skills catalog (`skills-catalog/<role>/<skill>/SKILL.md`):
 * every skill directory carries a SKILL.md whose frontmatter parses as YAML,
 * whose `name` is the harness's kebab-case skill name and matches its
 * directory, and whose `description` is present and carries the Spanish
 * routing trigger. A regression of the 2026-09-22 class (unquoted colon in the
 * description, underscored client_b2b names) fails the gate, as does a front
 * matter that the harness registry would silently ignore.
 *
 * Run: `tsx scripts/verify-skills-catalog.ts [skills-catalog]`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/** The harness's own skill-name grammar (packages/skill/skill SKILL_NAME). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The actions the catalog generation knows how to route. */
export const KNOWN_ACTIONS = new Set(['view', 'create', 'update', 'delete', 'download_doc', 'view_doc', 'upload_doc'])

/** One catalog violation, tied to its file. */
export interface CatalogViolation {
  readonly file: string
  readonly problem: string
}

/**
 * Check one catalog root and return every violation found.
 * @param catalog - the skills-catalog directory.
 * @returns the violations, empty when the catalog is sound.
 */
export function checkSkillsCatalog(catalog: string): CatalogViolation[] {
  const violations: CatalogViolation[] = []
  const fail = (file: string, problem: string): void => { violations.push({ file, problem }) }
  if (!existsSync(catalog)) {
    fail(catalog, 'el directorio del catálogo no existe')
    return violations
  }
  for (const role of readdirSync(catalog, { withFileTypes: true })) {
    if (!role.isDirectory()) continue
    const roleDir = join(catalog, role.name)
    for (const entry of readdirSync(roleDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(roleDir, entry.name, 'SKILL.md')
      if (!existsSync(file)) {
        fail(join(roleDir, entry.name), 'directorio de skill sin SKILL.md')
        continue
      }
      const text = readFileSync(file, 'utf8')
      const match = /^(---\s*\n)([\s\S]*?)(\n---)/.exec(text)
      if (match === null) {
        fail(file, 'sin bloque de frontmatter YAML')
        continue
      }
      let data: unknown
      try {
        data = load(match[2] ?? '')
      } catch (error) {
        fail(file, `frontmatter YAML inválido: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
        continue
      }
      if (data === null || typeof data !== 'object') {
        fail(file, 'el frontmatter no es un mapa YAML')
        continue
      }
      const fields = data as Record<string, unknown>
      const name = fields.name
      if (typeof name !== 'string' || name.length === 0) {
        fail(file, 'frontmatter sin name')
      } else {
        if (!SKILL_NAME.test(name)) fail(file, `name "${name}" no es kebab-case (la registry del harness lo ignora)`)
        if (name !== entry.name) fail(file, `name "${name}" no coincide con el directorio "${entry.name}"`)
      }
      const description = fields.description
      if (typeof description !== 'string' || description.trim().length === 0) {
        fail(file, 'frontmatter sin description')
      } else if (!description.includes('Úsala cuando')) {
        fail(file, 'la description no lleva el trigger de enrutado "Úsala cuando"')
      }
      if (typeof fields.module !== 'string' || fields.module.length === 0) fail(file, 'frontmatter sin module')
      const action = fields.action
      if (typeof action !== 'string' || !KNOWN_ACTIONS.has(action)) {
        fail(file, `action "${String(action)}" desconocida (conocidas: ${[...KNOWN_ACTIONS].join(', ')})`)
      }
    }
  }
  return violations
}

/* v8 ignore start -- CLI entry */
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  const violations = checkSkillsCatalog(process.argv[2] ?? 'skills-catalog')
  if (violations.length === 0) {
    console.log('verify-skills-catalog: catálogo correcto')
  } else {
    console.error(`verify-skills-catalog: ${String(violations.length)} violación(es)`)
    for (const violation of violations.slice(0, 20)) console.error(`  ${violation.file}: ${violation.problem}`)
    process.exit(1)
  }
}
/* v8 ignore stop */
