import { describe, expect, it, vi } from 'vitest'
import {
  BoardRemote,
  BoardRemoteError,
  type BoardRemoteActor,
  type BoardRemoteFetch,
  type BoardRemoteOptions,
} from '../src/remote.ts'

const ACTOR: BoardRemoteActor = {
  email: 'alice@acme.test',
  tenantId: 'acme',
  role: 'admin',
  token: 'tok-alice',
}

const ITEM = {
  id: 'item-1',
  tenantId: 'acme',
  ownerId: 'alice@acme.test',
  spaceId: null,
  businessKey: 'bk-1',
  state: 'PENDIENTE_CRITERIO',
  rowVersion: 1,
  title: 'Preparado',
  evidence: ['oc:505288'],
  payload: { total: 10 },
  runId: 'run-1',
  createdAt: '2026-11-02T15:00:00.000Z',
  updatedAt: '2026-11-02T15:00:00.000Z',
} as const

const EVENT = {
  seq: 1,
  actor: 'alice@acme.test',
  command: 'created',
  fromState: null,
  toState: 'PENDIENTE_CRITERIO',
  payload: { businessKey: 'bk-1' },
  at: '2026-11-02T15:00:00.000Z',
} as const

interface Call {
  readonly url: string
  readonly init: RequestInit
}

/** A JSON response with the headers the API sets. */
function json(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** A fetch double that records every call and delegates the answer. */
function recorder(
  handler: (url: string, init: RequestInit, call: number) => Response | Promise<Response>,
): { calls: Call[]; fetch: BoardRemoteFetch } {
  const calls: Call[] = []
  const fetchImpl: BoardRemoteFetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init, calls.length)
  }
  return { calls, fetch: fetchImpl }
}

/** Build a client over the fake transport. */
function remote(
  fetchImpl: BoardRemoteFetch,
  extra: { baseUrl?: string; actor?: BoardRemoteActor; timeoutMs?: number } = {},
): BoardRemote {
  return new BoardRemote({
    baseUrl: extra.baseUrl ?? 'https://mesa.test/board/',
    actor: extra.actor ?? ACTOR,
    fetch: fetchImpl,
    ...extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs },
  })
}

/** Await a promise that must reject with a typed client error. */
async function rejectionOf(promise: Promise<unknown>): Promise<BoardRemoteError> {
  try {
    await promise
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BoardRemoteError)
    return error as BoardRemoteError
  }
  throw new Error('expected the request to fail')
}

/** Read the JSON body the client sent. */
function bodyOf(call: Call | undefined): Record<string, unknown> {
  const body = call?.init.body
  if (typeof body !== 'string') throw new Error('the client sent no JSON string body')
  return JSON.parse(body) as Record<string, unknown>
}

/** Run a constructor expected to reject its configuration. */
function configurationError(options: BoardRemoteOptions): BoardRemoteError {
  try {
    new BoardRemote(options)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BoardRemoteError)
    return error as BoardRemoteError
  }
  throw new Error('expected BoardRemote to reject the configuration')
}

describe('BoardRemote reads', () => {
  it('sends the bearer token and the filters, then returns the items', async () => {
    const { calls, fetch } = recorder(() => json({ items: [ITEM] }))
    const items = await remote(fetch).list({ state: 'PENDIENTE_CRITERIO', spaceId: 'sp-1', limit: 20 })

    expect(items.map(item => item.id)).toEqual(['item-1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://mesa.test/board/items?state=PENDIENTE_CRITERIO&spaceId=sp-1&limit=20')
    expect(calls[0]?.init.method).toBe('GET')
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('authorization')).toBe('Bearer tok-alice')
    expect(headers.get('accept')).toBe('application/json')
    // Identity is the token, never a spoofable header.
    expect(headers.get('x-board-actor')).toBeNull()
    expect(headers.get('x-board-tenant')).toBeNull()
    expect(headers.get('x-board-role')).toBeNull()
  })

  it('sends the selected entity only when the deployment names one', async () => {
    const { calls, fetch } = recorder(() => json({ items: [] }))
    const client = new BoardRemote({
      baseUrl: 'https://mesa.test',
      actor: ACTOR,
      fetch,
      tenant: 'Beta-Entity',
    })

    await client.list()

    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('x-board-tenant')).toBe('beta-entity')
    expect(headers.get('authorization')).toBe('Bearer tok-alice')
  })

  it('omits every absent filter and hyphen-free base paths', async () => {
    const { calls, fetch } = recorder(() => json({ items: [] }))
    await remote(fetch).list()
    await remote(fetch, { baseUrl: 'https://mesa.test' }).list()

    expect(calls[0]?.url).toBe('https://mesa.test/board/items')
    expect(calls[1]?.url).toBe('https://mesa.test/items')
  })

  it('escapes the item id and returns one item', async () => {
    const { calls, fetch } = recorder(() => json({ item: ITEM }))
    const item = await remote(fetch).get('item/1')

    expect(item).toMatchObject({ id: 'item-1', rowVersion: 1 })
    expect(calls[0]?.url).toBe('https://mesa.test/board/items/item%2F1')
  })

  it('reads the audit log with and without a cursor', async () => {
    const { calls, fetch } = recorder(() => json({ events: [EVENT] }))
    const client = remote(fetch)

    const events = await client.events('item-1', { after: 3, limit: 10 })
    await client.events('item-1')

    expect(events.map(event => event.seq)).toEqual([1])
    expect(calls[0]?.url).toBe('https://mesa.test/board/items/item-1/events?after=3&limit=10')
    expect(calls[1]?.url).toBe('https://mesa.test/board/items/item-1/events')
  })
})

