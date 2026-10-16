/**
 * The harness installer: one folder, or one `.zip`, whose parts land in the
 * roots the product already reads — skills where the provider scans, agents
 * where the preset discovery reads, rules in the managed block of the home's
 * own instructions file — and whose remaining kinds are copied whole.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as skillInstall from '../src/index.ts'
import { isSafeEntryPath, readZipArchive } from '../src/archive.ts'
import {
  HARNESS_INSTRUCTIONS, RULE_BLOCK_BEGIN, RULE_BLOCK_END,
  countFiles, detectHarness, installHarness, mergeRuleBlock, renderRuleBlock,
} from '../src/harness.ts'

let root: string | undefined
let context: Context | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-install-harness-'))
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  root = undefined
})

/**
 * The extraction directories the installer left in the platform temporary
 * directory. The prefix is this installer's own, so a before/after comparison
 * states whether one call cleaned up after itself.
 * @returns the extraction directory names.
 */
function extractions(): string[] {
  return readdirSync(tmpdir()).filter(name => name.startsWith('dsh-harness-'))
}

/** A fresh directory under the case's own temporary root. */
function scratch(name: string): string {
  const path = join(root as string, name)
  mkdirSync(path, { recursive: true })
  return path
}

/** Write one file, creating its parent directories. */
function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** One valid `SKILL.md`. */
function skillMarkdown(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} hace algo.\n---\n\nCuerpo de ${name}.\n`
}

/** Boot the installer over a real tool registry and an isolated home. */
async function boot(dshHome: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(skillInstall, { dshHome })
  context = ctx
  return ctx
}

/** One harness carrying every kind, plus the broken candidates the detector refuses. */
function fullHarness(): string {
  const harness = scratch('equipo')
  write(join(harness, 'skills', 'uno', 'SKILL.md'), skillMarkdown('uno'))
  write(join(harness, 'skills', 'dos', 'SKILL.md'), skillMarkdown('dos'))
  write(join(harness, 'skills', 'roto', 'SKILL.md'), '---\nname: roto\n---\n')
  write(join(harness, 'skills-shared', 'tres', 'SKILL.md'), skillMarkdown('tres'))
  write(join(harness, 'skills-catalog', 'rol', 'cuatro', 'SKILL.md'), skillMarkdown('cuatro'))
  write(join(harness, 'skills-catalog', 'otro', 'quince', 'SKILL.md'), skillMarkdown('quince'))
  write(join(harness, '.agents', 'skills', 'dos', 'SKILL.md'), skillMarkdown('dos'))
  write(join(harness, '.agents', 'skills', 'cinco', 'SKILL.md'), skillMarkdown('cinco'))
  write(join(harness, 'agents', 'contable.md'), '---\nname: Contable\ndescription: Cierra el mes.\n---\n\nEres el contable.\n')
  write(join(harness, 'agents', 'malo.md'), '# sin frontmatter\n')
  mkdirSync(join(harness, 'agents', 'sin-descriptor'), { recursive: true })
  write(join(harness, 'agents-shared', 'contable.md'), '---\nname: Contable\ndescription: Cierra el mes.\n---\n\nEres el contable.\n')
  write(join(harness, 'agents-shared', 'plantilla', 'preset.yml'), 'name: Plantilla\ndescription: "Base."\n')
  write(join(harness, 'rules', 'estilo.md'), '---\nname: estilo\n---\n\nEditor de 100 columnas.\n')
  write(join(harness, 'rules', 'notas.txt'), 'no es una regla\n')
  write(join(harness, 'rules', 'golang', 'testing.md'), 'Pruebas en tabla.\n')
  write(join(harness, 'rules', '.oculto', 'x.md'), 'oculto\n')
  write(join(harness, '.agents', 'rules', 'grafo.md'), 'Consulta el grafo antes de leer codigo.\n')
  write(join(harness, HARNESS_INSTRUCTIONS), '# Instrucciones del equipo\n\nResponde en espanol.\n')
  write(join(harness, 'commands', 'build.md'), 'Compila.\n')
  write(join(harness, 'scripts', 'run-gates.ts'), 'export {}\n')
  write(join(harness, 'hooks', 'hooks.json'), '{}\n')
  write(join(harness, 'mcp-configs', 'mcp.json'), '{}\n')
  // A file named like a part is not a part: only a directory is copied.
  write(join(harness, 'contexts'), 'no es una parte\n')
  return harness
}

describe('detectHarness', () => {
  it('reads every part, deduplicating a name two skill roots describe twice', async () => {
    const detection = await detectHarness(fullHarness())

    expect(detection.reason).toBeUndefined()
    expect(detection.skills.map(skill => skill.name)).toEqual(['dos', 'uno', 'tres', 'cinco', 'quince', 'cuatro'])
    expect(detection.refusedSkills.map(refused => refused.reason)).toEqual(['missing-name'])
    expect(detection.agents.map(agent => agent.id)).toEqual(['contable', 'plantilla'])
    expect(detection.refusedAgents.map(refused => refused.reason)).toEqual(['bad-frontmatter', 'missing-preset-yml'])
    expect(detection.rules[0]?.endsWith(HARNESS_INSTRUCTIONS)).toBe(true)
    expect(detection.rules.some(rule => rule.split(/[\\/]/u).join('/').endsWith('equipo/rules/estilo.md'))).toBe(true)
    expect(detection.ruleGroups).toEqual([{ name: 'golang', directory: join(detection.root, 'rules', 'golang'), relative: 'rules' }])
    expect(detection.ruleRoots.map(entry => entry.relative)).toEqual(['rules', '.agents/rules'])
    expect(detection.copies.map(entry => entry.kind)).toEqual(['commands', 'scripts', 'hooks', 'mcp-configs'])
    expect(detection.temporary).toBeUndefined()
  })

  it('accepts one skill folder as a harness, and reports a good folder that is no harness', async () => {
    const single = scratch('una-skill')
    write(join(single, 'SKILL.md'), skillMarkdown('sola'))
    mkdirSync(join(single, 'skills'), { recursive: true })
    expect((await detectHarness(single)).skills.map(skill => skill.name)).toEqual(['sola'])

    const empty = scratch('sin-piezas')
    expect(await detectHarness(empty)).toMatchObject({ reason: 'not-a-harness' })
    expect((await detectHarness(empty)).skills).toEqual([])

    const file = join(scratch('archivos'), 'notas.txt')
    write(file, 'no es un harness\n')
    expect((await detectHarness(file)).reason).toBe('not-a-harness')
    expect((await detectHarness(join(root as string, 'no-existe'))).reason).toBe('missing')
  })
})

describe('harness archives', () => {
  it('reads a .zip, unwraps its own root folder, and names what it extracted', async () => {
    const archive = join(scratch('zips'), 'equipo.zip')
    writeFileSync(archive, zipSync({
      'equipo/': new Uint8Array(0),
      'equipo/skills/uno/SKILL.md': strToU8(skillMarkdown('uno')),
      'equipo/AGENTS.md': strToU8('Regla del zip.\n'),
    }))

    const detection = await detectHarness(archive)
    expect(detection.reason).toBeUndefined()
    expect(detection.skills.map(skill => skill.name)).toEqual(['uno'])
    expect(detection.root).toBe(join(detection.temporary as string, 'equipo'))
    expect(existsSync(detection.temporary as string)).toBe(true)
    rmSync(detection.temporary as string, { recursive: true, force: true })

    const flat = join(scratch('zips'), 'plano.zip')
    writeFileSync(flat, zipSync({ 'skills/uno/SKILL.md': strToU8(skillMarkdown('uno')) }))
    const flatDetection = await detectHarness(flat)
    expect(flatDetection.skills.map(skill => skill.name)).toEqual(['uno'])
    expect(flatDetection.root).toBe(flatDetection.temporary)
  })

  it('answers a refusal for an archive it cannot read, and for one carrying no part', async () => {
    const folder = scratch('zips')
    const before = extractions()
    const garbage = join(folder, 'roto.zip')
    writeFileSync(garbage, Buffer.from([1, 2, 3, 4]))
    expect(await detectHarness(garbage)).toMatchObject({ reason: 'archive-unreadable' })
    expect(extractions()).toEqual(before)

    const foreign = join(folder, 'ajeno.zip')
    writeFileSync(foreign, zipSync({ 'leeme.txt': strToU8('nada\n') }))
    const detection = await detectHarness(foreign)
    expect(detection.reason).toBe('not-a-harness')
    expect(detection.temporary).toBeDefined()
    rmSync(detection.temporary as string, { recursive: true, force: true })

    const nested = join(folder, 'anidado.zip')
    writeFileSync(nested, zipSync({ 'solo/leeme.txt': strToU8('nada\n') }))
    const nestedDetection = await detectHarness(nested)
    expect(nestedDetection.reason).toBe('not-a-harness')
    expect(nestedDetection.root).toBe(nestedDetection.temporary)
    rmSync(nestedDetection.temporary as string, { recursive: true, force: true })
  })

  it('refuses an entry that walks out of the extraction root', async () => {
    const folder = scratch('zips')
    const hostile = join(folder, 'hostil.zip')
    writeFileSync(hostile, zipSync({ '../evil.txt': strToU8('x'), 'ok.txt': strToU8('y') }))
    expect((await detectHarness(hostile)).reason).toBe('archive-unreadable')
    expect(existsSync(join(root as string, 'evil.txt'))).toBe(false)

    const into = scratch('destino')
    await expect(readZipArchive(hostile, into)).rejects.toThrow(/outside the extraction root/u)
  })

  it('tells a safe entry name from one that leaves the root', () => {
    expect(isSafeEntryPath('equipo/skills/uno/SKILL.md')).toBe(true)
    expect(isSafeEntryPath('equipo/')).toBe(true)
    expect(isSafeEntryPath('')).toBe(false)
    expect(isSafeEntryPath('/abs.txt')).toBe(false)
    expect(isSafeEntryPath('C:/abs.txt')).toBe(false)
    expect(isSafeEntryPath('a\\b.txt')).toBe(false)
    expect(isSafeEntryPath('../evil.txt')).toBe(false)
    expect(isSafeEntryPath('a/../../evil.txt')).toBe(false)
    expect(isSafeEntryPath('a//b.txt')).toBe(false)
  })
})

describe('installHarness', () => {
  it('writes every part into the roots the product already reads', async () => {
    const home = scratch('home')
    const detection = await detectHarness(fullHarness())
    const report = await installHarness(detection, home, false)

    expect(report.status).toBe('installed')
    expect(report.parts.map(part => part.kind)).toEqual(['skills', 'agents', 'rules', 'commands', 'scripts', 'hooks', 'mcp-configs'])
    expect(report.parts.find(part => part.kind === 'skills')).toMatchObject({ status: 'installed', count: 6 })
    expect(report.parts.find(part => part.kind === 'rules')?.count).toBe(4)
    expect(report.parts.find(part => part.kind === 'scripts')?.count).toBe(1)
    expect(report.outcomes).toContainEqual({ name: 'roto', status: 'refused', reason: 'missing-name' })

    expect(readFileSync(join(home, 'skills', 'uno', 'SKILL.md'), 'utf8')).toBe(skillMarkdown('uno'))
    expect(existsSync(join(home, 'skills', 'dos', '.dsh-skill-install.json'))).toBe(true)
    expect(readFileSync(join(home, '.agent-presets', 'plantilla', 'preset.yml'), 'utf8')).toBe('name: Plantilla\ndescription: "Base."\n')
    expect(readFileSync(join(home, '.agent-presets', 'contable', 'agent.cordis.yml'), 'utf8')).toContain('Eres el contable.')
    expect(readFileSync(join(home, 'commands', 'build.md'), 'utf8')).toBe('Compila.\n')
    expect(readFileSync(join(home, 'scripts', 'run-gates.ts'), 'utf8')).toBe('export {}\n')
    expect(readFileSync(join(home, 'hooks', 'hooks.json'), 'utf8')).toBe('{}\n')
    expect(readFileSync(join(home, 'mcp-configs', 'mcp.json'), 'utf8')).toBe('{}\n')
    expect(readFileSync(join(home, 'rules', 'golang', 'testing.md'), 'utf8')).toBe('Pruebas en tabla.\n')
    expect(existsSync(join(home, 'contexts'))).toBe(false)

    const instructions = readFileSync(join(home, HARNESS_INSTRUCTIONS), 'utf8')
    expect(instructions).toContain('Responde en espanol.')
    expect(instructions).toContain('Editor de 100 columnas.')
    expect(instructions).toContain('Consulta el grafo antes de leer codigo.')
    expect(instructions).toContain(`- \`golang\`: \`${join(home, 'rules', 'golang')}\``)
    expect(instructions).not.toContain('name: estilo')
  })

  it('reports a repeat install instead of copying it again, and replaces it on request', async () => {
    const home = scratch('home-repetido')
    const detection = await detectHarness(fullHarness())

    await installHarness(detection, home, false)
    const second = await installHarness(detection, home, false)
    expect(second.status).toBe('skipped')
    expect(second.parts.every(part => part.status === 'skipped')).toBe(true)

    const third = await installHarness(detection, home, true)
    expect(third.status).toBe('installed')
    // Un archivo de skill sin cambios se reporta como ya instalado aunque se
    // pida reemplazar: su digest es la identidad, y nada que escribir es nada.
    expect(third.parts.find(part => part.kind === 'skills')?.status).toBe('skipped')
    expect(third.parts.filter(part => part.kind !== 'skills').every(part => part.status === 'replaced')).toBe(true)
    expect(readdirSync(home).filter(name => name === HARNESS_INSTRUCTIONS)).toEqual([HARNESS_INSTRUCTIONS])
  })

  it('keeps whatever the user wrote outside its own managed block', async () => {
    const home = scratch('home-reglas')
    const harness = scratch('equipo-reglas')
    write(join(harness, 'rules', 'grafo.md'), 'Consulta el grafo.\n')
    write(join(home, HARNESS_INSTRUCTIONS), 'Mi nota personal.\n\nnota final\n')
    const detection = await detectHarness(harness)

    await installHarness(detection, home, false)
    const first = readFileSync(join(home, HARNESS_INSTRUCTIONS), 'utf8')
    expect(first.startsWith('Mi nota personal.')).toBe(true)
    expect(first).toContain('nota final')
    expect(first.split(RULE_BLOCK_BEGIN)).toHaveLength(2)

    await installHarness(detection, home, true)
    const second = readFileSync(join(home, HARNESS_INSTRUCTIONS), 'utf8')
    expect(second).toBe(first)
  })

  it('merges a block in place, whatever the file held before', () => {
    expect(mergeRuleBlock('', 'bloque')).toBe('bloque\n')
    expect(mergeRuleBlock('antes\n', 'bloque')).toBe('antes\n\nbloque\n')
    expect(mergeRuleBlock(`${RULE_BLOCK_BEGIN}\nviejo\n${RULE_BLOCK_END}\n`, 'bloque')).toBe('bloque\n')
    expect(mergeRuleBlock(`${RULE_BLOCK_BEGIN}\nviejo\n`, 'bloque')).toBe('bloque\n')
    expect(mergeRuleBlock(`despues\n${RULE_BLOCK_END}\n`, 'bloque')).toBe('despues\n\nbloque\n')
    expect(mergeRuleBlock(`${RULE_BLOCK_END}\n${RULE_BLOCK_BEGIN}\n`, 'bloque')).toBe(`${RULE_BLOCK_END}\n${RULE_BLOCK_BEGIN}\n\nbloque\n`)

    const rendered = renderRuleBlock('/equipo', [{ name: 'estilo', body: 'Ochenta columnas.\n' }], [])
    expect(rendered).toContain('### estilo')
    expect(rendered).toContain('Ochenta columnas.')
    expect(rendered).not.toContain('Grupos de reglas')
  })

  it('installs a harness whose rules are only groups, naming each by its installed path', async () => {
    const home = scratch('home-grupos')
    const harness = scratch('equipo-grupos')
    write(join(harness, 'rules', 'rust', 'errores.md'), 'Nada de unwrap.\n')
    const detection = await detectHarness(harness)

    expect(detection.rules).toEqual([])
    expect(detection.ruleGroups.map(group => group.name)).toEqual(['rust'])
    const report = await installHarness(detection, home, false)

    expect(report.parts.map(part => part.kind)).toEqual(['rules'])
    expect(report.status).toBe('installed')
    expect(readFileSync(join(home, HARNESS_INSTRUCTIONS), 'utf8'))
      .toContain(`- \`rust\`: \`${join(home, 'rules', 'rust')}\``)
  })

  it('counts the files of a directory, one for a file, and none for a path that is not there', async () => {
    const folder = scratch('contar')
    write(join(folder, 'uno.md'), 'x\n')
    write(join(folder, 'dentro', 'dos.md'), 'y\n')
    expect(await countFiles(folder)).toBe(2)
    expect(await countFiles(join(folder, 'uno.md'))).toBe(1)
    expect(await countFiles(join(root as string, 'no-existe'))).toBe(0)
    expect(await countFiles(join(scratch('vacio'), 'vacio'))).toBe(0)
  })
})

