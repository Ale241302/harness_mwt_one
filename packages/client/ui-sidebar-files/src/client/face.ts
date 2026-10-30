/**
 * The tree's asynchronous half: listing directories into the store and
 * performing the three workspace mutations.
 *
 * The component never lists anything itself. It calls `start` / `load` /
 * `toggle` for the tree and `create` / `rename` / `remove` for a mutation, and
 * this face performs the work and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * A listing is bound here to the Client Remote face: the tree keys every level
 * by absolute path and hands the endpoint that same absolute path; the endpoint
 * answers with the directory's workspace-relative path as well, which the tree
 * has no use for and drops.
 *
 * A mutation's outcome is the host's answer. On success the face drops the
 * entry the call changed — its level and everything it expanded, so no stale
 * subtree survives a rename or a delete — and lists the parent level again, so
 * the row the reader sees comes from the host rather than from a local guess.
 * A refusal writes nothing and is handed back to the caller, which shows it in
 * the dialog that asked.
 *
 * One level has one listing in force: asking for a level again — the reload
 * gesture, a directory reopened after a reset — retires the listing still in
 * flight for it, whose settlement then writes nothing. Cleanup rides the owner's
 * `signal`: a request is not made for a record that already ended, and when the
 * record goes away the bucket and the tab's listing bookkeeping are forgotten,
 * so no later settlement writes to it.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileMutation } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DirLevel, createFilesStore } from './store.ts'

/**
 * One directory listing, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different directories in different sessions.
 * A Remote call does not reject — the result carries the failure.
 */
export type ListWorkspaceDirectory = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<DirLevel>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesListRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list'>
}

/**
 * The mutation slice of the Client Remote face: the four workspace mutations,
 * exactly as the Host's generated client declares them.
 */
export type WorkspaceFilesMutateRemote = {
  readonly workspaceFiles: Pick<
    ClientRemote['workspaceFiles'],
    'createFile' | 'createDirectory' | 'move' | 'removePath'
  >
}

/**
 * Bind the listing to one Remote face, keeping only what the tree stores.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the listing the tree's face performs.
 */
export function createList(remote: WorkspaceFilesListRemote): ListWorkspaceDirectory {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.list(sessionId, path, signal)
    if (!result.ok) return result
    return { ok: true, value: { entries: result.value.entries, truncated: result.value.truncated } }
  }
}

