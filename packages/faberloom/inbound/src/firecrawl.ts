/**
 * Hosted OCR for images: post one picture to Firecrawl Parse and return the
 * Markdown it reads from it. The external `anydoc` converter reads no images, so
 * an image goes through the same Parse request the converter's hosted branch
 * builds: `POST {apiUrl}/v2/parse`, one `options` part naming the image parser
 * and carrying an origin, one `file` part carrying the picture under its
 * original name and media type, and the JSON envelope
 * `{ success, data: { markdown } }` back.
 *
 * A picture sent here leaves the deployment for Firecrawl's infrastructure.
 * Local OCR ({@link ocrImage}) is the path that stays on this machine; a
 * deployment that selects `ocr: 'hosted'` trades that for the hosted models.
 * @module
 */

/**
 * Firecrawl's public API, used when neither the caller nor
 * `FABERLOOM_FIRECRAWL_API_URL` names another base URL.
 */
const API_URL = 'https://api.firecrawl.dev'

/**
 * Value of the `options.origin` field, so Firecrawl attributes the call to this
 * package. anydoc sends its own package name and version here.
 */
const ORIGIN = 'faberloom-inbound'

/**
 * Wall-clock bound for one Parse call. Above Firecrawl's own 30 s default so a
 * slow picture returns the service's answer instead of a local abort.
 */
const TIMEOUT_MS = 60_000

/** Why one image did not come back as Markdown from Firecrawl Parse. */
export type FirecrawlParseFailure =
  /** Neither the caller's options nor `FIRECRAWL_API_KEY` carried a key. */
  | 'no-key'
  /** Parse rejected the key. */
  | 'unauthorized'
  /** The account behind the key is out of credits. */
  | 'insufficient-credits'
  /** Parse answered with a server error. */
  | 'server'
  /** The body was not the JSON envelope the endpoint documents. */
  | 'invalid-json'
  /** The call exceeded its wall-clock bound. */
  | 'timeout'
  /** Parse succeeded but the envelope carried no Markdown. */
  | 'empty'
  /** Any other refusal: another HTTP status, `success: false`, or no response. */
  | 'request-failed'

/** A Firecrawl Parse attempt for an image that produced no Markdown. */
export class FirecrawlParseError extends Error {
  /** Stable reason callers branch on; the message is for logs only. */
  readonly reason: FirecrawlParseFailure

  /**
   * @param reason - stable reason this attempt produced no Markdown.
   * @param message - human-readable detail, without the key.
   * @param options - the underlying failure, kept as the error's cause.
   */
  constructor(reason: FirecrawlParseFailure, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FirecrawlParseError'
    this.reason = reason
  }
}

/** Everything one hosted OCR call needs beyond the image. */
export interface HostedOcrOptions {
  /** Firecrawl API key; empty or absent falls back to `FIRECRAWL_API_KEY`. */
  readonly apiKey?: string
  /** Base URL of the API; absent falls back to `FABERLOOM_FIRECRAWL_API_URL`, then the public API. */
  readonly apiUrl?: string
  /** Wall-clock bound for the call; defaults to 60 s. */
  readonly timeoutMs?: number
}

/**
 * Read one image with Firecrawl Parse.
 * @param bytes - the image file's bytes, sent as the `file` part.
 * @param name - the original file name, sent as the part's filename.
 * @param mediaType - the image media type, sent as the part's content type.
 * @param options - the key, the base URL, and the call's time bound.
 * @returns the Markdown Parse read from the picture, ending in a newline.
 * @throws FirecrawlParseError when no key is available, the call times out or
 * cannot reach the API, HTTP answers 401/402/5xx or another non-2xx status,
 * the body is not the documented JSON envelope, or it carries no text.
 */
export async function ocrImageHosted(
  bytes: Uint8Array,
  name: string,
  mediaType: string,
  options: HostedOcrOptions = {},
): Promise<string> {
  const supplied = options.apiKey?.trim() ?? ''
  const apiKey = supplied.length > 0 ? supplied : (process.env.FIRECRAWL_API_KEY ?? '').trim()
  if (apiKey.length === 0) {
    throw new FirecrawlParseError(
      'no-key',
      'Firecrawl Parse needs an API key: set FIRECRAWL_API_KEY or pass one in the plugin config',
    )
  }
  // The image parser takes no options, and a parser list turns off every
  // parser it leaves out, so the image parser is named alone. anydoc only ever
  // sends the PDF parser; the `image` type is Firecrawl's own parser name.
  const optionsPart = { parsers: [{ type: 'image' }], origin: ORIGIN }
  const body = new FormData()
  body.append('options', JSON.stringify(optionsPart))
  body.append('file', new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }), name)
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(parseUrl(options.apiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal,
    })
  } catch (error) {
    // Nothing else can abort this signal, so an aborted one means the picture
    // did not come back in time; every other rejection is the transport.
    throw new FirecrawlParseError(
      signal.aborted ? 'timeout' : 'request-failed',
      signal.aborted
        ? `Firecrawl Parse did not answer within ${String(timeoutMs)} ms`
        : `Firecrawl Parse could not be reached: ${String(error)}`,
      { cause: error },
    )
  }
  // A body that does not parse is reported by the status when the status
  // failed, and as invalid JSON when it did not.
  const reply: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = errorDetail(reply)
    throw new FirecrawlParseError(
      failureFor(response.status),
      `Firecrawl Parse rejected the image (HTTP ${String(response.status)})${detail === undefined ? '' : `: ${detail}`}`,
    )
  }
  if (typeof reply !== 'object' || reply === null) {
    throw new FirecrawlParseError(
      'invalid-json',
      `Firecrawl Parse answered HTTP ${String(response.status)} with a body that is not its JSON envelope`,
    )
  }
  if ((reply as { success?: unknown }).success === false) {
    const detail = errorDetail(reply)
    throw new FirecrawlParseError(
      'request-failed',
      `Firecrawl Parse refused the image${detail === undefined ? '' : `: ${detail}`}`,
    )
  }
  const markdown = (reply as { data?: { markdown?: unknown } }).data?.markdown
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    throw new FirecrawlParseError('empty', 'Firecrawl Parse returned no Markdown for the image')
  }
  // The converter's Markdown ends in a newline; match it so a caller that
  // appends sections does not join them to the last line.
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`
}

/**
 * Resolve the Parse endpoint for one call.
 * @param apiUrl - the caller's base URL, when it named one.
 * @returns the absolute `.../v2/parse` address.
 */
function parseUrl(apiUrl: string | undefined): string {
  const configured = apiUrl ?? process.env.FIRECRAWL_API_URL ?? process.env.FABERLOOM_FIRECRAWL_API_URL
  const base = configured === undefined || configured.trim().length === 0 ? API_URL : configured.trim()
  return `${base.replace(/\/+$/, '')}/v2/parse`
}

/**
 * Reason an HTTP response that is not `ok` maps to.
 * @param status - the response status.
 * @returns the key, credit, server, or generic refusal reason.
 */
function failureFor(status: number): FirecrawlParseFailure {
  if (status === 401) return 'unauthorized'
  if (status === 402) return 'insufficient-credits'
  if (status >= 500 && status < 600) return 'server'
  return 'request-failed'
}

/**
 * The detail Parse put in its JSON error envelope.
 * @param reply - the parsed response body, when it parsed.
 * @returns the detail text, or undefined when the envelope carries none.
 */
function errorDetail(reply: unknown): string | undefined {
  if (typeof reply !== 'object' || reply === null) return undefined
  const error = (reply as { error?: unknown }).error
  return typeof error === 'string' && error.length > 0 ? error : undefined
}
