import { describe, expect, it } from 'vitest'
import {
  convertPortable,
  planPortable,
  type PortableContribution,
  type PortableRequest,
} from '../src/index.ts'

/** One request with fixed versions. */
function request(contributions: readonly PortableContribution[], inherited: readonly PortableContribution[] = []): PortableRequest {
  return {
    identity: {
      spaceId: 'sp-1',
      spaceTitle: 'Espacio QA',
      editorialRevision: 'a'.repeat(40),
      parentRevision: inherited.length === 0 ? null : 'b'.repeat(40),
    },
    generatedAt: '2026-11-09T00:00:00.000Z',
    softwareVersion: '1.0.0',
    contributions,
    ...inherited.length === 0 ? {} : { inherited },
  }
}

/** One document contribution. */
function document(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'document:knowledge/a.md',
    kind: 'document',
    path: 'knowledge/a.md',
    title: 'A',
    content: '# A\n\nContenido.\n',
    classification: 'N2',
    ...overrides,
  }
}

/** One valid skill. */
const SKILL: PortableContribution = {
  id: 'skill:saludo',
  kind: 'skill',
  path: 'skills/saludo/SKILL.md',
  title: 'saludo',
  content: '---\nname: saludo\ndescription: Saluda al cliente\n---\n\nSaluda.\n',
  classification: 'N2',
}

/** One agent with a restricted tool list. */
const AGENT: PortableContribution = {
  id: 'agent:revisor',
  kind: 'agent',
  path: 'agents/revisor.md',
  title: 'Revisor',
  content: '---\nname: revisor\ndescription: Revisa propuestas\ntools: [Read, Write]\n---\n\nRevisa sin aprobar.\n',
  classification: 'N2',
}

/** One skill resource. */
const SKILL_RESOURCE: PortableContribution = {
  id: 'resource:skills/saludo/reference.md',
  kind: 'resource',
  path: 'skills/saludo/reference.md',
  title: 'Referencia',
  content: 'Referencia de la skill.\n',
  classification: 'N2',
}

