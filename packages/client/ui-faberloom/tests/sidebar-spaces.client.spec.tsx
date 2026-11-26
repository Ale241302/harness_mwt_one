// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { createWorkspaceStore, type WorkspaceState } from '../src/client/store.ts'
import { SpacesFallback } from '../src/client/sidebar/spaces.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

type SpacesProps = ComponentProps<typeof SpacesFallback>

/** One Space row as the overview carries it. */
function space(id: string, title: string, parentId: string | null = null, workspaceId: string | null = `ws-${id}`) {
  return { id, title, parentId, agentId: null, agentName: null, workspaceId, folderPath: `/${title}`, shared: false }
}

/** One live store instance seeded with the given Spaces and read state. */
function store(spaces: ReturnType<typeof space>[], status: WorkspaceState['status'] = 'ready') {
  const instance = createWorkspaceStore().create()
  if (status !== 'loading') {
    instance.actions.setOverview({
      spaces,
      agents: [],
      board: [],
      boardError: null,
      routines: [],
      memory: [],
      canWrite: true,
    })
    if (status === 'error') instance.actions.setError('boom')
  }
  return instance
}

/** Compose the component props around one live store instance. */
function props(instance: ReturnType<typeof store>, overrides: Partial<SpacesProps> = {}): SpacesProps {
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useStore: ((selector: (state: WorkspaceState) => unknown) => selector(instance.getSnapshot())) as never,
    load: vi.fn(),
    openSpace: vi.fn(),
    renderSlot: (() => null) as never,
    t,
    ...overrides,
  } as SpacesProps
}

describe('SpacesFallback', () => {
  it('draws the rail icon and asks for the wide column', () => {
    const expandSidebar = vi.fn()
    render(<SpacesFallback {...props(store([]), { wide: false, expandSidebar })} />)
    fireEvent.click(screen.getByRole('button', { name: '工作区' }))
    expect(expandSidebar).toHaveBeenCalledOnce()
  })

  it('reads the overview once while the store is still empty', () => {
    const load = vi.fn()
    render(<SpacesFallback {...props(store([], 'loading'), { load })} />)
    expect(load).toHaveBeenCalledOnce()
    // A loading store with no rows shows the header and nothing that reads as empty.
    expect(screen.queryByText('此计算机上没有工作区。')).toBeNull()
  })

  it('does not re-read once rows arrived', () => {
    const load = vi.fn()
    render(<SpacesFallback {...props(store([space('a', 'Alfa')]), { load })} />)
    expect(load).not.toHaveBeenCalled()
  })

  it('says so when the machine has no Spaces', () => {
    render(<SpacesFallback {...props(store([]))} />)
    expect(screen.getByText('此计算机上没有工作区。')).toBeTruthy()
  })

  it('nests sub-spaces under their parent and keeps an orphan reachable', () => {
    const openSpace = vi.fn()
    render(<SpacesFallback {...props(
      store([space('b', 'Beta', 'a'), space('a', 'Alfa'), space('c', 'Huérfano', 'missing')]),
      { openSpace },
    )} />)
    // Depth-first under each root: the parent first, then its children; a Space
    // whose parent is absent from the read renders at the root.
    const labels = screen.getAllByRole('button')
      .map(button => button.textContent?.trim() ?? '')
      .filter(label => label !== '…')
    expect(labels).toEqual(['Alfa', '↳Beta', 'Huérfano'])
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.click(screen.getByText('Beta'))
    expect(openSpace).toHaveBeenCalledWith('b')
  })

  it('opens one row menu per Workspace row and closes it through the owner', () => {
    const openSpace = vi.fn()
    const renderSlot = vi.fn((_name: string, owner: { title: string; close: () => void }) => (
      <button type="button" role="menuitem" onClick={owner.close}>{`menú ${owner.title}`}</button>
    ))
    render(<SpacesFallback {...props(store([space('a', 'Alfa')]), { openSpace, renderSlot: renderSlot as never })} />)
    const trigger = screen.getByRole('button', { name: '空间操作「Alfa」' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(renderSlot).toHaveBeenCalledWith('faberloom.spaces.rowMenu', expect.objectContaining({
      workspaceId: 'ws-a',
      title: 'Alfa',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开空间' }))
    expect(openSpace).toHaveBeenCalledWith('a')
    expect(screen.queryByRole('menu')).toBeNull()

    // The contribution closes the same menu through the owner callback.
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'menú Alfa' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('toggles the open menu closed from its own trigger', () => {
    render(<SpacesFallback {...props(store([space('a', 'Alfa')]))} />)
    const trigger = screen.getByRole('button', { name: '空间操作「Alfa」' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape and on a press outside it', () => {
    render(<SpacesFallback {...props(store([space('a', 'Alfa')]))} />)
    const trigger = screen.getByRole('button', { name: '空间操作「Alfa」' })

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('leaves a Space without a mirrored Workspace without a row menu', () => {
    render(<SpacesFallback {...props(store([space('a', 'Alfa', null, null)]))} />)
    expect(screen.queryByRole('button', { name: '空间操作「Alfa」' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alfa' })).toBeTruthy()
  })
})
