/**
 * The Workspace "Create sub Space" contribution. The sidebar row menu opens a
 * small name dialog; the host resolves the Space a Workspace mirrors and
 * creates a child Space under it. Two registrations share one store handle so
 * the dialog survives the row dropdown closing.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the SlotMap merges for both registration targets.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Field } from './components.tsx'
import styles from './faberloom.module.css'

/** One Workspace row asked to create a child Space. */
export interface WorkspaceSubspaceRequest {
  /** Workspace whose mirrored Space becomes the parent. */
  readonly workspaceId: string
  /** Display title of the parent, shown in the dialog. */
  readonly title: string
}

/** Dialog state shared by the row-menu item and the overlay host. */
export interface WorkspaceSubspaceState {
  /** Pending request, or null while closed. */
  request: WorkspaceSubspaceRequest | null
  /** True while the create write is in flight. */
  saving: boolean
  /** Last failure message, or null. */
  message: string | null
}

/** Declared action shape giving the exported factory a stable return type. */
type WorkspaceSubspaceActions = {
  /** Open the dialog for one Workspace. */
  requestCreate: (draft: WorkspaceSubspaceState, request: WorkspaceSubspaceRequest) => void
  /** Mark the create write in flight. */
  setSaving: (draft: WorkspaceSubspaceState, saving: boolean) => void
  /** Publish or clear the dialog's failure message. */
  setMessage: (draft: WorkspaceSubspaceState, message: string | null) => void
  /** Close the dialog and drop its state. */
  close: (draft: WorkspaceSubspaceState) => void
}

/**
 * Declares the create-sub-Space dialog state and write surface.
 * @returns the store handle both registrations share.
 */
export function createWorkspaceSubspaceStore(): EngineStoreHandle<WorkspaceSubspaceState, WorkspaceSubspaceActions> {
  return defineStore({
    init: (): WorkspaceSubspaceState => ({ request: null, saving: false, message: null }),
    actions: {
      requestCreate: (draft, request) => {
        draft.request = request
        draft.saving = false
        draft.message = null
      },
      setSaving: (draft, saving) => { draft.saving = saving },
      setMessage: (draft, message) => { draft.message = message },
      close: (draft) => {
        draft.request = null
        draft.saving = false
        draft.message = null
      },
    },
  })
}

/** The injected create capability the dialog host receives. */
export interface WorkspaceSubspaceInjected {
  /**
   * Create one child Space under the Space a Workspace mirrors.
   * @param workspaceId - Workspace whose Space becomes the parent.
   * @param title - new child Space title.
   * @returns whether the write succeeded and its failure message.
   */
  create: (workspaceId: string, title: string) => Promise<{ readonly ok: boolean; readonly message: string }>
}

/** Dialog host props: overlay runtime, shared store, create action, and copy. */
type SubspaceDialogProps = PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkspaceSubspaceStore>>
  & InjectFace<WorkspaceSubspaceInjected>
  & PropsLocale<'faberloom'>

/** Row-menu row props: the owner share, the shared store, and copy. */
type SubspaceMenuItemProps = PropsRuntime<'sidebar.workspaces.rowMenu'>
  & PropsStore<ReturnType<typeof createWorkspaceSubspaceStore>>
  & PropsLocale<'faberloom'>

/**
 * The overlay host for the create-sub-Space dialog.
 * @param props - overlay runtime, shared store, create action, and copy.
 * @returns the modal, or null while closed.
 */
export function WorkspaceSubspaceDialog({ useStore, actions, create, t }: SubspaceDialogProps): ReactNode {
  const request = useStore(state => state.request)
  const saving = useStore(state => state.saving)
  const message = useStore(state => state.message)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (request === null) return
    setName('')
    inputRef.current?.focus()
  }, [request])

  if (request === null) return null

  const close = (): void => {
    actions.close()
    setName('')
  }

  const submit = (): void => {
    const title = name.trim()
    if (title.length === 0 || saving) return
    actions.setSaving(true)
    actions.setMessage(null)
    void create(request.workspaceId, title).then((result) => {
      actions.setSaving(false)
      if (!result.ok) {
        actions.setMessage(result.message)
        return
      }
      close()
    }).catch((cause: unknown) => {
      actions.setSaving(false)
      actions.setMessage(String(cause))
    })
  }

  return (
    <Modal
      open
      onClose={close}
      className={styles.shareDialogWide ?? ''}
      title={t('workspaces.createSubspaceTitle')}
      closeLabel={t('action.close')}
      footer={(
        <>
          <button className={styles.ghost} type="button" onClick={close}>{t('action.cancel')}</button>
          <button className={styles.primary} type="button" disabled={saving || name.trim().length === 0} onClick={submit}>{t('action.create')}</button>
        </>
      )}
    >
      <div className={styles.workflowForm}>
        <Field label={t('workspaces.createSubspaceName')} hint={t('workspaces.createSubspaceHint', { name: request.title })}>
          <input
            ref={inputRef}
            type="text"
            aria-label={t('workspaces.createSubspaceName')}
            placeholder={t('workspaces.createSubspaceName')}
            value={name}
            disabled={saving}
            onChange={(event) => { setName(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </Field>
        {message === null ? null : <span className={styles.cellMuted}>{message}</span>}
      </div>
    </Modal>
  )
}

/**
 * The row-menu row that requests the create-sub-Space dialog.
 * @param props - the row's owner, shared store, and copy.
 * @returns the menu row.
 */
export function WorkspaceSubspaceMenuItem({ workspaceId, title, close, actions, t }: SubspaceMenuItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.workspaceMenuRow}
      onClick={() => {
        close()
        actions.requestCreate({ workspaceId, title })
      }}
    >
      <span className={styles.workspaceMenuIcon}><IconPlusOutline16 /></span>
      <span className={styles.workspaceMenuLabel}>{t('workspaces.createSubspace')}</span>
    </button>
  )
}
