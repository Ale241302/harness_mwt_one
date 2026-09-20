// @vitest-environment jsdom
/** FaberLoom surface: identity tokens, brand name, real workspace reads, and panel switching. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'

const CONVERSAR = 'faberloom-conversar' as MainPanelId
const SPACES = 'faberloom-spaces' as MainPanelId

const OVERVIEW = {
  spaces: [{ id: 'space-1', title: 'Marluvas', parentId: null }],
  agents: [{ id: 'agent-1', name: 'Proformas', spaceId: 'space-1', active: true }],
  board: [{ id: 'item-1', title: 'Preparar proforma', status: 'needs_review' }],
  routines: [{ id: 'routine-1', name: 'Pedido a proforma', status: 'active' }],
  memory: [{ id: 'mem-1', kind: 'episodic', text: 'El precio de Eguisa se consulta antes de cotizar.', at: '2026-09-16T00:00:00Z' }],
  canWrite: true,
}

const EMPTY = { spaces: [], agents: [], board: [], routines: [], memory: [], canWrite: true }

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

async function bench(overviewResult: unknown = { ok: true, value: OVERVIEW }) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  const theme = { overrideTokens: vi.fn(() => () => {}) }
  const layout = { selectPanel: vi.fn((activePanelId: MainPanelId | null) => { runtime.panelInfo.set({ activePanelId }) }) }
  const overview = vi.fn(async () => overviewResult)
  const createSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const renameSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const renameAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const deactivateAgent = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createBoardItem = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const reviewBoardItem = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const createRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const setRoutineActive = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const remember = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const spaceDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const routineDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const boardDetail = vi.fn(async () => ({ ok: true, value: undefined }))
  const saveSpace = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const saveRoutine = vi.fn(async () => ({ ok: true, value: OVERVIEW }))
  const connections = vi.fn(async () => ({ ok: true, value: [] }))
  const saveConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const removeConnection = vi.fn(async () => ({ ok: true, value: [] }))
  const probeConnection = vi.fn(async () => ({ ok: true, value: { ok: true, detail: 'ok' } }))
  const faberloomView = {
    overview, createSpace, renameSpace, createAgent, renameAgent,
    deactivateAgent, createBoardItem, reviewBoardItem, createRoutine, setRoutineActive, remember,
    spaceDetail, saveSpace, routineDetail, saveRoutine, boardDetail, connections, saveConnection, removeConnection, probeConnection,
  }
  await runtime.mount({
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('theme', theme as never)
      ctx.provide('layout', layout as never)
      ctx.provide('locale', locale)
      ctx.provide('remote', { faberloomView, $on: vi.fn(() => () => {}) } as never)
      ctx.provide('remote.faberloomView', faberloomView as never)
      ctx.effect(() => locale.register('common', { zh: commonZh, en: commonEn }), 'test: common locale')
      ctx.slots.installLocale(locale)
    },
  })
  function Frame({ usePanelInfo, renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'sidebar.brand.name' | 'sidebar.panellist' | 'main'>) {
    const activePanelId = usePanelInfo(info => info.activePanelId)
    return (
      <>
        <header>{renderSlot('sidebar.brand.name', {})}</header>
        <nav>{renderSlot('sidebar.panellist', { size: 16, active: false })}</nav>
        <main>{renderSlot('main', {}, { entryKey: activePanelId ?? CONVERSAR })}</main>
      </>
    )
  }
  await runtime.root.declare({
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    main: { kind: 'keyed', scope: 'root' },
  }, Frame)
  const surface = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, theme, layout, overview, createSpace, surface, view }
}

describe('faberloom surface', () => {
  it('registers the identity tokens and one sidebar row per section', async () => {
    const { runtime, theme, surface, view } = await bench()
    expect(theme.overrideTokens).toHaveBeenCalledOnce()
    const [source, tokens] = theme.overrideTokens.mock.calls[0] as unknown as [string, Record<string, { light: string; dark: string }>]
    expect(source).toBe('@deepseek-ai/dsh-client-ui-faberloom')
    expect(Object.keys(tokens)).toEqual(['--dsw-alias-brand-primary-new-colorprimary-new-color'])

    expect(runtime.slots.entries('sidebar.panellist').map(row => row.options.id)).toEqual([
      'faberloom-conversar',
      'faberloom-board',
      'faberloom-executions',
      'faberloom-spaces',
      'faberloom-agents',
      'faberloom-skills',
      'faberloom-routines',
      'faberloom-memory',
      'faberloom-connections',
    ])
    expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual([
      'faberloom-conversar',
      'faberloom-board',
      'faberloom-executions',
      'faberloom-spaces',
      'faberloom-agents',
      'faberloom-skills',
      'faberloom-routines',
      'faberloom-memory',
      'faberloom-connections',
    ])
    expect(view.getByText('faberloom')).toBeTruthy()
    expect(view.getByRole('heading', { name: '¿Qué quieres resolver hoy?' })).toBeTruthy()
    await surface.dispose()
  })

  it('renders real workspace rows from the host view and opens the conversation', async () => {
    const { runtime, overview, layout, surface, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    expect(await view.findByText('Marluvas')).toBeTruthy()
    expect(overview).toHaveBeenCalledOnce()

    act(() => { runtime.panelInfo.set({ activePanelId: CONVERSAR }) })
    const start = view.getByRole('button', { name: 'Empezar conversación' })
    start.click()
    expect(layout.selectPanel).toHaveBeenCalledWith(null)

    await surface.dispose()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.entries('main')).toEqual([])
    expect(view.queryByText('faberloom')).toBeNull()
  })

  it('shows the empty state when the workspace has no rows', async () => {
    const { runtime, view } = await bench({ ok: true, value: EMPTY })
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    expect(await view.findByText('Sin datos todavía')).toBeTruthy()
  })

  it('creates a space from the panel form and republishes the refreshed overview', async () => {
    const { runtime, createSpace, view } = await bench()
    act(() => { runtime.panelInfo.set({ activePanelId: SPACES }) })
    const input = await view.findByPlaceholderText('Nombre del espacio')
    fireEvent.change(input, { target: { value: 'Marluvas' } })
    fireEvent.click(view.getByRole('button', { name: 'Crear' }))
    await waitFor(() => { expect(createSpace).toHaveBeenCalledWith('Marluvas') })
  })
})
