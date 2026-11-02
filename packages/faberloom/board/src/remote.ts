/**
 * HTTP client for the central board API (`gateway/board-api.mjs`). It carries
 * the board's storage operations — list, read, create, patch, and audit events
 * — over the wire so a local board can use the central PostgreSQL table instead
 * of its per-user JSON file.
 *
 * ## Identity contract
 *
 * The local process has no gateway cookie, so every request authenticates with
 * a per-user service token:
 *
 * ```text
 * Authorization: Bearer <actor.token>
 * ```
 *
 * The gateway validates that token (signature, audience, expiry) and resolves
 * the actor — `email`, `tenantId`, `role` — from its claims. This client never
 * sends `X-Board-Actor`, `X-Board-Tenant`, or `X-Board-Role`, and never sends
 * `tenantId`, `ownerId`, `email`, or `role` in a body: the API rejects those
 * fields with `INVALID_INPUT` because identity is not a client assertion.
 * `BoardRemoteActor.email`, `.tenantId`, and `.role` describe the identity the
 * token represents; the client uses `tenantId` to refuse a response belonging
 * to another tenant and sends none of them as a credential.
 *
 * A token belongs to one user in one tenant. The gateway must not accept a
 * shared service token: if a local process can obtain a token for any email,
 * the API's tenant isolation stops meaning anything.
 *
 * ## Failure contract
 *
 * Every failure is a {@link BoardRemoteError} with a stable `code`, the HTTP
 * `status` (or `null` when no response arrived), the server's `details`, and
 * the gateway `request_id` when it sent one. Only `429`, `502`, `503`, and
 * `504` are retried, at most three attempts with bounded backoff. `409` is
 * never retried: the caller must re-read the item and decide.
 *
 * @module @deepseek-ai/dsh-faberloom-board/src/remote
 */

import type { BoardState } from './types.ts'

/** Default per-attempt budget for one HTTP exchange. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Attempts one request may make, including the first. */
const MAX_ATTEMPTS = 3

/** First backoff step; each further retry doubles it. */
const BASE_RETRY_DELAY_MS = 50

/** Ceiling for a backoff step, whether computed or read from `Retry-After`. */
const MAX_RETRY_DELAY_MS = 1_000

/** Statuses a retry can plausibly fix. `409`, `500`, and transport errors are excluded. */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504])

/** Codes the gateway documents; anything else is reported as `UNKNOWN`. */
const SERVER_CODES: ReadonlySet<string> = new Set([
  'UNAUTHENTICATED',
  'INVALID_INPUT',
  'NO_ACCESS',
  'NOT_FOUND',
  'DUPLICATE',
  'STALE_ROW',
  'NO_RUN',
  'NO_EVIDENCE',
  'INTERNAL',
])

/** Fallback code for an error body the gateway did not classify. */
const STATUS_CODES: Readonly<Record<number, BoardRemoteErrorCode>> = {
  401: 'UNAUTHENTICATED',
  403: 'NO_ACCESS',
  404: 'NOT_FOUND',
  422: 'INVALID_INPUT',
  429: 'RATE_LIMITED',
  502: 'UNAVAILABLE',
  503: 'UNAVAILABLE',
  504: 'UNAVAILABLE',
}

/** The transport the client calls; `globalThis.fetch` by default. */
export type BoardRemoteFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * The identity a service token represents. `tenantId` is compared against the
 * tenant of every item the API returns; `email` and `role` are descriptive and
 * never leave the process.
 */
export interface BoardRemoteActor {
  /** Authenticated email the gateway encoded in the token. */
  readonly email: string
  /** Tenant the token is scoped to. */
  readonly tenantId: string
  /** Console role the gateway encoded in the token. */
  readonly role: string
  /** Per-user service token issued by the gateway; the only credential on the wire. */
  readonly token: string
}

