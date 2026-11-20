/**
 * O8A · the tool transport maps the proposal onto the deployment's MCP tools
 * and parses their narrow answers, without guessing names or assuming success.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMwtToolTransport, parseRemoteState } from '../src/transport.ts'

const TARGET = { expedienteId: 'PO-505433', label: 'PO 505433', collection: 'purchase-orders' }

describe('O8A tool transport', () => {
  it('reads version, fields and documents from the server answer', async () => {
    const call = vi.fn(async () => ({
      version: 'v7',
      campos: { total: '1250', nota: null },
      documentos: [{ nombre: 'proforma.pdf', sha256: 'abc', bytes: 12 }],
    }))
    const transport = createMwtToolTransport({ call, readTool: 'expediente_detalle', writeTool: 'expediente_actualizar' })
    const state = await transport.read(TARGET)
    expect(call).toHaveBeenCalledWith('expediente_detalle', { expediente: 'PO-505433', coleccion: 'purchase-orders' })
    expect(state).toEqual({
      version: 'v7',
      fields: { total: '1250', nota: null },
      documents: [{ name: 'proforma.pdf', sha256: 'abc', bytes: 12 }],
    })
  })

  it('refuses a read without a version instead of inventing one', async () => {
    const transport = createMwtToolTransport({
      call: async () => ({ campos: {} }),
      readTool: 'r',
      writeTool: 'w',
    })
    await expect(transport.read(TARGET)).rejects.toThrow(/no trajo versión/u)
  })

  it('sends the approved revision with its version and idempotency key', async () => {
    const call = vi.fn(async () => ({ referencia: 'MWT-REF-2' }))
    const transport = createMwtToolTransport({ call, readTool: 'r', writeTool: 'expediente_actualizar' })
    const written = await transport.write(TARGET, {
      fields: [{ field: 'total', value: '1250', unit: 'USD' }],
      documents: [],
      expectedVersion: 'v7',
    }, { idempotencyKey: 'proposal-1' })
    expect(written).toEqual({ ref: 'MWT-REF-2' })
    expect(call).toHaveBeenCalledWith('expediente_actualizar', {
      expediente: 'PO-505433',
      coleccion: 'purchase-orders',
      campos: [{ field: 'total', value: '1250', unit: 'USD' }],
      documentos: [],
      version_esperada: 'v7',
      idempotency_key: 'proposal-1',
    })
  })

  it('reports an unanswered write as unknown, never as a failure', async () => {
    const transport = createMwtToolTransport({
      call: async () => { throw new Error('timeout del servidor') },
      readTool: 'r',
      writeTool: 'w',
    })
    await expect(transport.write(TARGET, { fields: [], documents: [], expectedVersion: 'v7' }, { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ name: 'MwtDeliveryUnknown' })
  })

  it('parses an empty document list and unknown fields safely', () => {
    expect(parseRemoteState(null)).toEqual({ version: '', fields: {}, documents: [] })
  })
})
