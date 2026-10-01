/** Browser save of one workspace file, without a Host desktop. */
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { basename } from '../presented.ts'

/** Authenticated Host route that serves one workspace file's bytes. */
export const WORKSPACE_FILE_PATH = '/api/file'

/**
 * Hand one workspace file to the browser download manager.
 *
 * The Host resolves the path against the Session's workspace, so a relative
 * path needs the Session root; `download` is what turns the response into a
 * save. This is the only file action that needs no desktop on the Host.
 * @param cwd - owning Session workspace root, when known.
 * @param path - absolute or workspace-relative file path.
 * @returns Nothing; the browser download manager owns the save.
 */
export function downloadWorkspaceFile(cwd: string | undefined, path: string): void {
  const query = new URLSearchParams({ path: resolveWorkspacePath(cwd, path), download: '1' })
  const anchor = document.createElement('a')
  anchor.href = `${WORKSPACE_FILE_PATH}?${query.toString()}`
  anchor.download = basename(path)
  anchor.click()
}
