import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import FaberLoomMcpServer, { tokenId, WORK_REFERENCE_HEADER } from '../src/index.ts'
import { LOCAL_CLIENT_ID, pkceChallenge } from '../src/oauth.ts'
import { PROPOSAL_TOOL, PUBLICATION_READ_TOOL } from '../src/protocol.ts'

const OWNER = 'compras2@sondelsa.com'
const REDIRECT = 'http://127.0.0.1:59999/callback'
const STATE = 'state-1234567890123456'
const homes: string[] = []

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Boot the product services and the MCP server over one owner home. */
async function harness(config: { readonly publicationRepo?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-oauth-'))
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
  await ctx.plugin(FaberLoomMcpServer, { ownerId: OWNER, enabled: true, socketPath: '', port, ...config })
  await waitForServer(port)
  return { ctx, server: ctx.faberloomMcpServer, spaces: ctx.faberloomSpaces, board: ctx.faberloomBoard, port }
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
      const probe = await get(port, '/.well-known/oauth-authorization-server')
      if (probe.status === 200) return
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`MCP server did not answer on port ${String(port)}`)
}

/** One token exchange answer. */
interface TokenResponse {
  readonly access_token?: string
  readonly work_reference?: { readonly id: string; readonly spaceId: string | null; readonly revision: string | null }
}

/** One authorization-server metadata document. */
interface Metadata {
  readonly issuer: string
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly resource: string
  readonly code_challenge_methods_supported: string[]
}

interface Answer {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly text: string
}

function call(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Answer> {
  const payload = body === undefined ? undefined : Buffer.from(body, 'utf8')
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...headers,
        ...payload === undefined ? {} : { 'content-length': payload.length },
      },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, text }) })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

function get(port: number, path: string): Promise<Answer> {
  return call(port, 'GET', path)
}

function form(port: number, path: string, fields: Record<string, string>): Promise<Answer> {
  return call(port, 'POST', path, new URLSearchParams(fields).toString(), {
    'content-type': 'application/x-www-form-urlencoded',
  })
}

function mcp(port: number, token: string, reference: string | null, body: unknown): Promise<Answer> {
  return call(port, 'POST', '/mcp', JSON.stringify(body), {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    ...reference === null ? {} : { [WORK_REFERENCE_HEADER]: reference },
  })
}

/** One valid proposal payload. */
function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    archivo: 'knowledge/procedimiento.md',
    versionBase: 'rev-7',
    cambio: 'Añadir la verificación previa.',
    motivo: 'La revisión detectó un hueco.',
    evidencia: ['oc:505288'],
    claveCliente: 'oauth-clave-1',
    title: 'Verificar antes de publicar',
    ...overrides,
  }
}

/** The query string a client sends to `/authorize`. */
function authorizeQuery(port: number, spaceId: string, verifier: string, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LOCAL_CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    state: STATE,
    resource: `http://127.0.0.1:${String(port)}/mcp`,
    scope: PROPOSAL_TOOL,
    space_id: spaceId,
    ...overrides,
  })
  return params.toString()
}

/** Walk the waiting page, approve it in the product UI, and return the code. */
async function authorize(
  server: Awaited<ReturnType<typeof harness>>['server'],
  port: number,
  spaceId: string,
  verifier: string,
  overrides: Record<string, string> = {},
): Promise<string> {
  const page = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier, overrides)}`)
  expect(page.status).toBe(200)
  const transaction = /transaction=([^"&<]+)/u.exec(page.text)?.[1]
  if (transaction === undefined) throw new Error('waiting page has no transaction')
  expect(await server.decideAuthorization(decodeURIComponent(transaction), true, OWNER)).toBe(true)
  const status = await get(port, `/authorize/status?transaction=${transaction}`)
  expect(status.status).toBe(302)
  const location = String(status.headers['location'])
  const code = new URL(location).searchParams.get('code')
  if (code === null) throw new Error('approval did not return a code')
  return code
}

/** Exchange one code for a token and its work reference. */
async function exchange(port: number, code: string, verifier: string, overrides: Record<string, string> = {}) {
  const answer = await form(port, '/token', {
    grant_type: 'authorization_code',
    code,
    client_id: LOCAL_CLIENT_ID,
    redirect_uri: REDIRECT,
    resource: `http://127.0.0.1:${String(port)}/mcp`,
    code_verifier: verifier,
    ...overrides,
  })
  return { answer, body: JSON.parse(answer.text) as TokenResponse }
}

