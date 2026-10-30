/**
 * Harness error base with a stable machine-routable code and chained cause.
 * Package errors extend it so tool results and replay can retain failure class.
 * @module @deepseek-ai/dsh-llm/error
 */

/**
 * Base class for all harness errors. Carries a `code` (stable, programmatic —
 * e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
 * human-readable `message`, and supports `cause` chaining via the standard
 * `ErrorOptions`. `name` defaults to the subclass constructor name.
 */
export class HarnessError extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}

/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/** Canonical provider-neutral code for an exhausted account quota or balance. */
export const QUOTA_EXCEEDED_CODE = 'QUOTA'

/**
 * Canonical provider-neutral code for a response that completed normally but
 * carried no content blocks at all. Providers occasionally emit a degenerate
 * completion (a terminal stop with zero output); adapters classify it as this
 * failure instead of yielding an empty assistant message, because an empty
 * message silently ends the turn with nothing for the user or the loop to act
 * on. The attempt produced nothing durable, so retry policy treats it as safe
 * to repeat.
 */
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'

/**
 * Canonical provider-neutral code for a credential that was supplied but
 * cannot be used — malformed rather than absent. Distinct from
 * `MISSING_CREDENTIAL` because the fix differs: correct the stored value
 * rather than supply one. Deliberately outside the default retryable set —
 * a malformed credential fails identically on every attempt.
 */
export const INVALID_CREDENTIAL_CODE = 'INVALID_CREDENTIAL'

