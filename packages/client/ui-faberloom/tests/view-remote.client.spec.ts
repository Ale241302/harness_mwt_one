import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import faberloomViewRemote from '@deepseek-ai/dsh-faberloom-view/remote'
import { ensureViewRemote } from '../src/client/index.ts'

/** A context double carrying only the seats the mount guard reads. */
function contextOf(present: boolean, mount = vi.fn(async () => async () => {})) {
  const effect = vi.fn()
  const ctx = {
    get: vi.fn((name: string) => (present && name === 'remote.faberloomView' ? {} : undefined)),
    remote: { $mount: mount },
    effect,
  }
  return { ctx: ctx as unknown as Context, mount, effect }
}

describe('ensureViewRemote', () => {
  it('keeps the Host-mounted namespace and mounts nothing', async () => {
    const { ctx, mount, effect } = contextOf(true)
    await ensureViewRemote(ctx)
    expect(mount).not.toHaveBeenCalled()
    expect(effect).not.toHaveBeenCalled()
  })

  it('mounts the generated contribution when the Host assembly omits it', async () => {
    const dispose = vi.fn(async () => {})
    const { ctx, mount, effect } = contextOf(false, vi.fn(async () => dispose))
    await ensureViewRemote(ctx)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount).toHaveBeenCalledWith(faberloomViewRemote)
    expect(effect).toHaveBeenCalledTimes(1)
    // The registered effect yields the mount's own disposer as its cleanup.
    const [callback, label] = effect.mock.calls[0] as unknown as [() => unknown, string]
    expect(callback()).toBe(dispose)
    expect(label).toBe('ui-faberloom: view remote')
  })

  it('surfaces a mount failure to the boot graph instead of hiding it', async () => {
    const failure = new Error('client api: namespace conflict')
    const { ctx } = contextOf(false, vi.fn(async () => { throw failure }))
    await expect(ensureViewRemote(ctx)).rejects.toThrow(failure)
  })
})
