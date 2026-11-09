import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installClaudePackage,
  loadClaudePackage,
  newClaudePackageDirectory,
  planClaudePackage,
  planPortable,
  removeClaudePackage,
  validateClaudePackage,
  type PortableContribution,
} from '../src/index.ts'

const roots: string[] = []
const HOST_VERSION = '2.1.126'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary directory owned by this spec. */
function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One artifact contribution. */
function contribution(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'document:knowledge/a.md',
    kind: 'document',
    path: 'knowledge/a.md',
    title: 'Procedimiento',
    content: '# Procedimiento\n\nContenido autorizado.\n',
    classification: 'N2',
    ...overrides,
  }
}

/** One portable plan with a document, a skill, an excluded class, and a secret. */
function artifact() {
  return planPortable({
    identity: {
      spaceId: 'sp-1',
      spaceTitle: 'Espacio de prueba',
      editorialRevision: 'a'.repeat(40),
      parentRevision: null,
    },
    generatedAt: '2026-11-09T00:00:00.000Z',
    softwareVersion: '1.0.0',
    contributions: [
      contribution(),
      contribution({
        id: 'skill:saludo',
        kind: 'skill',
        path: 'skills/saludo/SKILL.md',
        title: 'saludo',
        content: '---\nname: saludo\ndescription: Saluda\n---\n\nSaluda.\n',
      }),
      contribution({ id: 'document:private', path: 'private/n3.md', title: 'N3 privado', classification: 'N3' }),
      contribution({ id: 'document:secret', path: 'private/secret.md', content: 'sk-proj-abcdefghijklmnop\n' }),
    ],
  })
}

/** Read every file of one package into a map. */
function filesOf(root: string, current = root): Map<string, string> {
  const files = new Map<string, string>()
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = join(current, entry.name)
    if (entry.isDirectory()) {
      for (const [path, content] of filesOf(root, target)) files.set(path, content)
    } else {
      files.set(relative(root, target).replaceAll('\\', '/'), readFileSync(target, 'utf8'))
    }
  }
  return files
}

