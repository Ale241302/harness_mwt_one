/**
 * The Workspace move/convert contribution. The sidebar row menu opens a dialog
 * that re-parents the Space mirrored by one Workspace: a root becomes a
 * sub-space, a sub-space changes parent, or a sub-space returns to the root.
 * The host moves the folder with its files and sub-spaces.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'
import { Field } from './components.tsx'
import { uniqueSpaces } from './space-options.ts'
import styles from './faberloom.module.css'

/** One Workspace row asked to change its parent Space. */
export interface WorkspaceMoveRequest {
  /** Workspace whose mirrored Space moves. */
  readonly workspaceId: string
  /** Display title shown in the dialog. */
  readonly title: string
}

/** Dialog state shared by the row-menu item and the overlay host. */
export interface WorkspaceMoveState {
  /** Pending request, or null while closed. */
  request: WorkspaceMoveRequest | null
  /** Spaces read for the target selector. */
  spaces: readonly FaberLoomOverview['spaces'][number][]
  /** Selected parent Space id, or empty for the root. */
  parentId: string
  /** True while the read or write is in flight. */
  saving: boolean
  /** Last failure message, or null. */
  message: string | null
}

/** Declared action shape giving the exported factory a stable return type. */
type WorkspaceMoveActions = {
  /** Open the dialog for one Workspace. */
  requestMove: (draft: WorkspaceMoveState, request: WorkspaceMoveRequest) => void
  /** Publish the loaded Spaces. */
  setSpaces: (draft: WorkspaceMoveState, spaces: WorkspaceMoveState['spaces']) => void
  /** Select the destination parent, or empty for the root. */
  setParent: (draft: WorkspaceMoveState, parentId: string) => void
  /** Mark a read or write in flight. */
  setSaving: (draft: WorkspaceMoveState, saving: boolean) => void
  /** Publish or clear the dialog's failure message. */
  setMessage: (draft: WorkspaceMoveState, message: string | null) => void
  /** Close the dialog and drop its state. */
  close: (draft: WorkspaceMoveState) => void
}

/**
 * Declares the move dialog state and write surface.
 * @returns the store handle both registrations share.
 */
export function createWorkspaceMoveStore(): EngineStoreHandle<WorkspaceMoveState, WorkspaceMoveActions> {
  return defineStore({
    init: (): WorkspaceMoveState => ({ request: null, spaces: [], parentId: '', saving: false, message: null }),
    actions: {
      requestMove: (draft, request) => {
        draft.request = request
        draft.parentId = ''
        draft.message = null
        draft.saving = false
      },
      setSpaces: (draft, spaces) => { draft.spaces = spaces },
      setParent: (draft, parentId) => { draft.parentId = parentId },
      setSaving: (draft, saving) => { draft.saving = saving },
      setMessage: (draft, message) => { draft.message = message },
      close: (draft) => {
        draft.request = null
        draft.spaces = []
        draft.parentId = ''
        draft.saving = false
        draft.message = null
      },
    },
  })
}

/** The injected move capability the dialog host receives. */
export interface WorkspaceMoveInjected {
  /** Read the overview so the dialog can find the mirrored Space. */
  load: () => Promise<FaberLoomOverview>
  /**
   * Move one Space under a parent, or promote it with null.
   * @param spaceId - the mirrored Space id.
   * @param parentId - destination parent, or null for the root.
   * @returns whether the write succeeded and its failure message.
   */
  move: (spaceId: string, parentId: string | null) => Promise<{ readonly ok: boolean; readonly message: string }>
}

/** Dialog host props: overlay runtime, shared store, move action, and copy. */
type MoveDialogProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkspaceMoveStore>>
  & InjectFace<WorkspaceMoveInjected>
  & PropsLocale<'faberloom'>

/** Row-menu row props: the owner share, the shared store, and copy. */
type MoveMenuItemProps = PropsRuntime<'sidebar.workspaces.rowMenu'>
  & PropsStore<ReturnType<typeof createWorkspaceMoveStore>>
  & PropsLocale<'faberloom'>

/** Every descendant id of one Space, so a parent cannot become its own child. */
function descendantsOf(spaces: WorkspaceMoveState['spaces'], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const space of spaces) {
    if (space.parentId === null) continue
    const list = children.get(space.parentId) ?? []
    list.push(space.id)
    children.set(space.parentId, list)
  }
  const out = new Set<string>()
  const walk = (parent: string): void => {
    for (const child of children.get(parent) ?? []) {
      if (out.has(child)) continue
      out.add(child)
      walk(child)
    }
  }
  walk(id)
  return out
}

