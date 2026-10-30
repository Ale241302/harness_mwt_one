/**
 * Native model catalog (`ctx.faberloomModelCatalog`): the fixed provider
 * protocol table, dynamic model discovery through each provider's models
 * endpoint authenticating with a caller-named credential, and a credential
 * probe that answers whether a reference authenticates and whether its account
 * is out of quota. Discovery replaces a model list burned into a client; a
 * probe asks "does my key work?" with one attempt and a bounded timeout. The
 * credential is resolved per call and never appears in a result.
 * @module @deepseek-ai/dsh-faberloom-model-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  INVALID_CREDENTIAL_CODE,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  assertUsableApiKey,
  errorChain,
  isContextWindowExceededError,
  providerAccountFailureCode,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {
  DiscoveredModel,
  ModelCatalogSnapshot,
  ProbeFailureKind,
  ProviderDescriptor,
  ProviderErrorShape,
  ProviderModelCatalog,
  ProviderProtocol,
} from './types.ts'

export type * from './types.ts'

/** Package name prefixed to credential diagnostics. */
const PACKAGE = 'faberloom-model-catalog'

/** Anthropic Messages API version required beside the `x-api-key` header. */
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Longest provider response excerpt a probe or discovery diagnostic carries.
 * A bound on the emitted text, not a deployment choice.
 */
const MAX_DETAIL_CHARS = 300

/**
 * Machine code a probe or discovery failure carries when no credential value
 * resolved for the reference. Deliberately distinct from credential rejection:
 * "configure a key" and "replace the key" are different states.
 */
export const NO_CREDENTIAL_CODE = 'MISSING_CREDENTIAL'

/** Machine code a provider throttle (429 without billing wording) carries. */
export const RATE_LIMITED_CODE = 'RATE_LIMIT'

/** Machine code a provider-refused request (400 without credential wording) carries. */
export const BAD_REQUEST_CODE = 'BAD_REQUEST'

/** Machine code an incomplete models request carries: transport failure or timeout. */
export const UNREACHABLE_CODE = 'TRANSPORT'

/** Machine code a status or provider id this catalog cannot classify carries. */
export const UNSUPPORTED_CODE = 'UNSUPPORTED'

/**
 * Stable machine code for every probe failure kind. The user-facing text is
 * chosen by the surface that renders a verdict; this table is the routing
 * vocabulary, and it is the only place a kind's code is spelled.
 */
export const PROBE_FAILURE_CODES: Readonly<Record<ProbeFailureKind, string>> = Object.freeze({
  'no-credential': NO_CREDENTIAL_CODE,
  'invalid-credential': INVALID_CREDENTIAL_CODE,
  'quota-exhausted': QUOTA_EXCEEDED_CODE,
  'rate-limited': RATE_LIMITED_CODE,
  'bad-request': BAD_REQUEST_CODE,
  'unreachable': UNREACHABLE_CODE,
  'unsupported': UNSUPPORTED_CODE,
})

/** Cordis plugin name. */
export const name = 'faberloom-model-catalog'

/**
 * No required services. The credentials seam is optional: the catalog reads it
 * with `ctx.get('credentials')` and otherwise resolves the launch environment,
 * so it mounts in any composition that carries a provider table.
 */
export const inject: string[] = []

/**
 * Request timeout applied when the configuration names none.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

/**
 * Deployment configuration for the model catalog.
 */
export interface Config {
  /**
   * Milliseconds allowed for one provider request before it is abandoned.
   * Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}; validated to 1 through
   * 60,000 so a probe cannot hold a surface open.
   */
  requestTimeoutMs?: number
  /**
   * Egress origin per provider id, replacing the protocol table's public
   * origin: a self-hosted gateway, a regional host, or a test server. The
   * provider ids, credential transports, and models paths stay fixed.
   */
  origins?: Record<string, string>
}

/**
 * Schemastery configuration for the model catalog.
 */
export const Config: z<Config> = z.object({
  requestTimeoutMs: z.natural().min(1).max(60_000),
  origins: z.dict(z.string()),
})

/**
 * The fixed protocol table: each provider, the origin its models endpoint is
 * reached at, the wire protocol that endpoint speaks, and the models path.
 * Frozen at module load; {@link Config.origins} may redirect egress without
 * changing these protocol facts.
 */
