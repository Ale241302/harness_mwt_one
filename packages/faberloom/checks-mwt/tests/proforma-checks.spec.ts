/**
 * The six proforma controls registered against the MCP-backed client over the
 * answers the live server gave: the classes the board declares, the per-line
 * overcharge D-01 signs, the quantity comparison the line read supports, and
 * the failure each missing datum produces.
 *
 * The captured answers live in `tests/fixtures/mwt-answers.json`. A test that
 * needs a different order states its reply where it is used, so no captured
 * value is overwritten by a guess.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROFORMA_CHECKS } from '@deepseek-ai/dsh-faberloom-board'
import { mcpMwtCheckClient } from '../src/client.ts'
import { mwtCheckSource, registerProformaChecks } from '../src/source.ts'
import type {
  BoardCheckClass,
  BoardCheckFn,
  BoardCheckInput,
  BoardCheckRegistrar,
  BoardCheckSource,
  FaberLoomBoardItem,
} from '@deepseek-ai/dsh-faberloom-board'
import type { MwtCheckClient, MwtToolCall, MwtToolName } from '../src/types.ts'

/** The captured answers, keyed by raw tool name. */
const ANSWERS = JSON.parse(
  readFileSync(new URL('./fixtures/mwt-answers.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

/** The one expediente row the captured listing carries. */
const LISTED = ANSWERS['expediente_listar'] as { readonly results: readonly Record<string, unknown>[] }
const ROW = LISTED.results[0]
if (ROW === undefined) throw new Error('the fixture must carry one expediente row')

/** The flat stock record the captured inventory answer carries. */
const STOCK = ANSWERS['stock_listar'] as Record<string, unknown>

/** The lines the captured answer carries, one block each. */
const LINES = ANSWERS['expediente_lineas'] as readonly Record<string, unknown>[]
const LINE = LINES[0]
if (LINE === undefined) throw new Error('the fixture must carry one line')

/** The draft the catalog, stock, and separation cases evaluate. */
const DRAFT: Record<string, unknown> = {
  orderRef: 'PO 110024463',
  lines: [{ sku: '700844', quantity: 2, unitPrice: 143 }],
  total: 286,
  separation: 'new',
}

/** The draft that bills the captured line: 5 units at 16.73, total 83.65. */
const LINE_DRAFT: Record<string, unknown> = {
  orderRef: 'PF 2521-2026',
  lines: [{ sku: '700010', quantity: 5, unitPrice: 16.73 }],
  total: 83.65,
  separation: 'new',
}

/** One registration the recording board received. */
interface Registered {
  readonly fn: BoardCheckFn
  readonly class: BoardCheckClass
}

/** One recorded MWT call. */
interface Call {
  readonly tool: MwtToolName
  readonly args: Record<string, unknown>
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
 * @param content - artifact content the control evaluates.
 * @returns item, artifact, and source.
 */
function checkInput(source: BoardCheckSource, content: Record<string, unknown> = DRAFT): BoardCheckInput {
  return {
    // The controls read only these two item fields; a full item fixture adds nothing.
    item: { accountRef: 'CLIENTE DEMO S.A.S.', businessKey: 'PF 2521-2026' } as FaberLoomBoardItem,
    artifact: { type: 'proforma', version: 1, content },
    source,
  }
}

/**
 * One listing page over the captured row.
 * @param overrides - row fields this test replaces.
 * @returns the `expediente_listar` answer.
 */
function listing(overrides: Record<string, unknown> = {}): unknown {
  return { count: 1, limit: 50, offset: 0, results: [{ ...ROW, ...overrides }] }
}

/**
 * A tool call over the captured answers, with per-test replacements.
 * @param replies - answers that replace the captured one for a tool.
 * @returns the call and its recorded invocations.
 */
function fixtureCall(replies: Partial<Record<MwtToolName, unknown>> = {}): { call: MwtToolCall; calls: Call[] } {
  const calls: Call[] = []
  const call: MwtToolCall = async (tool, args) => {
    calls.push({ tool, args })
    const reply = Object.hasOwn(replies, tool) ? replies[tool] : ANSWERS[tool]
    if (reply === undefined || reply === null) throw new Error(`the fake MWT server has no answer for ${tool}`)
    // The line read answers one text block per line; every other tool answers a
    // single block carrying its whole payload.
    const rows = Array.isArray(reply) ? reply : [reply]
    return { content: rows.map(row => ({ type: 'text', text: JSON.stringify(row) })) }
  }
  return { call, calls }
}

/** The client a price case reads: the captured listing with the totals the test states. */
function clientWithTotals(totalClient: number | null, totalMwt: number | null): MwtCheckClient {
  return mcpMwtCheckClient(fixtureCall({
    expediente_listar: listing({ total_client: totalClient, total_mwt: totalMwt }),
  }).call)
}

/** The line the captured answer carries, with the fields a test replaces. */
function line(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...LINE, ...overrides }
}

/**
 * Register the controls and run one of them.
 * @param client - the MWT.ONE client under test.
 * @param checkId - declared control to run.
 * @param content - artifact content the control evaluates.
 * @returns the result the control reported.
 */
async function runCheck(
  client: MwtCheckClient,
  checkId: string,
  content: Record<string, unknown> = DRAFT,
): Promise<Awaited<ReturnType<BoardCheckFn>>> {
  const { board, entries } = recordingBoard()
  registerProformaChecks(board, client)
  const registration = entries.get(checkId)
  if (registration === undefined) throw new Error(`${checkId} was not registered`)
  return await registration.fn(checkInput(mwtCheckSource(client), content))
}

describe('MWT proforma checks', () => {
  it('registers the six declared controls with their signed classes', () => {
    const { board, entries } = recordingBoard()
    const dispose = registerProformaChecks(board, mcpMwtCheckClient(fixtureCall().call))
    expect([...entries.entries()].map(([id, entry]) => [id, entry.class])).toEqual(
      PROFORMA_CHECKS.map(definition => [definition.id, definition.class]),
    )
    dispose()
    expect(entries.size).toBe(0)
  })

  it('passes the blocking price control when every billed overcharge matches the order', async () => {
    const result = await runCheck(clientWithTotals(83.65, 63.65), 'proforma.price', LINE_DRAFT)
    expect(result).toMatchObject({
      status: 'ok',
      reason: null,
      // The answer the control compared is the line read, so it names that source.
      source: 'mwt.order',
      fields: ['orderRef', 'lines[0].unitPrice'],
    })
  })

  it('fails the blocking price control when a billed line overcharges more than the order records', async () => {
    const billed = { ...LINE_DRAFT, lines: [{ sku: '700010', quantity: 5, unitPrice: 17.73 }], total: 88.65 }
    const result = await runCheck(clientWithTotals(88.65, 63.65), 'proforma.price', billed)
    expect(result).toMatchObject({
      status: 'fail',
      reason: 'PRICE_MISMATCH',
      source: 'mwt.order',
      fields: ['lines[0].unitPrice'],
    })
  })

  it('fails the price control when the order line states no unit_price_mwt', async () => {
    const client = mcpMwtCheckClient(fixtureCall({ expediente_lineas: line({ unit_price_mwt: null }) }).call)
    const result = await runCheck(client, 'proforma.price', LINE_DRAFT)
    expect(result).toMatchObject({
      status: 'fail',
      reason: 'PRICE_SOURCE_MISSING',
      source: 'mwt.order',
      fields: ['lines[0].unitPrice'],
    })
  })

  it('fails the price control when the order carries no line for a billed SKU', async () => {
    const other = {
      ...LINE_DRAFT,
      lines: [
        { sku: '700010', quantity: 5, unitPrice: 16.73 },
        { sku: '999999', quantity: 1, unitPrice: 10 },
      ],
      total: 93.65,
    }
    const result = await runCheck(clientWithTotals(93.65, 63.65), 'proforma.price', other)
    expect(result).toMatchObject({ status: 'fail', reason: 'PRICE_SOURCE_MISSING' })
  })

  it('fails the price control when the order total contradicts the billed total', async () => {
    const result = await runCheck(clientWithTotals(100, 63.65), 'proforma.price', LINE_DRAFT)
    expect(result).toMatchObject({
      status: 'fail',
      reason: 'PRICE_MISMATCH',
      source: 'mwt.price',
      fields: ['orderRef', 'total'],
    })
  })

  it('leaves the line comparison authoritative when the expediente states no order totals', async () => {
    const result = await runCheck(clientWithTotals(null, null), 'proforma.price', LINE_DRAFT)
    expect(result).toMatchObject({ status: 'ok', reason: null })
  })

  it('passes the blocking quantity control when the order quantities match the draft', async () => {
    const result = await runCheck(mcpMwtCheckClient(fixtureCall().call), 'proforma.quantity', LINE_DRAFT)
    expect(result).toMatchObject({
      status: 'ok',
      reason: null,
      source: 'mwt.order',
      fields: ['lines[0].quantity'],
    })
  })

  it('fails the blocking quantity control when a billed quantity differs', async () => {
    const billed = { ...LINE_DRAFT, lines: [{ sku: '700010', quantity: 6, unitPrice: 16.73 }], total: 100.38 }
    const result = await runCheck(mcpMwtCheckClient(fixtureCall().call), 'proforma.quantity', billed)
    expect(result).toMatchObject({
      status: 'fail',
      reason: 'QUANTITY_MISMATCH',
      source: 'mwt.order',
      fields: ['lines[0].quantity'],
    })
  })

  it('sums the order quantities of one SKU and size before comparing', async () => {
    const twoSizes = mcpMwtCheckClient(fixtureCall({
      expediente_lineas: { results: [line(), line({ size: '37', qty: '2.00' })] },
    }).call)
    const seven = { ...LINE_DRAFT, lines: [{ sku: '700010', quantity: 7, unitPrice: 16.73 }], total: 117.11 }
    expect(await runCheck(twoSizes, 'proforma.quantity', seven)).toMatchObject({ status: 'ok' })
    expect(await runCheck(twoSizes, 'proforma.quantity', LINE_DRAFT)).toMatchObject({
      status: 'fail',
      reason: 'QUANTITY_MISMATCH',
    })
  })

  it('fails the quantity control when a SKU appears on only one side', async () => {
    const twoSkus = mcpMwtCheckClient(fixtureCall({
      expediente_lineas: { results: [line(), line({ sku: '999999', qty: '1.00' })] },
    }).call)
    expect(await runCheck(twoSkus, 'proforma.quantity', LINE_DRAFT)).toMatchObject({
      status: 'fail',
      reason: 'ORDER_LINE_MISSING',
    })

    const missing = { ...LINE_DRAFT, lines: [{ sku: '999999', quantity: 5, unitPrice: 16.73 }] }
    const captured = mcpMwtCheckClient(fixtureCall().call)
    expect(await runCheck(captured, 'proforma.quantity', missing)).toMatchObject({
      status: 'fail',
      reason: 'ORDER_LINE_MISSING',
    })
  })

  it('fails the quantity control when the order answers no line at all', async () => {
    const client = mcpMwtCheckClient(fixtureCall({ expediente_lineas: { results: [] } }).call)
    const result = await runCheck(client, 'proforma.quantity', LINE_DRAFT)
    expect(result).toMatchObject({ status: 'fail', reason: 'ORDER_SOURCE_MISSING', source: 'mwt.order' })
  })

  it('reads a single object, a results page, and one block per line as the same answer', async () => {
    const shapes: unknown[] = [LINE, { count: 1, limit: 50, offset: 0, results: [LINE] }, [LINE]]
    const observed: unknown[] = []
    for (const shape of shapes) {
      const priceClient = mcpMwtCheckClient(fixtureCall({
        expediente_lineas: shape,
        expediente_listar: listing({ total_client: 83.65, total_mwt: 63.65 }),
      }).call)
      const lineClient = mcpMwtCheckClient(fixtureCall({ expediente_lineas: shape }).call)
      const price = await runCheck(priceClient, 'proforma.price', LINE_DRAFT)
      const quantity = await runCheck(lineClient, 'proforma.quantity', LINE_DRAFT)
      observed.push([
        { status: price.status, reason: price.reason, source: price.source },
        { status: quantity.status, reason: quantity.reason, source: quantity.source },
      ])
    }
    expect(observed[1]).toEqual(observed[0])
    expect(observed[2]).toEqual(observed[0])
  })

  it('fails the blocking SKU control when the catalog does not know a billed SKU', async () => {
    const client = mcpMwtCheckClient(fixtureCall({ producto_buscar: { productos: [], total: 0 } }).call)
    const result = await runCheck(client, 'proforma.sku')
    expect(result).toMatchObject({ status: 'fail', reason: 'SKU_UNKNOWN', source: 'mwt.catalog' })
  })

  it('passes the catalog control on the captured product and keeps zero as its price', async () => {
    const client = mcpMwtCheckClient(fixtureCall().call)
    expect(await runCheck(client, 'proforma.sku')).toMatchObject({ status: 'ok' })
    expect(await client.catalogPrice('700844')).toEqual({ price: 0, currency: 'USD' })
  })

  it('leaves the confirmation-class stock control in failure when stock is missing', async () => {
    const client = mcpMwtCheckClient(fixtureCall({
      stock_listar: { ...STOCK, cantidad_disponible: '' },
    }).call)
    const { board, entries } = recordingBoard()
    registerProformaChecks(board, client)
    const stock = entries.get('proforma.stock')
    expect(stock?.class).toBe('confirmacion')
    const result = await stock?.fn(checkInput(mwtCheckSource(client)))
    expect(result).toMatchObject({ status: 'fail', reason: 'STOCK_SOURCE_MISSING', source: 'mwt.stock' })
  })

  it('passes the stock control on the decimal quantity the inventory reports', async () => {
    const result = await runCheck(mcpMwtCheckClient(fixtureCall().call), 'proforma.stock')
    expect(result).toMatchObject({ status: 'ok', source: 'mwt.stock' })
  })

  it('treats an empty stock answer as zero units and leaves it at confirmation', async () => {
    const call: MwtToolCall = async tool => tool === 'stock_listar'
      ? { content: [] }
      : { content: [{ type: 'text', text: JSON.stringify(ANSWERS[tool]) }] }
    const client = mcpMwtCheckClient(call)
    const { board, entries } = recordingBoard()
    registerProformaChecks(board, client)
    const stock = entries.get('proforma.stock')
    expect(stock?.class).toBe('confirmacion')
    const result = await stock?.fn(checkInput(mwtCheckSource(client)))
    expect(result).toMatchObject({ status: 'fail', reason: 'STOCK_INSUFFICIENT', source: 'mwt.stock' })
  })

  it('never passes the separation control silently: no MWT read states the split rule', async () => {
    const client = mcpMwtCheckClient(fixtureCall().call)
    const { board, entries } = recordingBoard()
    registerProformaChecks(board, client)
    const separation = entries.get('proforma.separation')
    expect(separation?.class).toBe('confirmacion')
    const result = await separation?.fn(checkInput(mwtCheckSource(client)))
    expect(result).toMatchObject({ status: 'fail', reason: 'SEPARATION_SOURCE_MISSING' })
  })

  it('passes price, quantity, and total on the captured line', async () => {
    const client = clientWithTotals(83.65, 63.65)
    for (const checkId of ['proforma.price', 'proforma.quantity', 'proforma.total']) {
      const result = await runCheck(client, checkId, LINE_DRAFT)
      expect(result, checkId).toMatchObject({ status: 'ok', reason: null })
    }
  })

  it('lets a client error escape so the board reports the control as failed', async () => {
    const failing: MwtToolCall = async () => {
      throw new Error('mwt timeout')
    }
    await expect(runCheck(mcpMwtCheckClient(failing), 'proforma.price')).rejects.toThrow('mwt timeout')
  })
})
