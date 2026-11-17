/**
 * One in-process `memory` backend for the Loader composition. The pool lives in
 * the module, so a second boot over the same process sees the rules the first
 * one wrote: that is what "persistent composition" means here without touching
 * the filesystem.
 */

import type { Context } from '@deepseek-ai/cordis'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** Backing bytes shared by every boot in this process. */
const pool = new MemoryMediaPool()

/** Cordis plugin name. */
export const name = 'test-memory-storage'

/** The hub must exist before the backend can register. */
export const inject = ['storage']

/**
 * Register the `memory` backend and publish the lifecycle service the domain
 * form waits on.
 * @param ctx - the composition context.
 */
export function apply(ctx: Context): void {
  const backend = new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('memory', backend), 'test-memory-storage.register')
  ctx.provide(storageBackendServiceKey('memory'), backend)
}
