/**
 * The mail-to-Space card. It reads the suggestion the Email panel publishes,
 * offers to attach the mail (and the live session) to a Space, or to create one,
 * and downloads the mail as text when asked. It occupies the frame-wide overlay
 * layer, so it stays visible over whichever main panel is open.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the layout-owned `shell.overlay` declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { FlIconSpaceloom } from './ui/faberloom-icons.tsx'
import type { MailSuggestionPayload } from './panels.tsx'
import css from './mail-suggestion-banner.module.css'

/** localStorage key the Email panel writes before opening the float. */
const SUGGESTION_KEY = 'faberloom.mail.suggestion'

/** Read the last published suggestion, or null. */
function readSuggestion(): MailSuggestionPayload | null {
  try {
    const raw = localStorage.getItem(SUGGESTION_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as { uid?: unknown }
    return typeof payload.uid === 'string' && payload.uid.length > 0
      ? value as MailSuggestionPayload
      : null
  } catch {
    return null
  }
}

/** Props the banner receives from its register call. */
export type MailSuggestionBannerProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'faberloom'>
  & InjectFace<{
    /** Attach the mail and its session to the suggested Space. */
    readonly attach: (input: MailSuggestionPayload) => void
    /** Download the open mail as a text file. */
    readonly download: (input: MailSuggestionPayload) => void
  }>

/** The card itself. */
export function MailSuggestionBanner({ t, attach, download }: MailSuggestionBannerProps) {
  const [payload, setPayload] = useState<MailSuggestionPayload | null>(() => readSuggestion())

  useEffect(() => {
    const refresh = (): void => { setPayload(readSuggestion()) }
    window.addEventListener('faberloom:mail-suggestion', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('faberloom:mail-suggestion', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  if (payload === null) return null
  const name = (payload.spaceName ?? payload.subject ?? 'Correo').trim() || 'Correo'
  const matched = payload.spaceId !== null
  const dismiss = (): void => {
    try {
      localStorage.removeItem(SUGGESTION_KEY)
    } catch {
      // A blocked storage still hides the card for this mount.
    }
    setPayload(null)
  }

  return (
    <section data-faberloom="" className={css.banner} aria-label={t('email.suggestion.label')}>
      <span className={css.icon} aria-hidden="true"><FlIconSpaceloom size={16} /></span>
      <span className={css.bodyMessage}>
        <span className={css.title}>
          {matched
            ? t('email.suggestion.spaceTitle', { space: name })
            : t('email.suggestion.createTitle', { name })}
        </span>
        <span className={css.text}>
          {matched ? t('email.suggestion.spaceText') : t('email.suggestion.createText')}
        </span>
      </span>
      <span className={css.actions}>
        <button className={css.primary} type="button" onClick={() => { attach(payload) }}>
          {matched ? t('email.suggestion.add') : t('email.suggestion.create')}
        </button>
        <button className={css.secondary} type="button" onClick={() => { download(payload) }}>
          {t('email.suggestion.download')}
        </button>
        <button className={css.dismiss} type="button" aria-label={t('action.close')} onClick={dismiss}>×</button>
      </span>
    </section>
  )
}
