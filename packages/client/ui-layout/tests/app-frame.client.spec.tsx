// @vitest-environment jsdom
/** Frame interactions with a real store and explicitly driven browser measurements. */
import type { GlobalStandardProps, RenderOpts } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { AppFrame, type AppFrameProps, type RailsSnapshot } from '../src/client/AppFrame.tsx'
import type { MainPanelId, RightbarOwnerProps, SidebarOwnerProps } from '../src/client/index.ts'
import { clampWidth } from '../src/client/columns.ts'
import { createLayoutStore } from '../src/client/stores.ts'
import { en } from '../src/client/locales.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
let selectedSession: SessionId | undefined
let selectedSessionTitle: string | undefined
let workspacesReady = true
let railsMounted: RailsSnapshot
/** Whether the sidebar stub renders a focusable control (drawer focus target). */
let sidebarFocusable = false
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AppFrameProps['useSessionPendingInteraction'] = selector => selector(noAttention)
/** Dictionary copy with the build-title override the frame resolves once per mount. */
const translations: Record<string, string> = { ...en, 'brand.localBuild': 'DSH Local Build' }

let observers: ResizeObserverStub[]
class ResizeObserverStub {
  disconnected = false
  constructor(private callback: ResizeObserverCallback) { observers.push(this) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.disconnected = true }
  fire(): void { this.callback([], this) }
}

let frameWidth: number
let animationFrames: Map<number, FrameRequestCallback>
let nextFrame: number
let originalTitle: string
const restoreProperties: (() => void)[] = []

function replaceProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  restoreProperties.push(() => {
    if (descriptor === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, descriptor)
  })
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

/** Flush one browser frame without depending on the worker's timer cadence. */
function flushFrames(): void {
  for (const [id, callback] of [...animationFrames]) {
    if (!animationFrames.delete(id)) continue
    callback(0)
  }
}

function resize(width: number): void {
  frameWidth = width
  act(() => {
    for (const observer of observers) if (!observer.disconnected) observer.fire()
    flushFrames()
  })
}

