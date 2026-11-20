import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** Boot the view with only the expediente-write service. */
function harness(mwt: unknown): FaberLoomViewService {
  const ctx = {
    effect: (run: () => unknown) => { run(); return () => {} },
    on: () => () => {},
    reflect: { provide: () => {} },
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomMwt' ? mwt : undefined,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
}

describe('FaberLoomViewService MWT writes', () => {
  it('prepares a proposal for the authenticated owner without writing it', async () => {
    const prepare = vi.fn(async () => ({ id: 'proposal-1', status: 'proposed' }))
    const view = harness({ prepare })
    const input = {
      target: { expedienteId: 'd1dd7c99-5f4e-4489-b235-16df8fdaacea', label: 'PF 2521-2026', collection: 'expedientes' },
      fields: [{ field: 'modo_operacion', label: 'Modo de operación', value: 'COMISION' }],
      reason: 'PC5-M controlled no-op write',
      sources: ['mwt:expediente_obtener'],
    }

    await expect(view.mwtPrepareWrite(input)).resolves.toEqual({ id: 'proposal-1', status: 'proposed' })
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner@muitowork.com', role: 'admin', kind: 'human' }), input)
  })

  it('refuses preparation when the write service is not mounted', async () => {
    const view = harness(undefined)
    await expect(view.mwtPrepareWrite({
      target: { expedienteId: 'x', label: 'x', collection: 'expedientes' },
      fields: [], reason: 'x', sources: [],
    })).rejects.toThrow(/servicio de escritura MWT no está montado/u)
  })
})
