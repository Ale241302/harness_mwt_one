/** Typed English and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  startupFailed: 'Faberloom could not start',
  startupLoading: 'Starting Faberloom…',
  startupLoadingDescription: 'Your workspace will open when it is ready.',
  startupErrorDescription: 'Choose a recovery action below. Disabling third-party plugins retains their files.',
  startupReinstallAdvice: 'If application files are missing or damaged, close the application and reinstall it. Your tasks are stored separately.',
  startupConfigurationAdvice: 'Reset Desktop deletes all Desktop profile configuration and third-party plugins without a backup, then starts a fresh profile. Shared tasks and settings are retained.',
  restartApplication: 'Close and restart',
  resetConfiguration: 'Reset Desktop and retry',
  disableThirdPartyPlugins: 'Disable all third-party plugins and retry',
  pluginsMenu: 'Desktop Plugins…',
  pluginsMenuPackagedOnly: 'Desktop Plugins… (available in packaged applications)',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'Faberloom Update',
  updateAvailable: 'An update is available',
  updateDetail: 'Faberloom {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  pluginManagerTitle: 'Desktop Plugins',
  pluginWindowTitle: 'Faberloom — Desktop Plugins',
  pluginManagerDescription: 'Plugins are installed only in the Desktop node_modules and are managed by the bundled pnpm.',
  refresh: 'Refresh',
  enable: 'Enable',
  disable: 'Disable',
  disabled: 'Disabled',
  retry: 'Retry startup',
  disableAll: 'Disable all plugins and retry',
  recoveryDescription: 'The backend could not start. Update or disable incompatible plugins, then retry. Installed plugins and configuration are retained.',
  changingActivation: 'Changing plugin activation…',
  npmPackage: 'npm package',
  install: 'Install',
  installed: 'Installed',
  noPlugins: 'No Desktop plugins are installed.',
  remove: 'Remove',
  update: 'Update',
  targetVersion: 'Enter the target version for {name}',
  removing: 'Removing {name}…',
  updating: 'Updating {name}…',
  installing: 'Installing {spec}…',
  operationComplete: 'Done. The Desktop backend has restarted.',
  refreshing: 'Refreshing…',
  refreshed: 'Plugin list refreshed.',
  loadingPlugins: 'Reading Desktop plugins…',
  signInSubtitle: 'Sign in with your console user',
  signInUser: 'User or email',
  signInPassword: 'Password',
  signInSubmit: 'Sign in',
  signInBusy: 'Signing in…',
  signInFailed: 'Sign-in failed',
  signInShowPassword: 'Show password',
  signInHidePassword: 'Hide password',
  signInForgot: 'Forgot your password?',
  passwordRecoveryTitle: 'Reset your password',
  passwordRecoveryDescription: 'Enter your email. If the account exists and is active, we send you a link to reset it.',
  passwordRecoveryEmail: 'Email',
  passwordRecoverySubmit: 'Send link',
  passwordRecoveryClose: 'Close',
  passwordRecoveryMissing: 'Enter your email.',
  passwordRecoverySent: 'If the account exists and is active, the link is on its way.',
  passwordRecoveryFailed: 'We could not send the link. Try again.',
  signedInAs: 'Signed in as {email}',
  signOutMenu: 'Sign out',
  appearanceToDark: 'Switch to dark appearance',
  appearanceToLight: 'Switch to light appearance',
  languageTitle: 'Language',
  openWebMenu: 'Open MWT.ONE in the browser',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  startupFailed: 'Faberloom 无法启动',
  startupLoading: '正在启动 Faberloom…',
  startupLoadingDescription: '准备就绪后将自动打开工作区。',
  startupErrorDescription: '请选择下方的恢复操作。禁用第三方插件会保留插件文件。',
  startupReinstallAdvice: '如果应用文件缺失或损坏，请关闭应用并重新安装。任务数据存储在独立位置。',
  startupConfigurationAdvice: '重置 Desktop 会删除桌面端的全部 profile 配置和第三方插件，不保留备份，然后重新初始化并启动。共享任务和设置会保留。',
  restartApplication: '关闭并重启',
  resetConfiguration: '重置 Desktop 并重试',
  disableThirdPartyPlugins: '禁用全部第三方插件并重试',
  pluginsMenu: '桌面插件…',
  pluginsMenuPackagedOnly: '桌面插件…（打包应用中可用）',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'Faberloom 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'Faberloom {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  pluginManagerTitle: '桌面插件',
  pluginWindowTitle: 'Faberloom — 桌面插件',
  pluginManagerDescription: '插件只安装到桌面端自己的 node_modules，并由内置 pnpm 管理。',
  refresh: '刷新',
  enable: '启用',
  disable: '禁用',
  disabled: '已禁用',
  retry: '重试启动',
  disableAll: '禁用全部插件并重试',
  recoveryDescription: '后端无法启动。请更新或禁用不兼容插件，然后重试。已安装插件和配置会保留。',
  changingActivation: '正在更改插件启用状态…',
  npmPackage: 'npm 包',
  install: '安装',
  installed: '已安装',
  noPlugins: '还没有安装桌面插件。',
  remove: '移除',
  update: '更新',
  targetVersion: '输入 {name} 的目标版本',
  removing: '正在移除 {name}…',
  updating: '正在更新 {name}…',
  installing: '正在安装 {spec}…',
  operationComplete: '操作完成，桌面后端已重新启动。',
  refreshing: '正在刷新…',
  refreshed: '插件列表已刷新。',
  loadingPlugins: '正在读取桌面插件…',
  signInSubtitle: '使用控制台账号登录',
  signInUser: '账号或邮箱',
  signInPassword: '密码',
  signInSubmit: '登录',
  signInBusy: '正在登录…',
  signInFailed: '登录失败',
  signInShowPassword: '显示密码',
  signInHidePassword: '隐藏密码',
  signInForgot: '忘记密码？',
  passwordRecoveryTitle: '重置密码',
  passwordRecoveryDescription: '输入你的邮箱。如果账号存在且处于启用状态，我们会发送重置链接。',
  passwordRecoveryEmail: '电子邮箱',
  passwordRecoverySubmit: '发送链接',
  passwordRecoveryClose: '关闭',
  passwordRecoveryMissing: '请输入电子邮箱。',
  passwordRecoverySent: '如果账号存在且处于启用状态，链接已在发送中。',
  passwordRecoveryFailed: '无法发送链接，请重试。',
  signedInAs: '已登录：{email}',
  signOutMenu: '退出登录',
  appearanceToDark: '切换到深色外观',
  appearanceToLight: '切换到浅色外观',
  languageTitle: '语言',
  openWebMenu: '在浏览器中打开 MWT.ONE',
} as const satisfies DesktopMessages

/**
 * Spanish copy owned by the Electron shell, checked complete against the
 * English key set. The shell's own screens are the first thing a Spanish-
 * speaking operator meets, so this dictionary ships with the built-ins rather
 * than waiting for a language pack.
 */
