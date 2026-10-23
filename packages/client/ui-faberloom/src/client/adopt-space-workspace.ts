/**
 * Adopt an existing folder as a space's Workspace, from the Space panel: pick a
 * directory with the mounted directory picker (native in the Desktop, browser
 * browse on the Web), point the space at it, and reload the overview. A
 * cancelled pick or a refused adoption leaves the current Workspace untouched.
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/**
 * Run the pick-then-adopt flow for one space.
 * @param directoryPicker - the mounted directory-picking Remote namespace.
 * @param view - the FaberLoom view Remote namespace.
 * @param refresh - the panel's overview reload.
 * @param spaceId - the space whose Workspace becomes the chosen folder.
 * @returns completion of the pick and, when one was adopted, the reload.
 */
export async function runAdoptSpaceWorkspace(
  directoryPicker: ClientRemote['directoryPicker'],
  view: ClientRemote['faberloomView'],
  refresh: () => Promise<void> | void,
  spaceId: string,
): Promise<void> {
  const picked = await directoryPicker.pick(undefined)
  if (!picked.ok || picked.value === null || picked.value.length === 0) return
  const adopted = await view.adoptSpaceWorkspace(spaceId, picked.value)
  if (adopted.ok) await refresh()
}