describe('the service', () => {
  it('installs an archive through the service and removes the extraction afterwards', async () => {
    const archive = join(scratch('zips'), 'equipo.zip')
    writeFileSync(archive, zipSync({
      'equipo/': new Uint8Array(0),
      'equipo/skills/uno/SKILL.md': strToU8(skillMarkdown('uno')),
      'equipo/AGENTS.md': strToU8('Regla del zip.\n'),
    }))
    const home = scratch('home-zip')
    const ctx = await boot(home)
    const before = extractions()

    const report = await ctx.skillInstall.installHarness({ source: archive, replace: true })

    expect(report.status).toBe('installed')
    expect(report.parts.map(part => part.kind)).toEqual(['skills', 'rules'])
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toContain('Regla del zip.')
    expect(extractions()).toEqual(before)
  })

  it('installs a folder through the service without naming a replacement', async () => {
    const folder = join(scratch('kb'), 'carpeta')
    write(join(folder, 'skills', 'uno', 'SKILL.md'), skillMarkdown('uno'))
    const home = scratch('home-carpeta')
    const ctx = await boot(home)

    const report = await ctx.skillInstall.installHarness({ source: folder })

    expect(report.status).toBe('installed')
    expect(existsSync(join(home, 'skills', 'uno', 'SKILL.md'))).toBe(true)
  })

  it('answers a refusal through the service, writing nothing and leaving no extraction', async () => {
    const folder = scratch('zips')
    const home = scratch('home-sin-nada')
    const ctx = await boot(home)
    const before = extractions()

    expect(await ctx.skillInstall.installHarness({ source: join(folder, 'no-existe') }))
      .toMatchObject({ status: 'refused', reason: 'missing', parts: [], outcomes: [] })

    const foreign = join(folder, 'ajeno.zip')
    writeFileSync(foreign, zipSync({ 'leeme.txt': strToU8('nada\n') }))
    expect(await ctx.skillInstall.installHarness({ source: foreign }))
      .toMatchObject({ status: 'refused', reason: 'not-a-harness' })

    expect(existsSync(join(home, 'skills'))).toBe(false)
    expect(extractions()).toEqual(before)
  })
})
