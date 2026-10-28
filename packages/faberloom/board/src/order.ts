/**
 * The canonical queue order of the Mesa (§4): a total, deterministic tuple over
 * priority rank, due date, USD value, creation instant, and item id, plus the
 * same tuple applied to space groups.
 * @module @deepseek-ai/dsh-faberloom-board/src/order
 */

import type { BoardOrderFields, BoardOrderGroup, BoardSeverity } from './types.ts'

/**
 * Rank of an item that is unclassified or has no space. It sits above CRITICAL
 * so no severity can bury an item that still needs routing or a decision.
 */
export const PRIORITY_UNCLASSIFIED = 5

const SEVERITY_RANK: Readonly<Record<BoardSeverity, number>> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/**
 * Rank one item for the queue.
 * @param item - the item fields the tuple reads.
 * @returns 5 for an unclassified or space-less item, otherwise the severity rank.
 */
export function priorityRank(item: BoardOrderFields): number {
  if (item.severity === null || item.spaceId === null) return PRIORITY_UNCLASSIFIED
  return SEVERITY_RANK[item.severity]
}

/** Compare two texts by code unit, independent of the host locale. */
function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Compare ISO-8601 instants ascending; null sorts last. */
function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return compareText(left, right)
}

/** Compare USD amounts descending; null and non-finite amounts sort last. */
function compareNullableValueDescending(left: number | null, right: number | null): number {
  const first = left !== null && Number.isFinite(left) ? left : null
  const second = right !== null && Number.isFinite(right) ? right : null
  if (first === second) return 0
  if (first === null) return 1
  if (second === null) return -1
  return first > second ? -1 : 1
}

/**
 * Compare two items by the whole tuple: priority rank descending, due date
 * ascending with null last, USD value descending with null last, creation
 * ascending, then id ascending as the final tiebreaker.
 * @param left - first item.
 * @param right - second item.
 * @returns negative when `left` sorts first, positive when `right` does, and 0 only when every tuple field, including the id, matches.
 */
export function compareBoardOrder(left: BoardOrderFields, right: BoardOrderFields): number {
  const byPriority = priorityRank(right) - priorityRank(left)
  if (byPriority !== 0) return byPriority

  const byDueAt = compareNullableText(left.dueAt, right.dueAt)
  if (byDueAt !== 0) return byDueAt

  const byValue = compareNullableValueDescending(left.valueUsd, right.valueUsd)
  if (byValue !== 0) return byValue

  const byCreatedAt = compareText(left.createdAt, right.createdAt)
  if (byCreatedAt !== 0) return byCreatedAt

  return compareText(left.id, right.id)
}

/**
 * Order a copy of the items by the canonical tuple. The input array is not mutated.
 * @param items - items in any input order.
 * @returns a new array in queue order.
 */
export function orderBoardItems<T extends BoardOrderFields>(items: readonly T[]): T[] {
  return [...items].sort(compareBoardOrder)
}

/**
 * Order space groups by the tuple of their first item, after ordering each
 * group's members with the same tuple. Groups partition the items, so two groups
 * never share a first item. A group without items has no first item and sorts
 * last, by space id.
 * @param groups - groups in any input order.
 * @returns new groups with ordered members, in group order.
 */
export function orderBoardGroups<T extends BoardOrderFields>(
  groups: readonly BoardOrderGroup<T>[],
): BoardOrderGroup<T>[] {
  const ordered = groups.map(group => ({ spaceId: group.spaceId, items: orderBoardItems(group.items) }))
  return ordered.sort((left, right) => {
    const leftHead = left.items[0]
    const rightHead = right.items[0]
    if (leftHead === undefined) {
      return rightHead === undefined ? compareNullableText(left.spaceId, right.spaceId) : 1
    }
    if (rightHead === undefined) return -1
    return compareBoardOrder(leftHead, rightHead)
  })
}
