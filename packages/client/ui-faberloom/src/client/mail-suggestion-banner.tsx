/**
 * The floating conversation's mail-to-Space card. It offers the Space the Host
 * matches for the open mail once the conversation has enough turns to know the
 * mail, and attaches the mail and the live session when the owner accepts.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FlIconSpaceloom } from './ui/faberloom-icons.tsx'
import type { MailSuggestionPayload } from './panels.tsx'
import css from './mail-suggestion-banner.module.css'

/** localStorage key the Email panel writes before opening the float. */
const SUGGESTION_KEY = 'faberloom.mail.suggestion'

/** How often the card asks whether the mail has a Space now. */
const POLL_MS = 5_000

/** Read the last published mail, or null. */
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

/** One Space the Host matched for the open mail. */
export interface MailSpaceOffer {
  /** Space identity the mail is attached to. */
  readonly spaceId: string
  /** Title the card shows, already carrying the parent when it is a sub-space. */
  readonly spaceName: string
}

/** Props the banner receives from its register call. */
export type MailSuggestionBannerProps = PropsLocale<'faberloom'> & {
  /** Attach the mail and its session to the suggested Space. */
  readonly attach: (input: MailSuggestionPayload) => void
  /** Read the Space the mail belongs to, or null while none applies. */
  readonly suggest: (input: MailSuggestionPayload) => Promise<MailSpaceOffer | null>
}

/** The card itself. */
export function MailSuggestionBanner({ t, attach, suggest }: MailSuggestionBannerProps) {
  const [payload, setPayload] = useState<MailSuggestionPayload | null>(() => readSuggestion())
  const [offer, setOffer] = useState<MailSpaceOffer | null>(null)

  useEffect(() => {
    const refresh = (): void => { setPayload(readSuggestion()) }
    window.addEventListener('faberloom:mail-suggestion', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('faberloom:mail-suggestion', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  // The offer waits for the conversation to know the mail: a mail that has no
  // Space yet shows nothing, instead of claiming one right after it opens.
  useEffect(() => {
    if (payload === null) { setOffer(null); return }
    let live = true
    let timer: number | undefined
    const check = async (): Promise<void> => {
      const found = await suggest(payload).catch(() => null)
      if (!live) return
      if (found !== null) { setOffer(found); return }
      timer = window.setTimeout(() => { void check() }, POLL_MS)
    }
    void check()
    return () => {
      live = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [payload, suggest])

  if (payload === null || offer === null) return null
  const dismiss = (): void => {
    try {
      localStorage.removeItem(SUGGESTION_KEY)
    } catch {
      // A blocked storage still hides the card for this mount.
    }
    setPayload(null)
    setOffer(null)
  }

  return (
    <section className={css.banner} aria-label={t('email.suggestion.label')}>
      <span className={css.icon} aria-hidden="true"><FlIconSpaceloom size={16} /></span>
      <span className={css.bodyMessage}>
        <span className={css.title}>
          {t('email.suggestion.spaceTitle', { space: offer.spaceName })}
        </span>
        <span className={css.text}>{t('email.suggestion.spaceText')}</span>
      </span>
      <span className={css.actions}>
        <button className={css.primary} type="button"
          onClick={() => { attach({ ...payload, spaceId: offer.spaceId, spaceName: offer.spaceName }) }}>
          {t('email.suggestion.add')}
        </button>
        <button className={css.dismiss} type="button" aria-label={t('action.close')} onClick={dismiss}>×</button>
      </span>
    </section>
  )
}
