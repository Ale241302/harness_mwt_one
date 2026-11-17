/**
 * Email HTML is data, never a document with authority.
 *
 * The reader paints sender HTML in a sandboxed frame. The sandbox already stops
 * scripts, forms and top-level navigation, but it does not stop the frame from
 * *fetching* remote images, styles, fonts or nested frames, and it lets an anchor
 * navigate the frame itself. This module makes the document inert before it is
 * handed to `srcDoc`: interactive elements and handlers are gone, only inlined
 * `data:` images survive, links lose their destination, and a Content-Security
 * Policy inside the document blocks every other request.
 */

/** What the frame may still load: the images already inlined as `data:` URLs. */
const EMAIL_CSP = [
  "default-src 'none'",
  'img-src data:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  'media-src data:',
  "frame-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** Elements that can act, load a plugin, or replace the document. */
const REMOVED_ELEMENTS = new Set([
  'script', 'base', 'link', 'object', 'embed', 'iframe', 'frame', 'frameset',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup',
  'video', 'audio', 'source', 'track', 'applet',
])

/** Attributes that carry an action or a second document. */
const REMOVED_ATTRIBUTES = new Set([
  'srcdoc', 'formaction', 'action', 'target', 'ping', 'background',
])

/**
 * Whether a URL is an inlined resource the frame may keep.
 * @param value - `src` or `srcset` value from the sender's HTML.
 * @returns whether it is a `data:` URL.
 */
function isInlineUrl(value: string): boolean {
  return /^\s*data:/iu.test(value)
}

/**
 * Make one sender document inert.
 *
 * Parsing and serializing keeps legitimate markup (tables, inline styles,
 * inlined images) while removing everything that can act or reach the network.
 * @param html - the sender's HTML, already carrying inlined `cid:` images.
 * @returns a document safe to hand to a sandboxed `srcdoc`.
 */
export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const element of [...doc.documentElement.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase()
    if (tag === 'html' || tag === 'head' || tag === 'body') continue
    if (tag === 'meta' && element.getAttribute('http-equiv')?.toLowerCase() === 'refresh') {
      element.remove()
      continue
    }
    if (REMOVED_ELEMENTS.has(tag)) {
      element.remove()
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || REMOVED_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'src' || name === 'srcset' || name === 'poster') && !isInlineUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
      if (name === 'href' && !attribute.value.trim().startsWith('#')) {
        // A link may not navigate the frame to a page the policy did not allow.
        element.removeAttribute('href')
      }
    }
  }
  const head = doc.head
  const policy = doc.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', EMAIL_CSP)
  head.prepend(policy)
  const charset = doc.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  head.prepend(charset)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}