/** Prefix the target options with their nesting depth. */
function targetLabel(spaces: WorkspaceMoveState['spaces'], space: WorkspaceMoveState['spaces'][number]): string {
  let depth = 0
  let current = space
  const byId = new Map(spaces.map(candidate => [candidate.id, candidate]))
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId)
    if (parent === undefined) break
    depth += 1
    current = parent
  }
  return `${'— '.repeat(depth)}${space.title}`
}

/**
 * The overlay host for the move dialog.
 * @param props - overlay runtime, shared store, move action, and copy.
 * @returns the modal, or null while closed.
 */
export function WorkspaceMoveDialog({ useStore, actions, load, move, t }: MoveDialogProps): ReactNode {
  const request = useStore(state => state.request)
  const spaces = useStore(state => state.spaces)
  const parentId = useStore(state => state.parentId)
  const saving = useStore(state => state.saving)
  const message = useStore(state => state.message)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (request === null) return
    let live = true
    actions.setSaving(true)
    actions.setMessage(null)
    void loadRef.current().then((overview) => {
      if (!live) return
      actions.setSpaces(overview.spaces)
      const current = overview.spaces.find(space => space.workspaceId === request.workspaceId)
      actions.setParent(current?.parentId ?? '')
      actions.setSaving(false)
    }).catch((cause: unknown) => {
      if (!live) return
      actions.setSaving(false)
      actions.setMessage(String(cause))
    })
    return () => { live = false }
  }, [actions, request])

  const unique = useMemo(() => uniqueSpaces(spaces), [spaces])
  if (request === null) return null
  const current = unique.find(space => space.workspaceId === request.workspaceId)
    ?? spaces.find(space => space.workspaceId === request.workspaceId)
  const blocked = current === undefined ? new Set<string>() : descendantsOf(unique, current.id)
  if (current !== undefined) blocked.add(current.id)
  const submit = (): void => {
    if (current === undefined) return
    actions.setSaving(true)
    actions.setMessage(null)
    void move(current.id, parentId.length === 0 ? null : parentId).then((result) => {
      actions.setSaving(false)
      if (!result.ok) { actions.setMessage(result.message); return }
      actions.close()
    })
  }

  return (
    <Modal
      open
      onClose={() => { actions.close() }}
      className={styles.shareDialogWide ?? ''}
      title={request.title.length === 0 ? t('workspaces.moveTitle') : request.title}
      closeLabel={t('action.close')}
      footer={(
        <>
          <button className={styles.ghost} type="button" onClick={() => { actions.close() }}>{t('action.cancel')}</button>
          <button className={styles.primary} type="button" disabled={saving || current === undefined} onClick={submit}>{t('workspaces.moveSubmit')}</button>
        </>
      )}
    >
      <div className={styles.workflowForm}>
        {current === undefined
          ? <span className={styles.cellMuted}>{t('workspaces.moveNoSpace')}</span>
          : (
            <>
              <Field label={t('workspaces.moveParent')} hint={t('workspaces.moveHint')}>
                <select value={parentId} onChange={(event) => { actions.setParent(event.target.value) }}>
                  <option value="">{t('workspaces.moveRoot')}</option>
                  {unique
                    .filter(space => !blocked.has(space.id))
                    .map(space => <option key={space.id} value={space.id}>{targetLabel(unique, space)}</option>)}
                </select>
              </Field>
              {message === null ? null : <span className={styles.cellMuted}>{message}</span>}
            </>
          )}
      </div>
    </Modal>
  )
}

/**
 * The row-menu row that requests the move dialog.
 * @param props - the row's owner, shared store, and copy.
 * @returns the menu row.
 */
export function WorkspaceMoveMenuItem({ workspaceId, title, close, actions, t }: MoveMenuItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.workspaceMenuRow}
      onClick={() => {
        close()
        actions.requestMove({ workspaceId, title })
      }}
    >
      <span className={styles.workspaceMenuIcon} aria-hidden="true">↳</span>
      <span className={styles.workspaceMenuLabel}>{t('workspaces.move')}</span>
    </button>
  )
}
