/**
 * OpenAI-compatible provider double for the per-agent routing specs: a local
 * HTTP endpoint that records the `Authorization` header and body of every
 * `/v1/chat/completions` request, plus the adapter the harness registers to
 * reach it. The endpoint is the external provider the routing seam must select;
 * the adapter only performs the wire exchange, authenticating with the
 * credential reference the request resolved.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders, LlmAdapter, LlmError, providerAccountFailureCode, providerFailureMessage, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** One scripted provider reply, consumed in order by the next request. */
export type StubReply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'http-error'; readonly status: number; readonly body: unknown }

/** One request the endpoint received, as the routing spec asserts on it. */
export interface StubRequest {
  /** `Authorization` header exactly as sent, when the request carried one. */
  readonly authorization: string | undefined
  /** Parsed JSON body. */
  readonly body: { readonly model?: string; readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[] }
}

/** A running provider endpoint and everything the spec needs to inspect it. */
export interface ProviderStub {
  /** Origin the adapter points its route at. */
  readonly url: string
  /** Requests received so far, oldest first. */
  readonly requests: StubRequest[]
  /** Replies remaining for later requests; a request past the script gets HTTP 500. */
  readonly script: StubReply[]
  /** Stop the endpoint and release its port. */
  close(): Promise<void>
}

const servers: Server[] = []

/** Stop every endpoint opened since the last call; run from a spec's afterEach. */
export async function closeProviderStubs(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
}

/** Render one message's text blocks into the OpenAI-compatible content string. */
function wireContent(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('')
}

/** Map assembled harness messages onto the provider's `messages` array. */
function wireMessages(messages: readonly Message[]): readonly { role: string; content: string }[] {
  return messages.map(message => ({ role: message.role, content: wireContent(message.content) }))
}

/** Parse one OpenAI-compatible SSE body into the harness stream protocol. */
function parseSse(body: string): StreamChunk[] {
  const chunks: StreamChunk[] = []
  let started = false
  let text = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finishReason: string | undefined
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trim()
    if (payload === '' || payload === '[DONE]') continue
    const parsed = JSON.parse(payload) as {
      readonly choices?: readonly { readonly delta?: { readonly content?: string }; readonly finish_reason?: string }[]
      readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number }
    }
    const choice = parsed.choices?.[0]
    const delta = choice?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      if (!started) {
        chunks.push({ type: 'block-start', index: 0, blockType: 'text' })
        started = true
      }
      text += delta
      chunks.push({ type: 'text-delta', index: 0, text: delta })
    }
    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason
    if (parsed.usage !== undefined) {
      usage = { inputTokens: parsed.usage.prompt_tokens ?? 0, outputTokens: parsed.usage.completion_tokens ?? 0 }
    }
  }
  if (started) chunks.push({ type: 'block-end', index: 0, block: { type: 'text', text } })
  if (usage !== undefined) chunks.push({ type: 'usage', usage })
  chunks.push({ type: 'finish', reason: finishReason === 'length' ? { kind: 'max-tokens' } : { kind: 'stop' } })
  return chunks
}

/**
 * Start one provider endpoint that replays the scripted replies in order.
 * @param script - replies consumed by the next requests; an exhausted script answers HTTP 500.
 * @returns the origin to point a route at, and the request recorder.
 */
