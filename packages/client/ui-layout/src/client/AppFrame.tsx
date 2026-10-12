/**
 * Shell frame: the top bar above the three-column frame, the responsive
 * regimes, the drag handles (pointer capture + rAF throttle), the column solve
 * (columns.ts), and the child-slot render decisions (the sidebar slot receives
 * live parameters from that solve; the root-scoped main slot selects the
 * Conversation or a global panel). The top bar owns the two rail toggles and
 * the three shell slots other packages fill. Each column occupant owns its
 * Session binding and reports the geometry it needs.
 *
 * Regimes are driven by the frame's own measured width, not the window: above
 * the tablet breakpoint the rails are in-flow columns, below it the left rail
 * is an off-canvas drawer and the right rail overlays the canvas, and below the
 * phone breakpoint the canvas is the page. Crossing a breakpoint never leaves
 * stuck state — the store drops the drawer's manual override on the crossing
 * (stores.ts setViewportWidth).
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  clampWidth, computeColumns, drawerWidth, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MIN, shellRegime,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/**
 * Rail mounting facts for the top bar's toggles: whether an occupant is
 * registered in each rail. Declared by the layout plugin's own registration and
 * read through the `useRails` selector hook.
 */
export interface RailsSnapshot {
  /** A left-rail occupant is mounted. */
  sidebar: boolean
  /** A right-rail occupant is mounted. */
  rightbar: boolean
}

/** Root registration inject face: the rail-mount observable bound to `useRails`. */
export interface AppFrameInjected {
  /** Registrant-private reactive sources bound to framework selector hooks. */
  hooks: { rails: ObservableSnapshot<RailsSnapshot> }
}

/**
 * Full composed props: runtime share + child-slot render share + store share +
 * the injected rail-mount hook + the locale seat.
 */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<
    | 'sidebar'
    | 'main'
    | 'rightbar'
    | 'shell.overlay'
    | 'shell.topbar.brand'
    | 'shell.topbar.center'
    | 'shell.topbar.actions'
  >
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & InjectFace<AppFrameInjected>
  & PropsLocale<'layout'>

/** Elements the drawer hands focus to when it opens. */
const DRAWER_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol} data-rightbar-col>{props.children}</div>
}