describe('BoardRemote writes', () => {
  it('creates an item with every producer field', async () => {
    const { calls, fetch } = recorder(() => json({ item: ITEM }, 201))
    const item = await remote(fetch).create({
      runId: 'run-1',
      idempotencyKey: 'idem-1',
      businessKey: 'bk-1',
      title: 'Preparado',
      evidence: ['oc:505288'],
      state: 'PENDIENTE_CRITERIO',
      spaceId: 'sp-1',
      payload: { total: 10 },
    })

    expect(item.id).toBe('item-1')
    expect(calls[0]?.init.method).toBe('POST')
    expect(bodyOf(calls[0])).toEqual({
      runId: 'run-1',
      idempotencyKey: 'idem-1',
      businessKey: 'bk-1',
      title: 'Preparado',
      evidence: ['oc:505288'],
      state: 'PENDIENTE_CRITERIO',
      spaceId: 'sp-1',
      payload: { total: 10 },
    })
  })

  it('omits the optional fields the caller left unset', async () => {
    const { calls, fetch } = recorder(() => json({ item: ITEM }, 201))
    await remote(fetch).create({
      runId: 'run-1',
      idempotencyKey: 'idem-1',
      businessKey: 'bk-1',
      title: 'Preparado',
      evidence: ['oc:505288'],
    })

    const body = bodyOf(calls[0])
    expect(body).not.toHaveProperty('state')
    expect(body).not.toHaveProperty('spaceId')
    expect(body).not.toHaveProperty('payload')
  })

  it('patches the state and the payload with the expected row version', async () => {
    const { calls, fetch } = recorder(() => json({ item: { ...ITEM, rowVersion: 3 } }))
    const client = remote(fetch)

    const updated = await client.update('item-1', { rowVersion: 2, state: 'ITERANDO' })
    await client.update('item-1', { rowVersion: 3, payload: { total: 12 } })

    expect(updated.rowVersion).toBe(3)
    expect(calls[0]?.init.method).toBe('PATCH')
    expect(bodyOf(calls[0])).toEqual({ rowVersion: 2, state: 'ITERANDO' })
    expect(bodyOf(calls[1])).toEqual({ rowVersion: 3, payload: { total: 12 } })
  })

  it('sends the space and the command when the update names them', async () => {
    const { calls, fetch } = recorder(() => json({ item: ITEM }))
    await remote(fetch).update('item-1', {
      rowVersion: 2,
      state: 'APROBADO',
      payload: { severity: 'ALTA' },
      spaceId: 'sp-nuevo',
      command: 'approve',
    })

    expect(bodyOf(calls[0])).toEqual({
      rowVersion: 2,
      state: 'APROBADO',
      payload: { severity: 'ALTA' },
      spaceId: 'sp-nuevo',
      command: 'approve',
    })
  })

  it('appends an event with and without a payload', async () => {
    const { calls, fetch } = recorder(() => json({ event: EVENT }, 201))
    const client = remote(fetch)

    const event = await client.appendEvent('item-1', { command: 'note', payload: { text: 'revisar' } })
    await client.appendEvent('item-1', { command: 'note' })

    expect(event.seq).toBe(1)
    expect(calls[0]?.init.method).toBe('POST')
    expect(bodyOf(calls[0])).toEqual({ command: 'note', payload: { text: 'revisar' } })
    expect(bodyOf(calls[1])).toEqual({ command: 'note' })
  })

  it('surfaces a 409 conflict without retrying', async () => {
    const { calls, fetch } = recorder(() => json({
      code: 'STALE_ROW',
      message: 'el ítem cambió desde que se leyó',
      details: { rowVersion: 3 },
      request_id: 'req-1',
    }, 409))

    const failure = await rejectionOf(remote(fetch).update('item-1', { rowVersion: 1, state: 'ITERANDO' }))

    expect(failure.code).toBe('STALE_ROW')
    expect(failure.status).toBe(409)
    expect(failure.details).toEqual({ rowVersion: 3 })
    expect(failure.requestId).toBe('req-1')
    expect(failure.message).toBe('el ítem cambió desde que se leyó')
    expect(calls).toHaveLength(1)
  })

  it('falls back to the header request id when the body carries none', async () => {
    const { fetch } = recorder(() => json(
      { code: 'NOT_FOUND', message: 'el ítem no existe en este tenant' },
      404,
      { 'x-request-id': 'req-header' },
    ))

    const failure = await rejectionOf(remote(fetch).get('missing'))

    expect(failure.code).toBe('NOT_FOUND')
    expect(failure.status).toBe(404)
    expect(failure.details).toBeNull()
    expect(failure.requestId).toBe('req-header')
  })
})

