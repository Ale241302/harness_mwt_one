/**
 * Wave 2.3 local task: a proposal, a context entry, and a Space memory are
 * created without a provider or MWT, then read back from a fresh composition
 * over the same in-memory medium (a simulated restart, not disk durability).
 * The model session is not the reader.
 */

import { describe, expect, it } from 'vitest'
import { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FalkContext from '../../context/src/index.ts'
import {
  ACTOR_A,
  COMPANY_A,
  OWNER_A,
  bootBoard,
} from './helpers/harness.ts'

const SPACE_ACTOR = { id: OWNER_A, role: 'client_b2b', companyId: COMPANY_A, readOnly: false }

/** One valid local knowledge proposal. */
function proposal(): Record<string, unknown> {
  return {
    archivo: 'knowledge/procedimiento.md',
    versionBase: 'rev-7',
    cambio: 'Añadir la verificación previa.',
    motivo: 'La revisión detectó un hueco.',
    evidencia: ['oc:505288'],
    claveCliente: 'tarea-local-1',
    title: 'Tarea local sintética',
  }
}

describe('local task without a provider or MWT (BASE-04)', () => {
  it('keeps the proposal, context, and memory when the composition is reopened over the same medium', async () => {
    const pool = new MemoryMediaPool()
    const first = await bootBoard({ pool })
    const space = await first.spaces.create(SPACE_ACTOR, { title: 'Trabajo local' })
    await first.spaces.remember(SPACE_ACTOR, 'Memoria local de la tarea', [space.id])
    await first.ctx.plugin(FalkContext)
    await first.ctx.faberloomContext.create(
      { id: OWNER_A },
      { title: 'Contexto local', body: 'Cuerpo del contexto' },
    )
    const receipt = await first.board.submitProposal(ACTOR_A, proposal())
    const current = await first.board.get(ACTOR_A, receipt.id)
    await first.board.approve(ACTOR_A, receipt.id, {
      expectedRowVersion: current.rowVersion,
      expectedArtifactVersion: current.version,
      expectedArtifactHash: current.artifactHash ?? '',
    })
    await first.ctx.fiber.dispose()

    const second = await bootBoard({ pool })
    await second.ctx.plugin(FalkContext)
    const item = await second.board.get(ACTOR_A, receipt.id)
    expect(item.state).toBe('APROBADO')
    expect(item.title).toBe('Tarea local sintética')
    expect((await second.spaces.listMemory(SPACE_ACTOR, space.id)).map(entry => entry.text))
      .toContain('Memoria local de la tarea')
    expect((await second.ctx.faberloomContext.list({ id: OWNER_A })).map(entry => entry.title))
      .toContain('Contexto local')
  })
})
