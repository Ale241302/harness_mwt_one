/**
 * Gateway repair of the stored Workspace registry order.
 *
 * The `workspace` domain keeps its display order in `global.workspaceIds` and,
 * by design, refuses to load when a stored record is absent from that order:
 * "unmarked divergence fails loud as corruption". The refusal takes the whole
 * registry down, and along with it every service that waits on
 * `workspaceRegistry` — the session and workspace controllers, the folder
 * picker's controller, and the product panels built on them.
 *
 * A record can land without its order entry when another process writes the
 * domain: the mirror used to transfer this domain from a desktop, whose
 * Workspaces name that machine's folders, and the store applied the record on
 * its own. This module puts the order back before the owner's `dsh` starts:
 * the ids are appended in `createdAt` order, nothing is deleted, a backup of
 * the file is kept, and a state carrying a `pendingMutation` marker is left
 * alone so the registry's own recovery finishes the interrupted operation.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Registry file inside one owner's Harness home. */
const REGISTRY_FILE = ['storages', 'workspace.json']

/** The creation instant one stored record carries, or the empty string. */
function createdAtOf(rows, id) {
  const row = rows[id]
  const value = row !== null && typeof row === 'object' && 'value' in row ? row.value : row
  return value !== null && typeof value === 'object' && typeof value.createdAt === 'string' ? value.createdAt : ''
}

/**
 * Order a stored registry state should carry, or undefined when it already
 * carries one this module can trust.
 * @param {unknown} state - the parsed registry state.
 * @returns {string[] | undefined} the complete order, or undefined to leave the file alone.
 */
export function repairedWorkspaceIds(state) {
  if (state === null || typeof state !== 'object') return undefined
  const order = state.global !== null && typeof state.global === 'object' ? state.global.workspaceIds : undefined
  const rows = state.tables !== null && typeof state.tables === 'object' ? state.tables.workspaces : undefined
  if (!Array.isArray(order) || rows === null || typeof rows !== 'object') return undefined
  // El marcador significa que un arranque se interrumpió a mitad de una
  // mutación: el registro la completa o la revierte por sí mismo.
  if (typeof state.global.pendingMutation === 'object' && state.global.pendingMutation !== null) return undefined
  const missing = Object.keys(rows).filter((id) => !order.includes(id))
  if (missing.length === 0) return undefined
  const appended = [...missing].sort((left, right) =>
    createdAtOf(rows, left).localeCompare(createdAtOf(rows, right)) || left.localeCompare(right))
  return [...order, ...appended]
}

/**
 * Repair one owner's registry file in place, keeping a backup of the previous
 * content.
 * @param {string} home - the owner's Harness home.
 * @returns {{ added: string[], backup?: string, unreadable?: string }} the ids appended, and where the previous content went.
 */
export function repairWorkspaceOrder(home) {
  const file = path.join(home, ...REGISTRY_FILE)
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    // Una casa sin registro todavía no tiene nada que reparar.
    return { added: [] }
  }
  let state
  try {
    state = JSON.parse(raw)
  } catch (err) {
    return { added: [], unreadable: err.message }
  }
  const order = repairedWorkspaceIds(state)
  if (order === undefined) return { added: [] }
  const previous = Array.isArray(state.global.workspaceIds) ? state.global.workspaceIds : []
  const backup = `${file}.bak-${Date.now()}`
  fs.writeFileSync(backup, raw)
  state.global.workspaceIds = order
  fs.writeFileSync(file, JSON.stringify(state))
  return { added: order.filter((id) => !previous.includes(id)), backup }
}
