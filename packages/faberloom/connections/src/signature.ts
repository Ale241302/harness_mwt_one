/**
 * HTML side of outgoing mail: the sanitizer both consumers pass through (the
 * stored signature body and a draft's authored body), and the composition rule
 * that turns a draft's plain text plus its stored signature into the message's
 * HTML alternative.
 *
 * The plain-text part is always what the owner approved in the editor. The HTML
 * part exists only when the draft's body still ends with the stored plain-text
 * signature, so an edited body never ships HTML that contradicts it; a draft
 * that carries authored markup sends that markup directly instead.
 */

/** Longest stored HTML signature, in characters; the editor messages above this. */
export const SIGNATURE_HTML_MAX_CHARS = 64_000

/** Longest authored draft HTML, in characters; the editor messages above this. */
export const DRAFT_HTML_MAX_CHARS = 256_000

/** Inline images a signature may carry; each is capped by the caller. */
export const SIGNATURE_INLINE_IMAGE_LIMIT = 800_000

const HTML_ENTITIES: readonly [RegExp, string][] = [
  [/&nbsp;/gu, ' '],
  [/&amp;/gu, '&'],
  [/&lt;/gu, '<'],
  [/&gt;/gu, '>'],
  [/&quot;/gu, '"'],
  [/&#39;/gu, "'"],
]

/** Escape text for one HTML text node. */
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * Remove the constructs an outgoing mail body must never carry: scripts,
 * embedded documents, event-handler attributes, and non-image `data:`/script
 * URLs. Styling stays, because both bodies are presented by name and colour.
 * @param raw - owner-written HTML.
 * @param maxChars - ceiling in characters; the signature and draft bodies each
 *   pass their own.
 * @returns safe markup within `maxChars`.
 */
export function sanitizeMailHtml(raw: string, maxChars: number = SIGNATURE_HTML_MAX_CHARS): string {
  const withoutElements = raw
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<script\b[^>]*>/giu, '')
    .replace(/<(iframe|object|embed|link|meta|base|form)\b[^>]*>/giu, '')
    .replace(/<\/(iframe|object|embed|link|meta|base|form)\s*>/giu, '')
  const withoutHandlers = withoutElements.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
  const withoutScriptUrls = withoutHandlers
    .replace(/\b(href|src|action|formaction)\s*=\s*"\s*(?:javascript|vbscript|data:text\/html)[^"]*"/giu, '')
    .replace(/\b(href|src|action|formaction)\s*=\s*'\s*(?:javascript|vbscript|data:text\/html)[^']*'/giu, '')
  return withoutScriptUrls.replace(/<([a-z][a-z0-9]*)\s+>/giu, '<$1>').trim().slice(0, maxChars)
}

/**
 * Readable plain text for an HTML body: the fallback the plain-text part uses
 * when the owner wrote only HTML. Line breaks follow the block-level tags.
 * @param html - sanitized markup.
 * @returns the text a plain-text client reads.
 */
export function plainTextFromHtml(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
  return HTML_ENTITIES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), withBreaks)
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

/**
 * Build the message's HTML alternative from the approved plain text and the
 * account's signature.
 * @param text - the draft body exactly as the owner approved it.
 * @param signature - the stored signature for the sending account.
 * @returns the HTML part, or null when the body no longer carries the stored
 * signature and the message therefore stays plain text.
 */
export function messageHtml(
  text: string,
  signature: { readonly text: string; readonly html: string },
): string | null {
  const html = sanitizeMailHtml(signature.html)
  if (html.length === 0) return null
  const body = text.replace(/\r\n/gu, '\n')
  const plain = signature.text.replace(/\r\n/gu, '\n').trim()
  if (plain.length === 0) return null
  const trimmed = body.replace(/\s+$/u, '')
  if (!trimmed.endsWith(plain)) return null
  const written = trimmed.slice(0, trimmed.length - plain.length).replace(/\s+$/u, '')
  const paragraphs = written.length === 0
    ? ''
    : written.split(/\n{2,}/u).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/gu, '<br>')}</p>`).join('')
  return `<div>${paragraphs}${html}</div>`
}

/** One inline image lifted out of a `data:` URL. */
export interface InlineImage {
  /** Content id the HTML references as `cid:<id>`. */
  readonly id: string
  /** Image media type. */
  readonly mediaType: string
  /** Base64 payload without line breaks. */
  readonly contentBase64: string
}

/**
 * Move `data:image/*` sources out of the markup and into related MIME parts,
 * because several clients drop `data:` URLs. An image larger than the limit
 * stays a `data:` URL: inlining it would exceed the message budget.
 * @param html - the HTML alternative.
 * @param makeId - mints one content id per image.
 * @returns the rewritten HTML and the images to send beside it.
 */
export function extractInlineImages(
  html: string,
  makeId: () => string,
): { readonly html: string; readonly images: readonly InlineImage[] } {
  const images: InlineImage[] = []
  const rewritten = html.replace(
    /\bsrc\s*=\s*(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)\1/giu,
    (match, quote: string, mediaType: string, payload: string) => {
      const contentBase64 = payload.replace(/\s/gu, '')
      if (contentBase64.length > SIGNATURE_INLINE_IMAGE_LIMIT) return match
      const id = makeId()
      images.push({ id, mediaType: mediaType.toLowerCase(), contentBase64 })
      return `src=${quote}cid:${id}${quote}`
    },
  )
  return { html: rewritten, images }
}
