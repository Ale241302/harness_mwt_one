/**
 * In-memory object store used only by the publication specs. It keeps the
 * exact objects it was given, counts writes and reads so a spec can prove an
 * object was reused, and can corrupt one object to prove digest verification.
 * @module @deepseek-ai/dsh-faberloom-publication/tests/support/memory-store
 */

import type { PublicationObject, PublicationObjectStore } from '../../src/index.ts'

/** One stored object in memory. */
export class MemoryPublicationStore implements PublicationObjectStore {
  /** Objects by key. */
  readonly objects = new Map<string, PublicationObject>()
  /** Objects written, including a rewrite of the same key. */
  puts = 0
  /** Objects read. */
  gets = 0

  async put(object: PublicationObject): Promise<void> {
    this.puts += 1
    this.objects.set(object.key, {
      key: object.key,
      bytes: Uint8Array.from(object.bytes),
      contentType: object.contentType,
      metadata: { ...object.metadata },
    })
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    this.gets += 1
    const found = this.objects.get(key)
    return found === undefined ? undefined : Uint8Array.from(found.bytes)
  }

  /**
   * Replace one stored object's bytes without changing its key.
   * @param key - object key.
   */
  corrupt(key: string): void {
    const found = this.objects.get(key)
    if (found === undefined) throw new Error(`no object at ${key}`)
    this.objects.set(key, { ...found, bytes: new TextEncoder().encode('corrupted') })
  }
}
