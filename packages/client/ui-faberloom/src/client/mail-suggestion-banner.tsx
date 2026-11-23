/**
 * The floating conversation's mail-to-Space card. It offers the Space the Host
 * matches for the open mail or draft once the conversation has enough turns to
 * know it, and attaches the conversation to that Space when the owner accepts.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { FlIconSpaceloom } from './ui/faberloom-icons.tsx'
import { draftSpaceEvidenceText, type DraftSuggestionPayload, type MailSuggestionPayload } from './panels.tsx'
import css from './mail-suggestion-banner.module.css'

/** localStorage key the Email panel writes before opening the float. */
const SUGGESTION_KEY = 'faberloom.mail.suggestion'

/** How often the card asks whether the mail has a Space now. */
const POLL_MS = 5_000

/** Either subject the floating card can carry. */
export type FloatSuggestionPayload = MailSuggestionPayload | DraftSuggestionPayload

/** Narrow the stored card data to the mail or draft form it carries. */
function isDraftPayload(value: unknown): value is DraftSuggestionPayload {
  return typeof value === 'object' && value !== null
    && (value as { kind?: unknown }).kind === 'draft'
    && typeof (value as { draftId?: unknown }).draftId === 'string'
}

/** Read the last published mail or draft, or null. */
function readSuggestion(): FloatSuggestionPayload | null {
  try {
    const raw = localStorage.getItem(SUGGESTION_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (isDraftPayload(value)) return value
    if (typeof value !== 'object' || value === null) return null
    const payload = value as { uid?: unknown }
    return typeof payload.uid === 'string' && payload.uid.length > 0
      ? value as MailSuggestionPayload
      : null
  } catch {
    return null
  }
}

/** One Space the Host matched for the open mail or draft. */
export interface MailSpaceOffer {
  /** Space identity the subject is attached to, or null while the Space does not exist yet. */
  readonly spaceId: string | null
  /** Title the card shows, already carrying the parent when it is a sub-space. */
  readonly spaceName: string
  /** Whether accepting creates the Space instead of linking an existing one. */
  readonly create: boolean
  /** Host evidence tokens explaining a draft match; empty for mail. */
  readonly evidence: readonly string[]
}

/** Props the banner receives from its register call. */
export type MailSuggestionBannerProps = PropsLocale<'faberloom'> & {
  /** Attach the subject and its session to the suggested Space. */
  readonly attach: (input: FloatSuggestionPayload) => void
  /** Read the Space the subject belongs to, or null while none applies. */
  readonly suggest: (input: FloatSuggestionPayload) => Promise<MailSpaceOffer | null>
}

/** Drop the published card so it does not reopen on the next mount. */
function clearSuggestion(): void {
  try {
    localStorage.removeItem(SUGGESTION_KEY)
  } catch {
    // A blocked storage only leaves the card data behind.
  }
  window.dispatchEvent(new Event('faberloom:mail-suggestion'))
}

/** The card itself. */
export function MailSuggestionBanner({ t, attach, suggest }: MailSuggestionBannerProps) {
  const [payload, setPayload] = useState<FloatSuggestionPayload | null>(() => readSuggestion())
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

  // The offer waits for the conversation to know the subject: a mail that has
  // no Space yet shows nothing, instead of claiming one right after it opens.
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
    clearSuggestion()
    setPayload(null)
    setOffer(null)
  }
  const draft = isDraftPayload(payload)
  const evidence = draft
    ? offer.evidence.flatMap((reason) => {
      const text = draftSpaceEvidenceText(reason, t)
      return text === null ? [] : [text]
    }).join(' · ')
    : ''
  const title = draft
    ? offer.create
      ? t('email.suggestion.createTitle', { space: offer.spaceName })
      : t('email.suggestion.draftTitle', { space: offer.spaceName })
    : t('email.suggestion.spaceTitle', { space: offer.spaceName })

  return (
    <section className={css.banner} aria-label={t('email.suggestion.label')}>
      <span className={css.icon} aria-hidden="true"><FlIconSpaceloom size={16} /></span>
      <span className={css.bodyMessage}>
        <span className={css.title}>{title}</span>
        <span className={css.text}>
          {draft
            ? offer.create ? t('email.suggestion.createText') : t('email.suggestion.draftText')
            : t('email.suggestion.spaceText')}
        </span>
        {evidence.length === 0 ? null : <span className={css.text}>{evidence}</span>}
      </span>
      <span className={css.actions}>
        <button className={css.primary} type="button"
          onClick={() => { attach(draft
            ? payload
            : { ...payload, spaceId: offer.spaceId, spaceName: offer.spaceName }) }}>
          {draft
            ? offer.create
              ? t('email.draftSpaceCreate', { space: offer.spaceName })
              : t('email.draftSpaceExisting', { space: offer.spaceName })
            : t('email.suggestion.add')}
        </button>
        <button className={css.dismiss} type="button" aria-label={t('action.close')} onClick={dismiss}>×</button>
      </span>
    </section>
  )
}
