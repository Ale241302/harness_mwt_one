/**
 * Advisory model fallback shared by every DeepSeek protocol, for a deployment
 * that has not discovered anything yet: the ids the official `GET /models`
 * endpoint served when this list was last reviewed. The discovery path is the
 * live source of truth — `ctx.faberloomModelCatalog.discover('deepseek', ref)`
 * asks the provider, and `ctx.faberloomAgents.reconcileModels('deepseek', ref)`
 * folds the answer into the routable model pool — so a model the provider adds
 * appears without a release.
 */

import { DEFAULT_CONTEXT_WINDOW } from './defaults.ts'
import type { DeepSeekCatalogModel } from './types.ts'

/**
 * Advisory official model entries; deployments may replace the catalog.
 * `deepseek-flash` and `deepseek-v4-pro` are the ids the provider served when
 * this fallback was last reviewed; an entry here is not a claim about what the
 * endpoint serves today.
 */
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek-V41-Flash',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'],
    systemPromptUpdate: 'in-history',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
]
