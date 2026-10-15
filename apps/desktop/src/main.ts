/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveBackend, type DesktopBackend } from './launch-backend.ts'
import { DEFAULT_GATEWAY_URL } from './gateway.ts'
import { resolveDesktopPaths } from './paths.ts'
import { ensureHomeEnvFile, readHomeEnv, resolveHomeEnvDefaults } from './home-env.ts'
import { readAppearance, writeAppearance } from './appearance.ts'
import {
  DEFAULT_CONSOLA_API_BASE,
  IDENTITY_PATCH_FILENAME,
  readIdentity,
  refreshIdentityPatch,
  requestPasswordReset,
  signInToConsole,
  signOut,
  writeIdentity,
  type DesktopCatalogs,
} from './identity.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.ts'
import { DESKTOP_IPC, type DesktopIdentityStatus, type DesktopSignInResult, type DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, desktopLocaleOf, isDesktopLocaleId, resolveDesktopLocale, type DesktopLocale } from './locale.ts'
import { readLocaleChoice, writeLocaleChoice } from './locale-choice.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { desktopErrorState } from './startup-error.ts'
import { startupFailureDocument } from './startup-document.ts'

const SCHEME = 'dsh-app'
/** Persistent session partition holding the gateway's sign-in cookies in remote mode. */
const GATEWAY_PARTITION = 'persist:gateway'
/** Gateway origin allowed to navigate the window in remote mode; absent in the local harness. */
let gatewayOrigin: string | undefined
let focusPrimaryWindow = (): void => {}
type RecoveryAction = 'restart' | 'plugins' | 'reset'
let profileRecoveryAvailable = (): boolean => false
const emergencyPages = new WeakMap<BrowserWindow, { url: string; message: string; busy: boolean }>()
let recoverApplication = (action: RecoveryAction): Promise<void> => {
  if (action !== 'restart') return Promise.reject(new Error('Desktop recovery could not initialize; reinstall the application'))
  app.relaunch()
  app.quit()
  return Promise.resolve()
}

