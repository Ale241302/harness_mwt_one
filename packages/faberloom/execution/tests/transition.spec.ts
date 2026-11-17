/**
 * O3-05 boot: a process that starts without a UI still classifies the routines
 * it inherited. A routine this build cannot execute is paused before the first
 * pass, so it never runs in the background.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomNotices from '../../notices/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomExecutions from '../src/index.ts'
import type { RoutineDefinitionInput } from '../../routines/src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot storage, access, notices and routines; the caller mounts executions. */
async function base() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomNotices)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('smtp', () => 'ok')
  return ctx
}

/** A definition whose only step sends mail. */
const SENDER: RoutineDefinitionInput = {
  intent: 'responder',
  triggers: [{ kind: 'manual' }],
  steps: [{ id: 's1', instruction: 'responde', handler: 'smtp' }],
  expectedResult: '',
  permissions: [],
  failurePolicy: 'stop',
}

describe('execution boot transition', () => {
  it('pauses an inherited sending routine before the first pass', async () => {
    const ctx = await base()
    const routine = await ctx.faberloomRoutines.createRoutine(OWNER, { name: 'Responde solo', definition: SENDER })
    await ctx.faberloomRoutines.activateRoutine(OWNER, routine.id)
    expect((await ctx.faberloomRoutines.getRoutine(routine.id)).status).toBe('active')

    // A process that starts with the dispatcher off, as a headless host does.
    await ctx.plugin(FaberLoomExecutions, { ownerId: OWNER, enabled: false, intervalMs: 60_000 })

    await vi.waitFor(async () => {
      expect((await ctx.faberloomRoutines.getRoutine(routine.id)).status).toBe('paused')
    })
    const notices = await ctx.faberloomNotices.list(OWNER)
    expect(notices.some(notice => notice.kind === 'routine-transition')).toBe(true)
  })
})
