/**
 * Fetch one remote image a message body references, so the sandboxed reader can
 * paint it from a `data:` URL instead of asking the sender's server, or the
 * browser over https, for it.
 *
 * The address rules are the mail guard's: resolve, refuse any private answer,
 * pin the connection, repeat the check on every redirect. The answer must also
 * declare an image type and fit the reader's budget.
 *
 * @module @deepseek-ai/dsh-faberloom-view/email-image
 */

import { fetchPublicResource } from '@deepseek-ai/dsh-faberloom-inbound'
import type { PublicFetchDeps } from '@deepseek-ai/dsh-faberloom-inbound'
import type { FaberLoomEmailImage } from './types.ts'

/** Largest image the mail reader inlines through the Host, in bytes. */
export const EMAIL_IMAGE_MAX_BYTES = 4_000_000

/** Milliseconds the Host waits for one remote image before giving up. */
export const EMAIL_IMAGE_TIMEOUT_MS = 8_000

/** Headers a browser-like image request carries; the request sends no cookies. */
const IMAGE_HEADERS = {
  // Image CDNs commonly answer 403 to a client that sends neither a browser user
  // agent nor a referer.
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
} as const

/**
 * Fetch the bytes of one remote image referenced by a message body.
 * @param source - absolute address the sender's HTML carried.
 * @param deps - network seams; production resolves and sends for real.
 * @returns the image bytes and their declared media type.
 */
export async function fetchEmailImage(
  source: string,
  deps: Partial<PublicFetchDeps> = {},
): Promise<FaberLoomEmailImage> {
  const resource = await fetchPublicResource(source, {
    maxBytes: EMAIL_IMAGE_MAX_BYTES,
    timeoutMs: EMAIL_IMAGE_TIMEOUT_MS,
    noun: 'image',
    accept: 'image/*',
    headers: IMAGE_HEADERS,
  }, deps)
  if (!resource.mediaType.startsWith('image/')) throw new Error('faberloom: the address is not an image')
  if (resource.bytes.byteLength === 0) throw new Error('faberloom: the image is empty')
  return { mediaType: resource.mediaType, dataBase64: resource.bytes.toString('base64') }
}
