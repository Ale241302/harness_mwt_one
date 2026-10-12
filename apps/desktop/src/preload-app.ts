/** Startup controls for shell documents; application documents receive only the carrier marker. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  appearance: {
    get: () => ipcRenderer.invoke(DESKTOP_IPC.appearanceGet) as ReturnType<DshDesktopStartupApi['appearance']['get']>,
    set: value => ipcRenderer.invoke(DESKTOP_IPC.appearanceSet, value) as Promise<void>,
  },
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  identity: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.identityStatus) as ReturnType<DshDesktopStartupApi['identity']['status']>,
    login: (usuario, password) => ipcRenderer.invoke(DESKTOP_IPC.identityLogin, usuario, password) as ReturnType<DshDesktopStartupApi['identity']['login']>,
    signOut: () => ipcRenderer.invoke(DESKTOP_IPC.identitySignOut) as ReturnType<DshDesktopStartupApi['identity']['signOut']>,
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

contextBridge.exposeInMainWorld('dshDesktop', location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup : { protocolVersion: 1 })
