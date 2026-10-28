/**
 * The six proforma controls registered against the MCP-backed client over the
 * answers the live server gave: the classes the board declares, the comparison
 * the price control can prove from an expediente total, and the failure each
 * missing datum produces.
 *
 * The answers live in `tests/fixtures/mwt-answers.json`; `expediente_lineas`
 * has none because the server requires an id no read returns.
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

/** The draft the controls evaluate; its total equals the client total below. */
const DRAFT: Record<string, unknown> = {
  orderRef: 'PO 110024463',
  lines: [{ sku: '700844', quantity: 2, unitPrice: 143 }],
  total: 286,
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
 * @returns item, artifact, and source.
 */
function checkInput(source: BoardCheckSource): BoardCheckInput {
  return {
    // The controls read only these two item fields; a full item fixture adds nothing.
    item: { accountRef: 'CLIENTE DEMO S.A.S.', businessKey: 'PF 2521-2026' } as FaberLoomBoardItem,
    artifact: { type: 'proforma', version: 1, content: DRAFT },
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
    return { content: [{ type: 'text', text: JSON.stringify(reply) }] }
  }
  return { call, calls }
}

/** The client the price cases read: the captured listing with the totals the test states. */
function clientWithTotals(totalClient: number | null, totalMwt: number | null): MwtCheckClient {
  return mcpMwtCheckClient(fixtureCall({
    expediente_listar: listing({ total_client: totalClient, total_mwt: totalMwt }),
  }).call)
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
    const dispose = registerProformaChecks(board, mcpMwtCheckClient(fixtureCall().call))
    expect([...entries.entries()].map(([id, entry]) => [id, entry.class])).toEqual(
      PROFORMA_CHECKS.map(definition => [definition.id, definition.class]),
    )
    dispose()
    expect(entries.size).toBe(0)
  })

  it('fails the blocking price control when the expediente totals differ', async () => {
    const result = await runCheck(clientWithTotals(300, 286), 'proforma.price')
    expect(result).toMatchObject({
      status: 'fail',
      reason: 'PRICE_MISMATCH',
      source: 'mwt.price',
      fields: ['orderRef', 'total'],
    })
  })

  it('passes the blocking price control when the billed total equals the client total', async () => {
    const client = clientWithTotals(286, 246)
    const result = await runCheck(client, 'proforma.price')
    expect(result).toMatchObject({ status: 'ok', reason: null, source: 'mwt.price', fields: ['orderRef', 'total'] })
  })

  it('fails the price control when the reference resolves to no expediente', async () => {
    const client = mcpMwtCheckClient(fixtureCall({
      expediente_buscar: { existe: false, total: 0, matches: [] },
    }).call)
    const result = await runCheck(client, 'proforma.price')
    expect(result).toMatchObject({ status: 'fail', reason: 'PRICE_SOURCE_MISSING', source: 'mwt.price' })
  })

  it('fails the price control when the expediente states no total_mwt', async () => {
    const result = await runCheck(clientWithTotals(286, null), 'proforma.price')
    expect(result).toMatchObject({ status: 'fail', reason: 'PRICE_SOURCE_MISSING', source: 'mwt.price' })
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

  it('never passes the quantity control: no read returns the expediente lines', async () => {
    const { call, calls } = fixtureCall({ expediente_listar: listing({ total_client: 286, total_mwt: 286 }) })
    const result = await runCheck(mcpMwtCheckClient(call), 'proforma.quantity')
    expect(result).toMatchObject({ status: 'fail', reason: 'ORDER_SOURCE_MISSING', source: 'mwt.order' })
    expect(calls.map(entry => entry.tool)).not.toContain('expediente_lineas')
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

  it('passes price, SKU, total, and stock on a complete answer', async () => {
    const client = clientWithTotals(286, 246)
    for (const checkId of ['proforma.price', 'proforma.sku', 'proforma.total', 'proforma.stock']) {
      const result = await runCheck(client, checkId)
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