/** Construction options of a {@link BoardRemote}. */
export interface BoardRemoteOptions {
  /** Base URL of the API, e.g. `https://mesa.example/board`. A trailing slash is tolerated. */
  readonly baseUrl: string
  /** Identity the token represents. */
  readonly actor: BoardRemoteActor
  /** Transport override for tests or a custom agent. Defaults to `globalThis.fetch`. */
  readonly fetch?: BoardRemoteFetch
  /** Budget of one HTTP exchange in milliseconds. Defaults to 10 s. */
  readonly timeoutMs?: number
}

/** One item as the central API serializes it. */
export interface BoardRemoteItem {
  /** Stable item id. */
  readonly id: string
  /** Tenant that owns the row. */
  readonly tenantId: string
  /** Owner email, lowercased by the API. */
  readonly ownerId: string
  /** Optional space, or null. */
  readonly spaceId: string | null
  /** Live business key, or the empty string when the producer named none. */
  readonly businessKey: string
  /** Persisted WorkLoom state. */
  readonly state: BoardState
  /** Optimistic token the next write must send. */
  readonly rowVersion: number
  /** Display title, or null for a row written before titles existed. */
  readonly title: string | null
  /** Evidence references. */
  readonly evidence: readonly string[]
  /** Producer payload; `{}` when the producer sent none. */
  readonly payload: Readonly<Record<string, unknown>>
  /** Action Engine run that created the item, or null. */
  readonly runId: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last write. */
  readonly updatedAt: string
}

/** One audit event as the central API serializes it. */
export interface BoardRemoteEvent {
  /** Position inside the item's audit log; the next append continues from it. */
  readonly seq: number
  /** Actor email the gateway resolved. */
  readonly actor: string
  /** Command that produced the event. */
  readonly command: string
  /** State before the command, or null on creation. */
  readonly fromState: BoardState | null
  /** State after the command, or null when the row carried none. */
  readonly toState: BoardState | null
  /** Command payload, or null. */
  readonly payload: Readonly<Record<string, unknown>> | null
  /** ISO-8601 instant. */
  readonly at: string
}

/** Filters of {@link BoardRemote.list}. */
export interface BoardRemoteListFilter {
  /** Only items in this state. */
  readonly state?: BoardState
  /** Only items in this space. */
  readonly spaceId?: string
  /** Page size; the API defaults to 50 and caps at 200. */
  readonly limit?: number
}

/** Filters of {@link BoardRemote.events}. */
export interface BoardRemoteEventFilter {
  /** Return events with a greater `seq`; 0 or absent starts at the beginning. */
  readonly after?: number
  /** Page size; the API defaults to 200 and caps at 500. */
  readonly limit?: number
}

/**
 * Creation body of `POST /board/items`. The server owns identity, so this type
 * exposes no `ownerId`, `tenantId`, `email`, or `role` field.
 */
export interface BoardRemoteCreateInput {
  /** Action Engine run that produced the item. */
  readonly runId: string
  /** Retry key; repeating it with the same business key returns the same item. */
  readonly idempotencyKey: string
  /** Business identity the producer chose. */
  readonly businessKey: string
  /** Display title. */
  readonly title: string
  /** At least one evidence reference. */
  readonly evidence: readonly string[]
  /** Initial state; the API defaults to `PENDIENTE_CRITERIO`. */
  readonly state?: BoardState
  /** Optional space. */
  readonly spaceId?: string
  /** Producer payload. */
  readonly payload?: Readonly<Record<string, unknown>>
}

/** Body of {@link BoardRemote.update}; at least one of `state` and `payload` is required. */
export interface BoardRemoteUpdateInput {
  /** Row token the caller read; a mismatch is `409 STALE_ROW`. */
  readonly rowVersion: number
  /** Next state. */
  readonly state?: BoardState
  /** Next payload; replaces the stored payload. */
  readonly payload?: Readonly<Record<string, unknown>>
}

