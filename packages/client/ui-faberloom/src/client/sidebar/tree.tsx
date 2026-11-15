/**
 * The device tree in the sidebar's browsing region: every Workspace this
 * machine registered and the Sessions inside it.
 *
 * The stock browser registers the same region but reads the platform workspace
 * stream, which the composition that mounts this column never feeds — the header
 * drew and the list stayed empty. This tree reads the same two framework
 * snapshots the conversation surfaces read (`useWorkspaces`, `useSessions`), so
 * what the stock app shows and what the product shows cannot drift apart.
 *
 * Adding a folder is not duplicated here: the `+` selects the Workspaces panel,
 * which owns the picker, the Space it creates, and its errors.
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FlIconChevron, FlIconPlus, FlIconWorkspace } from '../ui/faberloom-icons.tsx'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberloomKey } from '../locales.ts'
import css from './sidebar.module.css'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'

/** What the tree reads and the two gestures it offers. */
export type SidebarTreeProps =
  & Pick<PropsRuntime<'sidebar'>, 'useSessions' | 'useWorkspaces'>
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
export function SidebarTree({ useSessions, useWorkspaces, t, wide, openSession, startSession, openWorkspaces }: SidebarTreeProps) {
  const workspaces = useWorkspaces(state => state.items)
  const sessionsById = useSessions(state => state.byId)
  const current = useSessions(state => state.current)
  // Every Workspace starts folded: the region shares the column's height with
  // the panel rows, so the list costs one row until the operator asks for it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(() => workspaces.map(workspace => ({
    workspace,
    sessions: workspace.sessionIds
      .map(id => sessionsById[id])
      .filter((session): session is NonNullable<typeof session> => session !== undefined),
  })), [workspaces, sessionsById])
  const toggle = (id: string): void => {
    setExpanded((open) => {
      const next = new Set(open)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
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
      {rows.length === 0
        ? <p className={css.browserEmpty}>{t('sidebar.workspaces.empty')}</p>
        : (
          <ul className={css.browserList}>
            {rows.map(({ workspace, sessions }) => {
              const open = expanded.has(workspace.workspaceId)
              return (
                <li key={workspace.workspaceId}>
                  <div className={css.browserRowWrap}>
                    <button
                      type="button"
                      className={css.browserRow}
                      aria-expanded={open}
                      onClick={() => { toggle(workspace.workspaceId) }}
                    >
                      <FlIconChevron size={12} className={clsx(css.browserCaret, open && css.browserCaretOpen)} />
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
                      {sessions.map(session => (
                        <li key={session.id}>
                          <button
                            type="button"
                            className={css.browserSession}
                            aria-current={session.id === current ? 'true' : undefined}
                            onClick={() => { openSession(session.id) }}
                          >
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
