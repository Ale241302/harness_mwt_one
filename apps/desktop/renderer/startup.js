const api = window.dshDesktop

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
  document.querySelector('#signin-submit').textContent = messages.signInSubmit
  const signinError = document.querySelector('#signin-error')
  let signedIn = (await api.identity.status()).signedIn

  function render(state) {
    if (!signedIn) {
      document.querySelector('main').setAttribute('aria-busy', 'false')
      document.querySelector('#spinner').hidden = true
      document.querySelector('#title').textContent = messages.signInTitle
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
    document.querySelector('#title').textContent = failed ? messages.startupFailed : messages.startupLoading
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
  async function submitSignIn() {
    const submit = document.querySelector('#signin-submit')
    submit.disabled = true
    submit.textContent = messages.signInBusy
    signinError.hidden = true
    const result = await api.identity.login(
      document.querySelector('#signin-user').value,
      document.querySelector('#signin-password').value,
    )
    submit.disabled = false
    submit.textContent = messages.signInSubmit
    if (!result.ok) {
      signinError.hidden = false
      signinError.textContent = `${messages.signInFailed}: ${result.message ?? messages.unknownError}`
      return
    }
    signedIn = true
    document.querySelector('#signin-password').value = ''
    render({ phase: 'starting' })
  }
  signin.addEventListener('submit', (event) => { event.preventDefault(); void submitSignIn() })
  document.querySelector('#disable-plugins').addEventListener('click', () => { void recover(() => api.disablePlugins()) })
  document.querySelector('#reset-configuration').addEventListener('click', () => { void recover(() => api.resetConfiguration()) })
  document.querySelector('#restart').addEventListener('click', () => { void recover(() => api.restart()) })
}

void main()