/** Body of {@link BoardRemote.appendEvent}. */
export interface BoardRemoteEventInput {
  /** Command name recorded in the audit log. */
  readonly command: string
  /** Optional structured payload. */
  readonly payload?: Readonly<Record<string, unknown>>
}

/** Stable failure codes: the gateway's documented set plus the client's transport codes. */
export type BoardRemoteErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'NO_ACCESS'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'STALE_ROW'
  | 'NO_RUN'
  | 'NO_EVIDENCE'
  | 'INTERNAL'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'TENANT_MISMATCH'
  | 'CONFIGURATION'
  | 'UNKNOWN'

/** Every failure of the client, typed by code, HTTP status, and server detail. */
export class BoardRemoteError extends Error {
  /** Stable machine-readable code. */
  readonly code: BoardRemoteErrorCode
  /** HTTP status, or null when the request never produced a response. */
  readonly status: number | null
  /** The gateway's `details`, or a client-side detail object. */
  readonly details: unknown
  /** Gateway request id, when the response or body carried one. */
  readonly requestId: string | null

  /**
   * @param code - stable machine-readable code.
   * @param status - HTTP status, or null for a transport or configuration failure.
   * @param message - operator-facing explanation; a gateway message is passed through.
   * @param details - field-level detail, or null.
   * @param requestId - gateway request id, or null.
   */
  constructor(
    code: BoardRemoteErrorCode,
    status: number | null,
    message: string,
    details: unknown = null,
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'BoardRemoteError'
    this.code = code
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

/** One response after its body was read inside the timeout window. */
interface BoardRemoteResult {
  readonly status: number
  readonly text: string
  readonly requestId: string | null
}

/** One HTTP exchange, response and body, as the request loop sees it. */
interface BoardRemoteExchange {
  readonly response: Response
  readonly text: string
}

/** The central board API. */
export class BoardRemote {
  readonly #baseUrl: string
  readonly #tenantId: string
  readonly #token: string
  readonly #timeoutMs: number
  readonly #fetch: BoardRemoteFetch

  /**
   * @param options - endpoint, the identity the token represents, and transport overrides.
   * @throws {BoardRemoteError} `CONFIGURATION` when the base URL, token, tenant, or timeout is unusable.
   */
  constructor(options: BoardRemoteOptions) {
    this.#baseUrl = boardBaseUrl(options.baseUrl)
    const token = options.actor.token.trim()
    if (token.length === 0) {
      throw new BoardRemoteError('CONFIGURATION', null, 'a per-user service token is required')
    }
    const tenantId = options.actor.tenantId.trim().toLowerCase()
    if (tenantId.length === 0) {
      throw new BoardRemoteError('CONFIGURATION', null, 'actor.tenantId is required')
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new BoardRemoteError('CONFIGURATION', null, `timeoutMs must be a positive integer, got ${timeoutMs}`)
    }
    this.#token = token
    this.#tenantId = tenantId
    this.#timeoutMs = timeoutMs
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
  }

  /**
   * List the items the token's actor may read.
   * @param filter - state, space, and page size; omitted fields are not sent.
   * @returns the items, newest first as the API orders them.
   */
  async list(filter: BoardRemoteListFilter = {}): Promise<readonly BoardRemoteItem[]> {
    const query = queryOf({ state: filter.state, spaceId: filter.spaceId, limit: filter.limit })
    const result = await this.#request('GET', `/items${query}`)
    const body = this.#body(result)
    const items = body['items']
    if (!Array.isArray(items)) {
      throw new BoardRemoteError('INVALID_RESPONSE', result.status, 'the list response carries no items array', null, result.requestId)
    }
    return items.map(entry => this.#item(entry, result))
  }

  /**
   * Read one item.
   * @param id - item id.
   * @returns the item as the API stores it.
   */
  async get(id: string): Promise<BoardRemoteItem> {
    const result = await this.#request('GET', itemPath(id))
    return this.#itemFrom(result)
  }

  /**
   * Create one item. A repeated `idempotencyKey` with the same business key and
   * owner returns the existing item instead of creating another.
   * @param input - producer fields the API accepts.
   * @returns the created or replayed item.
   */
  async create(input: BoardRemoteCreateInput): Promise<BoardRemoteItem> {
    const result = await this.#request('POST', '/items', createBody(input))
    return this.#itemFrom(result)
  }

  /**
   * Patch one item. The API accepts any known state; transition rules stay in
   * the board, not in this client.
   * @param id - item id.
   * @param change - expected `rowVersion` plus the state and/or payload to write.
   * @returns the item after the write, with `rowVersion` incremented.
   */
  async update(id: string, change: BoardRemoteUpdateInput): Promise<BoardRemoteItem> {
    const result = await this.#request('PATCH', itemPath(id), updateBody(change))
    return this.#itemFrom(result)
  }

  /**
   * Read an item's audit log.
   * @param id - item id.
   * @param filter - `after` cursor and page size.
   * @returns events ordered by `seq`.
   */
  async events(id: string, filter: BoardRemoteEventFilter = {}): Promise<readonly BoardRemoteEvent[]> {
    const query = queryOf({ after: filter.after, limit: filter.limit })
    const result = await this.#request('GET', `${itemPath(id)}/events${query}`)
    const body = this.#body(result)
    const events = body['events']
    if (!Array.isArray(events)) {
      throw new BoardRemoteError('INVALID_RESPONSE', result.status, 'the events response carries no events array', null, result.requestId)
    }
    return events.map(entry => this.#event(entry, result))
  }

  /**
   * Append one audit event. The API assigns `seq` under the item lock and does
   * not change `rowVersion` or the state.
   * @param id - item id.
   * @param event - command and optional payload.
   * @returns the stored event.
   */
  async appendEvent(id: string, event: BoardRemoteEventInput): Promise<BoardRemoteEvent> {
    const result = await this.#request('POST', `${itemPath(id)}/events`, eventBody(event))
    const body = this.#body(result)
    return this.#event(body['event'], result)
  }

  /**
   * Send one request, retrying only the statuses a retry can fix.
   * @param method - HTTP method.
   * @param path - path below the configured base URL.
   * @param body - JSON body, or undefined for a bodyless request.
   * @returns the last response with its body already read.
   */
  async #request(method: string, path: string, body?: unknown): Promise<BoardRemoteResult> {
    const url = `${this.#baseUrl}${path}`
    const hasBody = body !== undefined
    const init: RequestInit = {
      method,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: 'application/json',
        ...hasBody ? { 'content-type': 'application/json' } : {},
      },
      ...hasBody ? { body: JSON.stringify(body) } : {},
    }
    for (let attempt = 1; ; attempt += 1) {
      const { response, text } = await this.#fetchOnce(url, init)
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= MAX_ATTEMPTS) {
        return { status: response.status, text, requestId: response.headers.get('x-request-id') }
      }
      await delay(retryDelayMs(response.headers.get('retry-after'), attempt))
    }
  }

  /**
   * Perform one exchange with the timeout covering both the headers and the body.
   * @param url - absolute request URL.
   * @param init - method, headers, and body.
   * @returns the response and its text.
   */
  async #fetchOnce(url: string, init: RequestInit): Promise<BoardRemoteExchange> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Rejecting first makes the deadline win the race even when aborting
        // the request settles the fetch promise in the same tick.
        reject(new BoardRemoteError('TIMEOUT', null, `the board API did not answer within ${this.#timeoutMs} ms`, { timeoutMs: this.#timeoutMs }))
        controller.abort()
      }, this.#timeoutMs)
    })
    const exchange = (async (): Promise<BoardRemoteExchange> => {
      const response = await this.#fetch(url, { ...init, signal: controller.signal })
      return { response, text: await response.text() }
    })()
    try {
      return await Promise.race([exchange, deadline])
    } catch (error: unknown) {
      if (error instanceof BoardRemoteError) throw error
      throw new BoardRemoteError('NETWORK', null, 'the board API request failed', { cause: messageOf(error) })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Read a successful body, or throw the gateway's error.
   * @param result - the last response.
   * @returns the parsed JSON object.
   */
  #body(result: BoardRemoteResult): Record<string, unknown> {
    const parsed = parseObject(result.text)
    if (result.status >= 400) throw failureOf(result, parsed)
    if (parsed === null) {
      throw new BoardRemoteError('INVALID_RESPONSE', result.status, 'the board API response is not a JSON object', null, result.requestId)
    }
    return parsed
  }

  /**
   * Read the `item` member of a response.
   * @param result - the last response.
   * @returns the validated item.
   */
  #itemFrom(result: BoardRemoteResult): BoardRemoteItem {
    const body = this.#body(result)
    return this.#item(body['item'], result)
  }