/** Mutate one already-open OAuth row, for fixtures the public API must not create. */
async function mutateOauth(
  ctx: Awaited<ReturnType<typeof harness>>['ctx'],
  tableName: 'authorizations' | 'codes',
  match: (value: Record<string, unknown>) => boolean,
  patch: Record<string, unknown>,
): Promise<void> {
  const domain = ctx.storageDomain.get('faberloom_mcp_oauth')
  if (domain === undefined) throw new Error('the OAuth domain is not open')
  const table = domain.table(tableName) as {
    entries(): IterableIterator<[string, Record<string, unknown>]>
    put(key: string, value: Record<string, unknown>): Promise<void>
  }
  for (const [key, value] of table.entries()) {
    if (!match(value)) continue
    await table.put(key, { ...value, ...patch })
    return
  }
  throw new Error(`no ${tableName} row matched the fixture`)
}

async function makeSpace(spaces: Awaited<ReturnType<typeof harness>>['spaces'], title: string): Promise<string> {
  const space = await spaces.create({ id: OWNER, role: 'client_b2b', companyId: undefined, readOnly: false }, { title })
  return space.id
}

/** A local Git publication with two commits of the same file. */
function publicationRepo(): { readonly repo: string; readonly first: string; readonly second: string } {
  const repo = mkdtempSync(join(tmpdir(), 'faberloom-publication-'))
  homes.push(repo)
  const git = (...args: string[]): string => execFileSync('git', [
    '-C', repo, '-c', 'user.email=owner@example.test', '-c', 'user.name=Owner', ...args,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  git('init')
  mkdirSync(join(repo, 'knowledge'))
  writeFileSync(join(repo, 'knowledge', 'procedimiento.md'), 'versión uno\n')
  git('add', '.')
  git('commit', '-m', 'primera')
  const first = git('rev-parse', 'HEAD')
  writeFileSync(join(repo, 'knowledge', 'procedimiento.md'), 'versión dos\n')
  git('add', '.')
  git('commit', '-m', 'segunda')
  return { repo, first, second: git('rev-parse', 'HEAD') }
}

/** The text of a refusal, whether the dispatcher rejected the tool or the host did. */
function refusalText(answer: Answer): string {
  const parsed = JSON.parse(answer.text) as {
    result?: { content?: { text: string }[] }
    error?: { message: string }
  }
  return parsed.error?.message ?? parsed.result?.content?.[0]?.text ?? ''
}

/** Read the text of the single content block a tool answered with. */
function contentText(answer: Answer): string {
  const parsed = JSON.parse(answer.text) as {
    result?: { content?: { text: string }[] }
    error?: { message: string }
  }
  if (parsed.error !== undefined) throw new Error(parsed.error.message)
  return parsed.result?.content?.[0]?.text ?? ''
}

describe('local OAuth and work references (CON-01..04, AUTH-04/08, UX-01)', () => {
  it('shows the authorized Space and the scopes on the consent page (UX-01)', async () => {
    const { port, spaces } = await harness()
    const spaceId = await makeSpace(spaces, 'Proyecto visible')
    const page = await get(port, `/authorize?${authorizeQuery(port, spaceId, 'h'.repeat(64))}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('Proyecto visible')
    expect(page.text).toContain(PROPOSAL_TOOL)
    expect(page.text).toContain('FaberLoom')
    expect(page.text).not.toContain('Autorizar')
    expect(page.text).not.toContain('fbl_')
  })

  it('publishes its metadata with the local issuer and MCP resource', async () => {
    const { port } = await harness()
    const answer = await get(port, '/.well-known/oauth-authorization-server')
    expect(answer.status).toBe(200)
    const metadata = JSON.parse(answer.text) as Metadata
    expect(metadata.issuer).toBe(`http://127.0.0.1:${String(port)}`)
    expect(metadata.authorization_endpoint).toBe(`${metadata.issuer}/authorize`)
    expect(metadata.token_endpoint).toBe(`${metadata.issuer}/token`)
    expect(metadata.resource).toBe(`http://127.0.0.1:${String(port)}/mcp`)
    expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
  })

  it('authorizes in the browser, exchanges the code, and files the proposal in the chosen Space', async () => {
    const { port, spaces, board, server } = await harness()
    const spaceId = await makeSpace(spaces, 'Proyecto A1')
    const verifier = 'a'.repeat(64)
    const code = await authorize(server, port, spaceId, verifier)
    const { answer, body } = await exchange(port, code, verifier)
    expect(answer.status).toBe(200)
    expect(answer.headers['cache-control']).toBe('no-store')
    expect(body.access_token).toMatch(/^fbl_/u)
    expect(body.work_reference?.spaceId).toBe(spaceId)

    const callResult = await mcp(port, body.access_token ?? '', body.work_reference?.id ?? null, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    expect(callResult.status).toBe(200)
    const parsed = JSON.parse(callResult.text) as { result: { content: { text: string }[] } }
    const receipt = JSON.parse(parsed.result.content[0]!.text) as { recibida: boolean; id: string }
    expect(receipt.recibida).toBe(true)
    const item = await board.get({ id: OWNER }, receipt.id as never)
    expect(item.spaceId).toBe(spaceId)
  })

  it('reads the publication at the revision the reference fixed (CON-02, PUB-03)', async () => {
    const { repo, first, second } = publicationRepo()
    const { port, server } = await harness({ publicationRepo: repo })
    const verifier = 'r'.repeat(64)
    const code = await authorize(server, port, '', verifier, {
      scope: PUBLICATION_READ_TOOL,
      revision: first,
    })
    const { answer, body } = await exchange(port, code, verifier)
    expect(answer.status).toBe(200)
    const token = body.access_token ?? ''
    const reference = body.work_reference?.id ?? null
    expect(reference).not.toBeNull()

    const read = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: PUBLICATION_READ_TOOL, arguments: { path: 'knowledge/procedimiento.md' } },
    })
    const published = JSON.parse(contentText(read)) as {
      revision: string
      path: string
      bytes: number
      sha256: string
      text: string
    }
    expect(published.revision).toBe(first)
    expect(published.revision).not.toBe(second)
    expect(published.path).toBe('knowledge/procedimiento.md')
    expect(published.text).toBe('versión uno\n')
    expect(published.sha256).toMatch(/^[0-9a-f]{64}$/u)

    // The same token cannot reach past the repository or file a proposal.
    const escape = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: PUBLICATION_READ_TOOL, arguments: { path: '../secreto.md' } },
    })
    expect(JSON.parse(escape.text)).toMatchObject({ result: { isError: true } })

    const forbidden = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    expect(refusalText(forbidden)).toMatch(/unknown tool|not scoped/u)
  })

  it('files a proposal against the same fixed revision and refuses another base (CON-04)', async () => {
    const { repo, first, second } = publicationRepo()
    const { port, spaces, board, server } = await harness({ publicationRepo: repo })
    const spaceId = await makeSpace(spaces, 'Proyecto fijado')
    const verifier = 'p'.repeat(64)
    const code = await authorize(server, port, spaceId, verifier, { revision: first })
    const { body } = await exchange(port, code, verifier)
    const token = body.access_token ?? ''
    const reference = body.work_reference?.id ?? null

    const filed = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: PROPOSAL_TOOL, arguments: proposal({ versionBase: first }) },
    })
    const receipt = JSON.parse(contentText(filed)) as { recibida: boolean; id: string }
    expect(receipt.recibida).toBe(true)
    const item = await board.get({ id: OWNER }, receipt.id as never)
    expect(item.spaceId).toBe(spaceId)
    expect(item.content).toMatchObject({ archivo: 'knowledge/procedimiento.md', versionBase: first })

    const stale = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: PROPOSAL_TOOL, arguments: proposal({ versionBase: second, claveCliente: 'otra-clave' }) },
    })
    expect(contentText(stale)).toContain('PROPOSAL_BASE_MISMATCH')

    // A proposal token reads nothing: the two permissions stay separate.
    const forbidden = await mcp(port, token, reference, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: PUBLICATION_READ_TOOL, arguments: { path: 'knowledge/procedimiento.md' } },
    })
    expect(refusalText(forbidden)).toMatch(/unknown tool|not scoped/u)
  })

  it('refuses a missing or foreign work reference (CON-01, CON-04)', async () => {
    const { port, spaces, server } = await harness()
    const a1 = await makeSpace(spaces, 'A1')
    const a2 = await makeSpace(spaces, 'A2')
    const verifier = 'b'.repeat(64)
    const tokenA1 = await exchange(port, await authorize(server, port, a1, verifier), verifier)
    const tokenA2 = await exchange(port, await authorize(server, port, a2, verifier), verifier)
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() } }

    expect((await mcp(port, tokenA1.body.access_token ?? '', null, body)).status).toBe(401)
    expect((await mcp(port, tokenA1.body.access_token ?? '', tokenA2.body.work_reference?.id ?? null, body)).status).toBe(401)
    expect((await mcp(port, tokenA2.body.access_token ?? '', tokenA1.body.work_reference?.id ?? null, body)).status).toBe(401)
    expect((await mcp(port, tokenA2.body.access_token ?? '', tokenA2.body.work_reference?.id ?? null, body)).status).toBe(200)
  })

  it('expires the consent transaction and the authorization code (CON-01)', async () => {
    const { ctx, port, spaces, server } = await harness()
    const spaceId = await makeSpace(spaces, 'A1')
    const verifier = 'i'.repeat(64)
    const page = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier)}`)
    const transaction = /transaction=([^"&<]+)/u.exec(page.text)?.[1] ?? ''
    await mutateOauth(ctx, 'authorizations', value => value['id'] === decodeURIComponent(transaction), {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect(await server.decideAuthorization(decodeURIComponent(transaction), true, OWNER)).toBe(false)

    const code = await authorize(server, port, spaceId, verifier)
    await mutateOauth(ctx, 'codes', value => value['transactionId'] !== undefined, {
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const expired = await exchange(port, code, verifier)
    expect(expired.answer.status).toBe(400)
    expect(expired.body).toMatchObject({ error: 'invalid_grant' })
  })

  it('consumes the code once and refuses a replay (CON-01)', async () => {
    const { port, spaces, server } = await harness()
    const verifier = 'c'.repeat(64)
    const code = await authorize(server, port, await makeSpace(spaces, 'A1'), verifier)
    expect((await exchange(port, code, verifier)).answer.status).toBe(200)
    const replay = await exchange(port, code, verifier)
    expect(replay.answer.status).toBe(400)
    expect(replay.body).toMatchObject({ error: 'invalid_grant' })
  })

  it('refuses a wrong verifier, a bad redirect, a foreign resource, and a mixed proposal scope', async () => {
    const { port, spaces, server } = await harness()
    const spaceId = await makeSpace(spaces, 'A1')
    const verifier = 'd'.repeat(64)
    const code = await authorize(server, port, spaceId, verifier)
    expect((await exchange(port, code, 'e'.repeat(64))).answer.status).toBe(400)

    const wrongRedirect = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier, { redirect_uri: 'https://evil.example/cb' })}`)
    expect(wrongRedirect.status).toBe(400)
    const wrongResource = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier, { resource: 'https://other.example/mcp' })}`)
    expect(wrongResource.status).toBe(400)
    const mixed = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier, { scope: `${PROPOSAL_TOOL} faberloom_overview` })}`)
    expect(mixed.status).toBe(400)
  })

  it('cancels without issuing a code and consumes the transaction once', async () => {
    const { port, spaces, server } = await harness()
    const spaceId = await makeSpace(spaces, 'A1')
    const verifier = 'f'.repeat(64)
    const page = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier)}`)
    const transaction = decodeURIComponent(/transaction=([^"&<]+)/u.exec(page.text)?.[1] ?? '')
    expect(await server.decideAuthorization(transaction, false, OWNER)).toBe(true)
    const status = await get(port, `/authorize/status?transaction=${encodeURIComponent(transaction)}`)
    expect(status.status).toBe(302)
    const location = String(status.headers['location'])
    expect(location).toContain('error=access_denied')
    expect(new URL(location).searchParams.get('code')).toBeNull()
    expect(await server.decideAuthorization(transaction, true, OWNER)).toBe(false)
  })

  it('has no HTTP approval route a local client could drive', async () => {
    const { port } = await harness()
    expect((await form(port, '/authorize/decision', { transaction: 'tx_x', decision: 'approve' })).status).toBe(404)
  })

  it('stops a live connection when the reference or the token is revoked (CON-01, AUTH-06)', async () => {
    const { port, spaces, server } = await harness()
    const verifier = 'g'.repeat(64)
    const token = await exchange(port, await authorize(server, port, await makeSpace(spaces, 'A1'), verifier), verifier)
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() } }
    const reference = token.body.work_reference
    if (reference === undefined) throw new Error('no reference')
    expect(await server.revokeWorkReference(reference.id)).toBe(true)
    expect((await mcp(port, token.body.access_token ?? '', reference.id, body)).status).toBe(401)

    const second = await exchange(port, await authorize(server, port, await makeSpace(spaces, 'A2'), verifier), verifier)
    expect(await server.revokeToken(tokenId(second.body.access_token ?? ''))).toBe(true)
    expect((await mcp(port, second.body.access_token ?? '', second.body.work_reference?.id ?? null, body)).status).toBe(401)
  })

  it('keeps a legacy token working without a work reference', async () => {
    const { port, server } = await harness()
    const legacy = await server.mintToken('Legacy', [PROPOSAL_TOOL])
    const result = await mcp(port, legacy.token, null, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: PROPOSAL_TOOL, arguments: proposal() },
    })
    expect(result.status).toBe(200)
  })
})
