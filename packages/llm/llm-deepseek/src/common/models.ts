/**
 * Model catalog resolution for every DeepSeek protocol.
 *
 * The catalog this adapter serves comes from two sources, in order: the
 * deployment's own pinned `models` list, then the rows the deployment's model
 * catalog discovered from the provider's `GET /models`. Discovery is the only
 * source that decides which ids exist — a model the provider starts serving
 * appears with no code change, and an id it stops serving disappears. No id is
 * burned into this adapter: a deployment that names private or gateway-specific
 * ids writes `models`, and one whose provider served nothing advertises nothing.
 *
 * A discovered row carries every fact the provider declared, including its
 * mid-conversation system-prompt handling under `api_capabilities`, so the
 * adapter never needs a per-id capability table either.
 */

import type { ModelModality } from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel } from './types.ts'

/** One discovered provider row, structurally the model catalog's `DiscoveredModel`. */
export interface DiscoveredCatalogRow {
  /** Wire model id the provider currently serves. */
  readonly id: string
  /** Display name the provider declares, when it declares one. */
  readonly name?: string
  /** Context window in tokens, when the provider declares one. */
  readonly contextWindow?: number
  /** Maximum output tokens, when the provider declares one. */
  readonly maxOutputTokens?: number
  /** Input modalities the provider declares, when it declares them. */
  readonly inputModalities?: readonly string[]
  /** Declared mid-conversation system-prompt handling, when the provider declares one. */
  readonly systemPromptUpdate?: 'in-history'
}

/** The input modalities this adapter's catalog schema accepts, in declaration order. */
const CATALOG_MODALITIES: readonly ModelModality[] = ['text', 'image']

/**
 * Keep only the modalities the catalog schema accepts. An empty or absent
 * declaration yields `undefined`, letting resolution default to text-only rather
 * than storing an empty list its schema would reject.
 * @param declared - the modalities the provider declared, when it declared them.
 * @returns the accepted modalities, or `undefined` when none survive.
 */
function acceptedModalities(declared: readonly string[] | undefined): DeepSeekCatalogModel['inputModalities'] {
  if (declared === undefined) return undefined
  const accepted = CATALOG_MODALITIES.filter(modality => declared.includes(modality))
  return accepted.length === 0 ? undefined : accepted
}

/**
 * Turn discovered rows into catalog entries, one per discovered id.
 * @param discovered - the provider's discovered models, in provider order.
 * @returns catalog entries for exactly the discovered ids.
 */
function discoveredEntries(discovered: readonly DiscoveredCatalogRow[]): DeepSeekCatalogModel[] {
  return discovered.map((row) => {
    const inputModalities = acceptedModalities(row.inputModalities)
    return {
      id: row.id,
      ...row.name === undefined ? {} : { name: row.name },
      ...row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow },
      ...row.maxOutputTokens === undefined ? {} : { maxTokens: row.maxOutputTokens },
      ...inputModalities === undefined ? {} : { inputModalities },
      ...row.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: row.systemPromptUpdate },
    }
  })
}

/**
 * Resolve the catalog one connection snapshot serves.
 * @param configured - the deployment's own `models` list, or `undefined` when it states none.
 * @param discovered - the provider's discovered rows, empty when nothing has been discovered.
 * @returns the catalog entries to advertise, with no fabricated id.
 */
export function resolveCatalogModels(
  configured: readonly DeepSeekCatalogModel[] | undefined,
  discovered: readonly DiscoveredCatalogRow[],
): DeepSeekCatalogModel[] {
  // A list the deployment wrote wins outright: it may name private or
  // gateway-specific ids that discovery cannot know about.
  if (configured !== undefined) return configured.map(entry => ({ ...entry }))
  return discoveredEntries(discovered)
}
