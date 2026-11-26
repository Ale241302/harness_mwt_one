/**
 * The shell's own Space tree.
 *
 * A Host browser fills `sidebar.workspaces`; a Host whose Workspace service
 * never activated leaves that hole empty, and the browsing region then draws
 * the same Spaces from the overview instead of staying blank. Rows carry the
 * row menu the Host tree publishes (`faberloom.spaces.rowMenu`, the same owner
 * contract as `sidebar.workspaces.rowMenu`), so Share, Create sub Space, and
 * Move work in both trees from one contribution.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FlIconWorkspace } from '../ui/faberloom-icons.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import type { WorkspaceRowMenuOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { createWorkspaceStore } from '../store.ts'
import type { SidebarRootInjected, SidebarSectionOwnerProps } from './contract.ts'
import css from './sidebar.module.css'
import menu from '../faberloom.module.css'

/** One rendered row: a Space and its nesting depth below its root. */
interface SpaceTreeRow {
  /** The Space this row draws. */
  space: FaberLoomOverview['spaces'][number]
  /** Nesting depth; 0 for a root Space. */
  depth: number
}

/**
 * Order Spaces depth-first under their parents. A Space whose parent is absent
 * from the read is treated as a root so an orphan stays reachable.
 * @param spaces - the overview's Spaces in read order.
 * @returns rows in display order, each with its depth.
 */
function flattenSpaces(spaces: readonly FaberLoomOverview['spaces'][number][]): readonly SpaceTreeRow[] {
  const known = new Set(spaces.map(space => space.id))
  const children = new Map<string | null, FaberLoomOverview['spaces'][number][]>()
  for (const space of spaces) {
    const parent = space.parentId !== null && known.has(space.parentId) ? space.parentId : null
    const list = children.get(parent) ?? []
    list.push(space)
    children.set(parent, list)
  }
  const rows: SpaceTreeRow[] = []
  const walk = (parent: string | null, depth: number): void => {
    for (const space of children.get(parent) ?? []) {
      rows.push({ space, depth })
      walk(space.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** Props: the shell's owner share, the panel store, the tree actions, and copy. */
type SpacesFallbackProps =
  Pick<SidebarSectionOwnerProps, 'wide' | 'expandSidebar'>
  & Pick<PropsStore<ReturnType<typeof createWorkspaceStore>>, 'useStore'>
  & Pick<InjectFace<SidebarRootInjected>, 'load' | 'openSpace'>
  & Pick<PropsRenderSlots<'faberloom.spaces.rowMenu'>, 'renderSlot'>
  & PropsLocale<'faberloom'>

/**
 * Draw the Space tree in the browsing region.
 * @param props - fold state, the shared overview store, tree actions, and copy.
 * @returns the rail icon, or the tree with one menu per row.
 */
export function SpacesFallback({
  wide, expandSidebar, useStore, load, openSpace, renderSlot, t,
}: SpacesFallbackProps): ReactNode {
  const overview = useStore(state => state.overview)
  const status = useStore(state => state.status)
  const rows = useMemo(() => flattenSpaces(overview?.spaces ?? []), [overview])
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  // The Host browser normally triggers the read; in this tree the shell does.
  useEffect(() => {
    if (overview === null) loadRef.current()
  }, [overview])

  // A menu closes on Escape and on any pointer press outside the list, so the
  // next row's button keeps its own toggle instead of fighting a leftover menu.
  useEffect(() => {
    if (openId === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenId(null)
    }
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && list.current?.contains(event.target) === true) return
      setOpenId(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [openId])

  if (!wide) {
    return (
      <Tooltip label={t('sidebar.workspaces')} delayMs={500} side="right">
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('sidebar.workspaces')}
          onClick={() => { expandSidebar() }}
        >
          <FlIconWorkspace size={18} />
        </button>
      </Tooltip>
    )
  }

  const empty = rows.length === 0

  return (
    <div className={css.spaces} ref={list}>
      <div className={css.spacesHead}>
        <span className={css.spacesTitle}>{t('sidebar.workspaces')}</span>
        {empty ? null : <span className={css.spacesCount}>{rows.length}</span>}
      </div>
      {empty
        ? status === 'loading' ? null : <p className={css.spacesEmpty}>{t('sidebar.workspaces.empty')}</p>
        : (
          <ul className={css.spacesList}>
            {rows.map(({ space, depth }) => {
              const owner: WorkspaceRowMenuOwnerProps | null = space.workspaceId === null
                ? null
                : {
                  // The overview carries the mirrored Workspace id as the Host
                  // registry's own branded id in plain string form.
                  workspaceId: space.workspaceId as WorkspaceRowMenuOwnerProps['workspaceId'],
                  title: space.title,
                  close: () => { setOpenId(null) },
                }
              return (
                <li key={space.id} className={css.spaceItem}>
                  <div className={css.spaceRow} style={{ paddingLeft: `${String(8 + depth * 14)}px` }}>
                    <button
                      type="button"
                      className={css.spaceOpen}
                      title={space.folderPath}
                      onClick={() => { openSpace(space.id) }}
                    >
                      {depth > 0
                        ? <span className={css.spaceBranch} aria-hidden="true">↳</span>
                        : <span className={css.spaceGlyph} aria-hidden="true"><FlIconWorkspace size={14} /></span>}
                      <span className={css.spaceName}>{space.title}</span>
                    </button>
                    {owner === null ? null : (
                      <button
                        type="button"
                        className={css.spaceMenuButton}
                        aria-label={t('sidebar.workspaces.rowMenu', { name: space.title })}
                        aria-haspopup="menu"
                        aria-expanded={openId === space.id}
                        onClick={() => { setOpenId(openId === space.id ? null : space.id) }}
                      >
                        …
                      </button>
                    )}
                  </div>
                  {owner === null || openId !== space.id ? null : (
                    <div className={css.spaceMenu} role="menu" aria-label={t('sidebar.workspaces.rowMenu', { name: space.title })}>
                      <button
                        type="button"
                        role="menuitem"
                        className={menu.workspaceMenuRow}
                        onClick={() => {
                          setOpenId(null)
                          openSpace(space.id)
                        }}
                      >
                        <span className={menu.workspaceMenuLabel}>{t('workspaces.openSpace')}</span>
                      </button>
                      {renderSlot('faberloom.spaces.rowMenu', owner)}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}
