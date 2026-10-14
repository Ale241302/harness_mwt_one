const api = window.dshDesktop

// Resolve the OS appearance before the first paint; a stored preference overrides
// it once it loads, so a restart never flashes the wrong theme.
const osPrefersDark = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.dataset.appearance = osPrefersDark ? 'dark' : 'light'

async function main() {
  const initial = await api.locale()
  let id = initial.id
  let messages = initial.messages
  const signin = document.querySelector('#signin')
  const submit = document.querySelector('#signin-submit')
  const submitSpinner = document.querySelector('#signin-submit-spinner')
  const submitLabel = document.querySelector('#signin-submit-label')
  const signinError = document.querySelector('#signin-error')
  const userInput = document.querySelector('#signin-user')
  const passwordInput = document.querySelector('#signin-password')
  let loginPending = false
  let lastState = { phase: 'starting' }
  let signedIn = (await api.identity.status()).signedIn

  /** Copy every static label the shell owns from the active dictionary. */
  function applyCopy() {
    document.documentElement.lang = id
    document.querySelector('#page-title').textContent = messages.startupLoading
    document.querySelector('#restart').textContent = messages.restartApplication
    document.querySelector('#disable-plugins').textContent = messages.disableThirdPartyPlugins
    document.querySelector('#reset-configuration').textContent = messages.resetConfiguration
    document.querySelector('#reset-advice').textContent = messages.startupConfigurationAdvice
    document.querySelector('#reinstall-advice').textContent = messages.startupReinstallAdvice
    document.querySelector('#signin-description').textContent = messages.signInDescription
    document.querySelector('#signin-user-label').textContent = messages.signInUser
    document.querySelector('#signin-password-label').textContent = messages.signInPassword
    markBackend()
    setSignInBusy(loginPending)
  }

  // Language: one button per shipped locale, built from the payload so the shell
  // stays the single owner of the list. The choice is remembered by the shell.
  const language = document.querySelector('#language')
  for (const option of initial.available) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.locale = option.id
    button.textContent = option.label
    language.append(button)
  }
  const languageButtons = [...language.querySelectorAll('button')]
  function markLanguage() {
    language.setAttribute('aria-label', messages.languageTitle)
    for (const button of languageButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.locale === id))
    }
  }
  for (const button of languageButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.locale
      if (next === undefined || next === id) return
      api.setLocale(next).then((payload) => {
        id = payload.id
        messages = payload.messages
        applyCopy()
        markLanguage()
        applyAppearance(appearance)
        render(lastState)
      }).catch(() => {
        // A refused switch keeps the language the screen is already showing.
      })
    })
  }

  // Backend: the shell owns the list and the stored choice, and it rebuilds the
  // application window on a switch, so this control only reports and requests.
  const backend = document.querySelector('#backend')
  const backendNote = document.querySelector('#backend-note')
  const backendSelection = await api.backend.selection()
  let backendMode = backendSelection.mode
  for (const mode of ['local', 'gateway']) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.backend = mode
    button.textContent = mode === 'local' ? messages.backendLocal : messages.backendGateway
    backend.append(button)
  }
  const backendButtons = [...backend.querySelectorAll('button')]
  function markBackend() {
    backend.setAttribute('aria-label', messages.backendGroupTitle)
    backend.hidden = backendSelection.fixed
    backendNote.textContent = backendSelection.fixed ? messages.backendFixedNote : messages.backendDataNote
    for (const button of backendButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.backend === backendMode))
    }
  }
  for (const button of backendButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.backend
      if (next === undefined || next === backendMode) return
      backendMode = next
      markBackend()
      api.backend.select(next).catch(() => { markBackend() })
    })
  }

  const toggle = document.querySelector('#appearance-toggle')
  let appearance = document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light'
  function applyAppearance(value) {
    appearance = value
    document.documentElement.dataset.appearance = value
    toggle.setAttribute('aria-pressed', String(value === 'dark'))
    toggle.setAttribute('aria-label', value === 'dark' ? messages.appearanceToLight : messages.appearanceToDark)
  }
  applyCopy()
  markLanguage()
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
    lastState = state
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
  const status = await api.backend.status()
  if (!changed) render(status)

  async function recover(operation) {
    render({ phase: 'starting' })
    try { await operation() }
    catch (error) {
      const current = await api.backend.status().catch(() => undefined)
      render(current?.phase === 'error' ? current : { phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

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
