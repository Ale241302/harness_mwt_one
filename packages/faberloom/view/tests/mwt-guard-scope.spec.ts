/**
 * Who may run the MWT.ONE operator guard. The guard reviews the whole book, so
 * an external tenant that receives the MWT tools must never hold it: it loses
 * the routine and the work the routine filed on its Mesa.
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaberLoomViewService } from '../src/index.ts'

/** One board row as the retirement path reads it. */
function boardRow(overrides: Record<string, unknown>) {
  return {
    id: 'item-1',
    routineId: 'guard-1',
    column: 'TU_CRITERIO',
    severity: 'LOW',
    rowVersion: 3,
    ...overrides,
  }
}

/** The minimal service graph the connection write and the guard provisioning touch. */
function harness(
  services: { routines: unknown; connections?: unknown; board?: unknown; tools?: unknown },
  config: Record<string, unknown> = { ownerId: 'owner@muitowork.com' },
  logger: { warn: (message: string) => void; info: (message: string) => void } = { warn: vi.fn(), info: vi.fn() },
): FaberLoomViewService {
  const resolved = {
    faberloomConnections: services.connections ?? { list: vi.fn(async () => []), save: vi.fn(async () => ({})) },
    faberloomRoutines: services.routines,
    faberloomBoard: services.board,
    tools: services.tools,
  }
  const ctx = {
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger,
    get: (name: string) => (resolved as Record<string, unknown>)[name],
    ...resolved,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { role: 'admin', readOnly: false, ...config })
}

