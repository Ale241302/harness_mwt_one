/**
 * Appearance preference list registered into the General section item slot:
 * title + the registered palettes grouped by color-scheme family (dark first),
 * each row previewing the palette's own colors and marking the one in effect.
 * A `system` preference has no row here — it resolves to a palette, and that
 * palette is the one marked. Selection follows the resolved active palette.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import type { ThemeKey } from './locales.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the palette write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference to a registered palette id. */
  setTheme: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Palette families in display order; the brand groups dark before light. */
const FAMILIES: readonly { scheme: 'light' | 'dark'; heading: ThemeKey }[] = [
  { scheme: 'dark', heading: 'appearance.dark' },
  { scheme: 'light', heading: 'appearance.light' },
]

/** Alias tokens the row swatch reads from the palette's own override map. */
const SWATCH_GROUND = '--dsw-alias-bg-base'
/** Accent token the row swatch dot reads. */
const SWATCH_ACCENT = '--dsw-alias-brand-primary'

/** No-color fallback for a theme whose definition omitted the swatch tokens. */
const NO_COLOR = 'transparent'

/**
 * Render the Appearance list.
 * @param props - composed slot props.
 * @returns the list element tree.
 */
export function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps) {
  const themes = useStore(s => s.themes)
  const active = useStore(s => s.active)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      {FAMILIES.map(({ scheme, heading }) => (
        <div key={scheme} className={css.family}>
          <div className={css.familyHeading}>{t(heading)}</div>
          <div className={css.paletteList}>
            {themes.filter(palette => palette.colorScheme === scheme).map(palette => (
              <button
                key={palette.id}
                type="button"
                className={clsx(css.palette, active === palette.id && css.selected)}
                aria-pressed={active === palette.id}
                onClick={() => { setTheme(palette.id) }}
              >
                <span
                  className={css.swatch}
                  style={{ background: palette.tokens[SWATCH_GROUND] ?? NO_COLOR }}
                  aria-hidden="true"
                >
                  <span className={css.swatchAccent} style={{ background: palette.tokens[SWATCH_ACCENT] ?? NO_COLOR }} />
                </span>
                <span className={css.paletteName}>{palette.name ?? palette.id}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
