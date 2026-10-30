/**
 * A fake storage-domain surface for the mirror's traversal: the same
 * `(domain, table) -> KvTable` the real facility exposes, backed by maps, so a
 * spec pins the document behavior without a storage backend. Only tables a spec
 * declares are open, exactly as a real domain exposes only what its spec
 * declares.
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MirrorDomainSource, MirrorLiveDomain } from '../src/sync.ts'

/** One declared table: a key-to-value map with the surface a mirror traversal reads. */
export interface FakeTable {
  /** Read one row, or undefined when it is absent. */
  get(key: string): unknown
  /** Every row, as `[key, value]`. */
  entries(): IterableIterator<[string, unknown]>
  /** Write one row. */
  put(key: string, value: unknown): Promise<void>
  /** Remove one row. */
  delete(key: string): Promise<boolean>
}

/** A `domain -> declared table -> rows` map with the surface a mirror traversal reads. */
export class FakeDomains implements MirrorDomainSource {
  private readonly declared = new Map<string, Map<string, FakeTable>>()

  /** Open one declared table and return its rows. */
  openTable(domain: string, table: string): FakeTable {
    const tables = this.openDomain(domain)
    const existing = tables.get(table)
    if (existing !== undefined) return existing
    const rows = new Map<string, unknown>()
    const handle: FakeTable = {
      get: (key: string) => rows.get(key),
      entries: () => rows.entries(),
      put: async (key: string, value: unknown) => { rows.set(key, value) },
      delete: async (key: string) => rows.delete(key),
    }
    tables.set(table, handle)
    return handle
  }

  /** Open one domain so its declared tables are reachable. */
  openDomain(domain: string): Map<string, FakeTable> {
    const existing = this.declared.get(domain)
    if (existing !== undefined) return existing
    const created = new Map<string, FakeTable>()
    this.declared.set(domain, created)
    return created
  }

  /**
   * One open domain, or undefined when no table of it was declared.
   * @param name - declared domain name.
   * @returns the live domain, when the fake holds one.
   */
  get(name: string): MirrorLiveDomain | undefined {
    const tables = this.declared.get(name)
    if (tables === undefined) return undefined
    return {
      table: (table: string): KvTable<string, unknown> => {
        const handle = tables.get(table)
        if (handle === undefined) throw new Error(`fake: no table ${name}/${table}`)
        return handle as unknown as KvTable<string, unknown>
      },
    }
  }
}
