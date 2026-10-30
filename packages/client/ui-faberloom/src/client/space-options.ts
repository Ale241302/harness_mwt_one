/**
 * Display-only de-duplication for Spaces. Repeated rows came from legacy
 * folder adoption and from a Space and its folder-backed twin; pick the nested
 * row when both exist and remap children whose parent row was folded away.
 */
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'

/** One row of the overview's Space list. */
export type SpaceRow = FaberLoomOverview['spaces'][number]

/**
 * Fold repeated Space rows by title, preferring the one with a parent or a
 * real workspace, and rewrite parent ids to the surviving rows.
 * @param spaces - raw overview rows.
 * @returns display rows with no repeated title and valid parent ids.
 */
export function uniqueSpaces(spaces: readonly SpaceRow[]): readonly SpaceRow[] {
  const byTitle = new Map<string, SpaceRow>()
  const remap = new Map<string, string>()
  for (const space of spaces) {
    const key = space.title.trim().toLowerCase()
    const existing = byTitle.get(key)
    if (existing === undefined) {
      byTitle.set(key, space)
      continue
    }
    const prefer = (existing.parentId === null && space.parentId !== null)
      || (existing.workspaceId === null && space.workspaceId !== null)
    if (prefer) {
      byTitle.set(key, space)
      remap.set(existing.id, space.id)
    } else {
      remap.set(space.id, existing.id)
    }
  }
  const surviving = new Map([...byTitle.values()].map(space => [space.id, space]))
  return [...surviving.values()].map((space) => {
    if (space.parentId === null) return space
    const parentId = remap.get(space.parentId) ?? space.parentId
    return surviving.has(parentId) ? { ...space, parentId } : { ...space, parentId: null }
  })
}