export const PROVIDERS: readonly ProviderDescriptor[] = Object.freeze([
  Object.freeze<ProviderDescriptor>({
    id: 'deepseek',
    label: 'DeepSeek',
    origin: 'https://api.deepseek.com/v1',
    protocol: 'openai',
    modelsPath: '/models',
    auth: Object.freeze({ kind: 'bearer' }),
    errorShape: 'openai',
    docs: Object.freeze(['https://api-docs.deepseek.com/api/list-models']),
    routes: Object.freeze(['deepseek-official']),
    credentialRef: credentialRef('DEEPSEEK_API_KEY'),
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'openai',
    label: 'OpenAI',
    origin: 'https://api.openai.com/v1',
    protocol: 'openai',
    modelsPath: '/models',
    auth: Object.freeze({ kind: 'bearer' }),
    errorShape: 'openai',
    docs: Object.freeze(['https://platform.openai.com/docs/api-reference/models/list']),
    routes: Object.freeze([]),
    credentialRef: credentialRef('OPENAI_API_KEY'),
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'anthropic',
    label: 'Anthropic',
    origin: 'https://api.anthropic.com',
    protocol: 'messages',
    modelsPath: '/v1/models',
    auth: Object.freeze({
      kind: 'header',
      name: 'x-api-key',
      static: Object.freeze({ 'anthropic-version': ANTHROPIC_VERSION }),
    }),
    errorShape: 'anthropic',
    docs: Object.freeze(['https://docs.anthropic.com/en/api/models-list']),
    routes: Object.freeze([]),
    credentialRef: credentialRef('ANTHROPIC_API_KEY'),
  }),
  // `kimi` is the Kimi Code (coding-plan) surface the product's `kimi` route
  // calls: its models endpoint answers at `https://api.kimi.com/coding/v1/models`
  // (measured live today: 200 with a `{ "data": [ ... ] }` list under either
  // `x-api-key` or `Authorization: Bearer`, 401 with no credential). The
  // published platform docs state the Kimi Code API is independent of the
  // pay-as-you-go API and the two keys are not interchangeable
  // (https://platform.kimi.ai/docs/guide/product-plans), which is why this entry
  // names the product site as its documentation source. `llm-pi-ai` aliases the
  // route `kimi` to its installed `kimi-coding` catalog entry, whose baseUrl is
  // `https://api.kimi.com/coding`; this entry's origin agrees with that surface.
  Object.freeze<ProviderDescriptor>({
    id: 'kimi',
    label: 'Kimi Code',
    origin: 'https://api.kimi.com/coding/v1',
    protocol: 'openai',
    modelsPath: '/models',
    auth: Object.freeze({ kind: 'bearer' }),
    errorShape: 'openai',
    docs: Object.freeze(['https://www.kimi.ai/code', 'https://platform.kimi.ai/docs/guide/product-plans']),
    routes: Object.freeze([]),
    credentialRef: credentialRef('KIMI_API_KEY'),
  }),
  // `moonshotai` is the pay-as-you-go platform surface: a distinct product with
  // its own key that lists at `https://api.moonshot.ai/v1/models`, documented at
  // the source URL below. The PRC console issues keys for
  // `https://api.moonshot.cn/v1`, which exposes the same path.
  Object.freeze<ProviderDescriptor>({
    id: 'moonshotai',
    label: 'Moonshot (platform)',
    origin: 'https://api.moonshot.ai/v1',
    protocol: 'openai',
    modelsPath: '/models',
    auth: Object.freeze({ kind: 'bearer' }),
    errorShape: 'openai',
    docs: Object.freeze(['https://platform.kimi.ai/docs/api/list-models']),
    routes: Object.freeze([]),
    credentialRef: credentialRef('MOONSHOT_API_KEY'),
  }),
  // Google reports an invalid key as a 400 with status `API_KEY_INVALID` and
  // the message "API key not valid", so the `google` error shape is what keeps
  // that case out of `bad-request`.
  Object.freeze<ProviderDescriptor>({
    id: 'google',
    label: 'Google Gemini',
    origin: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'google',
    modelsPath: '/models',
    auth: Object.freeze({ kind: 'query', name: 'key' }),
    errorShape: 'google',
    docs: Object.freeze(['https://ai.google.dev/api/models#method:-models.list']),
    routes: Object.freeze([]),
    credentialRef: credentialRef('GOOGLE_API_KEY'),
  }),
])