export const es = {
  application: 'Aplicación',
  startupFailed: 'No se pudo iniciar Faberloom',
  startupLoading: 'Iniciando Faberloom…',
  startupLoadingDescription: 'El espacio de trabajo se abrirá cuando esté listo.',
  startupErrorDescription: 'Elige una acción de recuperación. Desactivar los complementos de terceros conserva sus archivos.',
  startupReinstallAdvice: 'Si faltan archivos de la aplicación o están dañados, ciérrala y vuelve a instalarla. Tus tareas se guardan aparte.',
  startupConfigurationAdvice: 'Restablecer Desktop borra toda la configuración del perfil de Desktop y los complementos de terceros sin respaldo, y después inicia un perfil nuevo. Las tareas y los ajustes compartidos se conservan.',
  restartApplication: 'Cerrar y reiniciar',
  resetConfiguration: 'Restablecer Desktop y reintentar',
  disableThirdPartyPlugins: 'Desactivar todos los complementos de terceros y reintentar',
  pluginsMenu: 'Complementos de Desktop…',
  pluginsMenuPackagedOnly: 'Complementos de Desktop… (disponible en aplicaciones instaladas)',
  checkUpdatesMenu: 'Buscar actualizaciones…',
  updateCheckFailedTitle: 'Falló la búsqueda de actualizaciones',
  unknownError: 'Error desconocido',
  updateCheckTitle: 'Buscar actualizaciones',
  updateCurrent: 'Ya tienes la última versión.',
  updateTitle: 'Actualización de Faberloom',
  updateAvailable: 'Hay una actualización disponible',
  updateDetail: 'Faberloom {version}\n\nEsta versión incluye su versión de dsh correspondiente. La aplicación se reiniciará después de instalarla.',
  installAndRestart: 'Instalar y reiniciar',
  later: 'Más tarde',
  updateFailedTitle: 'Falló la actualización',
  pluginManagerTitle: 'Complementos de Desktop',
  pluginWindowTitle: 'Faberloom — Complementos de Desktop',
  pluginManagerDescription: 'Los complementos se instalan solo en los node_modules de Desktop y los gestiona el pnpm incluido.',
  refresh: 'Actualizar',
  enable: 'Activar',
  disable: 'Desactivar',
  disabled: 'Desactivado',
  retry: 'Reintentar el inicio',
  disableAll: 'Desactivar todos los complementos y reintentar',
  recoveryDescription: 'El backend no pudo iniciar. Actualiza o desactiva los complementos incompatibles y reintenta. Los complementos instalados y la configuración se conservan.',
  changingActivation: 'Cambiando la activación de los complementos…',
  npmPackage: 'paquete npm',
  install: 'Instalar',
  installed: 'Instalado',
  noPlugins: 'No hay complementos de Desktop instalados.',
  remove: 'Quitar',
  update: 'Actualizar',
  targetVersion: 'Escribe la versión de destino para {name}',
  removing: 'Quitando {name}…',
  updating: 'Actualizando {name}…',
  installing: 'Instalando {spec}…',
  operationComplete: 'Listo. El backend de Desktop se reinició.',
  refreshing: 'Actualizando…',
  refreshed: 'Lista de complementos actualizada.',
  loadingPlugins: 'Leyendo los complementos de Desktop…',
  signInSubtitle: 'Entra con tu usuario de la consola',
  signInUser: 'Usuario o correo',
  signInPassword: 'Contraseña',
  signInSubmit: 'Entrar',
  signInBusy: 'Entrando…',
  signInFailed: 'No se pudo entrar',
  signInShowPassword: 'Mostrar la contraseña',
  signInHidePassword: 'Ocultar la contraseña',
  signInForgot: '¿Olvidaste tu contraseña?',
  passwordRecoveryTitle: 'Recuperar contraseña',
  passwordRecoveryDescription: 'Escribe tu correo. Si la cuenta existe y está activa, te enviamos un enlace para restablecerla.',
  passwordRecoveryEmail: 'Correo electrónico',
  passwordRecoverySubmit: 'Enviar enlace',
  passwordRecoveryClose: 'Cerrar',
  passwordRecoveryMissing: 'Escribe tu correo electrónico.',
  passwordRecoverySent: 'Si la cuenta existe y está activa, el enlace va en camino.',
  passwordRecoveryFailed: 'No se pudo enviar el enlace. Inténtalo de nuevo.',
  signedInAs: 'Sesión de {email}',
  signOutMenu: 'Cerrar sesión',
  appearanceToDark: 'Cambiar al modo oscuro',
  appearanceToLight: 'Cambiar al modo claro',
  languageTitle: 'Idioma',
  openWebMenu: 'Abrir MWT.ONE en el navegador',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: DesktopLocaleId
  readonly messages: DesktopMessages
  /** Every shipped locale, in switcher order, so the renderer builds one control. */
  readonly available: typeof DESKTOP_LOCALES
}

