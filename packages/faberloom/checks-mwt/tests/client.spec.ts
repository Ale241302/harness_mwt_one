/**
 * Wire behavior of the MCP-backed client: which tools each read calls, how the
 * bridged MCP payload is unwrapped, and that a missing field is null instead of
 * a substituted default.
 */

import { describe, expect, it } from 'vitest'
import { mcpMwtCheckClient } from '../src/client.ts'
import type { MwtToolCall, MwtToolName } from '../src/types.ts'

/** One reply the fake MWT server sends for a tool. */
type Reply = unknown

/** The canonical MCP result a bridged tool returns for one JSON payload. */
function mcpText(payload: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

/** One recorded call the fake server received. */
interface Call {
  readonly tool: MwtToolName
  readonly args: Record<string, unknown>
}

/**
 * A tool call over a fixed set of replies, recording what it was asked.
 * @param replies - payload per tool.
 * @returns the call and its recorded invocations.
 */
function fakeServer(replies: Partial<Record<MwtToolName, Reply>>): { call: MwtToolCall; calls: Call[] } {
  const calls: Call[] = []
  const call: MwtToolCall = async (tool, args) => {
    calls.push({ tool, args })
    const reply = replies[tool]
    if (reply === undefined) throw new Error(`unexpected tool ${tool}`)
    return mcpText(reply)
  }
  return { call, calls }
}

describe('MCP-backed MWT client', () => {
  it('resolves an order number to its expediente before reading the lines', async () => {
    const expedienteId = '0f0e8f1e-0000-4000-8000-000000000001'
    const { call, calls } = fakeServer({
      expediente_buscar: { existe: true, expediente_id: expedienteId },
      expediente_lineas: { lineas: [{ sku: 'ART-1', qty: '2' }, { sku: 'ART-2', cantidad: 1 }] },
    })
    const facts = await mcpMwtCheckClient(call).expediente('OC-505288')
    expect(calls.map(entry => entry.tool)).toEqual(['expediente_buscar', 'expediente_lineas'])
    expect(calls[1]?.args).toEqual({ expediente_id: expedienteId })
    expect(facts).toEqual({
      reference: expedienteId,
      lines: [{ sku: 'ART-1', quantity: 2 }, { sku: 'ART-2', quantity: 1 }],
    })
  })

  it('reads a UUID without searching for an order number', async () => {
    const expedienteId = '0f0e8f1e-0000-4000-8000-000000000002'
    const { call, calls } = fakeServer({ expediente_lineas: { lineas: [{ sku: 'ART-1', qty: 3 }] } })
    await mcpMwtCheckClient(call).expediente(expedienteId)
    expect(calls.map(entry => entry.tool)).toEqual(['expediente_lineas'])
  })

  it('reports no expediente when the order search finds none', async () => {
    const { call } = fakeServer({ expediente_buscar: { existe: false } })
    expect(await mcpMwtCheckClient(call).expediente('OC-000')).toBeNull()
  })

  it('treats an unreadable line quantity as unresolved instead of zero', async () => {
    const { call } = fakeServer({
      expediente_lineas: { lineas: [{ sku: 'ART-1', qty: 2 }, { sku: 'ART-2' }] },
    })
    expect(await mcpMwtCheckClient(call).expediente('0f0e8f1e-0000-4000-8000-000000000003')).toBeNull()
  })

  it('requires an exact SKU match, not a fuzzy search hit', async () => {
    const { call } = fakeServer({
      producto_buscar: { productos: [{ producto_id: 'p-1', sku: 'ART-10' }] },
    })
    expect(await mcpMwtCheckClient(call).skuExists('ART-1')).toBe(false)
  })

  it('sums the available stock rows and refuses a row without a readable quantity', async () => {
    const summed = fakeServer({
      producto_buscar: { productos: [{ producto_id: 'p-1', sku: 'ART-1' }] },
      stock_listar: { stock: [{ cantidad: 4 }, { saldo: '2' }] },
    })
    expect(await mcpMwtCheckClient(summed.call).stockAvailable('ART-1')).toBe(6)

    const unreadable = fakeServer({
      producto_buscar: { productos: [{ producto_id: 'p-1', sku: 'ART-1' }] },
      stock_listar: { stock: [{ cantidad: 4 }, { nodo: 'BOG' }] },
    })
    expect(await mcpMwtCheckClient(unreadable.call).stockAvailable('ART-1')).toBeNull()
  })

  it('reads the account band and asks the catalog for the price under it', async () => {
    const { call, calls } = fakeServer({
      cliente_listar: { clientes: [{ cliente_id: 'c-1', razon_social: 'Eguisa' }] },
      cliente_obtener: { cliente: { banda_id: 2, plazo_dias: 30 } },
      producto_precio_cliente: { precio: { precio_mwt: '100.50', precio_cliente: 120.5 } },
    })
    const client = mcpMwtCheckClient(call)
    const band = await client.priceBand('eguisa')
    expect(band).toEqual({ bandId: 2, paymentDays: 30 })
    if (band === null) throw new Error('the fake account must resolve a band')
    expect(await client.catalogPrice('ART-1', band)).toEqual({ listPrice: 100.5, clientPrice: 120.5 })
    expect(calls[2]?.args).toEqual({ sku: 'ART-1', usar_tc_actual: true, banda_id: 2, plazo_dias: 30 })
  })

  it('reports no band when the account name matches more than one client', async () => {
    const { call } = fakeServer({
      cliente_listar: {
        clientes: [
          { cliente_id: 'c-1', razon_social: 'Eguisa' },
          { cliente_id: 'c-2', razon_social: 'Eguisa' },
        ],
      },
    })
    expect(await mcpMwtCheckClient(call).priceBand('eguisa')).toBeNull()
  })

  it('reports no price when the catalog omits either side of the overcharge', async () => {
    const { call } = fakeServer({ producto_precio_cliente: { precio: { precio_cliente: 120.5 } } })
    expect(await mcpMwtCheckClient(call).catalogPrice('ART-1', { bandId: 2, paymentDays: 30 })).toBeNull()
  })

  it('reads a price through the data wrapper MWT list responses use', async () => {
    const { call } = fakeServer({ producto_precio_cliente: { data: { precio_mwt: 10, precio_cliente: 12 } } })
    expect(await mcpMwtCheckClient(call).catalogPrice('ART-1', { bandId: null, paymentDays: 30 }))
      .toEqual({ listPrice: 10, clientPrice: 12 })
  })

  it('reads a structured MCP value and rejects text that is not JSON', async () => {
    const structured: MwtToolCall = async () => ({
      content: [],
      structuredContent: { productos: [{ producto_id: 'p-9', sku: 'ART-9' }] },
    })
    expect(await mcpMwtCheckClient(structured).skuExists('ART-9')).toBe(true)

    const broken: MwtToolCall = async () => ({ content: [{ type: 'text', text: 'no disponible' }] })
    await expect(mcpMwtCheckClient(broken).skuExists('ART-9')).rejects.toThrow(SyntaxError)
  })
})
