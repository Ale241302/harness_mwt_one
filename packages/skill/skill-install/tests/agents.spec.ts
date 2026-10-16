/**
 * The agent side of the installer and the knowledge-base path that reaches it:
 * one folder the user points at holds `skills/` and `agents/`, and installing it
 * writes the skills into the chosen scope and the agents into the Harness home's
 * preset directory, which is how a KB is "global for that user" and nobody else.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as skillInstall from '../src/index.ts'
import { AGENT_PRESETS_DIRNAME, detectAgents, installAgents, renderAgentComposition, renderPresetYaml } from '../src/agents.ts'
import { detectSkillFolder } from '../src/detect.ts'

let home: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (home !== undefined) rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  home = undefined
})

/** Boot the installer over a real tool registry and an isolated home. */
async function boot(dshHome: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(skillInstall, { dshHome })
  context = ctx
  return ctx
}

/** A fresh scratch directory under the temporary directory. */
function scratch(): string {
  home = mkdtempSync(join(tmpdir(), 'skill-install-agents-'))
  return home
}

/** Write one file, creating its parent directories. */
function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** One KB folder with both halves, plus the broken entries the detector must refuse. */
function knowledgeBase(): string {
  const root = scratch()
  const agents = join(root, 'agents')
  const skills = join(root, 'skills')
  write(join(skills, 'conciliacion', 'SKILL.md'), '---\nname: conciliacion\ndescription: Cuadra el banco.\n---\n\nCuerpo.\n')
  write(join(agents, 'contable-jefe', 'preset.yml'), 'name: Contable jefe\ndescription: "Cierra el mes."\n')
  write(join(agents, 'analista-fiscal.md'), '---\nname: Analista fiscal\ndescription: IVA y retenciones.\n---\n\nEres el analista fiscal del KB.\n')
  mkdirSync(join(agents, 'sin-descriptor'), { recursive: true })
  write(join(agents, 'roto', 'preset.yml'), 'name: Roto\ndescription:\n  anidado: si\n')
  write(join(agents, 'sin-nombre', 'preset.yml'), 'description: Solo descripcion.\n')
  write(join(agents, 'sin-frontmatter.md'), 'Sin cabecera.\n')
  write(join(agents, 'sin-nombre.md'), '---\ndescription: Solo descripcion.\n---\n\nCuerpo.\n')
  write(join(agents, 'Con-Mayusculas.md'), '---\nname: Mayusculas\ndescription: Nombre no kebab.\n---\n\nCuerpo.\n')
  write(join(agents, 'notas.txt'), 'no es un agente\n')
  write(join(agents, '.oculto.md'), '---\nname: Oculto\ndescription: No se mira.\n---\n')
  return root
}

describe('agent detection', () => {
  it('reads preset folders and Markdown agents, and names every refusal', async () => {
    const root = knowledgeBase()
    const detection = await detectAgents(join(root, 'agents'))
    expect(detection.agents.map(agent => [agent.id, agent.name, agent.prompt === null])).toEqual([
      ['analista-fiscal', 'Analista fiscal', false],
      ['contable-jefe', 'Contable jefe', true],
    ])
    expect(detection.agents[0]?.prompt).toContain('Eres el analista fiscal')
    expect(detection.refused.map(entry => [entry.source.split(/[\\/]/u).pop(), entry.reason])).toEqual([
      ['Con-Mayusculas.md', 'invalid-name'],
      ['roto', 'bad-preset'],
      ['sin-descriptor', 'missing-preset-yml'],
      ['sin-frontmatter.md', 'bad-frontmatter'],
      ['sin-nombre', 'missing-name'],
      ['sin-nombre.md', 'missing-name'],
    ])
    // A directory that does not exist is no agents folder at all, not a refusal.
    expect(await detectAgents(join(root, 'no-existe'))).toEqual({ agents: [], refused: [] })
  })

  it('installs preset folders whole and writes a Markdown agent as a preset', async () => {
    const root = knowledgeBase()
    const detection = await detectAgents(join(root, 'agents'))
    const presets = join(root, 'home', AGENT_PRESETS_DIRNAME)
    const outcomes = await installAgents(detection, presets, false)
    expect(outcomes.filter(outcome => outcome.status === 'installed').map(outcome => outcome.name))
      .toEqual(['analista-fiscal', 'contable-jefe'])
    expect(outcomes.filter(outcome => outcome.status === 'refused')).toHaveLength(6)
    // The preset folder travels whole; the Markdown agent becomes a descriptor
    // and a composition whose persona is the file body.
    const markdown = detection.agents.find(agent => agent.id === 'analista-fiscal')
    if (markdown === undefined) throw new Error('el agente Markdown no se detecto')
    expect(readFileSync(join(presets, 'contable-jefe', 'preset.yml'), 'utf8')).toContain('Contable jefe')
    expect(readFileSync(join(presets, 'analista-fiscal', 'preset.yml'), 'utf8'))
      .toBe(renderPresetYaml(markdown))
    const composition = readFileSync(join(presets, 'analista-fiscal', 'agent.cordis.yml'), 'utf8')
    expect(composition).toBe(renderAgentComposition(markdown))
    expect(composition).toContain("name: '@deepseek-ai/dsh-persona'")
    expect(composition).toContain('      Eres el analista fiscal del KB.')
    // A second install of the same agents reports them instead of rewriting them.
    expect((await installAgents(detection, presets, false)).filter(outcome => outcome.status === 'already-installed'))
      .toHaveLength(2)
    expect((await installAgents(detection, presets, true)).filter(outcome => outcome.status === 'replaced'))
      .toHaveLength(2)
  })

  it('reports an agent it could not write instead of failing the install', async () => {
    const root = knowledgeBase()
    const detection = await detectAgents(join(root, 'agents'))
    const presets = join(root, 'home', AGENT_PRESETS_DIRNAME)
    // A file where the preset directory belongs makes the copy fail, and the
    // rest of the install still lands.
    write(join(presets, 'contable-jefe'), 'no es un directorio\n')
    const outcomes = await installAgents(detection, presets, true)
    expect(outcomes).toContainEqual({ name: 'contable-jefe', status: 'skipped', reason: 'exists' })
    expect(outcomes).toContainEqual({ name: 'analista-fiscal', status: 'installed' })
  })

  it('keeps a Markdown body with blank lines and no trailing text', () => {
    const rendered = renderAgentComposition({
      id: 'x',
      name: 'X',
      description: 'd',
      source: join('a', 'x.md'),
      prompt: 'linea\n\nfinal',
    })
    expect(rendered).toContain('      linea\n\n      final')
    // Un agente sin cuerpo renderea una persona vacia, no una linea de espacios.
    expect(renderAgentComposition({ id: 'x', name: 'X', description: 'd', source: 'x.md', prompt: null }))
      .toContain('    prefix: |-')
    expect(renderPresetYaml({ id: 'x', name: 'Con "comillas"', description: 'd', source: 'x', prompt: null }))
      .toContain('name: "Con \\"comillas\\""')
  })
})

