/**
 * Sidebar shell: column geometry and global panel navigation.
 * Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the upper
 * controls enter the 56px rail from the same horizontal offset (one icon each,
 * same top-down order) on one fade that ends with the slide. The bottom-pinned
 * settings control and the footer actions beside it only fade. The
 * workspace/session browsing region between global panel rows and the foot is
 * the `sidebar.workspaces` registrant's, and the foot holds `sidebar.settings`
 * plus `sidebar.footer.action`; the shell hands them the wide flag (plus an
 * expand request callback for the browser).
 *
 * Panel rows follow the registrations' placement members: rows that declare a
 * mode switch through a compact mode bar and group into accordions inside their
 * mode (each heading carries a chevron and the group's row count, and the
 * selected row's group stays open), while rows that declare none keep the flat
 * list. The rail renders the mode bar and the rows as icons only.
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  FaberLoomMark, FlIconChevron, FlIconPanelLeft, FlIconPlus, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarPanelMetadata, SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps,
} from './contract/slots.ts'
import { panelLayout, type PanelAccordion } from './panels.ts'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/** Format complete-build metadata for the local brand badge. */
function localBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & { /** Row chip text; undefined when the registration declared none. */ badge?: string | undefined }
  & Pick<SidebarSectionOwnerProps, 'wide'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel'>
  & PropsRenderSlots<'sidebar.panellist'>

/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, badge, wide, usePanelInfo, selectPanel, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.panelRow, active && css.panelActive)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={() => { selectPanel(id) }}
      >
        <span className={css.panelGlyph} aria-hidden="true">
          {renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, { only: id })}
        </span>
        {wide && (
          <span className={clsx(css.panelTitle, css.wide)}>
            {label}
          </span>
        )}
        {wide && badge !== undefined && <span className={css.panelBadge}>{badge}</span>}
      </button>
    </Tooltip>
  )
}

/** One accordion: its group, its collapsed state, and the shell shares its rows render with. */
type AccordionProps =
  Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel'>
  & PropsRenderSlots<'sidebar.panellist'>
  & {
    /** The group to render, with its rows in registration order. */
    accordion: PanelAccordion
    /** Whether the user collapsed this group; the selected row's group stays open regardless. */
    collapsed: boolean
    /** Toggle this group in the shell's collapsed state. */
    onToggle: () => void
  }

/**
 * One accordion: a heading button carrying the chevron, the group label, and
 * the group's row count over the rows it toggles. A group declared without a
 * heading renders its rows directly. The group holding the selected panel
 * stays open, so selecting a panel never leaves its row behind a collapsed
 * heading.
 * @param props - accordion data, shell shares, and the toggle callback.
 * @returns the accordion element tree.
 */
