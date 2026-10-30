/**
 * Wire behavior of the MCP-backed client: which tools each read calls, how the
 * real MWT.ONE answers are unwrapped, that a missing field is null instead of a
 * substituted default, and that the line read accepts every recorded container.
 *
 * The answers in `tests/fixtures/mwt-answers.json` are sanitized copies of the
 * ones recorded from `mwt-one 1.30.0` (`.artifacts/mwt-shapes.md`), including
 * the one line object `expediente_lineas` answers for `PF 2521-2026`.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mcpMwtCheckClient } from '../src/client.ts'
import type { MwtToolCall, MwtToolName } from '../src/types.ts'

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

/** The lines the captured `expediente_lineas` answer carries, one block each. */
const LINES = ANSWERS['expediente_lineas'] as readonly Record<string, unknown>[]
const LINE = LINES[0]
if (LINE === undefined) throw new Error('the fixture must carry one line')

/** One recorded call the fake server received. */
interface Call {
  readonly tool: MwtToolName
  readonly args: Record<string, unknown>
}

/** The canonical MCP result a bridged tool returns for one JSON payload. */
function mcpText(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

/**
 * The canonical MCP result for one captured answer. `expediente_lineas` answers
 * one text block per line, so an array reply becomes one block per entry; every
 * other tool answers one block.
 * @param payload - captured answer.
 * @returns the MCP result value.
 */
function mcpAnswer(payload: unknown): unknown {
  if (!Array.isArray(payload)) return mcpText(payload)
  return { content: payload.map(entry => ({ type: 'text', text: JSON.stringify(entry) })) }
}

/**
 * A tool call over the captured answers, with per-test replacements.
 * @param replies - answers that replace the captured one for a tool.
 * @returns the call and its recorded invocations.
 */
function fakeServer(replies: Partial<Record<MwtToolName, unknown>> = {}): { call: MwtToolCall; calls: Call[] } {
  const calls: Call[] = []
  const call: MwtToolCall = async (tool, args) => {
    calls.push({ tool, args })
    const reply = Object.hasOwn(replies, tool) ? replies[tool] : ANSWERS[tool]
    if (reply === undefined || reply === null) throw new Error(`the fake MWT server has no answer for ${tool}`)
    return mcpAnswer(reply)
  }
  return { call, calls }
}

/**
 * One listing page over the captured row.
 * @param overrides - row fields this test replaces.
 * @returns the `expediente_listar` answer.
 */
function listing(overrides: Record<string, unknown> = {}): unknown {
  return { count: 1, limit: 50, offset: 0, results: [{ ...ROW, ...overrides }] }
}

describe('MCP-backed MWT client', () => {
  it('probes existence and matches the purchase-order code in the listing', async () => {
    const { call, calls } = fakeServer()
    const facts = await mcpMwtCheckClient(call).expediente('PO 110024463')
    expect(calls.map(entry => entry.tool)).toEqual(['expediente_buscar', 'expediente_listar'])
    expect(calls[0]?.args).toEqual({ oc_number: '110024463' })
    expect(facts).toEqual({
      reference: 'PO 110024463',
      totalClient: 22336.35,
      totalMwt: 22336.35,
      currency: 'USD',
      clientName: 'CLIENTE DEMO S.A.S.',
      creditDays: 90,
      creditBand: null,
    })
  })

  it('probes a proforma reference with the proforma argument', async () => {
    const { call, calls } = fakeServer()
    await mcpMwtCheckClient(call).expediente('PF 2521-2026')
    expect(calls[0]?.args).toEqual({ proforma: 'PF 2521-2026' })
  })

  it('pages the listing until the reference appears', async () => {
    const pages = [
      { count: 3, limit: 1, offset: 0, results: [{ ...ROW, proforma_codigos: ['PF 9999-2026'] }] },
      { count: 3, limit: 1, offset: 1, results: [{ ...ROW, proforma_codigos: ['PF 2521-2026'] }] },
      { count: 3, limit: 1, offset: 2, results: [{ ...ROW, proforma_codigos: ['PF 8888-2026'] }] },
    ]
    const offsets: unknown[] = []
    const call: MwtToolCall = async (tool, args) => {
      if (tool === 'expediente_buscar') return mcpText(ANSWERS['expediente_buscar'])
      if (tool !== 'expediente_listar') throw new Error(`unexpected tool ${tool}`)
      offsets.push(args['offset'])
      const page = pages[offsets.length - 1]
      if (page === undefined) throw new Error('the fake listing has no further page')
      return mcpText(page)
    }
    const facts = await mcpMwtCheckClient(call).expediente('PF 2521-2026')
    expect(offsets).toEqual([0, 1, 2])
    expect(facts?.reference).toBe('PF 2521-2026')
  })

  it('reports no expediente when the existence probe denies the reference', async () => {
    const { call, calls } = fakeServer({ expediente_buscar: { existe: false, total: 0, matches: [] } })
    expect(await mcpMwtCheckClient(call).expediente('PO 000000')).toBeNull()
    expect(calls.map(entry => entry.tool)).toEqual(['expediente_buscar'])
  })

  it('reports no expediente when no listed row names the reference', async () => {
    const { call } = fakeServer()
    expect(await mcpMwtCheckClient(call).expediente('PO 000000')).toBeNull()
  })

  it('refuses an ambiguous reference instead of choosing one row', async () => {
    const { call } = fakeServer({
      expediente_listar: { count: 2, limit: 2, offset: 0, results: [{ ...ROW }, { ...ROW }] },
    })
    expect(await mcpMwtCheckClient(call).expediente('PO 110024463')).toBeNull()
  })

  it('leaves a side the row omits null instead of guessing it', async () => {
    const { call } = fakeServer({ expediente_listar: listing({ total_mwt: null }) })
    const facts = await mcpMwtCheckClient(call).expediente('PO 110024463')
    expect(facts).toMatchObject({ totalClient: 22336.35, totalMwt: null })
  })

  it('reads the expediente lines with the reference, not an id', async () => {
    const { call, calls } = fakeServer()
    const lines = await mcpMwtCheckClient(call).orderLines('PF 2521-2026')
    expect(calls.map(entry => entry.tool)).toEqual(['expediente_lineas'])
    expect(calls[0]?.args).toEqual({ expediente_id: 'PF 2521-2026' })
    expect(lines).toEqual([{
      sku: '700010',
      size: '36',
      quantity: 5,
      unitPriceMwt: 16.73,
      unitPriceClient: 16.73,
    }])
  })

  it('reads one block holding a list, a results page, or a single object the same way', async () => {
    const shapes: unknown[] = [
      [LINE],
      { count: 1, limit: 50, offset: 0, results: [LINE] },
      LINE,
    ]
    for (const shape of shapes) {
      const call: MwtToolCall = async () => mcpText(shape)
      expect(await mcpMwtCheckClient(call).orderLines('PF 2521-2026'), JSON.stringify(shape).slice(0, 40))
        .toEqual([{ sku: '700010', size: '36', quantity: 5, unitPriceMwt: 16.73, unitPriceClient: 16.73 }])
    }
  })

  it('reads one text block per line, the form the deployed server answers', async () => {
    const rows = [LINE, { ...LINE, size: '37', qty: '10.00' }]
    const call: MwtToolCall = async () => ({
      content: rows.map(row => ({ type: 'text', text: JSON.stringify(row) })),
    })
    const lines = await mcpMwtCheckClient(call).orderLines('PF 2521-2026')
    expect(lines?.map(line => [line.sku, line.size, line.quantity])).toEqual([
      ['700010', '36', 5],
      ['700010', '37', 10],
    ])
  })

  it('rejects a line block that carries no JSON', async () => {
    const call: MwtToolCall = async () => ({ content: [{ type: 'text', text: 'no disponible' }] })
    await expect(mcpMwtCheckClient(call).orderLines('PF 2521-2026')).rejects.toThrow('carries no JSON')
  })

  it('keeps a price side the line omits null instead of substituting one', async () => {
    const withoutMwt = { ...LINE }
    delete withoutMwt['unit_price_mwt']
    const { call } = fakeServer({ expediente_lineas: withoutMwt })
    const lines = await mcpMwtCheckClient(call).orderLines('PF 2521-2026')
    expect(lines).toEqual([{
      sku: '700010',
      size: '36',
      quantity: 5,
      unitPriceMwt: null,
      unitPriceClient: 16.73,
    }])
  })

  it('reports no lines when the order answers an empty list or a row it cannot attribute', async () => {
    const empty = fakeServer({ expediente_lineas: { results: [] } })
    expect(await mcpMwtCheckClient(empty.call).orderLines('PF 2521-2026')).toBeNull()

    const noQuantity = fakeServer({ expediente_lineas: { ...LINE, qty: '' } })
    expect(await mcpMwtCheckClient(noQuantity.call).orderLines('PF 2521-2026')).toBeNull()

    const notLines = fakeServer({ expediente_lineas: { detail: 'no disponible' } })
    expect(await mcpMwtCheckClient(notLines.call).orderLines('PF 2521-2026')).toBeNull()
  })

  it('requires an exact SKU match, not a fuzzy search hit', async () => {
    const { call } = fakeServer({
      producto_buscar: { productos: [{ id: 'p-1', sku: '7008440', precio_venta: 1 }], total: 1 },
    })
    expect(await mcpMwtCheckClient(call).skuExists('700844')).toBe(false)
  })

  it('reads a zero catalog price as a stated price, not as absence', async () => {
    const { call } = fakeServer()
    const client = mcpMwtCheckClient(call)
    expect(await client.skuExists('700844')).toBe(true)
    expect(await client.catalogPrice('700844')).toEqual({ price: 0, currency: 'USD' })
  })

  it('sums the decimal quantity of the flat stock answer', async () => {
    const flat = fakeServer()
    expect(await mcpMwtCheckClient(flat.call).stockAvailable('700844')).toBe(200)

    const listed = fakeServer({
      stock_listar: { results: [{ ...STOCK, cantidad_disponible: '4.500' }, { ...STOCK, cantidad_disponible: 2 }] },
    })
    expect(await mcpMwtCheckClient(listed.call).stockAvailable('700844')).toBe(6.5)
  })

  it('refuses a stock record without a readable quantity', async () => {
    const { call } = fakeServer({ stock_listar: { ...STOCK, cantidad_disponible: '' } })
    expect(await mcpMwtCheckClient(call).stockAvailable('700844')).toBeNull()
  })

  it('reports no stock when the answer lists only other SKUs', async () => {
    const { call } = fakeServer({
      stock_listar: { results: [{ ...STOCK, producto_sku: 'OTHER-1' }] },
    })
    expect(await mcpMwtCheckClient(call).stockAvailable('700844')).toBeNull()
  })

  it('reads an empty stock answer as zero available units, not as a failed read', async () => {
    const call: MwtToolCall = async tool => tool === 'stock_listar'
      ? { content: [] }
      : mcpAnswer(ANSWERS[tool as MwtToolName])
    expect(await mcpMwtCheckClient(call).stockAvailable('700844')).toBe(0)
  })

  it('reports no stock when the catalog holds no such SKU', async () => {
    const { call } = fakeServer({ producto_buscar: { productos: [], total: 0 } })
    expect(await mcpMwtCheckClient(call).stockAvailable('700844')).toBeNull()
  })

  it('reads the band and payment term from the price answer', async () => {
    const { call, calls } = fakeServer()
    expect(await mcpMwtCheckClient(call).priceBand('700844')).toEqual({ bandId: 7, paymentDays: 90 })
    expect(calls[0]?.args).toEqual({ sku: '700844' })
  })

  it('reports no band when the answer states neither a band nor a term', async () => {
    const { call } = fakeServer({ producto_precio_cliente: { sku: '700844', clientes: [] } })
    expect(await mcpMwtCheckClient(call).priceBand('700844')).toBeNull()
  })

  it('reads a structured MCP value and rejects text that is not JSON', async () => {
    const structured: MwtToolCall = async () => ({
      content: [],
      structuredContent: ANSWERS['producto_buscar'],
    })
    expect(await mcpMwtCheckClient(structured).skuExists('700844')).toBe(true)

    const broken: MwtToolCall = async () => ({ content: [{ type: 'text', text: 'no disponible' }] })
    await expect(mcpMwtCheckClient(broken).skuExists('700844')).rejects.toThrow(SyntaxError)
  })
})
