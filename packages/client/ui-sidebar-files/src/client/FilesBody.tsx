/**
 * The file tree's body: the session's workspace root, listed one level at a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it asks
 * for goes through its injected face. The component itself only decides what to
 * draw for each absolute path and what a click means: a directory toggles, a
 * file opens through the owner's `tabActions` for a `file:` viewer to claim, and
 * anything else is shown but refuses to open. Each row carries one more-actions
 * control and the header one new-entry control, both opening a menu for the
 * three workspace mutations; a mutation's outcome is the host's, so a success
 * re-lists the level it changed and a refusal is shown in the dialog that asked.
 * The header row is the text preview's: the root's path, directories greyed and
 * the last segment in full ink, then the controls at its end.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, FileTypeIcon, IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16,
  IconRefreshOutline16, Input, Menu, Modal, classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { childPath } from './face.ts'
import type { FilesInjected } from './face.ts'
import type {} from './locales.ts'
import type { FilesTabState, createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The header control's key in the one-open-menu state; no real path uses it. */
const HEADER_MENU = '\u0000header'

/** Which mutation dialog is open, and what its confirm does. */
type MutationDialog =
  | { readonly kind: 'create'; readonly parent: string; readonly entry: 'file' | 'directory' }
  | { readonly kind: 'rename'; readonly parent: string; readonly path: string }
  | { readonly kind: 'delete'; readonly parent: string; readonly path: string; readonly recursive: boolean }

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * The last segment of one path, whatever separator it uses.
 * @param path - an absolute path.
 * @returns the entry's own name.
 */
export function nameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * Whether one typed name can be a single path segment.
 * @param name - the name as typed.
 * @returns true for a non-empty name without a separator.
 */
function isSingleName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

/**
 * Say why a directory could not be listed or a mutation was refused, in terms
 * of the entry.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory or in the dialog.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    case 'workspace-file/already-exists': return t('error.alreadyExists')
    case 'workspace-file/directory-not-empty': return t('error.directoryNotEmpty')
    case 'workspace-file/root-refused': return t('error.rootRefused')
    case 'workspace-file/symlink-refused': return t('error.symlinkRefused')
    case 'workspace-file/bad-target': return t('error.badTarget')
    case 'workspace-file/unsupported-backend': return t('error.unsupportedBackend')
    case 'workspace-file/too-large': return t('error.tooLarge')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/* jscpd:ignore-start -- the header row is the document preview's (ui-sidebar-documentpreview
   TextPreview `usePathClipped`), copied because a plugin bundle shares runtime code
   only through the platform modules. TODO: once the artifact and slot surfaces
   settle, one copy in ui-primitives could serve every pane header. */
/**
 * Keep the path row's `data-files-path-clipped` current: set while the path's
 * text is wider than its box, so the stylesheet fades the clipped start. Read
 * after each commit that can change the path or mount the header, and whenever
 * either box resizes; written to the DOM directly because it changes only how
 * the stylesheet fades what is already rendered.
 */
