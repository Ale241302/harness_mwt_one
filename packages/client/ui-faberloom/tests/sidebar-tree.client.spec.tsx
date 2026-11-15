// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { SidebarTree, type SidebarTreeProps } from '../src/client/sidebar/tree.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

/** One Workspace with two Sessions, the second one selected. */
const workspaces = {
  items: [
    { workspaceId: 'ws-1', title: 'prueba plugin', path: 'C:\\tmp\\prueba', sessionIds: ['s-1', 's-2'] },
    { workspaceId: 'ws-2', title: 'predeterminado', path: 'C:\\tmp\\default', sessionIds: ['s-3'] },
  ],
}

const sessions = {
  current: 's-2',
  byId: {
    's-1': { id: 's-1', displayTitle: 'Greeting', blank: false, running: false, updatedAt: 0 },
    's-2': { id: 's-2', displayTitle: 'Expediente 2487-2026', blank: false, running: false, updatedAt: 0 },
    's-3': { id: 's-3', displayTitle: 'Consulta', blank: false, running: false, updatedAt: 0 },
  },
}

/** A root Space and its sub Space, both in the first Workspace. */
const overview = {
  spaces: [
    {
      id: 'sp-1', title: 'Prueba', parentId: null, agentId: null, agentName: null,
      workspaceId: 'ws-1', folderPath: 'C:\\tmp\\prueba',
    },
    {
      id: 'sp-2', title: 'Subspace UI', parentId: 'sp-1', agentId: null, agentName: null,
      workspaceId: 'ws-1', folderPath: 'C:\\tmp\\prueba\\sub',
    },
  ],
}

/**
 * Props for the tree over one fixed snapshot.
 * @param overrides - members a case replaces.
 * @returns props the tree accepts.
 */
function props(overrides: Partial<SidebarTreeProps> = {}): SidebarTreeProps {
  return {
    t,
    wide: true,
    useWorkspaces: ((selector: (state: unknown) => unknown) => selector(workspaces)) as never,
    useSessions: ((selector: (state: unknown) => unknown) => selector(sessions)) as never,
    useStore: ((selector: (state: unknown) => unknown) => selector({ overview })) as never,
    openSession: vi.fn(),
    startSession: vi.fn(),
    openWorkspaces: vi.fn(),
    ...overrides,
  }
}

describe('SidebarTree', () => {
  it('lists the Workspaces folded, with their Space and Session counts', () => {
    render(<SidebarTree {...props()} />)
    expect(screen.getByText('工作区')).toBeTruthy()
    expect(screen.getByText('prueba plugin')).toBeTruthy()
    expect(screen.getByText('predeterminado')).toBeTruthy()
    // The Workspace row carries the number of Sessions it holds.
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.queryByText('Greeting')).toBeNull()
    expect(screen.queryByText('Prueba')).toBeNull()
  })

  it('opens a Workspace into its Spaces, sub Spaces and Sessions', () => {
    const openSession = vi.fn()
    render(<SidebarTree {...props({ openSession })} />)
    fireEvent.click(screen.getByText('prueba plugin'))
    // The Space lives in the Workspace and hangs its sub Space off its own row.
    expect(screen.getByText('Prueba')).toBeTruthy()
    expect(screen.queryByText('Subspace UI')).toBeNull()
    fireEvent.click(screen.getByText('Prueba'))
    expect(screen.getByText('Subspace UI')).toBeTruthy()
    // Sessions come after the Space tree, and the current one is marked.
    expect(screen.getByText('Expediente 2487-2026').closest('button')?.getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByText('Greeting'))
    expect(openSession).toHaveBeenCalledWith('s-1')
  })

  it('starts a Session in the Workspace whose plus was used', () => {
    const startSession = vi.fn()
    render(<SidebarTree {...props({ startSession })} />)
    fireEvent.click(screen.getByRole('button', { name: '新建会话 — predeterminado' }))
    expect(startSession).toHaveBeenCalledWith('ws-2')
  })

  it('sends the folder action to the Workspaces panel', () => {
    const openWorkspaces = vi.fn()
    render(<SidebarTree {...props({ openWorkspaces })} />)
    fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
    expect(openWorkspaces).toHaveBeenCalledOnce()
  })

  it('renders one entry in the collapsed rail', () => {
    render(<SidebarTree {...props({ wide: false })} />)
    expect(screen.queryByText('prueba plugin')).toBeNull()
    expect(screen.getByRole('button', { name: '工作区' })).toBeTruthy()
  })

  it('explains an empty machine instead of an empty list', () => {
    render(<SidebarTree {...props({
      useWorkspaces: ((selector: (state: unknown) => unknown) => selector({ items: [] })) as never,
    })} />)
    expect(screen.getByText('此计算机上没有工作区。')).toBeTruthy()
  })
})