describe('FaberLoomViewService MWT.ONE guard scope', () => {
  it('provisions the guard for an operator declared by email', async () => {
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(async (_owner: string, input: { name: string }) => ({ id: 'g1', name: input.name, status: 'draft' })),
      activateRoutine: vi.fn(async () => ({})),
    }
    const view = harness(
      { routines, tools: { schemas: () => [{ name: 'mcp__mwt__expediente_listar' }] } },
      { ownerId: 'Alvaro@Externa.example', mwtOperatorEmails: ['  alvaro@externa.example '] },
    )

    await view.saveConnection({} as never)

    expect(routines.createRoutine).toHaveBeenCalledWith('Alvaro@Externa.example', expect.objectContaining({ name: 'Vigía MWT.ONE' }))
    expect(routines.activateRoutine).toHaveBeenCalledWith('Alvaro@Externa.example', 'g1')
  })

  it('retires the guard and closes what it filed for an external tenant', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'active' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const settled = boardRow({ id: 'sin-severidad', severity: 'LOW', rowVersion: 9 })
    const board = {
      list: vi.fn(async () => [
        boardRow({ id: 'sin-severidad', severity: null }),
        boardRow({ id: 'con-severidad', rowVersion: 4 }),
        boardRow({ id: 'cerrado', column: 'CERRADO' }),
        boardRow({ id: 'de-otra-rutina', routineId: 'correo-1' }),
      ]),
      setSeverity: vi.fn(async () => settled),
      discard: vi.fn(async () => ({})),
    }
    const view = harness(
      { routines, board, tools: { schemas: () => [{ name: 'mcp__mwt__expediente_listar' }] } },
      { ownerId: 'joao.neves@marluvas.com.br' },
    )

    await view.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
    expect(routines.pauseRoutine).toHaveBeenCalledWith('joao.neves@marluvas.com.br', 'guard-1')
    expect(board.setSeverity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'joao.neves@marluvas.com.br' }),
      'sin-severidad',
      'LOW',
      'RULE',
    )
    expect(board.discard).toHaveBeenCalledTimes(2)
    expect(board.discard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'joao.neves@marluvas.com.br' }),
      'sin-severidad',
      { reason: 'ERROR_ORIGEN', expectedRowVersion: 9 },
    )
    expect(board.discard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'joao.neves@marluvas.com.br' }),
      'con-severidad',
      { reason: 'ERROR_ORIGEN', expectedRowVersion: 4 },
    )
  })

  it('leaves a paused guard alone and closes nothing a person decided', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'paused' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const board = { list: vi.fn(async () => []), setSeverity: vi.fn(), discard: vi.fn() }
    const view = harness({ routines, board }, { ownerId: 'joao.neves@marluvas.com.br' })

    await view.saveConnection({} as never)

    expect(routines.pauseRoutine).not.toHaveBeenCalled()
    expect(board.list).toHaveBeenCalledOnce()
    expect(board.discard).not.toHaveBeenCalled()
  })

  it('does nothing when the owner never held the guard', async () => {
    const routines = { listRoutines: vi.fn(async () => []), createRoutine: vi.fn(), pauseRoutine: vi.fn() }
    const board = { list: vi.fn(), setSeverity: vi.fn(), discard: vi.fn() }
    const view = harness(
      { routines, board, tools: { schemas: () => [{ name: 'mcp__mwt__whoami' }] } },
      { ownerId: 'sin-arroba' },
    )

    await view.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
    expect(board.list).not.toHaveBeenCalled()
  })

  it('retires the guard even when the deployment mounts no MWT tools', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'active' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const board = { list: vi.fn(async () => []), setSeverity: vi.fn(), discard: vi.fn() }
    const view = harness({ routines, board }, { ownerId: 'joao.neves@marluvas.com.br' })

    await view.saveConnection({} as never)

    expect(routines.pauseRoutine).toHaveBeenCalledWith('joao.neves@marluvas.com.br', 'guard-1')
    expect(routines.createRoutine).not.toHaveBeenCalled()
  })

  it('keeps closing the rest when the board refuses a row', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'active' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const board = {
      list: vi.fn(async () => [boardRow({ id: 'terca' }), boardRow({ id: 'falla-error' }), boardRow({ id: 'falla-texto' })]),
      setSeverity: vi.fn(),
      discard: vi.fn(async (_actor: unknown, id: string) => {
        if (id === 'falla-error') throw new Error('faberloom: NO_ACCESS — the item result is unknown and cannot be discarded')
        if (id === 'falla-texto') throw 'board down'
        return {}
      }),
    }
    const logger = { warn: vi.fn(), info: vi.fn() }
    const view = harness({ routines, board }, { ownerId: 'joao.neves@marluvas.com.br' }, logger)

    await view.saveConnection({} as never)

    expect(board.discard).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('NO_ACCESS'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('board down'))
  })

  it('treats an unnamed or anonymous identity as no operator', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'active' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const board = { list: vi.fn(async () => []), setSeverity: vi.fn(), discard: vi.fn() }
    const anonymous = harness({ routines, board, tools: { schemas: () => [{ name: 'mcp__mwt__whoami' }] } }, { ownerId: '' })
    const blank = harness({ routines, board }, { ownerId: '   ' })

    await anonymous.saveConnection({} as never)
    await blank.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
  })

  it('honours an operator list that disables the domain default', async () => {
    const routines = {
      listRoutines: vi.fn(async () => []),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const view = harness(
      { routines, tools: { schemas: () => [{ name: 'mcp__mwt__whoami' }] } },
      { ownerId: 'owner@muitowork.com', mwtOperatorDomains: [] },
    )

    await view.saveConnection({} as never)

    expect(routines.createRoutine).not.toHaveBeenCalled()
  })

  it('pauses the guard when the deployment mounts no board', async () => {
    const routines = {
      listRoutines: vi.fn(async () => [{ id: 'guard-1', name: 'Vigía MWT.ONE', status: 'active' }]),
      createRoutine: vi.fn(),
      pauseRoutine: vi.fn(async () => ({})),
    }
    const view = harness({ routines }, { ownerId: 'joao.neves@marluvas.com.br' })

    await view.saveConnection({} as never)

    expect(routines.pauseRoutine).toHaveBeenCalledWith('joao.neves@marluvas.com.br', 'guard-1')
  })
})
