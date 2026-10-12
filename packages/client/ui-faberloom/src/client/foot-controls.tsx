/**
 * The two preference controls of the sidebar foot: the palette menu — the theme
 * feature's second surface — and the interface-language menu.
 *
 * They register from this package because the foot's action seat, declared by
 * ui-sidebar, sits outside ui-theme's reference closure (ui-sidebar reaches
 * ui-layout, which reaches ui-theme), while this plugin already depends on both.
 * Each control writes through its own service — `theme` and `locale` — the same
 * path the settings rows use, so a surface and its row stay one setting.
 *
 * Both menus list what the services actually hold: the registered themes (with
 * the alias tokens their swatch reads) and the registered locales. A theme or a
 * language pack another package adds therefore shows up here untouched.
 */
import { useState, type ReactNode } from 'react'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { Menu, Tooltip, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberloomKey } from './locales.ts'
import { languageFlag } from './flags.tsx'
import css from './foot-controls.module.css'

/** Theme facts the palette menu renders. */
export interface FootThemeState {
  /**
   * Persisted or in-session preference. The built-in palette ids and `system`
   * are durable; a theme another plugin registered is selectable in the session
   * without a durable value, which is why this mirrors the service as a string.
   */
  preference: string
  /** Resolved theme id; a `system` preference resolves to a registered theme. */
  activeId: string
  /** Registered themes in registry order, with the tokens their swatch reads. */
  themes: readonly {
    readonly id: string
    readonly name?: string
    readonly colorScheme: 'light' | 'dark'
    readonly tokens: Readonly<Record<string, string>>
  }[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FootThemeActions = {
  /** Publish the theme service snapshot at its revision. */
  sync: (draft: FootThemeState, snapshot: Omit<FootThemeState, 'revision'>, revision: number) => void
}

/**
 * Declares the palette menu's mirrored theme state.
 * @returns the store handle declared by the footer-action registration.
 */
export function createFootThemeStore(): EngineStoreHandle<FootThemeState, FootThemeActions> {
  return defineStore({
    init: (): FootThemeState => ({ preference: 'system', activeId: 'light', themes: [], revision: -1 }),
    actions: {
      sync: (d, snapshot, revision) => {
        if (revision <= d.revision) return
        d.preference = snapshot.preference
        d.activeId = snapshot.activeId
        d.themes = snapshot.themes
        d.revision = revision
      },
    },
  })
}

/** Locale facts the language menu renders. */
export interface FootLocaleState {
  /** Active locale id. */
  id: string
  /** Registered locales in catalog order. */
  locales: readonly { readonly id: string; readonly label: string }[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FootLocaleActions = {
  /** Publish the locale service snapshot at its revision. */
  sync: (draft: FootLocaleState, snapshot: Omit<FootLocaleState, 'revision'>, revision: number) => void
}

/**
 * Declares the language menu's mirrored locale state.
 * @returns the store handle declared by the footer-action registration.
 */
export function createFootLocaleStore(): EngineStoreHandle<FootLocaleState, FootLocaleActions> {
  return defineStore({
    init: (): FootLocaleState => ({ id: 'en', locales: [], revision: -1 }),
    actions: {
      sync: (d, snapshot, revision) => {
        if (revision <= d.revision) return
        d.id = snapshot.id
        d.locales = snapshot.locales
        d.revision = revision
      },
    },
  })
}

/** Injected business faces for the two controls. */
export interface FootControlsInjected {
  /**
   * Switch the theme preference: `system`, a built-in palette id, or the id of
   * any other theme in the registry. The service rejects an unknown id.
   */
  setTheme: (id: string) => void
  /** Switch the interface language. */
  setLocale: (id: string) => void
}

/** Full palette-menu props: runtime share, theme store share, locale seat, injected write. */
export type ThemeMenuProps =
  PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createFootThemeStore>>
  & PropsLocale<'faberloom'> & Pick<FootControlsInjected, 'setTheme'>

/** Full language-menu props: runtime share, locale store share, locale seat, injected write. */
export type LanguageMenuProps =
  PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createFootLocaleStore>>
  & PropsLocale<'faberloom'> & Pick<FootControlsInjected, 'setLocale'>

/** No-color fallback for a theme whose definition omitted the swatch tokens. */
const NO_COLOR = 'transparent'

/**
 * One palette row carrying the theme's own colors, so the menu previews the
 * palette instead of describing it. The values are data from the registered
 * definition, never a literal in this package.
 * @param theme - the registered theme.
 * @returns the row's leading swatch, drawn over the palette's ground.
 */
function PaletteSwatch({ theme }: { theme: FootThemeState['themes'][number] }) {
  return (
    <span
      className={css.swatch}
      style={{ background: theme.tokens['--dsw-alias-bg-base'] ?? NO_COLOR }}
      aria-hidden="true"
    >
      <span
        className={css.swatchAccent}
        style={{ background: theme.tokens['--dsw-alias-brand-primary-new-colorprimary-new-color'] ?? NO_COLOR }}
      />
    </span>
  )
}

/**
 * Build the palette menu rows: follow-the-system first, then the registered
 * palettes under a heading per color scheme.
 * @param t - dictionary seat of the owning namespace.
 * @param themes - registered themes in registry order.
 * @param paletteSwatch - leading icon for one theme.
 * @returns the menu rows, headings included.
 */
function themeEntries(
  t: (key: FaberloomKey) => string,
  themes: FootThemeState['themes'],
  paletteSwatch: (theme: FootThemeState['themes'][number]) => ReactNode,
): MenuEntry[] {
  const of = (scheme: 'light' | 'dark'): MenuEntry[] => themes
    .filter(theme => theme.colorScheme === scheme)
    .map(theme => ({ id: theme.id, label: theme.name ?? theme.id, icon: paletteSwatch(theme) }))
  const dark = of('dark')
  const light = of('light')
  return [
    { id: 'system', label: t('theme.followSystem') },
    ...(dark.length === 0 ? [] : [{ type: 'label' as const, id: 'palette-dark', text: t('theme.darkGroup') }, ...dark]),
    ...(light.length === 0 ? [] : [{ type: 'label' as const, id: 'palette-light', text: t('theme.lightGroup') }, ...light]),
  ]
}

/**
 * Render the palette menu: a swatch trigger that opens the registered palettes
 * grouped by color scheme, with follow-the-system above them. The trigger names
 * the active palette when the column is wide and shows only its swatch in the
 * 56px rail.
 * @param props - composed slot props.
 * @returns the menu, anchored to its trigger.
 */
export function ThemeMenu({ wide, t, setTheme, useStore }: ThemeMenuProps) {
  const state = useStore(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const active = state.themes.find(theme => theme.id === state.activeId)
  const label = state.preference === 'system'
    ? t('theme.followSystem')
    : active?.name ?? state.activeId
  return (
    <Menu
      open={open}
      side="top"
      autoFocus
      items={themeEntries(t, state.themes, theme => <PaletteSwatch theme={theme} />)}
      selectedId={state.preference === 'system' ? 'system' : state.activeId}
      onSelect={(id) => {
        setOpen(false)
        setTheme(id)
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <Tooltip label={t('theme.menu')} side="top" delayMs={500} disabled={wide}>
          <button
            type="button"
            className={wide ? css.control : `${css.control} ${css.rail}`}
            aria-label={t('theme.menu')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(true) }}
          >
            {active === undefined
              ? <span className={css.swatch} aria-hidden="true" />
              : <PaletteSwatch theme={active} />}
            {wide && <span className={css.label}>{label}</span>}
          </button>
        </Tooltip>
      )}
    />
  )
}

/**
 * Render the language menu: the active language in the trigger, every
 * registered locale in the list. The rail shows the locale's own code, which is
 * data rather than copy, so no dictionary entry is needed for it.
 * @param props - composed slot props.
 * @returns the menu, anchored to its trigger.
 */
export function LanguageMenu({ wide, t, setLocale, useStore }: LanguageMenuProps) {
  const state = useStore(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const active = state.locales.find(locale => locale.id === state.id)
  return (
    <Menu
      open={open}
      side="top"
      autoFocus
      items={state.locales.map(locale => ({ id: locale.id, label: locale.label, icon: languageFlag(locale.id) }))}
      selectedId={state.id}
      onSelect={(id) => {
        setOpen(false)
        setLocale(id)
      }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <Tooltip label={t('language.menu')} side="top" delayMs={500} disabled={wide}>
          <button
            type="button"
            className={wide ? css.control : `${css.control} ${css.rail}`}
            aria-label={t('language.menu')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(true) }}
          >
            <span className={css.localeCode} aria-hidden="true">{wide ? '' : state.id.toUpperCase()}</span>
            {wide && <span className={css.label}>{active?.label ?? t('language.menu')}</span>}
          </button>
        </Tooltip>
      )}
    />
  )
}
