/**
 * Child-process entry for the Win32 folder dialog: blocks THIS process
 * inside the modal `Show` so the host event loop stays live, reporting over
 * the IPC channel. Spawned as a child process (not a worker thread) so a
 * native fault stays contained and the modal call never wedges the host.
 * A background host (the web GUI server) leaves this process without
 * foreground rights, so `runFolderDialog` synthesizes an Alt press
 * immediately before `Show` and the dialog then activates as foreground.
 * Protocol: `{kind:'showing',threadId}` right
 * before the blocking call (the driver's abort lever needs the native
 * thread id), then exactly one of `{kind:'done',path}` or
 * `{kind:'error',message}`.
 */

import { loadWin32DialogBindings } from './win32-dialog-bindings.ts'
import { runFileDialog, runFolderDialog } from './win32-dialog-logic.ts'

/** The driver-to-child payload: the dialog title and mode (passed via env). */
export interface Win32DialogWorkerData {
  readonly title: string
  /** Which dialog the child opens. */
  readonly kind: 'files' | 'folders'
  /** Directory the folder dialog opens in; absent keeps the shell default. */
  readonly initialPath?: string
}

/** One notice or outcome posted back to the driver. */
export type Win32DialogWorkerMessage =
  | { kind: 'showing'; threadId: number }
  | { kind: 'done'; path: string | null }
  | { kind: 'error'; message: string }

const title = process.env.DSH_DIALOG_TITLE ?? ''
if (title === '') throw new Error('win32-dialog-worker: DSH_DIALOG_TITLE is required')
const kind = process.env.DSH_DIALOG_KIND ?? 'folders'
if (kind !== 'folders' && kind !== 'files') {
  throw new Error('win32-dialog-worker: DSH_DIALOG_KIND must be "folders" or "files"')
}
const pickFiles = kind === 'files'
const initialPath = process.env.DSH_DIALOG_START_PATH
if (process.send === undefined) throw new Error('win32-dialog-worker must run as a child process with an IPC channel')
// node's internal `send` reads `this.connected`, so bind the receiver.
const send = process.send.bind(process)

const post = (message: Win32DialogWorkerMessage): void => {
  // Flush before closing the channel; the process exits when the loop drains.
  /* v8 ignore next 3 -- disconnect needs a live IPC channel the unit lane must not sever (built-worker.e2e.ts owns the real close path). */
  send(message, () => { if (process.connected) process.disconnect() })
}

// A settled driver (or a dead parent) must not orphan a dialog still on screen.
/* v8 ignore next 3 -- the handler exits(0), which would kill the unit lane; built-worker.e2e.ts owns the real disconnect lifecycle. */
process.on('disconnect', () => process.exit(0))

// No top-level await: the built worker ships as CJS, which cannot carry TLA.
void (async () => {
  try {
    const bindings = await loadWin32DialogBindings()
    const run = pickFiles ? runFileDialog : runFolderDialog
    const path = run(bindings, title, (threadId) => {
      post({ kind: 'showing', threadId } satisfies Win32DialogWorkerMessage)
    }, initialPath)
    post({ kind: 'done', path } satisfies Win32DialogWorkerMessage)
  } catch (error: unknown) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    post({ kind: 'error', message } satisfies Win32DialogWorkerMessage)
  }
})()
