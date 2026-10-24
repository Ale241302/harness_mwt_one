/**
 * Storage-domain traversal for the mirror: read every declared domain and table
 * into a transfer document, and apply a received document back with `put` and
 * `delete`. The traversal is the same generic `(domain, table, key) -> JSON`
 * walk the product backup uses; what differs is the document and the tombstone
 * rule, because the mirror must carry deletions between two live homes.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/sync
 */

import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { FABERLOOM_MIRROR_DOMAINS, FABERLOOM_MIRROR_FORMAT_VERSION } from './document.ts'
import type { FaberLoomMirrorDocument, FaberLoomMirrorRow, FaberLoomMirrorRowChange, FaberLoomMirrorSkip } from './types.ts'

/**
 * The storage-domain facility as this traversal reads and writes it. The
 * facility's own generic surface is untyped by design; the mirror addresses
 * domains by declared name and handles the type erasure here.
 */
export interface MirrorDomainSource {
  /** One open domain, or undefined when this process did not mount it. */
  get(name: string): MirrorLiveDomain | undefined
  /**
   * Format version stamped on one domain's medium, when this source can read it.
   * The peer needs it to create a document this side holds rows for; a source
   * without a medium (a pure in-memory fake) omits it.
   */
  versionOf?(name: string): number | undefined
}

/** One open domain as the traversal reaches it. */
export interface MirrorLiveDomain {
  /** One declared table of the domain. */
  table(name: string): KvTable<string, unknown>
}

/**
 * Whether one mirrored row belongs to the installation that holds it and must
 * not travel.
 *
 * The deployment baseline agents are seeded by every home from the same
 * catalogue, and a shared agent is materialized by each home from the console
 * shares it can read under its own id. Carrying either kind leaves the peer with
 * a second row of the same name — the duplicate rows the catalogue showed. A
 * user-created agent, a Space, and every other product row still travel.
 * @param domain - declared domain of the row.
 * @param table - table of the row.
 * @param value - the row's record.
 * @returns whether the row stays in the home that holds it.
 */
function staysLocal(domain: string, table: string, value: unknown): boolean {
  if (domain !== 'faberloom_agents' || table !== 'agents') return false
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record['seeded'] === true && (typeof record['ownerId'] !== 'string' || record['ownerId'].length === 0)) return true
  return typeof record['originRef'] === 'string' && record['originRef'].startsWith('share:')
}

/**
 * Keep the local Workspace binding when a Space row arrives from the peer.
 *
 * A Workspace id names one home's registry: the peer's id does not resolve
 * here, and writing it would leave the Space pointing at a folder this home does
 * not hold. The rest of the row still lands, so memory, context, parentage, and
 * the title travel; each home binds the Space to its own folder.
 * @param domain - declared domain of the row.
 * @param table - table of the row.
 * @param current - the row this home holds, when any.
 * @param incoming - the row the peer sent.
 * @returns the value to store.
 */
function preserveLocalSpaceBinding(domain: string, table: string, current: unknown, incoming: unknown): unknown {
  if (domain !== 'faberloom_spaces' || table !== 'spaces') return incoming
  if (typeof current !== 'object' || current === null || Array.isArray(current)) return incoming
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return incoming
  const local = (current as Record<string, unknown>)['workspaceId']
  if (typeof local !== 'string' || local.length === 0) return incoming
  return { ...(incoming as Record<string, unknown>), workspaceId: local }
}

/** What one document read produced. */
export interface MirrorReadResult {
  /** The transfer document, addressed by every domain the process holds open. */
  readonly document: FaberLoomMirrorDocument
  /** Declared locations with no open domain or table in this process. */
  readonly skipped: FaberLoomMirrorSkip[]
}

/**
 * Read every declared product domain the process holds open into one transfer
 * document. A domain this process did not mount, or a declared table it does
 * not expose, is named in `skipped` rather than reported as empty: the two
 * hosts keep different rows, and an absent domain must never read as a
 * deletion.
 * @param source - the storage-domain facility of this process.
 * @param platform - which side is reading.
 * @returns the document and the locations this process could not reach.
 */
