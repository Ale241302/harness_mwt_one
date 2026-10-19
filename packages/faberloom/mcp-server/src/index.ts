/**
 * Native product MCP server (`ctx.faberloomMcpServer`): FaberLoom's own server
 * face, so another AI can read and manage the owner's work.
 *
 * The harness ships an MCP **client** and resources, not a server, so this
 * package owns the protocol, the transport, and the identity: it speaks
 * JSON-RPC 2.0 over an MCP Streamable HTTP endpoint, authenticates each request
 * with a bearer token the owner minted for that client, and answers every tool
 * call through the product services — the same operations the panels use, with
 * the same validation and the same autonomy guard.
 *
 * It listens on a per-owner unix socket (`<DSH_HOME>/faberloom-mcp.sock`) rather
 * than a TCP port, so several owners served by one container never collide and
 * the deployment decides how to expose it. Nothing is exposed unless a Config
 * enables it.
 * @module @deepseek-ai/dsh-faberloom-mcp-server
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-faberloom-agents'
import type {} from '@deepseek-ai/dsh-faberloom-access'
import type {} from '@deepseek-ai/dsh-faberloom-backup'
import type {} from '@deepseek-ai/dsh-faberloom-board'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type {} from '@deepseek-ai/dsh-faberloom-learning'
import type {} from '@deepseek-ai/dsh-faberloom-routines'
import type {} from '@deepseek-ai/dsh-faberloom-spaces'
import { dispatch, PROTOCOL_VERSION } from './protocol.ts'
import { FaberLoomToolHost } from './tools.ts'
import { mcpServerDomainSpec, type TokenRecord } from './spec.ts'

export type * from './protocol.ts'
export type { TokenRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomMcpServer: FaberLoomMcpServer
  }
}

/** Deployment-supplied identity and transport. */
export interface Config {
  /** The owner every authenticated call acts as; empty disables the server. */
  ownerId?: string
  /** Whether the endpoint listens. */
  enabled?: boolean
  /** Unix socket path to listen on; used when set. */
  socketPath?: string
  /** TCP port to listen on when no socket path is configured; 0 picks a free one. */
  port?: number
  /** Largest request body accepted, in bytes. */
  maxBodyBytes?: number
  /**
   * Internal credential the deployment's gateway presents when it acts for the
   * owner through the mirror route. Empty disables that path, so no other caller
   * can borrow it.
   */
  mirrorKey?: string
  /**
   * Whether this process keeps an outbound bridge to the deployment gateway, so
   * an AI client of the public `/mcp` endpoint reaches this installation's own
   * tools. The desktop turns it on; a web harness leaves it off because the
   * gateway already reaches its socket.
   */
  bridge?: boolean
  /** Gateway origin the bridge calls; defaults to the harness origin derived from the console base. */
  gatewayUrl?: string
  /** Console API base the installation signed in with; used to derive the gateway origin. */
  consoleBase?: string
  /** Milliseconds between two bridge registrations. */
  bridgeRegisterMs?: number
  /** Longest a bridge poll waits for a request, in milliseconds. */
  bridgePollMs?: number
}

/** Schemastery configuration for the MCP server. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  enabled: z.boolean(),
  socketPath: z.string(),
  port: z.number(),
  maxBodyBytes: z.number(),
  mirrorKey: z.string(),
  bridge: z.boolean(),
  gatewayUrl: z.string(),
  consoleBase: z.string(),
  bridgeRegisterMs: z.number(),
  bridgePollMs: z.number(),
})

/** Header carrying the deployment's internal credential on a mirror call. */
export const MIRROR_KEY_HEADER = 'x-faberloom-mirror-key'

/** Largest body the transport accepts by default. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024

/** Where the endpoint listens: a unix socket, or a loopback TCP port. */
type TransportTarget = { readonly socketPath: string } | { readonly port: number }

