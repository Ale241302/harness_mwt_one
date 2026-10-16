/**
 * The mirror through the real Loader: a package-owned `cordis.yml` boots the
 * storage hub, the domain form, the product domains, and the mirror row, and a
 * pull against a fake gateway origin lands a row in the composition's own
 * domains and a skill file under its skills root.
 */

import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
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
import * as accessPlugin from '../../access/src/index.ts'
import * as mirrorPlugin from '../src/index.ts'
import * as memoryStoragePlugin from './fixtures/memory-storage.ts'
import * as productDomainsPlugin from './fixtures/product-domains.ts'

/** Poll a condition up to a second, so a spec waits for the row's own effect. */
async function waitFor(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return true
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  return false
}

let context: Context | undefined
let root: string | undefined
let gateway: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (gateway !== undefined) await new Promise<void>((resolve) => { gateway?.close(() => { resolve() }) })
  gateway = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  root = undefined
  delete process.env.MIRROR_FAKE_GATEWAY
  delete process.env.MIRROR_FAKE_SKILLS
  delete process.env.DSH_HOME
})

describe('mirror real Loader composition', () => {
  it('boots from cordis.yml and lands a pulled row and skill in its own home', async () => {
    root = await mkdtemp(join(tmpdir(), 'faberloom-mirror-loader-'))
    // The composition's home is the spec's own temporary directory, so the
    // mirror's state document lands there and never in the repository.
    process.env.DSH_HOME = root
    const skillsRoot = join(root, 'skills')
    const received: unknown[] = []
    gateway = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        received.push(request.headers['x-faberloom-mirror-key'])
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          version: 1,
          platform: 'web',
          domains: {
            faberloom_grants: {
              tables: { grants: { g1: { deleted: false, value: { id: 'g1', action: 'mail.send' } } } },
            },
          },
          skills: { 'informe-diario': '# Informe\n\nCuerpo.' },
          applied: [],
          skillsApplied: [],
          skipped: [],
        }))
      })
    })
    await new Promise<void>((resolve) => { gateway?.listen(0, '127.0.0.1', resolve) })
    const address = gateway.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    process.env.MIRROR_FAKE_GATEWAY = `http://127.0.0.1:${String(port)}`
    process.env.MIRROR_FAKE_SKILLS = skillsRoot

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
    const ctx = context = new Context()
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', storagePlugin],
      ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
      ['@deepseek-ai/dsh-faberloom-access', accessPlugin],
      ['@deepseek-ai/dsh-faberloom-mirror', mirrorPlugin],
      ['./memory-storage.ts', memoryStoragePlugin],
      ['./product-domains.ts', productDomainsPlugin],
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

    const mirror = ctx.faberloomMirror
    expect(mirror).toBeDefined()
    // The row is active with the fixture's wiring, so it really pulled once and
    // its own domains hold the remote row.
    const requested = await waitFor(() => received.length > 0)
    expect(requested).toBe(true)
    const grants = ctx.storageDomain.get('faberloom_grants')?.table('grants')
    const landed = await waitFor(() => grants?.get('g1') !== undefined)
    expect(landed).toBe(true)
    expect(received).toContain('mirror-key-1')
    expect(grants?.get('g1')).toMatchObject({ action: 'mail.send' })
    const skillFile = join(skillsRoot, 'informe-diario', 'SKILL.md')
    const wroteSkill = await waitFor(() => existsSync(skillFile))
    expect(wroteSkill).toBe(true)
    expect(await readFile(skillFile, 'utf8')).toBe('# Informe\n\nCuerpo.')
  }, 30_000)
})
