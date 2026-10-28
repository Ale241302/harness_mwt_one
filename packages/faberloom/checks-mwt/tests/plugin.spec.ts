/**
 * The plugin row against a real board: it registers all six controls, a missing
 * stock figure demands an explicit confirmation instead of a silent approval,
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

/** Expediente the fake order search resolves. */
const EXPEDIENTE_ID = '0f0e8f1e-0000-4000-8000-00000000000a'

/** The proforma draft the controls evaluate. */
const DRAFT: Record<string, unknown> = {
  orderRef: 'OC-505288',
  lines: [
    { sku: 'ART-1', quantity: 2, unitPrice: 120.5 },
    { sku: 'ART-2', quantity: 1, unitPrice: 45 },
  ],
  total: 286,
  separation: 'new',
}

/** Catalog prices the fake `producto_precio_cliente` answers. */
const PRICES: Readonly<Record<string, { precio_mwt: number; precio_cliente: number }>> = {
  'ART-1': { precio_mwt: 100.5, precio_cliente: 120.5 },
  'ART-2': { precio_mwt: 40, precio_cliente: 45 },
}

/** What one fake MWT tool answers. */
type Backend = (tool: string, args: Record<string, unknown>, signal: AbortSignal) => unknown

/** Contexts booted by one test, disposed after it. */
const booted: Context[] = []

afterEach(async () => {
  for (const ctx of booted.splice(0)) await ctx.fiber.dispose()
})

/**
 * Answer one MWT tool the way the MCP server would.
 * @param tool - raw tool name without the server namespace.
 * @param args - arguments the row sent.
 * @returns the JSON payload.
 */
function mwtAnswer(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case 'expediente_buscar':
      return { existe: true, expediente_id: EXPEDIENTE_ID }
    case 'expediente_lineas':
      return { lineas: [{ sku: 'ART-1', qty: 2 }, { sku: 'ART-2', qty: 1 }] }
    case 'producto_buscar': {
      const sku = String(args['q'])
      return { productos: PRICES[sku] === undefined ? [] : [{ producto_id: `p-${sku}`, sku }] }
    }
    case 'producto_precio_cliente': {
      const sku = String(args['sku'])
      return { precio: PRICES[sku] ?? {} }
    }
    case 'cliente_listar':
      return { clientes: [{ cliente_id: 'c-1', razon_social: 'Eguisa' }] }
    case 'cliente_obtener':
      return { cliente: { banda_id: 2, plazo_dias: 30 } }
    case 'stock_listar':
      // A row without a readable quantity: the source cannot state availability.
      return { stock: [{ producto_id: String(args['producto']) }] }
    default:
      throw new Error(`unexpected MWT tool ${tool}`)
  }
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
    businessKey: 'PF 2520-2026',
    title: 'PF 2520-2026 · Eguisa',
    summary: 'Proforma DDP con precios verificados.',
    evidence: ['oc:OC-505288'],
    artifactType: 'proforma',
    accountRef: 'eguisa',
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

  it('refuses the approval while stock is missing and accepts the explicit confirmation', async () => {
    const { board, seen } = await mount(mwtAnswer)
    const item = await submitProforma(board)
    await expect(board.approve(ACTOR, item.id, approvalOf(item))).rejects.toThrow('CHECK_CONFIRMATION_REQUIRED')
    const current = await board.get(ACTOR, item.id)
    const approved = await board.approve(ACTOR, item.id, {
      ...approvalOf(current),
      confirmations: ['proforma.stock', 'proforma.separation'],
    })
    expect(approved.state).toBe('APROBADO')
    expect(seen.every(name => name.startsWith('mcp__mwt__'))).toBe(true)
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