async function showEmergencyDocument(window: BrowserWindow, message: string): Promise<void> {
  const document = startupFailureDocument(resolveDesktopLocale(app.getLocale()), message, profileRecoveryAvailable())
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
  emergencyPages.set(window, { url, message, busy: false })
  await window.loadURL(url)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly dsh: string
  readonly profileResolution?: 'runtime'
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = development
    ? process.env.DSH_DESKTOP_NODE_BINARY
      ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    : process.execPath
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const dsh = (development ? process.env.DSH_DESKTOP_DSH_DIR : undefined)
    ?? (development ? join(process.resourcesPath, 'dsh') : join(app.getAppPath(), 'dsh'))
  return { node, pnpm, dsh, ...(development ? {} : { profileResolution: 'runtime' }) }
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

function createWindow(preload: string, show = false, partition?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show,
    webPreferences: {
      preload,
      ...(partition === undefined ? {} : { partition }),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  // Links the gateway UI opens land in the user's browser; the window keeps the
  // single application document.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/u.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url)
    if (gatewayOrigin !== undefined && target.origin === gatewayOrigin) return
    if (target.protocol !== `${SCHEME}:`) event.preventDefault()
    const page = emergencyPages.get(window)
    if (page === undefined || page.busy || window.webContents.getURL() !== page.url) return
    const action = new URL(url)
    if (action.protocol !== 'dsh-recovery:' || !['restart', 'plugins', 'reset'].includes(action.hostname)) return
    if (action.hostname !== 'restart' && !profileRecoveryAvailable()) return
    page.busy = true
    void recoverApplication(action.hostname as RecoveryAction).catch(async (error: unknown) => {
      if (!window.isDestroyed()) await showEmergencyDocument(window, `${page.message}\n${desktopErrorState(error).message}`)
    }).catch((error: unknown) => { console.error(error) }).finally(() => { page.busy = false })
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const target = resolve(normalize(join(root, pathname)))
  if (target !== root && !target.startsWith(root + sep)) return new Response(null, { status: 403 })
  try {
    const body = request.method === 'HEAD' ? null : await readFile(target)
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function main(): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const home = resolveDshHome()
  // Complete the Harness-home `.env` layer before the Host boots from it, using
  // the deployment defaults injected at packaging time, so a fresh installation
  // already reaches the official DeepSeek route.
  ensureHomeEnvFile(home, resolveHomeEnvDefaults(process.env, process.resourcesPath))
  const identityPatchPath = join(home, IDENTITY_PATCH_FILENAME)
  const consolaBase = process.env.DSH_DESKTOP_CONSOLA_API_BASE ?? DEFAULT_CONSOLA_API_BASE
  // The catalogs this installation ships, mounted read-only by the local harness
  // exactly as the deployment mounts its copies. A development run points at
  // resources it does not have, which mounts nothing, the same as before.
  const desktopCatalogs: DesktopCatalogs = {
    skillsCatalogRoot: join(process.resourcesPath, 'catalogs', 'skills-catalog'),
    skillsSharedRoot: join(process.resourcesPath, 'catalogs', 'skills-shared'),
    agentsSharedRoot: join(process.resourcesPath, 'catalogs', 'agents-shared'),
  }
  const identityStatus = (): DesktopIdentityStatus => {
    const identity = readIdentity(home)
    if (identity === undefined) return { signedIn: false, consolaBase }
    return {
      signedIn: true,
      consolaBase: identity.consolaBase,
      email: identity.email,
      role: identity.role,
      ...(identity.fullName === undefined ? {} : { fullName: identity.fullName }),
    }
  }
  const development = app.isPackaged ? undefined : join(app.getAppPath(), '.desktop-build', 'development', 'project')
  // Only the launching environment can point an installation at a gateway, so a
  // deployment or a development run that configured one keeps it and the operator
  // has no switch. Otherwise the local harness runs, which reads the files of the
  // computer it runs on.
  const launch: DesktopBackend = resolveBackend(process.env)
  gatewayOrigin = launch.mode === 'gateway' ? new URL(launch.url).origin : undefined
  const activeProject = development ?? paths.profile
  const manager = new DesktopProjectManager(paths, resources)
  profileRecoveryAvailable = () => development === undefined && manager.canRecoverProfile()
  let pageError: Extract<DesktopBackendState, { phase: 'error' }> | undefined
  let quitting = false
  let startup: Promise<void> | undefined
  let mainWindow: BrowserWindow | undefined
  let pluginWindow: BrowserWindow | undefined
  let shellInstallerOwnsQuit = false
  let updateState: DesktopUpdateState = { phase: 'idle' }
  // The shell's own screens follow the language the operator picked, then the OS.
  let locale: DesktopLocale = resolveDesktopLocale(readLocaleChoice(home) ?? app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const startupUrl = `${SCHEME}://shell/startup.html`
  const applicationUrl = `${SCHEME}://app/index.html`
  let navigation: { window: BrowserWindow; url: string; promise: Promise<void> } | undefined
  let emergencyDocument = false

  const showEmergencyError = async (error: unknown): Promise<void> => {
    if (quitting || emergencyDocument) return
    emergencyDocument = true
    const diagnostic = desktopErrorState(error).message
    pageError = { phase: 'error', message: diagnostic }
    if (mainWindow !== undefined) await showEmergencyDocument(mainWindow, diagnostic)
  }

  const navigateMain = (url: string): Promise<void> => {
    const window = mainWindow
    if (quitting || emergencyDocument || window === undefined || window.isDestroyed()) return Promise.resolve()
    if (navigation?.window === window && navigation.url === url) return navigation.promise
    const next = { window, url, promise: Promise.resolve() }
    next.promise = window.loadURL(url).catch((error: unknown) => {
      if (quitting || window.isDestroyed() || navigation !== next) return
      navigation = undefined
      throw error
    })
    navigation = next
    return next.promise
  }
  const backendState = (): DesktopBackendState => {
    const state = pageError ?? backend.state
    return state.phase === 'error' ? { ...state, profileRecovery: profileRecoveryAvailable() } : state
  }
  const publishBackend = (state: DesktopBackendState): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.backendState, state)
    }
  }
  const backend = new DesktopBackendController((onFailure) => {
    if (development === undefined) manager.assertProfileRuntime(activeProject)
    const hostInspectPort = developmentHostInspectPort(development !== undefined)
    // The Harness-home `.env` layer boots the child as real environment names, with
    // the launching process environment outranking it, exactly as the gateway
    // injects its own values; rows whose `!!js process.env.*` reads gate on a name
    // (the product MCP keys, the mirror credential) then resolve on a desktop too.
    const host = new DesktopHostProcess(resources.node, development ?? resources.dsh, activeProject,
      hostInspectPort, { ...readHomeEnv(home), ...process.env, DSH_HOME: home, DSH_IDENTITY_PATCH: identityPatchPath }, onFailure)
    return {
      start: () => host.start(),
      stop: () => host.stop(),
      fetch: (request: Request) => host.fetch(request),
    }
  }, (state) => {
    if (state.phase === 'starting' && !emergencyDocument) pageError = undefined
    publishBackend(backendState())
    if (state.phase === 'error') void navigateMain(startupUrl).catch((error: unknown) => { console.error(error) })
  })

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
    }
    return state
  }

  const hooks: DesktopProjectHooks = {
    beforeChange: () => backend.stop(),
    afterChange: () => backend.start(async () => {}),
  }

  recoverApplication = async (action): Promise<void> => {
    await startup?.catch(() => undefined)
    await backend.stop()
    if (action === 'restart') {
      app.relaunch()
      app.quit()
      return
    }
    if (!profileRecoveryAvailable()) throw new Error(messages.startupReinstallAdvice)
    if (action === 'reset') await manager.resetConfiguration(hooks)
    else await manager.mutate({ type: 'plugins-disable-all' }, hooks)
    emergencyDocument = false
    pageError = undefined
    navigation = undefined
    await navigateMain(applicationUrl)
  }

  const showStartupError = async (error: unknown): Promise<void> => {
    if (quitting) return
    pageError = desktopErrorState(error)
    try { await navigateMain(startupUrl) }
    catch (navigationError) {
      await showEmergencyError(new AggregateError([error, navigationError], messages.startupFailed))
    }
    publishBackend(backendState())
  }
  const reconcileBackend = (): Promise<void> => {
    startup ??= (async () => {
      pageError = undefined
      await navigateMain(startupUrl)
      if (readIdentity(home) === undefined) {
        // Signed out: the shell renders the sign-in form instead of starting a
        // Host that would seed nothing without an owner.
        publishBackend(backendState())
        return
      }
      // An installation that now ships product catalogs mounts them on this
      // launch, so a new release does not wait for the operator to sign in again.
      refreshIdentityPatch(home, { ...readHomeEnv(home), ...process.env }, desktopCatalogs)
      await backend.start(async () => {
        if (development === undefined) {
          await manager.applyRelease()
        }
      })
      if (backend.host !== undefined) await navigateMain(applicationUrl)
    })().catch(async (error: unknown) => {
      await showStartupError(error)
      throw error
    }).finally(() => { startup = undefined })
    return startup
  }

  const signOutGateway = async (): Promise<void> => {
    await session.fromPartition(GATEWAY_PARTITION).clearStorageData()
    if (launch.mode === 'gateway') {
      navigation = undefined
      await navigateMain(launch.url)
    }
  }

  const signOutIdentity = async (): Promise<DesktopIdentityStatus> => {
    if (readIdentity(home) === undefined) return identityStatus()
    await startup?.catch(() => undefined)
    await backend.stop()
    signOut(home)
    pageError = undefined
    navigation = undefined
    await navigateMain(startupUrl)
    publishBackend(backendState())
    return identityStatus()
  }

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      shellInstallerOwnsQuit = true
      await backend.stop()
    },
  )

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request).then((response) => {
      if (response.status >= 400 && ['/startup.html', '/startup.js', '/startup.css'].includes(url.pathname)) {
        void showEmergencyError(new Error(`Desktop recovery resource could not be loaded: ${url.pathname} (HTTP ${response.status})`))
          .catch((error: unknown) => { console.error(error) })
      }
      return response
    })
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = backend.host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    await startup?.catch(() => undefined)
    pageError = undefined
    await navigateMain(startupUrl)
    try {
      await manager.mutate(mutation, hooks)
      await navigateMain(applicationUrl)
    } catch (error) {
      await showStartupError(error)
      throw error
    }
  }
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => {
    assertDesktopSender(event, ['shell'])
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.localeSet, (event, value: unknown): DesktopLocale => {
    assertDesktopSender(event, ['shell'])
    if (!isDesktopLocaleId(value)) throw new Error('dsh desktop: locale must be a shipped locale id')
    writeLocaleChoice(home, value)
    locale = desktopLocaleOf(value)
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.appearanceGet, (event): 'light' | 'dark' => {
    assertDesktopSender(event, ['shell'])
    // No stored choice follows the OS, so a fresh install matches the rest of the
    // desktop until the user picks an appearance.
    return readAppearance(home) ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })
  ipcMain.handle(DESKTOP_IPC.appearanceSet, (event, value: unknown) => {
    assertDesktopSender(event, ['shell'])
    if (value !== 'light' && value !== 'dark') throw new Error('dsh desktop: appearance must be light or dark')
    writeAppearance(home, value)
  })
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) return []
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsToggle, (event, name: unknown, enabled: unknown) => {
    if (typeof name !== 'string' || typeof enabled !== 'boolean') throw new Error('dsh desktop: invalid plugin activation request')
    return mutate(event, { type: 'plugin-toggle', name, enabled })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsDisableAll, event => mutate(event, { type: 'plugins-disable-all' }))
  ipcMain.handle(DESKTOP_IPC.backendStatus, (event) => {
    assertDesktopSender(event, ['shell'])
    return backendState()
  })
  ipcMain.handle(DESKTOP_IPC.backendRetry, async (event) => {
    assertDesktopSender(event, ['shell'])
    await reconcileBackend()
    focusPrimaryWindow()
  })
  ipcMain.handle(DESKTOP_IPC.identityStatus, (event): DesktopIdentityStatus => {
    assertDesktopSender(event, ['shell'])
    return identityStatus()
  })
  ipcMain.handle(DESKTOP_IPC.identityLogin, async (event, usuario: unknown, password: unknown): Promise<DesktopSignInResult> => {
    assertDesktopSender(event, ['shell'])
    if (typeof usuario !== 'string' || usuario.trim() === '' || typeof password !== 'string' || password === '') {
      return { ok: false, message: messages.signInFailed }
    }
    try {
      const base = readIdentity(home)?.consolaBase ?? consolaBase
      const { identity, credentials } = await signInToConsole(base, usuario.trim(), password)
      // The child boots from the Harness-home `.env` layer under the launching
      // environment, so which product MCP servers mount is decided from both.
      writeIdentity(home, identity, credentials, { ...readHomeEnv(home), ...process.env }, desktopCatalogs)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    await reconcileBackend()
    return { ok: true }
  })
  ipcMain.handle(DESKTOP_IPC.identitySignOut, async (event): Promise<DesktopIdentityStatus> => {
    assertDesktopSender(event, ['shell'])
    return await signOutIdentity()
  })
  ipcMain.handle(DESKTOP_IPC.identityPasswordReset, async (event, email: unknown): Promise<DesktopSignInResult> => {
    assertDesktopSender(event, ['shell'])
    if (typeof email !== 'string' || email.trim() === '') return { ok: false, message: messages.passwordRecoveryMissing }
    try {
      await requestPasswordReset(readIdentity(home)?.consolaBase ?? consolaBase, email.trim())
      return { ok: true }
    } catch (error) {
      console.error(error)
      return { ok: false, message: messages.passwordRecoveryFailed }
    }
  })
  ipcMain.handle(DESKTOP_IPC.applicationRestart, async (event) => {
    assertDesktopSender(event, ['shell'])
    try {
      await recoverApplication('restart')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.configurationReset, async (event) => {
    assertDesktopSender(event, ['shell'])
    if (development !== undefined) throw new Error('Desktop configuration reset requires a packaged application')
    const failure = backendState()
    if (failure.phase !== 'error') {
      throw new Error('Desktop profile reset requires a startup failure')
    }
    await startup?.catch(() => undefined)
    try {
      await recoverApplication('reset')
    } catch (error) {
      await showStartupError(error)
    }
  })
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    await updates.install()
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    const state = await updates.check()
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  const openPluginWindow = (): void => {
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) {
      pluginWindow.focus()
      return
    }
    pluginWindow = createWindow(managementPreload)
    pluginWindow.setSize(900, 620)
    pluginWindow.setTitle(messages.pluginWindowTitle)
    pluginWindow.once('ready-to-show', () => { pluginWindow?.show() })
    pluginWindow.once('closed', () => { pluginWindow = undefined })
    void pluginWindow.loadURL(`${SCHEME}://shell/plugin-manager.html`)
  }

  /**
   * Open the shared web application in the browser. The deployment owns the
   * Spaces, sessions, and product modules it serves, so the Desktop reaches them
   * there instead of switching what its own window shows.
   */
  const openWebApplication = (): void => {
    const origin = launch.mode === 'gateway' ? new URL(launch.url).origin : new URL(DEFAULT_GATEWAY_URL).origin
    void shell.openExternal(origin)
  }

  const buildApplicationMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: process.platform === 'darwin' ? app.name : messages.application,
      submenu: [
        { label: messages.openWebMenu, click: openWebApplication },
        { type: 'separator' },
        {
          label: development === undefined ? messages.pluginsMenu : messages.pluginsMenuPackagedOnly,
          accelerator: 'CmdOrCtrl+,',
          enabled: development === undefined,
          click: openPluginWindow,
        },
        {
          label: messages.signOutMenu,
          click: () => {
            const action = launch.mode === 'local' ? signOutIdentity() : signOutGateway()
            void action.catch((error: unknown) => { console.error(error) })
          },
        },
        { label: messages.checkUpdatesMenu, click: () => { void checkAndPrompt(true) } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }]))
  }
  buildApplicationMenu()

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload, true, launch.mode === 'gateway' ? GATEWAY_PARTITION : undefined)
    mainWindow = window
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    window.webContents.on('preload-error', (_event, _path, error) => {
      void showEmergencyError(error).catch((failure: unknown) => { console.error(failure) })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      navigation = undefined
      emergencyDocument = false
      void showStartupError(new Error(`Desktop renderer exited: ${details.reason}`))
        .catch((failure: unknown) => { console.error(failure) })
    })
    return window
  }
  focusPrimaryWindow = () => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      createMainWindow()
      void navigateMain(backendState().phase === 'ready' ? applicationUrl : startupUrl)
        .catch((error: unknown) => { console.error(error) })
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit || quitting) return
    event.preventDefault()
    quitting = true
    void backend.close().catch((error: unknown) => { console.error(error) }).finally(() => { app.quit() })
  })

  mainWindow = createMainWindow()
  if (launch.mode === 'local') {
    await reconcileBackend().catch(() => undefined)
  } else {
    // Remote mode: the window is a client of the shared gateway, so it carries
    // the signed-in user's Spaces, sessions, and every product module.
    await navigateMain(launch.url).catch(async (error: unknown) => { await showEmergencyError(error) })
  }
  // Window lifecycle callbacks run while backend startup is pending.
  if (quitting) return
  if (mainWindow !== undefined && development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  setTimeout(() => { void checkAndPrompt(false) }, 10_000)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const diagnosticFile = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
  if (diagnosticFile !== undefined) {
    await writeFile(diagnosticFile, `${error instanceof Error ? error.stack ?? message : message}\n`).catch(() => undefined)
  }
  const window = BrowserWindow.getAllWindows()[0] ?? createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), true)
  window.once('closed', () => { app.quit() })
  await showEmergencyDocument(window, message)
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
