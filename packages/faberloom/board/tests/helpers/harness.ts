/**
 * Shared board test harness: the real storage/domain composition, the real
 * Spaces service the board reads tenant references through, two owners, two
 * companies, the golden proforma fixture, and a raw-row seeder for records
 * written before the key-claim table existed.
 * @module @deepseek-ai/dsh-faberloom-board/tests/helpers/harness
 */

import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomSpaces from '../../../spaces/src/index.ts'
import FaberLoomBoard from '../../src/index.ts'
import { declaredChecks, registerProformaChecks } from '../../src/checks.ts'
import { boardDomainSpec, type BoardItemRecord } from '../../src/spec.ts'
import type {
  BoardActor,
  BoardCheckFn,
  BoardCheckSource,
  Config as BoardConfig,
  FaberLoomBoardItem,
  FaberLoomBoardItemId,
} from '../../src/index.ts'

/** Owner and company used by the isolation suites. */
export const OWNER_A = 'compras2@sondelsa.com'
export const OWNER_B = 'otro@sonepar.com'
/** A second owner inside {@link COMPANY_A}, for tenant-wide key uniqueness. */
export const OWNER_A2 = 'ventas@sondelsa.com'
export const COMPANY_A = 'co-sondel'
export const COMPANY_B = 'co-sonepar'
export const ACTOR_A: BoardActor = { id: OWNER_A, companyId: COMPANY_A }
export const ACTOR_B: BoardActor = { id: OWNER_B, companyId: COMPANY_B }
/** Another identity of the same tenant as {@link ACTOR_A}. */
export const ACTOR_A2: BoardActor = { id: OWNER_A2, companyId: COMPANY_A }

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

/** One booted board, its context, and the Spaces service it shares. */
export interface BoardHarness {
  readonly ctx: Context
  readonly board: FaberLoomBoard
  readonly spaces: FaberLoomSpaces
  readonly pool: MemoryMediaPool
}

/**
 * Boot the storage/domain composition the board package runs on.
 * @param options - a shared media pool, the board configuration row, and how the
 * harness mounts the proforma controls: `permissive` (the default) registers a
 * passing stub for every declared control so the command suites can approve a
 * proforma that carries no artifact content, and `none` leaves the registry
 * empty so a suite can prove a missing adapter rejects the approval.
 * @returns the context, board, Spaces service, and media pool.
 */
export async function bootBoard(
  options: { pool?: MemoryMediaPool; board?: BoardConfig; checks?: 'permissive' | 'none' } = {},
): Promise<BoardHarness> {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  await ctx.plugin(FaberLoomBoard, options.board)
  if (options.checks !== 'none') {
    for (const definition of declaredChecks('proforma')) {
      ctx.effect(() => ctx.faberloomBoard.registerCheck('proforma', definition.id, passingCheck, {
        class: definition.class,
      }), `harness.checks.${definition.id}`)
    }
  }
  return { ctx, board: ctx.faberloomBoard, spaces: ctx.faberloomSpaces, pool }
}

/** A check stub that passes without reading any source. */
const passingCheck: BoardCheckFn = () => ({
  status: 'ok', source: 'harness', sourceVersion: null, checkedAt: new Date().toISOString(), fields: [],
})

/**
 * Mount the real proforma controls against one source port, the way an E12
 * adapter mounts them from `ctx.effect`.
 * @param ctx - the booted context.
 * @param harness - the booted board.
 * @param source - source port the controls read.
 */
export function mountProformaChecks(ctx: Context, harness: BoardHarness, source: BoardCheckSource): void {
  ctx.effect(() => registerProformaChecks(harness.board, source), 'harness.checks.real')
}

/** The Spaces identity matching one board actor. */
export function spaceActor(actor: BoardActor): { id: string; role: string; companyId: string | undefined; readOnly: boolean } {
  return { id: actor.id, role: 'client_b2b', companyId: actor.companyId, readOnly: false }
}

