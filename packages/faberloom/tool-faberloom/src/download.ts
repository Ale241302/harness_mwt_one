/**
 * Fetch one sender-supplied mail link for `faberloom_mail_download`.
 *
 * The address rules live in the mail-facing net guard: the host is resolved
 * there, every answer is checked against the private, loopback, link-local,
 * multicast and reserved ranges, and the connection is pinned to the checked
 * address with the original `Host` and TLS server name. A redirect repeats the
 * whole check, and the body is bounded while it streams.
 *
 * @module @deepseek-ai/dsh-tool-faberloom/download
 */

import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fetchPublicResource } from '@deepseek-ai/dsh-faberloom-inbound'
import type { PublicFetchDeps } from '@deepseek-ai/dsh-faberloom-inbound'

export {
  isBlockedAddress,
  publicAddress,
  readLimited,
} from '@deepseek-ai/dsh-faberloom-inbound'
export type { PublicResponse as DownloadResponse, ResolvedAddress } from '@deepseek-ai/dsh-faberloom-inbound'

/** Largest body one mail link may write, in bytes. */
export const MAIL_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024

/** Whole-operation bound, redirects included. */
export const MAIL_DOWNLOAD_TIMEOUT_MS = 30_000

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
  deps: Partial<PublicFetchDeps> = {},
): Promise<{ bytes: Buffer; mediaType: string; finalUrl: string; name: string }> {
  const resource = await fetchPublicResource(raw, {
    maxBytes: MAIL_DOWNLOAD_MAX_BYTES,
    timeoutMs: MAIL_DOWNLOAD_TIMEOUT_MS,
    noun: 'link',
    accept: '*/*',
  }, deps)
  return {
    bytes: resource.bytes,
    mediaType: resource.mediaType,
    finalUrl: resource.finalUrl,
    name: safeDownloadName(nameFromUrl(resource.finalUrl)),
  }
}
