import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMemory from '../src/index.ts'

/** Boot the storage/domain composition plus the memory service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomMemory)
  return { ctx, memory: ctx.faberloomMemory }
}

const OWNER = 'compras2@sondelsa.com'

describe('FaberLoomMemory', () => {
  it('F13 · recovers an active teaching in a later case with the same scope only', async () => {
    const { memory } = await harness()
    const teaching = await memory.createTeaching(OWNER, {
      scope: 'space', spaceId: 'eguisa', task: 'proforma',
      text: 'Consultar el precio vigente antes de cotizar.', source: 'correction:oc-1', author: OWNER, active: true, caseRef: 'oc-1',
    })
    expect(teaching).toMatchObject({ status: 'active', version: 1 })

    const later = await memory.retrieve(OWNER, { spaceId: 'eguisa', task: 'proforma', caseRef: 'oc-2' })
    expect(later.map(entry => entry.id)).toEqual([teaching.id])
    expect(later[0]?.uses).toEqual(['oc-1', 'oc-2'])
    expect(await memory.retrieve(OWNER, { spaceId: 'eguisa', task: 'otra' })).toEqual([])
    expect(await memory.retrieve(OWNER, { spaceId: 'sondel', task: 'proforma' })).toEqual([])
  })

  it('keeps an inferred teaching a candidate until it is confirmed', async () => {
    const { memory } = await harness()
    await memory.createTeaching(OWNER, { scope: 'global', text: 'quizá', source: 'inference', author: 'agent' })
    expect(await memory.retrieve(OWNER, {})).toEqual([])
    expect(await memory.retrieve(OWNER, { includeCandidates: true })).toHaveLength(1)
  })

  it('F14 · separates requirement changes from agent failures', async () => {
    const { memory } = await harness()
    await memory.recordPerformance(OWNER, { agentId: 'a1', task: 'proforma', outcome: 'approved' })
    await memory.recordPerformance(OWNER, { agentId: 'a1', task: 'proforma', outcome: 'corrected', cause: 'error' })
    await memory.recordPerformance(OWNER, { agentId: 'a1', task: 'proforma', outcome: 'corrected', cause: 'requirement-change' })
    await memory.recordPerformance(OWNER, { agentId: 'a1', task: 'proforma', outcome: 'corrected', cause: 'requirement-change' })
    const summary = await memory.performance(OWNER, { agentId: 'a1' })
    expect(summary).toMatchObject({ uses: 4, approved: 1, corrected: 3, agentFailures: 1 })
    expect(summary.correctionsByCause).toEqual({ error: 1, 'requirement-change': 2 })
    expect(summary.correctionRate).toBeCloseTo(0.75, 6)
  })

  it('F36 · editing keeps history, uses, and the current version only', async () => {
    const { memory } = await harness()
    const teaching = await memory.createTeaching(OWNER, {
      scope: 'space', spaceId: 'eguisa', text: 'precio v1', source: 'correction:oc-1', author: OWNER, active: true, caseRef: 'oc-1',
    })
    const edited = await memory.editTeaching(OWNER, teaching.id, { text: 'precio v2', reason: 'precio cambió', author: OWNER })
    expect(edited).toMatchObject({ version: 2, supersedes: 1, text: 'precio v2', uses: ['oc-1'] })
    const versions = await memory.listVersions(OWNER, teaching.id)
    expect(versions.map(entry => `${String(entry.version)}:${entry.status}`)).toEqual(['1:superseded', '2:active'])
    const recovered = await memory.retrieve(OWNER, { spaceId: 'eguisa' })
    expect(recovered.map(entry => entry.text)).toEqual(['precio v2'])

    const revoked = await memory.revokeTeaching(OWNER, teaching.id)
    expect(revoked.status).toBe('revoked')
    expect(await memory.retrieve(OWNER, { spaceId: 'eguisa' })).toEqual([])
    expect((await memory.listVersions(OWNER, teaching.id)).map(entry => entry.version)).toEqual([1, 2])
    await expect(memory.editTeaching(OWNER, teaching.id, { text: 'x', reason: 'r', author: OWNER })).rejects.toThrow('revoked')
  })

  it('F15 · a late error updates the teaching and keeps the original version', async () => {
    const { memory } = await harness()
    const teaching = await memory.createTeaching(OWNER, {
      scope: 'space', spaceId: 'eguisa', text: 'talla 42 = 27cm', source: 'correction:oc-1', author: OWNER, active: true,
    })
    const corrected = await memory.recordLateError(OWNER, {
      caseRef: 'oc-9', detail: 'talla 42 = 28cm', teachingId: teaching.id, author: OWNER,
    })
    expect(corrected).toMatchObject({ version: 2, text: 'talla 42 = 28cm' })
    expect((await memory.listVersions(OWNER, teaching.id)).map(entry => entry.text)).toEqual(['talla 42 = 27cm', 'talla 42 = 28cm'])
    const silent = await memory.recordLateError(OWNER, { caseRef: 'oc-10', detail: 'sin enseñanza', author: OWNER })
    expect(silent).toBeUndefined()
  })

  it('F32 · exports and restores knowledge without credentials', async () => {
    const { memory } = await harness()
    await memory.createTeaching(OWNER, { scope: 'agent', agentId: 'a1', text: 'revisar tallas', source: 'correction:oc-1', author: OWNER, active: true })
    await memory.recordPerformance(OWNER, { agentId: 'a1', task: 'proforma', outcome: 'approved', cost: 0.02 })
    const snapshot = await memory.exportKnowledge(OWNER)
    expect(snapshot.teachings).toHaveLength(1)
    expect(snapshot.performance).toHaveLength(1)
    expect(JSON.stringify(snapshot)).not.toContain('credential')

    const { memory: restored } = await harness()
    const result = await restored.importKnowledge('otro@muitowork.com', snapshot)
    expect(result).toEqual({ teachings: 1, performance: 1, lateErrors: 0 })
    expect((await restored.retrieve('otro@muitowork.com', { agentId: 'a1' })).map(entry => entry.text)).toEqual(['revisar tallas'])
    expect((await restored.performance('otro@muitowork.com')).approved).toBe(1)
  })

  it('guards ownership and missing records', async () => {
    const { memory } = await harness()
    const teaching = await memory.createTeaching(OWNER, { scope: 'global', text: 'x', source: 's', author: OWNER, active: true })
    await expect(memory.editTeaching('otro', teaching.id, { text: 'y', reason: 'r', author: 'otro' })).rejects.toThrow('only the owner')
    await expect(memory.revokeTeaching('otro', teaching.id)).rejects.toThrow('only the owner')
    await expect(memory.getTeaching('missing' as never)).rejects.toThrow('not found')
    expect(await memory.listTeachings(OWNER, { scope: 'global' })).toHaveLength(1)
    expect(await memory.listTeachings('otro')).toEqual([])
  })
})