export async function providerStub(script: StubReply[]): Promise<ProviderStub> {
  const requests: StubRequest[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      requests.push({
        authorization: request.headers.authorization,
        body: raw.length === 0 ? {} : JSON.parse(raw) as StubRequest['body'],
      })
      const reply = script.shift()
      if (reply === undefined) {
        response.writeHead(500, { 'content-type': 'text/plain' }).end('provider stub script exhausted')
        return
      }
      if (reply.kind === 'http-error') {
        response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body))
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write([
        `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: reply.text } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: reply.text.length } })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''))
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the provider stub has no port')
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    script,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

/** One provider route the double serves, with its endpoint and fallback key reference. */
export interface StubRoute {
  /** Registered provider route id the plane or session default names. */
  readonly provider: string
  /** Endpoint origin of the stub this route talks to. */
  readonly baseURL: string
  /** Route-owned credential reference; absent means only a per-call reference can authenticate the call. */
  readonly ownCredentialRef?: CredentialRef
}

/**
 * One outgoing exchange the adapter performed, recorded for a live spec's
 * evidence: which provider route the request selected, the origin it reached,
 * the model it named, and the `Authorization` header it carried. The header
 * holds the raw key, so a recorder keeps it in memory and never prints it.
 */
export interface ProviderCall {
  /** Registered provider route id the request selected. */
  readonly provider: string
  /** Full endpoint URL the request reached. */
  readonly url: string
  /** Model id the request body named. */
  readonly model: string
  /** `Authorization` header exactly as sent. */
  readonly authorization: string
}

/**
 * Translate one provider HTTP failure into the harness taxonomy, so a
 * credit-exhaustion body reaches the session as its typed outcome.
 * @param provider - the route that answered.
 * @param status - HTTP status of the failure.
 * @param body - response body text.
 * @returns the typed error the adapter throws.
 */
function providerFailure(provider: string, status: number, body: string): LlmError {
  let message = body
  let detail = body
  try {
    const parsed = JSON.parse(body) as { readonly error?: { readonly message?: unknown; readonly code?: unknown; readonly type?: unknown } }
    const error = parsed.error
    if (typeof error?.message === 'string') message = error.message
    detail = `${typeof error?.code === 'string' ? error.code : ''} ${typeof error?.type === 'string' ? error.type : ''} ${message}`
  } catch {
    // A non-JSON provider body keeps its raw text as the failure message.
  }
  const code = providerAccountFailureCode(status, detail) ?? (status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR')
  const text = code === 'AUTH' || code === QUOTA_EXCEEDED_CODE ? providerFailureMessage(provider, message) : message
  return new LlmError(text, code, { status })
}

/**
 * Adapter for {@link StubRoute}s: it resolves the request's credential
 * reference through the credential seam (or the route's own reference) and
 * performs the real `/v1/chat/completions` exchange.
 */
export class StubProviderAdapter extends LlmAdapter {
  /**
   * @param ctx - context owning the credential seam the adapter resolves keys through.
   * @param routes - every provider route this instance serves.
   * @param record - optional recorder of each exchange, for a live spec's evidence.
   */
  constructor(
    private readonly ctx: Context,
    private readonly routes: readonly StubRoute[],
    private readonly record?: (call: ProviderCall) => void,
  ) {
    super()
  }

  /**
   * Resolve the key one request authenticates with: the per-call reference when
   * the request carries one, otherwise the route's own reference.
   * @param route - the route being called.
   * @param ref - the resolved credential reference, or `undefined`.
   * @returns the raw key value.
   */
  private async apiKey(route: StubRoute, ref: CredentialRef | undefined): Promise<string> {
    if (ref === undefined) {
      throw new LlmError(`stub: provider route "${route.provider}" needs a credential reference`, 'MISSING_CREDENTIAL')
    }
    const hit = await this.ctx.get('credentials')?.resolve(ref)
    const value = hit?.value ?? process.env[ref]
    if (value === undefined || value.length === 0) {
      throw new LlmError(`stub: no API key for provider route "${route.provider}" at ${ref}`, 'MISSING_CREDENTIAL')
    }
    return value
  }

  /**
   * Perform one exchange against the route's stub endpoint.
   * @param options - the fully assembled request.
   * @returns the provider's stream translated to harness chunks.
   */
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const route = this.routes.find(candidate => candidate.provider === options.provider)
    if (route === undefined) throw new LlmError(`stub: no route for provider "${options.provider}"`, 'NO_ADAPTER')
    const key = await this.apiKey(route, options.credentialRef ?? route.ownCredentialRef)
    const url = `${route.baseURL}/v1/chat/completions`
    const authorization = `Bearer ${key}`
    this.record?.({ provider: options.provider, url, model: options.model, authorization })
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...attributionHeaders(), 'content-type': 'application/json', authorization },
      body: JSON.stringify({ model: options.model, messages: wireMessages(options.messages), stream: true }),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
    const text = await response.text()
    if (!response.ok) throw providerFailure(options.provider, response.status, text)
    yield * parseSse(text)
  }
}

/** The shape a function plugin needs to register one provider double. */
export interface StubProviderPlugin {
  /** Plugin name reported by the Loader. */
  readonly name: string
  /** The `llm` service the adapter registers against. */
  readonly inject: readonly string[]
  /** Register the adapter for every configured route. */
  readonly apply: (ctx: Context) => void
}

/**
 * Build the function plugin that registers {@link StubProviderAdapter}.
 * @param routes - provider routes the adapter serves.
 * @param record - optional recorder of each exchange, forwarded from the adapter.
 * @returns a Loader-loadable plugin object.
 */
export function stubProviderPlugin(routes: readonly StubRoute[], record?: (call: ProviderCall) => void): StubProviderPlugin {
  return {
    name: 'test-faberloom-routing-provider',
    inject: ['llm'],
    apply: (ctx: Context): void => {
      const adapter = new StubProviderAdapter(ctx, routes, record)
      ctx.llm.registerAdapter(routes.map(route => route.provider), adapter)
    },
  }
}