/** The mutation calls the tree's face performs, bound to one Remote face. */
export interface FilesMutator {
  /** Create one file with its content. */
  readonly createFile: (
    sessionId: SessionId,
    path: string,
    content: string,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
  /** Create one empty directory. */
  readonly createDirectory: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
  /** Rename or move one entry. */
  readonly move: (
    sessionId: SessionId,
    from: string,
    to: string,
    options: { readonly overwrite?: boolean },
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
  /** Remove one entry, with its contents when asked. */
  readonly remove: (
    sessionId: SessionId,
    path: string,
    options: { readonly recursive?: boolean },
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
}

/**
 * Bind the tree's mutations to one Remote face; the calls are the generated
 * namespace's own, so a refusal arrives as a result rather than a throw.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the mutation calls the tree's face performs.
 */
export function createMutations(remote: WorkspaceFilesMutateRemote): FilesMutator {
  const namespace = remote.workspaceFiles
  return {
    createFile: (sessionId, path, content, signal) => namespace.createFile(sessionId, path, content, signal),
    createDirectory: (sessionId, path, signal) => namespace.createDirectory(sessionId, path, signal),
    move: (sessionId, from, to, options, signal) => namespace.move(sessionId, from, to, options, signal),
    remove: (sessionId, path, options, signal) => namespace.removePath(sessionId, path, options, signal),
  }
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** The tree's injected business face, as the body receives it. */
export interface FilesInjected {
  /**
   * Seed this tab's tree and list its root.
   * @param tabId - the tab being drawn.
   * @param root - absolute path of the workspace root.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, root: string, signal: AbortSignal) => void
  /**
   * List one directory into the store.
   * @param tabId - the tab being drawn.
   * @param path - absolute directory path.
   * @param signal - the tab record's lifetime.
   */
  readonly load: (tabId: TabId, path: string, signal: AbortSignal) => void
  /**
   * Open or collapse one directory, listing it the first time it opens.
   * @param tabId - the tab being drawn.
   * @param path - absolute directory path.
   * @param loaded - whether this level already has state.
   * @param signal - the tab record's lifetime.
   */
  readonly toggle: (tabId: TabId, path: string, loaded: boolean, signal: AbortSignal) => void
  /**
   * Create one file or directory in a listed level.
   * @param tabId - the tab being drawn.
   * @param parent - absolute path of the directory that will hold it.
   * @param name - the new entry's name, one path segment.
   * @param entry - whether a file (with empty content) or a directory is created.
   * @param signal - the tab record's lifetime.
   * @returns the host's answer; a success re-lists the parent level.
   */
  readonly create: (
    tabId: TabId,
    parent: string,
    name: string,
    entry: 'file' | 'directory',
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
  /**
   * Rename one listed entry, keeping it in its directory.
   * @param tabId - the tab being drawn.
   * @param parent - absolute path of the entry's directory.
   * @param path - absolute path of the entry to rename.
   * @param name - the new name, one path segment.
   * @param signal - the tab record's lifetime.
   * @returns the host's answer; a success drops the old subtree and re-lists the parent.
   */
  readonly rename: (
    tabId: TabId,
    parent: string,
    path: string,
    name: string,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
  /**
   * Remove one listed entry.
   * @param tabId - the tab being drawn.
   * @param parent - absolute path of the entry's directory.
   * @param path - absolute path of the entry to remove.
   * @param recursive - whether a directory's contents go with it.
   * @param signal - the tab record's lifetime.
   * @returns the host's answer; a success drops the entry's subtree and re-lists the parent.
   */
  readonly remove: (
    tabId: TabId,
    parent: string,
    path: string,
    recursive: boolean,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileMutation>>
}

/**
 * Bind the tree's face to one directory listing and one set of mutations.
 * @param list - the bound `workspaceFiles.list` call.
 * @param mutate - the bound `workspaceFiles` mutation calls.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function filesFace(
  list: ListWorkspaceDirectory,
  mutate: FilesMutator,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => FilesInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createFilesStore>>,
  ): FilesInjected => {
    /** Per tab, per absolute path: the listing generation a settlement must match; the latest request wins. */
    const generations = new Map<TabId, Map<string, number>>()
    const nextGeneration = (tabId: TabId, path: string): number => {
      const byPath = generations.get(tabId) ?? new Map<string, number>()
      generations.set(tabId, byPath)
      const generation = (byPath.get(path) ?? 0) + 1
      byPath.set(path, generation)
      return generation
    }
    const load = (tabId: TabId, path: string, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = nextGeneration(tabId, path)
      actions.loading(tabId, path)
      void list(sessionId, path, signal).then((result) => {
        // A newer listing of this level was asked for since, or the record is
        // gone and its bookkeeping with it: nothing left for this one to write.
        if (generations.get(tabId)?.get(path) !== generation) return
        if (result.ok) actions.loaded(tabId, path, result.value)
        else actions.failed(tabId, path, result.error)
      })
    }
    /** A settled success: drop the changed entry's subtree, then re-list its directory. */
    const refreshed = (tabId: TabId, parent: string, changed: string, signal: AbortSignal): void => {
      // The record is gone and its bucket with it: there is nothing to write.
      if (signal.aborted) return
      actions.dropped(tabId, changed)
      load(tabId, parent, signal)
    }
    return {
      start(tabId, root, signal) {
        actions.start(tabId, root)
        signal.addEventListener('abort', () => {
          generations.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        load(tabId, root, signal)
      },
      load,
      toggle(tabId, path, loaded, signal) {
        actions.toggled(tabId, path)
        if (!loaded) load(tabId, path, signal)
      },
      async create(tabId, parent, name, entry, signal) {
        const path = childPath(parent, name)
        const result = entry === 'directory'
          ? await mutate.createDirectory(sessionId, path, signal)
          : await mutate.createFile(sessionId, path, '', signal)
        if (result.ok) refreshed(tabId, parent, path, signal)
        return result
      },
      async rename(tabId, parent, path, name, signal) {
        const result = await mutate.move(sessionId, path, childPath(parent, name), {}, signal)
        if (result.ok) refreshed(tabId, parent, path, signal)
        return result
      },
      async remove(tabId, parent, path, recursive, signal) {
        const result = await mutate.remove(sessionId, path, recursive ? { recursive: true } : {}, signal)
        if (result.ok) refreshed(tabId, parent, path, signal)
        return result
      },
    }
  }
}
