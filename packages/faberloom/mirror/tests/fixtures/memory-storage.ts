/**
 * One in-process `memory` backend for the Loader composition: the storage hub
 * registered by the fixture config routes every product domain here, so the
 * spec exercises the real storage-domain form without touching the filesystem.
 */

import type { Context } from '@deepseek-ai/cordis'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'

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
  const backend = new MemoryStorageBackend(new MemoryMediaPool())
  ctx.effect(() => ctx.storage.backend.register('memory', backend), 'test-memory-storage.register')
  ctx.provide(storageBackendServiceKey('memory'), backend)
}
