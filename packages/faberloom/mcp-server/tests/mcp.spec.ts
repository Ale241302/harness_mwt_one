import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomAgents from '../../agents/src/index.ts'
import FaberLoomBackup from '../../backup/src/index.ts'
import FaberLoomBoard from '../../board/src/index.ts'
import FaberLoomConnections from '../../connections/src/index.ts'
import FaberLoomLearning from '../../learning/src/index.ts'
import FaberLoomMirror from '../../mirror/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomSpaces from '../../spaces/src/index.ts'
import FaberLoomMcpServer from '../src/index.ts'
import { FaberLoomToolHost } from '../src/tools.ts'
import { dispatch, PROTOCOL_VERSION } from '../src/protocol.ts'

const OWNER = 'compras2@sondelsa.com'
const homes: string[] = []

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Boot the product services plus the MCP server over one owner home. */
async function harness() {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-mcp-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  await ctx.plugin(FaberLoomAgents)
  await ctx.plugin(FaberLoomBoard)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomLearning)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomBackup)
  await ctx.plugin(FaberLoomConnections)
  await ctx.plugin(FaberLoomMirror, { enabled: false })
  const port = await freePort()
  await ctx.plugin(FaberLoomMcpServer, { ownerId: OWNER, enabled: true, socketPath: '', port })
  return { ctx, server: ctx.faberloomMcpServer, endpoint: { port }, routines: ctx.faberloomRoutines, memory: ctx.faberloomMemory }
}

/** Bind an ephemeral port and release it, so the server can take it. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => probe.close(() => { resolve() }))
  return port
}

/** Wait until the server answers on its endpoint (a pipe on Windows, a socket file elsewhere). */
async function waitForServer(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      // No token: a 401 still proves the transport is up and answering.
      const probe = await post(port, { jsonrpc: '2.0', id: 0, method: 'ping' })
      if (probe.status === 401) return
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`MCP server did not answer on port ${String(port)}`)
}

/** One HTTP POST to the MCP endpoint, as a client would send it. */
function post(port: number, body: unknown, token?: string, accept = 'application/json'): Promise<{ status: number; text: string }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        accept,
        ...token === undefined ? {} : { authorization: `Bearer ${token}` },
      },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, text }) })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