/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]`
  + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  'i',
)

/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?`
  + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?`
  + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  'i',
)

/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}`
  + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}`
  + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  'i',
)

/**
 * Recognize the context-overflow wording used by OpenAI-compatible providers
 * and library adapters. Adapters pass all available provider code, type, and
 * message text so both thrown and in-band delivery styles share one classifier.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true when the detail identifies a request exceeding the model context window.
 */
export function isContextWindowExceededError(detail: string): boolean {
  return STRUCTURED_CONTEXT_OVERFLOW.test(detail)
    || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail)
    || TOO_LARGE_FOR_CONTEXT.test(detail)
    || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail)
    || EXCEEDS_MODEL_CONTEXT.test(detail)
}

/**
 * Recognize provider wording that identifies an exhausted account quota rather
 * than a transient request-rate limit.
 *
 * The balance-absence pattern covers OpenAI's `insufficient_quota` body, whose
 * sentence names an empty balance without the `insufficient` prefix
 * ("You have no credits remaining. Add credits to continue…"). The provider
 * flattens that body to its message before some adapters classify it, so the
 * structured `code` alone is not always available. The pattern asserts an absent
 * balance; a throttling message names a rate instead, so it cannot match.
 *
 * The billing-period patterns cover a cycle-scoped quota, whose wording states a
 * period ("monthly", "daily", "weekly", or a billing/next cycle) rather than a
 * balance. Kimi's coding plan answers this way ("You've reached your monthly
 * usage limit for this billing cycle. Your quota will be refreshed in the next
 * cycle."). A throttle names a sub-hour window ("resets in one minute"), which
 * no period word matches, so the two stay distinct.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true only for terminal quota, balance, credit, budget, usage-limit, or billing-cycle wording.
 */
export function isQuotaExceededError(detail: string): boolean {
  return /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail)
    || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail)
    || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail)
    || /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail)
    || /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail)
    || /\bno[\s_-]+(?:credits?|funds?|balance)[\s_-]+(?:remaining|left)\b/i.test(detail)
    || /\b(?:quota|usage[\s_-]*limit)\b[^.]{0,60}\b(?:billing[\s_-]*cycle|next[\s_-]*cycle|this[\s_-]*cycle)\b/i.test(detail)
    || /\b(?:monthly|daily|weekly)\b[^.]{0,40}\b(?:quota|usage[\s_-]*limit)\b/i.test(detail)
}

/**
 * Resolve the account-level failure code one provider HTTP response reports,
 * if any, before the transport status alone decides.
 *
 * Two account-level outcomes stay distinguishable because the user's fix
 * differs: a rejected credential (`AUTH` — correct or replace the key) and an
 * exhausted balance or quota (`QUOTA` — top up or raise the limit). Anything
 * else returns `undefined`, leaving a transient `RATE_LIMIT` or a status-only
 * mapping to the caller. HTTP 401 is always a rejected credential; HTTP 402
 * and any status whose body carries quota, balance, credit, or usage-limit
 * wording are an exhausted account, so a billing body on 403 or 429 is not
 * mistaken for a permissions or throttling failure. No credential value is
 * read here or anywhere in this classification.
 * @param status - provider HTTP status, when the failure had one.
 * @param detail - provider error code, type, and message text joined into one string.
 * @returns the account-level failure code, or `undefined` when the status alone decides.
 */
export function providerAccountFailureCode(status: number | undefined, detail: string): string | undefined {
  if (status === 401) return 'AUTH'
  if (status === 402 || isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  return undefined
}

/**
 * Name the provider route in one provider failure message, so a user acting on
 * a credential or billing failure knows which account to fix. Only the route
 * id is appended; no credential value is ever part of a failure message.
 *
 * The appended ` (provider "<route>")` suffix is this function's format
 * contract: the Chat client reads it back to name the account in a localized
 * `AUTH` or `QUOTA` notice, so the format changes with its reader.
 * @param provider - registered provider route the call selected.
 * @param message - provider-supplied or adapter-built failure text.
 * @returns the message with the provider route appended.
 */
export function providerFailureMessage(provider: string, message: string): string {
  return `${message} (provider "${provider}")`
}

/**
 * Render a thrown value with its full `cause` chain and AggregateError
 * members, so transport wrappers like undici's `TypeError: fetch failed`
 * surface the underlying failure instead of masking it. Plain structured
 * failures render their own data-backed `message`. Diagnostic-surface
 * rendering only (messages, notices, logs) — never parse the result; route on
 * {@link HarnessError.code}.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns the outermost message first, each cause appended with `: ` (skipped
 * when it repeats the wrapper message verbatim), and AggregateError members
 * bracketed and `; `-joined.
 */
export function errorChain(value: unknown): string {
  // Tracks the active recursion path (entries removed on exit), so only true
  // cycles are flagged and a diamond-shared cause still renders in full.
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) {
        if (typeof current === 'object' && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, 'message')
          if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
            return descriptor.value
          }
        }
        return String(current)
      }
      const message = current.message === '' ? current.name : current.message
      const members = current instanceof AggregateError && current.errors.length > 0
        ? ` [${current.errors.map(render).join('; ')}]`
        : ''
      const causeText = current.cause === undefined || current.cause === null
        ? ''
        : render(current.cause)
      // Wrappers like `new HarnessError(String(value), code, { cause: value })`
      // repeat their cause verbatim; rendering it again would only add noise.
      const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
      return `${message}${members}${cause}`
    } catch {
      // Only hostile coercion or hostile accessors (a throwing toString /
      // Symbol.toPrimitive on a non-Error, or a throwing message/name/cause/
      // errors getter on an Error subclass): this renderer feeds UI notices
      // and logs, so nothing may escape. Inner frames catch their own throws,
      // so only the hostile node collapses, not the whole chain.
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

/**
 * Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
 */
export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError
}

/**
 * Canonical code for a request an image-capable route cannot send until more
 * of its images are offloaded. The failure's `offloadImages` names how many
 * more of the oldest retained occurrences must be offloaded;
 * `dsh-compaction-image-offload` records an `image/offload` selection before
 * the agent or summarizer retries with freshly derived input.
 */
export const IMAGE_OFFLOAD_REQUIRED_CODE = 'IMAGE_OFFLOAD_REQUIRED'
