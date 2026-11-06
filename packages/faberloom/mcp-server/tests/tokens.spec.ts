import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import FaberLoomMcpServer, { tokenId } from '../src/index.ts'
import { PROPOSAL_TOOL } from '../src/protocol.ts'
import { mcpServerDomainSpec, type TokenRecord } from '../src/spec.ts'

const OWNER = 'compras2@sondelsa.com'
const OTHER = 'otro@sondelsa.com'
const homes: string[] = []

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Boot the product services and the MCP server over one owner home. */
async function harness() {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-tokens-'))
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
  return { ctx, server: ctx.faberloomMcpServer, spaces: ctx.faberloomSpaces, board: ctx.faberloomBoard, endpoint: { port } }
}

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => probe.close(() => { resolve() }))
  return port
}

async function waitForServer(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const probe = await post(port, { jsonrpc: '2.0', id: 0, method: 'ping' })
      if (probe.status === 401) return
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`MCP server did not answer on port ${String(port)}`)
}

function post(port: number, body: unknown, token?: string): Promise<{ status: number; text: string }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        accept: 'application/json',
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

/** The bridge surface used by the test, without dragging the service type in. */
interface BridgeHost {
  request(body: string, token: string): Promise<{ status: number; body: string }>
}

/** One bridge request, the same path a public `/mcp` call takes. */
async function bridge(server: BridgeHost, token: string, body: unknown) {
  const answer = await server.request(JSON.stringify(body), token)
  return { status: answer.status, body: JSON.parse(answer.body) as Record<string, unknown> }
}

/** One valid proposal payload. */
function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    archivo: 'knowledge/procedimiento.md',
    versionBase: 'rev-7',
    cambio: 'Añadir la verificación previa.',
    motivo: 'La revisión detectó un hueco.',
    evidencia: ['oc:505288'],
    claveCliente: 'token-clave-1',
    title: 'Verificar antes de publicar',
    ...overrides,
  }
}

/** Boot one space owned by the given identity and return its id. */
async function makeSpace(spaces: Awaited<ReturnType<typeof harness>>['spaces'], owner: string, title: string): Promise<string> {
  const space = await spaces.create({ id: owner, role: 'client_b2b', companyId: undefined, readOnly: false }, { title })
  return space.id
}

/** Seed one stored token record directly, including a legacy row without spaceId. */
async function seedToken(
  ctx: Awaited<ReturnType<typeof harness>>['ctx'],
  token: string,
  record: Omit<TokenRecord, 'spaceId' | 'referenceId' | 'expiresAt'> & {
    readonly spaceId?: string | null
    readonly referenceId?: string | null
    readonly expiresAt?: string | null
  },
): Promise<void> {
  const domain = await ctx.storageDomain.open(mcpServerDomainSpec)
  await domain.table('tokens').put(token, {
    spaceId: null,
    referenceId: null,
    expiresAt: null,
    ...record,
  })
  await domain.close()
}

/** Mutate one already-open token row, for fixtures the public API must not create. */
async function mutateToken(
  ctx: Awaited<ReturnType<typeof harness>>['ctx'],
  token: string,
  patch: Partial<TokenRecord>,
): Promise<void> {
  const domain = ctx.storageDomain.get('faberloom_mcp')
  if (domain === undefined) throw new Error('the MCP token domain is not open')
  const table = domain.table('tokens') as {
    get(key: string): TokenRecord | undefined
    put(key: string, value: TokenRecord): Promise<void>
  }
  const current = table.get(token)
  if (current === undefined) throw new Error('the token row is missing')
  await table.put(token, { ...current, ...patch })
}