describe('FaberLoomMcpServer', () => {
  it('F04 — answers the MCP handshake and lists the FaberLoom tools', async () => {
    const { server, endpoint } = await harness()
    await waitForServer(endpoint.port)
    const token = (await server.mintToken('Claude')).token

    const init = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION } }, token)
    expect(init.status).toBe(200)
    expect(JSON.parse(init.text)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: PROTOCOL_VERSION, serverInfo: { name: 'faberloom' }, capabilities: { tools: {} } },
    })

    const list = await post(endpoint.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, token)
    const tools = (JSON.parse(list.text) as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)
    expect(tools).toContain('faberloom_overview')
    expect(tools).toContain('faberloom_routine_run')
    // G3 · the same operations the panels use are reachable over MCP.
    expect(tools).toContain('faberloom_space_create')
    expect(tools).toContain('faberloom_agent_policy')
    expect(tools).toContain('faberloom_board_review')
    expect(tools).toContain('faberloom_grant')
    expect(tools).toContain('faberloom_backup_create')
    expect(tools).toContain('faberloom_migrations_run')
    // The full product surface: skills, memory, context, workflows, email,
    // MCP connections, workspaces and chat sessions, routine CRUD, purge.
    expect(tools).toContain('faberloom_skills')
    expect(tools).toContain('faberloom_skill_save')
    expect(tools).toContain('faberloom_memory_update')
    expect(tools).toContain('faberloom_context_create')
    expect(tools).toContain('faberloom_workflow_node_add')
    expect(tools).toContain('faberloom_email_read')
    expect(tools).toContain('faberloom_mcp_server_save')
    expect(tools).toContain('faberloom_workspace_create')
    expect(tools).toContain('faberloom_session_send')
    expect(tools).toContain('faberloom_routine_create')
    expect(tools).toContain('faberloom_agent_purge')

    // A notification is accepted without a body.
    const notification = await post(endpoint.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, token)
    expect(notification.status).toBe(202)
    expect(notification.text).toBe('')
  })

  it('F04 — refuses a missing, unknown, or revoked token', async () => {
    const { server, endpoint } = await harness()
    await waitForServer(endpoint.port)
    const missing = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(missing.status).toBe(401)
    const unknown = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'fbl_nope')
    expect(unknown.status).toBe(401)

    const token = (await server.mintToken('Claude')).token
    expect(await server.revokeToken(token)).toBe(true)
    const revoked = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)
    expect(revoked.status).toBe(401)
    expect(await server.revokeToken(token)).toBe(false)
  })

  it('F04 — a tool call reads and writes the owner\'s own workspace', async () => {
    const { server, endpoint, routines, memory } = await harness()
    await waitForServer(endpoint.port)
    const token = (await server.mintToken('Claude')).token
    await memory.createTeaching(OWNER, { scope: 'global', text: 'Comprobar el precio antes de cotizar.', source: 'prueba', author: OWNER, active: true })

    const overview = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'faberloom_overview', arguments: {} } }, token)
    const overviewBody = JSON.parse(overview.text) as { result: { content: { text: string }[]; isError?: boolean } }
    expect(overviewBody.result.isError).toBeUndefined()
    expect(JSON.parse(overviewBody.result.content[0]!.text)).toMatchObject({ executions: 0 })

    const teachings = await post(endpoint.port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'faberloom_teachings', arguments: {} } }, token)
    expect((JSON.parse(teachings.text) as { result: { content: { text: string }[] } }).result.content[0]!.text).toContain('Comprobar el precio')

    const recorded = await post(endpoint.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'faberloom_teaching_record', arguments: { text: 'Pedir el albarán al transportista.', task: 'seguimiento' } } }, token)
    expect((JSON.parse(recorded.text) as { result: { content: { text: string }[] } }).result.content[0]!.text).toContain('active')
    expect((await memory.listTeachings(OWNER)).length).toBe(2)

    // A routine run through MCP obeys the same autonomy guard as the panels.
    routines.registerHandler('enviar', () => 'ok')
    const routine = await routines.createRoutine(OWNER, {
      name: 'Con efecto',
      definition: {
        intent: 'enviar',
        triggers: [],
        steps: [{ id: 's1', instruction: 'envia', handler: 'enviar', effect: true }],
        expectedResult: 'enviado',
        permissions: ['documents.send'],
        failurePolicy: 'review',
      },
    })
    await routines.activateRoutine(OWNER, routine.id)
    const denied = await post(endpoint.port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'faberloom_routine_run', arguments: { routineId: String(routine.id), idempotencyKey: 'mcp-1' } } }, token)
    expect((JSON.parse(denied.text) as { result: { content: { text: string }[] } }).result.content[0]!.text).toContain('NOT_AUTHORIZED')
  })

  it('F04 — the mirror tools export this home and apply a document onto it', async () => {
    const { server, endpoint, ctx } = await harness()
    await waitForServer(endpoint.port)
    const token = (await server.mintToken('Espejo')).token
    // Reading the catalogue opens the agent domain, which is what a mounted
    // product module does on boot; the mirror then has a table to write into.
    await ctx.faberloomAgents.listAgents()

    // The tool advertises the document this home holds, and applying a refused
    // version writes nothing.
    const exported = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'faberloom_mirror_export', arguments: {} } }, token)
    const document = JSON.parse((JSON.parse(exported.text) as { result: { content: { text: string }[] } }).result.content[0]!.text) as {
      document: { version: number; platform: string; domains: Record<string, unknown> }
    }
    expect(document.document.version).toBe(1)
    expect(document.document.platform).toBe('desktop')
    // The document names the product domains this process holds open; a domain
    // that is not open is reported as skipped rather than read as empty.
    expect(Object.keys(document.document.domains)).toContain('faberloom_mcp')

    const refused = await post(endpoint.port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'faberloom_mirror_apply', arguments: { document: { version: 99, platform: 'web', domains: {}, skills: {} } } },
    }, token)
    expect((JSON.parse(refused.text) as { result: { isError?: boolean; content: { text: string }[] } }).result.content[0]!.text)
      .toContain('unsupported format version')

    const applied = await post(endpoint.port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'faberloom_mirror_apply',
        arguments: {
          document: {
            version: 1,
            platform: 'web',
            domains: { faberloom_agents: { tables: { agents: { ag1: { deleted: false, value: { id: 'ag1', name: 'Desde la web' } } } } } },
            skills: { 'informe-diario': '# Informe\n\nCuerpo.' },
          },
        },
      },
    }, token)
    const appliedBody = JSON.parse((JSON.parse(applied.text) as { result: { content: { text: string }[] } }).result.content[0]!.text) as {
      applied: { domain: string; table: string; key: string }[]
      skillsApplied: string[]
    }
    expect(appliedBody.applied).toEqual([{ domain: 'faberloom_agents', table: 'agents', key: 'ag1' }])
    expect(appliedBody.skillsApplied).toEqual(['informe-diario'])
    // The mirror writes the stored row; the product service reads it as its own.
    expect(ctx.storageDomain.get('faberloom_agents')?.table('agents').get('ag1')).toMatchObject({ name: 'Desde la web' })
  })

  it('F04 — the mirror tools refuse a process that does not mount the mirror row', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    const host = new FaberLoomToolHost(ctx, OWNER, null)
    await expect(host.call('faberloom_mirror_export', {})).rejects.toThrow('not mounted')
    await expect(host.call('faberloom_mirror_apply', { document: {} })).rejects.toThrow('not mounted')
  })

  it('F04 — a scoped token lists and calls only its tools', async () => {
    const { server, endpoint } = await harness()
    await waitForServer(endpoint.port)
    const token = (await server.mintToken('Solo lectura', ['faberloom_overview'])).token

    const list = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)
    const tools = (JSON.parse(list.text) as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)
    expect(tools).toEqual(['faberloom_overview'])

    const allowed = await post(endpoint.port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'faberloom_overview', arguments: {} } }, token)
    expect((JSON.parse(allowed.text) as { result: { isError?: boolean } }).result.isError).toBeUndefined()

    const refused = await post(endpoint.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'faberloom_teaching_record', arguments: { text: 'no debería' } } }, token)
    expect(JSON.parse(refused.text)).toMatchObject({ error: { code: -32602 } })
    expect((JSON.parse(refused.text) as { error: { message: string } }).error.message).toContain('faberloom_teaching_record')

    const full = await server.mintToken('Completo')
    expect(full.scopes).toBeNull()
    const all = await post(endpoint.port, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, full.token)
    expect((JSON.parse(all.text) as { result: { tools: unknown[] } }).result.tools.length).toBeGreaterThan(1)
  })

  it('F04 — a client asking for events receives SSE frames it can parse', async () => {
    const { server, endpoint } = await harness()
    await waitForServer(endpoint.port)
    const token = (await server.mintToken('SSE')).token
    const frame = await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, token, 'text/event-stream')
    expect(frame.status).toBe(200)
    // The stream is bracketed by comments and carries at least one message frame.
    expect(frame.text).toContain(': faberloom stream open')
    expect(frame.text).toContain('event: message\ndata: ')
    const payload = frame.text.split('event: message\ndata: ')[1]?.split('\n\n')[0] ?? ''
    expect(JSON.parse(payload)).toMatchObject({ result: { serverInfo: { name: 'faberloom' } } })
  })

  it('F04 — answers a bridged request through the same token and protocol', async () => {
    const { server } = await harness()
    const token = (await server.mintToken('Puente')).token
    const answer = await server.request(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), token)
    expect(answer.status).toBe(200)
    expect(answer.contentType).toBe('application/json; charset=utf-8')
    const tools = (JSON.parse(answer.body) as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)
    expect(tools).toContain('faberloom_session_send')

    const refused = await server.request(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), 'fbl_nope')
    expect(refused.status).toBe(401)

    const malformed = await server.request('{nope', token)
    expect(malformed.status).toBe(400)

    const streamed = await server.request(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }), token, 'text/event-stream')
    expect(streamed.contentType).toContain('text/event-stream')
    expect(streamed.body).toContain('event: message\ndata: ')
  })

  it('F04 — protocol errors are answered, not hidden', async () => {
    const host = { tools: () => [], call: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }) }
    expect(await dispatch(host, null)).toMatchObject({ status: 200, body: { error: { code: -32600 } } })
    expect(await dispatch(host, { jsonrpc: '1.0', id: 1, method: 'ping' })).toMatchObject({ body: { error: { code: -32600 } } })
    expect(await dispatch(host, { jsonrpc: '2.0', id: 1, method: 'nope' })).toMatchObject({ body: { error: { code: -32601 } } })
    expect(await dispatch(host, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ghost' } })).toMatchObject({ body: { error: { code: -32602 } } })
    expect(await dispatch(host, { jsonrpc: '2.0', id: 1, method: 'ping' })).toMatchObject({ body: { result: {} } })
  })
})
