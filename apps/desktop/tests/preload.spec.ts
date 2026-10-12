import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC, type DshDesktopApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

afterEach(() => { vi.clearAllMocks(); vi.resetModules() })

it('exposes the appearance face on the management bridge', async () => {
  await import('../src/preload.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as DshDesktopApi
  await api.appearance.get()
  await api.appearance.set('light')
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.appearanceGet], [DESKTOP_IPC.appearanceSet, 'light'],
  ])
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('dshDesktop', api)
})
