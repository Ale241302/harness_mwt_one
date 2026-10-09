import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAgentRuntime from '../src/index.ts'

/** Boot the storage/domain composition plus the agent-runtime service. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAgentRuntime)
  return ctx.faberloomAgentRuntime
}

describe('FaberLoomAgentRuntime', () => {
  it('records, reads, lists, and removes one consultation', async () => {
    const runtime = await harness()
    const recorded = await runtime.record('owner@x', { spaceId: 'sp-1', callerSessionId: 's-1', childSessionId: 'c-1', label: 'Consulta' })
    expect(recorded).toMatchObject({ spaceId: 'sp-1', callerSessionId: 's-1', childSessionId: 'c-1', label: 'Consulta' })
    expect(await runtime.consultation('owner@x', 'sp-1', 's-1')).toMatchObject({ childSessionId: 'c-1' })
    expect(await runtime.consultation('owner@x', 'sp-1', 's-2')).toBeUndefined()
    expect((await runtime.listForSpace('owner@x', 'sp-1')).map(row => row.childSessionId)).toEqual(['c-1'])
    expect(await runtime.listForSpace('owner@y', 'sp-1')).toEqual([])
    expect(await runtime.remove('owner@x', 'sp-1', 's-1')).toBe(true)
    expect(await runtime.remove('owner@x', 'sp-1', 's-1')).toBe(false)
    expect(await runtime.consultation('owner@x', 'sp-1', 's-1')).toBeUndefined()
  })

  it('replaces the caller child for the same Space and keeps the creation instant', async () => {
    const runtime = await harness()
    const first = await runtime.record('owner@x', { spaceId: 'sp-1', callerSessionId: 's-1', childSessionId: 'c-1', label: 'A' })
    const second = await runtime.record('owner@x', { spaceId: 'sp-1', callerSessionId: 's-1', childSessionId: 'c-2', label: 'B' })
    expect(second.childSessionId).toBe('c-2')
    expect(second.createdAt).toBe(first.createdAt)
    expect((await runtime.listForSpace('owner@x', 'sp-1')).map(row => row.childSessionId)).toEqual(['c-2'])
  })
})
