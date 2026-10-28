/**
 * Shared board test harness: the real storage/domain composition, two owners,
 * two companies, and the golden proforma fixture.
 * @module @deepseek-ai/dsh-faberloom-board/tests/helpers/harness
 */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomBoard from '../../src/index.ts'
import type { BoardActor, FaberLoomBoardItem } from '../../src/index.ts'

/** Owner and company used by the isolation suites. */
export const OWNER_A = 'compras2@sondelsa.com'
export const OWNER_B = 'otro@sonepar.com'
export const COMPANY_A = 'co-sondel'
export const COMPANY_B = 'co-sonepar'
export const ACTOR_A: BoardActor = { id: OWNER_A, companyId: COMPANY_A }
export const ACTOR_B: BoardActor = { id: OWNER_B, companyId: COMPANY_B }

/** The synthetic proforma every check suite can reuse. */
export interface ProformaFixture {
  readonly artifactType: string
  readonly accountRef: string
  readonly sourceRef: string
  readonly currency: string
  readonly lines: readonly { readonly sku: string; readonly description: string; readonly quantity: number; readonly unitPrice: number }[]
  readonly total: number
  readonly expected: Record<string, unknown>
}

let cachedProforma: ProformaFixture | undefined

/** Read the golden proforma from disk once per process. */
export function proformaFixture(): ProformaFixture {
  cachedProforma ??= JSON.parse(
    readFileSync(new URL('../fixtures/proforma-eguisa.json', import.meta.url), 'utf8'),
  ) as ProformaFixture
  return cachedProforma
}

/** Boot the storage/domain composition the board package runs on. */
export async function bootBoard(): Promise<{ ctx: Context; board: FaberLoomBoard }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomBoard)
  return { ctx, board: ctx.faberloomBoard }
}

/** Create one item from the golden fixture for the given owner and company. */
export async function seedProforma(
  board: FaberLoomBoard,
  ownerId: string,
  companyId: string,
  spaceId = 'sp-eguisa',
): Promise<FaberLoomBoardItem> {
  const fixture = proformaFixture()
  const summary = `${fixture.sourceRef}: ${String(fixture.lines.length)} líneas · ${fixture.total.toFixed(2)} ${fixture.currency}`
  return await board.create({ id: ownerId, companyId }, {
    title: `Proforma ${fixture.sourceRef}`,
    summary,
    evidence: [`oc:${fixture.sourceRef}`, `fx:${fixture.currency}`],
    spaceId,
  })
}
