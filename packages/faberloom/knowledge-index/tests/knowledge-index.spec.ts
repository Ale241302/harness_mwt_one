import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SpaceIndexEntry } from '@deepseek-ai/dsh-faberloom-spaces'
import FaberLoomKnowledgeIndex from '../src/index.ts'

/** One readable candidate entry with every field empty unless overridden. */
function entry(overrides: { id?: string } & Partial<Omit<SpaceIndexEntry, 'id'>> = {}): SpaceIndexEntry {
  const { id = 'sp-1', ...rest } = overrides
  return {
    id: id as SpaceIndexEntry['id'], title: 'SICOP', context: {}, memory: '', contextEntries: '', filesText: '',
    createdAt: '2026-01-01T00:00:00.000Z', ...rest,
  }
}

/** Boot the index service over fakes. */
async function harness(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(FaberLoomKnowledgeIndex as never, config as never)
  return ctx.get('spaceIndex')!
}

afterEach(() => { vi.unstubAllGlobals() })

describe('FaberLoomKnowledgeIndex lexical ranking', () => {
  it('scores the title, context, curated entries, memory, and file text', async () => {
    const index = await harness()
    const entries = [
      entry({ id: 'a', title: 'Formatos' }),
      entry({ id: 'b', title: 'Otro', filesText: 'plantilla de informe' }),
      entry({ id: 'c', title: 'Contexto', contextEntries: 'estado de la licitacion' }),
    ]
    expect((await index.rank(entries, 'formatos', 10)).map(match => match.id)).toEqual(['a'])
    const files = await index.rank(entries, 'informe', 10)
    expect(files.map(match => match.id)).toEqual(['b'])
    expect(files[0]?.reasons).toContain('files')
    expect((await index.rank(entries, 'licitacion', 10)).map(match => match.id)).toEqual(['c'])
    expect(await index.rank(entries, 'inexistente', 10)).toEqual([])
  })

  it('lists recent spaces for an empty query and honors the limit', async () => {
    const index = await harness()
    const entries = [
      entry({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
      entry({ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' }),
    ]
    expect((await index.rank(entries, '', 10)).map(match => match.id)).toEqual(['b', 'a'])
    expect(await index.rank(entries, 'a', 0)).toEqual([])
  })

  it('expands the query with the Knowledge Hub documents that match it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-'))
    mkdirSync(join(root, 'kb'))
    writeFileSync(join(root, 'kb', 'licitaciones.md'), 'SICOP licitaciones contratacion publica proveedores')
    const index = await harness({ knowledgeRoot: root })
    const matches = await index.rank([entry({ id: 'a', title: 'Compras', contextEntries: 'proveedores homologados' })], 'licitaciones', 10)
    expect(matches.map(match => match.id)).toEqual(['a'])
    expect(matches[0]?.reasons).toContain('knowledge')
  })
})

describe('FaberLoomKnowledgeIndex embeddings', () => {
  const EMBEDDINGS = { embeddingUrl: 'https://embed.test/v1/embeddings', embeddingModel: 'm' }

  it('ranks by cosine similarity through the endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [1, 0] }, { embedding: [0, 1] }] }),
    })))
    const index = await harness(EMBEDDINGS)
    const matches = await index.rank([entry({ id: 'a' }), entry({ id: 'b' })], 'x', 10)
    expect(matches.map(match => match.id)).toEqual(['a', 'b'])
    expect(matches[0]?.score).toBe(100)
    expect(matches[0]?.reasons).toEqual(['embedding'])
  })

  it('falls back to lexical ranking on a malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1] }] }) })))
    const index = await harness(EMBEDDINGS)
    expect((await index.rank([entry({ id: 'a', title: 'Zeta' })], 'zeta', 10)).map(match => match.id)).toEqual(['a'])
  })

  it('falls back on a rejected request, and fails loud when the fallback is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const fallback = await harness(EMBEDDINGS)
    expect((await fallback.rank([entry({ id: 'a', title: 'Zeta' })], 'zeta', 10)).map(match => match.id)).toEqual(['a'])
    const strict = await harness({ ...EMBEDDINGS, lexicalFallback: false })
    await expect(strict.rank([entry()], 'z', 10)).rejects.toThrow('rechazó la petición')
  })
})