function mountFrame(windowWidth = frameWidth) {
  vi.stubGlobal('innerWidth', windowWidth)
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: object; options: RenderOpts | undefined }[] = []
  const renderSlot: AppFrameProps['renderSlot'] = (key, owner, options) => {
    slotCalls.push({ key, props: owner, options })
    return key === 'sidebar' && sidebarFocusable
      ? <div data-testid="sidebar-content"><button type="button" data-testid="sidebar-focus">focus</button></div>
      : <div data-testid={`${key}-content`} data-entry-key={options?.entryKey} />
  }
  const useSessions: AppFrameProps['useSessions'] = sel => sel({
    ids: selectedSession === undefined ? [] : [selectedSession],
    byId: selectedSession === undefined ? {} : {
      [selectedSession]: {
        id: selectedSession, displayTitle: 'Test', running: false, blank: false, updatedAt: 1,
        ...(selectedSessionTitle === undefined ? {} : { title: selectedSessionTitle }),
      },
    },
    current: selectedSession,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    ...(workspacesReady ? {} : { state: 'loading' as const, phase: 'pending' as const }),
  }
  const useStore = bindSnapshotSelector(instance)
  const usePanelInfo = bindSnapshotSelector({
    getSnapshot: () => instance.getSnapshot().panelInfo,
    subscribe: listener => instance.subscribe(listener),
  })
  const element = () => (
    <AppFrame
      useStore={useStore}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      usePanelInfo={usePanelInfo}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useResource={useResource}
      useWorkspaces={sel => sel(workspaceState)}
      useRails={selector => selector(railsMounted)}
      t={key => translations[key] ?? key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return {
    ...utils, instance, frame, slotCalls,
    rerenderFrame: () => { utils.rerender(element()) },
    rightOwner: () => slotCalls.findLast(c => c.key === 'rightbar')!.props as RightbarOwnerProps,
    sidebarOwner: () => slotCalls.findLast(c => c.key === 'sidebar')!.props as SidebarOwnerProps,
  }
}

function tracks(frame: HTMLElement): number[] {
  const match = /^([\d.]+)px minmax\(0, 1fr\) ([\d.]+)px$/.exec(frame.style.gridTemplateColumns)
  if (match === null) throw new Error(`unexpected template: ${frame.style.gridTemplateColumns}`)
  return [Number(match[1]), Number(match[2])]
}

function handleFor(frame: HTMLElement, side: 'sidebar' | 'rightbar'): HTMLElement {
  const handle = frame.querySelector<HTMLElement>(`[data-side="${side}"]`)
  if (handle === null) throw new Error(`missing ${side} resize handle`)
  return handle
}

/** One rail toggle from the top bar (left first, right second). */
function railToggle(frame: HTMLElement, side: 'left' | 'right'): HTMLElement {
  const toggle = frame.querySelectorAll<HTMLElement>('[data-shell-topbar] button')[side === 'left' ? 0 : 1]
  if (toggle === undefined) throw new Error(`missing ${side} rail toggle`)
  return toggle
}

function pointer(handle: Element, type: string, clientX: number, pointerId = 1, button = 0): void {
  act(() => { handle.dispatchEvent(new PointerEvent(type, { pointerId, clientX, button, bubbles: true })) })
}

function drag(handle: Element, fromX: number, toX: number): void {
  pointer(handle, 'pointerdown', fromX)
  pointer(handle, 'pointermove', toX)
  act(flushFrames)
  pointer(handle, 'pointerup', toX)
}

beforeEach(() => {
  originalTitle = document.title
  frameWidth = 1920
  selectedSession = 's-test' as SessionId
  selectedSessionTitle = undefined
  workspacesReady = true
  railsMounted = { sidebar: true, rightbar: true }
  sidebarFocusable = false
  observers = []
  animationFrames = new Map()
  nextFrame = 1
  vi.stubEnv('DSH_CLIENT_TITLE', undefined)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { animationFrames.delete(id) })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: frameWidth, height: 1080, top: 0, left: 0, right: frameWidth, bottom: 1080,
    x: 0, y: 0, toJSON: () => ({}),
  }))
  // jsdom has no pointer capture. Each element retains the actual pointer id,
  // and teardown restores absent methods as well as existing descriptors.
  const captured = new WeakMap<Element, number>()
  replaceProperty(Element.prototype, 'setPointerCapture', function (this: Element, id: number) { captured.set(this, id) })
  replaceProperty(Element.prototype, 'releasePointerCapture', function (this: Element) { captured.delete(this) })
  replaceProperty(Element.prototype, 'hasPointerCapture', function (this: Element, id: number) { return captured.get(this) === id })
})

