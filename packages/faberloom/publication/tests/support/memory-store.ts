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
  /** Refuse every write, simulating an unavailable source. */
  failPuts = false
  /** Refuse every read, simulating an unavailable source. */
  failGets = false
  /** Protect every key written from this point, simulating COMPLIANCE lock. */
  protectOnPut = false
  private readonly protectedKeys = new Set<string>()

  async put(object: PublicationObject): Promise<void> {
    if (this.failPuts) throw new Error('faberloom: PUBLICATION_STORE_UNAVAILABLE — simulated source down')
    const existing = this.objects.get(object.key)
    if (existing !== undefined && this.protectedKeys.has(object.key)
      && Buffer.compare(Buffer.from(existing.bytes), Buffer.from(object.bytes)) !== 0) {
      throw new Error('faberloom: PUBLICATION_RETENTION — COMPLIANCE retention refuses the overwrite')
    }
    this.puts += 1
    this.objects.set(object.key, {
      key: object.key,
      bytes: Uint8Array.from(object.bytes),
      contentType: object.contentType,
      metadata: { ...object.metadata },
    })
    if (this.protectOnPut) this.protectedKeys.add(object.key)
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    if (this.failGets) throw new Error('faberloom: PUBLICATION_STORE_UNAVAILABLE — simulated source down')
    this.gets += 1
    const found = this.objects.get(key)
    return found === undefined ? undefined : Uint8Array.from(found.bytes)
  }

  /**
   * Attempt to delete one protected object, as the publisher identity would.
   * @param key - object key.
   * @returns never when the key is protected.
   */
  remove(key: string): void {
    if (this.protectedKeys.has(key)) {
      throw new Error('faberloom: PUBLICATION_RETENTION — COMPLIANCE retention refuses the delete')
    }
    this.objects.delete(key)
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