/** One rail toggle's glyph: a panel frame with its divider on the toggle's side. */
function RailGlyph(props: { side: 'left' | 'right' }) {
  const divider = props.side === 'left' ? 6 : 10
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
      <line x1={divider} y1="2.5" x2={divider} y2="13.5" />
    </svg>
  )
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/** The shell frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  actions,
  renderSlot,
  useRails,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const rails = useRails(snapshot => snapshot)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const leftToggleRef = useRef<HTMLButtonElement | null>(null)
  const viewport = layoutInfo.viewportWidth

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  const regime = shellRegime(viewport)
  const inFlow = regime === 'wide'
  // The store's narrow override and the frame's rail regime share one boundary:
  // below it the rails leave the flow, so that override IS the drawer's state.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // The resolved normal geometry, as the occupant sees it while the rails are
  // in the flow. Below the tablet breakpoint the right rail overlays the canvas,
  // so its panel always fits and no track is reserved for it.
  const normal = computeColumns(viewport, sidebarPreference, rightbarPreference)
  const cols = computeColumns(viewport, sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0)
  const trackWidth = inFlow ? cols.rightbar : 0
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar
  // Chrome state only this component knows: the user hid the right rail from
  // the top bar. Whether the rail is expanded inside that decision stays the
  // occupant's own recorded fact (layoutInfo.rightbarShown).
  const [rightbarHidden, setRightbarHidden] = useState(false)
  const rightbarShown = layoutInfo.rightbarShown && !rightbarHidden
  const drawerOpen = narrow && layoutInfo.narrowExpanded
  const drawerId = useId()

  // Focus follows the drawer: into its first control on opening, back onto the
  // toggle that opened it on closing. Escape and the scrim both close it.
  const drawerWasOpen = useRef(false)
  useEffect(() => {
    if (drawerOpen === drawerWasOpen.current) return
    drawerWasOpen.current = drawerOpen
    if (!drawerOpen) {
      leftToggleRef.current?.focus()
      return
    }
    const drawer = drawerRef.current
    /* v8 ignore next -- the sidebar column is mounted whenever this effect runs:
     * open/closed is a class-level drawer presentation, never an unmount. */
    if (drawer === null) return
    const first = drawer.querySelector<HTMLElement>(DRAWER_FOCUSABLE)
    ;(first ?? drawer).focus()
  }, [drawerOpen])
  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      actions.toggleSidebar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [actions, drawerOpen])

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  const sidebar = useMemo(() => renderSlot('sidebar', inFlow
    ? { collapsed: sidebarCollapsed, width: cols.sidebar }
    : { collapsed: false, width: drawerWidth(viewport) }), [renderSlot, inFlow, sidebarCollapsed, cols.sidebar, viewport])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])
  // The top bar's seats hold their own subscriptions; memoizing here keeps an
  // unrelated frame re-render (a panel switch, a drag) from re-dispatching them.
  const topbarBrand = useMemo(() => renderSlot('shell.topbar.brand', {}), [renderSlot])
  const topbarCenter = useMemo(() => renderSlot('shell.topbar.center', {}), [renderSlot])
  const topbarActions = useMemo(() => renderSlot('shell.topbar.actions', {}), [renderSlot])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns:
          `${inFlow ? cols.sidebar : 0}px minmax(0, 1fr) ${trackWidth}px`,
      }}
      data-shell-regime={regime}
      data-drawer-open={drawerOpen || undefined}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-rightbar-collapsed={trackWidth === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      <header className={css.topbar} data-shell-topbar aria-label={t('topbar.label')}>
        <div className={css.railToggles}>
          {/* Each toggle appears only while its rail has an occupant; the
              layout store backs the left one in both regimes (wide column
              collapse, narrow drawer override). */}
          {rails.sidebar && (
            <button
              ref={leftToggleRef}
              type="button"
              className={css.railToggle}
              aria-label={sidebarCollapsed ? t('rail.left.open') : t('rail.left.close')}
              aria-expanded={!sidebarCollapsed}
              aria-controls={drawerId}
              onClick={() => { actions.toggleSidebar() }}
            >
              <RailGlyph side="left" />
            </button>
          )}
          {rails.rightbar && (
            <button
              type="button"
              className={css.railToggle}
              aria-label={rightbarShown ? t('rail.right.close') : t('rail.right.open')}
              aria-expanded={rightbarShown}
              onClick={() => { setRightbarHidden(shown => !shown) }}
            >
              <RailGlyph side="right" />
            </button>
          )}
        </div>
        {/* Brand artwork belongs to the package that registers here; an
            unoccupied seat renders nothing and spends no space. */}
        <div className={css.brand}>{topbarBrand}</div>
        {/* The shell's search/command trigger: no fallback, so an unwired
            centre stays empty instead of showing a dead control. */}
        <div className={css.center}>{topbarCenter}</div>
        <div className={css.actions}>{topbarActions}</div>
      </header>
      <div
        ref={drawerRef}
        id={drawerId}
        tabIndex={-1}
        className={css.sidebarCol}
        data-shell-sidebar
        aria-hidden={narrow && !drawerOpen ? true : undefined}
      >
        {sidebar}
      </div>
      <>
        <CenterColumn>{main}</CenterColumn>
        <RightbarColumn>
          {!rightbarHidden && renderSlot('rightbar', {
            width: inFlow ? normal.rightbar : clampWidth(rightbarPreference, RIGHTBAR_MIN, viewport),
            viewportWidth: viewport,
            canShow: inFlow ? normal.rightbar > 0 : true,
          })}
        </RightbarColumn>
      </>
      {narrow && drawerOpen && (
        <button
          type="button"
          className={css.scrim}
          data-shell-scrim
          aria-label={t('drawer.dismiss')}
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed, and
          the overlaid rails below the tablet breakpoint are not resizable. */}
      {inFlow && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {inFlow && layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