/** Shipped shell locales, in switcher order. */
export const DESKTOP_LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'zh-CN', label: '中文' },
] as const

/** One shipped shell locale id. */
export type DesktopLocaleId = typeof DESKTOP_LOCALES[number]['id']

/**
 * Resolve a system or stored locale tag to one shipped Desktop dictionary.
 * Regional Spanish tags (`es-AR`, `es-MX`, …) all land on the Spanish copy.
 * @param locale - the tag to resolve, typically Electron's `app.getLocale()`.
 * @returns the matching locale payload.
 */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  const tag = locale.toLowerCase()
  if (tag.startsWith('zh')) return { id: 'zh-CN', messages: zh, available: DESKTOP_LOCALES }
  if (tag.startsWith('es')) return { id: 'es', messages: es, available: DESKTOP_LOCALES }
  return { id: 'en', messages: en, available: DESKTOP_LOCALES }
}

/**
 * Whether a value names one of the shipped shell locales.
 * @param value - candidate locale id from the renderer or the stored choice.
 * @returns whether the id is a shipped locale.
 */
export function isDesktopLocaleId(value: unknown): value is DesktopLocaleId {
  return DESKTOP_LOCALES.some(locale => locale.id === value)
}

/**
 * Build the payload for one shipped locale id.
 * @param id - a shipped shell locale id.
 * @returns the matching locale payload.
 */
export function desktopLocaleOf(id: DesktopLocaleId): DesktopLocale {
  const messages = id === 'zh-CN' ? zh : id === 'es' ? es : en
  return { id, messages, available: DESKTOP_LOCALES }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}