afterEach(() => {
  try {
    cleanup()
  } finally {
    for (const restore of restoreProperties.splice(0).reverse()) restore()
    document.title = originalTitle
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

describe('AppFrame', () => {
  it('localizes the product title without a configured build title', () => {
    mountFrame()
    expect(document.title).toBe('DSH Local Build')
  })

  it('follows the selected durable Session title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    selectedSessionTitle = 'First'
    const { rerenderFrame } = mountFrame()
    expect(document.title).toBe('First — Product')
    selectedSessionTitle = 'Revised'
    rerenderFrame()
    expect(document.title).toBe('Revised — Product')
    selectedSession = undefined
    rerenderFrame()
    expect(document.title).toBe('Product')
  })

  it('renders owner props for the default sidebar and prospective right panel', () => {
    const { frame, rightOwner, sidebarOwner, slotCalls } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 280 })
    expect(rightOwner()).toEqual({ width: 864, viewportWidth: 1920, canShow: true })
    expect(slotCalls.find(c => c.key === 'main')).toEqual({ key: 'main', props: {}, options: { entryKey: 'conversation' } })
  })

  it('renders the main, sidebar, and root-scoped rightbar outlets without a current Session', () => {
    selectedSession = undefined
    const { frame, getByTestId } = mountFrame()
    expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe('conversation')
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(getByTestId('rightbar-content')).toBeTruthy()
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('renders both occupants before workspace baselines settle', () => {
    workspacesReady = false
    const { getByTestId } = mountFrame()
    expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe('conversation')
    expect(getByTestId('rightbar-content')).toBeTruthy()
  })

  it('keeps the closed sidebar mounted at its 56px rail without a handle', () => {
    const { frame, instance, sidebarOwner, getByTestId } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([56, 0])
    expect(sidebarOwner()).toEqual({ collapsed: true, width: 56 })
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(frame.querySelector('[data-side="sidebar"]')).toBeNull()
  })

  it('switches only the keyed main outlet when the active panel changes', () => {
    selectedSessionTitle = 'Session title'
    const { instance, frame, slotCalls, getByTestId } = mountFrame()
    const sessionId = selectedSession
    const layoutInfo = instance.getSnapshot().layoutInfo
    for (const panelId of ['panel-a' as MainPanelId, 'panel-b' as MainPanelId, null]) {
      slotCalls.length = 0
      act(() => { instance.actions.selectPanel(panelId) })
      expect(slotCalls).toEqual([{ key: 'main', props: {}, options: { entryKey: panelId ?? 'conversation' } }])
      expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe(panelId ?? 'conversation')
      expect(instance.getSnapshot().panelInfo).toEqual({ activePanelId: panelId })
      expect(instance.getSnapshot().layoutInfo).toBe(layoutInfo)
      expect(tracks(frame)).toEqual([280, 0])
      expect(selectedSession).toBe(sessionId)
      expect(document.title).toBe(panelId === null ? 'Session title — DSH Local Build' : 'DSH Local Build')
    }
  })
})

describe('AppFrame top bar', () => {
  it('renders the three shell seats with no fallback', () => {
    const { slotCalls, getByTestId } = mountFrame()
    // No fallback node is ever supplied: an unregistered seat is simply empty.
    expect(slotCalls.find(c => c.key === 'shell.topbar.brand')).toEqual({ key: 'shell.topbar.brand', props: {}, options: undefined })
    expect(slotCalls.find(c => c.key === 'shell.topbar.center')).toEqual({ key: 'shell.topbar.center', props: {}, options: undefined })
    expect(slotCalls.find(c => c.key === 'shell.topbar.actions')).toEqual({ key: 'shell.topbar.actions', props: {}, options: undefined })
    expect(getByTestId('shell.topbar.center-content')).toBeTruthy()
    expect(getByTestId('shell.topbar.brand-content')).toBeTruthy()
    expect(getByTestId('shell.topbar.actions-content')).toBeTruthy()
  })

  it('hides each rail toggle while its occupant is not mounted', () => {
    railsMounted = { sidebar: false, rightbar: false }
    expect(mountFrame().frame.querySelectorAll('[data-shell-topbar] button')).toHaveLength(0)
    cleanup()
    railsMounted = { sidebar: true, rightbar: false }
    const { frame } = mountFrame()
    expect(frame.querySelectorAll('[data-shell-topbar] button')).toHaveLength(1)
    expect(railToggle(frame, 'left').getAttribute('aria-expanded')).toBe('true')
  })

  it('backs the left toggle state and label with the store and the dictionary', () => {
    const { frame, instance } = mountFrame()
    const toggle = railToggle(frame, 'left')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Hide the left panel')
    expect(toggle.getAttribute('aria-controls')).toBe(frame.querySelector('[data-shell-sidebar]')!.id)
    act(() => { toggle.click() })
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Show the left panel')
  })

  it('hides and restores the right rail from its toggle', () => {
    const { frame, instance, queryByTestId } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    const toggle = railToggle(frame, 'right')
    expect(queryByTestId('rightbar-content')).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Hide the right panel')
    act(() => { toggle.click() })
    expect(queryByTestId('rightbar-content')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Show the right panel')
    act(() => { toggle.click() })
    expect(queryByTestId('rightbar-content')).toBeTruthy()
  })

  it('follows rail occupants as they mount and unmount', () => {
    railsMounted = { sidebar: false, rightbar: true }
    const { frame, rerenderFrame } = mountFrame()
    expect(frame.querySelectorAll('[data-shell-topbar] button')).toHaveLength(1)
    railsMounted = { sidebar: true, rightbar: true }
    rerenderFrame()
    expect(frame.querySelectorAll('[data-shell-topbar] button')).toHaveLength(2)
  })
})

describe('AppFrame responsive regimes', () => {
  it.each([[1440, 'wide'], [1024, 'wide'], [1023, 'tablet'], [768, 'tablet'], [767, 'phone'], [360, 'phone']] as const)(
    'drives the %ipx regime contract through attributes, not layout',
    (width, regime) => {
      frameWidth = width
      const { frame } = mountFrame(width)
      expect(frame.dataset.shellRegime).toBe(regime)
      expect(frame.dataset.drawerOpen).toBeUndefined()
      expect(tracks(frame)).toEqual(regime === 'wide' ? [280, 0] : [0, 0])
    },
  )

  it('drops the drawer override when the frame widens and keeps rails out of the flow otherwise', () => {
    frameWidth = 900
    const { frame, instance } = mountFrame()
    act(() => { railToggle(frame, 'left').click() })
    expect(frame.dataset.drawerOpen).toBe('true')
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.dataset.drawerOpen).toBeUndefined()
    expect(frame.dataset.shellRegime).toBe('tablet')
  })
})

describe('AppFrame off-canvas drawer', () => {
  it('opens on the toggle, keeps the canvas full width, and moves focus inside', () => {
    frameWidth = 900
    const { frame, instance } = mountFrame()
    const sidebar = frame.querySelector<HTMLElement>('[data-shell-sidebar]')!
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(frame.querySelector('[data-shell-scrim]')).toBeNull()
    expect(tracks(frame)).toEqual([0, 0])
    act(() => { railToggle(frame, 'left').click() })
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(true)
    expect(frame.dataset.drawerOpen).toBe('true')
    expect(sidebar.getAttribute('aria-hidden')).toBeNull()
    expect(tracks(frame)).toEqual([0, 0])
    expect(document.activeElement).toBe(sidebar)
  })

  it('closes on the scrim and returns focus to the toggle that opened it', () => {
    frameWidth = 900
    const { frame, instance } = mountFrame()
    const toggle = railToggle(frame, 'left')
    const sidebar = frame.querySelector<HTMLElement>('[data-shell-sidebar]')!
    act(() => { toggle.click() })
    act(() => { frame.querySelector<HTMLElement>('[data-shell-scrim]')!.click() })
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    expect(frame.dataset.drawerOpen).toBeUndefined()
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(frame.querySelector('[data-shell-scrim]')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })

  it('closes on Escape', () => {
    frameWidth = 900
    const { frame, instance } = mountFrame()
    act(() => { railToggle(frame, 'left').click() })
    expect(frame.dataset.drawerOpen).toBe('true')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    expect(frame.dataset.drawerOpen).toBeUndefined()
  })

  it('hands focus to the drawer first control when it has one', () => {
    frameWidth = 900
    sidebarFocusable = true
    const { frame, getByTestId } = mountFrame()
    act(() => { railToggle(frame, 'left').click() })
    expect(document.activeElement).toBe(getByTestId('sidebar-focus'))
  })

  it('ignores other keys and closes even after the toggling control unmounts', () => {
    frameWidth = 900
    const { frame, rerenderFrame } = mountFrame()
    act(() => { railToggle(frame, 'left').click() })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })) })
    expect(frame.dataset.drawerOpen).toBe('true')
    railsMounted = { sidebar: false, rightbar: true }
    rerenderFrame()
    expect(frame.querySelectorAll('[data-shell-topbar] button')).toHaveLength(1)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(frame.dataset.drawerOpen).toBeUndefined()
  })

  it('leaves the drawer closed and the rails in the flow at the wide regime', () => {
    const { frame, instance } = mountFrame()
    expect(frame.dataset.shellRegime).toBe('wide')
    expect(frame.querySelector('[data-shell-scrim]')).toBeNull()
    expect(frame.querySelector<HTMLElement>('[data-shell-sidebar]')!.getAttribute('aria-hidden')).toBeNull()
    act(() => { railToggle(frame, 'left').click() })
    expect(frame.dataset.drawerOpen).toBeUndefined()
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  })
})

