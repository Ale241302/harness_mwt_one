import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopBackendState } from '../src/backend-controller.ts'
import type { DshDesktopStartupApi } from '../src/ipc.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import { startupFailureDocument } from '../src/startup-document.ts'

interface AppearanceOptions {
  readonly osDark?: boolean
  readonly stored?: 'light' | 'dark'
}

function startup(
  locale = 'en',
  status: Promise<DesktopBackendState> = Promise.resolve({ phase: 'starting' }),
  signedIn = true,
  appearance: AppearanceOptions = {},
) {
  const dom = new JSDOM(readFileSync(new URL('../renderer/startup.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  onTestFinished(() => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'))
    dom.window.close()
  })
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: appearance.osDark === true }),
  })
  const listeners = new Set<(state: DesktopBackendState) => void>()
  const unsubscribe = vi.fn(() => { listeners.clear() })
  const disablePlugins = vi.fn(async () => {})
  const resetConfiguration = vi.fn(async () => {})
  const restart = vi.fn(async () => {})
  const login = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const getAppearance = vi.fn(async (): Promise<'light' | 'dark'> => appearance.stored ?? (appearance.osDark === true ? 'dark' : 'light'))
  const setAppearance = vi.fn(async (_value: 'light' | 'dark') => {})
  const setLocale = vi.fn(async (id: Parameters<DshDesktopStartupApi['setLocale']>[0]) => resolveDesktopLocale(id))
  const queried = Promise.withResolvers<undefined>()
  const api: DshDesktopStartupApi = {
    protocolVersion: 1,
    locale: async () => resolveDesktopLocale(locale),
    setLocale,
    appearance: { get: getAppearance, set: setAppearance },
    backend: {
      status: () => { queried.resolve(undefined); return status },
      subscribe: (listener) => { listeners.add(listener); return unsubscribe },
    },
    identity: {
      status: async () => ({ signedIn, consolaBase: 'https://consola.mwt.one/api', ...(signedIn ? { email: 'a@b.c', role: 'admin' } : {}) }),
      login,
      signOut: async () => ({ signedIn: false, consolaBase: 'https://consola.mwt.one/api' }),
    },
    disablePlugins, resetConfiguration, restart,
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  runInContext(readFileSync(new URL('../renderer/startup.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  const document = dom.window.document
  const element = (selector: string): HTMLElement => {
    const result = document.querySelector<HTMLElement>(selector)
    if (result === null) throw new Error(`Missing startup element: ${selector}`)
    return result
  }
  const button = (selector: string): HTMLButtonElement => {
    const result = document.querySelector<HTMLButtonElement>(selector)
    if (result === null) throw new Error(`Missing startup button: ${selector}`)
    return result
  }
  const publish = (state: DesktopBackendState): void => { for (const listener of listeners) listener(state) }
  const submitSignIn = (): void => {
    element('#signin').dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  }
  const copy = (): string => [element('#heading').textContent, element('#description').textContent,
    ...['#reset-advice', '#reinstall-advice', '#error', '#actions'].filter(selector => !element(selector).hidden)
      .flatMap(selector => selector === '#actions'
        ? [...document.querySelectorAll<HTMLButtonElement>('#actions button')].filter(button => !button.hidden).map(button => button.textContent)
        : [element(selector).textContent]),
  ].join('\n')
  return { dom, document, element, button, publish, copy, submitSignIn,
    disablePlugins, resetConfiguration, restart, unsubscribe, login, getAppearance, setAppearance, setLocale, queried: queried.promise }
}

it('renders the sign-in form instead of loading while signed out', async () => {
  const page = startup('en', Promise.resolve({ phase: 'starting' }), false)
  await expect.poll(() => page.element('#heading').textContent).not.toBe('')
  expect(page.element('#heading').textContent).toBe('Sign in to MWT.ONE')
  expect(page.element('#title').textContent).toBe('FaberLoom')
  expect(page.element('#signin').hidden).toBe(false)
  expect(page.element('#spinner').hidden).toBe(true)
  expect(page.element('#signin-user-label').textContent).toBe('User')
  expect(page.element('#signin-submit').textContent).toBe('Sign in')
})

it('carries the two-tone wordmark and a locale-owned appearance toggle', async () => {
  const page = startup()
  await expect.poll(() => page.element('#heading').textContent).not.toBe('')
  expect(page.element('#wordmark-faber').textContent).toBe('Faber')
  expect(page.element('#wordmark-loom').textContent).toBe('Loom')
  const toggle = page.button('#appearance-toggle')
  expect(page.document.documentElement.dataset.appearance).toBe('light')
  expect(toggle.getAttribute('aria-label')).toBe('Switch to dark appearance')
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  toggle.click()
  expect(page.document.documentElement.dataset.appearance).toBe('dark')
  expect(toggle.getAttribute('aria-label')).toBe('Switch to light appearance')
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(page.setAppearance).toHaveBeenCalledWith('dark')
})

it('applies the stored appearance over the OS default', async () => {
  const stored = startup('en', Promise.resolve({ phase: 'starting' }), true, { osDark: false, stored: 'dark' })
  await expect.poll(() => stored.element('#heading').textContent).not.toBe('')
  expect(stored.document.documentElement.dataset.appearance).toBe('dark')
  expect(stored.button('#appearance-toggle').getAttribute('aria-label')).toBe('Switch to light appearance')
  expect(stored.setAppearance).not.toHaveBeenCalled()

  const osDark = startup('en', Promise.resolve({ phase: 'starting' }), true, { osDark: true })
  await expect.poll(() => osDark.element('#heading').textContent).not.toBe('')
  expect(osDark.document.documentElement.dataset.appearance).toBe('dark')
})

it('shows an inline spinner in the submit button while signing in', async () => {
  const page = startup('en', Promise.resolve({ phase: 'starting' }), false)
  await expect.poll(() => page.element('#heading').textContent).toBe('Sign in to MWT.ONE')
  const pending = Promise.withResolvers<{ ok: boolean; message?: string }>()
  page.login.mockReturnValueOnce(pending.promise)
  page.submitSignIn()
  await expect.poll(() => page.button('#signin-submit').getAttribute('aria-busy')).toBe('true')
  expect(page.element('#signin-submit-spinner').hidden).toBe(false)
  expect(page.element('#signin-submit-label').textContent).toBe('Signing in…')
  expect(page.button('#signin-submit').disabled).toBe(false)
  expect(page.element('#signin-user').hasAttribute('disabled')).toBe(false)
  expect(page.element('#signin-password').hasAttribute('disabled')).toBe(false)
  pending.resolve({ ok: false, message: 'Rejected' })
  await expect.poll(() => page.element('#signin-error').hidden).toBe(false)
  expect(page.element('#signin-error').textContent).toBe('Sign-in failed: Rejected')
  expect(page.button('#signin-submit').hasAttribute('aria-busy')).toBe(false)
  expect(page.element('#signin-submit-spinner').hidden).toBe(true)
  expect(page.element('#signin-submit-label').textContent).toBe('Sign in')
})

it('restores the idle submit button after a successful sign-in', async () => {
  const page = startup('en', Promise.resolve({ phase: 'starting' }), false)
  await expect.poll(() => page.element('#heading').textContent).toBe('Sign in to MWT.ONE')
  page.submitSignIn()
  await expect.poll(() => page.element('#signin').hidden).toBe(true)
  expect(page.element('#signin-submit-spinner').hidden).toBe(true)
  expect(page.element('#signin-submit-label').textContent).toBe('Sign in')
  expect(page.button('#signin-submit').hasAttribute('aria-busy')).toBe(false)
  expect(page.document.querySelector<HTMLInputElement>('#signin-password')?.value).toBe('')
})

it('ships cream and warm-dark brand variants with referenceable fonts', () => {
  const css = readFileSync(new URL('../renderer/startup.css', import.meta.url), 'utf8')
  expect(css).toContain('#F4F1ED')
  expect(css).toContain('#1F1E1C')
  expect(css).toContain('#C96442')
  expect(css).toContain('[data-appearance="dark"]')
  expect(css).toContain('fonts/geist.woff2')
  expect(css).toContain('fonts/geist-mono.woff2')
  expect(css).toContain('fonts/eb-garamond-italic.woff2')
})

it('disables both spinners under prefers-reduced-motion', () => {
  const css = readFileSync(new URL('../renderer/startup.css', import.meta.url), 'utf8')
  const block = /@media \(prefers-reduced-motion: reduce\) \{([^}]*)\}/u.exec(css)?.[1] ?? ''
  expect(block).toContain('#spinner')
  expect(block).toContain('.button-spinner')
  expect(block).toContain('animation: none')
})

it('shows English loading and recovery actions without a Host document', async () => {
  const page = startup()
  await expect.poll(() => page.element('#heading').textContent).not.toBe('')
  expect(page.copy()).toMatchInlineSnapshot(`
    "Starting Faberloom…
    Your workspace will open when it is ready."
  `)
  expect(page.element('main').getAttribute('aria-busy')).toBe('true')
  expect(page.element('#spinner').hidden).toBe(false)
  expect(page.element('#actions').hidden).toBe(true)
  expect(page.button('#restart').disabled).toBe(true)
  expect(page.button('#disable-plugins').disabled).toBe(true)
  page.publish({ phase: 'error', profileRecovery: true, message: 'Plugin failed to load' })
  expect(page.copy()).toMatchInlineSnapshot(`
    "Faberloom could not start
    Choose a recovery action below. Disabling third-party plugins retains their files.
    Reset Desktop deletes all Desktop profile configuration and third-party plugins without a backup, then starts a fresh profile. Shared tasks and settings are retained.
    If application files are missing or damaged, close the application and reinstall it. Your tasks are stored separately.
    Plugin failed to load
    Close and restart
    Disable all third-party plugins and retry
    Reset Desktop and retry"
  `)
  expect(page.element('main').getAttribute('aria-busy')).toBe('false')
  expect(page.element('#spinner').hidden).toBe(true)
  page.button('#restart').click()
  expect(page.restart).toHaveBeenCalledOnce()
  expect(page.element('#actions').hidden).toBe(true)
  expect(page.element('#error').textContent).toBe('')
  expect(page.element('main').getAttribute('aria-busy')).toBe('true')
})

it('shows Chinese loading and recovery copy', async () => {
  const page = startup('zh-CN')
  await expect.poll(() => page.element('#heading').textContent).not.toBe('')
  expect(page.document.documentElement.lang).toBe('zh-CN')
  expect(page.copy()).toMatchInlineSnapshot(`
    "正在启动 Faberloom…
    准备就绪后将自动打开工作区。"
  `)
  page.publish({ phase: 'error', profileRecovery: true, message: '插件加载失败' })
  expect(page.copy()).toMatchInlineSnapshot(`
    "Faberloom 无法启动
    请选择下方的恢复操作。禁用第三方插件会保留插件文件。
    重置 Desktop 会删除桌面端的全部 profile 配置和第三方插件，不保留备份，然后重新初始化并启动。共享任务和设置会保留。
    如果应用文件缺失或损坏，请关闭应用并重新安装。任务数据存储在独立位置。
    插件加载失败
    关闭并重启
    禁用全部第三方插件并重试
    重置 Desktop 并重试"
  `)
})

it('renders diagnostic markup as text and exposes failures from recovery actions', async () => {
  const page = startup()
  await expect.poll(() => page.element('#heading').textContent).not.toBe('')
  const diagnostic = '<img src=x onerror="window.compromised=true">'
  page.publish({ phase: 'error', profileRecovery: true, message: diagnostic })
  expect(page.element('#error').textContent).toBe(diagnostic)
  expect(page.element('#error').childElementCount).toBe(0)
  page.restart.mockRejectedValueOnce(new page.dom.window.Error('Retry failed'))
  page.button('#restart').click()
  await expect.poll(() => page.element('#error').textContent).toBe('Retry failed')
  expect(page.button('#restart').disabled).toBe(false)
  expect(page.button('#disable-plugins').disabled).toBe(false)
})

it('keeps subscribed state when initial status arrives late and detaches on pagehide', async () => {
  const initial = Promise.withResolvers<DesktopBackendState>()
  const page = startup('en', initial.promise)
  await page.queried
  page.publish({ phase: 'error', profileRecovery: true, message: 'Fresh startup failure' })
  initial.resolve({ phase: 'starting' })
  await initial.promise
  expect(page.element('#error').textContent).toBe('Fresh startup failure')
  expect(page.element('#actions').hidden).toBe(false)
  page.dom.window.dispatchEvent(new page.dom.window.Event('pagehide'))
  expect(page.unsubscribe).toHaveBeenCalledOnce()
  page.publish({ phase: 'starting' })
  expect(page.element('#error').textContent).toBe('Fresh startup failure')
  page.dom.window.dispatchEvent(new page.dom.window.Event('pagehide'))
  expect(page.unsubscribe).toHaveBeenCalledOnce()
})

it.each(['en', 'zh-CN'])('offers recovery actions with %s guidance and preserves diagnostic text', async (locale) => {
  const page = startup(locale)
  await expect.poll(() => page.button('#restart').disabled).toBe(true)
  page.publish({ phase: 'error', profileRecovery: true, message: 'Failure details' })
  await expect(`${page.copy()}\n`).toMatchFileSnapshot(fileURLToPath(new URL(`./expected/startup-${locale}-profile.txt`, import.meta.url)))
  for (const action of ['#disable-plugins', '#reset-configuration', '#restart']) {
    page.publish({ phase: 'error', profileRecovery: true, message: 'Failure details' })
    page.button(action).click()
    expect(page.element('#actions').hidden).toBe(true)
  }
  expect(page.disablePlugins).toHaveBeenCalledOnce()
  expect(page.resetConfiguration).toHaveBeenCalledOnce()
  expect(page.restart).toHaveBeenCalledOnce()
  page.publish({ phase: 'error', profileRecovery: false, message: 'Failure details' })
  expect(page.button('#disable-plugins').hidden).toBe(true)
  expect(page.button('#reset-configuration').hidden).toBe(true)
  await expect(`${page.copy()}\n`).toMatchFileSnapshot(fileURLToPath(new URL(`./expected/startup-${locale}-restart.txt`, import.meta.url)))
})

it('keeps emergency diagnostics inert without shell assets', () => {
  const html = startupFailureDocument(resolveDesktopLocale('zh-CN'), '<script>alert(1)</script>', true)
  const dom = new JSDOM(html)
  expect(dom.window.document.querySelector('script')).toBeNull()
  expect(dom.window.document.querySelector('pre')?.textContent).toBe('<script>alert(1)</script>')
  expect(dom.window.document.querySelector('p')?.textContent).toContain('重新安装')
  expect([...dom.window.document.querySelectorAll('form')].map(form => form.action)).toEqual([
    'dsh-recovery://restart', 'dsh-recovery://plugins', 'dsh-recovery://reset',
  ])
  dom.window.close()
})

it('offers only restart before emergency profile recovery is available', () => {
  const dom = new JSDOM(startupFailureDocument(resolveDesktopLocale('en'), 'Resources unavailable'))
  expect([...dom.window.document.querySelectorAll('form')].map(form => form.action)).toEqual(['dsh-recovery://restart'])
  dom.window.close()
})

it('switches the shell language from the sign-in screen and re-labels it', async () => {
  const page = startup('en', Promise.resolve({ phase: 'starting' }), false)
  await expect.poll(() => page.element('#heading').textContent).toBe('Sign in to MWT.ONE')
  const buttons = [...page.document.querySelectorAll<HTMLButtonElement>('#language button')]
  expect(buttons.map(button => button.textContent)).toEqual(['English', 'Español', '中文'])
  expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')
  expect(page.element('#language').getAttribute('aria-label')).toBe('Language')

  buttons[1]?.click()
  await expect.poll(() => page.element('#heading').textContent).toBe('Entrar a MWT.ONE')
  expect(page.setLocale).toHaveBeenCalledWith('es')
  expect(page.document.documentElement.lang).toBe('es')
  expect(page.element('#signin-submit-label').textContent).toBe('Entrar')
  expect(page.element('#language').getAttribute('aria-label')).toBe('Idioma')
  const after = [...page.document.querySelectorAll<HTMLButtonElement>('#language button')]
  expect(after[1]?.getAttribute('aria-pressed')).toBe('true')
  expect(after[0]?.getAttribute('aria-pressed')).toBe('false')
})
