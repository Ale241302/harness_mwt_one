// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarPanelIconOwnerProps, SidebarPanelMetadata,
  SidebarRootComponentProps, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key =>
  (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SidebarRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

/**
 * One published panel row.
 * @param panelId - list id and accessible-name fallback.
 * @param label - row title.
 * @param order - row order.
 * @param placement - optional mode, group, and badge.
 * @returns the metadata record the shell consumes.
 */
function panel(
  panelId: string,
  label: string,
  order: number,
  placement: { mode?: string; group?: string; badge?: string } = {},
): SidebarPanelMetadata {
  return {
    id: panelId as MainPanelId,
    order,
    label,
    ...(placement.mode === undefined ? {} : { mode: placement.mode }),
    ...(placement.group === undefined ? {} : { group: placement.group }),
    ...(placement.badge === undefined ? {} : { badge: placement.badge }),
  }
}

/** The accordion headings of one rendered panel list, in DOM order. */
const headings = (nav: HTMLElement): HTMLElement[] =>
  [...nav.querySelectorAll<HTMLElement>('button[aria-expanded]')]

function mountShell({
  collapsed = false,
  width = 300,
  panels = [],
  activePanelId = null,
}: {
  collapsed?: boolean
  width?: number
  panels?: readonly SidebarPanelMetadata[]
  activePanelId?: MainPanelId | null
} = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width, activePanelId }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={selector => selector({ activePanelId: current.activePanelId })} selectPanel={() => {}}
      usePanels={selector => selector(panels)}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: unknown,
        options?: { only?: string },
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.panellist') {
          const glyph = owner as SidebarPanelIconOwnerProps
          return <span data-testid={`glyph-${options?.only ?? ''}`} data-active={glyph.active} />
        }
        if (key === 'sidebar.settings') {
          settingsOwner = owner as SidebarSettingsOwnerProps
          return <div data-testid="settings-seat" data-wide={settingsOwner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner as SidebarFooterActionOwnerProps
          return <div data-testid="footer-action-seat" data-wide={footerActionOwner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={regionOwner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('routes New Session (capsule + wordmark) and the column toggle', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session.
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders generic brand fallbacks when no package fills the slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    const { container } = render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('Faberloom')).toBeTruthy()
    expect(screen.getByText('1.2.3-rc.4-0123456-dirty')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it.each([
    [{ DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3'],
    [{ DSH_CLIENT_COMMIT_HASH: 'abcdef0', DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3-abcdef0'],
  ])('omits unavailable build-version suffixes from %j', (environment, expected) => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
    render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('Faberloom')).toBeTruthy()
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('retains the local-build fallback without complete build metadata', () => {
    render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('Faberloom')).toBeTruthy()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('keeps the footer action seat and the settings seat as siblings in the foot', () => {
    const b = mountShell()
    const action = screen.getByTestId('footer-action-seat')
    const settings = screen.getByTestId('settings-seat')
    // Both seats sit in one foot container, in DOM order [actions][settings];
    // the foot CSS reverses the row axis so Settings renders first with the
    // action beside it.
    expect(action.parentElement?.parentElement).toBe(settings.parentElement?.parentElement)
    expect(action.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    b.rerender({ collapsed: true })
    expect(screen.getByTestId('footer-action-seat')).toBeTruthy()
    expect(screen.getByTestId('settings-seat')).toBeTruthy()
  })
})

describe('SidebarRoot panel placement', () => {
  const placed = [
    panel('board', 'Board', 10, { mode: 'operate', group: 'Workspace', badge: '2' }),
    panel('inbox', 'Inbox', 20, { mode: 'operate', group: 'Workspace' }),
    panel('routing', 'Routing', 30, { mode: 'admin', group: 'Tenant' }),
    panel('guide', 'Guide', 40, { mode: 'learn', group: 'Teachings' }),
  ]
  const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Global panels' })

  it('renders the flat list when no row declares placement', () => {
    mountShell({ panels: [panel('board', 'Board', 10), panel('inbox', 'Inbox', 20)] })
    const list = nav()
    const rows = within(list).getAllByRole('button')
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Board', 'Inbox'])
    expect(rows.every(row => !row.hasAttribute('aria-pressed'))).toBe(true)
    expect(headings(list)).toEqual([])
  })

  it('switches modes through the bar and groups the active mode under counted headings', () => {
    mountShell({ panels: placed })
    const list = nav()
    // One icon-only button per mode, the displayed one pressed; the mode value
    // is the button's accessible name.
    expect(within(list).getByRole('button', { name: 'operate' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(list).getByRole('button', { name: 'admin' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(list).getByRole('button', { name: 'learn' }).getAttribute('aria-pressed')).toBe('false')
    // Only the active mode's rows render, under a heading carrying the group count.
    const workspace = headings(list)[0]!
    expect(workspace.getAttribute('aria-expanded')).toBe('true')
    expect(within(workspace).getByText('Workspace')).toBeTruthy()
    expect(within(workspace).getByText('2')).toBeTruthy()
    expect(headings(list)).toHaveLength(1)
    expect(within(list).getByRole('button', { name: 'Board' }).textContent).toBe('Board2')
    expect(within(list).queryByRole('button', { name: 'Routing' })).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: 'learn' }))
    expect(within(list).getByRole('button', { name: 'learn' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(list).getByRole('button', { name: 'operate' }).getAttribute('aria-pressed')).toBe('false')
    expect(within(list).queryByRole('button', { name: 'Board' })).toBeNull()
    expect(within(list).getByRole('button', { name: 'Guide' }).textContent).toBe('Guide')
    expect(within(headings(list)[0]!).getByText('Teachings')).toBeTruthy()
  })

  it('toggles a heading and hides the rows it holds', () => {
    mountShell({ panels: placed })
    const list = nav()
    const workspace = (): HTMLElement => headings(list)[0]!
    expect(workspace().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(workspace())
    expect(workspace().getAttribute('aria-expanded')).toBe('false')
    expect(within(list).queryByRole('button', { name: 'Board' })).toBeNull()
    fireEvent.click(workspace())
    expect(workspace().getAttribute('aria-expanded')).toBe('true')
    expect(within(list).getByRole('button', { name: 'Board' })).toBeTruthy()
  })

  it('auto-expands the group holding the selected panel', () => {
    const b = mountShell({ panels: placed })
    const list = nav()
    fireEvent.click(headings(list)[0]!)
    expect(within(list).queryByRole('button', { name: 'Board' })).toBeNull()

    b.rerender({ activePanelId: 'board' as MainPanelId })
    expect(headings(list)[0]?.getAttribute('aria-expanded')).toBe('true')
    expect(within(list).getByRole('button', { name: 'Board' }).getAttribute('aria-current')).toBe('page')
  })

  it('keeps rows that declare no mode visible beside the mode bar', () => {
    mountShell({
      panels: [
        panel('pinned', 'Pinned', 0),
        panel('board', 'Board', 10, { mode: 'operate', group: 'Workspace' }),
        panel('routing', 'Routing', 20, { mode: 'admin', group: 'Tenant' }),
      ],
    })
    const list = nav()
    expect(within(list).getByRole('button', { name: 'operate' })).toBeTruthy()
    expect(within(list).getByRole('button', { name: 'Pinned' })).toBeTruthy()
    expect(within(list).getByRole('button', { name: 'Board' })).toBeTruthy()
    expect(within(list).queryByRole('button', { name: 'Routing' })).toBeNull()
  })

  it('renders the mode bar and the rows as icons only in the rail', () => {
    mountShell({ collapsed: true, panels: placed })
    const list = nav()
    expect(within(list).getByRole('button', { name: 'operate' }).getAttribute('aria-pressed')).toBe('true')
    // No headings in the rail, and the active mode's rows keep their glyph and
    // accessible name alone: neither the title nor the badge has room there.
    expect(headings(list)).toEqual([])
    const board = within(list).getByRole('button', { name: 'Board' })
    expect(board.textContent).toBe('')
    expect(within(board).getByTestId('glyph-board')).toBeTruthy()
    expect(within(list).queryByText('2')).toBeNull()
  })
})
