const api = window.dshDesktop

// Resolve the OS appearance before the first paint; a stored preference overrides
// it once it loads, so a restart never flashes the wrong theme.
const osPrefersDark = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.dataset.appearance = osPrefersDark ? 'dark' : 'light'

async function main() {
  const { id, messages } = await api.locale()
  document.documentElement.lang = id
  document.querySelector('#page-title').textContent = messages.startupLoading
  document.querySelector('#restart').textContent = messages.restartApplication
  document.querySelector('#disable-plugins').textContent = messages.disableThirdPartyPlugins
  document.querySelector('#reset-configuration').textContent = messages.resetConfiguration
  document.querySelector('#reset-advice').textContent = messages.startupConfigurationAdvice
  document.querySelector('#reinstall-advice').textContent = messages.startupReinstallAdvice
  const signin = document.querySelector('#signin')
  document.querySelector('#signin-description').textContent = messages.signInDescription
  document.querySelector('#signin-user-label').textContent = messages.signInUser
  document.querySelector('#signin-password-label').textContent = messages.signInPassword
  const submit = document.querySelector('#signin-submit')
  const submitSpinner = document.querySelector('#signin-submit-spinner')
  const submitLabel = document.querySelector('#signin-submit-label')
  submitLabel.textContent = messages.signInSubmit
  const signinError = document.querySelector('#signin-error')
  const userInput = document.querySelector('#signin-user')
  const passwordInput = document.querySelector('#signin-password')
  let signedIn = (await api.identity.status()).signedIn

  const toggle = document.querySelector('#appearance-toggle')
  let appearance = document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light'
  function applyAppearance(value) {
    appearance = value
    document.documentElement.dataset.appearance = value
    toggle.setAttribute('aria-pressed', String(value === 'dark'))
    toggle.setAttribute('aria-label', value === 'dark' ? messages.appearanceToLight : messages.appearanceToDark)
  }
  applyAppearance(appearance)
  try {
    applyAppearance(await api.appearance.get())
  } catch {
    // An unreadable preference leaves the OS appearance in place.
  }
  toggle.addEventListener('click', () => {
    const previous = appearance
    const next = previous === 'dark' ? 'light' : 'dark'
    applyAppearance(next)
    api.appearance.set(next).catch(() => { applyAppearance(previous) })
  })

  function render(state) {
    if (!signedIn) {
      document.querySelector('main').setAttribute('aria-busy', 'false')
      document.querySelector('#spinner').hidden = true
      document.querySelector('#heading').textContent = messages.signInTitle
      document.querySelector('#description').textContent = messages.signInDescription
      document.querySelector('#error').hidden = true
      document.querySelector('#actions').hidden = true
      document.querySelector('#reset-advice').hidden = true
      document.querySelector('#reinstall-advice').hidden = true
      signin.hidden = false
      return
    }
    signin.hidden = true
    const failed = state.phase === 'error'
    document.querySelector('main').setAttribute('aria-busy', String(!failed))
    document.querySelector('#spinner').hidden = failed
    document.querySelector('#heading').textContent = failed ? messages.startupFailed : messages.startupLoading
    document.querySelector('#description').textContent = failed ? messages.startupErrorDescription : messages.startupLoadingDescription
    document.querySelector('#error').hidden = !failed
    document.querySelector('#error').textContent = failed ? state.message : ''
    document.querySelector('#actions').hidden = !failed
    for (const button of document.querySelectorAll('#actions button')) button.disabled = !failed
    for (const selector of ['#disable-plugins', '#reset-configuration', '#reset-advice']) {
      document.querySelector(selector).hidden = !failed || !state.profileRecovery
    }
    document.querySelector('#reinstall-advice').hidden = !failed
  }

  let changed = false
  const unsubscribe = api.backend.subscribe(state => { changed = true; render(state) })
  window.addEventListener('pagehide', unsubscribe, { once: true })
  const initial = await api.backend.status()
  if (!changed) render(initial)

  async function recover(operation) {
    render({ phase: 'starting' })
    try { await operation() }
    catch (error) {
      const current = await api.backend.status().catch(() => undefined)
      render(current?.phase === 'error' ? current : { phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  let loginPending = false
  function setSignInBusy(busy) {
    if (busy) {
      submit.setAttribute('aria-busy', 'true')
      submit.setAttribute('aria-disabled', 'true')
    } else {
      submit.removeAttribute('aria-busy')
      submit.removeAttribute('aria-disabled')
    }
    submitSpinner.hidden = !busy
    submitLabel.textContent = busy ? messages.signInBusy : messages.signInSubmit
  }
  async function submitSignIn() {
    if (loginPending) return
    loginPending = true
    setSignInBusy(true)
    signinError.hidden = true
    let result
    try {
      result = await api.identity.login(userInput.value, passwordInput.value)
    } finally {
      loginPending = false
      setSignInBusy(false)
    }
    if (!result.ok) {
      signinError.hidden = false
      signinError.textContent = `${messages.signInFailed}: ${result.message ?? messages.unknownError}`
      return
    }
    signedIn = true
    passwordInput.value = ''
    render({ phase: 'starting' })
  }
  signin.addEventListener('submit', (event) => { event.preventDefault(); void submitSignIn() })
  document.querySelector('#disable-plugins').addEventListener('click', () => { void recover(() => api.disablePlugins()) })
  document.querySelector('#reset-configuration').addEventListener('click', () => { void recover(() => api.resetConfiguration()) })
  document.querySelector('#restart').addEventListener('click', () => { void recover(() => api.restart()) })
}

void main()
