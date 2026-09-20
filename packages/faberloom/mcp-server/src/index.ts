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

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
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
}

/** Schemastery configuration for the MCP server. */
export const Config: z<Config> = z.object({
  ownerId: z.string(),
  enabled: z.boolean(),
  socketPath: z.string(),
  port: z.number(),
  maxBodyBytes: z.number(),
})

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

/** FaberLoom's server face for other agents. */
export class FaberLoomMcpServer extends Service {
  static inject = [
    'storageDomain', 'faberloomSpaces', 'faberloomAgents', 'faberloomBoard', 'faberloomRoutines',
    'faberloomMemory', 'faberloomAccess', 'faberloomBackup', 'faberloomConnections',
  ]

  private domainPromise: Promise<Domain<typeof mcpServerDomainSpec>> | undefined
  private server: Server | undefined

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
    const sse = (request.headers.accept ?? '').includes('text/event-stream')
    // A JSON-RPC batch answers one message per element; a single request answers
    // one. Over SSE each response is its own frame, bracketed by comments that
    // keep the stream visible to a client reading it incrementally.
    const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    if (sse) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'mcp-session-id': caller.sessionId,
      })
      response.write(': faberloom stream open\n\n')
      for (const message of messages) {
        const outcome = await dispatch(host, message)
        if (outcome.body === null) continue
        response.write(`event: message\ndata: ${JSON.stringify(outcome.body)}\n\n`)
      }
      response.write(': faberloom stream closed\n\n')
      response.end()
      return
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        this.respond(response, 200, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'empty batch' } })
        return
      }
      const bodies: unknown[] = []
      for (const message of messages) {
        const outcome = await dispatch(host, message)
        if (outcome.body !== null) bodies.push(outcome.body)
      }
      if (bodies.length === 0) { response.writeHead(202).end(); return }
      this.respond(response, 200, bodies)
      return
    }
    const outcome = await dispatch(host, parsed)
    if (outcome.body === null) {
      response.writeHead(202).end()
      return
    }
    this.respond(response, outcome.status, outcome.body)
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
    return true
  }
}

export default FaberLoomMcpServer
