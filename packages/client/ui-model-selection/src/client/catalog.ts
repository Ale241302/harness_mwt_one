/** One Host-generation model catalog shared by every Session selector. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/**
 * How long a loaded catalog stays fresh. Opening the picker inside this window
 * renders the cached list; outside it, the open refreshes. It is a product
 * freshness policy rather than a deployment tunable: a model the provider adds
 * appears on the next open once the window lapses, and every entry on a Host
 * event still refreshes immediately.
 */
export const DEFAULT_CATALOG_TTL_MS = 5 * 60 * 1000

/** Observable lifecycle of the shared model catalog. */
export interface ModelCatalogState {
  value: ModelCatalog | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** Epoch milliseconds of the successful load the current value came from; null before the first. */
  lastCheckedAt: number | null
}

/** Loads at most one model catalog for the current Host generation, re-reading it once {@link DEFAULT_CATALOG_TTL_MS} lapses. */
export class ModelCatalogDirectory {
  /** Current shared catalog value, load lifecycle, and last successful check time. */
  readonly store: SnapshotStore<ModelCatalogState> = createSnapshotStore({
    value: null,
    status: 'idle',
    error: null,
    lastCheckedAt: null,
  })

  private generation = 0
  private inflight: Promise<ModelCatalog> | undefined

  /**
   * @param ctx - the providing plugin's context, whose `remote.session`
   * namespace carries the Host-generation catalog.
   * @param ttlMs - how long a loaded value stays fresh before an open refreshes it.
   */
  constructor(private readonly ctx: ClientContext, private readonly ttlMs: number) {}

  /**
   * Return the current generation's catalog when it is still fresh, otherwise
   * reload; concurrent callers share the one in-flight load.
   * @returns the loaded global catalog.
   */
  load(): Promise<ModelCatalog> {
    const state = this.store.getSnapshot()
    if (this.fresh(state)) return Promise.resolve(state.value as ModelCatalog)
    if (this.inflight !== undefined) return this.inflight
    const generation = this.generation
    this.store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    const operation = this.ctx.remote.session.modelCatalog().then((response) => {
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      if (generation === this.generation) {
        this.store.set({ value: response.value, status: 'ready', error: null, lastCheckedAt: Date.now() })
      }
      return response.value
    }).catch((error: unknown) => {
      if (generation === this.generation) {
        this.store.update((draft) => {
          draft.status = 'error'
          draft.error = error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }).finally(() => {
      if (generation === this.generation && this.inflight === operation) this.inflight = undefined
    })
    this.inflight = operation
    return operation
  }

  /** Whether one snapshot carries a value loaded inside the freshness window. */
  private fresh(state: ModelCatalogState): boolean {
    return state.status === 'ready'
      && state.value !== null
      && state.lastCheckedAt !== null
      && Date.now() - state.lastCheckedAt < this.ttlMs
  }

  /**
   * Invalidate the loaded catalog; the next explicit menu read reloads it.
   * @param clear - whether values from the previous Host generation must be hidden.
   */
  private invalidate(clear = false): void {
    this.generation += 1
    this.inflight = undefined
    const previous = this.store.getSnapshot()
    this.store.set({
      value: clear ? null : previous.value,
      status: 'idle',
      error: null,
      lastCheckedAt: clear ? null : previous.lastCheckedAt,
    })
  }

  /** Invalidate and reload the catalog after a Host-side model input changes. */
  refresh(): void {
    this.invalidate()
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }

  /** Clear Host-specific values and load the replacement Host generation. */
  resetGeneration(): void {
    this.invalidate(true)
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }
}
