import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkSkillsCatalog } from './verify-skills-catalog.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Write one skill into a scratch catalog. */
function writeSkill(catalog: string, role: string, dir: string, frontmatter: string): void {
  const target = join(catalog, role, dir)
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${dir}\n`, 'utf8')
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-catalog-'))
  dirs.push(dir)
  return dir
}

const GOOD = `name: mwt-rol-modulo-leer
description: "Rol X. Úsala cuando el usuario quiera consultar modulo. Lee el contrato."
module: modulo
action: view`

describe('verify-skills-catalog', () => {
  it('accepts the shipped catalog', () => {
    expect(checkSkillsCatalog('skills-catalog')).toEqual([])
  })

  it('accepts a sound scratch catalog', () => {
    const catalog = scratch()
    writeSkill(catalog, 'rol', 'mwt-rol-modulo-leer', GOOD)
    expect(checkSkillsCatalog(catalog)).toEqual([])
  })

  it('rejects an unquoted colon in the description (the 2026-09-22 bug class)', () => {
    const catalog = scratch()
    writeSkill(catalog, 'rol', 'mwt-rol-modulo-leer', `name: mwt-rol-modulo-leer
description: Rol X con Herramientas MCP: ninguna. Lee el contrato.
module: modulo
action: view`)
    const violations = checkSkillsCatalog(catalog)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.problem).toContain('YAML inválido')
  })

  it('rejects underscored names, name/dir mismatch, and a missing trigger', () => {
    const catalog = scratch()
    writeSkill(catalog, 'rol', 'mwt-rol-modulo-leer', `name: mwt-rol_modulo-leer
description: "Rol X sin trigger."
module: modulo
action: view`)
    const violations = checkSkillsCatalog(catalog)
    expect(violations.map(violation => violation.problem)).toEqual([
      'name "mwt-rol_modulo-leer" no es kebab-case (la registry del harness lo ignora)',
      'name "mwt-rol_modulo-leer" no coincide con el directorio "mwt-rol-modulo-leer"',
      'la description no lleva el trigger de enrutado "Úsala cuando"',
    ])
  })

  it('rejects an unknown action and a missing description', () => {
    const catalog = scratch()
    writeSkill(catalog, 'rol', 'mwt-rol-modulo-leer', `name: mwt-rol-modulo-leer
module: modulo
action: teleport`)
    const violations = checkSkillsCatalog(catalog)
    expect(violations.map(violation => violation.problem)).toEqual([
      'frontmatter sin description',
      'action "teleport" desconocida (conocidas: view, create, update, delete, download_doc, view_doc, upload_doc)',
    ])
  })
})
