/**
 * Markup for the parts of a message the composer assembles itself: the body of
 * a plain-text draft, the quote a reply answers, and the block a forward carries.
 *
 * The strings here are sent as the `text/html` alternative, so they use inline
 * styles that mail clients keep (the panel's own CSS tokens do not travel) and
 * escape every value that comes from a message. The plain-text part stays the
 * editor's own text, which the body editor emits beside the markup.
 *
 * @module @deepseek-ai/dsh-client-ui-faberloom/mail-compose-html
 */

/** Escaping for one text node or attribute value. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Paragraphs a text body carries, blank lines separating them. */
function paragraphs(text: string): string {
  return text
    .replace(/\r\n/gu, '\n')
    .split(/\n{2,}/u)
    .filter(paragraph => paragraph.trim().length > 0)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/gu, '<br>')}</p>`)
    .join('')
}

/** The quotation styling every client keeps: a left rule and muted text. */
const QUOTE_STYLE = 'margin:0 0 0 12px;padding-left:12px;border-left:2px solid #d4d4d4;color:#4a4a4a'

/**
 * One plain-text body as markup, so an opened draft that has no markup keeps its
 * line breaks once the body editor shows it.
 * @param text - the stored plain text.
 * @returns escaped paragraphs, or the empty string for an empty body.
 */
export function textHtml(text: string): string {
  return paragraphs(text)
}

/**
 * The quote a reply carries: who wrote the message and when, then its text.
 * @param attribution - the localized attribution line, for example `El 20 nov, Ana escribió:`.
 * @param text - the answered message's plain text.
 * @returns the attribution paragraph plus the quoted body.
 */
export function replyQuoteHtml(attribution: string, text: string): string {
  return `<p>${escapeHtml(attribution)}</p><blockquote style="${QUOTE_STYLE}">${paragraphs(text)}</blockquote>`
}

/**
 * The block a forward carries: the localized header, the message's envelope and
 * its text, so the recipient can see where it came from.
 * @param header - the localized line that opens a forwarded message.
 * @param fields - the envelope lines, in the order the editor shows them.
 * @param text - the forwarded message's plain text.
 * @returns the header, the envelope and the quoted body.
 */
export function forwardQuoteHtml(
  header: string,
  fields: readonly string[],
  text: string,
): string {
  const envelope = fields.filter(field => field.trim().length > 0).map(field => escapeHtml(field)).join('<br>')
  return `<p>${escapeHtml(header)}</p>${envelope.length === 0 ? '' : `<p>${envelope}</p>`}<blockquote style="${QUOTE_STYLE}">${paragraphs(text)}</blockquote>`
}
