import { fileURLToPath } from 'node:url'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { CallToolResult } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCodeModeFacade, createCodeModeServer, renderOutcome } from '../src/index.ts'
import type { CodeModeFacade, FacadeConfig } from '../src/index.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/upstream.mjs', import.meta.url))
const CRASH = fileURLToPath(new URL('./fixtures/crash.mjs', import.meta.url))

/** Present in the facade's environment; a leak into the program would surface it. */
const PARENT_CANARY = 'LEAK-CANARY-parent-env'

/** Marker inside the fixture's `bulk()` payload. */
const INTERMEDIATE_CANARY = 'INTERMEDIATE-CANARY-9f3a'

interface Endpoint {
  readonly facade: CodeModeFacade
  readonly client: Client
}

/** Connect a real MCP client to the facade in memory; the upstream stays a real spawned server. */
async function connect(options: Partial<FacadeConfig> = {}): Promise<Endpoint> {
  const facade = await createCodeModeFacade({
    upstreams: [{ serverName: 'fx', transport: 'stdio', command: process.execPath, args: [FIXTURE] }],
    ...options,
  })
  const server = createCodeModeServer(facade)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'facade-test', version: '1.0.0' })
  await client.connect(clientTransport)
  return { facade, client }
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

async function runCode(client: Client, code: string): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name: 'run_code', arguments: { code, description: 'Test program' } })
  return { text: textOf(result), isError: result.isError === true }
}

let endpoint: Endpoint
let strict: Endpoint

beforeAll(async () => {
  process.env.CODEMODE_TEST_CANARY = PARENT_CANARY
  endpoint = await connect()
  strict = await connect({ timeoutMs: 400, maxOutputBytes: 256 })
})

afterAll(async () => {
  await endpoint.client.close()
  await strict.client.close()
  await endpoint.facade.close()
  await strict.facade.close()
  delete process.env.CODEMODE_TEST_CANARY
})

