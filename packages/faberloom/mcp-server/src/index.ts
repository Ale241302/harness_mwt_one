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
import type { FaberLoomSpace, FaberLoomSpaceId, SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import { dispatch, PROPOSAL_TOOL, PROTOCOL_VERSION, RETIRED_SCOPES } from './protocol.ts'
import { AUTHORIZE_TTL_MS, CODE_TTL_MS, consentPage, opaque, validateAuthorization, verifyPkce } from './oauth.ts'
import { FaberLoomToolHost } from './tools.ts'
import { referenceMatches } from './work-reference.ts'
import {
  mcpOAuthDomainSpec,
  mcpServerDomainSpec,
  type AuthorizationCodeRecord,
  type AuthorizationRecord,
  type TokenRecord,
  type WorkReferenceRecord,
} from './spec.ts'

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

/** Header carrying the work reference one call is bound to. */
export const WORK_REFERENCE_HEADER = 'x-faberloom-work-reference'

/** Fingerprint a one-time authorization code before storing it. */
function codeKey(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}


/** Largest body the transport accepts by default. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024

/**
 * Stable, non-secret fingerprint of one bearer token. Listings and revocations
 * use it, so the secret never has to travel back from a panel or a diagnostic.
 * @param token - the bearer token.
 * @returns 24 lowercase hex characters.
 */
export function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24)
}

/** Where the endpoint listens: a unix socket, or a loopback TCP port. */
type TransportTarget = { readonly socketPath: string } | { readonly port: number }

/** One connected client, as the panel reads it. The bearer token is not part of this row. */
export interface FaberLoomMcpTokenRow {
  /** Stable fingerprint, safe to list and to revoke by. */
  readonly id: string
  /** Who it was minted for. */
  readonly label: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 revocation instant, or null while it works. */
  readonly revokedAt: string | null
  /** Tool names the client may call, or null for the owner's full surface. */
  readonly scopes: readonly string[] | null
  /** Company scope the token acts for, or null when the deployment has none. */
  readonly companyId: string | null
  /** Space the token's proposals are filed in; the token must be proposal-only. Null is the legacy owner-wide token. */
  readonly spaceId: string | null
}

/** One pending authorization request the panel can show and decide. */
export interface FaberLoomMcpAuthorization {
  /** Transaction id the waiting page and the panel name. */
  readonly id: string
  /** Space the request will file proposals in, or null. */
  readonly spaceId: string | null
  /** Company the request will act for, or null. */
  readonly companyId: string | null
  /** Tool scopes the requester asks for. */
  readonly scopes: readonly string[]
  /** When the request arrived. */
  readonly createdAt: string
  /** When the request stops being decidable. */
  readonly expiresAt: string
}

/** One freshly minted token: the secret is shown here once and never listed again. */
export interface FaberLoomMcpToken {
  /** The bearer token the client presents; the only answer that carries it. */
  readonly token: string
  /** The row that appears in the panel from now on. */
  readonly row: FaberLoomMcpTokenRow
}