describe('AppFrame normal width concessions', () => {
  it('measures the frame, not the window, before choosing the first-open preference', () => {
    frameWidth = 1000
    const { instance, rightOwner } = mountFrame(1920)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1000)
    expect(rightOwner()).toEqual({ width: 450, viewportWidth: 1000, canShow: true })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(450)
    resize(1920)
    expect(rightOwner().width).toBe(450)
  })

  it('shrinks the right panel to 300px, drops its track, and only then squeezes center', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.setSidebar(420); instance.actions.openRightbar(true, false) })
    resize(1200)
    expect(tracks(frame)).toEqual([420, 380])
    expect(rightOwner()).toEqual({ width: 380, viewportWidth: 1200, canShow: true })
    resize(1120)
    expect(tracks(frame)).toEqual([420, 300])
    resize(1119)
    expect(tracks(frame)).toEqual([420, 0])
    expect(rightOwner()).toEqual({ width: 0, viewportWidth: 1119, canShow: false })
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    expect(instance.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbar: 864 })
    act(() => { instance.actions.closeRightbar() })
    resize(455)
    // Below the tablet breakpoint the rails leave the flow: the phone frame
    // gives the canvas every pixel and keeps navigation in the drawer.
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.dataset.shellRegime).toBe('phone')
    resize(1920)
    expect(tracks(frame)).toEqual([420, 0])
  })

  it('takes the rails out of the flow below the tablet breakpoint', () => {
    frameWidth = 800
    const { frame, instance, rightOwner, sidebarOwner } = mountFrame()
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.dataset.shellRegime).toBe('tablet')
    // The drawer renders the expanded column at its own width.
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 320 })
    expect(rightOwner()).toEqual({ width: 360, viewportWidth: 800, canShow: true })
    act(() => { instance.actions.toggleSidebar() })
    // The manual toggle opens the drawer; the solved tracks stay empty.
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.dataset.drawerOpen).toBe('true')
    act(() => { instance.actions.openRightbar(true, false) })
    // Opening the rail drops the drawer override; the panel still overlays.
    expect(tracks(frame)).toEqual([0, 0])
    expect(instance.getSnapshot().layoutInfo).toMatchObject({ narrowExpanded: false, rightbar: 360 })
    expect(rightOwner().canShow).toBe(true)
  })

  it.each([[768, 'tablet'], [767, 'phone'], [360, 'phone']] as const)('keeps an overlaid right rail eligible at %ipx', (width, regime) => {
    frameWidth = width
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.dataset.shellRegime).toBe(regime)
    expect(rightOwner()).toEqual({
      width: clampWidth(width * 0.45, 300, width),
      viewportWidth: width,
      canShow: true,
    })
  })

  it('reports the overlaid right rail as eligible whether or not the drawer is open', () => {
    frameWidth = 800
    const { instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false); instance.actions.toggleSidebar() })
    expect(rightOwner().canShow).toBe(true)
  })

  it('keeps the in-flow rail at or above the tablet breakpoint', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    resize(1024)
    expect(tracks(frame)).toEqual([400, 0])
    expect(frame.dataset.shellRegime).toBe('wide')
    act(() => { instance.actions.setSidebar(300) })
    resize(1440)
    expect(tracks(frame)).toEqual([300, 0])
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([56, 0])
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('clears the narrow override on the crossing and restores the wide preference on return', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    resize(980)
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.dataset.drawerOpen).toBe('true')
    // Crossing back to the wide regime drops the drawer override and the
    // stored preference takes over again.
    resize(1920)
    expect(frame.dataset.drawerOpen).toBeUndefined()
    expect(tracks(frame)).toEqual([400, 0])
    resize(980)
    expect(frame.dataset.drawerOpen).toBeUndefined()
  })

  it('opens the drawer without touching a wide-closed sidebar preference', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(56)
    resize(980)
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.dataset.drawerOpen).toBe('true')
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    resize(1920)
    expect(tracks(frame)[0]).toBe(56)
  })
})

