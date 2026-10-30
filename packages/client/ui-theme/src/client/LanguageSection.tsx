/**
 * Idioma Settings section: the interface-language choice. The closed control
 * shows the active locale's flag and the chevron that opens the list, never the
 * language name as a bare label; each list row carries the locale's flag and
 * its own name, with the active one marked. Registered by this package, which
 * already reads the shared locale service.
 */
import { useState } from 'react'
import { IconChevronDownOutline14, LocaleFlag, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLanguageSectionStore } from './settings-store.ts'
import css from './LanguageSection.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface LanguageSectionInjected {
  /** Switch the active locale (a registered locale id). */
  setLocale: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type LanguageSectionProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createLanguageSectionStore>>
  & PropsLocale<'settings.theme'> & LanguageSectionInjected

/**
 * Render the Idioma section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function LanguageSection({ t, setLocale, useStore }: LanguageSectionProps) {
  const active = useStore(s => s.active)
  const options = useStore(s => s.options)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.row}>
      <div className={css.title}>{t('language.title')}</div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(option => ({
          id: option.id,
          label: option.label,
          icon: <LocaleFlag id={option.id} />,
        }))}
        selectedId={active}
        onSelect={(id) => {
          setLocale(id)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.picker}
            aria-label={t('language.title')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            <LocaleFlag id={active} />
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