describe('code mode facade', () => {
  it('lists exactly run_code and catalog', async () => {
    const { tools } = await endpoint.client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(['catalog', 'run_code'])
  })

  it('runs a program that makes three upstream calls and returns only its summary', async () => {
    const program = `
const sum = await tools.mcp__fx__add({ a: 2, b: 3 })
const greeting = await tools.mcp__fx__greet({ name: 'Ada' })
const bulk = await tools.mcp__fx__bulk({})
console.log('env-keys', Object.keys(process.env).length)
return {
  sum: sum.content[0].text,
  greeting: greeting.content[0].text,
  canary: process.env.CODEMODE_TEST_CANARY ?? null,
  bulkIsLarge: bulk.content[0].text.length > 4000,
}
`
    const { text, isError } = await runCode(endpoint.client, program)
    expect(isError).toBe(false)
    expect(text).toContain('env-keys 0')
    expect(text).toContain('"sum": "5"')
    expect(text).toContain('"greeting": "Hello, Ada!"')
    expect(text).toContain('"canary": null')
    expect(text).toContain('"bulkIsLarge": true')
    expect(text).not.toContain(INTERMEDIATE_CANARY)
    expect(text).not.toContain('xxxx')
    expect(text).not.toContain(PARENT_CANARY)
  })

  it('hands a tool-level error to the program as a catchable rejection', async () => {
    const program = `
try {
  await tools.mcp__fx__fail({})
  return 'no error'
} catch (error) {
  return 'caught: ' + error.message
}
`
    const { text, isError } = await runCode(endpoint.client, program)
    expect(isError).toBe(false)
    expect(text).toContain('caught: boom: upstream refused the request')
  })

  it('reports an unknown binding with the catalog hint', async () => {
    const { text, isError } = await runCode(endpoint.client, 'await tools.mcp__fx__missing({})')
    expect(isError).toBe(true)
    expect(text).toContain('tools.mcp__fx__missing is not a function')
  })

  it('passes structured content through beside text', async () => {
    const { text } = await runCode(endpoint.client, `
const result = await tools.mcp__fx__structured({})
return { total: result.structuredContent.total, text: result.content[0].text }
`)
    expect(text).toContain('"total": 3')
    expect(text).toContain('"text": "{\\"total\\":3}"')
  })

  it('reports a program exception as code run failed', async () => {
    const { text, isError } = await runCode(endpoint.client, "throw new Error('bad input')")
    expect(isError).toBe(true)
    expect(text).toContain('code run failed (exception): bad input')
  })

  it('renders one server catalog and rejects an unknown server name', async () => {
    const catalog = await endpoint.client.callTool({ name: 'catalog', arguments: { server: 'fx' } })
    const text = textOf(catalog)
    expect(text).toContain('declare const tools: {')
    expect(text).toContain('mcp__fx__add: (args: {')
    expect(text).toContain('mcp__fx__greet')
    expect(text).toContain('mcp__fx__structured: (args: Record<string, unknown>) => Promise<McpToolResult>')
    expect(text).not.toContain('to load one server only.')

    const all = await endpoint.client.callTool({ name: 'catalog', arguments: {} })
    expect(textOf(all)).toContain('// Upstream servers: fx (7 tools).')

    const unknown = await endpoint.client.callTool({ name: 'catalog', arguments: { server: 'nope' } })
    expect(unknown.isError).toBe(true)
    expect(textOf(unknown)).toContain('unknown upstream server "nope"; configured servers: fx')
  })

  it('stops a program that outlives its deadline', async () => {
    const { text, isError } = await runCode(strict.client, 'await new Promise(resolve => setTimeout(resolve, 5000))')
    expect(isError).toBe(true)
    expect(text).toContain('code run failed (timeout): execution deadline reached (400ms)')
  })

  it('bounds the complete output', async () => {
    const { text, isError } = await runCode(strict.client, "return { blob: 'x'.repeat(4096) }")
    expect(isError).toBe(true)
    expect(text).toContain('code run failed (output-limit): program output exceeded 256 bytes')
  })

  it('refuses a return value that is not JSON data', async () => {
    const { text, isError } = await runCode(endpoint.client, 'return { when: new Date(0) }')
    expect(isError).toBe(true)
    expect(text).toContain('code run failed (invalid-output)')
  })

  it('passes non-text content through as JSON', async () => {
    const { text } = await runCode(endpoint.client, `
const result = await tools.mcp__fx__image({})
return { types: result.content.map(block => block.type), mime: result.content[1].mimeType }
`)
    expect(text).toContain('"text"')
    expect(text).toContain('"image"')
    expect(text).toContain('"mime": "image/png"')
  })

  it('bounds one upstream result, leaving the program able to recover', async () => {
    const capped = await connect({ maxUpstreamResultBytes: 64 })
    try {
      const { text, isError } = await runCode(capped.client, `
try {
  await tools.mcp__fx__bulk({})
  return 'no error'
} catch (error) {
  return error.message
}
`)
      expect(isError).toBe(false)
      expect(text).toContain('returned more than 64 bytes')
    } finally {
      await capped.client.close()
      await capped.facade.close()
    }
  })

  it('refuses an empty upstream list and reports which server failed to connect', async () => {
    await expect(createCodeModeFacade({ upstreams: [] })).rejects.toThrow('at least one upstream server is required')
    await expect(createCodeModeFacade({
      upstreams: [{ serverName: 'crash', transport: 'stdio', command: process.execPath, args: [CRASH] }],
    })).rejects.toThrow('upstream "crash" did not connect')
    await expect(createCodeModeFacade({
      upstreams: [
        { serverName: 'fx', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
        { serverName: 'fx', transport: 'stdio', command: process.execPath, args: [FIXTURE] },
      ],
    })).rejects.toThrow('upstream serverName "fx" is configured twice')
  })

  it('refuses a non-positive limit before connecting', async () => {
    await expect(createCodeModeFacade({
      upstreams: [{ serverName: 'fx', transport: 'stdio', command: process.execPath, args: [FIXTURE] }],
      timeoutMs: 0,
    })).rejects.toThrow('timeoutMs must be a positive integer')
  })

  it('rejects an empty description before running a program', async () => {
    const result = await endpoint.client.callTool({ name: 'run_code', arguments: { code: 'return 1', description: '   ' } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('invalid description: expected a non-empty string')
  })

  it('runs a program without an MCP cancellation signal', async () => {
    await expect(endpoint.facade.run('return 7', 'Direct call')).resolves.toMatchObject({ ok: true, value: 7 })
  })
})

describe('outcome rendering', () => {
  it('keeps the harness run_code text contract', () => {
    expect(renderOutcome({ ok: true, logs: [], durationMs: 1 }))
      .toEqual({ text: '(run_code completed with no output)', isError: false })
    expect(renderOutcome({ ok: true, logs: [{ level: 'log', text: 'line' }], durationMs: 1, value: 'plain' }))
      .toEqual({ text: 'line\nplain', isError: false })
    expect(renderOutcome({ ok: false, kind: 'timeout', message: 'late', logs: [{ level: 'log', text: 'line' }], durationMs: 1 }))
      .toEqual({ text: 'code run failed (timeout): late\nCaptured output:\nline', isError: true })
    expect(renderOutcome({ ok: false, kind: 'protocol', message: 'bad frame', logs: [], durationMs: 1 }))
      .toEqual({ text: 'code run failed (protocol): bad frame', isError: true })
  })
})
