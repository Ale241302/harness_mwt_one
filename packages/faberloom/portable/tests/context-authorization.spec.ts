import { describe, expect, it } from 'vitest'
import { planPortable, type PortableContribution, type PortableRequest } from '../src/index.ts'

/** One request with a fixed identity. */
function request(
  contributions: readonly PortableContribution[],
  overrides: Partial<PortableRequest> = {},
): PortableRequest {
  return {
    identity: {
      spaceId: 'sp-child',
      spaceTitle: 'Hijo',
      editorialRevision: 'c'.repeat(40),
      parentRevision: 'b'.repeat(40),
    },
    generatedAt: '2026-11-09T00:00:00.000Z',
    softwareVersion: '1.0.0',
    contributions,
    ...overrides,
  }
}

/** One document contribution. */
function document(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'document:knowledge/a.md',
    kind: 'document',
    path: 'knowledge/a.md',
    title: 'Titulo visible',
    content: 'Cuerpo visible.\n',
    classification: 'N2',
    ...overrides,
  }
}

describe('3A.2 inheritance and restricted content', () => {
  it('does not inherit a contribution the child cannot access by contribution', () => {
    const parent = document({
      id: 'parent:private',
      path: 'parent/private.md',
      title: 'Titulo privado',
      content: 'Cuerpo privado.\n',
      inheritable: true,
      granted: false,
    })
    const planned = planPortable(request([], { inherited: [parent] }))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'inheritance-denied' }])
    const manifest = JSON.stringify(planned.manifest)
    expect(manifest).not.toContain('Titulo privado')
    expect(manifest).not.toContain('Cuerpo privado')
  })

  it('does not inherit an excluded class even when the grant exists', () => {
    const parent = document({
      id: 'parent:restricted',
      path: 'parent/restricted.md',
      title: 'Titulo restringido',
      content: 'Cuerpo restringido.\n',
      classification: 'N3',
      inheritable: true,
      granted: true,
    })
    const planned = planPortable(request([], { inherited: [parent] }))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'classification-denied' }])
    expect(JSON.stringify(planned.manifest)).not.toContain('Titulo restringido')
  })

  it('lets the child exclusion win without reporting the parent', () => {
    const parent = document({
      id: 'parent:excluded',
      path: 'parent/excluded.md',
      title: 'Titulo excluido',
      inheritable: true,
      granted: true,
    })
    const planned = planPortable(request([], { inherited: [parent], exclusions: ['parent:excluded'] }))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([])
    expect(JSON.stringify(planned.manifest)).not.toContain('Titulo excluido')
  })

  it('lets the child win when the same identifier exists on both sides', () => {
    const parent = document({
      id: 'shared',
      path: 'knowledge/shared.md',
      title: 'Padre',
      content: 'Contenido del padre.\n',
      inheritable: true,
      granted: true,
    })
    const child = document({
      id: 'shared',
      path: 'knowledge/shared.md',
      title: 'Hijo',
      content: 'Contenido del hijo.\n',
    })
    const planned = planPortable(request([child], { inherited: [parent] }))

    expect(planned.files).toHaveLength(1)
    expect(planned.files[0]?.content).toBe('Contenido del hijo.\n')
    expect(JSON.stringify(planned.manifest)).not.toContain('Contenido del padre')
  })

  it('CTR-PORTABLE-01 · refuses a session or transcript even from the same Space', () => {
    const transcript = document({
      id: 'transcript:1',
      kind: 'transcript',
      path: 'transcripts/1.md',
      title: 'Transcripcion',
      content: 'Texto de la transcripcion.\n',
    })
    const dependent = document({ id: 'document:dependent', dependsOn: ['transcript:1'] })
    const planned = planPortable(request([transcript, dependent]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([
      { path: '(restricted)', reason: 'session-transcript' },
      { path: 'knowledge/a.md', reason: 'dependency-rejected' },
    ])
    expect(JSON.stringify(planned.manifest)).not.toContain('Texto de la transcripcion')
  })

  it('refuses a missing dependency and every dependent that refers to it', () => {
    const dependency = document({ id: 'document:missing', dependsOn: ['document:absent'] })
    const dependent = document({ id: 'document:dependent', path: 'knowledge/b.md', dependsOn: ['document:missing'] })
    const planned = planPortable(request([dependency, dependent]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([
      { path: 'knowledge/a.md', reason: 'dependency-missing' },
      { path: 'knowledge/b.md', reason: 'dependency-rejected' },
    ])
  })

  it('refuses a dependency cycle instead of truncating it', () => {
    const left = document({ id: 'document:left', dependsOn: ['document:right'] })
    const right = document({ id: 'document:right', path: 'knowledge/b.md', dependsOn: ['document:left'] })
    const planned = planPortable(request([left, right]))

    expect(planned.files).toEqual([])
    expect(planned.rejected.every(reason => reason.reason === 'dependency-cycle')).toBe(true)
  })

  it('denies a conflicting or unsupported classification in metadata', () => {
    const conflicting = document({ metadata: { classification: 'N3' } })
    const unsupported = document({ id: 'document:unsupported', classification: 'PÚBLICO' })
    const planned = planPortable(request([conflicting, unsupported]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'classification-denied' }])
  })

  it('never writes a synthetic secret and does not name it in the manifest', () => {
    const secret = document({ content: 'clave sk-proj-abcdefghijklmnop\n' })
    const planned = planPortable(request([secret]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'secret' }])
    const manifest = JSON.stringify(planned.manifest)
    expect(manifest).not.toContain('sk-proj-abcdefghijklmnop')
    expect(manifest).not.toContain('Titulo visible')
  })

  it('refuses an excluded class in every contribution kind', () => {
    const kinds: readonly PortableContribution['kind'][] = ['context', 'skill', 'agent', 'metadata', 'resource', 'document']
    const contributions = kinds.map(kind => document({
      id: `${kind}:1`,
      kind,
      path: `${kind}/file.md`,
      classification: 'N3',
    }))
    const planned = planPortable(request(contributions))

    expect(planned.files).toEqual([])
    expect(planned.rejected.every(reason => reason.reason === 'classification-denied')).toBe(true)
    expect(JSON.stringify(planned.manifest)).not.toContain('Titulo visible')
  })

  it('refuses a secret in metadata and in a skill body', () => {
    const metadata = document({ id: 'document:metadata', metadata: { note: 'sk-proj-abcdefghijklmnop' } })
    const skillSecret = document({
      id: 'skill:secret',
      kind: 'skill',
      path: 'skills/secret/SKILL.md',
      content: 'Usa sk-proj-abcdefghijklmnop para entrar.\n',
    })
    const planned = planPortable(request([metadata, skillSecret]))

    expect(planned.files).toEqual([])
    expect(planned.rejected.every(reason => reason.reason === 'secret')).toBe(true)
    expect(JSON.stringify(planned.manifest)).not.toContain('sk-proj-abcdefghijklmnop')
  })

  it('refuses every duplicate child id instead of silently keeping one', () => {
    const first = document({ id: 'document:same', path: 'knowledge/first.md', content: 'Primero\n' })
    const second = document({ id: 'document:same', path: 'knowledge/second.md', content: 'Segundo\n' })
    const third = document({ id: 'document:same', path: 'knowledge/third.md', content: 'Tercero\n' })
    const planned = planPortable(request([first, second, third]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([
      { path: 'knowledge/first.md', reason: 'name-conflict' },
      { path: 'knowledge/second.md', reason: 'name-conflict' },
      { path: 'knowledge/third.md', reason: 'name-conflict' },
    ])
  })

  it('denies a class declared under another metadata spelling', () => {
    const conflicting = document({ metadata: { Classification: 'CEO-ONLY' } })
    const planned = planPortable(request([conflicting]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'classification-denied' }])
  })

  it('denies the dataClassification and data-classification spellings', () => {
    const long = document({ id: 'document:long', metadata: { dataClassification: 'N3' } })
    const dashed = document({ id: 'document:dashed', metadata: { 'data-classification': 'N4' } })
    const planned = planPortable(request([long, dashed]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'classification-denied' }])
  })

  it('refuses a Spanish session path presented as a resource', () => {
    const session = document({ id: 'resource:session', kind: 'resource', path: 'sesiones/2026-11-09.md' })
    const planned = planPortable(request([session]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'session-transcript' }])
  })

  it('refuses a session id declared with another metadata spelling', () => {
    const session = document({ id: 'resource:session', kind: 'resource', metadata: { session_id: 's-1' } })
    const planned = planPortable(request([session]))

    expect(planned.files).toEqual([])
    expect(planned.rejected).toEqual([{ path: '(restricted)', reason: 'session-transcript' }])
  })

  it('refuses a secret in a path and in a media type', () => {
    const inPath = document({ id: 'document:path', path: 'knowledge/sk-proj-abcdefghijklmnop.md' })
    const inMedia = document({ id: 'document:media', mediaType: 'text/plain; token=sk-proj-abcdefghijklmnop' })
    const planned = planPortable(request([inPath, inMedia]))

    expect(planned.files).toEqual([])
    expect(planned.rejected.every(reason => reason.reason === 'secret')).toBe(true)
    expect(JSON.stringify(planned.manifest)).not.toContain('sk-proj-abcdefghijklmnop')
  })
})