describe('AppFrame right panel presentation', () => {
  it('releases the fullscreen track with the instant marker while clearing fullscreen', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864])
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.closeRightbar() })
    expect(frame.dataset.rightbarInstant).toBe('true')
  })

  it('marks restoration instant without suppressing the following normal close', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBe('true')
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBeUndefined()
  })

  it.each(['setSidebar', 'toggleSidebar', 'setRightbar', 'viewport', 'open'] as const)('reenables normal transitions after %s', (action) => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true); instance.actions.closeRightbar() })
    expect(frame.dataset.rightbarInstant).toBe('true')
    act(() => {
      if (action === 'viewport') resize(1800)
      else if (action === 'open') instance.actions.openRightbar(true, false)
      else if (action === 'toggleSidebar') instance.actions.toggleSidebar()
      else instance.actions[action](350)
    })
    expect(frame.dataset.rightbarInstant).toBeUndefined()
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('keeps fullscreen suppression independent from resetting the instant marker', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    act(() => { instance.actions.setSidebar(350) })
    expect(frame.dataset.rightbarInstant).toBeUndefined()
    expect(frame.dataset.rightbarFullscreen).toBe('true')
  })

  it('preserves normal tracks through fullscreen and hides the outer resize handle', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(handleFor(frame, 'rightbar').style.left).toBe('1056px')
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(rightOwner().width).toBe(864)
    expect(frame.dataset.rightbarFullscreen).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(handleFor(frame, 'rightbar').style.left).toBe('1056px')
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('inserts a fullscreen track and its transition-suppression marker in the same render', () => {
    const { frame, instance } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(frame.dataset.rightbarFullscreen).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('retains fullscreen over the canvas when the rails are out of the flow', () => {
    frameWidth = 700
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(false, true) })
    expect(tracks(frame)).toEqual([0, 0])
    expect(rightOwner()).toEqual({ width: 315, viewportWidth: 700, canShow: true })
    expect(instance.getSnapshot().layoutInfo.rightbarShown).toBe(true)
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
  })

  it('keeps resolved panel width independent of the requested track', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(false, false) })
    resize(1100)
    expect(tracks(frame)).toEqual([280, 0])
    expect(rightOwner().width).toBe(420)
    drag(handleFor(frame, 'rightbar'), 680, 690)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(410)
    expect(rightOwner().width).toBe(410)
    expect(tracks(frame)[1]).toBe(0)
  })
})

