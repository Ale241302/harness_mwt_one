/**
 * The MCP registry through the real Loader: a package-owned `cordis.yml` boots
 * the storage hub, the domain form, the tool runtime, the credential seam, and
 * the registry itself, and a server installed over a real stdio child process
 * publishes its tools into the global registry the model reads.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as storagePlugin from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as systemPromptPlugin from '@deepseek-ai/dsh-system-prompt'
import * as toolsPlugin from '@deepseek-ai/dsh-tools'
import * as registryPlugin from '../src/index.ts'
import * as memoryStoragePlugin from './fixtures/memory-storage.ts'
import * as memoryCredentialsPlugin from './fixtures/memory-credentials.ts'

/** The real stdio MCP fixture, run as a child process by the installed Node. */
const STDIO_SERVER = fileURLToPath(new URL('./stdio-fixture-server.ts', import.meta.url))

/** The package directory the child runs in, so it resolves the SDK from node_modules. */
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('MCP registry real Loader composition', () => {
  it('boots from cordis.yml and installs a real stdio server whose tools reach the global registry', async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-registry-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', storagePlugin],
      ['@deepseek-ai/dsh-storage-domain', storageDomainPlugin],
      ['@deepseek-ai/dsh-system-prompt', systemPromptPlugin],
      ['@deepseek-ai/dsh-tools', toolsPlugin],
      ['@deepseek-ai/dsh-faberloom-mcp-registry', registryPlugin],
      ['./memory-storage.ts', memoryStoragePlugin],
      ['./memory-credentials.ts', memoryCredentialsPlugin],
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

    const registry = ctx.faberloomMcpRegistry
    expect(registry).toBeDefined()
    const input = {
      name: 'local',
      transport: { transport: 'stdio' as const, command: process.execPath, args: [STDIO_SERVER], cwd: PACKAGE_DIR },
      env: { FIXTURE_TOKEN: 'expected-token' },
    }

    expect(await registry.probe(input)).toEqual({ ok: true, tools: ['mcp__local__ping'] })
    const saved = await registry.save('a@x', input)
    expect(saved).toMatchObject({ enabled: true, mounted: true })
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('mcp__local__ping')
  }, 30_000)
})