describe('3B.3 conversion report', () => {
  it('preserves supported components, translates an agent without tools, and reports unsupported ones', () => {
    const plan = planPortable(request([
      document(),
      SKILL,
      AGENT,
      SKILL_RESOURCE,
      document({ id: 'workflow:alta', kind: 'workflow', path: 'workflows/alta.json', title: 'Alta' }),
      document({ id: 'routine:diaria', kind: 'routine', path: 'routines/diaria.json', title: 'Diaria' }),
      document({ id: 'document:n3', path: 'private/n3.md', title: 'N3', classification: 'N3' }),
    ]))
    const { files, report } = convertPortable(plan)

    expect(report.accepted).toBe(4)
    expect(report.omitted).toBe(1)
    expect(report.rejected).toBe(1)
    expect(report.legacyGenerator).toBe('retained')
    expect(report.legacyReason).toBe('D13-open')
    expect(report.limitations).toEqual(expect.arrayContaining([
      'workflow-not-representable',
      'not-a-host-component',
      'legacy-generator-retained:D13-open',
    ]))
    expect(report.limitations).not.toContain('tools-restricted')
    expect(report.withheld.count).toBe(1)
    expect(report.withheld.reasons).toEqual(['classification-denied'])
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'knowledge/a.md', target: 'resources/knowledge/a.md', loaded: false }),
      expect.objectContaining({ source: 'skills/saludo/SKILL.md', target: 'skills/saludo/SKILL.md', loaded: true }),
      expect.objectContaining({ source: 'agents/revisor.md', target: 'agents/revisor.md', loaded: true }),
      expect.objectContaining({ source: 'skills/saludo/reference.md', target: 'skills/saludo/reference.md', loaded: false }),
    ]))
    expect(report.rows).toEqual(expect.arrayContaining([
      { source: 'agents/revisor.md', kind: 'agent', field: 'tools', decision: 'preserved' },
      { source: 'workflows/alta.json', kind: 'workflow', field: 'component', decision: 'rejected', reason: 'workflow-not-representable' },
      { source: 'routines/diaria.json', kind: 'routine', field: 'component', decision: 'omitted', reason: 'not-a-host-component' },
    ]))
    const agent = files.find(file => file.source === 'agents/revisor.md')
    expect(agent?.content).toContain('tools:')
    expect(agent?.content).toContain('name: revisor')
    expect(agent?.content).toContain('Revisa sin aprobar.')
  })

  it('rejects invalid skills, tools, backups, sessions, and transcripts instead of reinterpreting them', () => {
    const plan = planPortable(request([
      document({ id: 'skill:rota', kind: 'skill', path: 'skills/rota/SKILL.md', title: 'Rota', content: 'sin frontmatter\n' }),
      document({ id: 'document:backup', kind: 'resource', path: 'backups/full.zip', title: 'Backup', content: 'zip' }),
      document({ id: 'document:backup-root', kind: 'resource', path: 'backup.zip', title: 'Backup raíz', content: 'zip' }),
      document({ id: 'tool:uno', kind: 'tool' as never, path: 'tools/uno.json', title: 'Tool', content: '{}' }),
    ]))
    const { report } = convertPortable(plan)
    expect(report.rejected).toBe(4)
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'skills/rota/SKILL.md', reason: 'skill-invalid' }),
      expect.objectContaining({ source: 'backups/full.zip', reason: 'backup-not-space-package' }),
      expect.objectContaining({ source: 'backup.zip', reason: 'backup-not-space-package' }),
      expect.objectContaining({ source: 'tools/uno.json', reason: 'tool-not-representable' }),
    ]))

    const fake = {
      manifest: plan.manifest,
      files: [{
        path: 'sessions/one.jsonl', kind: 'session', content: '{"x":1}\n', mediaType: 'application/json', classification: 'N2',
      }],
    }
    const session = convertPortable(fake as never)
    expect(session.report.rejected).toBe(1)
    expect(session.report.rows).toContainEqual({
      source: 'sessions/one.jsonl', kind: 'session', field: 'component', decision: 'rejected', reason: 'session-transcript',
    })
  })

  it('carries origin in the inventory and changes the digest when origin changes', () => {
    const child = document()
    const inherited = document({ id: 'document:parent', path: 'knowledge/parent.md', title: 'Padre', content: 'Padre.\n' })
    const withParent = planPortable(request([child], [
      { ...inherited, inheritable: true, granted: true },
    ]))
    expect(withParent.manifest.files.map(file => [file.path, file.origin])).toEqual([
      ['knowledge/a.md', 'child'],
      ['knowledge/parent.md', 'inherited'],
    ])
    const childOnly = planPortable(request([child]))
    expect(withParent.digest).not.toBe(childOnly.digest)
    expect(convertPortable(withParent).report.rows).toContainEqual({
      source: 'knowledge/parent.md', kind: 'document', field: 'origin', decision: 'preserved',
    })
  })

  it('rejects a duplicate or reserved skill name instead of aborting the package', () => {
    const plan = planPortable(request([
      { ...SKILL, id: 'skill:dup-a', path: 'skills/dup-a/SKILL.md', content: '---\nname: dup\ndescription: Uno\n---\n\nUno.\n' },
      { ...SKILL, id: 'skill:dup-b', path: 'skills/dup-b/SKILL.md', content: '---\nname: dup\ndescription: Dos\n---\n\nDos.\n' },
      { ...SKILL, id: 'skill:reserved', path: 'skills/reserved/SKILL.md', content: '---\nname: faberloom-space\ndescription: Reservada\n---\n\nReservada.\n' },
    ]))
    const { files, report } = convertPortable(plan)
    expect(files).toHaveLength(1)
    expect(report.rejected).toBe(2)
    expect(report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'skills/dup-b/SKILL.md', reason: 'skill-name-conflict' }),
      expect.objectContaining({ source: 'skills/reserved/SKILL.md', reason: 'skill-reserved-name' }),
    ]))
  })

  it('moves the digest when only origin changes', () => {
    const doc = document({ path: 'knowledge/same.md', content: 'Mismo.\n' })
    const identity = {
      spaceId: 'sp-1',
      spaceTitle: 'Espacio QA',
      editorialRevision: 'a'.repeat(40),
      parentRevision: 'b'.repeat(40),
    }
    const child = planPortable({
      identity,
      generatedAt: '2026-11-09T00:00:00.000Z',
      softwareVersion: '1.0.0',
      contributions: [doc],
    })
    const inherited = planPortable({
      identity,
      generatedAt: '2026-11-09T00:00:00.000Z',
      softwareVersion: '1.0.0',
      contributions: [],
      inherited: [{ ...doc, inheritable: true, granted: true }],
    })
    expect(child.manifest.files[0]).toMatchObject({ path: 'knowledge/same.md', origin: 'child' })
    expect(inherited.manifest.files[0]).toMatchObject({ path: 'knowledge/same.md', origin: 'inherited' })
    expect(child.manifest.files[0]?.sha256).toBe(inherited.manifest.files[0]?.sha256)
    expect(child.digest).not.toBe(inherited.digest)
  })

  it('is reproducible for the same inputs', () => {
    const first = planPortable(request([document(), SKILL, AGENT]))
    const second = planPortable(request([document(), SKILL, AGENT]))
    expect(first.digest).toBe(second.digest)
    expect(convertPortable(first).report).toEqual(convertPortable(second).report)
  })
})
