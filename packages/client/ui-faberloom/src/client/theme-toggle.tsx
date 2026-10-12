/**
 * The theme control of the sidebar foot: the theme feature's second surface,
 * registered by this package because the foot's action seat — declared by
 * ui-sidebar — sits outside ui-theme's reference closure (ui-sidebar reaches
 * ui-layout, which reaches ui-theme), while this product plugin already depends
 * on both. The write goes through the `theme` service, the same preference path
 * the Appearance row uses, so the two surfaces stay one setting.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { IconDarkOutline16, IconLightOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { FaberloomKey } from './locales.ts'
import css from './theme-toggle.module.css'

/** Store state mirrored from the theme snapshot's resolved color scheme. */
export interface ThemeToggleState {
  /** Resolved active scheme; a `system` preference is already resolved via prefers-color-scheme. */
  colorScheme: 'light' | 'dark'
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type ThemeToggleActions = {
  /** Publish the service's resolved scheme at its revision. */
  sync: (draft: ThemeToggleState, colorScheme: 'light' | 'dark', revision: number) => void
}

/**
 * Declares the sidebar-foot toggle state and sync surface.
 * @returns the store handle declared by the footer-action registration.
 */
export function createThemeToggleStore(): EngineStoreHandle<ThemeToggleState, ThemeToggleActions> {
  return defineStore({
    init: (): ThemeToggleState => ({ colorScheme: 'light', revision: -1 }),
    actions: {
      sync: (d, colorScheme, revision) => {
        if (revision <= d.revision) return
        d.colorScheme = colorScheme
        d.revision = revision
      },
    },
  })
}

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface ThemeToggleInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ThemeToggleComponentProps =
  PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createThemeToggleStore>>
  & PropsLocale<'faberloom'> & ThemeToggleInjected

/**
 * Render the sidebar-foot theme toggle: one button that switches to the
 * opposite of the resolved scheme (sun while dark, moon while light). The
 * presentation follows the Settings trigger — icon plus label when the column
 * is wide, icon only in the 56px rail.
 * @param props - composed slot props.
 * @returns the toggle button element.
 */
export function ThemeToggle({ wide, t, setTheme, useStore }: ThemeToggleComponentProps) {
  const colorScheme = useStore(s => s.colorScheme)
  const next: ThemePreference = colorScheme === 'dark' ? 'light' : 'dark'
  const actionKey: FaberloomKey = colorScheme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark'
  const labelKey: FaberloomKey = colorScheme === 'dark' ? 'theme.light' : 'theme.dark'
  const Icon = colorScheme === 'dark' ? IconLightOutline16 : IconDarkOutline16
  const action = t(actionKey)
  return (
    <Tooltip label={action} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={wide ? css.toggle : `${css.toggle} ${css.rail}`}
        aria-label={action}
        onClick={() => { setTheme(next) }}
      >
        <Icon size={wide ? 16 : 18} />
        {wide && <span className={css.label}>{t(labelKey)}</span>}
      </button>
    </Tooltip>
  )
}