export function readMirrorDocument(source: MirrorDomainSource, platform: 'web' | 'desktop'): MirrorReadResult {
  const domains: Record<string, { tables: Record<string, Record<string, FaberLoomMirrorRow>> }> = {}
  const skipped: FaberLoomMirrorSkip[] = []
  for (const [domainName, tables] of Object.entries(FABERLOOM_MIRROR_DOMAINS)) {
    const domain = source.get(domainName)
    if (domain === undefined) {
      skipped.push({ domain: domainName, table: '*', reason: 'domain-not-open' })
      continue
    }
    const domainTables: Record<string, Record<string, FaberLoomMirrorRow>> = {}
    for (const tableName of tables) {
      let table: KvTable<string, unknown>
      try {
        table = domain.table(tableName)
      } catch {
        // The declared table is not exposed by this build's domain spec; naming
        // it is the honest answer, and a write to it could not succeed anyway.
        skipped.push({ domain: domainName, table: tableName, reason: 'table-unknown' })
        continue
      }
      const rows: Record<string, FaberLoomMirrorRow> = {}
      for (const [key, value] of table.entries()) {
        if (staysLocal(domainName, tableName, value)) continue
        rows[key] = { deleted: false, value }
      }
      domainTables[tableName] = rows
    }
    const version = source.versionOf?.(domainName)
    domains[domainName] = { ...version === undefined ? {} : { version }, tables: domainTables }
  }
  return { document: { version: FABERLOOM_MIRROR_FORMAT_VERSION, platform, domains, skills: {} }, skipped }
}

/** Options accepted when applying one received document. */
export interface MirrorApplyOptions {
  /** Whether a row is written when the same key already holds a value. */
  readonly overwrite?: (domain: string, table: string, key: string) => boolean
}

/** What applying one document did. */
export interface MirrorApplyResult {
  /** Every location the document addressed, in arrival order. */
  readonly rows: FaberLoomMirrorRowChange[]
  /** Locations written (a tombstone counts as applied). */
  readonly applied: FaberLoomMirrorRowChange[]
  /** Locations the `overwrite` rule refused. */
  readonly kept: FaberLoomMirrorRowChange[]
  /** Declared locations with no open domain or table in this process. */
  readonly skipped: FaberLoomMirrorSkip[]
}

/**
 * Apply one received document to the domains open in this process. A row is
 * written with `put` (upsert) or removed with `delete` when its tombstone says
 * so. A domain or table this process does not expose is reported and skipped,
 * so the caller sees a partial application instead of believing the whole
 * document landed.
 * @param source - the storage-domain facility of this process.
 * @param document - a document that already passed {@link checkMirrorDocument}.
 * @param options - the per-row overwrite rule.
 * @returns the rows addressed, written, kept, and the locations skipped.
 */
export async function applyMirrorDocument(
  source: MirrorDomainSource,
  document: FaberLoomMirrorDocument,
  options: MirrorApplyOptions = {},
): Promise<MirrorApplyResult> {
  const rows: FaberLoomMirrorRowChange[] = []
  const applied: FaberLoomMirrorRowChange[] = []
  const kept: FaberLoomMirrorRowChange[] = []
  const skipped: FaberLoomMirrorSkip[] = []
  for (const [domainName, domainDocument] of Object.entries(document.domains)) {
    const domain = source.get(domainName)
    if (domain === undefined) {
      skipped.push({ domain: domainName, table: '*', reason: 'domain-not-open' })
      continue
    }
    for (const [tableName, tableRows] of Object.entries(domainDocument.tables)) {
      let table: KvTable<string, unknown>
      try {
        table = domain.table(tableName)
      } catch {
        skipped.push({ domain: domainName, table: tableName, reason: 'table-unknown' })
        continue
      }
      for (const [key, row] of Object.entries(tableRows)) {
        const change = { domain: domainName, table: tableName, key }
        rows.push(change)
        if (staysLocal(domainName, tableName, row.value)) {
          kept.push(change)
          continue
        }
        if (options.overwrite !== undefined && !options.overwrite(domainName, tableName, key)) {
          kept.push(change)
          continue
        }
        if (row.deleted) {
          await table.delete(key)
        } else {
          await table.put(key, preserveLocalSpaceBinding(domainName, tableName, table.get(key), row.value))
        }
        applied.push(change)
      }
    }
  }
  return { rows, applied, kept, skipped }
}