describe('BoardRemote transport', () => {
  it('times out an exchange that never answers', async () => {
    const fetchImpl: BoardRemoteFetch = () => new Promise<Response>(() => {})

    const failure = await rejectionOf(remote(fetchImpl, { timeoutMs: 20 }).get('item-1'))

    expect(failure.code).toBe('TIMEOUT')
    expect(failure.status).toBeNull()
    expect(failure.details).toEqual({ timeoutMs: 20 })
  })

  it('retries a 503 and returns the next successful answer', async () => {
    let attempt = 0
    const { calls, fetch } = recorder(() => {
      attempt += 1
      return attempt === 1 ? json({ error: 'unavailable' }, 503) : json({ item: ITEM })
    })

    const item = await remote(fetch).get('item-1')

    expect(item.id).toBe('item-1')
    expect(calls).toHaveLength(2)
  })

  it('honors a numeric Retry-After header', async () => {
    let attempt = 0
    const { calls, fetch } = recorder(() => {
      attempt += 1
      return attempt === 1
        ? json({ error: 'slow down' }, 429, { 'retry-after': '0' })
        : json({ item: ITEM })
    })

    await remote(fetch).get('item-1')

    expect(calls).toHaveLength(2)
  })

  it('stops after three attempts and reports the last 504 as unavailable', async () => {
    const { calls, fetch } = recorder(() => new Response('gateway down', { status: 504 }))

    const failure = await rejectionOf(remote(fetch).get('item-1'))

    expect(failure.code).toBe('UNAVAILABLE')
    expect(failure.status).toBe(504)
    expect(failure.message).toBe('the board API answered HTTP 504')
    expect(calls).toHaveLength(3)
  })

  it('never retries a 500', async () => {
    const { calls, fetch } = recorder(() => json({
      code: 'INTERNAL',
      message: 'error interno de la Mesa',
      request_id: 'req-5',
    }, 500))

    const failure = await rejectionOf(remote(fetch).get('item-1'))

    expect(failure.code).toBe('INTERNAL')
    expect(failure.status).toBe(500)
    expect(calls).toHaveLength(1)
  })

  it('reports an undocumented status as UNKNOWN', async () => {
    const { fetch } = recorder(() => new Response('teapot', { status: 418 }))

    const failure = await rejectionOf(remote(fetch).get('item-1'))

    expect(failure.code).toBe('UNKNOWN')
    expect(failure.status).toBe(418)
  })

  it('uses globalThis.fetch when no transport is injected', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ item: ITEM }))
    try {
      const client = new BoardRemote({ baseUrl: 'https://mesa.test/board', actor: ACTOR })

      await expect(client.get('item-1')).resolves.toMatchObject({ id: 'item-1' })
      expect(stub).toHaveBeenCalledTimes(1)
    } finally {
      stub.mockRestore()
    }
  })

  it('reports a transport failure as NETWORK', async () => {
    const refused = await rejectionOf(remote(() => Promise.reject(new TypeError('connection refused'))).get('item-1'))
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the branch under test
    const offline = await rejectionOf(remote(() => Promise.reject('offline')).get('item-1'))

    expect(refused.code).toBe('NETWORK')
    expect(refused.status).toBeNull()
    expect(refused.details).toEqual({ cause: 'connection refused' })
    expect(offline.details).toEqual({ cause: 'offline' })
  })

  it('reports an unreadable body as NETWORK', async () => {
    const fetchImpl: BoardRemoteFetch = async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => { throw new Error('socket reset') },
    }) as unknown as Response

    const failure = await rejectionOf(remote(fetchImpl).get('item-1'))

    expect(failure.code).toBe('NETWORK')
    expect(failure.details).toEqual({ cause: 'socket reset' })
  })

  it('rejects a successful response that is not a JSON object', async () => {
    for (const body of ['', 'not json', '[]', 'null']) {
      const { fetch } = recorder(() => new Response(body, { status: 200 }))
      const failure = await rejectionOf(remote(fetch).get('item-1'))
      expect(failure.code).toBe('INVALID_RESPONSE')
    }
  })

  it('rejects a list body without an items array', async () => {
    const { fetch } = recorder(() => json({ items: {} }))
    const failure = await rejectionOf(remote(fetch).list())
    expect(failure.code).toBe('INVALID_RESPONSE')
  })

  it('rejects an events body without an events array', async () => {
    const { fetch } = recorder(() => json({ events: 'none' }))
    const failure = await rejectionOf(remote(fetch).events('item-1'))
    expect(failure.code).toBe('INVALID_RESPONSE')
  })

  it('rejects an item without the fields the client reads', async () => {
    const variants: unknown[] = [
      null,
      { id: 1 },
      { id: 'item-1' },
      { id: 'item-1', tenantId: 'acme' },
      { id: 'item-1', tenantId: 'acme', state: 'PENDIENTE_CRITERIO' },
    ]
    for (const item of variants) {
      const { fetch } = recorder(() => json({ item }))
      const failure = await rejectionOf(remote(fetch).get('item-1'))
      expect(failure.code).toBe('INVALID_RESPONSE')
    }
  })

  it('rejects an event without the fields the client reads', async () => {
    const variants: unknown[] = [
      null,
      { seq: '1' },
      { seq: 1 },
      { seq: 1, command: 'created' },
    ]
    for (const event of variants) {
      const { fetch } = recorder(() => json({ event }, 201))
      const failure = await rejectionOf(remote(fetch).appendEvent('item-1', { command: 'created' }))
      expect(failure.code).toBe('INVALID_RESPONSE')
    }
  })

  it('refuses a response that belongs to another tenant', async () => {
    const { fetch } = recorder(() => json({ item: { ...ITEM, tenantId: 'otra' } }))

    const failure = await rejectionOf(remote(fetch).get('item-1'))

    expect(failure.code).toBe('TENANT_MISMATCH')
    expect(failure.details).toEqual({ tenantId: 'otra' })
  })
})