/** What one authenticated bearer token may do in this process. */
interface TokenCaller {
  readonly ownerId: string
  readonly scopes: readonly string[] | null
  readonly companyId: string | undefined
  readonly spaceId: string | null
  readonly referenceId: string | null
  readonly sessionId: string
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
  private oauthPromise: Promise<Domain<typeof mcpOAuthDomainSpec>> | undefined
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
    if ((path === '/.well-known/oauth-authorization-server' || path === '/authorize' || path === '/authorize/status' || path === '/token')
      && !this.oauthAvailable()) {
      this.respond(response, 503, { error: 'oauth_unavailable' })
      return
    }
    if (path === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
      this.respond(response, 200, {
        issuer: this.issuer(),
        authorization_endpoint: `${this.issuer()}/authorize`,
        token_endpoint: `${this.issuer()}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: this.toolNames(),
        resource: this.resourceUrl(),
      })
      return
    }
    if (path === '/authorize' && request.method === 'GET') {
      await this.authorize(url, response)
      return
    }
    if (path === '/authorize/status' && request.method === 'GET') {
      await this.status(url, response)
      return
    }
    if (path === '/token' && request.method === 'POST') {
      await this.exchange(request, response)
      return
    }
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
    const host = new FaberLoomToolHost(this.ctx, caller.ownerId, caller.scopes, caller.companyId, caller.spaceId ?? undefined)
    const answer = await this.execute(parsed, host, (request.headers.accept ?? '').includes('text/event-stream'), caller.sessionId)
    response.writeHead(answer.status, {
      'content-type': answer.contentType,
      'content-length': Buffer.byteLength(answer.body),
      ...(answer.sessionId === undefined ? {} : { 'mcp-session-id': answer.sessionId }),
    })
    response.end(answer.body)
  }

  /**
   * Render the consent page for one validated authorization request.
   * @param rawUrl - full request URL.
   * @param response - HTTP response.
   */
  private async authorize(rawUrl: string, response: ServerResponse): Promise<void> {
    const ownerId = this.config.ownerId ?? ''
    if (ownerId.length === 0) {
      this.respondHtml(response, 503, '<h1>FaberLoom no tiene propietario configurado</h1>')
      return
    }
    const parsed = new URL(rawUrl, this.issuer())
    const validation = validateAuthorization(parsed.searchParams, {
      audience: this.resourceUrl(),
      scopes: this.toolNames(),
    })
    if (!validation.ok) {
      this.respondHtml(response, 400, `<h1>No se puede autorizar</h1><p>${validation.error}</p>`)
      return
    }
    const request = validation.value
    const company = parsed.searchParams.get('company_id')?.trim() ?? ''
    if (company.length > 128) {
      this.respondHtml(response, 400, '<h1>No se puede autorizar</h1><p>invalid_company</p>')
      return
    }
    let space: FaberLoomSpace | undefined
    if (request.spaceId !== null) {
      try {
        space = await this.requireSpace(ownerId, company.length === 0 ? null : company, request.spaceId)
      } catch {
        this.respondHtml(response, 400, '<h1>No se puede autorizar</h1><p>El espacio no está disponible.</p>')
        return
      }
    }
    const now = Date.now()
    const authorizedCompany = space?.companyId ?? (company.length === 0 ? null : company)
    const authorizations = await this.authorizations()
    // Drop pending requests that can no longer be decided; decided rows stay as
    // the sanitized audit trail.
    for (const [key, value] of authorizations.entries()) {
      if (value.ownerId === ownerId && value.status === 'pending' && Date.parse(value.expiresAt) <= now) {
        await authorizations.delete(key)
      }
    }
    const transaction: AuthorizationRecord = {
      id: opaque('tx_'),
      ownerId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      state: request.state,
      resource: request.resource,
      scopes: [...request.scopes],
      companyId: authorizedCompany,
      spaceId: request.spaceId,
      revision: request.revision ?? space?.updatedAt ?? null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + AUTHORIZE_TTL_MS).toISOString(),
      status: 'pending',
      code: null,
      consumedAt: null,
    }
    await authorizations.put(transaction.id, transaction)
    this.respondHtml(response, 200, consentPage(request, transaction.id, space?.title ?? null, authorizedCompany))
  }

  /**
   * Wait for the human decision and deliver the code or the denial.
   * @param rawUrl - full request URL.
   * @param response - HTTP response.
   */
  private async status(rawUrl: string, response: ServerResponse): Promise<void> {
    const ownerId = this.config.ownerId ?? ''
    const parsed = new URL(rawUrl, this.issuer())
    const id = parsed.searchParams.get('transaction') ?? ''
    const transaction = (await this.authorizations()).get(id)
    if (transaction === undefined || transaction.ownerId !== ownerId) {
      this.respondHtml(response, 400, '<h1>La autorización no es válida</h1>')
      return
    }
    if (transaction.status === 'pending' && Date.parse(transaction.expiresAt) <= Date.now()) {
      this.respondHtml(response, 400, '<h1>La autorización expiró</h1>')
      return
    }
    if (transaction.status === 'denied') {
      this.redirectTo(response, transaction, { error: 'access_denied' })
      return
    }
    if (transaction.status === 'approved' && transaction.code !== null) {
      this.redirectTo(response, transaction, { code: transaction.code })
      return
    }
    const link = `/authorize/status?transaction=${encodeURIComponent(id)}`
    this.respondHtml(response, 200, `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="2;url=${link}">
<title>Esperando aprobación</title></head><body>
<h1>Esperando aprobación</h1>
<p>Aprueba la solicitud en <strong>FaberLoom → Conexiones → Servidor MCP</strong>.</p>
<p><a href="${link}">Continuar</a></p>
</body></html>`)
  }

  /** Send the browser to the exact redirect with the code or the denial. */
  private redirectTo(response: ServerResponse, transaction: AuthorizationRecord, params: Record<string, string>): void {
    const target = new URL(transaction.redirectUri)
    target.searchParams.set('state', transaction.state)
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
    response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
    response.end()
  }

  /**
   * Apply the human decision from the signed-in product UI. This is the only
   * path that approves a transaction: the OAuth page itself has no approving
   * control, so a local HTTP client cannot authorize its own request.
   * @param id - transaction id shown on the waiting page and in the panel.
   * @param approve - whether the person approved the request.
   * @param ownerId - identity of the person deciding; must be this installation's owner.
   * @returns whether the transaction was still pending and is now decided.
   */
  async decideAuthorization(id: string, approve: boolean, ownerId: string): Promise<boolean> {
    const configured = this.config.ownerId ?? ''
    if (configured.length > 0 && ownerId !== configured) return false
    const transaction = (await this.authorizations()).get(id)
    if (transaction === undefined || transaction.ownerId !== ownerId || transaction.status !== 'pending'
      || Date.parse(transaction.expiresAt) <= Date.now()) return false
    const now = new Date().toISOString()
    const code = approve ? opaque('code_') : null
    if (code !== null) {
      const record: AuthorizationCodeRecord = {
        transactionId: transaction.id,
        ownerId: transaction.ownerId,
        clientId: transaction.clientId,
        redirectUri: transaction.redirectUri,
        resource: transaction.resource,
        scopes: [...transaction.scopes],
        codeChallenge: transaction.codeChallenge,
        companyId: transaction.companyId,
        spaceId: transaction.spaceId,
        revision: transaction.revision,
        createdAt: now,
        expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        usedAt: null,
      }
      await (await this.codes()).put(codeKey(code), record)
    }
    try {
      await (await this.authorizations()).update(id, (current) => {
        if (current.status !== 'pending' || current.consumedAt !== null || Date.parse(current.expiresAt) <= Date.now()) {
          throw new Error('authorization transaction already consumed')
        }
        return {
          ...current,
          status: approve ? 'approved' : 'denied',
          code,
          consumedAt: now,
        }
      })
    } catch {
      if (code !== null) await (await this.codes()).delete(codeKey(code))
      return false
    }
    return true
  }

  /**
   * Exchange one authorization code for a token and its work reference.
   * @param request - the form POST.
   * @param response - HTTP response.
   */
  private async exchange(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.read(request)
    if (body === 'too-large') {
      this.respond(response, 413, { error: 'request_too_large' })
      return
    }
    const form = new URLSearchParams(body)
    const fail = (error: string): void => { this.respond(response, 400, { error }) }
    if (form.get('grant_type') !== 'authorization_code') {
      fail('unsupported_grant_type')
      return
    }
    const code = form.get('code') ?? ''
    const key = codeKey(code)
    const record = (await this.codes()).get(key)
    if (record === undefined || record.usedAt !== null || Date.parse(record.expiresAt) <= Date.now()) {
      fail('invalid_grant')
      return
    }
    if (form.get('client_id') !== record.clientId || form.get('redirect_uri') !== record.redirectUri
      || form.get('resource') !== record.resource) {
      fail('invalid_grant')
      return
    }
    const verifier = form.get('code_verifier') ?? ''
    if (verifier.length < 43 || verifier.length > 128 || !verifyPkce(verifier, record.codeChallenge)) {
      fail('invalid_grant')
      return
    }
    const now = new Date().toISOString()
    try {
      await (await this.codes()).update(key, (current) => {
        if (current.usedAt !== null || Date.parse(current.expiresAt) <= Date.now()) throw new Error('authorization code already used')
        return { ...current, usedAt: now }
      })
    } catch {
      fail('invalid_grant')
      return
    }
    const secret = `fbl_${randomUUID().replaceAll('-', '')}`
    const reference: WorkReferenceRecord = {
      id: opaque('fwr_'),
      ownerId: record.ownerId,
      connectionId: tokenId(secret),
      companyId: record.companyId,
      spaceId: record.spaceId,
      revision: record.revision,
      scopes: [...record.scopes],
      createdAt: now,
      revokedAt: null,
    }
    await (await this.references()).put(reference.id, reference)
    let minted
    try {
      minted = await this.storeToken(
        secret,
        record.ownerId,
        `OAuth ${record.clientId}`,
        record.scopes,
        record.companyId,
        record.spaceId,
        new Date(Date.now() + 3_600_000).toISOString(),
        reference.id,
      )
    } catch {
      await (await this.references()).delete(reference.id)
      fail('invalid_grant')
      return
    }
    this.respondNoStore(response, {
      access_token: minted.token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: record.scopes.join(' '),
      resource: record.resource,
      work_reference: { id: reference.id, spaceId: reference.spaceId, revision: reference.revision },
    })
  }

  /** Write one JSON response the client and any cache must not retain. */
  private respondNoStore(response: ServerResponse, body: unknown): void {
    const text = JSON.stringify(body)
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
      pragma: 'no-cache',
    })
    response.end(text)
  }

  /**
   * Answer one parsed JSON-RPC message (or batch) without a transport.
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
   * @param reference - work reference the public client presented, when any.
   * @returns the complete answer for the gateway to relay.
   */
  async request(body: string, token: string, accept: string = 'application/json', reference?: string): Promise<FaberLoomMcpAnswer> {
    const max = this.config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    if (Buffer.byteLength(body) > max) {
      return this.answer(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request body too large' } }, 'fbl-bridge')
    }
    const caller = await this.tokenCaller(token, (await this.tokens()).get(token), reference)
    if (caller === undefined) {
      return this.answer(401, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unknown or revoked token' } }, 'fbl-bridge')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return this.answer(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 'fbl-bridge')
    }
    const host = new FaberLoomToolHost(this.ctx, caller.ownerId, caller.scopes, caller.companyId, caller.spaceId ?? undefined)
    return await this.execute(parsed, host, accept.includes('text/event-stream'), caller.sessionId)
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

  /** Resolve the owner, scopes, company, and space a bearer token carries, or undefined when it may not act. */
  private async authenticate(request: IncomingMessage): Promise<TokenCaller | undefined> {
    // The deployment's gateway calls on the owner's behalf with the internal
    // credential, which is not a minted token: it never reaches the token store.
    const mirrorKey = this.config.mirrorKey ?? ''
    const presentedKey = request.headers[MIRROR_KEY_HEADER]
    if (mirrorKey.length > 0 && typeof presentedKey === 'string' && presentedKey.length === mirrorKey.length
      && timingSafeEqual(Buffer.from(presentedKey), Buffer.from(mirrorKey))) {
      const mirrorOwner = this.config.ownerId ?? ''
      if (mirrorOwner.length === 0) return undefined
      return { ownerId: mirrorOwner, scopes: null, companyId: undefined, spaceId: null, referenceId: null, sessionId: 'fbl-mirror' }
    }
    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return undefined
    const token = header.slice(7).trim()
    if (token.length === 0) return undefined
    const referenceHeader = request.headers[WORK_REFERENCE_HEADER]
    const reference = Array.isArray(referenceHeader) ? referenceHeader[0] : referenceHeader
    return await this.tokenCaller(token, (await this.tokens()).get(token), reference)
  }

  /**
   * Validate one stored token and the authority it still carries. The socket and
   * the bridge share it, so a revoked token, a manipulated scope list, or a
   * membership the owner lost all fail the same way on both paths.
   * @param token - the presented bearer token.
   * @param record - its stored row, when any.
   * @param presentedReference - work reference the caller presented, when any.
   * @returns the caller, or undefined when the token may not act.
   */
  private async tokenCaller(token: string, record: TokenRecord | undefined, presentedReference?: string): Promise<TokenCaller | undefined> {
    if (record === undefined || record.revokedAt !== null) return undefined
    if (record.expiresAt !== null && Date.parse(record.expiresAt) <= Date.now()) return undefined
    // Defence in depth: a token of another owner is refused by this process too.
    const owner = this.config.ownerId ?? ''
    if (owner.length > 0 && record.ownerId !== owner) return undefined
    const stored = record.scopes ?? null
    const scopes = stored === null ? null : stored.filter(scope => !RETIRED_SCOPES.has(scope))
    if (scopes !== null) {
      // A stored list that names a proposal tool next to anything else, or an
      // unknown tool, is not a list this server issued; refuse it instead of
      // silently narrowing it.
      if (scopes.includes(PROPOSAL_TOOL) && scopes.length !== 1) return undefined
      const known = new Set(this.toolNames())
      if (scopes.some(scope => !known.has(scope))) return undefined
    }
    // A token minted for a Space stops working when the owner loses access to
    // it; a legacy token (`null`) keeps its owner-wide meaning.
    const spaceId = record.spaceId ?? null
    if (spaceId !== null) {
      try {
        await this.requireSpace(record.ownerId, record.companyId ?? null, spaceId)
      } catch {
        return undefined
      }
    }
    // A token minted through OAuth is bound to one work reference; the caller
    // must present that reference, and it must still name this connection, this
    // owner, and this Space. A legacy token (`referenceId: null`) keeps working
    // without one.
    let referenceId: string | null = null
    if (record.referenceId !== null) {
      if (presentedReference !== record.referenceId) return undefined
      const reference = (await this.references()).get(record.referenceId)
      if (reference === undefined || !referenceMatches(reference, {
        ownerId: record.ownerId,
        connectionId: tokenId(token),
        spaceId,
      })) return undefined
      referenceId = reference.id
    }
    return {
      ownerId: record.ownerId,
      scopes,
      companyId: record.companyId ?? undefined,
      spaceId,
      referenceId,
      sessionId: `fbl-${tokenId(token).slice(0, 16)}`,
    }
  }

  /**
   * Confirm the owner may still read one Space in the token's company.
   * @param ownerId - token owner.
   * @param companyId - company the token acts for, when any.
   * @param spaceId - space the token is confined to.
   * @throws when the Space is absent, foreign, or no longer readable.
   */
  private async requireSpace(ownerId: string, companyId: string | null, spaceId: string): Promise<FaberLoomSpace> {
    const actor: SpaceActor = {
      id: ownerId,
      role: 'client_b2b',
      companyId: companyId ?? undefined,
      readOnly: false,
    }
    return await this.ctx.faberloomSpaces.get(actor, spaceId as FaberLoomSpaceId)
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

  private oauthDomain(): Promise<Domain<typeof mcpOAuthDomainSpec>> {
    this.oauthPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(mcpOAuthDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.mcpServer.oauthDomainClose')
      return domain
    })()
    return this.oauthPromise
  }

  private async authorizations(): Promise<KvTable<string, AuthorizationRecord>> {
    return (await this.oauthDomain()).table('authorizations')
  }

  private async codes(): Promise<KvTable<string, AuthorizationCodeRecord>> {
    return (await this.oauthDomain()).table('codes')
  }

  private async references(): Promise<KvTable<string, WorkReferenceRecord>> {
    return (await this.oauthDomain()).table('references')
  }

  /** The local issuer origin the browser and the client see. */
  private issuer(): string {
    const address = this.server?.address()
    if (typeof address === 'object' && address !== null) {
      return `http://127.0.0.1:${String(address.port)}`
    }
    return 'http://localhost'
  }

  /** The MCP endpoint the access token is bound to. */
  private resourceUrl(): string {
    return `${this.issuer()}/mcp`
  }

  /** Write one HTML response. */
  private respondHtml(response: ServerResponse, status: number, html: string): void {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
    })
    response.end(html)
  }

  /** Whether this process listens on a TCP port the browser can reach. */
  private oauthAvailable(): boolean {
    const address = this.server?.address()
    return typeof address === 'object' && address !== null
  }

  /**
   * Mint one bearer token for a client the owner names.
   * @param label - who the token is for.
   * @param scopes - tool names the client may call, or null for the full surface.
   * @param companyId - company scope the token acts for, or null for the deployment's none.
   * @param spaceId - space the proposals are filed in; requires the proposal tool
   *   as the only scope, or null for the legacy owner-wide token.
   * @param expiresAt - instant the token stops working, or null for no fixed life.
   * @returns the token once and the row the panel will list.
   */
  async mintToken(
    label: string,
    scopes: readonly string[] | null = null,
    companyId: string | null = null,
    spaceId: string | null = null,
    expiresAt: string | null = null,
  ): Promise<FaberLoomMcpToken> {
    const ownerId = this.config.ownerId ?? ''
    if (ownerId.length === 0) throw new Error('faberloom: the MCP server has no owner configured')
    const cleanLabel = label.trim()
    if (cleanLabel.length === 0 || cleanLabel.length > 80) {
      throw new Error('faberloom: MCP_LABEL_INVALID — a token label needs 1 to 80 characters')
    }
    const normalized = scopes === null
      ? null
      : [...new Set(scopes.map(scope => scope.trim()).filter(scope => scope.length > 0))]
    if (normalized !== null) {
      const retired = normalized.find(scope => RETIRED_SCOPES.has(scope))
      if (retired !== undefined) throw new Error(`faberloom: MCP_SCOPE_RETIRED — ${retired} is no longer a tool of this server`)
      const known = new Set(this.toolNames())
      const unknown = normalized.find(scope => !known.has(scope))
      if (unknown !== undefined) throw new Error(`faberloom: MCP_SCOPE_UNKNOWN — ${unknown} is not a tool of this server`)
      if (normalized.includes(PROPOSAL_TOOL) && normalized.length !== 1) {
        throw new Error('faberloom: PROPOSAL_SCOPE_EXCLUSIVE — a proposal token may only carry faberloom_proposal_submit')
      }
    }
    if (spaceId !== null && (normalized === null || normalized.length !== 1 || normalized[0] !== PROPOSAL_TOOL)) {
      throw new Error('faberloom: PROPOSAL_SPACE_REQUIRES_PROPOSAL_SCOPE — a space-scoped token may only carry faberloom_proposal_submit')
    }
    const token = `fbl_${randomUUID().replaceAll('-', '')}`
    return await this.storeToken(token, ownerId, cleanLabel, normalized, companyId, spaceId, expiresAt, null)
  }

  /**
   * Persist one token row after its authority is resolved. The OAuth exchange
   * pre-generates the secret so it can store the reference first and write the
   * token once with its `referenceId`, leaving no live token without a reference.
   */
  private async storeToken(
    token: string,
    ownerId: string,
    label: string,
    scopes: readonly string[] | null,
    companyId: string | null,
    spaceId: string | null,
    expiresAt: string | null,
    referenceId: string | null,
  ): Promise<FaberLoomMcpToken> {
    if (spaceId !== null) await this.requireSpace(ownerId, companyId, spaceId)
    const record: TokenRecord = {
      ownerId,
      label,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      scopes: scopes === null ? null : [...scopes],
      companyId,
      spaceId,
      referenceId,
      expiresAt,
    }
    await (await this.tokens()).put(token, record)
    void this.bridgeRegister()
    return { token, row: this.rowOf(token, record) }
  }

  /**
   * List the tokens this owner minted, revoked ones included. The bearer secret
   * is never part of a row: the panel revokes by the fingerprint.
   * @returns the token rows.
   */
  async listTokens(): Promise<readonly FaberLoomMcpTokenRow[]> {
    const ownerId = this.config.ownerId ?? ''
    const out: FaberLoomMcpTokenRow[] = []
    for (const [token, record] of (await this.tokens()).entries()) {
      if (record.ownerId !== ownerId) continue
      out.push(this.rowOf(token, record))
    }
    return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * Revoke one token by fingerprint, or by its exact bearer secret for a legacy
   * caller that still holds it. A fingerprint is what every listing exposes.
   * @param reference - token fingerprint, or the legacy token string.
   * @returns whether a live token was revoked.
   */
  async revokeToken(reference: string): Promise<boolean> {
    const ownerId = this.config.ownerId ?? ''
    const tokens = await this.tokens()
    let key = tokens.get(reference) === undefined ? undefined : reference
    if (key === undefined) {
      for (const [token, record] of tokens.entries()) {
        if (record.ownerId === ownerId && tokenId(token) === reference) {
          key = token
          break
        }
      }
    }
    if (key === undefined) return false
    const record = tokens.get(key)
    if (record === undefined || record.ownerId !== ownerId || record.revokedAt !== null) return false
    await tokens.put(key, { ...record, revokedAt: new Date().toISOString() })
    void this.bridgeRegister()
    return true
  }

  /**
   * The pending authorization requests of this owner, newest last. The product
   * panel renders these and calls {@link decideAuthorization}; the waiting page
   * has no approving control of its own.
   * @returns the pending requests.
   */
  async pendingAuthorizations(): Promise<readonly FaberLoomMcpAuthorization[]> {
    const ownerId = this.config.ownerId ?? ''
    const out: FaberLoomMcpAuthorization[] = []
    for (const [, transaction] of (await this.authorizations()).entries()) {
      if (transaction.ownerId !== ownerId || transaction.status !== 'pending') continue
      if (Date.parse(transaction.expiresAt) <= Date.now()) continue
      out.push({
        id: transaction.id,
        spaceId: transaction.spaceId,
        companyId: transaction.companyId,
        scopes: [...transaction.scopes],
        createdAt: transaction.createdAt,
        expiresAt: transaction.expiresAt,
      })
    }
    return out.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * Revoke one work reference. The connection keeps its token, but every call
   * that presents this reference stops working.
   * @param id - reference id returned at token exchange.
   * @returns whether a live reference was revoked.
   */
  async revokeWorkReference(id: string): Promise<boolean> {
    const ownerId = this.config.ownerId ?? ''
    const references = await this.references()
    const reference = references.get(id)
    if (reference === undefined || reference.ownerId !== ownerId || reference.revokedAt !== null) return false
    await references.put(id, { ...reference, revokedAt: new Date().toISOString() })
    return true
  }

  /**
   * The tool names a token may be scoped to, in catalogue order.
   * @returns the advertised tool names.
   */
  toolNames(): readonly string[] {
    return new FaberLoomToolHost(this.ctx, this.config.ownerId ?? '', null).tools().map(tool => tool.name)
  }

  /** Project one stored token into the row the panel lists. */
  private rowOf(token: string, record: TokenRecord): FaberLoomMcpTokenRow {
    return {
      id: tokenId(token),
      label: record.label,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt,
      scopes: record.scopes === null ? null : record.scopes.filter(scope => !RETIRED_SCOPES.has(scope)),
      companyId: record.companyId ?? null,
      spaceId: record.spaceId ?? null,
    }
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

  /**
   * The bearer secrets of this owner's live tokens, for the gateway bridge
   * registration only. The public listing never carries them.
   * @returns the live token strings.
   */
  private async liveTokens(): Promise<readonly string[]> {
    const ownerId = this.config.ownerId ?? ''
    const out: string[] = []
    for (const [token, record] of (await this.tokens()).entries()) {
      if (record.ownerId !== ownerId || record.revokedAt !== null) continue
      if (record.expiresAt !== null && Date.parse(record.expiresAt) <= Date.now()) continue
      out.push(token)
    }
    return out
  }

  /** Register every live token of this installation with the gateway. */
  private async bridgeRegister(): Promise<void> {
    if (this.bridgeStopped || this.config.bridge !== true) return
    const base = this.bridgeBase()
    const consoleToken = this.consoleToken()
    if (base === undefined || consoleToken === undefined) return
    const tokens = await this.liveTokens()
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