describe('MCP token scope and space (AUTH-04, AUTH-06, CON-02, PROP-09)', () => {
  it('lists fingerprints instead of bearer secrets and revokes by fingerprint', async () => {
    const { server } = await harness()
    const minted = await server.mintToken('Claude', [PROPOSAL_TOOL])
    expect(minted.token).toMatch(/^fbl_[0-9a-f]{32}$/u)
    expect(minted.row.id).toBe(tokenId(minted.token))

    const rows = await server.listTokens()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: minted.row.id, label: 'Claude', spaceId: null })
    expect(JSON.stringify(rows)).not.toContain(minted.token)

    expect(await server.revokeToken(minted.row.id)).toBe(true)
    expect((await server.listTokens())[0]?.revokedAt).not.toBeNull()
  })

  it('reads a legacy record without spaceId as an owner-wide token and revokes it by fingerprint', async () => {
    const { ctx, server } = await harness()
    const token = 'fbl_legacy0000000000000000000000000000'
    await seedToken(ctx, token, {
      ownerId: OWNER,
      label: 'Legacy',
      createdAt: '2026-10-01T00:00:00.000Z',
      revokedAt: null,
      scopes: null,
      companyId: null,
    })
    const rows = await server.listTokens()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: tokenId(token), label: 'Legacy', spaceId: null })

    const listing = await bridge(server, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(listing.status).toBe(200)
    expect(JSON.stringify(listing.body)).toContain('faberloom_overview')
    expect(await server.revokeToken(tokenId(token))).toBe(true)
    expect((await bridge(server, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401)
  })

  it('refuses a proposal token that carries another scope, an unknown scope, or a foreign space', async () => {
    const { server, spaces } = await harness()
    await expect(server.mintToken('Mezcla', [PROPOSAL_TOOL, 'faberloom_overview']))
      .rejects.toThrow('PROPOSAL_SCOPE_EXCLUSIVE')
    await expect(server.mintToken('Desconocido', ['faberloom_no_existe'])).rejects.toThrow('MCP_SCOPE_UNKNOWN')
    const foreign = await makeSpace(spaces, OTHER, 'Ajena')
    await expect(server.mintToken('Ajena', [PROPOSAL_TOOL], null, foreign)).rejects.toThrow(/space access denied|NO_ACCESS/iu)
  })

  it('requires the proposal tool as the only scope when a space is set', async () => {
    const { server, spaces } = await harness()
    const spaceId = await makeSpace(spaces, OWNER, 'A1')
    await expect(server.mintToken('Ancho', ['faberloom_overview'], null, spaceId))
      .rejects.toThrow('PROPOSAL_SPACE_REQUIRES_PROPOSAL_SCOPE')
    await expect(server.mintToken('Todo', null, null, spaceId))
      .rejects.toThrow('PROPOSAL_SPACE_REQUIRES_PROPOSAL_SCOPE')
  })

  it('keeps a legacy token with a retired scope working and ignores that entry', async () => {
    const { ctx, server } = await harness()
    const legacy = 'fbl_retired00000000000000000000000000'
    await seedToken(ctx, legacy, {
      ownerId: OWNER,
      label: 'Retired',
      createdAt: '2026-10-01T00:00:00.000Z',
      revokedAt: null,
      scopes: ['faberloom_overview', 'faberloom_board_review'],
      companyId: null,
    })
    const rows = await server.listTokens()
    expect(rows[0]?.scopes).toEqual(['faberloom_overview'])

    const listed = await bridge(server, legacy, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(listed.status).toBe(200)
    const names = (listed.body['result'] as { tools: { name: string }[] }).tools.map(tool => tool.name)
    expect(names).toEqual(['faberloom_overview'])
  })

  it('stops a space-scoped token when the owner is removed from the space', async () => {
    const { server, spaces } = await harness()
    const space = await spaces.create({ id: OTHER, role: 'client_b2b', companyId: undefined, readOnly: false }, { title: 'Compartido' })
    await spaces.update({ id: OTHER, role: 'client_b2b', companyId: undefined, readOnly: false }, space.id, {
      members: [OWNER],
    })
    const { token } = await server.mintToken('Miembro', [PROPOSAL_TOOL], null, space.id)
    expect((await bridge(server, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(200)

    await spaces.update({ id: OTHER, role: 'client_b2b', companyId: undefined, readOnly: false }, space.id, {
      members: [],
    })
    expect((await bridge(server, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401)
  })

  it('lets a proposal token submit and denies every other tool (CON-02)', async () => {
    const { server } = await harness()
    const { token } = await server.mintToken('Propuestas', [PROPOSAL_TOOL])
    const listed = await bridge(server, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = (listed.body['result'] as { tools: { name: string }[] }).tools.map(tool => tool.name)
    expect(tools).toEqual([PROPOSAL_TOOL])

    const submitted = await bridge(server, token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    const receipt = JSON.parse((submitted.body['result'] as { content: { text: string }[] }).content[0]!.text) as { recibida: boolean; id: string }
    expect(receipt.recibida).toBe(true)

    const denied = await bridge(server, token, {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'faberloom_overview', arguments: {} },
    })
    expect(denied.body).toMatchObject({ error: { code: -32602 } })
    expect(denied.body).not.toHaveProperty('result')
  })

  it('lets a read token read and denies the proposal (CON-02)', async () => {
    const { server } = await harness()
    const { token } = await server.mintToken('Lectura', ['faberloom_overview'])
    const listed = await bridge(server, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const tools = (listed.body['result'] as { tools: { name: string }[] }).tools.map(tool => tool.name)
    expect(tools).toEqual(['faberloom_overview'])

    const denied = await bridge(server, token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    expect(denied.body).toMatchObject({ error: { code: -32602 } })
    expect(denied.body).not.toHaveProperty('result')
  })

  it('refuses a stored scope list that mixes the proposal tool or names an unknown tool', async () => {
    const { ctx, server } = await harness()
    const mixed = 'fbl_mixed000000000000000000000000000'
    const unknown = 'fbl_unknown000000000000000000000000'
    await seedToken(ctx, mixed, {
      ownerId: OWNER, label: 'Mixed', createdAt: '2026-11-06T00:00:00.000Z', revokedAt: null,
      scopes: [PROPOSAL_TOOL, 'faberloom_overview'], companyId: null,
    })
    await seedToken(ctx, unknown, {
      ownerId: OWNER, label: 'Unknown', createdAt: '2026-11-06T00:00:00.000Z', revokedAt: null,
      scopes: ['faberloom_no_existe'], companyId: null,
    })
    expect((await bridge(server, mixed, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
    expect((await bridge(server, unknown, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401)
  })

  it('propagates the token space to the proposal and refuses one whose membership was lost', async () => {
    const { ctx, server, spaces, board } = await harness()
    const spaceId = await makeSpace(spaces, OWNER, 'A1')
    const { token, row } = await server.mintToken('A1', [PROPOSAL_TOOL], null, spaceId)
    expect(row.spaceId).toBe(spaceId)

    const submitted = await bridge(server, token, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    const receipt = JSON.parse((submitted.body['result'] as { content: { text: string }[] }).content[0]!.text) as { id: string }
    const item = await board.get({ id: OWNER }, receipt.id as never)
    expect(item.spaceId).toBe(spaceId)
    expect(item.sourceRef).toContain(encodeURIComponent(spaceId.toUpperCase()))

    // A stored token that names a space its owner cannot read is not accepted.
    const stale = await server.mintToken('Stale', [PROPOSAL_TOOL], null, spaceId)
    const foreign = await makeSpace(spaces, OTHER, 'Ajena')
    await mutateToken(ctx, stale.token, { spaceId: foreign })
    expect((await bridge(server, stale.token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(401)
  })

  it('does not let a full-surface token approve a proposal (PROP-09)', async () => {
    const { server, board } = await harness()
    const full = await server.mintToken('Completo')
    const submitted = await bridge(server, full.token, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    const receipt = JSON.parse((submitted.body['result'] as { content: { text: string }[] }).content[0]!.text) as { id: string }
    const item = await board.get({ id: OWNER }, receipt.id as never)
    const denied = await bridge(server, full.token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'faberloom_board_approve',
        arguments: {
          id: receipt.id,
          rowVersion: item.rowVersion,
          artifactVersion: item.version,
          artifactHash: item.artifactHash,
        },
      },
    })
    expect(denied.body).toMatchObject({ result: { isError: true } })
    expect(JSON.stringify(denied.body)).toContain('HUMAN_ACTION_REQUIRED')
    expect((await board.get({ id: OWNER }, receipt.id as never)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('refuses a revoked token over HTTP and over the bridge', async () => {
    const { server, endpoint } = await harness()
    await waitForServer(endpoint.port)
    const minted = await server.mintToken('Revocable', [PROPOSAL_TOOL])
    expect((await post(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, minted.token)).status).toBe(200)
    await server.revokeToken(minted.row.id)
    expect((await post(endpoint.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, minted.token)).status).toBe(401)
    expect((await bridge(server, minted.token, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).status).toBe(401)
  })
})
