/**
 * Fetch one resource a message body references, under the public-address rule.
 *
 * Mail is untrusted input, so neither a link the owner may download nor an image
 * the reader paints is handed to a client that resolves and connects on its own:
 * the host is resolved here, every answer is checked against the private,
 * loopback, link-local, multicast and reserved ranges, and the connection is
 * pinned to the checked address with the original `Host` and TLS server name. A
 * redirect repeats the whole check.
 *
 * One call keeps one deadline and one byte budget for the entire chain, so a
 * server that never ends, a lying `content-length`, or a redirect loop cannot
 * outlast the caller.
 *
 * @module @deepseek-ai/dsh-faberloom-inbound/net-guard
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'

/** Redirects followed before the chain is refused. */
export const PUBLIC_RESOURCE_MAX_REDIRECTS = 5

/** User agent a browser-like fetch uses; some CDNs answer 403 without one. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Addresses that must never be reached on behalf of a message. */
const BLOCKED = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6')
}

/** One address the resolver answered with. */
export interface ResolvedAddress {
  /** Literal IPv4 or IPv6 address. */
  readonly address: string
  /** IP family, as `dns.lookup` reports it. */
  readonly family: number
}

/** A response head, before its body is read. */
export interface PublicResponse {
  /** HTTP status. */
  readonly status: number
  /** Response headers. */
  readonly headers: IncomingHttpHeaders
  /** Body stream, bounded by the caller. */
  readonly body: Readable
}

/** Network seams a test replaces; production uses the real resolver and HTTP client. */
export interface PublicFetchDeps {
  /** Resolve a hostname to every address it answers with. */
  readonly resolve: (hostname: string) => Promise<readonly ResolvedAddress[]>
  /** Open one request pinned to a checked address. */
  readonly send: (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<PublicResponse>
}

/** What one public fetch returns. */
export interface PublicResource {
  /** Body bytes, never above the caller's bound. */
  readonly bytes: Buffer
  /** Declared media type, lowercased, or `application/octet-stream`. */
  readonly mediaType: string
  /** Address the last hop ended on, redirects included. */
  readonly finalUrl: string
}

/** Caller-supplied limits and wording. */
export interface PublicFetchOptions {
  /** Largest accepted body, in bytes. */
  readonly maxBytes: number
  /** Whole-operation bound, redirects included. */
  readonly timeoutMs: number
  /** Noun used in refusal messages: `link`, `image`. */
  readonly noun: string
  /** Accept header value. */
  readonly accept: string
  /** Extra request headers. */
  readonly headers?: Readonly<Record<string, string>>
  /** Redirects followed before the chain is refused. */
  readonly maxRedirects?: number
}

/** Whether an address literal belongs to a range a message may not reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  if (family === 6) {
    // An IPv4-mapped literal inherits the IPv4 verdict; Node's BlockList would
    // match the whole mapped range against every IPv4 address.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address)
    if (mapped?.[1] !== undefined) return isBlockedAddress(mapped[1])
    return BLOCKED.check(address, 'ipv6')
  }
  return BLOCKED.check(address, 'ipv4')
}

/** Parse an absolute http(s) address or refuse it. */
export function publicUrl(raw: string, noun: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`faberloom: the ${noun} is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`faberloom: only http(s) ${noun}s are allowed`)
  }
  return url
}

/**
 * Resolve a host once and refuse the request when any answer is private.
 * Checking every answer, not only the first, keeps a DNS answer set from hiding
 * a loopback entry behind a public one.
 * @param hostname - host to resolve.
 * @param resolve - resolver seam; production uses the system resolver.
 * @param noun - noun used in refusal messages.
 * @returns the checked address the connection is pinned to.
 */
export async function publicAddress(
  hostname: string,
  resolve: PublicFetchDeps['resolve'] = hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }),
  noun = 'link',
): Promise<ResolvedAddress> {
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw new Error(`faberloom: the ${noun} points at a private address`)
    return { address: hostname, family: isIP(hostname) }
  }
  const answers = await resolve(hostname)
  if (answers.length === 0) throw new Error(`faberloom: the ${noun} host did not resolve`)
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) throw new Error(`faberloom: the ${noun} host resolves to a private address`)
  }
  const first = answers[0]
  if (first === undefined) throw new Error(`faberloom: the ${noun} host did not resolve`)
  return first
}

/**
 * Read a body, refusing the moment it passes the bound.
 * @param body - response stream.
 * @param max - largest accepted byte count.
 * @param noun - noun used in refusal messages.
 * @returns the complete body.
 */
export async function readLimited(body: Readable, max: number, noun = 'link'): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += bytes.length
    if (total > max) {
      body.destroy()
      throw new Error(`faberloom: the ${noun} answered more than ${String(max)} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

/** Open one request whose socket goes to the checked address, not to a fresh DNS answer. */
function sendPinned(
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
  accept: string,
  extra: Readonly<Record<string, string>>,
): Promise<PublicResponse> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = send(url, {
      method: 'GET',
      signal,
      headers: { accept, 'user-agent': USER_AGENT, ...extra },
      lookup: (_hostname, _options, callback) => {
        callback(null, address.address, address.family)
      },
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response })
    })
    request.on('error', reject)
    request.end()
  })
}

/** One header value as a string, or undefined. */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Fetch one message-referenced http(s) resource under the public-address and size
 * rules.
 * @param raw - absolute http(s) address taken from a message.
 * @param options - limits, accept header and refusal wording.
 * @param deps - network seams; production resolves and sends for real.
 * @returns the bounded body, its media type, and the address the chain ended on.
 */
export async function fetchPublicResource(
  raw: string,
  options: PublicFetchOptions,
  deps: Partial<PublicFetchDeps> = {},
): Promise<PublicResource> {
  const noun = options.noun
  const resolve = deps.resolve ?? (hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }))
  const send = deps.send ?? ((url, address, signal) => sendPinned(url, address, signal, options.accept, options.headers ?? {}))
  const maxRedirects = options.maxRedirects ?? PUBLIC_RESOURCE_MAX_REDIRECTS
  const deadline = AbortSignal.timeout(options.timeoutMs)
  let url = publicUrl(raw, noun)
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const address = await publicAddress(url.hostname, resolve, noun)
    const response = await send(url, address, deadline)
    if (response.status >= 300 && response.status < 400) {
      const location = header(response.headers, 'location')
      response.body.destroy()
      if (location === undefined) throw new Error(`faberloom: the ${noun} redirects without a destination`)
      url = publicUrl(new URL(location, url).href, noun)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      response.body.destroy()
      throw new Error(`faberloom: the ${noun} answered HTTP ${String(response.status)}`)
    }
    const declared = Number(header(response.headers, 'content-length'))
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      response.body.destroy()
      throw new Error(`faberloom: the ${noun} answered more than ${String(options.maxBytes)} bytes`)
    }
    const bytes = await readLimited(response.body, options.maxBytes, noun)
    const mediaType = (header(response.headers, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    return {
      bytes,
      mediaType: mediaType === undefined || mediaType.length === 0 ? 'application/octet-stream' : mediaType,
      finalUrl: url.href,
    }
  }
  throw new Error(`faberloom: the ${noun} redirects too many times`)
}
