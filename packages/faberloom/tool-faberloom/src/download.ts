/**
 * Fetch one sender-supplied mail link for `faberloom_mail_download`.
 *
 * A mail body is untrusted input, so the address is never handed to a fetch
 * client that resolves and connects on its own: the host is resolved here, every
 * address is checked against the private, loopback, link-local, multicast and
 * reserved ranges, and the connection is pinned to the checked address with the
 * original `Host` and TLS server name. A redirect repeats the whole check.
 *
 * The body is bounded while it streams, so a server that never ends or a
 * `content-length` that lies cannot exhaust the process.
 *
 * @module @deepseek-ai/dsh-tool-faberloom/download
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'

/** Largest body one mail link may write, in bytes. */
export const MAIL_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024

/** Whole-operation bound, redirects included. */
export const MAIL_DOWNLOAD_TIMEOUT_MS = 30_000

/** Redirects followed before the chain is refused. */
export const MAIL_DOWNLOAD_MAX_REDIRECTS = 5

/** User agent a browser-like download uses; some CDNs answer 403 without one. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Addresses that must never be reached on behalf of a mail link. */
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
export interface DownloadResponse {
  /** HTTP status. */
  readonly status: number
  /** Response headers. */
  readonly headers: IncomingHttpHeaders
  /** Body stream, bounded by the caller. */
  readonly body: Readable
}

/** Network seams a test replaces; production uses the real resolver and HTTP client. */
export interface DownloadDeps {
  /** Resolve a hostname to every address it answers with. */
  readonly resolve: (hostname: string) => Promise<readonly ResolvedAddress[]>
  /** Open one request pinned to a checked address. */
  readonly send: (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<DownloadResponse>
}

/** Whether an address literal belongs to a range a mail link may not reach. */
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
function httpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('faberloom: the link is not a URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('faberloom: only http(s) links can be downloaded')
  }
  return url
}

/**
 * Resolve a host once and refuse the request when any answer is private.
 * Checking every answer, not only the first, keeps a DNS answer set from hiding
 * a loopback entry behind a public one.
 * @param hostname - host to resolve.
 * @param resolve - resolver seam; production uses the system resolver.
 * @returns the checked address the connection is pinned to.
 */
export async function publicAddress(
  hostname: string,
  resolve: DownloadDeps['resolve'] = hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }),
): Promise<ResolvedAddress> {
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw new Error('faberloom: the link points at a private address')
    return { address: hostname, family: isIP(hostname) }
  }
  const answers = await resolve(hostname)
  if (answers.length === 0) throw new Error('faberloom: the link host did not resolve')
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) throw new Error('faberloom: the link host resolves to a private address')
  }
  const first = answers[0]
  if (first === undefined) throw new Error('faberloom: the link host did not resolve')
  return first
}

/**
 * Read a body, refusing the moment it passes the bound.
 * @param body - response stream.
 * @param max - largest accepted byte count.
 * @returns the complete body.
 */
export async function readLimited(body: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += bytes.length
    if (total > max) {
      body.destroy()
      throw new Error(`faberloom: the link answered more than ${String(max)} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

/** Open one request whose socket goes to the checked address, not to a fresh DNS answer. */
function sendPinned(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<DownloadResponse> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const request = send(url, {
      method: 'GET',
      signal,
      headers: { accept: '*/*', 'user-agent': USER_AGENT },
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

/** A file name safe to join under the download folder. */
export function safeDownloadName(value: string): string {
  const name = basename(value.replace(/\\/gu, '/'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/^\.+$/u, '')
    .trim()
  if (name.length === 0) return 'descarga'
  return name.length > 120 ? name.slice(0, 120) : name
}

/**
 * Write a download under a free name. `wx` refuses any existing entry, so a
 * pre-placed symlink in the folder can never be followed or overwritten.
 * @param dir - existing download folder.
 * @param name - sanitized file name.
 * @param bytes - body to write.
 * @returns the path written.
 */
export function writeUniqueFile(dir: string, name: string, bytes: Buffer): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = join(dir, attempt === 1 ? name : `${stem} (${String(attempt)})${extension}`)
    try {
      writeFileSync(candidate, bytes, { flag: 'wx' })
      return candidate
    } catch (error: unknown) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('faberloom: no free file name was available for the download')
}

/** The last path segment of a URL, decoded when possible. */
function nameFromUrl(href: string): string {
  try {
    return decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).pop() ?? '')
  } catch {
    return ''
  }
}

/**
 * Download one mail link under the public-address and size rules.
 * @param raw - absolute http(s) link from a message body.
 * @param deps - network seams; production resolves and sends for real.
 * @returns the bounded body, its media type, and the address that answered.
 */
export async function downloadMailLink(
  raw: string,
  deps: Partial<DownloadDeps> = {},
): Promise<{ bytes: Buffer; mediaType: string; finalUrl: string; name: string }> {
  const resolve = deps.resolve ?? (hostname => dnsLookup(hostname, { all: true, order: 'verbatim' }))
  const send = deps.send ?? sendPinned
  let url = httpUrl(raw)
  for (let hop = 0; hop <= MAIL_DOWNLOAD_MAX_REDIRECTS; hop += 1) {
    const address = await publicAddress(url.hostname, resolve)
    const response = await send(url, address, AbortSignal.timeout(MAIL_DOWNLOAD_TIMEOUT_MS))
    if (response.status >= 300 && response.status < 400) {
      const location = header(response.headers, 'location')
      response.body.destroy()
      if (location === undefined) throw new Error('faberloom: the link redirects without a destination')
      url = httpUrl(new URL(location, url).href)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      response.body.destroy()
      throw new Error(`faberloom: the link answered HTTP ${String(response.status)}`)
    }
    const declared = Number(header(response.headers, 'content-length'))
    if (Number.isFinite(declared) && declared > MAIL_DOWNLOAD_MAX_BYTES) {
      response.body.destroy()
      throw new Error(`faberloom: the link answered more than ${String(MAIL_DOWNLOAD_MAX_BYTES)} bytes`)
    }
    const bytes = await readLimited(response.body, MAIL_DOWNLOAD_MAX_BYTES)
    const mediaType = (header(response.headers, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    return {
      bytes,
      mediaType: mediaType === undefined || mediaType.length === 0 ? 'application/octet-stream' : mediaType,
      finalUrl: url.href,
      name: safeDownloadName(nameFromUrl(url.href)),
    }
  }
  throw new Error('faberloom: the link redirects too many times')
}
