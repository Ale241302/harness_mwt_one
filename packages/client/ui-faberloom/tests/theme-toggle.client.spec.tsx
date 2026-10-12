// @vitest-environment jsdom
/** ThemeToggle behavior: the resolved scheme picks the icon/label and the
 * opposite preference write, both sidebar widths render, accessible name and
 * tooltip carry the action. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { ThemeToggle } from '../src/client/theme-toggle.tsx'
import type { ThemeToggleComponentProps } from '../src/client/theme-toggle.tsx'
import { createThemeToggleStore } from '../src/client/theme-toggle.tsx'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.switchToLight': 'Switch to light',
  'theme.switchToDark': 'Switch to dark',
}

/** Empty global standard-kit hooks (the toggle reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<ThemeToggleComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: ThemeToggleComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount({ wide = true, colorScheme = 'light' as const }: { wide?: boolean; colorScheme?: 'light' | 'dark' } = {}) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createThemeToggleStore().create()
  store.actions.sync(colorScheme, 0)
  const setTheme = vi.fn()
  const props: ThemeToggleComponentProps = {
    wide,
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
  }
  render(<ThemeToggle {...props} />)
  return { store, setTheme }
}

describe('ThemeToggle', () => {
  it('renders the light scheme as the moon action with its label when wide', () => {
    mount()
    const button = screen.getByRole('button', { name: 'Switch to dark' })
    expect(button.textContent).toBe('Dark')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('renders the dark scheme as the sun action with its label when wide', () => {
    mount({ colorScheme: 'dark' })
    const button = screen.getByRole('button', { name: 'Switch to light' })
    expect(button.textContent).toBe('Light')
  })

  it('click writes the opposite of the resolved scheme; the render follows the store mirror', () => {
    const b = mount({ colorScheme: 'light' })
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark' }))
    expect(b.setTheme).toHaveBeenCalledWith('dark')
    // No store write yet: the action still offers dark.
    expect(screen.getByRole('button', { name: 'Switch to dark' })).toBeTruthy()
    act(() => { b.store.actions.sync('dark', 1) })
    expect(screen.getByRole('button', { name: 'Switch to light' }).textContent).toBe('Light')
  })

  it('drops the label in the rail and names the action through the tooltip on focus', () => {
    mount({ wide: false })
    const button = screen.getByRole('button', { name: 'Switch to dark' })
    expect(button.textContent).toBe('')
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { button.focus() })
    expect(screen.getByRole('tooltip').textContent).toBe('Switch to dark')
  })

  it('suppresses the wide tooltip because the label is already visible', () => {
    mount()
    act(() => { screen.getByRole('button', { name: 'Switch to dark' }).focus() })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
