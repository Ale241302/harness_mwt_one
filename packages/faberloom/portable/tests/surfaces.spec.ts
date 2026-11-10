import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLAUDE_SURFACE_MATRIX,
  archiveClaudePackage,
  claudeSurfaceRow,
  installClaudePackage,
  newClaudePackageDirectory,
  planClaudePackage,
  planPortable,
  removeClaudePackage,
  validateClaudePackage,
  writeClaudeZip,
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

/** One artifact with a document, a skill, and an unsupported workflow. */
function artifact() {
  const contributions: PortableContribution[] = [
    {
      id: 'document:knowledge/a.md', kind: 'document', path: 'knowledge/a.md', title: 'A',
      content: '# A\n', classification: 'N2',
    },
    {
      id: 'document:knowledge/arbol.md', kind: 'document', path: 'knowledge/árbol.md', title: 'Árbol',
      content: '# Árbol\n', classification: 'N2',
    },
    {
      id: 'skill:saludo', kind: 'skill', path: 'skills/saludo/SKILL.md', title: 'saludo',
      content: '---\nname: saludo\ndescription: Saluda\n---\n\nSaluda.\n', classification: 'N2',
    },
    {
      id: 'workflow:alta', kind: 'workflow', path: 'workflows/alta.json', title: 'Alta',
      content: '{"steps":["uno"]}\n', classification: 'N2',
    },
  ]
  return planPortable({
    identity: {
      spaceId: 'sp-surface',
      spaceTitle: 'Superficie',
      editorialRevision: 'a'.repeat(40),
      parentRevision: null,
    },
    generatedAt: '2026-11-10T00:00:00.000Z',
    softwareVersion: '1.0.0',
    contributions,
  })
}