/** Read one JSON object as a plain record, or `undefined` when it is not one. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Read one non-empty string field, or `undefined` when the provider omitted it. */
function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one positive number field, or `undefined` when the provider omitted it. */
function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined
}

/** Read one list of non-empty string field members, or `undefined` when none survive. */
function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return items.length > 0 ? Object.freeze(items) : undefined
}

/** Read a provider's declared reasoning-effort scale, when it declares one. */
function effortLevels(effort: unknown): readonly string[] | undefined {
  const fields = record(effort)
  return fields === undefined ? undefined : stringList(fields.supported_levels)
}

/**
 * Read the provider's declared mid-conversation system-prompt handling. DeepSeek
 * reports it per protocol family under `api_capabilities`; only `in-history` is a
 * capability this harness models, so any other spelling stays absent rather than
 * claiming a behavior the harness would then apply.
 */
function systemPromptUpdate(capabilities: unknown): 'in-history' | undefined {
  const declared = stringField(atPath(capabilities, 'anthropic_messages.system_prompt_update'))
  return declared === 'in-history' ? 'in-history' : undefined
}

/** Fields one provider row contributes to a {@link DiscoveredModel}. */
interface ModelFields {
  readonly id: string
  readonly name?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxOutputTokens?: number | undefined
  readonly inputModalities?: readonly string[] | undefined
  readonly outputModalities?: readonly string[] | undefined
  readonly effortLevels?: readonly string[] | undefined
  readonly systemPromptUpdate?: 'in-history' | undefined
}

/** Build the frozen normalized row, keeping only the fields the provider declared. */
function model(fields: ModelFields): DiscoveredModel {
  return Object.freeze({
    id: fields.id,
    ...fields.name === undefined ? {} : { name: fields.name },
    ...fields.contextWindow === undefined ? {} : { contextWindow: fields.contextWindow },
    ...fields.maxOutputTokens === undefined ? {} : { maxOutputTokens: fields.maxOutputTokens },
    ...fields.inputModalities === undefined ? {} : { inputModalities: fields.inputModalities },
    ...fields.outputModalities === undefined ? {} : { outputModalities: fields.outputModalities },
    ...fields.effortLevels === undefined ? {} : { effortLevels: fields.effortLevels },
    ...fields.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: fields.systemPromptUpdate },
  })
}

/** Read the array field a provider shape lists its models under, or `undefined` for an unreadable body. */
function modelRows(body: unknown, key: 'data' | 'models'): readonly unknown[] | undefined {
  const fields = record(body)
  if (fields === undefined) return undefined
  const value = fields[key]
  return Array.isArray(value) ? value : undefined
}

/** One OpenAI-compatible provider row, keeping the richer fields DeepSeek and Moonshot add. */
function openAiModel(row: unknown): DiscoveredModel | undefined {
  const fields = record(row)
  if (fields === undefined) return undefined
  const id = stringField(fields.id)
  if (id === undefined) return undefined
  // Two documented spellings of the same facts: DeepSeek answers
  // `context_window`/`max_output_tokens`, Moonshot answers `context_length`
  // and the boolean `supports_image_in`. Reading both is what keeps a
  // discovered capacity from being dropped as unknown.
  const declaredInput = stringList(fields.input_modalities)
  return model({
    id,
    name: stringField(fields.name),
    contextWindow: numberField(fields.context_window) ?? numberField(fields.context_length),
    maxOutputTokens: numberField(fields.max_output_tokens),
    inputModalities: declaredInput
      ?? (fields.supports_image_in === true ? Object.freeze(['text', 'image']) : undefined),
    outputModalities: stringList(fields.output_modalities),
    effortLevels: effortLevels(fields.effort),
    systemPromptUpdate: systemPromptUpdate(fields.api_capabilities),
  })
}

/** Normalize an OpenAI-compatible `{ data: [...] }` models response. */
function openAiModels(body: unknown): DiscoveredModel[] | undefined {
  const data = modelRows(body, 'data')
  if (data === undefined) return undefined
  return data.map(openAiModel).filter((row): row is DiscoveredModel => row !== undefined)
}

