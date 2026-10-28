/**
 * The plugin row against a real board: it registers all six controls, the price
 * control compares the billing against the expediente totals the server
 * returns, a quantity read the server cannot answer keeps the approval blocked,
 * and a timed-out MWT call counts as a failed control. Disposing the fiber
 * removes every registration.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import FaberLoomBoard from '@deepseek-ai/dsh-faberloom-board'
import * as plugin from '../src/index.ts'
import {
  MemoryMediaPool,
  MemoryStorageBackend,
} from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { Fiber } from '@deepseek-ai/cordis'
import type { BoardActor, BoardApproveInput, FaberLoomBoardItem } from '@deepseek-ai/dsh-faberloom-board'
import type { ToolExecutionInput, ToolExecutionResult, ToolRuntime } from '@deepseek-ai/dsh-tools'

/** The board identity every test acts as. */
const ACTOR: BoardActor = { id: 'owner@example.com' }

/** The purchase-order code the draft answers and the listing names. */
const ORDER_REF = 'PO 110024463'

/** The proforma draft the controls evaluate. */
const DRAFT: Record<string, unknown> = {
  orderRef: ORDER_REF,
  lines: [{ sku: '700844', quantity: 2, unitPrice: 143 }],
  total: 286,
  separation: 'new',
}

/** The expediente row the fake `expediente_listar` returns. */
const EXPEDIENTE: Record<string, unknown> = {
  moneda: 'USD',
  total_client: 286,
  total_mwt: 246,
  credit_days_cliente: 90,
  credit_band: null,
  proforma_codigo: 'PF 2521-2026',
  proforma_codigos: ['PF 2521-2026'],
  oc_codigos: [ORDER_REF],
  client_name: 'CLIENTE DEMO S.A.S.',
  estado: 'REGISTRO',
}

/** The stock record the fake `stock_listar` returns. */
const STOCK: Record<string, unknown> = {
  producto_id: '00000000-0000-4000-8000-000000000003',
  producto_sku: '700844',
  nodo_codigo: 'NODO-DEMO',
  cantidad_disponible: '200.000',
}

/** What one fake MWT tool answers. */
type Backend = (tool: string, args: Record<string, unknown>, signal: AbortSignal) => unknown

/** Contexts booted by one test, disposed after it. */
const booted: Context[] = []

afterEach(async () => {
  for (const ctx of booted.splice(0)) await ctx.fiber.dispose()
})

/**
 * Answer one MWT tool the way the MCP server does.
 * @param tool - raw tool name without the server namespace.
 * @param args - arguments the row sent.
 * @returns the JSON payload.
 */
function mwtAnswer(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case 'expediente_buscar':
      return { existe: true, total: 1, matches: [EXPEDIENTE] }
    case 'expediente_listar':
      return { count: 1, limit: 50, offset: 0, results: [EXPEDIENTE] }
    case 'producto_buscar': {
      const sku = String(args['q'])
      return {
        productos: sku === '700844' ? [{ id: 'p-700844', sku, moneda: 'USD', precio_venta: 0 }] : [],
        total: sku === '700844' ? 1 : 0,
      }
    }
    case 'producto_precio_cliente':
      return { sku: String(args['sku']), banda_vigente: { id: 7 }, plazo_dias: 90, clientes: [] }
    case 'stock_listar':
      return STOCK
    default:
      throw new Error(`unexpected MWT tool ${tool}`)
  }
}

/**
 * The default backend with one tool answered differently.
 * @param tool - raw tool name to replace.
 * @param answer - payload the replacement returns.
 * @returns the backend.
 */
function withAnswer(tool: string, answer: unknown): Backend {
  return (called, args) => called === tool ? answer : mwtAnswer(called, args)
}

/**
 * A tool runtime whose `mcp__mwt__*` calls answer from one backend.
 * @param backend - payload producer per raw tool name.
 * @param seen - collects the tool names the row called.
 * @returns the runtime the plugin injects.
 */
function fakeTools(backend: Backend, seen: string[]): ToolRuntime {
  return {
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const prefix = 'mcp__mwt__'
      if (!input.name.startsWith(prefix)) throw new Error(`unexpected tool ${input.name}`)
      seen.push(input.name)
      const tool = input.name.slice(prefix.length)
      const payload = await backend(tool, input.arguments as Record<string, unknown>, input.signal)
      return {
        isError: false,
        value: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
        content: [],
      }
    },
  } as unknown as ToolRuntime
}

/**
 * Boot the board on the real storage domain and mount the check row.
 * @param backend - what the fake MWT tools answer.
 * @param config - adapter configuration (timeout and server name).
 * @returns the context, board, plugin fiber, and observed tool names.
 */