/** One connected client, as the panel reads it. */
export interface FaberLoomMcpToken {
  /** The token itself, shown once to the owner who mints it. */
  readonly token: string
  /** Who it was minted for. */
  readonly label: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 revocation instant, or null while it works. */
  readonly revokedAt: string | null
  /** Tool names the client may call, or null for the owner's full surface. */
  readonly scopes: readonly string[] | null
}

/** One MCP answer, independent of the transport that will carry it. */
export interface FaberLoomMcpAnswer {
  /** HTTP status the transport should send. */
  readonly status: number
  /** Response content type. */
  readonly contentType: string
  /** Complete response body. */
  readonly body: string
  /** Session identity the transport should expose as `mcp-session-id`. */
  readonly sessionId?: string
}

/** FaberLoom's server face for other agents. */
export class FaberLoomMcpServer extends Service {
  static inject = [
    'storageDomain', 'faberloomSpaces', 'faberloomAgents', 'faberloomBoard', 'faberloomRoutines',
    'faberloomMemory', 'faberloomAccess', 'faberloomBackup', 'faberloomConnections',
  ]

  private domainPromise: Promise<Domain<typeof mcpServerDomainSpec>> | undefined
  private server: Server | undefined
  private bridgeStopped = false
  private bridgeTimer: ReturnType<typeof setTimeout> | undefined
  private bridgeRegisteredAt = 0
  private bridgeBusy = false

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - identity and transport.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomMcpServer')
    if (this.config.enabled !== true) return
    const target = this.config.socketPath === undefined || this.config.socketPath.length === 0
      ? this.config.port === undefined ? { socketPath: this.defaultSocketPath() } : { port: this.config.port }
      : { socketPath: this.config.socketPath }
    this.ctx.effect(() => {
      this.listen(target)
      return () => { this.stop(target) }
    }, 'faberloom.mcpServer.listen')
    if (this.config.bridge === true) {
      this.ctx.effect(() => {
        this.startBridge()
        return () => { this.stopBridge() }
      }, 'faberloom.mcpServer.bridge')
    }
  }

  /** The socket this owner's server listens on when Config names none. */
  private defaultSocketPath(): string {
    const home = process.env.DSH_HOME
    const base = home === undefined || home.length === 0 ? process.cwd() : home
    return join(base, 'faberloom-mcp.sock')
  }

  /** Start listening, replacing a socket left by a previous process. */
  private listen(target: TransportTarget): void {
    if ('socketPath' in target && existsSync(target.socketPath)) rmSync(target.socketPath, { force: true })
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.ctx.logger.warn(`faberloom: MCP request failed: ${String(error)}`)
        if (!response.headersSent) this.respond(response, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } })
      })
    })
    server.on('error', (error) => { this.ctx.logger.warn(`faberloom: MCP transport error: ${String(error)}`) })
    const ready = (): void => {
      this.ctx.logger.info(`faberloom: MCP server listening on ${'socketPath' in target ? target.socketPath : `port ${String(target.port)}`} (protocol ${PROTOCOL_VERSION})`)
    }
    if ('socketPath' in target) server.listen(target.socketPath, ready)
    else server.listen(target.port, '127.0.0.1', ready)
    this.server = server
  }

  /** Stop listening and remove the socket. */
  private stop(target: TransportTarget): void {
    this.server?.close()
    this.server = undefined
    if (!('socketPath' in target)) return
    try { if (existsSync(target.socketPath)) rmSync(target.socketPath, { force: true }) } catch { /* the socket may already be gone */ }
  }

  /** Serve one HTTP request. */
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/'
    const path = url.split('?')[0] ?? '/'
    if (path !== '/mcp') {
      this.respond(response, 404, { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'not found' } })
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      this.respond(response, 405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'use POST /mcp' } })
      return
    }
    const caller = await this.authenticate(request)
    if (caller === undefined) {
      response.setHeader('www-authenticate', 'Bearer')
      this.respond(response, 401, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unknown or revoked token' } })
      return
    }
    const body = await this.read(request)
    if (body === 'too-large') {
      this.respond(response, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request body too large' } })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      this.respond(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      return
    }
    const host = new FaberLoomToolHost(this.ctx, caller.ownerId, caller.scopes)
    const answer = await this.execute(parsed, host, (request.headers.accept ?? '').includes('text/event-stream'), caller.sessionId)
    response.writeHead(answer.status, {
      'content-type': answer.contentType,
      'content-length': Buffer.byteLength(answer.body),
      ...(answer.sessionId === undefined ? {} : { 'mcp-session-id': answer.sessionId }),
    })
    response.end(answer.body)
  }

  /**
   * Answer one parsed JSON-RPC message (or batch) without a transport.
   *
   * The bridge uses it for a request that arrived over the deployment gateway;
   * the socket transport uses it after authenticating and reading the body. Both
   * therefore answer with the same protocol, scopes, and error text.
   * @param parsed - the parsed JSON-RPC message or batch.
   * @param host - the product surface scoped to the caller.
   * @param sse - whether the caller accepts server-sent events.
   * @param sessionId - opaque session identity to expose in the answer.
   * @returns the complete answer body and the status/content type to send.
   */
  private async execute(parsed: unknown, host: FaberLoomToolHost, sse: boolean, sessionId: string): Promise<FaberLoomMcpAnswer> {
    // A JSON-RPC batch answers one message per element; a single request answers
    // one. Over SSE each response is its own frame, bracketed by comments that
    // keep the stream visible to a client reading it incrementally.
    const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    if (sse) {
      let body = ': faberloom stream open\n\n'
      for (const message of messages) {
        const outcome = await dispatch(host, message)
        if (outcome.body === null) continue
        body += `event: message\ndata: ${JSON.stringify(outcome.body)}\n\n`
      }
      body += ': faberloom stream closed\n\n'
      return { status: 200, contentType: 'text/event-stream; charset=utf-8', body, sessionId }
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return this.answer(200, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'empty batch' } }, sessionId)
      }
      const bodies: unknown[] = []
      for (const message of messages) {
        const outcome = await dispatch(host, message)
        if (outcome.body !== null) bodies.push(outcome.body)
      }
      if (bodies.length === 0) return { status: 202, contentType: 'application/json; charset=utf-8', body: '', sessionId }
      return this.answer(200, bodies, sessionId)
    }
    const outcome = await dispatch(host, parsed)
    if (outcome.body === null) return { status: 202, contentType: 'application/json; charset=utf-8', body: '', sessionId }
    return this.answer(outcome.status, outcome.body, sessionId)
  }

  /** Render one JSON answer. */
  private answer(status: number, body: unknown, sessionId: string): FaberLoomMcpAnswer {
    return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), sessionId }
  }

  /**
   * Answer one request on behalf of a token holder without an HTTP request.
   *
   * This is the same validation and the same tools the socket serves; the caller
   * is the bridge, which has already authenticated the public client with the
   * token the gateway forwarded. A revoked or foreign token is refused here too,
   * so a stale registration cannot outlive its token.
   * @param body - the JSON-RPC request body.
   * @param token - the bearer token the public client presented.
   * @param accept - the Accept header the public client sent.
   * @returns the complete answer for the gateway to relay.
   */
  async request(body: string, token: string, accept = 'application/json'): Promise<FaberLoomMcpAnswer> {
    const max = this.config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    if (Buffer.byteLength(body) > max) {
      return this.answer(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request body too large' } }, 'fbl-bridge')
    }
    const record = (await this.tokens()).get(token)
    const owner = this.config.ownerId ?? ''
    if (record === undefined || record.revokedAt !== null || (owner.length > 0 && record.ownerId !== owner)) {
      return this.answer(401, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unknown or revoked token' } }, 'fbl-bridge')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return this.answer(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 'fbl-bridge')
    }
    const sessionId = `fbl-${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
    const host = new FaberLoomToolHost(this.ctx, record.ownerId, record.scopes ?? null)
    return await this.execute(parsed, host, accept.includes('text/event-stream'), sessionId)
  }

  /** Read the body, refusing one larger than the configured ceiling. */
  private async read(request: IncomingMessage): Promise<string> {
    const max = this.config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = chunk as Buffer
      size += buffer.length
      if (size > max) return 'too-large'
      chunks.push(buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  /** Resolve the owner and scopes a bearer token carries, or undefined when it may not act. */
  private async authenticate(
    request: IncomingMessage,
  ): Promise<{ ownerId: string; scopes: readonly string[] | null; sessionId: string } | undefined> {
    // The deployment's gateway calls on the owner's behalf with the internal
    // credential, which is not a minted token: it never reaches the token store.
    const mirrorKey = this.config.mirrorKey ?? ''
    const presentedKey = request.headers[MIRROR_KEY_HEADER]
    if (mirrorKey.length > 0 && typeof presentedKey === 'string' && presentedKey.length === mirrorKey.length
      && timingSafeEqual(Buffer.from(presentedKey), Buffer.from(mirrorKey))) {
      const mirrorOwner = this.config.ownerId ?? ''
      if (mirrorOwner.length === 0) return undefined
      return { ownerId: mirrorOwner, scopes: null, sessionId: 'fbl-mirror' }
    }
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return undefined
    const token = header.slice(7).trim()
    if (token.length === 0) return undefined
    const record = (await this.tokens()).get(token)
    if (record === undefined || record.revokedAt !== null) return undefined
    // Defence in depth: a token of another owner is refused by this process too.
    const owner = this.config.ownerId ?? ''
    if (owner.length > 0 && record.ownerId !== owner) return undefined
    // Opaque, stable session id: never the token itself, but constant per token.
    const sessionId = `fbl-${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
    return { ownerId: record.ownerId, scopes: record.scopes ?? null, sessionId }
  }

  /** Write one JSON response. */
  private respond(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
    response.end(text)
  }

  private domain(): Promise<Domain<typeof mcpServerDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(mcpServerDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.mcpServer.domainClose')
      return domain
    })()
    return this.domainPromise
  }

  private async tokens(): Promise<KvTable<string, TokenRecord>> {
    return (await this.domain()).table('tokens')
  }

  /**
   * Mint one bearer token for a client the owner names.
   * @param label - who the token is for.
   * @param scopes - tool names the client may call, or null for the full surface.
   * @returns the token, which is only shown here.
   */
  async mintToken(label: string, scopes: readonly string[] | null = null): Promise<FaberLoomMcpToken> {
    const ownerId = this.config.ownerId ?? ''
    if (ownerId.length === 0) throw new Error('faberloom: the MCP server has no owner configured')
    const token = `fbl_${randomUUID().replaceAll('-', '')}`
    const record: TokenRecord = {
      ownerId,
      label,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      scopes: scopes === null ? null : [...scopes],
    }
    await (await this.tokens()).put(token, record)
    void this.bridgeRegister()
    return { token, ...record, scopes: record.scopes ?? null }
  }

  /**
   * List the tokens this owner minted, revoked ones included.
   * @returns the token rows.
   */
  async listTokens(): Promise<readonly FaberLoomMcpToken[]> {
    const ownerId = this.config.ownerId ?? ''
    const out: FaberLoomMcpToken[] = []
    for (const [token, record] of (await this.tokens()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push({ token, ...record, scopes: record.scopes ?? null })
    }
    return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * Revoke one token so its client stops working.
   * @param token - the token to revoke.
   * @returns whether a live token was revoked.
   */
  async revokeToken(token: string): Promise<boolean> {
    const ownerId = this.config.ownerId ?? ''
    const tokens = await this.tokens()
    const record = tokens.get(token)
    if (record === undefined || record.ownerId !== ownerId || record.revokedAt !== null) return false
    await tokens.put(token, { ...record, revokedAt: new Date().toISOString() })
    void this.bridgeRegister()
    return true
  }

  // ── Outbound bridge ────────────────────────────────────────────────
  //
  // A desktop installation runs behind a home router, so the deployment cannot
  // open its socket. The bridge reverses the direction: this process registers
  // its live tokens with the gateway, long-polls for one public `/mcp` request
  // at a time, answers it with the same tool host the socket uses, and posts
  // the answer back. The public URL and the token do not change.

  /** Start the bridge loop. */
  private startBridge(): void {
    this.bridgeStopped = false
    void this.bridgeLoop()
  }

  /** Stop the bridge loop and its pending timer. */
  private stopBridge(): void {
    this.bridgeStopped = true
    if (this.bridgeTimer !== undefined) clearTimeout(this.bridgeTimer)
    this.bridgeTimer = undefined
  }

  /** Schedule the next bridge attempt. */
  private scheduleBridge(delayMs: number): void {
    if (this.bridgeStopped) return
    if (this.bridgeTimer !== undefined) clearTimeout(this.bridgeTimer)
    this.bridgeTimer = setTimeout(() => { void this.bridgeLoop() }, delayMs)
    this.bridgeTimer.unref()
  }

  /** The gateway origin this bridge calls, or undefined when it cannot be derived. */
  private bridgeBase(): string | undefined {
    const configured = this.config.gatewayUrl ?? process.env['FABERLOOM_GATEWAY_URL'] ?? ''
    if (configured.length > 0) return configured.replace(/\/+$/u, '')
    const consoleBase = this.config.consoleBase ?? process.env['CONSOLA_API_BASE'] ?? ''
    if (consoleBase.length > 0) {
      try {
        const url = new URL(consoleBase)
        if (url.hostname.startsWith('consola.')) url.hostname = `harness.${url.hostname.slice('consola.'.length)}`
        return url.origin
      } catch {
        // A malformed console base is not a gateway origin; fall through to the
        // deployment default the product ships against.
      }
    }
    return 'https://harness.mwt.one'
  }

  /** The console bearer token the gateway authenticates this installation with. */
  private consoleToken(): string | undefined {
    const token = process.env['CONSOLA_TOKEN'] ?? ''
    return token.length === 0 ? undefined : token
  }

  /** Read this installation's stable device id, creating it when the shell has not. */
  private bridgeDeviceId(): string {
    const home = process.env['DSH_HOME']
    const base = home === undefined || home.length === 0 ? process.cwd() : home
    const file = join(base, 'device-id')
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim()
      if (pattern.test(stored)) return stored
    }
    const created = randomUUID()
    try {
      mkdirSync(base, { recursive: true })
      writeFileSync(file, `${created}\n`)
    } catch {
      // An unwritable home still gets a process-local id; the registration and
      // the poll then use the same value for as long as this process lives.
    }
    return created
  }

  /** Register every live token of this installation with the gateway. */
  private async bridgeRegister(): Promise<void> {
    if (this.bridgeStopped || this.config.bridge !== true) return
    const base = this.bridgeBase()
    const consoleToken = this.consoleToken()
    if (base === undefined || consoleToken === undefined) return
    const tokens = (await this.listTokens()).filter(token => token.revokedAt === null).map(token => token.token)
    try {
      const response = await fetch(`${base}/_/harness/desktop-mcp/register`, {
        method: 'POST',
        headers: { authorization: `Bearer ${consoleToken}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ deviceId: this.bridgeDeviceId(), tokens }),
        signal: AbortSignal.timeout(15_000),
      })
      if (response.ok) {
        this.bridgeRegisteredAt = Date.now()
        return
      }
      // A registration refusal is an operator fact, not a tool failure: the
      // console token may be expired, or the gateway may not have the route yet.
      if (response.status === 401 || response.status === 403) {
        this.ctx.logger.warn(`faberloom: MCP bridge registration refused (${String(response.status)}); the console token is not accepted by the gateway`)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: MCP bridge registration failed: ${String(error)}`)
    }
  }

  /** Long-poll one request and answer it in the background. */
  private async bridgeLoop(): Promise<void> {
    if (this.bridgeStopped || this.bridgeBusy) return
    this.bridgeBusy = true
    try {
      const base = this.bridgeBase()
      const consoleToken = this.consoleToken()
      if (base === undefined || consoleToken === undefined) {
        this.scheduleBridge(5_000)
        return
      }
      const registerMs = this.config.bridgeRegisterMs ?? 30_000
      if (Date.now() - this.bridgeRegisteredAt >= registerMs) await this.bridgeRegister()
      const pollMs = this.config.bridgePollMs ?? 25_000
      const response = await fetch(`${base}/_/harness/desktop-mcp/poll`, {
        method: 'POST',
        headers: { authorization: `Bearer ${consoleToken}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ deviceId: this.bridgeDeviceId() }),
        signal: AbortSignal.timeout(pollMs + 10_000),
      })
      if (response.status === 204) {
        this.scheduleBridge(0)
        return
      }
      if (response.ok) {
        const payload: unknown = await response.json()
        const request = readBridgeRequest(payload)
        if (request !== undefined) void this.bridgeAnswer(request)
        this.scheduleBridge(0)
        return
      }
      // 503 means the gateway has no registration for this device yet; a short
      // retry lets the registration that just ran take effect. 409 after a
      // gateway redeploy means the registry is empty, so register again now.
      if (response.status === 409) this.bridgeRegisteredAt = 0
      this.scheduleBridge(response.status === 503 || response.status === 409 ? 2_000 : 5_000)
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: MCP bridge poll failed: ${String(error)}`)
      this.scheduleBridge(5_000)
    } finally {
      this.bridgeBusy = false
    }
  }

  /** Answer one bridged request and post the complete response back. */
  private async bridgeAnswer(request: BridgeRequest): Promise<void> {
    let answer: FaberLoomMcpAnswer
    try {
      answer = await this.request(request.body, request.token, request.accept)
    } catch (error: unknown) {
      answer = this.answer(500, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' },
      }, 'fbl-bridge')
    }
    const base = this.bridgeBase()
    const consoleToken = this.consoleToken()
    if (base === undefined || consoleToken === undefined) return
    try {
      const response = await fetch(`${base}/_/harness/desktop-mcp/respond`, {
        method: 'POST',
        headers: { authorization: `Bearer ${consoleToken}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          deviceId: this.bridgeDeviceId(),
          requestId: request.requestId,
          status: answer.status,
          contentType: answer.contentType,
          body: answer.body,
          ...answer.sessionId === undefined ? {} : { sessionId: answer.sessionId },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        this.ctx.logger.warn(`faberloom: MCP bridge answer refused (${String(response.status)})`)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`faberloom: MCP bridge answer failed: ${String(error)}`)
    }
  }
}

/** One request the gateway queued for this installation. */
interface BridgeRequest {
  /** Correlation id the answer must echo. */
  readonly requestId: string
  /** The JSON-RPC body the public client sent. */
  readonly body: string
  /** The public client's bearer token, which this installation validates. */
  readonly token: string
  /** The public client's Accept header. */
  readonly accept: string
}

/** Read one bridge request, ignoring a malformed payload. */
function readBridgeRequest(payload: unknown): BridgeRequest | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  const requestId = record['requestId']
  const body = record['body']
  const token = record['token']
  const accept = record['accept']
  if (typeof requestId !== 'string' || typeof body !== 'string' || typeof token !== 'string') return undefined
  return { requestId, body, token, accept: typeof accept === 'string' ? accept : 'application/json' }
}

export default FaberLoomMcpServer
