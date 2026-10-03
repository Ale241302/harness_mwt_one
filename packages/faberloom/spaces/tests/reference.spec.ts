import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomSpaces from '../src/index.ts'
import type { FaberLoomSpaceId, SpaceActor, SpaceIndexEntry } from '../src/index.ts'

/** Boot the real storage/domain composition plus the spaces service. */
async function harness() {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  return { ctx, spaces: ctx.faberloomSpaces }
}

const SONDEL: SpaceActor = { id: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }
const SONEPAR: SpaceActor = { id: 'otro@sonepar.com', role: 'client_b2b', companyId: 'co-sonepar', readOnly: false }
const COLLEAGUE: SpaceActor = { id: 'logistica2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

/** Wait long enough for two creations to carry distinct ISO instants. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
}

describe('FaberLoomSpaces find', () => {
  it('lists the actor readable spaces most recent first for an empty or separator-only query', async () => {
    const { spaces } = await harness()
    const first = await spaces.create(SONDEL, { title: 'Primero' })
    await tick()
    const second = await spaces.create(SONDEL, { title: 'Segundo' })

    const listed = await spaces.find(SONDEL, '')
    expect(listed.map(entry => entry.id)).toEqual([second.id, first.id])
    expect(listed.every(entry => entry.score === 0 && entry.reasons.length === 0)).toBe(true)
    expect((await spaces.find(SONDEL, '!!!')).map(entry => entry.id)).toEqual([second.id, first.id])
  })

  it('scores title, context, and memory, and drops a query with no match', async () => {
    const { spaces } = await harness()
    const title = await spaces.create(SONDEL, { title: 'Formatos de documentos' })
    const contextual = await spaces.create(SONDEL, { title: 'Operativo' })
    await spaces.update(SONDEL, contextual.id, { context: { formato: 'informe mensual' } })
    const remembered = await spaces.create(SONDEL, { title: 'Archivo' })
    await spaces.remember(SONDEL, 'plantilla de reporte trimestral', [remembered.id])

    expect(await spaces.find(SONDEL, 'formatos'))
      .toEqual([{ id: title.id, title: 'Formatos de documentos', score: 3, reasons: ['title'] }])
    expect(await spaces.find(SONDEL, 'informe'))
      .toEqual([{ id: contextual.id, title: 'Operativo', score: 2, reasons: ['context'] }])
    expect(await spaces.find(SONDEL, 'reporte'))
      .toEqual([{ id: remembered.id, title: 'Archivo', score: 2, reasons: ['memory'] }])
    expect(await spaces.find(SONDEL, 'inexistente')).toEqual([])
  })

  it('folds accents and case before matching', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Cartón y Papel' })
    expect((await spaces.find(SONDEL, 'carton')).map(entry => entry.id)).toEqual([space.id])
    expect((await spaces.find(SONDEL, 'CARTÓN')).map(entry => entry.id)).toEqual([space.id])
  })

  it('excludes other tenants and archived spaces', async () => {
    const { spaces } = await harness()
    const visible = await spaces.create(SONDEL, { title: 'Visible' })
    const archived = await spaces.create(SONDEL, { title: 'Visible archivado' })
    await spaces.archive(SONDEL, archived.id)
    const foreign = await spaces.create(SONEPAR, { title: 'Visible ajeno' })

    expect((await spaces.find(SONDEL, 'visible')).map(entry => entry.id)).toEqual([visible.id])
    expect((await spaces.find(SONEPAR, 'visible')).map(entry => entry.id)).toEqual([foreign.id])
    expect((await spaces.find(SONDEL, '')).map(entry => entry.id)).toEqual([visible.id])
    expect((await spaces.find(SONEPAR, '')).map(entry => entry.id)).toEqual([foreign.id])
  })

  it('applies the limit and breaks a score tie by recency', async () => {
    const { spaces } = await harness()
    const older = await spaces.create(SONDEL, { title: 'Empate' })
    await tick()
    const newer = await spaces.create(SONDEL, { title: 'Empate' })

    expect((await spaces.find(SONDEL, 'empate')).map(entry => entry.id)).toEqual([newer.id, older.id])
    expect(await spaces.find(SONDEL, 'empate', 1)).toEqual([{ id: newer.id, title: 'Empate', score: 3, reasons: ['title'] }])
  })

  it('delegates ranking to a mounted space index', async () => {
    const { ctx, spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Delegado' })
    const rank = vi.fn(async (_entries: readonly SpaceIndexEntry[], _query: string, _limit: number) => [
      { id: space.id, title: 'Delegado', score: 99, reasons: ['index'] },
    ])
    ctx.provide('spaceIndex', { rank } as never)

    const results = await spaces.find(SONDEL, 'cualquiera')
    expect(rank).toHaveBeenCalledTimes(1)
    const entries = (rank.mock.calls[0] as unknown as [readonly SpaceIndexEntry[]])[0]
    expect(entries.some(entry => entry.id === space.id)).toBe(true)
    expect(results).toEqual([{ id: space.id, title: 'Delegado', score: 99, reasons: ['index'] }])
  })

  it('resolves memory through a readable member space whose ancestor is unreadable', async () => {    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Padre' })
    const child = await spaces.create(SONDEL, { title: 'Hijo', parentId: parent.id })
    await spaces.update(SONDEL, child.id, { members: [COLLEAGUE.id] })
    await spaces.remember(SONDEL, 'nota interna', [child.id])

    // The colleague reads the child but not the parent, so resolution stops at the break.
    expect(await spaces.find(COLLEAGUE, '')).toEqual([{ id: child.id, title: 'Hijo', score: 0, reasons: [] }])
  })
})

describe('FaberLoomSpaces reference', () => {
  it('composes context, inherited memory, and file metadata under exclusions', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Formatos' })
    await spaces.update(SONDEL, parent.id, { context: { plantilla: 'informe', tono: 'formal' } })
    await spaces.remember(SONDEL, 'usar encabezado institucional', [parent.id])
    const child = await spaces.create(SONDEL, { title: 'Sondel', parentId: parent.id })
    await spaces.update(SONDEL, child.id, { context: { tono: 'informal' }, excluded: [parent.id] })
    const file = await spaces.attachFile(SONDEL, child.id, {
      name: 'modelo.txt',
      mediaType: 'text/plain',
      contentBase64: Buffer.from('hola').toString('base64'),
    })

    const reference = await spaces.reference(SONDEL, child.id)
    expect(reference.space).toMatchObject({ id: child.id, title: 'Sondel' })
    expect(reference.context.resolved).toEqual({ tono: 'informal' })
    expect(reference.context.excluded).toEqual([parent.id])
    expect(reference.memory.map(entry => entry.text)).toContain('usar encabezado institucional')
    expect(reference.files.map(entry => entry.id)).toEqual([file.id])
    expect(reference.files[0]).not.toHaveProperty('contentBase64')
    expect(reference.agentId).toBeUndefined()
    expect(reference.workspaceId).toBeUndefined()
  })

  it('surfaces inherited context conflicts instead of prioritizing', async () => {
    const { spaces } = await harness()
    const parent = await spaces.create(SONDEL, { title: 'Padre' })
    await spaces.update(SONDEL, parent.id, { context: { tono: 'formal' } })
    const child = await spaces.create(SONDEL, { title: 'Hijo', parentId: parent.id })
    await spaces.update(SONDEL, child.id, { context: { tono: 'informal' } })

    const reference = await spaces.reference(SONDEL, child.id)
    expect(reference.context.conflicts).toEqual([{
      key: 'tono',
      candidates: [
        { spaceId: child.id, value: 'informal' },
        { spaceId: parent.id, value: 'formal' },
      ],
    }])
    expect(reference.context.resolved).toEqual({})
  })

  it('reports the responsible agent and mirrored workspace, and enforces access', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'SICOP', agentId: 'agent-1', workspaceId: 'ws-1' })

    const reference = await spaces.reference(SONDEL, space.id)
    expect(reference.agentId).toBe('agent-1')
    expect(reference.workspaceId).toBe('ws-1')
    await expect(spaces.reference(SONEPAR, space.id)).rejects.toThrow('access denied')
    await expect(spaces.reference(SONDEL, 'missing' as FaberLoomSpaceId)).rejects.toThrow('not found')
  })

  it('carries the MWT client directive for a referenced source', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Cliente' })
    await spaces.update(SONDEL, space.id, { sources: [{ kind: 'mwt-client', id: 'cli-7' }] })

    const reference = await spaces.reference(SONDEL, space.id)
    expect(reference.context.directives).toHaveLength(1)
    expect(reference.context.directives[0]).toContain('cliente cli-7')
  })
})

describe('FaberLoomSpaces memory', () => {
  it('forgets an owned entry, reports a missing one, and refuses a foreign one', async () => {
    const { spaces } = await harness()
    const space = await spaces.create(SONDEL, { title: 'Memoria' })
    const entry = await spaces.remember(SONDEL, 'dato', [space.id])

    expect(await spaces.forgetMemory(SONDEL, 'missing')).toBe(false)
    await expect(spaces.forgetMemory(SONEPAR, entry.id)).rejects.toThrow('memory access denied')
    expect(await spaces.forgetMemory(SONDEL, entry.id)).toBe(true)
  })
})
