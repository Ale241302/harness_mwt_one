/**
 * The Workspace Share contribution. Two registrations share one store handle:
 * `shell.overlay` hosts the dialog (so it survives the row dropdown closing),
 * and `sidebar.workspaces.rowMenu` renders the menu row that requests it. The
 * Space a Workspace mirrors is shared through the injected `share` callback.
 */
import { useState, type ReactNode } from 'react'
import { IconShareOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the SlotMap merges for both registration targets.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Field } from './components.tsx'
import { SHARE_PERMISSION_OPTIONS } from './panels.tsx'
import styles from './faberloom.module.css'

/** The Workspace row's menu asked to share, or null while the dialog is closed. */
export interface WorkspaceShareRequest {
  /** Workspace whose mirrored Space is shared. */
  readonly workspaceId: string
  /** Display title shown in the dialog. */
  readonly title: string
}

/** Dialog state shared by the row-menu row and the overlay host. */
export interface WorkspaceShareState {
  /** The pending request, or null when no dialog is open. */
  request: WorkspaceShareRequest | null
  /** True while the share write is in flight. */
  saving: boolean
  /** Last failure message, or null. */
  message: string | null
}

/** Declared action shape giving the exported factory a stable return type. */
type WorkspaceShareActions = {
  /** Open the dialog for one Workspace. */
  requestShare: (draft: WorkspaceShareState, request: WorkspaceShareRequest) => void
  /** Close the dialog and drop its message. */
  close: (draft: WorkspaceShareState) => void
  /** Mark a share write in flight. */
  setSaving: (draft: WorkspaceShareState, saving: boolean) => void
  /** Publish or clear the dialog's failure message. */
  setMessage: (draft: WorkspaceShareState, message: string | null) => void
}

/**
 * Declares the share dialog state and write surface.
 * @returns the store handle both registrations share.
 */
export function createWorkspaceShareStore(): EngineStoreHandle<WorkspaceShareState, WorkspaceShareActions> {
  return defineStore({
    init: (): WorkspaceShareState => ({ request: null, saving: false, message: null }),
    actions: {
      requestShare: (draft, request) => { draft.request = request; draft.message = null; draft.saving = false },
      close: (draft) => { draft.request = null; draft.message = null; draft.saving = false },
      setSaving: (draft, saving) => { draft.saving = saving },
      setMessage: (draft, message) => { draft.message = message },
    },
  })
}

/** The injected share capability the dialog host receives. */
export interface WorkspaceShareInjected {
  /**
   * Share the Space a Workspace mirrors with the given emails and permissions.
   * @param workspaceId - Workspace whose mirrored Space is shared.
   * @param emails - grantees.
   * @param permissions - permission subset each grantee receives.
   * @returns whether the write succeeded and its failure message when it did not.
   */
  share: (
    workspaceId: string, emails: readonly string[], permissions: readonly string[],
  ) => Promise<{ readonly ok: boolean; readonly message: string }>
}

/** Dialog host props: overlay runtime, the shared store, the share action, and copy. */
type ShareDialogProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkspaceShareStore>>
  & InjectFace<WorkspaceShareInjected>
  & PropsLocale<'faberloom'>

/** Row-menu row props: the owner share plus the same shared store and copy. */
type ShareMenuItemProps = PropsRuntime<'sidebar.workspaces.rowMenu'>
  & PropsStore<ReturnType<typeof createWorkspaceShareStore>>
  & PropsLocale<'faberloom'>

/**
 * The overlay dialog host: renders the share form while a request is pending.
 * @param props - overlay runtime, shared store, share action, and copy.
 * @returns the modal, or null while closed.
 */
export function WorkspaceShareDialog({ useStore, actions, share, t }: ShareDialogProps): ReactNode {
  const request = useStore(state => state.request)
  const saving = useStore(state => state.saving)
  const message = useStore(state => state.message)
  const [emails, setEmails] = useState('')
  const [permissions, setPermissions] = useState<readonly string[]>(['view'])

  const close = (): void => {
    actions.close()
    setEmails('')
    setPermissions(['view'])
  }

  if (request === null) return null

  const submit = (): void => {
    const list = emails.split(',').map(value => value.trim()).filter(value => value.length > 0)
    if (list.length === 0) {
      actions.setMessage(t('workspaces.shareNeedTarget'))
      return
    }
    actions.setSaving(true)
    actions.setMessage(null)
    void share(request.workspaceId, list, permissions).then((result) => {
      actions.setSaving(false)
      if (!result.ok) {
        actions.setMessage(result.message)
        return
      }
      close()
    })
  }

  return (
    <Modal
      open
      onClose={close}
      title={request.title.length === 0 ? t('workspaces.shareTitle') : request.title}
      closeLabel={t('action.close')}
      footer={(
        <>
          <button className={styles.ghost} type="button" onClick={close}>{t('action.cancel')}</button>
          <button className={styles.primary} type="button" disabled={saving} onClick={submit}>{t('wf.share.submit')}</button>
        </>
      )}
    >
      <div className={styles.workflowForm}>
        <Field label={t('wf.share.email')}>
          <input
            aria-label={t('wf.share.email')}
            placeholder={t('wf.share.email')}
            value={emails}
            onChange={(event) => { setEmails(event.target.value) }}
          />
        </Field>
        <Field label={t('wf.share.permissions')}>
          <div className={styles.workflowPermissions}>
            {SHARE_PERMISSION_OPTIONS.map(permission => (
              <label key={permission} className={`${styles.workflowPermission} ${permissions.includes(permission) ? styles.workflowPermissionOn : ''}`}>
                <input
                  type="checkbox"
                  checked={permissions.includes(permission)}
                  onChange={() => {
                    setPermissions(current => current.includes(permission)
                      ? current.filter(entry => entry !== permission)
                      : [...current, permission])
                  }}
                />
                {permission}
              </label>
            ))}
          </div>
        </Field>
        {message === null ? null : <span className={styles.cellMuted}>{message}</span>}
      </div>
    </Modal>
  )
}

/**
 * The row-menu row that requests the dialog.
 * @param props - the row's owner share, the shared store, and copy.
 * @returns the menu row.
 */
export function WorkspaceShareMenuItem({ workspaceId, title, close, actions, t }: ShareMenuItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.workspaceMenuRow}
      onClick={() => {
        close()
        actions.requestShare({ workspaceId, title })
      }}
    >
      <span className={styles.workspaceMenuIcon}><IconShareOutline16 /></span>
      <span className={styles.workspaceMenuLabel}>{t('workspaces.share')}</span>
    </button>
  )
}
