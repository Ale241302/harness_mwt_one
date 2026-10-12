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
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {
  DiscoveredModel,
  ModelCatalogSnapshot,
  ProbeKind,
  ProviderDescriptor,
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
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'openai',
    label: 'OpenAI',
    origin: 'https://api.openai.com/v1',
    protocol: 'openai',
    modelsPath: '/models',
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'anthropic',
    label: 'Anthropic',
    origin: 'https://api.anthropic.com',
    protocol: 'messages',
    modelsPath: '/v1/models',
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    origin: 'https://api.moonshot.ai/v1',
    protocol: 'openai',
    modelsPath: '/models',
  }),
  Object.freeze<ProviderDescriptor>({
    id: 'google',
    label: 'Google Gemini',
    origin: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'google',
    modelsPath: '/models',
  }),
])

/** How each protocol carries the credential on a models request. */
const CREDENTIAL_TRANSPORTS: Readonly<Record<ProviderProtocol, 'bearer' | 'x-api-key' | 'query'>> = Object.freeze({
  openai: 'bearer',
  messages: 'x-api-key',
  google: 'query',
})

/** One non-`ok` probe verdict, as the failure classifiers return it. */
type ProbeFailureKind = Exclude<ProbeKind, 'ok'>

/** Stable machine code each probe failure kind maps to in a thrown discovery error. */
const FAILURE_CODES: Readonly<Record<ProbeFailureKind, string>> = Object.freeze({
  'invalid-credential': INVALID_CREDENTIAL_CODE,
  'quota-exhausted': QUOTA_EXCEEDED_CODE,
  'unreachable': 'TRANSPORT',
  'unsupported': 'UNSUPPORTED',
})

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

/** Fields one provider row contributes to a {@link DiscoveredModel}. */
interface ModelFields {
  readonly id: string
  readonly name?: string | undefined
  readonly contextWindow?: number | undefined
  readonly maxOutputTokens?: number | undefined
  readonly inputModalities?: readonly string[] | undefined
  readonly outputModalities?: readonly string[] | undefined
  readonly effortLevels?: readonly string[] | undefined
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
  })
}

/** Read the array field a provider shape lists its models under, or `undefined` for an unreadable body. */
function modelRows(body: unknown, key: 'data' | 'models'): readonly unknown[] | undefined {
  const fields = record(body)
  if (fields === undefined) return undefined
  const value = fields[key]
  return Array.isArray(value) ? value : undefined
}

/** One OpenAI-compatible provider row, keeping the richer fields DeepSeek adds. */
function openAiModel(row: unknown): DiscoveredModel | undefined {
  const fields = record(row)
  if (fields === undefined) return undefined
  const id = stringField(fields.id)
  if (id === undefined) return undefined
  return model({
    id,
    name: stringField(fields.name),
    contextWindow: numberField(fields.context_window),
    maxOutputTokens: numberField(fields.max_output_tokens),
    inputModalities: stringList(fields.input_modalities),
    outputModalities: stringList(fields.output_modalities),
    effortLevels: effortLevels(fields.effort),
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

/** Classify one rejected models request into the probe kind that reports it. */
function failureKind(status: number, body: string): ProbeFailureKind {
  if (isQuotaExceededError(body)) return 'quota-exhausted'
  if (status === 402) return 'quota-exhausted'
  if (status === 401 || status === 403) return 'invalid-credential'
  return 'unsupported'
}

/** Classify one rejected models response, keeping a bounded excerpt as its detail. */
function classifyFailure(status: number, body: string): { kind: ProbeFailureKind; detail?: string } {
  const kind = failureKind(status, body)
  const detail = body.trim().slice(0, MAX_DETAIL_CHARS)
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
    `${PACKAGE}: no API key for credential reference "${ref}"; store it through the credentials service`
    + ` or export ${ref} in the launching environment`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * Send one models request, carrying the key the way the protocol expects.
 * @param descriptor - the provider to reach.
 * @param key - the resolved credential.
 * @param timeoutMs - milliseconds allowed before the request is abandoned.
 * @returns the provider response; the caller reads its status and body.
 */
async function requestModelList(descriptor: ProviderDescriptor, key: string, timeoutMs: number): Promise<Response> {
  const url = new URL(`${descriptor.origin.replace(/\/+$/, '')}${descriptor.modelsPath}`)
  const headers = new Headers({ accept: 'application/json' })
  const transport = CREDENTIAL_TRANSPORTS[descriptor.protocol]
  if (transport === 'bearer') {
    headers.set('authorization', `Bearer ${key}`)
  } else if (transport === 'x-api-key') {
    headers.set('x-api-key', key)
    headers.set('anthropic-version', ANTHROPIC_VERSION)
  } else {
    url.searchParams.set('key', key)
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
        throw new LlmError(`${PACKAGE}: the models request to "${providerId}" did not complete`, 'TRANSPORT', { cause: error })
      }
      const text = await response.text()
      if (!response.ok) {
        const failure = classifyFailure(response.status, redact(text, key))
        const suffix = failure.detail === undefined ? '' : `: ${failure.detail}`
        throw new LlmError(
          `${PACKAGE}: model discovery for "${providerId}" failed (${failure.kind})${suffix}`,
          FAILURE_CODES[failure.kind],
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
        return { kind: 'invalid-credential', detail: probeDetail(error) }
      }
      try {
        const response = await requestModelList(descriptor, key, requestTimeoutMs)
        const text = await response.text()
        if (!response.ok) {
          const failure = classifyFailure(response.status, redact(text, key))
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
