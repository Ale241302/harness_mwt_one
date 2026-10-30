import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { runAdoptSpaceWorkspace } from '../src/client/adopt-space-workspace.ts'

/** Boot the flow over stub Remotes and capture every call it makes. */
function harness(picked: unknown, adopted: unknown = { ok: true, value: { workspaceId: 'ws-1' } }) {
  const pick = vi.fn(async () => picked)
  const adoptSpaceWorkspace = vi.fn(async () => adopted)
  const directoryPicker = { pick } as unknown as ClientRemote['directoryPicker']
  const view = { adoptSpaceWorkspace } as unknown as ClientRemote['faberloomView']
  const refresh = vi.fn()
  return { pick, adoptSpaceWorkspace, refresh, directoryPicker, view }
}

describe('adopt space workspace flow', () => {
  it('adopts the picked folder and reloads the overview', async () => {
    const bench = harness({ ok: true, value: 'C:/Clientes/ACME' })

    await runAdoptSpaceWorkspace(bench.directoryPicker, bench.view, bench.refresh, 'sp1')

    expect(bench.adoptSpaceWorkspace).toHaveBeenCalledWith('sp1', 'C:/Clientes/ACME')
    expect(bench.refresh).toHaveBeenCalledOnce()
  })

  it('does nothing when the pick is cancelled', async () => {
    const bench = harness({ ok: true, value: null })

    await runAdoptSpaceWorkspace(bench.directoryPicker, bench.view, bench.refresh, 'sp1')

    expect(bench.adoptSpaceWorkspace).not.toHaveBeenCalled()
    expect(bench.refresh).not.toHaveBeenCalled()
  })

  it('does nothing when the picker fails', async () => {
    const bench = harness({ ok: false, error: { message: 'no picker' } })

    await runAdoptSpaceWorkspace(bench.directoryPicker, bench.view, bench.refresh, 'sp1')

    expect(bench.adoptSpaceWorkspace).not.toHaveBeenCalled()
    expect(bench.refresh).not.toHaveBeenCalled()
  })

  it('keeps the current workspace when the adoption is refused', async () => {
    const bench = harness({ ok: true, value: 'C:/Clientes/ACME' }, { ok: false, error: { message: 'registry absent' } })

    await runAdoptSpaceWorkspace(bench.directoryPicker, bench.view, bench.refresh, 'sp1')

    expect(bench.adoptSpaceWorkspace).toHaveBeenCalledOnce()
    expect(bench.refresh).not.toHaveBeenCalled()
  })
})
