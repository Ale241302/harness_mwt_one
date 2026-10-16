import { describe, expect, it } from 'vitest'
import {
  FABERLOOM_MIRROR_DOMAINS,
  FABERLOOM_MIRROR_FORMAT_VERSION,
  SKILL_BUNDLE_NAME,
  checkMirrorDocument,
  deriveMirrorOrigin,
  hashRow,
} from '../src/document.ts'
import { applyMirrorDocument, readMirrorDocument } from '../src/sync.ts'
import { FakeDomains } from './fake-domains.ts'

/** One valid document for the carried domains. */
function documentFor(): unknown {
  return {
    version: FABERLOOM_MIRROR_FORMAT_VERSION,
    platform: 'web',
    domains: {
      faberloom_grants: {
        tables: { grants: { g1: { deleted: false, value: { id: 'g1', action: 'mail.send' } } } },
      },
    },
    skills: { 'informe-diario': '# Informe\n\nCuerpo.' },
  }
}

describe('mirror document', () => {
  it('carries the product domains a backup omits as well as the ones it holds', () => {
    expect(Object.keys(FABERLOOM_MIRROR_DOMAINS)).toEqual([
      'faberloom_spaces',
      'faberloom_agents',
      'faberloom_board',
      'faberloom_routines',
      'faberloom_memory',
      'faberloom_grants',
      'faberloom_connections',
      'faberloom_mcp',
      'faberloom_inbound',
      'faberloom_workflows',
      'faberloom_context',
      'faberloom_shares',
      'faberloom_session_shares',
    ])
    // El registro de Workspaces no viaja: sus filas nombran una carpeta y unas
    // sesiones de una sola maquina, y su servicio no adopta una fila escrita al
    // lado. El ambito que viaja es el Espacio.
    expect(FABERLOOM_MIRROR_DOMAINS['workspace']).toBeUndefined()
    expect(FABERLOOM_MIRROR_DOMAINS['faberloom_spaces']).toEqual(['spaces', 'files', 'memory'])
    expect(FABERLOOM_MIRROR_DOMAINS['faberloom_workflows']).toEqual(['workflows', 'versions', 'pending'])
    expect(FABERLOOM_MIRROR_DOMAINS['faberloom_context']).toEqual(['entries', 'versions'])
    expect(FABERLOOM_MIRROR_DOMAINS['faberloom_shares']).toEqual(['grants', 'content'])
    expect(FABERLOOM_MIRROR_DOMAINS['faberloom_session_shares']).toEqual(['sessions'])
    expect(FABERLOOM_MIRROR_DOMAINS['workspace']).toBeUndefined()
  })

  it('refuses a document whose version it does not know, before any row is inspected', () => {
    const unchecked: Record<string, unknown> = { ...documentFor() as Record<string, unknown> }
    unchecked['version'] = FABERLOOM_MIRROR_FORMAT_VERSION + 1
    const result = checkMirrorDocument(unchecked)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toMatchObject({ path: 'version' })
    expect(result.problems[0]?.detail).toContain(String(FABERLOOM_MIRROR_FORMAT_VERSION))

    // A document with no version at all is refused the same way.
    const absent: Record<string, unknown> = { ...documentFor() as Record<string, unknown> }
    delete absent['version']
    const missing = checkMirrorDocument(absent)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems[0]?.detail).toContain('null')
  })

  it('accepts a complete document and refuses every malformed location', () => {
    expect(checkMirrorDocument(documentFor()).ok).toBe(true)

    const notObject = checkMirrorDocument('nope')
    expect(notObject.ok).toBe(false)
    if (!notObject.ok) expect(notObject.problems[0]?.detail).toContain('JSON object')

    const problems = checkMirrorDocument({
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'tablet',
      domains: {
        d1: 'not-a-domain',
        d2: { tables: 'not-tables' },
        d3: { tables: { t1: 'not-a-table', t2: { k1: 'not-a-row', k2: { value: 1 }, k3: { deleted: true }, k4: { deleted: false } } } },
      },
      skills: { ok: 'body', bad_name: 'body', 'other-name': 7 },
    })
    expect(problems.ok).toBe(false)
    if (problems.ok) return
    expect(problems.problems.map(problem => problem.path).sort()).toEqual([
      'domains.d1',
      'domains.d2.tables',
      'domains.d3.tables.t1',
      'domains.d3.tables.t2.k1',
      'domains.d3.tables.t2.k2',
      'domains.d3.tables.t2.k4',
      'platform',
      'skills.bad_name',
      'skills.other-name',
    ])
    expect(problems.problems.find(problem => problem.path === 'domains.d3.tables.t2.k2')?.detail).toContain('deleted')
    expect(problems.problems.find(problem => problem.path === 'domains.d3.tables.t2.k4')?.detail).toContain('value')

    const skills = checkMirrorDocument({ ...documentFor() as Record<string, unknown>, skills: [] })
    expect(skills.ok).toBe(false)
    if (!skills.ok) expect(skills.problems[0]?.path).toBe('skills')
    const domains = checkMirrorDocument({ ...documentFor() as Record<string, unknown>, domains: [] })
    expect(domains.ok).toBe(false)
    if (!domains.ok) expect(domains.problems[0]?.path).toBe('domains')
  })

  it('derives the harness origin from the console base, and only from that convention', () => {
    expect(deriveMirrorOrigin('https://consola.mwt.one/api')).toBe('https://mwt.one/_/harness/mirror')
    expect(deriveMirrorOrigin('http://consola.local:8080/api')).toBe('http://local:8080/_/harness/mirror')
    expect(deriveMirrorOrigin('https://harness.mwt.one')).toBeUndefined()
    expect(deriveMirrorOrigin('no-es-una-url')).toBeUndefined()
    expect(deriveMirrorOrigin(undefined)).toBeUndefined()
    expect(deriveMirrorOrigin('')).toBeUndefined()
  })

  it('names the skill bundle rule, and hashes rows deterministically', () => {    expect(SKILL_BUNDLE_NAME.test('informe-diario')).toBe(true)
    expect(SKILL_BUNDLE_NAME.test('Informe Diario')).toBe(false)
    expect(SKILL_BUNDLE_NAME.test('../escape')).toBe(false)
    expect(hashRow({ b: 1, a: [2, 3] })).toBe(hashRow({ a: [2, 3], b: 1 }))
    expect(hashRow({ a: 1 })).not.toBe(hashRow({ a: 2 }))
    // A row value the serializer cannot render still yields a stable digest.
    expect(hashRow(undefined)).toBe(hashRow(undefined))
  })
})