/** One Anthropic Messages provider row. */
function messagesModel(row: unknown): DiscoveredModel | undefined {
  const fields = record(row)
  if (fields === undefined) return undefined
  const id = stringField(fields.id)
  if (id === undefined) return undefined
  return model({ id, name: stringField(fields.display_name) })
}

/** Normalize an Anthropic `{ data: [...] }` models response. */
function messagesModels(body: unknown): DiscoveredModel[] | undefined {
  const data = modelRows(body, 'data')
  if (data === undefined) return undefined
  return data.map(messagesModel).filter((row): row is DiscoveredModel => row !== undefined)
}

/** One Google Gemini provider row, whose `name` is `models/<id>`. */
function googleModel(row: unknown): DiscoveredModel | undefined {
  const fields = record(row)
  if (fields === undefined) return undefined
  const name = stringField(fields.name)
  if (name === undefined) return undefined
  return model({
    id: name.replace(/^models\//, ''),
    name: stringField(fields.displayName),
    contextWindow: numberField(fields.inputTokenLimit),
    maxOutputTokens: numberField(fields.outputTokenLimit),
  })
}

/** Normalize a Google `{ models: [...] }` models response. */
function googleModels(body: unknown): DiscoveredModel[] | undefined {
  const models = modelRows(body, 'models')
  if (models === undefined) return undefined
  return models.map(googleModel).filter((row): row is DiscoveredModel => row !== undefined)
}

/** One provider's model-list normalizer, keyed by the protocol that selected it. */
const NORMALIZERS: Readonly<Record<ProviderProtocol, (body: unknown) => DiscoveredModel[] | undefined>> = Object.freeze({
  openai: openAiModels,
  messages: messagesModels,
  google: googleModels,
})

/** Parse a provider body, or report it unreadable without throwing. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (_unreadableProviderBody) {
    return undefined
  }
}

/** Replace every occurrence of the credential with a placeholder. */
function redact(text: string, secret: string): string {
  return text.split(secret).join('[redacted]')
}

/** Render one thrown value as a bounded probe detail, scrubbed when the key is known. */
function probeDetail(error: unknown, secret?: string): string {
  const text = errorChain(error).slice(0, MAX_DETAIL_CHARS)
  return secret === undefined ? text : redact(text, secret)
}

/** One provider's own error fields, read out of a rejected models response body. */
interface ProviderErrorBody {
  /** The provider's human message, when it carried one. */
  readonly message?: string
  /** Provider identifiers (a code, a type, or a status token) that classify the failure. */
  readonly identifiers: readonly string[]
}

/** Read a dotted field path out of one parsed body, or `undefined` when the path is absent. */
function atPath(body: unknown, path: string): unknown {
  let current: unknown = body
  for (const segment of path.split('.')) {
    const fields = record(current)
    if (fields === undefined) return undefined
    current = fields[segment]
  }
  return current
}

/** Collect the non-empty string spellings of the named paths. */
function tokens(body: unknown, paths: readonly string[]): readonly string[] {
  return paths.flatMap((path) => {
    const field = stringField(atPath(body, path))
    return field === undefined ? [] : [field]
  })
}

/**
 * Read one provider's error body through its own error shape.
 *
 * Google is the reason this is per provider rather than one parser: it puts its
 * classification token in `error.status` (`API_KEY_INVALID`, `RESOURCE_EXHAUSTED`),
 * while the OpenAI-compatible body puts it in `error.type` and `error.code`.
 * @param shape - the provider's error-body family.
 * @param body - the parsed provider response, when it parsed as JSON.
 * @returns the provider message and its classification identifiers.
 */
function readErrorBody(shape: ProviderErrorShape, body: unknown): ProviderErrorBody {
  const message = stringField(atPath(body, 'error.message'))
  const identifiers = shape === 'google'
    ? tokens(body, ['error.status'])
    : shape === 'anthropic'
      ? tokens(body, ['error.type'])
      : tokens(body, ['error.type', 'error.code'])
  return {
    ...message === undefined ? {} : { message },
    identifiers,
  }
}

/** Whether provider text names the credential itself as the problem, which Google reports on a 400. */
const CREDENTIAL_WORDING = /\b(?:api[\s_-]?key|credential|unauthoriz|unauthenticat|permission[\s_-]?denied|invalid[\s_-]?auth)\b/i

/**
 * Classify one rejected models request into the probe kind that reports it.
 *
 * Account-level outcomes are read through the same classifier the LLM adapters
 * use, so a verdict agrees with the adapter that will serve the next request:
 * HTTP 401 is a rejected credential, and any status whose body carries quota
 * wording is an exhausted account — the ordering matters because Kimi's coding
 * plan reports a cycle-scoped quota on 403, which a status table would call a
 * permissions failure and send the user to replace a working key. Only then does
 * the status decide a transient throttle or a request the provider refused.
 * @param status - the provider HTTP status.
 * @param detail - the provider's own message and identifiers joined into one string.
 * @returns the failure kind the probe reports.
 */
function failureKind(status: number, detail: string): ProbeFailureKind {
  const account = providerAccountFailureCode(status, detail)
  if (account === 'AUTH') return 'invalid-credential'
  if (account === QUOTA_EXCEEDED_CODE) return 'quota-exhausted'
  if (status === 429) return 'rate-limited'
  if (status === 400) {
    // A context overflow is the request's shape, not the credential. Google
    // reports an invalid key as a 400, so its body wording decides the rest.
    if (isContextWindowExceededError(detail)) return 'bad-request'
    return CREDENTIAL_WORDING.test(detail) ? 'invalid-credential' : 'bad-request'
  }
  if (status === 403) return 'invalid-credential'
  return 'unsupported'
}

/**
 * Classify one rejected models response: its kind plus the provider's own
 * message excerpt, bounded and already scrubbed of the credential.
 * @param status - the provider HTTP status.
 * @param bodyText - the response body, with the credential already replaced.
 * @param shape - the provider's error-body family.
 * @returns the failure kind and the provider's message excerpt when it carried one.
 */
function classifyFailure(status: number, bodyText: string, shape: ProviderErrorShape): { kind: ProbeFailureKind; detail?: string } {
  const error = readErrorBody(shape, parseJson(bodyText))
  const kind = failureKind(status, [error.message, ...error.identifiers].join(' '))
  const detail = (error.message ?? bodyText.trim()).slice(0, MAX_DETAIL_CHARS)
  return detail.length === 0 ? { kind } : { kind, detail }
}

/**
 * Resolve one credential reference exactly as the LLM adapters do: the
 * credentials seam when it is mounted, otherwise the launch environment. The
 * value is resolved per call and never cached.
 * @param ctx - context carrying the optional credentials service and the launch environment.
 * @param ref - the credential reference to resolve.
 * @returns the trimmed, usable key.
 * @throws LlmError `MISSING_CREDENTIAL` when no layer supplies a value, and
 * `INVALID_CREDENTIAL` when the value cannot travel in an HTTP header.
 */
async function resolveCredential(ctx: Context, ref: CredentialRef): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined) return assertUsableApiKey(hit.value, PACKAGE, ref)
  } else {
    // Without the seam there is no managed store to rank against, so the
    // environment is the whole credential plane.
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, PACKAGE, ref)
  }
  throw new LlmError(
    `${PACKAGE}: no credential configured for provider reference "${ref}"; store it through the credentials`
    + ` service or export ${ref} in the launching environment`,
    NO_CREDENTIAL_CODE,
  )
}

