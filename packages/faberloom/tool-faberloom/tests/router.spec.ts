import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, type Config } from '../src/index.ts'

/** One tools/call the fake MWT MCP received. */
interface MwtCall {
  readonly tenant: string
  readonly tool: string
}

/**
 * A minimal MCP Streamable HTTP server: initialize, initialized, tools/call.
 * Only `expediente_buscar` carries data, and only for tenant `ent2`.
 */
function fakeMwt(calls: MwtCall[]): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      const message = JSON.parse(body) as { id?: number; method?: string; params?: { name?: string } }
      const tenant = String(req.headers['x-mwt-client-id'] ?? '')
      if (message.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } }))
        return
      }
      if (message.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      if (message.method === 'tools/call') {
        const tool = message.params?.name ?? ''
        calls.push({ tenant, tool })
        const data = tool === 'expediente_buscar' && tenant === 'ent2' ? [{ expediente: 'EXP-1' }] : []
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } }))
        return
      }
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: 'unknown method' } }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${String(address.port)}/mcp` })
    })
  })
}

const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never) => Promise<never>
}

/** Boot the product tools over a stub tool registry and capture the definitions. */
function harness(config: Config): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: {
      register: (definition: CapturedTool) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    get: () => undefined,
  }
  apply(ctx as never, config)
  return registered
}

const CONFIG: Omit<Config, 'mcpUrl'> = {
  ownerId: 'multi@muitowork.com',
  role: 'admin',
  companyId: 'ent1',
  companyIds: ['ent1', 'ent2'],
  readOnly: false,
  mcpGatewayKey: 'fake-key',
}

describe('faberloom multi-company router', () => {
  it('lists the user companies with the active one marked', async () => {
    const calls: MwtCall[] = []
    const fake = await fakeMwt(calls)
    servers.push(fake.server)
    const tools = harness({ ...CONFIG, mcpUrl: fake.url })
    const companies = tools.get('faberloom_companies')
    expect(companies).toBeDefined()
    const result = await companies!.execute({} as never) as unknown as { companies: { id: string; active: boolean }[] }
    expect(result.companies).toEqual([
      { id: 'ent1', active: true },
      { id: 'ent2', active: false },
    ])
  })

  it('calls one MWT tool against another company of the user', async () => {
    const calls: MwtCall[] = []
    const fake = await fakeMwt(calls)
    servers.push(fake.server)
    const tools = harness({ ...CONFIG, mcpUrl: fake.url })
    const call = tools.get('faberloom_mwt_call')
    expect(call).toBeDefined()
    const result = await call!.execute({ company: 'ent2', tool: 'expediente_buscar', arguments: { q: 'EXP' } } as never) as unknown as { company: string; result: unknown }
    expect(result.company).toBe('ent2')
    expect(result.result).toEqual([{ expediente: 'EXP-1' }])
    expect(calls).toEqual([{ tenant: 'ent2', tool: 'expediente_buscar' }])
  })

  it('refuses a company that does not belong to the user', async () => {
    const calls: MwtCall[] = []
    const fake = await fakeMwt(calls)
    servers.push(fake.server)
    const tools = harness({ ...CONFIG, mcpUrl: fake.url })
    const call = tools.get('faberloom_mwt_call')
    await expect(call!.execute({ company: 'ent3', tool: 'expediente_buscar' } as never)).rejects.toThrow('no es una empresa de este usuario')
    expect(calls).toHaveLength(0)
  })

  it('finds which company holds the data with one fan-out', async () => {
    const calls: MwtCall[] = []
    const fake = await fakeMwt(calls)
    servers.push(fake.server)
    const tools = harness({ ...CONFIG, mcpUrl: fake.url })
    const find = tools.get('faberloom_mwt_find')
    expect(find).toBeDefined()
    const result = await find!.execute({ tool: 'expediente_buscar', arguments: { q: 'EXP' } } as never) as unknown as {
      foundIn: string
      results: { company: string; found: boolean; data: unknown }[]
    }
    expect(result.foundIn).toBe('ent2')
    expect(result.results.map(entry => [entry.company, entry.found])).toEqual([['ent1', false], ['ent2', true]])
    expect(calls.map(call => call.tenant).sort()).toEqual(['ent1', 'ent2'])
  })

  it('reports when no company returns data', async () => {
    const calls: MwtCall[] = []
    const fake = await fakeMwt(calls)
    servers.push(fake.server)
    const tools = harness({ ...CONFIG, mcpUrl: fake.url })
    const find = tools.get('faberloom_mwt_find')
    const result = await find!.execute({ tool: 'otra_tool' } as never) as unknown as { foundIn: string }
    expect(result.foundIn).toBe('')
  })
})
