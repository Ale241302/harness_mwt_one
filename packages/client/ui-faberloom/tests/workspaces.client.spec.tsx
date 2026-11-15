// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { FABERLOOM_SECTIONS } from '../src/client/panels.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

/** The row this spec covers, resolved the way the sidebar resolves it. */
const section = FABERLOOM_SECTIONS.find(row => String(row.id) === 'faberloom-workspaces')

/** One Workspace the Host reports, with one Session in it. */
const workspace = {
  workspaceId: 'ws-1',
  title: 'prueba plugin',
  path: 'C:\\Users\\ale13\\Downloads\\prueba plugin',
  sessionIds: ['s-1'],
}

/** The Session summaries the list renders. */
const sessions = {
  's-1': { id: 's-1', displayTitle: 'Charla uno', blank: false, running: false, updatedAt: 0 },
}

/** A root Space and its sub Space, both registered by the same Workspace folder. */
const overview = {
  spaces: [
    {
      id: 'sp-1',
      title: 'prueba plugin',
      parentId: null,
      agentId: null,
      agentName: null,
      workspaceId: 'ws-1',
      folderPath: 'C:\\Users\\ale13\\Downloads\\prueba plugin',
    },
    {
      id: 'sp-2',
      title: 'Documentos',
      parentId: 'sp-1',
      agentId: null,
      agentName: null,
      workspaceId: 'ws-1',
      folderPath: 'C:\\Users\\ale13\\Downloads\\prueba plugin\\Documentos',
    },
  ],
}

/**
 * Props for the screen: framework seats stubbed over one fixed snapshot.
 * @param overrides - members a case replaces.
 * @returns props the panel accepts.
 */
function props(overrides: Record<string, unknown> = {}): never {
  const state = { status: 'ready', overview, lastError: null }
  const value = {
    t,
    load: vi.fn(),
    useStore: (selector: (snapshot: unknown) => unknown) => selector(state),
    actions: {},
    usePanelInfo: (selector: (snapshot: unknown) => unknown) => selector({ activePanelId: 'faberloom-workspaces' }),
    useWorkspaces: (selector: (snapshot: unknown) => unknown) => selector({ items: [workspace] }),
    useSessions: (selector: (snapshot: unknown) => unknown) => selector({ byId: sessions }),
    openSession: vi.fn(),
    startSpaceSession: vi.fn(),
    goToWorkspace: vi.fn(),
    pickFolder: vi.fn(async () => null),
    createSpaceFromFolder: vi.fn(async () => ({ ok: true, value: { spaces: [] } })),
    ...overrides,
  }
  return value as never
}

/**
 * Render the Workspaces page from the product's section table.
 * @param overrides - props a case replaces.
 * @returns the render result.
 */
function renderScreen(overrides: Record<string, unknown> = {}) {
  if (section === undefined) throw new Error('faberloom-workspaces is not in FABERLOOM_SECTIONS')
  const Page = section.Page as unknown as (props: never) => unknown
  return render(createElement(Page as never, props(overrides)))
}

describe('faberloom-workspaces section', () => {
  it('is a sidebar row of the Work group', () => {
    expect(section).toBeDefined()
    expect(section?.sidebar).not.toBe(false)
    expect(String(section?.labelKey)).toBe('nav.workspaces')
    expect(String(section?.groupKey)).toBe('nav.group.work')
  })
})

describe('workspacesScreen', () => {
  it('lists the Workspaces the host reports and keeps the tree folded', () => {
    renderScreen()
    expect(screen.getByText('工作区')).toBeTruthy()
    expect(screen.getByText('prueba plugin')).toBeTruthy()
    expect(screen.getByText(/Downloads\\prueba plugin · 1/u)).toBeTruthy()
    expect(screen.queryByText('Documentos')).toBeNull()
    expect(screen.queryByText('Charla uno')).toBeNull()
  })

  it('opens a Workspace into its Spaces, sub Spaces and Sessions', () => {
    renderScreen()
    fireEvent.click(screen.getByText('prueba plugin'))
    // The root Space is listed, and its Sessions come with the Workspace.
    expect(screen.getAllByText('prueba plugin')).toHaveLength(2)
    expect(screen.getByText('Charla uno')).toBeTruthy()
    // A sub Space hangs off the Space row, not off the Workspace.
    expect(screen.queryByText('Documentos')).toBeNull()
    fireEvent.click(screen.getAllByText('prueba plugin')[1] as HTMLElement)
    expect(screen.getByText('Documentos')).toBeTruthy()
  })

  it('opens a Session and starts one from a Space', () => {
    const openSession = vi.fn()
    const startSpaceSession = vi.fn()
    renderScreen({ openSession, startSpaceSession })
    fireEvent.click(screen.getByText('prueba plugin'))
    fireEvent.click(screen.getByText('Charla uno'))
    expect(openSession).toHaveBeenCalledWith('s-1')
    const [first] = screen.getAllByRole('button', { name: '新建会话' })
    expect(first).toBeDefined()
    fireEvent.click(first as HTMLElement)
    expect(startSpaceSession).toHaveBeenCalledWith('sp-1')
  })

  it('adopts a folder as a Space and reports a rejected read', async () => {
    const pickFolder = vi.fn(async () => 'C:\\tmp\\proyecto')
    const createSpaceFromFolder = vi.fn(async () => ({ ok: false, error: { message: 'sin permiso' } }))
    renderScreen({ pickFolder, createSpaceFromFolder })
    fireEvent.click(screen.getByRole('button', { name: '从文件夹…' }))
    await screen.findByText('sin permiso')
    expect(createSpaceFromFolder).toHaveBeenCalledWith('proyecto', 'C:\\tmp\\proyecto', null)
  })

  it('explains an empty device instead of drawing an empty list', () => {
    renderScreen({ useWorkspaces: (selector: (snapshot: unknown) => unknown) => selector({ items: [] }) })
    expect(screen.getByText('还没有工作区')).toBeTruthy()
  })
})