describe('mirror traversal', () => {
  it('reads an open domain and names the locations this process does not hold', async () => {
    const domains = new FakeDomains()
    await domains.openTable('faberloom_grants', 'grants').put('g1', { action: 'mail.send' })

    const read = readMirrorDocument(domains, 'desktop')
    expect(read.document.version).toBe(FABERLOOM_MIRROR_FORMAT_VERSION)
    expect(read.document.platform).toBe('desktop')
    expect(read.document.skills).toEqual({})
    expect(read.document.domains['faberloom_grants']?.tables['grants']).toEqual({
      g1: { deleted: false, value: { action: 'mail.send' } },
    })
    // A domain this process never opened is named, never read as empty.
    expect(read.skipped).toContainEqual({ domain: 'faberloom_workflows', table: '*', reason: 'domain-not-open' })
    expect(read.skipped).toHaveLength(Object.keys(FABERLOOM_MIRROR_DOMAINS).length - 1)
  })

  it('names a declared table the open domain does not expose', () => {
    const closed = { get: () => ({ table: () => { throw new Error('no table') } }) }
    const read = readMirrorDocument(closed, 'web')
    expect(read.skipped).toContainEqual({ domain: 'faberloom_spaces', table: 'spaces', reason: 'table-unknown' })
    expect(read.document.domains['faberloom_spaces']?.tables).toEqual({})
  })

  it('round-trips a row, applies a tombstone as a delete, and keeps a row the rule protects', async () => {
    const remote = new FakeDomains()
    await remote.openTable('faberloom_grants', 'grants').put('g1', { action: 'mail.send' })
    const read = readMirrorDocument(remote, 'web')

    const local = new FakeDomains()
    const rows = local.openTable('faberloom_grants', 'grants')
    const applied = await applyMirrorDocument(local, read.document)
    expect(applied.applied).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    expect(applied.kept).toEqual([])
    expect(rows.get('g1')).toEqual({ action: 'mail.send' })

    const tombstone = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web' as const,
      domains: { faberloom_grants: { tables: { grants: { g1: { deleted: true } } } } },
      skills: {},
    }
    await applyMirrorDocument(local, tombstone)
    expect(rows.get('g1')).toBeUndefined()

    const kept = await applyMirrorDocument(local, read.document, { overwrite: () => false })
    expect(kept.kept).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    expect(kept.applied).toEqual([])
    expect(rows.get('g1')).toBeUndefined()
  })

  it('reports a domain this process does not hold open instead of dropping it', async () => {
    const local = new FakeDomains()
    const missing = await applyMirrorDocument(local, {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: { faberloom_workflows: { tables: { workflows: { w1: { deleted: false, value: {} } } } } },
      skills: {},
    })
    expect(missing.skipped).toEqual([{ domain: 'faberloom_workflows', table: '*', reason: 'domain-not-open' }])
    expect(missing.applied).toEqual([])
  })

  it('names a declared table the open domain does not expose while applying', async () => {
    const closed = { get: () => ({ table: () => { throw new Error('no table') } }) }
    const result = await applyMirrorDocument(closed, {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: { faberloom_grants: { tables: { grants: { g1: { deleted: false, value: {} } } } } },
      skills: {},
    })
    expect(result.skipped).toEqual([{ domain: 'faberloom_grants', table: 'grants', reason: 'table-unknown' }])
    expect(result.rows).toEqual([])
  })
})
