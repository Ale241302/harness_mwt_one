import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { CallToolResult } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const STARTUP = fileURLToPath(new URL('../src/startup.ts', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/upstream.mjs', import.meta.url))
const PARENT_CANARY = 'E2E-LEAK-CANARY'

let directory: string
let client: Client
let transport: StdioClientTransport

function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

beforeAll(async () => {
  process.env.CODEMODE_E2E_CANARY = PARENT_CANARY
  directory = mkdtempSync(join(tmpdir(), 'codemode-e2e-'))
  const configPath = join(directory, 'codemode.json')
  writeFileSync(configPath, JSON.stringify({
    upstreams: [{ serverName: 'fx', transport: 'stdio', command: process.execPath, args: [FIXTURE] }],
    maxOutputBytes: 131_072,
  }))
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx/esm', STARTUP, '--config', configPath],
    cwd: REPOSITORY_ROOT,
    stderr: 'pipe',
  })
  client = new Client({ name: 'codemode-e2e', version: '1.0.0' })
  await client.connect(transport)
}, 120_000)

afterAll(async () => {
  await client?.close()
  rmSync(directory, { recursive: true, force: true })
  delete process.env.CODEMODE_E2E_CANARY
})

describe('stdio facade', () => {
  it('serves two tools to an external client and runs a three-call program', async () => {
    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name).sort()).toEqual(['catalog', 'run_code'])
    expect(client.getInstructions()).toContain('upstream tools are async functions on the `tools` object, named `mcp__<server>__<tool>`')

    const catalog = await client.callTool({ name: 'catalog', arguments: { server: 'fx' } })
    const catalogText = textOf(catalog)
    expect(catalogText).toContain('mcp__fx__add')

    const result = await client.callTool({
      name: 'run_code',
      arguments: {
        description: 'Summarize three upstream calls',
        code: `
const sum = await tools.mcp__fx__add({ a: 20, b: 22 })
const greeting = await tools.mcp__fx__greet({ name: 'línea' })
const bulk = await tools.mcp__fx__bulk({})
console.log('env-keys', Object.keys(process.env).length)
return {
  sum: sum.content[0].text,
  greeting: greeting.content[0].text,
  leaked: process.env.CODEMODE_E2E_CANARY ?? null,
  bulkIsLarge: bulk.content[0].text.length > 4000,
}
`,
      },
    })
    const text = textOf(result)
    expect(result.isError ?? false).toBe(false)
    expect(text).toContain('env-keys 0')
    expect(text).toContain('"sum": "42"')
    expect(text).toContain('"greeting": "Hello, línea!"')
    expect(text).toContain('"leaked": null')
    expect(text).toContain('"bulkIsLarge": true')
    expect(text).not.toContain('INTERMEDIATE-CANARY-9f3a')
    expect(text).not.toContain(PARENT_CANARY)
  }, 120_000)
})