  /**
   * Validate one wire item and refuse a foreign tenant.
   * @param value - the `item` member.
   * @param result - the response it came from, for error detail.
   * @returns the item.
   */
  #item(value: unknown, result: BoardRemoteResult): BoardRemoteItem {
    const item = itemOf(value)
    if (item === null) {
      throw new BoardRemoteError('INVALID_RESPONSE', result.status, 'the response carries no valid item', null, result.requestId)
    }
    if (item.tenantId !== this.#tenantId) {
      throw new BoardRemoteError('TENANT_MISMATCH', result.status, 'the board API returned an item of another tenant', { tenantId: item.tenantId }, result.requestId)
    }
    return item
  }

  /**
   * Validate one wire event.
   * @param value - the `event` or one `events[]` member.
   * @param result - the response it came from, for error detail.
   * @returns the event.
   */
  #event(value: unknown, result: BoardRemoteResult): BoardRemoteEvent {
    const event = eventOf(value)
    if (event === null) {
      throw new BoardRemoteError('INVALID_RESPONSE', result.status, 'the response carries no valid event', null, result.requestId)
    }
    return event
  }
}

/**
 * Normalize the configured endpoint and reject one this client cannot use.
 * @param raw - the configured base URL.
 * @returns origin plus path, without a trailing slash.
 */
function boardBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BoardRemoteError('CONFIGURATION', null, `baseUrl is not an absolute URL: ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BoardRemoteError('CONFIGURATION', null, `baseUrl must use http or https, got ${url.protocol}`)
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new BoardRemoteError('CONFIGURATION', null, 'baseUrl must not carry a query or a fragment')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Path of one item, with the id escaped.
 * @param id - item id.
 * @returns the escaped path.
 */
function itemPath(id: string): string {
  return `/items/${encodeURIComponent(id)}`
}

/**
 * Serialize query parameters, skipping absent ones.
 * @param entries - parameter names mapped to their value, or undefined to omit.
 * @returns a `?…` suffix, or the empty string when nothing is set.
 */
function queryOf(entries: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const text = params.toString()
  return text.length === 0 ? '' : `?${text}`
}

/**
 * Body of `POST /items`, omitting the optional fields the caller left unset.
 * @param input - producer fields.
 * @returns the JSON body.
 */
function createBody(input: BoardRemoteCreateInput): Record<string, unknown> {
  return {
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    businessKey: input.businessKey,
    title: input.title,
    evidence: [...input.evidence],
    ...input.state === undefined ? {} : { state: input.state },
    ...input.spaceId === undefined ? {} : { spaceId: input.spaceId },
    ...input.payload === undefined ? {} : { payload: input.payload },
  }
}

/**
 * Body of `PATCH /items/:id`.
 * @param input - expected version and the fields to write.
 * @returns the JSON body.
 */
function updateBody(input: BoardRemoteUpdateInput): Record<string, unknown> {
  return {
    rowVersion: input.rowVersion,
    ...input.state === undefined ? {} : { state: input.state },
    ...input.payload === undefined ? {} : { payload: input.payload },
  }
}

/**
 * Body of `POST /items/:id/events`.
 * @param input - command and optional payload.
 * @returns the JSON body.
 */
function eventBody(input: BoardRemoteEventInput): Record<string, unknown> {
  return {
    command: input.command,
    ...input.payload === undefined ? {} : { payload: input.payload },
  }
}

/**
 * Backoff before the next attempt: `Retry-After` when the gateway sent a
 * numeric one, otherwise exponential from {@link BASE_RETRY_DELAY_MS}.
 * @param header - the `Retry-After` value, or null.
 * @param attempt - the attempt that just failed, starting at 1.
 * @returns the delay in milliseconds, never above {@link MAX_RETRY_DELAY_MS}.
 */
function retryDelayMs(header: string | null, attempt: number): number {
  const seconds = header === null ? Number.NaN : Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS)
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

/**
 * Wait before a retry.
 * @param ms - delay in milliseconds.
 * @returns a promise that settles after the delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** @param value - any JSON value. @returns true for a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a response body as an object.
 * @param text - the raw body.
 * @returns the object, or null when the body is empty or not a JSON object.
 */
function parseObject(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Validate the fields conflict handling and tenant checks read.
 * @param value - one `item` member.
 * @returns the typed item, or null when a required field is missing.
 */
function itemOf(value: unknown): BoardRemoteItem | null {
  if (!isRecord(value)) return null
  if (typeof value['id'] !== 'string') return null
  if (typeof value['tenantId'] !== 'string') return null
  if (typeof value['state'] !== 'string') return null
  if (typeof value['rowVersion'] !== 'number') return null
  return value as unknown as BoardRemoteItem
}

/**
 * Validate the fields an audit reader orders by.
 * @param value - one `event` or `events[]` member.
 * @returns the typed event, or null when a required field is missing.
 */
function eventOf(value: unknown): BoardRemoteEvent | null {
  if (!isRecord(value)) return null
  if (typeof value['seq'] !== 'number') return null
  if (typeof value['command'] !== 'string') return null
  if (typeof value['at'] !== 'string') return null
  return value as unknown as BoardRemoteEvent
}

/**
 * Map a failed response to a typed error.
 * @param result - the last response.
 * @param body - its parsed body, or null when it carried no JSON object.
 * @returns the error to throw.
 */
function failureOf(result: BoardRemoteResult, body: Record<string, unknown> | null): BoardRemoteError {
  const rawMessage = body?.['message']
  const message = typeof rawMessage === 'string' && rawMessage.length > 0
    ? rawMessage
    : `the board API answered HTTP ${result.status}`
  const rawRequestId = body?.['request_id']
  const requestId = typeof rawRequestId === 'string' ? rawRequestId : result.requestId
  return new BoardRemoteError(
    serverCodeOf(body) ?? statusCodeOf(result.status),
    result.status,
    message,
    body?.['details'] ?? null,
    requestId,
  )
}

/**
 * Read the gateway's stable code.
 * @param body - the parsed error body, or null.
 * @returns the code when the gateway named a documented one, else null.
 */
function serverCodeOf(body: Record<string, unknown> | null): BoardRemoteErrorCode | null {
  const code = body?.['code']
  return typeof code === 'string' && SERVER_CODES.has(code) ? code as BoardRemoteErrorCode : null
}

/**
 * Fallback code for an error the gateway did not classify.
 * @param status - HTTP status.
 * @returns the documented code for that status, or `UNKNOWN`.
 */
function statusCodeOf(status: number): BoardRemoteErrorCode {
  return STATUS_CODES[status] ?? 'UNKNOWN'
}

/** @param error - a thrown value. @returns its message, or its text form. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