describe('AppFrame pointer resizing', () => {
  it('updates columns during the gesture and freezes the drag-start width', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    expect(frame.dataset.dragging).toBe('true')
    pointer(handle, 'pointermove', 320)
    pointer(handle, 'pointermove', 340)
    expect(animationFrames.size).toBe(1)
    act(flushFrames)
    expect(tracks(frame)[0]).toBe(340)
    pointer(handle, 'pointermove', 360)
    act(flushFrames)
    expect(tracks(frame)[0]).toBe(360)
    pointer(handle, 'pointerup', 360)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
    expect(frame.dataset.dragging).toBeUndefined()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it('starts a conceded right drag at its actual width, shared by panel and track', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    resize(1100)
    const handle = handleFor(frame, 'rightbar')
    expect(rightOwner().width).toBe(420)
    expect(tracks(frame)[1]).toBe(420)
    expect(handle.style.left).toBe('680px')
    drag(handle, 680, 690)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(410)
    expect(rightOwner().width).toBe(410)
    expect(tracks(frame)[1]).toBe(410)
    expect(handle.style.left).toBe('690px')
  })

  it('widens to the 70% limit and shrinks to 300px through pointer input', () => {
    frameWidth = 3000
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.toggleSidebar(); instance.actions.openRightbar(true, false) })
    drag(handleFor(frame, 'rightbar'), 1650, 0)
    expect(rightOwner().width).toBe(2100)
    expect(tracks(frame)[1]).toBe(2100)
    drag(handleFor(frame, 'rightbar'), 900, 3000)
    expect(rightOwner().width).toBe(300)
    expect(tracks(frame)[1]).toBe(300)
  })

  it('commits the pointerup coordinate and cancels its pending animation frame', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointermove', 320)
    pointer(handle, 'pointerup', 360)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
    expect(animationFrames.size).toBe(0)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
  })

  it('ignores uncaptured motion, secondary buttons, and a second pointer', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointermove', 500, 9)
    pointer(handle, 'pointerup', 500, 9)
    pointer(handle, 'pointercancel', 500, 9)
    pointer(handle, 'pointerdown', 500, 9, 2)
    expect(frame.dataset.dragging).toBeUndefined()
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointerdown', 500, 9)
    pointer(handle, 'pointermove', 500, 9)
    pointer(handle, 'pointerup', 500, 9)
    expect(animationFrames.size).toBe(0)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(280)
    pointer(handle, 'pointerup', 300)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(300)
  })

  it.each(['pointercancel', 'lostpointercapture'])('ends %s without committing queued motion', (event) => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointermove', 340)
    if (event === 'lostpointercapture') handle.releasePointerCapture(1)
    pointer(handle, event, 340)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(280)
    expect(animationFrames.size).toBe(0)
    expect(frame.dataset.dragging).toBeUndefined()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it.each(['fullscreen', 'close', 'unmount'])('cancels a pending drag on %s', (change) => {
    const { frame, instance, unmount } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    const handle = handleFor(frame, 'rightbar')
    pointer(handle, 'pointerdown', 1056)
    pointer(handle, 'pointermove', 1000)
    act(() => {
      if (change === 'fullscreen') instance.actions.openRightbar(true, true)
      else if (change === 'close') instance.actions.closeRightbar()
      else unmount()
    })
    const settled = instance.getSnapshot()
    act(flushFrames)
    expect(instance.getSnapshot()).toBe(settled)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(864)
    expect(animationFrames.size).toBe(0)
    expect(handle.hasPointerCapture(1)).toBe(false)
    if (change !== 'unmount') expect(frame.dataset.dragging).toBeUndefined()
  })
})

describe('AppFrame frame measurement lifecycle', () => {
  it('coalesces observer reports and publishes the latest frame measurement', () => {
    const { instance, rightOwner } = mountFrame()
    const observer = observers.at(-1)!
    act(() => {
      frameWidth = 900
      observer.fire()
      frameWidth = 1200
      observer.fire()
    })
    expect(animationFrames.size).toBe(1)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1200)
    expect(rightOwner().viewportWidth).toBe(1200)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBeNull()
  })

  it('retains the last positive measurement while the frame is hidden', () => {
    const { instance, rightOwner } = mountFrame()
    resize(0)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    expect(rightOwner().viewportWidth).toBe(1920)
  })

  it('disconnects the observer and prevents queued or late reports after unmount', () => {
    const { instance, unmount } = mountFrame()
    const observer = observers.at(-1)!
    frameWidth = 800
    act(() => { observer.fire() })
    expect(animationFrames.size).toBe(1)
    unmount()
    expect(observer.disconnected).toBe(true)
    expect(animationFrames.size).toBe(0)
    act(() => { observer.fire(); flushFrames() })
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    expect(animationFrames.size).toBe(0)
  })
})
