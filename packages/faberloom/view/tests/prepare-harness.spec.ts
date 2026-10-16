import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/**
 * The minimal service graph `prepareHarness` touches: the projection row is an
 * optional service, so the method either reaches it or answers null.
 * @param projection - the mounted projection, or undefined when the deployment has none.
 * @returns the view service over that graph.
 */
function harness(projection: unknown): FaberLoomViewService {
  const ctx = {
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomHarnessProjection' ? projection : undefined,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
}

describe('prepareHarness', () => {
  it('projects a space through its own folder', async () => {
    const report = {
      version: 1,
      scope: { kind: 'space', id: 'sp1', title: 'ACME' },
      root: '/work/acme',
      generatedAt: '2026-10-16T00:00:00.000Z',
      written: ['AGENTS.md'],
      pruned: [],
      usage: {},
    }
    const refresh = vi.fn(async () => report)
    const view = harness({ refresh })

    expect(await view.prepareHarness('space', 'sp1', 'ACME')).toEqual(report)
    expect(refresh).toHaveBeenCalledWith({ kind: 'space', id: 'sp1', title: 'ACME' })
  })

  it('projects a workspace scope, and reports a scope with no folder as nothing written', async () => {
    const refresh = vi.fn(async () => undefined)
    const view = harness({ refresh })

    expect(await view.prepareHarness('workspace', 'ws-1', 'Marluvas')).toBeNull()
    expect(refresh).toHaveBeenCalledWith({ kind: 'workspace', id: 'ws-1', title: 'Marluvas' })
  })

  it('answers nothing when the deployment does not mount the projection', async () => {
    const view = harness(undefined)

    expect(await view.prepareHarness('space', 'sp1', 'ACME')).toBeNull()
  })
})
