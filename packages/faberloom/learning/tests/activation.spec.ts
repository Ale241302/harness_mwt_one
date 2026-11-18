import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMemory from '../src/index.ts'

type Backend = MemoryStorageBackend

/** Boot the storage/domain composition plus the memory service over one medium. */
async function harness(backend: Backend = new MemoryStorageBackend(new MemoryMediaPool())) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', backend)
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomMemory)
  return { ctx, memory: ctx.faberloomMemory, backend }
}

const OWNER = 'compras2@sondelsa.com'

describe('teaching activation (O5-06A)', () => {
  it('never lets a proposal influence a decision', async () => {
    const { memory } = await harness()
    const proposal = await memory.createTeaching(OWNER, {
      scope: 'space', spaceId: 'eguisa', text: 'Cotizar siempre en dólares.', source: 'capture:email', author: OWNER,
    })
    expect(proposal.status).toBe('candidate')
    expect(await memory.retrieve(OWNER, { spaceId: 'eguisa' })).toEqual([])
    expect(await memory.retrieve(OWNER, { spaceId: 'eguisa', includeCandidates: true })).toHaveLength(1)
  })

  it('activates one exact version through a named human approval and records it', async () => {
    const { memory } = await harness()
    const proposal = await memory.createTeaching(OWNER, {
      scope: 'space', spaceId: 'eguisa', text: 'Cotizar siempre en dólares.', source: 'capture:email', author: OWNER,
    })
    const active = await memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: OWNER, approvalRef: 'panel:teachings:42', proposalVersion: 1,
    })
    expect(active.status).toBe('active')
    expect((await memory.retrieve(OWNER, { spaceId: 'eguisa' })).map(entry => entry.text)).toEqual(['Cotizar siempre en dólares.'])
    expect(await memory.listActivations(OWNER, proposal.id)).toEqual([
      expect.objectContaining({ approvedBy: OWNER, approvalRef: 'panel:teachings:42', proposalVersion: 1 }),
    ])
  })

  it('refuses a machine approver, a missing reference, and a stale version', async () => {
    const { memory } = await harness()
    const proposal = await memory.createTeaching(OWNER, {
      scope: 'global', text: 'Revisar el flete.', source: 'capture:email', author: OWNER,
    })
    await expect(memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: 'agent:comercial', approvalRef: 'panel:teachings:1', proposalVersion: 1,
    })).rejects.toThrow('ACTIVATION_APPROVER_IS_MACHINE')
    await expect(memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: OWNER, approvalRef: '  ', proposalVersion: 1,
    })).rejects.toThrow('ACTIVATION_NO_APPROVAL_REF')
    await expect(memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: OWNER, approvalRef: 'panel:teachings:1', proposalVersion: 2,
    })).rejects.toThrow('ACTIVATION_VERSION_STALE')
    expect(await memory.retrieve(OWNER, {})).toEqual([])
    expect(await memory.listActivations(OWNER)).toEqual([])
  })

  it('invalidates the approval when the text changes', async () => {
    const { memory } = await harness()
    const proposal = await memory.createTeaching(OWNER, { scope: 'global', text: 'v1', source: 'capture:email', author: OWNER })
    await memory.activateTeaching(OWNER, proposal.id, { approvedBy: OWNER, approvalRef: 'panel:1', proposalVersion: 1 })
    const edited = await memory.editTeaching(OWNER, proposal.id, { text: 'v2', reason: 'cambio', author: OWNER })
    expect(edited.status).toBe('candidate')
    expect(await memory.retrieve(OWNER, {})).toEqual([])
    await expect(memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: OWNER, approvalRef: 'panel:2', proposalVersion: 1,
    })).rejects.toThrow('ACTIVATION_VERSION_STALE')
  })

  it('stops influencing after revocation, including behind a second service instance', async () => {
    const first = await harness()
    const proposal = await first.memory.createTeaching(OWNER, { scope: 'global', text: 'Una sola lección', source: 'capture:email', author: OWNER })
    await first.memory.activateTeaching(OWNER, proposal.id, { approvedBy: OWNER, approvalRef: 'panel:1', proposalVersion: 1 })
    expect(await first.memory.retrieve(OWNER, {})).toHaveLength(1)
    await first.memory.revokeTeaching(OWNER, proposal.id)
    expect(await first.memory.retrieve(OWNER, {})).toEqual([])

    // A later boot reads the durable status; nothing revives the teaching.
    await first.ctx.fiber.dispose()
    const second = await harness(first.backend)
    expect(await second.memory.retrieve(OWNER, {})).toEqual([])
    expect(await second.memory.getTeaching(proposal.id)).toMatchObject({ status: 'revoked' })
    await expect(second.memory.activateTeaching(OWNER, proposal.id, {
      approvedBy: OWNER, approvalRef: 'panel:2', proposalVersion: 1,
    })).rejects.toThrow('ACTIVATION_NOT_CANDIDATE')
  })

  it('keeps a failed capture visible and counted instead of only in a log', async () => {
    const { memory } = await harness()
    await memory.recordCaptureFailure(OWNER, { task: 'email-trash', source: 'email-trash', detail: 'storage unavailable' })
    const health = await memory.teachingHealth(OWNER)
    expect(health).toMatchObject({ candidates: 0, active: 0, revoked: 0, captureFailures: 1 })
    expect(health.lastCaptureFailure).toMatchObject({ task: 'email-trash', detail: 'storage unavailable' })
    expect(await memory.teachingHealth('otro')).toMatchObject({ captureFailures: 0, lastCaptureFailure: null })
  })
})
