/**
 * The six proforma controls registered against a fake MWT.ONE client: the
 * classes the board declares, and the failure each missing datum produces.
 */

import { describe, expect, it } from 'vitest'
import { PROFORMA_CHECKS } from '@deepseek-ai/dsh-faberloom-board'
import { mwtCheckSource, registerProformaChecks } from '../src/source.ts'
import type {
  BoardCheckClass,
  BoardCheckFn,
  BoardCheckInput,
  BoardCheckRegistrar,
  BoardCheckSource,
  FaberLoomBoardItem,
} from '@deepseek-ai/dsh-faberloom-board'
import type { MwtCheckClient } from '../src/types.ts'

/** The draft the controls evaluate. */
const DRAFT: Record<string, unknown> = {
  orderRef: 'OC-505288',
  lines: [
    { sku: 'ART-1', quantity: 2, unitPrice: 120.5 },
    { sku: 'ART-2', quantity: 1, unitPrice: 45 },
  ],
  total: 286,
  separation: 'new',
}

/** One registration the recording board received. */
interface Registered {
  readonly fn: BoardCheckFn
  readonly class: BoardCheckClass
}

/**
 * A registrar that records what an adapter registers.
 * @returns the registrar and its live entries.
 */
function recordingBoard(): { board: BoardCheckRegistrar; entries: Map<string, Registered> } {
  const entries = new Map<string, Registered>()
  const board: BoardCheckRegistrar = {
    registerCheck(_artifactType, checkId, fn, options) {
      entries.set(checkId, { fn, class: options.class })
      return () => {
        entries.delete(checkId)
      }
    },
  }
  return { board, entries }
}

/**
 * The check input for one source port.
 * @param source - source port the registration carried.
 * @returns item, artifact, and source.
 */
function checkInput(source: BoardCheckSource): BoardCheckInput {
  return {
    // The controls read only these two item fields; a full item fixture adds nothing.
    item: { accountRef: 'eguisa', businessKey: 'PF 2520-2026' } as FaberLoomBoardItem,
    artifact: { type: 'proforma', version: 1, content: DRAFT },
    source,
  }
}

/**
 * A fake client that answers from the draft.
 * @param overrides - reads this client answers differently.
 * @returns the client.
 */
function fakeClient(overrides: Partial<MwtCheckClient> = {}): MwtCheckClient {
  return {
    expediente: async reference => ({
      reference,
      lines: [{ sku: 'ART-1', quantity: 2 }, { sku: 'ART-2', quantity: 1 }],
    }),
    skuExists: async () => true,
    stockAvailable: async () => 10,
    priceBand: async () => ({ bandId: 2, paymentDays: 30 }),
    catalogPrice: async sku => sku === 'ART-1'
      ? { listPrice: 100.5, clientPrice: 120.5 }
      : { listPrice: 40, clientPrice: 45 },
    ...overrides,
  }
}

/**
 * Register the controls and run one of them.
 * @param client - the MWT.ONE client under test.
 * @param checkId - declared control to run.
 * @returns the result the control reported.
 */
async function runCheck(client: MwtCheckClient, checkId: string): Promise<Awaited<ReturnType<BoardCheckFn>>> {
  const { board, entries } = recordingBoard()
  registerProformaChecks(board, client)
  const registration = entries.get(checkId)
  if (registration === undefined) throw new Error(`${checkId} was not registered`)
  return await registration.fn(checkInput(mwtCheckSource(client)))
}

describe('MWT proforma checks', () => {
  it('registers the six declared controls with their signed classes', () => {
    const { board, entries } = recordingBoard()
    const dispose = registerProformaChecks(board, fakeClient())
    expect([...entries.entries()].map(([id, entry]) => [id, entry.class])).toEqual(
      PROFORMA_CHECKS.map(definition => [definition.id, definition.class]),
    )
    dispose()
    expect(entries.size).toBe(0)
  })

  it('fails the blocking price control when the catalog holds no list price', async () => {
    const result = await runCheck(fakeClient({ catalogPrice: async () => null }), 'proforma.price')
    expect(result).toMatchObject({ status: 'fail', reason: 'PRICE_SOURCE_MISSING', source: 'mwt.price' })
  })

  it('fails the blocking SKU control when the catalog does not know a billed SKU', async () => {
    const result = await runCheck(fakeClient({ skuExists: async () => false }), 'proforma.sku')
    expect(result).toMatchObject({ status: 'fail', reason: 'SKU_UNKNOWN', source: 'mwt.catalog' })
  })

  it('leaves the confirmation-class stock control in failure when stock is missing', async () => {
    const client = fakeClient({ stockAvailable: async () => null })
    const { board, entries } = recordingBoard()
    registerProformaChecks(board, client)
    const stock = entries.get('proforma.stock')
    expect(stock?.class).toBe('confirmacion')
    const result = await stock?.fn(checkInput(mwtCheckSource(client)))
    expect(result).toMatchObject({ status: 'fail', reason: 'STOCK_SOURCE_MISSING', source: 'mwt.stock' })
  })

  it('never passes the separation control silently: no MWT read states the split rule', async () => {
    const client = fakeClient()
    const { board, entries } = recordingBoard()
    registerProformaChecks(board, client)
    const separation = entries.get('proforma.separation')
    expect(separation?.class).toBe('confirmacion')
    const result = await separation?.fn(checkInput(mwtCheckSource(client)))
    expect(result).toMatchObject({ status: 'fail', reason: 'SEPARATION_SOURCE_MISSING' })
  })

  it('passes the price, SKU, quantity, total, and stock controls on a complete answer', async () => {
    for (const checkId of ['proforma.price', 'proforma.sku', 'proforma.quantity', 'proforma.total', 'proforma.stock']) {
      const result = await runCheck(fakeClient(), checkId)
      expect(result, checkId).toMatchObject({ status: 'ok', reason: null })
    }
  })

  it('lets a client error escape so the board reports the control as failed', async () => {
    const client = fakeClient({ catalogPrice: async () => { throw new Error('mwt timeout') } })
    await expect(runCheck(client, 'proforma.price')).rejects.toThrow('mwt timeout')
  })
})
