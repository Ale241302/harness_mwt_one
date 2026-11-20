/**
 * O8A · the tool transport maps the proposal onto the deployment's MCP tools
 * and parses their narrow answers, without guessing names or assuming success.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMwtToolTransport, parseRemoteState } from '../src/transport.ts'

const TARGET = { expedienteId: 'PO-505433', label: 'PO 505433', collection: 'purchase-orders' }
const UPDATED_AT = '2026-11-07T00:03:14.050722-06:00'

describe('O8A tool transport', () => {
  it('unwraps the real MCP read answer and exposes its root fields', async () => {
    const call = vi.fn(async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          modo_operacion: 'COMISION',
          moneda: 'USD',
          credit_days: 90,
          credit_days_mwt: 15,
          credit_days_cliente: 90,
          updated_at: UPDATED_AT,
        }),
      }],
      isError: false,
    }))
    const transport = createMwtToolTransport({ call, readTool: 'expediente_obtener', writeTool: 'expediente_editar' })

    const state = await transport.read(TARGET)

    expect(call).toHaveBeenCalledWith('expediente_obtener', { expediente_id: 'PO-505433' })
    expect(state).toEqual({
      version: UPDATED_AT,
      fields: {
        modo_operacion: 'COMISION',
        moneda: 'USD',
        credit_days: '90',
        credit_days_mwt: '15',
        credit_days_cliente: '90',
      },
      documents: [],
    })
    expect(state.fields).not.toHaveProperty('content')
    expect(state.fields).not.toHaveProperty('structuredContent')
    expect(state.fields).not.toHaveProperty('isError')
  })

  it('unwraps structuredContent and accepts version or etag', () => {
    expect(parseRemoteState({
      structuredContent: { modo_operacion: 'COMISION', etag: 'etag-8' },
      content: [{ type: 'text', text: '{"moneda":"USD"}' }],
      isError: false,
    })).toEqual({
      version: 'etag-8',
      fields: { modo_operacion: 'COMISION' },
      documents: [],
    })
  })

  it('keeps parsing direct nested fields and documents', () => {
    expect(parseRemoteState({
      version: 'v7',
      campos: { total: '1250', nota: null },
      documentos: [{ nombre: 'proforma.pdf', sha256: 'abc', bytes: 12 }],
    })).toEqual({
      version: 'v7',
      fields: { total: '1250', nota: null },
      documents: [{ name: 'proforma.pdf', sha256: 'abc', bytes: 12 }],
    })
  })

  it('refuses a read without updated_at, version or etag instead of inventing one', async () => {
    const transport = createMwtToolTransport({
      call: async () => ({ content: [{ type: 'text', text: '{"moneda":"USD"}' }], isError: false }),
      readTool: 'r',
      writeTool: 'w',
    })
    await expect(transport.read(TARGET)).rejects.toThrow(/no trajo versión/u)
  })

  it('writes only the documented cambios and converts credit days to safe integers', async () => {
    const call = vi.fn(async () => ({ referencia: 'MWT-REF-2' }))
    const transport = createMwtToolTransport({ call, readTool: 'expediente_obtener', writeTool: 'expediente_editar' })

    const written = await transport.write(TARGET, {
      fields: [
        { field: 'brand_id', value: 'marluvas', unit: null },
        { field: 'modo_operacion', value: 'COMISION', unit: null },
        { field: 'freight_mode', value: 'SEA', unit: null },
        { field: 'dispatch_mode', value: 'DIRECT', unit: null },
        { field: 'incoterm', value: 'FOB', unit: null },
        { field: 'forma_pago', value: 'CREDITO', unit: null },
        { field: 'operating_company_id', value: 'mwt-cr', unit: null },
        { field: 'credit_days', value: '90', unit: null },
        { field: 'credit_days_mwt', value: '15', unit: null },
        { field: 'credit_days_cliente', value: '90', unit: null },
        { field: 'moneda', value: 'USD', unit: null },
      ],
      documents: [],
      expectedVersion: UPDATED_AT,
    }, { idempotencyKey: 'proposal-1' })

    expect(written).toEqual({ ref: 'MWT-REF-2' })
    expect(call).toHaveBeenCalledWith('expediente_editar', {
      expediente_id: 'PO-505433',
      cambios: {
        brand_id: 'marluvas',
        modo_operacion: 'COMISION',
        freight_mode: 'SEA',
        dispatch_mode: 'DIRECT',
        incoterm: 'FOB',
        forma_pago: 'CREDITO',
        operating_company_id: 'mwt-cr',
        credit_days: 90,
        credit_days_mwt: 15,
        credit_days_cliente: 90,
        moneda: 'USD',
      },
    })
  })

  it('rejects documents before invoking a tool that cannot write them', async () => {
    const call = vi.fn(async () => ({ ref: 'no-debe-escribir' }))
    const transport = createMwtToolTransport({ call, readTool: 'r', writeTool: 'w' })

    await expect(transport.write(TARGET, {
      fields: [{ field: 'moneda', value: 'USD', unit: null }],
      documents: [{
        name: 'proforma.pdf',
        mediaType: 'application/pdf',
        contentBase64: 'JVBERi0xLjQ=',
        operation: 'add',
        replaces: null,
      }],
      expectedVersion: UPDATED_AT,
    }, { idempotencyKey: 'proposal-1' })).rejects.toThrow(/documentos/u)
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects undocumented fields before invoking MCP', async () => {
    const call = vi.fn(async () => ({ ref: 'no-debe-escribir' }))
    const transport = createMwtToolTransport({ call, readTool: 'r', writeTool: 'w' })

    await expect(transport.write(TARGET, {
      fields: [{ field: 'total', value: '1250', unit: 'USD' }],
      documents: [],
      expectedVersion: UPDATED_AT,
    }, { idempotencyKey: 'proposal-1' })).rejects.toThrow(/total/u)
    expect(call).not.toHaveBeenCalled()
  })

  it.each(['90.5', '9007199254740992', 'no-es-un-entero'])('rejects unsafe or non-integer credit days %s before invoking MCP', async (value) => {
    const call = vi.fn(async () => ({ ref: 'no-debe-escribir' }))
    const transport = createMwtToolTransport({ call, readTool: 'r', writeTool: 'w' })

    await expect(transport.write(TARGET, {
      fields: [{ field: 'credit_days', value, unit: null }],
      documents: [],
      expectedVersion: UPDATED_AT,
    }, { idempotencyKey: 'proposal-1' })).rejects.toThrow(/credit_days/u)
    expect(call).not.toHaveBeenCalled()
  })

  it('reports a transport error after invoking write as unknown, never as a failure', async () => {
    const transport = createMwtToolTransport({
      call: async () => { throw new Error('timeout del servidor') },
      readTool: 'r',
      writeTool: 'w',
    })
    await expect(transport.write(TARGET, {
      fields: [{ field: 'moneda', value: 'USD', unit: null }],
      documents: [],
      expectedVersion: UPDATED_AT,
    }, { idempotencyKey: 'k' })).rejects.toMatchObject({ name: 'MwtDeliveryUnknown' })
  })

  it('parses an empty document list and unknown fields safely', () => {
    expect(parseRemoteState(null)).toEqual({ version: '', fields: {}, documents: [] })
  })
})
