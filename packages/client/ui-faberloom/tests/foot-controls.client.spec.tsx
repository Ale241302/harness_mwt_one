// @vitest-environment jsdom
/**
 * Foot preference controls: the palette menu lists the registered themes
 * grouped by scheme with the active one checked and writes the chosen
 * preference; the language menu lists the registered locales and writes the
 * chosen language. Both name themselves in the rail and keep their label wide.
 */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LanguageMenu, ThemeMenu, createFootLocaleStore, createFootThemeStore } from '../src/client/foot-controls.tsx'
import type { FootThemeState, LanguageMenuProps, ThemeMenuProps } from '../src/client/foot-controls.tsx'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'theme.menu': 'Theme',
  'theme.followSystem': 'Follow the system',
  'theme.darkGroup': 'Dark',
  'theme.lightGroup': 'Light',
  'language.menu': 'Language',
}

/** Palette grounds, accents and names, as the registered definitions carry them. */
const THEMES: FootThemeState['themes'] = [
  { id: 'light', name: 'Paper', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': '#EDE8DF', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#C96442' } },
  { id: 'dark', name: 'Faber Warm', colorScheme: 'dark', tokens: { '--dsw-alias-bg-base': '#1B1A17', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#CD6B4A' } },
  { id: 'slate', name: 'Slate', colorScheme: 'dark', tokens: { '--dsw-alias-bg-base': '#16181B', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#CD6B4A' } },
  { id: 'mono', name: 'Ink', colorScheme: 'dark', tokens: { '--dsw-alias-bg-base': '#0E0D0C', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#D6724E' } },
  { id: 'cloud', name: 'Bond', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': '#F4F1ED', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#C96442' } },
]

const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'zh', label: '中文' },
]

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** Empty global standard-kit hooks (the foot controls read none of them). */
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

type AttentionSnapshot = Parameters<Parameters<ThemeMenuProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: ThemeMenuProps['useSessionPendingInteraction'] = selector => selector(noAttention)

/** Props shared by both controls in these specs. */
function shared() {
  return {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    t: (key: string) => COPY[key] ?? key,
  }
}

function mountTheme({ wide = true, preference = 'dark', activeId = 'dark' }: { wide?: boolean; preference?: string; activeId?: string } = {}) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createFootThemeStore().create()
  store.actions.sync({ preference, activeId, themes: THEMES }, 0)
  const setTheme = vi.fn()
  const props: ThemeMenuProps = {
    ...shared(), wide, useStore: bindSnapshotSelector(store), actions: store.actions, setTheme,
  }
  render(<ThemeMenu {...props} />)
  return { store, setTheme }
}

function mountLanguage({ wide = true, id = 'es' } = {}) {
  const store = createFootLocaleStore().create()
  store.actions.sync({ id, locales: LOCALES }, 0)
  const setLocale = vi.fn()
  const props: LanguageMenuProps = {
    ...shared(), wide, useStore: bindSnapshotSelector(store), actions: store.actions, setLocale,
  }
  render(<LanguageMenu {...props} />)
  return { store, setLocale }
}

describe('ThemeMenu', () => {
  it('names the active palette on the trigger and paints its own ground', () => {
    mountTheme()
    const button = screen.getByRole('button', { name: 'Theme' })
    expect(button.textContent).toBe('Faber Warm')
    expect(button.querySelector('span')?.getAttribute('style')).toContain('rgb(27, 26, 23)')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('falls back to the id for a theme that carries no name', () => {
    const store = createFootThemeStore().create()
    store.actions.sync({
      preference: 'aurora',
      activeId: 'aurora',
      themes: [
        ...THEMES,
        {
          id: 'aurora',
          colorScheme: 'dark',
          tokens: { '--dsw-alias-bg-base': '#101018', '--dsw-alias-brand-primary-new-colorprimary-new-color': '#CD6B4A' },
        },
      ],
    }, 0)
    render(<ThemeMenu {...shared()} wide useStore={bindSnapshotSelector(store)} actions={store.actions} setTheme={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('aurora')
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menuitem', { name: 'aurora' })).toBeTruthy()
  })

  it('lists follow-the-system first, then the palettes under a heading per scheme', () => {
    mountTheme()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    const rows = screen.getAllByRole('menuitem').map(row => row.textContent)
    expect(rows[0]).toBe('Follow the system')
    expect(rows.slice(1)).toEqual(['Faber Warm', 'Slate', 'Ink', 'Paper', 'Bond'])
    expect(screen.getByText('Dark')).toBeTruthy()
    expect(screen.getByText('Light')).toBeTruthy()
  })

  it('checks the active palette only, and the follow-the-system row while that is the preference', () => {
    mountTheme()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menuitem', { name: 'Faber Warm' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Slate' }).querySelector('svg')).toBeNull()
    cleanup()
    mountTheme({ preference: 'system' })
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('Follow the system')
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    expect(screen.getByRole('menuitem', { name: 'Follow the system' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Faber Warm' }).querySelector('svg')).toBeNull()
  })

  it('writes the chosen palette and the system preference through the injected face', () => {
    const m = mountTheme()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Slate' }))
    expect(m.setTheme).toHaveBeenCalledWith('slate')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Follow the system' }))
    expect(m.setTheme).toHaveBeenCalledWith('system')
  })

  it('follows the store mirror: a late palette change renames the trigger', () => {
    const m = mountTheme()
    act(() => { m.store.actions.sync({ preference: 'cloud', activeId: 'cloud', themes: THEMES }, 1) })
    expect(screen.getByRole('button', { name: 'Theme' }).textContent).toBe('Bond')
  })

  it('drops the label in the rail and names the control through the tooltip on focus', () => {
    mountTheme({ wide: false })
    const button = screen.getByRole('button', { name: 'Theme' })
    expect(button.textContent).toBe('')
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { button.focus() })
    expect(screen.getByRole('tooltip').textContent).toBe('Theme')
  })
})

describe('LanguageMenu', () => {
  it('names the active language when wide and its code in the rail', () => {
    mountLanguage()
    expect(screen.getByRole('button', { name: 'Language' }).textContent).toBe('Español')
    cleanup()
    mountLanguage({ wide: false })
    expect(screen.getByRole('button', { name: 'Language' }).textContent).toBe('ES')
  })

  it('lists the registered locales, checks the active one and writes the choice', () => {
    const m = mountLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Language' }))
    expect(screen.getAllByRole('menuitem').map(row => row.textContent)).toEqual(['English', 'Español', '中文'])
    expect(screen.getByRole('menuitem', { name: 'Español' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'English' }).querySelector('svg')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '中文' }))
    expect(m.setLocale).toHaveBeenCalledWith('zh')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders no rows before the first sync carries the catalog', () => {
    const store = createFootLocaleStore().create()
    const props: LanguageMenuProps = {
      ...shared(), wide: true, useStore: bindSnapshotSelector(store), actions: store.actions, setLocale: vi.fn(),
    }
    render(<LanguageMenu {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Language' }))
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })
})
