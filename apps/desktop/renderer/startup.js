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
  const statusCard = document.querySelector('#status')
  const submit = document.querySelector('#signin-submit')
  const submitSpinner = document.querySelector('#signin-submit-spinner')
  const submitLabel = document.querySelector('#signin-submit-label')
  const signinError = document.querySelector('#signin-error')
  const userInput = document.querySelector('#signin-user')
  const passwordInput = document.querySelector('#signin-password')
  const passwordToggle = document.querySelector('#signin-password-toggle')
  const forgot = document.querySelector('#signin-forgot')
  const recovery = document.querySelector('#recovery')
  const recoveryForm = document.querySelector('#recovery-form')
  const recoveryEmail = document.querySelector('#recovery-email')
  const recoveryError = document.querySelector('#recovery-error')
  const recoverySent = document.querySelector('#recovery-sent')
  const recoverySubmit = document.querySelector('#recovery-submit')
  let loginPending = false
  let recoveryPending = false
  let recoveryNotice
  let lastState = { phase: 'starting' }
  let signedIn = (await api.identity.status()).signedIn
  let focusedSignIn = false

  /** Copy every static label the shell owns from the active dictionary. */
  function applyCopy() {
    document.documentElement.lang = id
    document.querySelector('#page-title').textContent = messages.startupLoading
    document.querySelector('#restart').textContent = messages.restartApplication
    document.querySelector('#disable-plugins').textContent = messages.disableThirdPartyPlugins
    document.querySelector('#reset-configuration').textContent = messages.resetConfiguration
    document.querySelector('#reset-advice').textContent = messages.startupConfigurationAdvice
    document.querySelector('#reinstall-advice').textContent = messages.startupReinstallAdvice
    document.querySelector('#signin-description').textContent = messages.signInSubtitle
    document.querySelector('#signin-user-label').textContent = messages.signInUser
    document.querySelector('#signin-password-label').textContent = messages.signInPassword
    document.querySelector('#recovery-title').textContent = messages.passwordRecoveryTitle
    document.querySelector('#recovery-description').textContent = messages.passwordRecoveryDescription
    document.querySelector('#recovery-email-label').textContent = messages.passwordRecoveryEmail
    document.querySelector('#recovery-close').textContent = messages.passwordRecoveryClose
    recoverySubmit.textContent = messages.passwordRecoverySubmit
    forgot.textContent = messages.signInForgot
    markPassword()
    renderRecoveryNotice()
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

  // The password reveal keeps the value in the same field, so the form still
  // submits exactly what the operator typed.
  function markPassword() {
    const visible = passwordInput.type === 'text'
    const label = visible ? messages.signInHidePassword : messages.signInShowPassword
    passwordToggle.setAttribute('aria-pressed', String(visible))
    passwordToggle.setAttribute('aria-label', label)
    passwordToggle.setAttribute('title', label)
  }
  passwordToggle.addEventListener('click', () => {
    const visible = passwordInput.type === 'password'
    passwordInput.type = visible ? 'text' : 'password'
    markPassword()
    passwordInput.focus()
  })

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
    document.querySelector('main').setAttribute('aria-busy', String(signedIn && state.phase !== 'error'))
    signin.hidden = signedIn
    statusCard.hidden = !signedIn
    if (!signedIn) {
      document.querySelector('#spinner').hidden = true
      document.querySelector('#heading').textContent = ''
      document.querySelector('#description').textContent = ''
      document.querySelector('#error').hidden = true
      document.querySelector('#actions').hidden = true
      document.querySelector('#reset-advice').hidden = true
      document.querySelector('#reinstall-advice').hidden = true
      // The card appears only after the stored identity is read, so the first
      // paint of the form is also the moment to put the caret in it.
      if (!focusedSignIn) {
        focusedSignIn = true
        userInput.focus()
      }
      return
    }
    const failed = state.phase === 'error'
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

  // Recovery asks the console for the reset link, the same call the deployed
  // sign-in page makes, so the desktop never routes an operator through a browser.
  function renderRecoveryNotice() {
    const sent = recoveryNotice === 'sent'
    const failure = recoveryNotice === 'missing' ? messages.passwordRecoveryMissing
      : recoveryNotice === 'failed' ? messages.passwordRecoveryFailed : ''
    recoverySent.hidden = !sent
    recoverySent.textContent = sent ? messages.passwordRecoverySent : ''
    recoveryError.hidden = failure === ''
    recoveryError.textContent = failure
  }
  function openRecovery() {
    recoveryEmail.value = userInput.value.includes('@') ? userInput.value : ''
    recoveryNotice = undefined
    renderRecoveryNotice()
    if (typeof recovery.showModal === 'function') recovery.showModal()
    else recovery.setAttribute('open', '')
    recoveryEmail.focus()
  }
  function closeRecovery() {
    if (typeof recovery.close === 'function') recovery.close()
    else recovery.removeAttribute('open')
  }
  async function submitRecovery() {
    if (recoveryPending) return
    const email = recoveryEmail.value.trim()
    if (email === '') {
      recoveryNotice = 'missing'
      renderRecoveryNotice()
      return
    }
    recoveryPending = true
    recoverySubmit.setAttribute('aria-busy', 'true')
    recoverySubmit.setAttribute('aria-disabled', 'true')
    recoveryNotice = undefined
    renderRecoveryNotice()
    try {
      const result = await api.identity.requestPasswordReset(email)
      recoveryNotice = result.ok ? 'sent' : 'failed'
      if (result.ok) recoveryEmail.value = ''
    } catch {
      recoveryNotice = 'failed'
    } finally {
      recoveryPending = false
      recoverySubmit.removeAttribute('aria-busy')
      recoverySubmit.removeAttribute('aria-disabled')
      renderRecoveryNotice()
    }
  }

  signin.addEventListener('submit', (event) => { event.preventDefault(); void submitSignIn() })
  forgot.addEventListener('click', openRecovery)
  document.querySelector('#recovery-close').addEventListener('click', closeRecovery)
  recoveryForm.addEventListener('submit', (event) => { event.preventDefault(); void submitRecovery() })
  document.querySelector('#disable-plugins').addEventListener('click', () => { void recover(() => api.disablePlugins()) })
  document.querySelector('#reset-configuration').addEventListener('click', () => { void recover(() => api.resetConfiguration()) })
  document.querySelector('#restart').addEventListener('click', () => { void recover(() => api.restart()) })
}

void main()
