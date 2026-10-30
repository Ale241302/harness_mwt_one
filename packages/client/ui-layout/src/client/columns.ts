/**
 * Normal column geometry: the right column shrinks, then loses its track,
 * before the center drops below its minimum. The sidebar never concedes here;
 * AppFrame supplies its effective preference after responsive collapse.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; rightbar: number }

/** Center width protected while the normal right column is open. */
export const CENTER_MIN = 400
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/**
 * Frame width below which the rails leave the flow (the tablet breakpoint):
 * the left rail becomes the off-canvas drawer and the right rail overlays the
 * canvas instead of shrinking it. The frame measures its own box, so this
 * boundary is reached by a resized or split-screen window, not by the display.
 */
export const SHELL_TABLET_BREAKPOINT = 1024
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = SHELL_TABLET_BREAKPOINT
/** Frame width below which the canvas is the page (the phone breakpoint). */
export const SHELL_PHONE_BREAKPOINT = 768
/** Off-canvas drawer width as a fraction of the frame. */
export const SHELL_DRAWER_RATIO = 0.84
/** Off-canvas drawer width ceiling in px. */
export const SHELL_DRAWER_MAX = 320
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7
/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): Columns {
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const available = viewport - s - CENTER_MIN
  const r = rightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}

/**
 * The shell's responsive regime for one frame width.
 *
 * `wide` keeps the in-flow three-column frame; `tablet` and `phone` take the
 * rails out of the flow (off-canvas drawer for the left rail, overlay for the
 * right one) so the canvas spans the frame. The two narrow regimes differ in
 * chrome budget, not in rail placement.
 */
export type ShellRegime = 'wide' | 'tablet' | 'phone'

/**
 * Resolve the responsive regime from the frame's own measured width.
 * @param viewport - measured frame width in px.
 * @returns the regime: `wide` at or above the tablet breakpoint, `phone` below
 *   the phone breakpoint, `tablet` in between.
 */
export function shellRegime(viewport: number): ShellRegime {
  if (viewport < SHELL_PHONE_BREAKPOINT) return 'phone'
  return viewport < SHELL_TABLET_BREAKPOINT ? 'tablet' : 'wide'
}

/**
 * Drawer width for the off-canvas left rail.
 * @param viewport - measured frame width in px.
 * @returns most of the frame, capped so the canvas edge stays visible.
 */
export function drawerWidth(viewport: number): number {
  return Math.min(Math.round(viewport * SHELL_DRAWER_RATIO), SHELL_DRAWER_MAX)
}
