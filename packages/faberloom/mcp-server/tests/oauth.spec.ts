import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
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
import FaberLoomPublication from '../../publication/src/index.ts'
import { MemoryPublicationStore } from '../../publication/tests/support/memory-store.ts'
import { LOCAL_CLIENT_ID, pkceChallenge } from '../src/oauth.ts'
import { PROPOSAL_TOOL, PUBLICATION_READ_TOOL } from '../src/protocol.ts'

const OWNER = 'compras2@sondelsa.com'
const REDIRECT = 'http://127.0.0.1:59999/callback'
const STATE = 'state-1234567890123456'
const homes: string[] = []
const publicationKeys = generateKeyPairSync('ed25519')

afterEach(() => {
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Boot the product services and the MCP server over one owner home. */
async function harness(config: {
  readonly publicationRepo?: string
  readonly maxPendingAuthorizations?: number
  readonly pool?: MemoryMediaPool
  readonly publication?: { readonly repo: string; readonly inventory: readonly string[] }
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'faberloom-oauth-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const ctx = new Context()
  await ctx.plugin(Storage)
  const pool = config.pool ?? new MemoryMediaPool()
  const serverConfig = {
    ...(config.publicationRepo === undefined ? {} : { publicationRepo: config.publicationRepo }),
    ...(config.maxPendingAuthorizations === undefined ? {} : { maxPendingAuthorizations: config.maxPendingAuthorizations }),
  }
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
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
  let publication: FaberLoomPublication | undefined
  let publicationStore: MemoryPublicationStore | undefined
  if (config.publication !== undefined) {
    await ctx.plugin(FaberLoomPublication, {
      repo: config.publication.repo,
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'faberloom-test',
      accessKey: 'test-access',
      secretKey: 'test-secret',
      inventory: [...config.publication.inventory],
      publisherId: 'publisher:qa',
      signingKeyPem: publicationKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      keyId: 'qa-key',
    })
    publication = ctx.faberloomPublication
    publicationStore = new MemoryPublicationStore()
    publication.useObjectStore(publicationStore)
  }
  const port = await freePort()
  await ctx.plugin(FaberLoomMcpServer, { ownerId: OWNER, enabled: true, socketPath: '', port, ...serverConfig })
  await waitForServer(port)
  return {
    ctx,
    server: ctx.faberloomMcpServer,
    spaces: ctx.faberloomSpaces,
    board: ctx.faberloomBoard,
    port,
    pool,
    publication,
    publicationStore,
  }
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

  it('caps the pending authorization queue per owner and client', async () => {
    const { port, spaces } = await harness({ maxPendingAuthorizations: 1 })
    const spaceId = await makeSpace(spaces, 'A1')
    const verifier = 'q'.repeat(64)
    expect((await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier)}`)).status).toBe(200)
    const second = await get(port, `/authorize?${authorizeQuery(port, spaceId, verifier, {
      state: 'state-second-1234567890',
    })}`)
    expect(second.status).toBe(429)
    expect(second.text).toContain('Demasiadas solicitudes pendientes')
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

    // The same reference reaches the bridge host API, not only the socket.
    const bridged = await server.request(JSON.stringify({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: PUBLICATION_READ_TOOL, arguments: { path: 'knowledge/procedimiento.md' } },
    }), token, 'application/json', reference ?? undefined)
    expect(bridged.status).toBe(200)
    const bridgedText = (JSON.parse(bridged.body) as { result: { content: { text: string }[] } }).result.content[0]!.text
    expect((JSON.parse(bridgedText) as { text: string }).text).toBe('versión uno\n')

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

  it('distinguishes published from loaded and survives a runtime restart (VER-01)', async () => {
    const first = await harness()
    const verifier = 'l'.repeat(64)
    const revision = 'a'.repeat(40)
    const code = await authorize(first.server, first.port, '', verifier, {
      scope: PROPOSAL_TOOL,
      revision,
    })
    const { body } = await exchange(first.port, code, verifier)
    const reference = body.work_reference?.id ?? ''
    expect(reference).not.toBe('')

    expect(await first.server.referenceState(reference)).toMatchObject({
      revision,
      publicationState: 'none',
      published: false,
      loaded: false,
      loadedAt: null,
    })
    expect(await first.server.noteReferenceLoad(reference, revision, 'knowledge/a.md')).toBe(true)
    expect(await first.server.referenceState(reference)).toMatchObject({
      loaded: true,
      loadRevision: revision,
      lastReadPath: 'knowledge/a.md',
    })
    await first.ctx.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(await second.server.referenceState(reference)).toMatchObject({
      revision,
      loaded: true,
      loadRevision: revision,
      lastReadPath: 'knowledge/a.md',
    })
    await second.ctx.fiber.dispose()
  })

  it('reads A1 and A2 from their published revisions and never crosses them (VER-01)', async () => {
    const first = 'a'.repeat(40)
    const second = 'b'.repeat(40)
    const objects = new Map<string, string>([[first, 'uno\n'], [second, 'dos\n']])
    const { ctx, server, port } = await harness()
    ctx.provide('faberloomPublication', {
      readiness: () => ({ available: true, reason: null }),
      status: async () => 'activated',
      read: async (revision: string, path: string) => {
        const text = objects.get(revision)
        if (text === undefined) throw new Error('faberloom: PUBLICATION_NOT_FOUND')
        const bytes = Buffer.from(text, 'utf8')
        return {
          revision, path, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          manifestKey: `publications/${revision}/.faberloom/manifest.json`,
          manifestDigest: 'c'.repeat(64),
          text,
        }
      },
      publish: async () => { throw new Error('not used') },
    } as never)

    const authorizeReference = async (revision: string): Promise<{ token: string; reference: string }> => {
      const verifier = revision === first ? 'x'.repeat(64) : 'y'.repeat(64)
      const code = await authorize(server, port, '', verifier, { scope: PUBLICATION_READ_TOOL, revision })
      const { body } = await exchange(port, code, verifier)
      return { token: body.access_token ?? '', reference: body.work_reference?.id ?? '' }
    }
    const a1 = await authorizeReference(first)
    const a2 = await authorizeReference(second)

    const read = async (token: string, reference: string): Promise<string> => {
      const answer = await mcp(port, token, reference, {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: PUBLICATION_READ_TOOL, arguments: { path: 'knowledge/a.md' } },
      })
      return (JSON.parse(contentText(answer)) as { text: string }).text
    }

    expect(await read(a1.token, a1.reference)).toBe('uno\n')
    expect(await read(a2.token, a2.reference)).toBe('dos\n')
    expect(await server.referenceState(a1.reference)).toMatchObject({ published: true, loaded: true, loadRevision: first })
    expect(await server.referenceState(a2.reference)).toMatchObject({ published: true, loaded: true, loadRevision: second })
    await ctx.fiber.dispose()
  })

  it('reads A1 and A2 from real published revisions and marks only an observed load (VER-01)', async () => {
    const { repo, first } = publicationRepo()
    const git = (args: readonly string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    const path = 'knowledge/procedimiento.md'
    git(['reset', '--hard', first])
    writeFileSync(join(repo, path), 'publicado uno\n', 'utf8')
    const diff1 = git(['diff', '--no-color', '--', path])
    git(['checkout', '--', path])
    const harnessed = await harness({ publication: { repo, inventory: [path] } })
    if (harnessed.publication === undefined) throw new Error('the publication service did not mount')
    const p1 = await harnessed.publication.publish({
      itemId: 'item-p1', revision: first, path, diff: diff1,
      motivo: 'p1', evidence: ['e'], artifactHash: 'a'.repeat(64),
    })
    writeFileSync(join(repo, path), 'publicado dos\n', 'utf8')
    const diff2 = git(['diff', '--no-color', '--', path])
    git(['checkout', '--', path])
    const p2 = await harnessed.publication.publish({
      itemId: 'item-p2', revision: p1.commit, path, diff: diff2,
      motivo: 'p2', evidence: ['e'], artifactHash: 'b'.repeat(64),
    })

    const authorizeReference = async (revision: string, verifier: string): Promise<{ token: string; reference: string }> => {
      const code = await authorize(harnessed.server, harnessed.port, '', verifier, {
        scope: PUBLICATION_READ_TOOL,
        revision,
      })
      const { body } = await exchange(harnessed.port, code, verifier)
      return { token: body.access_token ?? '', reference: body.work_reference?.id ?? '' }
    }
    const a1 = await authorizeReference(p1.commit, 'o'.repeat(64))
    const a2 = await authorizeReference(p2.commit, 'q'.repeat(64))
    const read = async (token: string, reference: string): Promise<string> => {
      const answer = await mcp(harnessed.port, token, reference, {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: PUBLICATION_READ_TOOL, arguments: { path } },
      })
      return (JSON.parse(contentText(answer)) as { text: string }).text
    }
    expect(await read(a1.token, a1.reference)).toBe('publicado uno\n')
    expect(await read(a2.token, a2.reference)).toBe('publicado dos\n')
    expect(await harnessed.server.referenceState(a1.reference)).toMatchObject({
      revision: p1.commit, publicationState: 'activated', published: true, loaded: true, loadRevision: p1.commit,
    })
    expect(await harnessed.server.referenceState(a2.reference)).toMatchObject({
      revision: p2.commit, publicationState: 'activated', published: true, loaded: true, loadRevision: p2.commit,
    })
    await harnessed.ctx.fiber.dispose()
  })

  it('rolls back only to an activated revision and never revives a revoked reference (VER-02)', async () => {
    const first = 'a'.repeat(40)
    const second = 'b'.repeat(40)
    const statuses = new Map<string, string>([[first, 'activated'], [second, 'activated']])
    const { ctx, server, port } = await harness()
    ctx.provide('faberloomPublication', {
      readiness: () => ({ available: true, reason: null }),
      status: async (revision: string) => {
        const status = statuses.get(revision)
        if (status === undefined) throw new Error('faberloom: PUBLICATION_NOT_FOUND')
        return status
      },
      read: async () => { throw new Error('not used') },
      publish: async () => { throw new Error('not used') },
    } as never)
    const authorizeReference = async (revision: string, verifier: string): Promise<string> => {
      const code = await authorize(server, port, '', verifier, { scope: PROPOSAL_TOOL, revision })
      const { body } = await exchange(port, code, verifier)
      return body.work_reference?.id ?? ''
    }
    const live = await authorizeReference(second, 'z'.repeat(64))
    const rolled = await server.rollbackReference(live, first)
    expect(rolled).toMatchObject({ revision: first, revokedAt: null })
    expect(await server.referenceState(rolled?.id ?? '')).toMatchObject({ published: true, loaded: false })

    await server.revokeWorkReference(live)
    expect(await server.rollbackReference(live, first)).toBeUndefined()

    statuses.set(first, 'failed')
    const another = await authorizeReference(second, 'w'.repeat(64))
    expect(await server.rollbackReference(another, first)).toBeUndefined()
    await ctx.fiber.dispose()
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