/**
 * Create one Space owned by the actor.
 * @param harness - the booted board.
 * @param actor - the owner.
 * @param title - display title.
 * @param clients - `mwt-client` sources the Space serves; they gate account compatibility.
 * @returns the created Space id.
 */
export async function seedSpace(
  harness: BoardHarness,
  actor: BoardActor,
  title: string,
  clients: readonly string[] = [],
): Promise<string> {
  const identity = spaceActor(actor)
  const space = await harness.spaces.create(identity, { title })
  if (clients.length > 0) {
    await harness.spaces.update(identity, space.id, {
      sources: clients.map(id => ({ kind: 'mwt-client' as const, id })),
    })
  }
  return space.id
}

/** Create one item from the golden fixture for the given owner and company. */
export async function seedProforma(
  board: FaberLoomBoard,
  ownerId: string,
  companyId: string,
  spaceId?: string,
): Promise<FaberLoomBoardItem> {
  const fixture = proformaFixture()
  const summary = `${fixture.sourceRef}: ${String(fixture.lines.length)} líneas · ${fixture.total.toFixed(2)} ${fixture.currency}`
  return await board.create({ id: ownerId, companyId }, {
    title: `Proforma ${fixture.sourceRef}`,
    summary,
    evidence: [`oc:${fixture.sourceRef}`, `fx:${fixture.currency}`],
    ...spaceId === undefined ? {} : { spaceId },
  })
}

/**
 * A complete durable item record, as a row written before the claim table.
 * @param overrides - fields to replace.
 * @returns the record.
 */
export function rawBoardItem(overrides: Partial<BoardItemRecord> = {}): BoardItemRecord {
  const at = '2026-10-01T00:00:00.000Z'
  return {
    ownerId: OWNER_A,
    companyId: COMPANY_A,
    spaceId: null,
    routineId: null,
    title: 'Proforma heredada',
    status: 'waiting_approval',
    state: 'PENDIENTE_CRITERIO',
    rowVersion: 1,
    severity: 'MEDIUM',
    severitySource: 'HUMAN',
    severityConfidence: null,
    dueAt: null,
    valueAmount: null,
    valueCurrency: null,
    valueUsd: null,
    dataClass: 'N2',
    dataClassProvisional: true,
    runId: null,
    idempotencyKey: null,
    businessKey: null,
    supersedesItemId: null,
    artifactType: 'proforma',
    accountRef: null,
    artifactHash: 'hash-heredado',
    fieldOrigins: [],
    pendingCandidate: null,
    events: [],
    discardReason: null,
    discardNote: null,
    iterationId: null,
    iterationDraftKey: null,
    iterationLockUntil: null,
    iterationLockGeneration: 0,
    version: 1,
    revisions: [{ version: 1, summary: 'borrador', evidence: ['oc:505288'], content: null, documentRef: null, at }],
    approvedRevision: null,
    stale: false,
    staleReason: null,
    effects: [],
    reviews: [],
    executionId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

/**
 * Write one item record straight to a durable medium, the way a row written
 * before this version of the service looks: no key claim, no events.
 * @param pool - the media pool the board will boot against.
 * @param record - the record to store.
 * @returns the stored item id.
 */
export async function seedRawItem(pool: MemoryMediaPool, record: BoardItemRecord): Promise<FaberLoomBoardItemId> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(boardDomainSpec)
  const id = brandString<FaberLoomBoardItemId>(randomUUID())
  await domain.table('items').put(id, record)
  await domain.close()
  await ctx.fiber.dispose()
  return id
}

/**
 * The durable rows of one board table, read through the medium rather than the
 * service, so a check can see what a second process would load.
 * @param pool - the media pool the board booted against.
 * @param table - table name.
 * @returns the stored key to record map.
 */
export function durableRows(pool: MemoryMediaPool, table: string): Map<string, unknown> {
  const medium = pool.media.get('faberloom_board')
  const records: Map<string, unknown> | undefined = medium?.tables.get(table)
  return records ?? new Map<string, unknown>()
}
