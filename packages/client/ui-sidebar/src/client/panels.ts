/**
 * Panellist projection and grouping. Registration options become the shell's
 * published panel metadata, and that metadata becomes the mode bar's tabs and
 * the per-mode accordions. Pure functions: the shell's render code only
 * composes what this module resolves.
 */
import { resolveSlotLabel, type SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelMetadata, SidebarPanelPlacementOptions } from './contract/slots.ts'

/**
 * Registration options the shell reads for one row: the list shape every
 * panellist entry declares, plus the optional placement members.
 */
export interface PanelRegistrationOptions extends SidebarPanelPlacementOptions {
  /** List id; the registry rejects a list entry without one. */
  id?: string
  /** Ascending row order (default 0). */
  order?: number
  /** Row title: plain text or a locale-aware thunk. */
  label?: SlotLabel
}

/** One panellist registration as the projection reads it (a stored entry's options). */
export interface PanelRegistration {
  options: PanelRegistrationOptions
}

/** One mode-bar tab: the mode value and the glyph source of its first row. */
export interface PanelModeTab {
  /** Mode value as declared, rendered as the button's accessible name. */
  mode: string
  /** First row registered under this mode; its glyph is the bar button's icon. */
  glyph: MainPanelId
}

/** One accordion: the heading text of a group and the rows under it. */
export interface PanelAccordion {
  /** Accordion identity inside its mode (the shell's per-mode+group collapsed state). */
  key: string
  /** Heading text; absent renders the bucket without a heading row. */
  group: string | undefined
  /** Rows in registration order. */
  rows: readonly SidebarPanelMetadata[]
}

/**
 * The panel list's resolved layout: the mode bar's tabs, the displayed mode,
 * and that mode's rows in both the accordion and the flat rail arrangement.
 */
export interface PanelLayout {
  /** Mode-bar tabs in registration order (empty when no row declares a mode). */
  tabs: readonly PanelModeTab[]
  /** The mode bar renders once more than one mode is declared. */
  showModeBar: boolean
  /** Displayed mode; absent when no row declares one. */
  mode: string | undefined
  /** Rows that declare no mode: they stay visible above the mode's content. */
  unplaced: readonly SidebarPanelMetadata[]
  /** Rows of the displayed mode in registration order (the rail's icon column). */
  modeRows: readonly SidebarPanelMetadata[]
  /** Accordions of the displayed mode in registration order (the wide column). */
  accordions: readonly PanelAccordion[]
}

/**
 * Read one optional placement thunk at publish time.
 * @param read - the declared thunk, or undefined when the registration declared none.
 * @returns the resolved text, or undefined to keep the member out of the metadata.
 */
function readPlacement(read: (() => string) | undefined): string | undefined {
  return read === undefined ? undefined : read()
}

/**
 * Project panellist registrations into published panel metadata: ascending
 * order, registration order for ties, and every placement thunk resolved once.
 * Members a registration left out stay absent from the metadata.
 * @param entries - stored panellist registrations, in registry order.
 * @returns one metadata record per registration.
 */
export function projectPanels(entries: readonly PanelRegistration[]): readonly SidebarPanelMetadata[] {
  return entries
    .map(({ options }) => {
      // The list registration requires an id; StoredEntry erases the slot kind.
      const id = options.id as MainPanelId
      const mode = readPlacement(options.mode)
      const group = readPlacement(options.group)
      const badge = readPlacement(options.badge)
      return {
        id,
        order: options.order ?? 0,
        label: resolveSlotLabel(options.label) ?? id,
        ...(mode === undefined ? {} : { mode }),
        ...(group === undefined ? {} : { group }),
        ...(badge === undefined ? {} : { badge }),
      }
    })
    .sort((left, right) => left.order - right.order)
}

/**
 * Whether two projections agree. The publish step stores only real changes, so
 * selection subscribers never wake on an identical rebuild.
 * @param current - the published metadata.
 * @param next - the freshly projected metadata.
 * @returns true when every row matches in id, order, label, mode, group, and badge.
 */
export function samePanels(
  current: readonly SidebarPanelMetadata[],
  next: readonly SidebarPanelMetadata[],
): boolean {
  if (current.length !== next.length) return false
  // Lengths already agree, so every `next[index]` exists; the cast only removes
  // the `| undefined` that noUncheckedIndexedAccess adds to the indexed read.
  return current.every((panel, index) => samePanel(panel, next[index] as SidebarPanelMetadata))
}

/**
 * Whether one published row matches another in every field the shell displays.
 * @param left - the published row.
 * @param right - the freshly projected row.
 * @returns true when the two rows are indistinguishable to the shell.
 */
function samePanel(left: SidebarPanelMetadata, right: SidebarPanelMetadata): boolean {
  return left.id === right.id
    && left.order === right.order
    && left.label === right.label
    && left.mode === right.mode
    && left.group === right.group
    && left.badge === right.badge
}

/**
 * Identity of one mode+group accordion in the shell's collapsed state. The NUL
 * joiner cannot occur in a declared value, so no mode or group name can
 * collide with another pair.
 * @param mode - the accordion's mode.
 * @param group - the accordion's heading, absent for ungrouped rows.
 * @returns the state key.
 */
export function accordionKey(mode: string, group: string | undefined): string {
  return `${mode}\u0000${group ?? ''}`
}

/**
 * Bucket one mode's rows by group in registration order; rows that declare no
 * group trail as a single heading-less bucket.
 * @param rows - the displayed mode's rows, in registration order.
 * @param mode - the mode the rows belong to (part of each accordion's key).
 * @returns the accordions in first-appearance order.
 */
function modeAccordions(rows: readonly SidebarPanelMetadata[], mode: string): readonly PanelAccordion[] {
  const buckets = new Map<string, SidebarPanelMetadata[]>()
  const ungrouped: SidebarPanelMetadata[] = []
  for (const row of rows) {
    if (row.group === undefined) {
      ungrouped.push(row)
      continue
    }
    const bucket = buckets.get(row.group)
    if (bucket === undefined) buckets.set(row.group, [row])
    else bucket.push(row)
  }
  const accordions: PanelAccordion[] = [...buckets].map(([group, groupRows]) => ({
    key: accordionKey(mode, group), group, rows: groupRows,
  }))
  if (ungrouped.length > 0) {
    accordions.push({ key: accordionKey(mode, undefined), group: undefined, rows: ungrouped })
  }
  return accordions
}

/**
 * Resolve the panel list's layout from published metadata and the shell's mode
 * pick. A pick that no longer exists falls back to the first declared mode, and
 * rows that declare no mode stay visible in every layout.
 * @param panels - published panel metadata in registration order.
 * @param picked - the mode the user selected, or undefined before any pick.
 * @returns the tabs, the displayed mode, and that mode's rows and accordions.
 */
export function panelLayout(
  panels: readonly SidebarPanelMetadata[],
  picked: string | undefined,
): PanelLayout {
  const tabs: PanelModeTab[] = []
  for (const panel of panels) {
    if (panel.mode === undefined || tabs.some(tab => tab.mode === panel.mode)) continue
    tabs.push({ mode: panel.mode, glyph: panel.id })
  }
  const mode = picked !== undefined && tabs.some(tab => tab.mode === picked) ? picked : tabs[0]?.mode
  const modeRows = mode === undefined ? [] : panels.filter(panel => panel.mode === mode)
  return {
    tabs,
    showModeBar: tabs.length > 1,
    mode,
    unplaced: panels.filter(panel => panel.mode === undefined),
    modeRows,
    accordions: mode === undefined ? [] : modeAccordions(modeRows, mode),
  }
}
