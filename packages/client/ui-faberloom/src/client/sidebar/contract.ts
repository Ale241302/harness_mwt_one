/**
 * Local contract for the FaberLoom sidebar shell.
 *
 * The shell is package-local: it occupies the layout's `sidebar` slot and
 * declares the same holes the host shell does, so other plugins' contributions
 * (brand, workspaces, settings, footer actions, global panels) land unchanged.
 * Only the declarations and their owner props are restated here.
 */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the layout-owned `sidebar` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Optional placement members a panellist registration may declare. */
export interface SidebarPanelPlacementOptions {
  /** Mode-bar tab this row belongs to. */
  mode?: () => string
  /** Accordion heading this row sits under. */
  group?: () => string
  /** Short count or status chip for the row itself. */
  badge?: () => string
}

/** Serializable metadata for one active global panel registration. */
export interface SidebarPanelMetadata {
  /** List id and matching main panel key. */
  id: MainPanelId
  /** Ascending row order; ties retain registration order. */
  order: number
  /** Row title and accessible name. */
  label: string
  /** Resolved mode-bar tab, or absent when the registration declared none. */
  mode?: string
  /** Resolved accordion heading inside the row's mode. */
  group?: string
  /** Resolved short chip text for the row. */
  badge?: string
}

/** Owner share of the browsing region. */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion. */
  expandSidebar: () => void
}

/** Registrant-private injected share. */
export interface SidebarRootInjected {
  /** Start a New Session, optionally in a named workspace. */
  startSession: (workspaceId?: string) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Select the global panel addressed by a sidebar row. */
  selectPanel: (id: MainPanelId) => void
  /** Private reactive sources bound to framework selector hooks. */
  hooks: { panels: ObservableSnapshot<readonly SidebarPanelMetadata[]> }
}

/** Full component props: layout owner state, the declared holes, and this shell's own copy. */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.panellist'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
  >
  & InjectFace<SidebarRootInjected>
  & PropsLocale<'faberloom'>