describe('BoardRemote configuration', () => {
  it('rejects a base URL the client cannot use', () => {
    const base = { actor: ACTOR }
    expect(configurationError({ ...base, baseUrl: 'not a url' }).code).toBe('CONFIGURATION')
    expect(configurationError({ ...base, baseUrl: 'ftp://mesa.test' }).code).toBe('CONFIGURATION')
    expect(configurationError({ ...base, baseUrl: 'https://mesa.test/board?x=1' }).code).toBe('CONFIGURATION')
    expect(configurationError({ ...base, baseUrl: 'https://mesa.test/board#y' }).code).toBe('CONFIGURATION')
  })

  it('requires a service token and a tenant', () => {
    const baseUrl = 'https://mesa.test/board'
    expect(configurationError({ baseUrl, actor: { ...ACTOR, token: '  ' } }).code).toBe('CONFIGURATION')
    expect(configurationError({ baseUrl, actor: { ...ACTOR, tenantId: '' } }).code).toBe('CONFIGURATION')
  })

  it('requires a positive timeout', () => {
    const failure = configurationError({ baseUrl: 'https://mesa.test/board', actor: ACTOR, timeoutMs: 0 })
    expect(failure.code).toBe('CONFIGURATION')
  })

  it('normalizes the actor tenant before comparing it', async () => {
    const { fetch } = recorder(() => json({ item: ITEM }))
    const client = remote(fetch, { actor: { ...ACTOR, tenantId: ' ACME ' } })

    await expect(client.get('item-1')).resolves.toMatchObject({ id: 'item-1' })
  })
})
