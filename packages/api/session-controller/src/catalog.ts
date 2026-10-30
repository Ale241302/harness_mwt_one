/** Shared projection of the live LLM registry into the browser model catalog. */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {
  ModelCatalog,
  ModelCatalogModel,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/** The branded credential reference this projection passes through untouched. */
type DiscoveryCredentialRef = NonNullable<LlmCallConfig['credentialRef']>

/** One provider row the model catalog discovered, read structurally. */
interface DiscoveryRow {
  readonly id: string
  /** Context window the provider declared, when it declared one. */
  readonly contextWindow?: number
  /** Maximum output tokens the provider declared, when it declared one. */
  readonly maxOutputTokens?: number
}

/**
 * Structural view of the optional `ctx.faberloomModelCatalog` service, read
 * through `ctx.get` because that service arrives from a higher layer than this
 * projection. Only the provider table, one discovery call, and its returned
 * rows are read; no other method or module value is needed, so this package
 * takes no dependency on the catalog package.
 */
interface DiscoveryCatalog {
  providers(): readonly {
    readonly id: string
    readonly routes: readonly string[]
    readonly credentialRef: DiscoveryCredentialRef
  }[]
  discover(providerId: string, credentialRef: DiscoveryCredentialRef): Promise<readonly DiscoveryRow[]>
}

/** A discovery refusal, reduced to what a selection surface can act on. */
interface DiscoveryFailure {
  /** Stable machine code from the catalog or adapter vocabulary. */
  readonly code?: string
  /** Safe, bounded diagnosis text. */
  readonly message: string
}

/**
 * Read the discovery rows one route's listing is resolved from, discovering
 * once when the mounted catalog links this route to a provider. A provider
 * whose rows feed no runtime route is left alone, and an absent catalog or a
 * refusal is reported rather than thrown.
 * @param catalog - the optional model catalog service.
 * @param routeId - the LLM route whose listing is being projected.
 * @returns the discovered rows, and the refusal when the discover call failed.
 */
async function discoverRoute(
  catalog: DiscoveryCatalog | undefined,
  routeId: string,
): Promise<{ rows: readonly DiscoveryRow[]; failure?: DiscoveryFailure }> {
  const descriptor = catalog?.providers().find(entry => entry.routes.includes(routeId))
  if (catalog === undefined || descriptor === undefined) return { rows: [] }
  try {
    return { rows: await catalog.discover(descriptor.id, descriptor.credentialRef) }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return {
      rows: [],
      failure: {
        ...typeof code === 'string' ? { code } : {},
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const discovery = ctx.get('faberloomModelCatalog') as DiscoveryCatalog | undefined
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    // Discovery runs first: an adapter whose listing is resolved from it reads
    // the snapshot this call just recorded, so an open picker shows the ids the
    // provider serves with no separate reconcile step.
    const { rows, failure } = await discoverRoute(discovery, provider.id)
    try {
      const models = await ctx.llm.listModels(provider.id)
      // A provider that resolves its listing from discovery and discovered
      // nothing has no honest catalog: report the refusal instead of an empty
      // or fabricated group, so a keyless or unreachable provider is visible.
      if (models.length === 0 && failure !== undefined) {
        return {
          kind: 'failure' as const,
          failure: {
            id: provider.id,
            name: provider.name,
            message: failure.message,
            ...failure.code === undefined ? {} : { code: failure.code },
          },
        }
      }
      const declared = new Map(rows.map(row => [row.id, row]))
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        // Capacities come from the provider's own declaration, never from a
        // default: a value it did not state stays absent rather than invented.
        const discovered = declared.get(model.id)
        const contextWindow = discovered?.contextWindow ?? resolved.context?.contextWindow
        const maxOutputTokens = discovered?.maxOutputTokens
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        } satisfies ModelCatalogModel
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    default: { ...defaultSelection },
    routableProviders: providers.map(provider => provider.id),
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
      .filter(group => group.models.length > 0),
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}