describe('4B.1 Claude surface matrix', () => {
  it('publishes a dated matrix and does not let chat or Cowork inherit Code', () => {
    expect(CLAUDE_SURFACE_MATRIX.asOf).toBe('2026-11-10')
    const code = claudeSurfaceRow('claude-code')
    expect(code).toMatchObject({ status: 'certified', auth: 'local-oauth-loopback' })
    const chat = claudeSurfaceRow('claude-chat')
    expect(chat).toMatchObject({ status: 'open', auth: 'remote-oauth' })
    expect(chat.limitations).toContain('remote-endpoint-D02')
    const cowork = claudeSurfaceRow('claude-cowork')
    expect(cowork).toMatchObject({ status: 'open', auth: 'host-session' })
    expect(cowork.limitations).toContain('cowork-host-unverified')
    expect(claudeSurfaceRow('claude-desktop')).toMatchObject({ status: 'open', auth: 'local-oauth-loopback' })
    const evidence = JSON.parse(readFileSync('docs/faberloom/evidence/4b1-claude-matrix.json', 'utf8')) as {
      asOf: string
      surfaces: unknown[]
    }
    expect(evidence.asOf).toBe(CLAUDE_SURFACE_MATRIX.asOf)
    expect(evidence.surfaces).toEqual(CLAUDE_SURFACE_MATRIX.rows)
  })

  it('rejects an uncertified host version, an unknown surface, and a non-package removal', () => {
    expect(() => claudeSurfaceRow('unknown' as never)).toThrow('PORTABLE_ADAPTER_INVALID')
    expect(() => planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_bad_version', host: 'claude-code' },
      hostVersion: '9.9.9',
      runtimeAvailable: true,
      generatedAt: '2026-11-10T00:00:00.000Z',
    })).toThrow('PORTABLE_ADAPTER_INVALID')
    expect(() => { removeClaudePackage(temporary('faberloom-surface-')) }).toThrow('PORTABLE_ADAPTER_INVALID')
  })

  it('keeps Code ready, inventories loaded and ignored components, and writes a deterministic ZIP', () => {
    const artifactPlan = artifact()
    const plan = planClaudePackage({
      artifact: artifactPlan,
      connection: { referenceId: 'fwr_code_1', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-10T00:00:00.000Z',
    })
    expect(plan).toMatchObject({
      state: 'ready',
      surface: 'claude-code',
      surfaceStatus: 'certified',
      authRoute: 'local-oauth-loopback',
      capabilities: { code: true, chat: false, cowork: false, mcp: 'host-managed' },
    })
    expect(plan.ignored).toContain('workflows/alta.json')
    expect(plan.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'knowledge/a.md', loaded: false }),
      expect.objectContaining({ source: 'skills/saludo/SKILL.md', loaded: true }),
    ]))
    expect(plan.components.some(component => component.source === 'workflows/alta.json')).toBe(false)
    expect(plan.components.filter(component => component.loaded).map(component => component.source))
      .not.toContain('workflows/alta.json')
    const first = archiveClaudePackage(plan)
    const second = archiveClaudePackage(plan)
    expect(first).toEqual(second)
    const text = Buffer.from(first).toString('utf8')
    expect(text).toContain('.claude-plugin/plugin.json')
    expect(text).toContain('knowledge/a.md')
    expect(text).toContain('faberloom/conversion.json')
    const zipPath = join(temporary('faberloom-surface-'), 'space.zip')
    expect(writeClaudeZip(plan, zipPath)).toBe(first.length)
    expect(readFileSync(zipPath).length).toBe(first.length)
    expect(() => writeClaudeZip(plan, temporary('faberloom-surface-'))).toThrow('PORTABLE_ADAPTER_INVALID')
  })

  it('refuses to install an open-surface draft over an existing package', () => {
    const code = planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_code_3', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-10T00:00:00.000Z',
    })
    const chat = planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_chat_2', host: 'claude-chat' },
      surface: 'claude-chat',
      hostVersion: 'unverified',
      runtimeAvailable: true,
      generatedAt: '2026-11-10T00:00:00.000Z',
    })
    const target = newClaudePackageDirectory(temporary('faberloom-surface-'))
    roots.push(target)
    installClaudePackage(code, target)
    expect(validateClaudePackage(target, 'claude-chat').reasons).toContain('host-mismatch')
    expect(() => installClaudePackage(chat, target)).toThrow('PORTABLE_ADAPTER_INVALID')
    expect(chat.load).toMatchObject({ state: 'draft', sent: false, mesa: false, components: [] })
  })

  it('keeps chat and Cowork as drafts with their own auth route and no operational components', () => {
    for (const surface of ['claude-desktop', 'claude-chat', 'claude-cowork'] as const) {
      const plan = planClaudePackage({
        artifact: artifact(),
        connection: { referenceId: `fwr_${surface}`, host: surface },
        surface,
        hostVersion: 'unverified',
        runtimeAvailable: true,
        generatedAt: '2026-11-10T00:00:00.000Z',
      })
      expect(plan).toMatchObject({
        state: 'draft',
        surface,
        surfaceStatus: 'open',
        authRoute: surface === 'claude-chat'
          ? 'remote-oauth'
          : surface === 'claude-cowork' ? 'host-session' : 'local-oauth-loopback',
        capabilities: { code: false, chat: false, cowork: false, mcp: 'host-managed' },
        components: [],
      })
      expect(plan.files.map(file => file.path)).toEqual(['faberloom/draft.md'])
      expect(plan.draft).toContain('sigue abierta')
    }
  })

  it('removes only the selected package and preserves the artifact source', () => {
    const plan = planClaudePackage({
      artifact: artifact(),
      connection: { referenceId: 'fwr_code_2', host: 'claude-code' },
      hostVersion: HOST_VERSION,
      runtimeAvailable: true,
      generatedAt: '2026-11-10T00:00:00.000Z',
    })
    const target = newClaudePackageDirectory(temporary('faberloom-surface-'))
    roots.push(target)
    installClaudePackage(plan, target)
    removeClaudePackage(target)
    expect(() => readFileSync(join(target, '.claude-plugin/plugin.json'))).toThrow()
    expect(plan.components.length).toBeGreaterThan(0)
  })
})
