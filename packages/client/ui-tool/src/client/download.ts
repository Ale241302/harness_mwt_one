/** Browser save of a tool call's file, without a Host desktop. */
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** Authenticated Host route that serves one workspace file's bytes. */
const WORKSPACE_FILE_PATH = '/api/file'

/**
 * Hand a tool call's file to the browser download manager.
 *
 * The call's path keeps its argument spelling; `cwd` resolves a relative value,
 * exactly as the row's open action does. The Host serves the same authorized
 * bytes as `/api/file` and `download` turns the response into a save, so no
 * desktop is consulted.
 * @param cwd - Session workspace root, when known.
 * @param path - absolute or workspace-relative path from the call arguments.
 * @returns Nothing; the browser download manager owns the save.
 */
export function downloadWorkspaceFile(cwd: string | undefined, path: string): void {
  const resolved = resolveWorkspacePath(cwd, path)
  const query = new URLSearchParams({ path: resolved, download: '1' })
  const anchor = document.createElement('a')
  anchor.href = `${WORKSPACE_FILE_PATH}?${query.toString()}`
  anchor.download = resolved.split(/[/\\]/).pop() ?? 'download'
  anchor.click()
}
