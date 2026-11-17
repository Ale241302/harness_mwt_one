/**
 * O5-02B · the assignment service through the real Loader: the package-owned
 * `cordis.yml` boots the storage hub, the domain form and the service; two
 * rules that disagree report a conflict, revoking one stops it, and a second
 * boot over the same storage still sees the revoked rule and the decision.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as storagePlugin from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as assignmentPlugin from '../src/index.ts'
import * as memoryStoragePlugin from './fixtures/memory-storage.ts'

const OWNER = 'compras2@sondelsa.com'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Boot the fixture composition and wait for the service. */
async function boot(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'assignment-loader-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', storagePlugin],
    ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
    ['@deepseek-ai/dsh-faberloom-assignment', assignmentPlugin],
    ['./memory-storage.ts', memoryStoragePlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('assignment real Loader composition', () => {
  it('boots from cordis.yml, reports conflict, and keeps revocation across a restart', async () => {
    const first = await boot()
    const rules = first.faberloomAssignment
    expect(rules).toBeDefined()

    const eguisa = await rules.createRule(OWNER, {
      criterion: { field: 'from', operator: 'contains', value: 'eguisa' },
      target: { spaceId: 'sp-eguisa', agentId: null },
    })
    await rules.createRule(OWNER, {
      criterion: { field: 'subject', operator: 'contains', value: '4711' },
      target: { spaceId: 'sp-sonepar', agentId: null },
    })

    const conflict = await rules.evaluate(OWNER, { from: 'compras@eguisa.example', subject: 'OC 4711' })
    expect(conflict.status).toBe('conflict')
    expect(conflict.target).toBeNull()

    // Revoking one side leaves the other deciding; revoking both stops it.
    await rules.revokeRule(OWNER, eguisa.id)
    expect((await rules.evaluate(OWNER, { from: 'compras@eguisa.example', subject: 'OC 4711' })).status)
      .toBe('assigned')
    for (const rule of await rules.listRules(OWNER)) await rules.revokeRule(OWNER, rule.id)
    expect((await rules.evaluate(OWNER, { from: 'compras@eguisa.example', subject: 'OC 4711' })).status)
      .toBe('none')

    await first.fiber.dispose()

    // A second boot over the same storage: the rules and their revocation are still there.
    const second = await boot()
    const listed = await second.faberloomAssignment.listRules(OWNER)
    expect(listed).toHaveLength(2)
    expect(listed.every(rule => rule.revokedAt !== null)).toBe(true)
    expect((await second.faberloomAssignment.evaluate(OWNER, { from: 'compras@eguisa.example' })).status)
      .toBe('none')
  })
})