function Accordion({
  accordion, collapsed, onToggle, usePanelInfo, selectPanel, renderSlot,
}: AccordionProps) {
  const ids = accordion.rows.map(row => row.id)
  const holdsActive = usePanelInfo(info => info.activePanelId !== null && ids.includes(info.activePanelId))
  const open = accordion.group === undefined || !collapsed || holdsActive
  return (
    <div className={css.accordion}>
      {accordion.group !== undefined && (
        <button
          type="button"
          className={css.accordionHead}
          aria-expanded={open}
          onClick={() => { onToggle() }}
        >
          <FlIconChevron size={12} className={clsx(css.accordionChevron, open && css.accordionChevronOpen)} />
          <span className={css.accordionTitle}>{accordion.group}</span>
          <span className={css.accordionCount}>{accordion.rows.length}</span>
        </button>
      )}
      <div className={css.accordionBody} hidden={!open}>
        {accordion.rows.map(row => (
          <PanelRow
            key={row.id}
            id={row.id}
            label={row.label}
            badge={row.badge}
            wide
            usePanelInfo={usePanelInfo}
            selectPanel={selectPanel}
            renderSlot={renderSlot}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  selectPanel,
  usePanels,
  usePanelInfo,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)

  // Panel placement: the mode bar's pick and the per-mode+group collapsed state
  // persist while the shell is mounted. A pick no registration declares any
  // more falls back to the first declared mode.
  const [pickedMode, setPickedMode] = useState<string>()
  const [collapsedAccordions, setCollapsedAccordions] = useState<ReadonlySet<string>>(() => new Set<string>())
  const layout = useMemo(() => panelLayout(panels, pickedMode), [panels, pickedMode])
  const toggleAccordion = (key: string): void => {
    setCollapsedAccordions((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const buildVersion = localBuildVersion()

  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.logoRow}>
        {/* Expanded, the brand doubles as a New Session shortcut; the
            collapsed rail's logo is the expand toggle below instead. */}
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandMark}>
                {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FaberLoomMark size={24} /> })}
              </span>
              <span className={css.brandName}>
                {renderSlot('sidebar.brand.name', {}, {
                  fallback: buildVersion === undefined
                    ? <span className={css.fallbackBrandName}>{t('brand.localBuild')}</span>
                    : (
                      <span className={css.localBuildBrand}>
                        <span className={css.localBuildTitle}>{t('brand.localBuild')}</span>
                        <span className={css.buildVersion}>{buildVersion}</span>
                      </span>
                    ),
                })}
              </span>
            </span>
          </button>
        )}
        {/* Rail resting state is the brand mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.toggle)}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide && (
              <span className={css.railMark} aria-hidden="true">
                {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FaberLoomMark size={24} /> })}
              </span>
            )}
            {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
            <FlIconPanelLeft className={css.panelIcon} size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {/* Expanded, the button carries its own label — tooltip only on the rail. */}
      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <FlIconPlus size={wide ? 14 : 18} />
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </button>
      </Tooltip>

      {panels.length > 0 && (
        <nav className={css.panelList} aria-label={t('panels.label')}>
          {/* The mode bar switches which accordions render. Icon-only, so each
              button's accessible name is the mode value itself. */}
          {layout.showModeBar && (
            <div className={css.modeBar}>
              {layout.tabs.map(({ mode, glyph }) => (
                <Tooltip key={mode} label={mode} delayMs={500}>
                  <button
                    type="button"
                    className={clsx(css.modeButton, mode === layout.mode && css.modeActive)}
                    aria-label={mode}
                    aria-pressed={mode === layout.mode}
                    onClick={() => { setPickedMode(mode) }}
                  >
                    <span className={css.modeGlyph} aria-hidden="true">
                      {renderSlot('sidebar.panellist', {
                        size: wide ? 16 : 18,
                        active: mode === layout.mode,
                      }, { only: glyph })}
                    </span>
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
          {/* Rows that declare no mode stay visible in every layout. */}
          {layout.unplaced.map(row => (
            <PanelRow
              key={row.id}
              id={row.id}
              label={row.label}
              badge={row.badge}
              wide={wide}
              usePanelInfo={usePanelInfo}
              selectPanel={selectPanel}
              renderSlot={renderSlot}
            />
          ))}
          {/* Wide, the displayed mode's rows group under their headings; the
              rail drops the headings and renders the same rows as icons. */}
          {wide
            ? layout.accordions.map(accordion => (
              <Accordion
                key={accordion.key}
                accordion={accordion}
                collapsed={collapsedAccordions.has(accordion.key)}
                onToggle={() => { toggleAccordion(accordion.key) }}
                usePanelInfo={usePanelInfo}
                selectPanel={selectPanel}
                renderSlot={renderSlot}
              />
            ))
            : layout.modeRows.map(row => (
              <PanelRow
                key={row.id}
                id={row.id}
                label={row.label}
                badge={row.badge}
                wide={false}
                usePanelInfo={usePanelInfo}
                selectPanel={selectPanel}
                renderSlot={renderSlot}
              />
            ))}
        </nav>
      )}

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail icon column rides the same slot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Footer actions sit to the right of Settings when wide and above it in
          the rail; the foot CSS owns that axis. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}
