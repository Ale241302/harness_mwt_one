/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale, DesktopLocaleId } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'
import type { DesktopAppearance } from './appearance.ts'
import type { DesktopBackendMode } from './backend-choice.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  localeSet: 'dsh-desktop:locale-set',
  appearanceGet: 'dsh-desktop:appearance-get',
  appearanceSet: 'dsh-desktop:appearance-set',
  backendSelectionGet: 'dsh-desktop:backend-selection-get',
  backendSelectionSet: 'dsh-desktop:backend-selection-set',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  pluginsToggle: 'dsh-desktop:plugins-toggle',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  backendState: 'dsh-desktop:backend-state',
  identityStatus: 'dsh-desktop:identity-status',
  identityLogin: 'dsh-desktop:identity-login',
  identitySignOut: 'dsh-desktop:identity-sign-out',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Sign-in state presented to Desktop-owned UI; never carries the console token. */
export interface DesktopIdentityStatus {
  readonly signedIn: boolean
  readonly consolaBase: string
  readonly email?: string
  readonly role?: string
  readonly fullName?: string
}

/** Backend the shell is running, and whether the launching environment fixed it. */
export interface DesktopBackendSelection {
  readonly mode: DesktopBackendMode
  /** The launching environment decided this backend, so the shell offers no switch. */
  readonly fixed: boolean
}

/** Outcome of one sign-in attempt; a refusal is not an IPC failure. */
export interface DesktopSignInResult {
  readonly ok: boolean
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  /** Switch the shell language and return the payload for the chosen locale. */
  setLocale(id: DesktopLocaleId): Promise<DesktopLocale>
  readonly appearance: {
    get(): Promise<DesktopAppearance>
    set(value: DesktopAppearance): Promise<void>
  }
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    disableAll(): Promise<void>
  }
  readonly backend: {
    status(): Promise<DesktopBackendState>
    retry(): Promise<void>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
    /** Backend this installation launches, and whether it can be switched. */
    selection(): Promise<DesktopBackendSelection>
    /** Persist a backend choice and launch it. */
    select(mode: DesktopBackendMode): Promise<void>
  }
  readonly identity: {
    status(): Promise<DesktopIdentityStatus>
    login(usuario: string, password: string): Promise<DesktopSignInResult>
    signOut(): Promise<DesktopIdentityStatus>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale' | 'setLocale' | 'identity' | 'appearance'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
