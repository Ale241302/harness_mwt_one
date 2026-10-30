/**
 * Web-only sidebar sign-out action. Desktop owns its own sign-out through the
 * native menu, so the action stays absent there; the web shell has no other
 * account control and redirects through the gateway logout route.
 */
import type { ReactNode } from 'react'
import { FlIconLogOut } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import styles from './faberloom.module.css'

/** Props of the sidebar footer action: column state and localized copy. */
type SignOutProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'faberloom'>

/** Whether this renderer is the browser shell rather than the desktop app. */
function isWebShell(): boolean {
  return (window as Window & { readonly dshDesktop?: unknown }).dshDesktop === undefined
}

/**
 * Render the sidebar sign-out icon on the web shell; render nothing in Desktop.
 * @param props - sidebar column state and the panel translator.
 * @returns the icon button, or null inside the Desktop application.
 */
export function FaberloomSignOut({ wide, t }: SignOutProps): ReactNode {
  if (!isWebShell()) return null
  const label = t('session.signOut')
  return (
    <button
      type="button"
      className={styles.signOutButton}
      aria-label={label}
      title={label}
      onClick={() => { window.location.assign('/logout') }}
    >
      <FlIconLogOut size={wide ? 16 : 18} />
    </button>
  )
}
