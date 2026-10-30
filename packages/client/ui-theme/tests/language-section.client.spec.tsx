// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LanguageSection } from '../src/client/LanguageSection.tsx'
import type { LanguageSectionProps } from '../src/client/LanguageSection.tsx'
import { createLanguageSectionStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

/** Registered locales plus one a language pack could add without flag art. */
const OPTIONS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
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

type AttentionSnapshot = Parameters<Parameters<LanguageSectionProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: LanguageSectionProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(active = 'en') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createLanguageSectionStore().create()
  store.actions.sync(active, OPTIONS, 0)
  const setLocale = vi.fn()
  const props: LanguageSectionProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key === 'language.title' ? 'Interface language' : key,
    setLocale,
    close: () => {},
  }
  render(<LanguageSection {...props} />)
  return { store, setLocale }
}

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Interface language' })

describe('LanguageSection', () => {
  it('shows the active locale flag and a chevron, with no language name on the closed control', () => {
    mount('en')
    expect(screen.getByText('Interface language')).toBeDefined()
    const control = trigger()
    expect(control.getAttribute('aria-haspopup')).toBe('menu')
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(control.querySelector('[data-locale-flag="en"]')).not.toBeNull()
    // A flag (with its banner svg) plus the chevron, and no visible text.
    expect(control.querySelectorAll('svg')).toHaveLength(2)
    expect(control.textContent).toBe('')
  })

  it('lists every locale with its flag and its own name, with the active one marked', () => {
    mount('en')
    fireEvent.click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: '中文' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'English' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Français' })).toBeDefined()
    // en and zh carry a flag; the active row also carries the selection check.
    expect(screen.getByRole('menuitem', { name: 'English' }).querySelectorAll('svg')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: '中文' }).querySelectorAll('svg')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'English' }).querySelector('[data-locale-flag="en"]')).not.toBeNull()
  })

  it('renders a locale with no flag art without an icon', () => {
    mount('en')
    fireEvent.click(trigger())
    const row = screen.getByRole('menuitem', { name: 'Français' })
    expect(row.querySelectorAll('svg')).toHaveLength(0)
    cleanup()

    // The closed control degrades to the chevron alone for an unartworked active locale.
    mount('fr')
    const control = trigger()
    expect(control.querySelector('[data-locale-flag]')).toBeNull()
    expect(control.querySelectorAll('svg')).toHaveLength(1)
  })

  it('selects a locale and closes; an outside pointer closes without selecting', () => {
    const b = mount('en')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: '中文' }))
    expect(b.setLocale).toHaveBeenCalledWith('zh')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()

    fireEvent.click(trigger())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()
    expect(b.setLocale).toHaveBeenCalledTimes(1)
  })
})
