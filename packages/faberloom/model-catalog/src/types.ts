/**
 * Type surface of the model catalog (`ctx.faberloomModelCatalog`): the fixed
 * provider protocol table, the normalized model row every provider response
 * becomes, the cached discovery snapshot, and the credential probe verdict.
 * Types only: the plugin and its discovery code live in the entry module.
 * @module @deepseek-ai/dsh-faberloom-model-catalog/types
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/**
 * Wire protocol one provider's models endpoint speaks. It fixes both the
 * credential transport (bearer, `x-api-key` header, or query parameter) and
 * how a model row is read.
 */
export type ProviderProtocol = 'openai' | 'messages' | 'google'

/** One provider in the fixed protocol table. */
export interface ProviderDescriptor {
  /** Stable provider id callers name in {@link ProviderModelCatalog.discover} and {@link ProviderModelCatalog.probe}. */
  readonly id: string
  /** Human-readable provider name for a selection surface. */
  readonly label: string
  /** Origin the models endpoint is reached at, without the trailing models path. */
  readonly origin: string
  /** Wire protocol that fixes the credential transport and the models path. */
  readonly protocol: ProviderProtocol
  /** Path appended to the origin for the models request, such as `/v1/models`. */
  readonly modelsPath: string
}

/**
 * One model a provider currently serves, normalized across every provider
 * response. Only `id` is guaranteed: every other field is present exactly when
 * the provider declared it.
 */
export interface DiscoveredModel {
  /** Wire model id, and the harness model name a request names. */
  readonly id: string
  /** Display name the provider declares, when it declares one. */
  readonly name?: string
  /** Context window in tokens, when the provider declares one. */
  readonly contextWindow?: number
  /** Maximum output tokens, when the provider declares one. */
  readonly maxOutputTokens?: number
  /** Input modalities the model accepts, when the provider declares them. */
  readonly inputModalities?: readonly string[]
  /** Output modalities the model produces, when the provider declares them. */
  readonly outputModalities?: readonly string[]
  /** Reasoning effort levels the model accepts, when the provider declares a scale. */
  readonly effortLevels?: readonly string[]
}

/** Verdict of one credential probe. */
export type ProbeKind =
  /** The credential authenticated and the provider served its model list. */
  | 'ok'
  /** The provider rejected the credential (401/403), or no usable value resolved for the reference. */
  | 'invalid-credential'
  /** The account is out of balance, credit, or quota (402, or 429/403 carrying billing wording). */
  | 'quota-exhausted'
  /** The request never completed: transport failure, timeout, or an unresolvable host. */
  | 'unreachable'
  /** The provider id is not in the protocol table, or the provider answered a status this probe does not classify. */
  | 'unsupported'

/** Outcome of one credential probe; never carries the credential. */
export interface ProviderProbe {
  /** What the probe learned. */
  readonly kind: ProbeKind
  /** HTTP status the provider answered with, when a response arrived. */
  readonly status?: number
  /** Safe diagnosis text, bounded in length and scrubbed of the credential. */
  readonly detail?: string
  /** Models the provider served, on `ok` only. */
  readonly models?: readonly DiscoveredModel[]
}

/** One provider's last successful discovery and when it ran. */
export interface ModelCatalogSnapshot {
  /** The provider the snapshot belongs to. */
  readonly providerId: string
  /** Epoch milliseconds of the discovery that produced this snapshot. */
  readonly at: number
  /** The models that discovery returned, frozen. */
  readonly models: readonly DiscoveredModel[]
}

/**
 * The model catalog service, published as `ctx.faberloomModelCatalog`.
 *
 * Every call resolves its credential reference through the credentials seam,
 * or through the launch environment while no seam is mounted, so a changed
 * reference reaches the next call with no restart. No method caches a
 * credential value.
 */
export interface ProviderModelCatalog {
  /**
   * The fixed provider protocol table.
   * @returns the frozen table, in the order the plugin declares it.
   */
  providers(): readonly ProviderDescriptor[]

  /**
   * Ask one provider which models it currently serves, authenticating with the
   * named credential reference.
   * @param providerId - the provider id to reach.
   * @param credentialRef - the reference resolved through `ctx.credentials`, or the launch environment.
   * @returns the normalized models, and records them as this provider's cached snapshot.
   * @throws LlmError `UNSUPPORTED_PROVIDER` for an unknown id, the credential error
   * `resolveCredential` raises, `TRANSPORT` when the request never completed, and
   * the probe failure codes when the provider rejected the request.
   */
  discover(providerId: string, credentialRef: CredentialRef): Promise<DiscoveredModel[]>

  /**
   * Probe whether one credential reference authenticates against a provider,
   * with a single attempt and a bounded timeout.
   * @param providerId - the provider id to probe.
   * @param credentialRef - the reference resolved through `ctx.credentials`, or the launch environment.
   * @returns the verdict, the HTTP status, a safe detail, and the served models on success.
   */
  probe(providerId: string, credentialRef: CredentialRef): Promise<ProviderProbe>

  /**
   * Read the cached last discovery per provider, without touching the network.
   * @returns one frozen snapshot per provider discovered so far, ordered by provider id.
   */
  models(): readonly ModelCatalogSnapshot[]
}