function usePathClipped(
  box: RefObject<HTMLDivElement | null>,
  text: RefObject<HTMLSpanElement | null>,
  path: string | undefined,
): void {
  useLayoutEffect(() => {
    const outer = box.current
    const inner = text.current
    if (outer === null || inner === null) return undefined
    const apply = (): void => {
      if (inner.offsetWidth > outer.clientWidth) outer.dataset.filesPathClipped = ''
      else delete outer.dataset.filesPathClipped
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(outer)
    observer?.observe(inner)
    return () => { observer?.disconnect() }
  }, [box, text, path])
}
/* jscpd:ignore-end */

/** What every level shares: the tab's tree, the gestures, and the menu. */
interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
  /** The control whose menu is open: a path, or {@link HEADER_MENU} for the root's. */
  readonly menu: string | undefined
  readonly onMenu: (key: string | undefined) => void
  readonly onChoose: (choice: string, parent: string, path: string) => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/** The row menu one entry offers: the create gestures on a directory, then rename and delete. */
function rowMenu(t: TranslateNS<'sidebarFiles'>, directory: boolean): MenuEntry[] {
  return [
    ...directory ? [
      { id: 'new-file', label: t('menu.newFile') },
      { id: 'new-folder', label: t('menu.newFolder') },
      { type: 'separator' as const, id: 'row-separator' },
    ] : [],
    { id: 'rename', label: t('menu.rename') },
    { id: 'delete', label: t('menu.delete'), danger: true },
  ]
}

/** The more-actions control of one row, with its menu. */
function RowMenu({ parent, path, entry, tree }: {
  parent: string
  path: string
  entry: WorkspaceDirectoryEntry['type']
  tree: TreeContext
}): ReactNode {
  const open = tree.menu === path
  return (
    <Menu
      portal
      align="end"
      open={open}
      items={rowMenu(tree.t, entry === 'directory')}
      onSelect={(choice) => { tree.onChoose(choice, parent, path) }}
      onClose={() => { tree.onMenu(undefined) }}
      anchor={(
        <button
          type="button"
          className={css.action}
          aria-label={tree.t('menu.more')}
          title={tree.t('menu.more')}
          data-files-menu={path}
          onClick={() => { tree.onMenu(open ? undefined : path) }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  const action = entry.type === 'other' ? null : <RowMenu parent={parent} path={path} entry={entry.type} tree={tree} />
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <div className={css.line}>
          <button type="button" className={css.row} aria-expanded={expanded} data-files-row onClick={() => { tree.onToggle(path) }}>
            {expanded ? <IconFolderOpen16 className={css.icon} /> : <IconFolderClose16 className={css.icon} />}
            <span className={css.name}>{entry.name}</span>
          </button>
          {action}
        </div>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path}>
        <div className={css.line}>
          <button type="button" className={css.row} data-files-row onClick={() => { tree.onOpen(path) }}>
            <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
            <span className={css.name}>{entry.name}</span>
          </button>
          {action}
        </div>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <div className={css.line}>
        <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
          <span className={css.name}>{entry.name}</span>
        </span>
      </div>
    </li>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, load, toggle, create, rename, remove, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const pathRef = useRef<HTMLDivElement>(null)
  const pathTextRef = useRef<HTMLSpanElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const [menu, setMenu] = useState<string | undefined>(undefined)
  const [dialog, setDialog] = useState<MutationDialog | undefined>(undefined)
  const [name, setName] = useState('')
  const [failure, setFailure] = useState<RemoteFailure | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  usePathClipped(pathRef, pathTextRef, state?.root)
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null

  /** Open one dialog with a fresh name and no failure. */
  const openDialog = (next: MutationDialog, initialName: string): void => {
    setMenu(undefined)
    setFailure(undefined)
    setName(initialName)
    setDialog(next)
  }
  const closeDialog = (): void => { setDialog(undefined) }
  const choose = (choice: string, parent: string, path: string): void => {
    // Create targets the directory the menu was opened on, which for a row is
    // the row's own path; rename and delete name the row inside `parent`.
    switch (choice) {
      case 'new-file': openDialog({ kind: 'create', parent: path, entry: 'file' }, ''); break
      case 'new-folder': openDialog({ kind: 'create', parent: path, entry: 'directory' }, ''); break
      case 'rename': openDialog({ kind: 'rename', parent, path }, nameOf(path)); break
      default: openDialog({ kind: 'delete', parent, path, recursive: false }, ''); break
    }
  }
  // The mutation's outcome is the host's: a success closes the dialog and the
  // face re-lists the level; a refusal stays here, in terms of the call.
  const submit = async (open: MutationDialog): Promise<void> => {
    setBusy(true)
    const result = open.kind === 'create'
      ? await create(tab.id, open.parent, name.trim(), open.entry, signal)
      : open.kind === 'rename'
        ? await rename(tab.id, open.parent, open.path, name.trim(), signal)
        : await remove(tab.id, open.parent, open.path, open.recursive, signal)
    setBusy(false)
    if (result.ok) {
      setDialog(undefined)
      setFailure(undefined)
    } else {
      setFailure(result.error)
    }
  }

  const tree: TreeContext = {
    state,
    onToggle: (path) => { toggle(tab.id, path, state.levels[path] !== undefined, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
    menu,
    onMenu: setMenu,
    onChoose: choose,
    t,
  }
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reload = (): void => {
    actions.reset(tab.id)
    for (const path of state.expanded) load(tab.id, path, signal)
  }
  const dialogTitle = (open: MutationDialog): string => open.kind === 'create'
    ? t(open.entry === 'directory' ? 'dialog.newFolderTitle' : 'dialog.newFileTitle')
    : t(open.kind === 'rename' ? 'dialog.renameTitle' : 'dialog.deleteTitle')
  const { directory, name: rootName } = pathPartsOf(state.root)
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      {/* jscpd:ignore-start -- the text preview's header row; see `usePathClipped`. */}
      <div className={css.header}>
        <div ref={pathRef} className={css.path} title={state.root} data-files-path>
          <span ref={pathTextRef} className={css.pathText}>
            {directory !== '' && <span className={css.pathDirectory}>{directory}</span>}
            <span className={css.pathName}>{rootName}</span>
          </span>
        </div>
        <Menu
          portal
          align="end"
          open={menu === HEADER_MENU}
          items={[
            { id: 'new-file', label: t('menu.newFile') },
            { id: 'new-folder', label: t('menu.newFolder') },
          ]}
          onSelect={(choice) => { choose(choice, state.root, state.root) }}
          onClose={() => { setMenu(undefined) }}
          anchor={(
            <button
              type="button"
              className={css.tool}
              aria-label={t('new')}
              title={t('new')}
              data-files-new
              onClick={() => { setMenu(menu === HEADER_MENU ? undefined : HEADER_MENU) }}
            >
              <IconPlusOutline16 />
            </button>
          )}
        />
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-files-reload
          onClick={reload}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      {/* jscpd:ignore-end */}
      <div
        ref={bodyRef}
        className={css.body}
        data-files-body
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
      >
        <ul className={css.level}><Level path={state.root} tree={tree} /></ul>
      </div>
      {dialog !== undefined && (
        <Modal
          open
          onClose={closeDialog}
          title={dialogTitle(dialog)}
          closeLabel={t('close')}
          footer={(
            <>
              <Button variant="outline" onClick={closeDialog}>{t('cancel')}</Button>
              <Button
                variant="primary"
                disabled={busy || (dialog.kind !== 'delete' && !isSingleName(name.trim()))}
                onClick={() => { void submit(dialog) }}
              >
                {t(dialog.kind === 'create' ? 'dialog.create' : dialog.kind === 'rename' ? 'dialog.rename' : 'dialog.delete')}
              </Button>
            </>
          )}
        >
          <div className={css.dialogBody} data-files-dialog={dialog.kind}>
            {dialog.kind === 'delete' ? (
              <>
                <p className={css.dialogLine}>{t('dialog.deleteBody', { name: nameOf(dialog.path) })}</p>
                <label className={css.dialogCheck}>
                  <input
                    type="checkbox"
                    checked={dialog.recursive}
                    onChange={(event) => { setDialog({ ...dialog, recursive: event.currentTarget.checked }) }}
                  />
                  <span>{t('dialog.recursive')}</span>
                </label>
              </>
            ) : (
              <label className={css.dialogField}>
                <span className={css.dialogLabel}>{t('dialog.nameLabel')}</span>
                <Input
                  autoFocus
                  value={name}
                  data-files-name
                  onChange={(event) => { setName(event.currentTarget.value) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submit(dialog) }}
                />
              </label>
            )}
            {failure !== undefined && (
              <p className={css.dialogError} data-files-error={failure.code}>{failureLine(t, failure)}</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