async function mount(
  backend: Backend,
  config: plugin.Config = {},
): Promise<{ ctx: Context; board: FaberLoomBoard; fiber: Fiber; seen: string[] }> {
  const ctx = new Context()
  booted.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomBoard)
  const seen: string[] = []
  // The row reads only `execute`; the runtime's remaining members belong to the agent loop.
  ctx.provide('tools', fakeTools(backend, seen))
  const fiber = ctx.plugin(plugin, config)
  await fiber
  return { ctx, board: ctx.faberloomBoard, fiber, seen }
}

/**
 * Submit one classified proforma draft.
 * @param board - the mounted board.
 * @returns the item as the panel sees it.
 */
async function submitProforma(board: FaberLoomBoard): Promise<FaberLoomBoardItem> {
  const item = await board.submit(ACTOR, {
    runId: 'run-1',
    idempotencyKey: 'idem-1',
    businessKey: 'PF 2521-2026',
    title: 'PF 2521-2026 · CLIENTE DEMO S.A.S.',
    summary: 'Proforma DDP con precios verificados.',
    evidence: [`oc:${ORDER_REF}`],
    artifactType: 'proforma',
    accountRef: 'CLIENTE DEMO S.A.S.',
    content: DRAFT,
  })
  return await board.setSeverity(ACTOR, item.id, 'HIGH', 'HUMAN')
}

/**
 * The approval input of one reviewed item.
 * @param item - the item the caller reviewed.
 * @returns the optimistic tokens the approval names.
 */
function approvalOf(item: FaberLoomBoardItem): BoardApproveInput {
  return {
    expectedRowVersion: item.rowVersion,
    expectedArtifactVersion: item.version,
    expectedArtifactHash: item.artifactHash ?? '',
  }
}

describe('faberloom-checks-mwt plugin', () => {
  it('registers the six proforma controls and removes them when the fiber is disposed', async () => {
    const { board, fiber } = await mount(mwtAnswer)
    expect(board.checkStatus('proforma').map(entry => entry.registered)).toEqual([true, true, true, true, true, true])
    await fiber.dispose()
    expect(board.checkStatus('proforma').some(entry => entry.registered)).toBe(false)
  })

  it('passes the price, SKU, total, and stock controls on the recorded answers', async () => {
    const { board, seen } = await mount(mwtAnswer)
    const item = await submitProforma(board)
    const report = await board.runChecks(ACTOR, item.id)
    expect(report.missing).toEqual([])
    for (const id of ['proforma.price', 'proforma.sku', 'proforma.total', 'proforma.stock']) {
      expect(report.checks.find(outcome => outcome.id === id)?.result, id).toMatchObject({ status: 'ok' })
    }
    expect(seen.every(name => name.startsWith('mcp__mwt__'))).toBe(true)
    expect(seen).not.toContain('mcp__mwt__expediente_lineas')
  })

  it('blocks the approval when the expediente client total differs from the billed total', async () => {
    const { board } = await mount(withAnswer('expediente_listar', {
      count: 1, limit: 50, offset: 0, results: [{ ...EXPEDIENTE, total_client: 300 }],
    }))
    const item = await submitProforma(board)
    const report = await board.runChecks(ACTOR, item.id)
    expect(report.checks.find(outcome => outcome.id === 'proforma.price')).toMatchObject({
      class: 'bloqueante',
      result: { status: 'fail', reason: 'PRICE_MISMATCH', source: 'mwt.price' },
    })
    await expect(board.approve(ACTOR, item.id, approvalOf(item))).rejects.toThrow('BLOCKING_CHECK')
  })

  it('keeps the approval blocked because no read returns the expediente lines', async () => {
    const { board } = await mount(mwtAnswer)
    const item = await submitProforma(board)
    const report = await board.runChecks(ACTOR, item.id)
    expect(report.checks.find(outcome => outcome.id === 'proforma.quantity')).toMatchObject({
      class: 'bloqueante',
      result: { status: 'fail', reason: 'ORDER_SOURCE_MISSING', source: 'mwt.order' },
    })
    expect(report.checks.find(outcome => outcome.id === 'proforma.stock')).toMatchObject({
      class: 'confirmacion',
      result: { status: 'ok' },
    })
    await expect(board.approve(ACTOR, item.id, approvalOf(item))).rejects.toThrow('BLOCKING_CHECK')
    expect((await board.get(ACTOR, item.id)).state).toBe('PENDIENTE_CRITERIO')
  })

  it('counts a timed-out MWT call as a failed control', async () => {
    const stalled: Backend = (_tool, _args, signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const { board } = await mount(stalled, { toolTimeoutMs: 5 })
    const item = await submitProforma(board)
    const report = await board.runChecks(ACTOR, item.id)
    expect(report.missing).toEqual([])
    const price = report.checks.find(outcome => outcome.id === 'proforma.price')
    expect(price?.result).toMatchObject({ status: 'fail', reason: 'SOURCE_UNAVAILABLE', source: 'unavailable' })
  })
})
