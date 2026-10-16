/**
 * The gateway's repair of a stored Workspace registry order: a record that
 * landed without its order entry would otherwise make the registry refuse to
 * load, taking the folder picker and every session surface down with it.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { repairWorkspaceOrder, repairedWorkspaceIds } from '../workspace-registry.mjs'

const homes = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** One registry state with the given records and order. */
function state(records, order, extra = {}) {
  return {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: order, archivedSessionIds: [], ...extra },
    tables: { workspaces: Object.fromEntries(records.map(([id, createdAt]) => [id, { path: `/work/${id}`, title: id, sessionIds: [], createdAt, updatedAt: createdAt }])) },
  }
}

/** A temporary Harness home holding one registry file, written from raw text or a state. */
function home(content) {
  const root = mkdtempSync(join(tmpdir(), 'gateway-workspace-'))
  homes.push(root)
  mkdirSync(join(root, 'storages'), { recursive: true })
  writeFileSync(join(root, 'storages', 'workspace.json'), typeof content === 'string' ? content : JSON.stringify(content))
  return root
}

it('appends a record the order forgot, keeping a backup of the file', () => {
  const root = home(state([['a', '2026-01-01T00:00:00Z'], ['b', '2026-02-01T00:00:00Z'], ['c', '2026-03-01T00:00:00Z']], ['a']))

  const result = repairWorkspaceOrder(root)

  // Orden por `createdAt`, no el que dio el sistema de ficheros.
  expect(result.added).toEqual(['b', 'c'])
  expect(typeof result.backup).toBe('string')
  const repaired = JSON.parse(readFileSync(join(root, 'storages', 'workspace.json'), 'utf8'))
  expect(repaired.global.workspaceIds).toEqual(['a', 'b', 'c'])
  expect(readdirSync(join(root, 'storages')).filter((name) => name.includes('.bak-'))).toHaveLength(1)
})

it('leaves a state it can trust alone', () => {
  const consistent = state([['a', '2026-01-01T00:00:00Z']], ['a'])
  expect(repairedWorkspaceIds(consistent)).toBeUndefined()
  expect(repairedWorkspaceIds(state([['b', '2026-02-01T00:00:00Z']], ['a', 'b'], { pendingMutation: { kind: 'create' } }))).toBeUndefined()
  expect(repairedWorkspaceIds(null)).toBeUndefined()
  expect(repairedWorkspaceIds({ global: {}, tables: {} })).toBeUndefined()
  expect(repairedWorkspaceIds({ global: { workspaceIds: 'a' }, tables: { workspaces: {} } })).toBeUndefined()

  const root = home(consistent)
  expect(repairWorkspaceOrder(root)).toEqual({ added: [] })
  expect(readdirSync(join(root, 'storages'))).toEqual(['workspace.json'])
})

it('says nothing was added for a home without a registry, and reports a file it cannot read', () => {
  const empty = mkdtempSync(join(tmpdir(), 'gateway-workspace-empty-'))
  homes.push(empty)
  expect(repairWorkspaceOrder(empty)).toEqual({ added: [] })

  const broken = home('{ this is not json')
  const result = repairWorkspaceOrder(broken)
  expect(result.added).toEqual([])
  expect(typeof result.unreadable).toBe('string')
  expect(readFileSync(join(broken, 'storages', 'workspace.json'), 'utf8')).toBe('{ this is not json')
})