describe('4A.1 Claude adapter', () => {
  it('packages the admitted artifact, loads it outside the checkout, and records host/version', () => {
    const plan = planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_test_1', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })
    expect(plan.state).toBe('ready')
    expect(plan.capabilities).toEqual({ code: true, chat: false, cowork: false, mcp: 'host-managed' })
    expect(plan.unsupported).toEqual(['claude-chat', 'claude-cowork'])
    expect(plan.load).toMatchObject({
      host: 'claude-code', hostVersion: HOST_VERSION, state: 'ready', sent: false, mesa: false,
    })
    expect(plan.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'knowledge/a.md', target: 'resources/knowledge/a.md', loaded: false }),
      expect.objectContaining({ source: 'skills/saludo/SKILL.md', target: 'skills/saludo/SKILL.md', loaded: true }),
    ]))
    const target = newClaudePackageDirectory(temporary('faberloom-claude-parent-'))
    roots.push(target)
    const installed = installClaudePackage(plan, target)
    expect(relative(process.cwd(), target).startsWith('..')).toBe(true)
    expect(installed.written).toEqual(expect.arrayContaining([
      '.claude-plugin/plugin.json', 'CLAUDE.md', 'skills/faberloom-space/SKILL.md',
      'skills/faberloom-proposals/SKILL.md', 'resources/knowledge/a.md',
    ]))

    const validation = validateClaudePackage(target)
    expect(validation).toMatchObject({ valid: true, loaded: false, hostVersion: HOST_VERSION })
    expect(validation.components).toEqual(expect.arrayContaining([
      'skills/faberloom-space/SKILL.md',
      'skills/faberloom-proposals/SKILL.md',
      'skills/saludo/SKILL.md',
    ]))
    const loaded = loadClaudePackage(target, HOST_VERSION)
    expect(loaded).toMatchObject({ valid: true, loaded: true, hostVersion: HOST_VERSION })
    expect(loadClaudePackage(target, '0.0.0').reasons).toContain('host-version-mismatch')

    const files = filesOf(target)
    const text = [...files.values()].join('\n')
    expect(text).not.toContain('sk-proj-abcdefghijklmnop')
    expect(text).not.toContain('N3 privado')
    expect(text).not.toContain('fbl_')
    expect(files.has('bin/anything')).toBe(false)
    expect(files.get('faberloom/connection.json')).toContain('fwr_test_1')
    expect(files.get('faberloom/load.json')).toContain(HOST_VERSION)

    try {
      execFileSync('claude', ['--version'], { stdio: 'ignore' })
      const answer = execFileSync('claude', ['plugin', 'validate', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      expect(answer).toContain('Validation passed')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !String(error).includes('ENOENT')) {
        throw error
      }
      // A machine without Claude Code still proves the synthetic loader; the
      // real validation runs wherever the host is installed.
    }
  })

  it('converts an agent without tools and refuses a workflow instead of turning it into Markdown', () => {
    const artifact = planPortable({
      identity: {
        spaceId: 'sp-agent',
        spaceTitle: 'Agentes',
        editorialRevision: 'a'.repeat(40),
        parentRevision: null,
      },
      generatedAt: '2026-11-09T00:00:00.000Z',
      softwareVersion: '1.0.0',
      contributions: [
        {
          id: 'agent:revisor', kind: 'agent', path: 'agents/revisor.md', title: 'Revisor',
          content: '---\nname: revisor\ndescription: Revisa propuestas\ntools: [Read, Write]\n---\n\nRevisa sin aprobar.\n',
          classification: 'N2',
        },
        {
          id: 'workflow:alta', kind: 'workflow', path: 'workflows/alta.json', title: 'Alta',
          content: '{"steps":["uno"]}\n', classification: 'N2',
        },
      ],
    })
    const plan = planClaudePackage({
      artifact,
      connection: { referenceId: 'fwr_agent_1', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })
    expect(plan.conversion.rejected).toBe(1)
    expect(plan.conversion.limitations).not.toContain('tools-restricted')
    expect(plan.conversion.limitations).toContain('workflow-not-representable')
    expect(plan.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'agents/revisor.md', target: 'agents/revisor.md', loaded: true }),
    ]))
    const target = newClaudePackageDirectory(temporary('faberloom-claude-parent-'))
    roots.push(target)
    installClaudePackage(plan, target)
    const files = filesOf(target)
    expect(files.get('agents/revisor.md')).toContain('name: revisor')
    expect(files.get('agents/revisor.md')).toContain('tools: [Read, Write]')
    expect(files.has('workflows/alta.json')).toBe(false)
    expect(files.has('resources/workflows/alta.json')).toBe(false)
    expect(files.has('faberloom/conversion.json')).toBe(true)
    expect(validateClaudePackage(target).components).toContain('agents/revisor.md')
  })

  it('leaves an unsent draft when the local runtime is absent and never simulates Mesa', () => {
    const plan = planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_test_2', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: false,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })
    expect(plan.state).toBe('draft')
    expect(plan.load).toMatchObject({ state: 'draft', sent: false, mesa: false, components: [] })
    expect(plan.files.map(file => file.path)).toEqual(['faberloom/draft.md'])
    expect(plan.draft).toContain('Runtime local ausente')
    const target = newClaudePackageDirectory(temporary('faberloom-claude-parent-'))
    installClaudePackage(plan, target)
    expect(validateClaudePackage(target)).toMatchObject({ valid: false, loaded: false })
    expect(filesOf(target).has('.claude-plugin/plugin.json')).toBe(false)
  })

  it('removes only the package and preserves the source, proposals, and revisions', () => {
    const home = temporary('faberloom-claude-source-')
    const source = join(home, 'source.md')
    const proposals = join(home, 'proposals.json')
    const revisions = join(home, 'revisions.json')
    writeFileSync(source, 'fuente\n', 'utf8')
    writeFileSync(proposals, '{"pending":1}\n', 'utf8')
    writeFileSync(revisions, '{"revision":1}\n', 'utf8')
    const target = newClaudePackageDirectory(temporary('faberloom-claude-parent-'))
    installClaudePackage(planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_test_3', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-09T00:00:00.000Z',
    }), target)
    removeClaudePackage(target)
    expect(readFileSync(source, 'utf8')).toBe('fuente\n')
    expect(readFileSync(proposals, 'utf8')).toBe('{"pending":1}\n')
    expect(readFileSync(revisions, 'utf8')).toBe('{"revision":1}\n')
  })

  it('refuses a token-shaped connection reference before writing a package', () => {
    expect(() => planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fbl_secretToken', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })).toThrow('PORTABLE_ADAPTER_INVALID')
  })
})