describe('knowledge-base install', () => {
  it('installs the skills and the agents of one folder the user points at', async () => {
    const root = knowledgeBase()
    const ctx = await boot(join(root, 'home'))
    const detection = await ctx.skillInstall.detect(root)
    // La carpeta KB entera es instalable: su catalogo y sus agentes.
    expect(detection.kind).toBe('found')
    expect(detection.kind === 'found' ? detection.skills.map(skill => skill.name) : []).toEqual(['conciliacion'])
    expect(detection.kind === 'found' ? detection.agents?.map(agent => agent.id) : []).toEqual(['analista-fiscal', 'contable-jefe'])

    const report = await ctx.skillInstall.install({ source: root, destination: 'global' })
    expect(report.status).toBe('installed')
    expect(report.outcomes.map(outcome => outcome.name)).toEqual(['conciliacion'])
    expect(report.agents?.filter(outcome => outcome.status === 'installed').map(outcome => outcome.name))
      .toEqual(['analista-fiscal', 'contable-jefe'])
    expect(report.agents?.filter(outcome => outcome.status === 'refused')).toHaveLength(6)
    expect(report.agentsRoot).toBe(join(root, 'home', AGENT_PRESETS_DIRNAME))
    expect(readFileSync(join(root, 'home', 'skills', 'conciliacion', 'SKILL.md'), 'utf8')).toContain('Cuadra el banco')
    expect(readFileSync(join(root, 'home', AGENT_PRESETS_DIRNAME, 'contable-jefe', 'preset.yml'), 'utf8')).toContain('Contable jefe')
  })

  it('installs a knowledge base through the tool, and a plain skill folder without agents', async () => {
    const root = knowledgeBase()
    const ctx = await boot(join(root, 'home'))
    const answers = (result: unknown): { agents?: { name: string }[]; outcomes: { name: string }[] } => {
      const parts = (result as { content: readonly { text?: string }[] }).content
      return JSON.parse(parts.map(part => part.text ?? '').join('')) as { agents?: { name: string }[]; outcomes: { name: string }[] }
    }
    const kb = answers(await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('kb-install'),
      name: 'install_skill',
      arguments: { source: root, destination: 'global' },
    }))
    expect(kb.outcomes.map(outcome => outcome.name)).toEqual(['conciliacion'])
    expect(kb.agents?.filter(agent => agent.name === 'contable-jefe' || agent.name === 'analista-fiscal'))
      .toHaveLength(2)
    // Una carpeta de una sola skill no trae agentes, y el resultado no la nombra.
    const plain = answers(await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('kb-install-plain'),
      name: 'install_skill',
      arguments: { source: join(root, 'skills'), destination: 'global' },
    }))
    expect(plain.agents).toBeUndefined()
  })

  it('refuses a folder that is neither a skill nor a knowledge base', async () => {
    const root = scratch()
    write(join(root, 'notes.txt'), 'nada\n')
    expect(await detectSkillFolder(root)).toEqual({ kind: 'invalid', source: root, reason: 'missing-skill-md' })
    const empty = join(root, 'kb-vacio')
    mkdirSync(join(empty, 'skills'), { recursive: true })
    mkdirSync(join(empty, 'agents'), { recursive: true })
    // Las dos mitades existen y ninguna trae nada: sigue siendo una carpeta sin
    // nada que instalar.
    expect(await detectSkillFolder(empty)).toEqual({ kind: 'invalid', source: empty, reason: 'missing-skill-md' })
    // Una KB con solo `skills/` es instalable y no lleva agentes.
    const soloSkills = join(root, 'kb-solo-skills')
    write(join(soloSkills, 'skills', 'una', 'SKILL.md'), '---\nname: una\ndescription: d.\n---\n\nCuerpo.\n')
    const only = await detectSkillFolder(soloSkills)
    expect(only.kind === 'found' ? [only.skills.map(skill => skill.name), only.agents] : 'invalid')
      .toEqual([['una'], []])
  })

  it('installs a knowledge base that carries only agents', async () => {
    const root = scratch()
    write(join(root, 'agents', 'solo-agente.md'), '---\nname: Solo agente\ndescription: Sin skills.\n---\n\nEres el unico.\n')
    const ctx = await boot(join(root, 'home'))
    const report = await ctx.skillInstall.install({ source: root, destination: 'global' })
    expect(report.status).toBe('installed')
    expect(report.outcomes).toEqual([])
    expect(report.agents?.map(outcome => outcome.name)).toEqual(['solo-agente'])
  })
})
