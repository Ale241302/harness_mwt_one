// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore, type AppearancePalette } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.dark': 'Dark',
  'appearance.light': 'Light',
}

const GROUND = '--dsw-alias-bg-base'
const ACCENT = '--dsw-alias-brand-primary'

/** The five built-in palettes in registry order (light, dark, slate, mono, cloud). */
const PALETTES: readonly AppearancePalette[] = [
  { id: 'light', name: 'Paper', colorScheme: 'light', tokens: { [GROUND]: '#EDE8DF', [ACCENT]: '#C96442' } },
  { id: 'dark', name: 'Faber Warm', colorScheme: 'dark', tokens: { [GROUND]: '#1B1A17', [ACCENT]: '#CD6B4A' } },
  { id: 'slate', name: 'Slate', colorScheme: 'dark', tokens: { [GROUND]: '#16181B', [ACCENT]: '#CD6B4A' } },
  { id: 'mono', name: 'Ink', colorScheme: 'dark', tokens: { [GROUND]: '#0E0D0C', [ACCENT]: '#D6724E' } },
  { id: 'cloud', name: 'Bond', colorScheme: 'light', tokens: { [GROUND]: '#F4F1ED', [ACCENT]: '#C96442' } },
]

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

type AttentionSnapshot = Parameters<Parameters<AppearanceRowComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AppearanceRowComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(active = 'dark', themes: readonly AppearancePalette[] = PALETTES) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(themes, active, 0)
  const setTheme = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme }
}

const pressed = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

const swatchOf = (name: string): HTMLElement =>
  screen.getByRole('button', { name }).querySelector('span') as HTMLElement

describe('AppearanceRow', () => {
  it('renders the palettes in the two families, dark first, with the active one marked', () => {
    mount('dark')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(screen.getByText('Dark')).toBeDefined()
    expect(screen.getByText('Light')).toBeDefined()
    expect(screen.getAllByRole('button').map(button => button.textContent))
      .toEqual(['Faber Warm', 'Slate', 'Ink', 'Paper', 'Bond'])
    expect(pressed('Faber Warm')).toBe('true')
    expect(pressed('Paper')).toBe('false')
  })

  it('previews each palette with its own ground and accent colours', () => {
    mount('dark')
    expect(swatchOf('Paper').style.background).toBeTruthy()
    expect(swatchOf('Paper').firstElementChild).not.toBeNull()
  })

  it('falls back to the id and a transparent swatch for a theme that omits name and tokens', () => {
    mount('third-party', [{ id: 'third-party', colorScheme: 'dark', tokens: {} }])
    expect(screen.getByRole('button', { name: 'third-party' })).toBeDefined()
    expect(swatchOf('third-party').style.background).toBe('transparent')
  })

  it('click drives setTheme; the mark follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Paper' }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: the mark is unchanged.
    expect(pressed('Faber Warm')).toBe('true')
    act(() => { b.store.actions.sync(PALETTES, 'light', 1) })
    expect(pressed('Paper')).toBe('true')
    expect(pressed('Faber Warm')).toBe('false')
  })
})
