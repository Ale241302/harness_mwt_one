/**
 * The device tree in the sidebar's browsing region: every Workspace this
 * machine registered, the Spaces it hosts, their sub Spaces, and the Sessions.
 *
 * The stock browser registers the same region but reads the platform workspace
 * stream, which the composition that mounts this column never feeds — the header
 * drew and the list stayed empty. This tree reads the same two framework
 * snapshots the conversation surfaces read (`useWorkspaces`, `useSessions`) plus
 * the shared overview the panels already hold, so the folder a Space lives in and
 * the conversations of its Workspace appear together.
 *
 * Adding a folder is not duplicated here: the `+` selects the Workspaces panel,
 * which owns the picker, the Space it creates, and its errors.
 */
import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { FlIconChevron, FlIconPlus, FlIconWorkspace } from '../ui/faberloom-icons.tsx'
import { IconFolderClose16, IconFolderOpen16, IconNewChatOutline16, IconTreeCorner8x10 } from '../ui/glyphs.tsx'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import type { createWorkspaceStore } from '../store.ts'
import type { FaberloomKey } from '../locales.ts'
import css from './sidebar.module.css'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** One Space row the tree draws. */
type SpaceRow = FaberLoomOverview['spaces'][number]

/** What the tree reads and the three gestures it offers. */
export type SidebarTreeProps =
  & Pick<PropsRuntime<'sidebar'>, 'useSessions' | 'useWorkspaces'>
  & Pick<PropsStore<ReturnType<typeof createWorkspaceStore>>, 'useStore'>
  & {
    /** Copy seat for this namespace. */
    t: (key: FaberloomKey) => string
    /** Fold-state output: false renders the single rail entry. */
    wide: boolean
    /** Open one Session in the conversation view. */
    openSession: (sessionId: string) => void
    /** Start a New Session in a Workspace, or the default one. */
    startSession: (workspaceId?: string) => void
    /** Reveal the Workspaces panel, which owns the folder picker. */
    openWorkspaces: () => void
  }

/**
 * Render the Workspace tree.
 * @param props - framework snapshots, copy, and the navigation callbacks.
 * @returns the browsing region for this column.
 */
export function SidebarTree({
  useSessions, useWorkspaces, useStore, t, wide, openSession, startSession, openWorkspaces,
}: SidebarTreeProps) {
  const workspaces = useWorkspaces(state => state.items)
  const sessionsById = useSessions(state => state.byId)
  const current = useSessions(state => state.current)
  const overview = useStore(state => state.overview)
  // Every Workspace starts folded: the region shares the column's height with
  // the panel rows, so the list costs one row until the operator asks for it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const spaces = useMemo(() => overview?.spaces ?? [], [overview])
  const childSpaces = useMemo(() => {
    const map = new Map<string, SpaceRow[]>()
    for (const space of spaces) {
      const key = space.parentId ?? ''
      const rows = map.get(key)
      if (rows === undefined) map.set(key, [space])
      else rows.push(space)
    }
    return map
  }, [spaces])
  const rootsOf = (workspaceId: string, path: string): SpaceRow[] =>
    spaces.filter(space => (space.parentId === null) && (space.workspaceId === workspaceId || space.folderPath === path))
  const toggle = (id: string): void => {
    setExpanded((open) => {
      const next = new Set(open)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const spaceRows = (roots: readonly SpaceRow[], depth: number): ReactNode => roots.map((space) => {
    const children = childSpaces.get(space.id) ?? []
    const key = `space:${space.id}`
    const open = expanded.has(key)
    return (
      <li key={key}>
        <div className={css.browserRowWrap} style={{ paddingLeft: `${String(depth * 12)}px` }}>
          <button
            type="button"
            className={css.browserRow}
            aria-expanded={children.length === 0 ? undefined : open}
            disabled={children.length === 0}
            onClick={() => { toggle(key) }}
          >
            <span className={css.browserCaret}>
              {children.length === 0 ? <span className={css.browserCorner}><IconTreeCorner8x10 /></span> : (
                <FlIconChevron size={12} className={clsx(css.browserCaretGlyph, open && css.browserCaretOpen)} />
              )}
            </span>
            <span className={css.browserIcon}>{open ? <IconFolderOpen16 /> : <IconFolderClose16 />}</span>
            <span className={css.browserName}>{space.title}</span>
          </button>
        </div>
        {open && children.length > 0 ? <ul className={css.browserSessions}>{spaceRows(children, depth + 1)}</ul> : null}
      </li>
    )
  })
  if (!wide) {
    return (
      <button
        type="button"
        className={css.browserRail}
        aria-label={t('sidebar.workspaces')}
        title={t('sidebar.workspaces')}
        onClick={openWorkspaces}
      >
        <FlIconWorkspace size={18} />
      </button>
    )
  }
  return (
    <section className={css.browser} aria-label={t('sidebar.workspaces')}>
      <div className={css.browserHead}>
        <span className={css.browserTitle}>{t('sidebar.workspaces')}</span>
        <button
          type="button"
          className={css.browserAdd}
          aria-label={t('sidebar.workspaces.add')}
          title={t('sidebar.workspaces.add')}
          onClick={openWorkspaces}
        >
          <FlIconPlus size={14} />
        </button>
      </div>
      {workspaces.length === 0
        ? <p className={css.browserEmpty}>{t('sidebar.workspaces.empty')}</p>
        : (
          <ul className={css.browserList}>
            {workspaces.map((workspace) => {
              const open = expanded.has(`ws:${workspace.workspaceId}`)
              const sessions = workspace.sessionIds
                .map(id => sessionsById[id])
                .filter((session): session is NonNullable<typeof session> => session !== undefined)
              const roots = rootsOf(workspace.workspaceId, workspace.path)
              return (
                <li key={workspace.workspaceId}>
                  <div className={css.browserRowWrap}>
                    <button
                      type="button"
                      className={css.browserRow}
                      aria-expanded={open}
                      onClick={() => { toggle(`ws:${workspace.workspaceId}`) }}
                    >
                      <span className={css.browserCaret}>
                        <FlIconChevron size={12} className={clsx(css.browserCaretGlyph, open && css.browserCaretOpen)} />
                      </span>
                      <span className={css.browserIcon}>
                        {open ? <IconFolderOpen16 /> : <IconFolderClose16 />}
                      </span>
                      <span className={css.browserName}>{workspace.title}</span>
                      <span className={css.browserMeta}>{String(sessions.length)}</span>
                    </button>
                    <button
                      type="button"
                      className={css.browserAction}
                      aria-label={`${t('sidebar.newSession')} — ${workspace.title}`}
                      title={`${t('sidebar.newSession')} — ${workspace.title}`}
                      onClick={() => { startSession(workspace.workspaceId) }}
                    >
                      <FlIconPlus size={12} />
                    </button>
                  </div>
                  {open && (
                    <ul className={css.browserSessions}>
                      {spaceRows(roots, 1)}
                      {sessions.map(session => (
                        <li key={session.id}>
                          <button
                            type="button"
                            className={css.browserSession}
                            aria-current={session.id === current ? 'true' : undefined}
                            onClick={() => { openSession(session.id) }}
                          >
                            <span className={css.browserIcon}><IconNewChatOutline16 /></span>
                            <span className={css.browserSessionName}>{session.displayTitle}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}
