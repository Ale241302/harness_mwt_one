/**
 * O8C · curation before the month.
 *
 * Merging keeps one current text and marks the others superseded, discarding
 * removes a teaching from retrieval while keeping its history, and the report
 * keeps independent denominators with an explicit unknown where the rows cannot
 * answer a question.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMemory from '../src/index.ts'

const OWNER = 'ceo@muitowork.com'

/** Boot the memory service over one backend. */
async function harness(backend = new MemoryStorageBackend(new MemoryMediaPool())) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomMemory)
  return { ctx, memory: ctx.faberloomMemory, backend }
}

/** Prepare one active teaching through the lifecycle a person drives. */
async function active(memory: Awaited<ReturnType<typeof harness>>['memory'], text: string) {
  const created = await memory.createTeaching(OWNER, { scope: 'global', text, source: 'test', author: OWNER })
  return await memory.activateTeaching(OWNER, created.id, {
    approvedBy: OWNER,
    approvalRef: `ref:${created.id}`,
    proposalVersion: created.version,
  })
}

describe('O8C curation', () => {
  it('merges several active teachings into one candidate and supersedes the rest', async () => {
    const { memory } = await harness()
    const first = await active(memory, 'Saluda por el nombre.')
    const second = await active(memory, 'Cierra con «Saludos».')
    const merged = await memory.mergeTeachings(OWNER, [first.id, second.id], {
      text: 'Saluda por el nombre y cierra con «Saludos».',
      author: OWNER,
      reason: 'dos reglas de estilo repetidas',
    })

    expect(merged.status).toBe('candidate')
    expect(merged.version).toBe(first.version + 1)
    expect(merged.text).toContain('cierra con')
    expect((await memory.getTeaching(second.id)).status).toBe('superseded')
    // The superseded text cannot come back through retrieval.
    const recovered = await memory.retrieve(OWNER)
    expect(recovered.map(entry => entry.text)).not.toContain('Cierra con «Saludos».')
    expect(recovered.map(entry => entry.text)).not.toContain('Saluda por el nombre y cierra con «Saludos».')
    // History keeps both old versions.
    expect((await memory.listVersions(OWNER, first.id)).map(entry => entry.version)).toContain(first.version)
  })

  it('discards a teaching without deleting its history and stops retrieving it', async () => {
    const { memory } = await harness()
    const teaching = await active(memory, 'Usa siempre el nombre de la marca.')
    const discarded = await memory.discardTeaching(OWNER, teaching.id, 'ya no aplica')
    expect(discarded.status).toBe('discarded')
    expect(await memory.retrieve(OWNER)).toEqual([])
    expect((await memory.listTeachings(OWNER)).map(entry => entry.id)).toContain(teaching.id)
  })

  it('keeps independent denominators and a declared unknown in the report', async () => {
    const { memory } = await harness()
    const activeOne = await active(memory, 'Regla activa.')
    await memory.createTeaching(OWNER, { scope: 'global', text: 'Propuesta pendiente.', source: 'test', author: OWNER })
    const toDiscard = await active(memory, 'Se descarta.')
    await memory.discardTeaching(OWNER, toDiscard.id)
    await memory.retrieve(OWNER, { caseRef: 'caso-1' })
    expect((await memory.curationReport(OWNER))).toMatchObject({
      proposals: 1,
      approved: 1,
      discarded: 1,
      revoked: 0,
      superseded: 0,
      used: { teachings: 1, uses: 1 },
      corrections: { total: 0, edit: 0, answerDoubt: 0, iterate: 0 },
      repeated: { cases: 0, withSuggestion: null, withoutSuggestion: null, unknown: null },
    })
    expect(activeOne.status).toBe('active')
  })

  it('does not revive a discarded teaching after a restart over the same store', async () => {
    const backend = new MemoryStorageBackend(new MemoryMediaPool())
    const first = await harness(backend)
    const teaching = await active(first.memory, 'Regla que se descarta.')
    await first.memory.discardTeaching(OWNER, teaching.id)
    await first.ctx.plugin(FaberLoomMemory).dispose()
    await first.ctx.storageDomain.closeAll()

    const second = await harness(backend)
    expect(await second.memory.retrieve(OWNER)).toEqual([])
    expect((await second.memory.curationReport(OWNER)).discarded).toBe(1)
  })
})