/**
 * Send one models request, carrying the key the way the provider's own
 * credential transport declares.
 * @param descriptor - the provider to reach.
 * @param key - the resolved credential.
 * @param timeoutMs - milliseconds allowed before the request is abandoned.
 * @returns the provider response; the caller reads its status and body.
 */
async function requestModelList(descriptor: ProviderDescriptor, key: string, timeoutMs: number): Promise<Response> {
  const url = new URL(`${descriptor.origin.replace(/\/+$/, '')}${descriptor.modelsPath}`)
  const headers = new Headers({ accept: 'application/json' })
  const auth = descriptor.auth
  if (auth.kind === 'bearer') {
    headers.set('authorization', `Bearer ${key}`)
  } else if (auth.kind === 'header') {
    headers.set(auth.name, key)
    for (const [name, value] of Object.entries(auth.static ?? {})) headers.set(name, value)
  } else {
    url.searchParams.set(auth.name, key)
  }
  return fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Build the model catalog service over the fixed protocol table.
 * @param ctx - context the service resolves credentials and the launch environment through.
 * @param config - validated deployment configuration.
 * @returns the catalog service; the caller publishes it with `ctx.provide`.
 */
function createModelCatalog(ctx: Context, config: Config): ProviderModelCatalog {
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  // Egress is the one table fact a deployment may redirect; the provider ids,
  // protocols, and models paths stay the ones the protocol table declares.
  const table: readonly ProviderDescriptor[] = Object.freeze(PROVIDERS.map((provider): ProviderDescriptor => Object.freeze({
    ...provider,
    origin: config.origins?.[provider.id] ?? provider.origin,
  })))
  const snapshots = new Map<string, ModelCatalogSnapshot>()

  return {
    providers: () => PROVIDERS,

    async discover(providerId, credentialRef) {
      const descriptor = table.find(provider => provider.id === providerId)
      if (descriptor === undefined) {
        throw new LlmError(`${PACKAGE}: no provider "${providerId}" in the model catalog table`, 'UNSUPPORTED_PROVIDER')
      }
      const key = await resolveCredential(ctx, credentialRef)
      let response: Response
      try {
        response = await requestModelList(descriptor, key, requestTimeoutMs)
      } catch (error) {
        throw new LlmError(`${PACKAGE}: the models request to "${providerId}" did not complete`, UNREACHABLE_CODE, { cause: error })
      }
      const text = await response.text()
      if (!response.ok) {
        const failure = classifyFailure(response.status, redact(text, key), descriptor.errorShape)
        const suffix = failure.detail === undefined ? '' : `: ${failure.detail}`
        throw new LlmError(
          `${PACKAGE}: model discovery for "${providerId}" failed (${failure.kind})${suffix}`,
          PROBE_FAILURE_CODES[failure.kind],
          { status: response.status },
        )
      }
      const models = NORMALIZERS[descriptor.protocol](parseJson(text))
      if (models === undefined) {
        throw new LlmError(`${PACKAGE}: model discovery for "${providerId}" returned no model list`, 'MALFORMED_RESPONSE', { status: response.status })
      }
      snapshots.set(providerId, Object.freeze({ providerId, at: Date.now(), models: Object.freeze([...models]) }))
      return models
    },

    async probe(providerId, credentialRef) {
      const descriptor = table.find(provider => provider.id === providerId)
      if (descriptor === undefined) {
        return { kind: 'unsupported', detail: `${PACKAGE}: no provider "${providerId}" in the model catalog table` }
      }
      let key: string
      try {
        key = await resolveCredential(ctx, credentialRef)
      } catch (error) {
        // Absent and malformed are different states: the surface tells the user
        // to configure a key for one and to replace it for the other.
        const missing = error instanceof LlmError && error.code === NO_CREDENTIAL_CODE
        return {
          kind: missing ? 'no-credential' : 'invalid-credential',
          detail: probeDetail(error),
        }
      }
      try {
        const response = await requestModelList(descriptor, key, requestTimeoutMs)
        const text = await response.text()
        if (!response.ok) {
          const failure = classifyFailure(response.status, redact(text, key), descriptor.errorShape)
          return failure.detail === undefined
            ? { kind: failure.kind, status: response.status }
            : { kind: failure.kind, status: response.status, detail: failure.detail }
        }
        const models = NORMALIZERS[descriptor.protocol](parseJson(text))
        return models === undefined
          ? { kind: 'unsupported', status: response.status, detail: `${PACKAGE}: the provider response carried no model list` }
          : { kind: 'ok', status: response.status, models }
      } catch (error) {
        return { kind: 'unreachable', detail: probeDetail(error, key) }
      }
    },

    models: () => Object.freeze(
      [...snapshots.values()].sort((left, right) => left.providerId.localeCompare(right.providerId)),
    ),
  }
}

/**
 * Publish the model catalog as `ctx.faberloomModelCatalog`.
 * @param ctx - the plugin's Cordis context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('faberloomModelCatalog', createModelCatalog(ctx, config))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The provider protocol table, dynamic model discovery, and credential probing. */
    faberloomModelCatalog: ProviderModelCatalog
  }
}
