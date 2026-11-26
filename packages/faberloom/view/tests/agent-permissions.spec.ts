import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** The service graph the permission writes touch. */
function harness(options: { readonly level?: string } = {}) {
  const space = { id: 'sp-1', ownerId: 'owner@muitowork.com', title: 'Marluvas', agentId: 'agent-1' }
  const routines = [
    { id: 'routine-1', spaceId: 'sp-1', status: 'active' },
    { id: 'routine-2', spaceId: 'sp-1', status: 'active' },
    { id: 'routine-3', spaceId: 'sp-2', status: 'active' },
  ]
  const spaces = {
    get: vi.fn(async () => space),
    list: vi.fn(async () => [space]),
    agentPermission: vi.fn(async () => options.level ?? 'propone'),
    setAgentPermission: vi.fn(async () => space),
  }
  const routineService = {
    getRoutine: vi.fn(async () => routines[0]),
    listRoutines: vi.fn(async () => routines),
    pauseRoutine: vi.fn(async () => routines[0]),
    activateRoutine: vi.fn(async () => routines[0]),
  }
  const ctx = {
    faberloomSpaces: spaces,
    faberloomRoutines: routineService,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: () => undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false,
  })
  return { view, spaces, routines: routineService }
}

describe('agent permissions in the Space tablero', () => {
  it('pauses only the active routines of the Space when it returns to propone', async () => {
    const { view, routines } = harness()
    const result = await view.setAgentPermission('sp-1', 'agent-1', 'propone')
    expect(result).toEqual({ pausedRoutines: 2, level: 'propone' })
    expect(routines.pauseRoutine).toHaveBeenCalledTimes(2)
    expect(routines.pauseRoutine).toHaveBeenCalledWith('owner@muitowork.com', 'routine-1')
    expect(routines.pauseRoutine).not.toHaveBeenCalledWith('owner@muitowork.com', 'routine-3')
  })

  it('never offers automatic while the results are unmeasured', async () => {
    const { view, spaces, routines } = harness()
    await expect(view.setAgentPermission('sp-1', 'agent-1', 'automatico'))
      .rejects.toThrow('automatic permission stays blocked')
    expect(spaces.setAgentPermission).not.toHaveBeenCalled()
    expect(routines.pauseRoutine).not.toHaveBeenCalled()
  })

  it('refuses to activate a routine while its agent only proposes', async () => {
    const { view, routines } = harness({ level: 'propone' })
    await expect(view.setRoutineActive('routine-1', true))
      .rejects.toThrow('Propone')
    expect(routines.activateRoutine).not.toHaveBeenCalled()
  })
})
