/**
 * T10-E1 · the routine and flow surface cannot send, with or without a grant,
 * and `effect: false` is not a bypass: the handler refuses regardless of the
 * flag, so no composition reaches SMTP.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import { createWorkflowHandlers } from '../src/steps.ts'
import type { RoutineDefinitionInput, RoutineStepInput } from '../../routines/src/index.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot storage, access and routines; the caller gets the send spy back. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  const sendMail = vi.fn(async () => ({ messageId: 'should-not-happen', accepted: [] }))
  ctx.provide('faberloomConnections', { sendMail })
  for (const [name, handler] of Object.entries(createWorkflowHandlers(ctx))) {
    ctx.faberloomRoutines.registerHandler(name, handler)
  }
  return { ctx, routines: ctx.faberloomRoutines, access: ctx.faberloomAccess, sendMail }
}

/** One step that names the SMTP handler. */
function definition(effect: boolean, permissions: string[] = []): RoutineDefinitionInput {
  const steps: RoutineStepInput[] = [{ id: 's1', instruction: 'responde al cliente', handler: 'smtp', effect }]
  return { intent: 'responder', triggers: [{ kind: 'manual' }], steps, expectedResult: '', permissions, failurePolicy: 'stop' }
}

describe('T10-E1 · flows and routines cannot send', () => {
  it('a step with effect:false still refuses to send, and nothing reaches the transport', async () => {
    const { routines, sendMail } = await harness()
    const routine = await routines.createRoutine(OWNER, { name: 'Responde solo', definition: definition(false) })
    await routines.activateRoutine(OWNER, routine.id)

    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 't10-a', channel: 'manual' })

    expect(sendMail).not.toHaveBeenCalled()
    const step = started.execution.steps['s1']
    expect(step?.status).toBe('failed')
    expect(step?.reason).toContain('WRITE_NOT_APPROVED')
    // effect:false skips the grant check, so the refusal comes from the handler.
    expect(started.execution.reason).toContain('WRITE_NOT_APPROVED')
    expect(started.execution.status).toBe('failed')
  })

  it('a valid mail.send grant does not authorize a send: the grant is not the approval', async () => {
    const { routines, access, sendMail } = await harness()
    const routine = await routines.createRoutine(OWNER, { name: 'Responde con permiso', definition: definition(true, ['mail.send']) })
    await routines.activateRoutine(OWNER, routine.id)
    // The exact grant the engine asks for, scoped to this routine.
    await access.grant(OWNER, { action: 'mail.send', context: String(routine.id) })

    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 't10-b', channel: 'manual' })

    expect(sendMail).not.toHaveBeenCalled()
    const step = started.execution.steps['s1']
    expect(step?.reason).toContain('WRITE_NOT_APPROVED')
    // The engine authorized the effect; the handler refused it, so the effect is
    // uncertain and goes to review instead of being reported as done.
    expect(started.execution.status).toBe('needs_review')
    expect(started.execution.reason).toBe('EFFECT_UNCERTAIN')
  })

  it('an effect step without a grant stops before the handler runs', async () => {
    const { routines, sendMail } = await harness()
    const routine = await routines.createRoutine(OWNER, { name: 'Sin permiso', definition: definition(true, ['mail.send']) })
    await routines.activateRoutine(OWNER, routine.id)

    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 't10-c', channel: 'manual' })

    expect(sendMail).not.toHaveBeenCalled()
    expect(started.execution.steps['s1']?.reason).toContain('NOT_AUTHORIZED')
    expect(started.execution.status).toBe('needs_review')
  })
})
