/**
 * O8A · real service composition over the tools seam, with MCP answers faked
 * in process and no network or view service.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { ToolExecutionInput, ToolExecutionResult, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMwt from '../src/index.ts'

const ACTOR = { id: 'ceo@muitowork.com' }
const TARGET = { expedienteId: 'PO-505433', label: 'PO 505433', collection: 'purchase-orders' }
const READ_TOOL = 'mcp__mwt__expediente_obtener'
const WRITE_TOOL = 'mcp__mwt__expediente_editar'
const UPDATED_AT = '2026-11-07T00:03:14.050722-06:00'

/** Contexts whose storage fibers need disposal after each composition test. */
const booted: Context[] = []

afterEach(async () => {
  for (const ctx of booted.splice(0)) await ctx.fiber.dispose()
})

/** Boot the real service and storage with only the tool runtime faked. */
async function harness(options: { readError?: string; writeError?: string } = {}) {
  const ctx = new Context()
  booted.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)

  const calls: ToolExecutionInput[] = []
  const remote: Record<string, unknown> = {
    modo_operacion: 'COMISION',
    moneda: 'USD',
    credit_days: 90,
    credit_days_mwt: 15,
    credit_days_cliente: 90,
    updated_at: UPDATED_AT,
  }
  const tools = {
    schemas: () => [
      { name: READ_TOOL, description: 'fake read', parameters: { type: 'object' } },
      { name: WRITE_TOOL, description: 'fake write', parameters: { type: 'object' } },
    ],
    execute: async (input: ToolExecutionInput): Promise<ToolExecutionResult> => {
      calls.push(input)
      if (input.name === READ_TOOL) {
        if (options.readError !== undefined) {
          return { isError: true, error: { message: options.readError }, content: [] }
        }
        return {
          isError: false,
          value: { content: [{ type: 'text', text: JSON.stringify(remote) }], isError: false },
          content: [],
        }
      }
      if (input.name === WRITE_TOOL) {
        if (options.writeError !== undefined) {
          return { isError: true, error: { message: options.writeError }, content: [] }
        }
        const args = input.arguments as { cambios: Record<string, unknown> }
        Object.assign(remote, args.cambios)
        remote['updated_at'] = '2026-11-20T00:00:00.000000-06:00'
        return {
          isError: false,
          value: { content: [{ type: 'text', text: '{"referencia":"MWT-REF-1"}' }], isError: false },
          content: [],
        }
      }
      throw new Error(`unexpected tool ${input.name}`)
    },
  } as unknown as ToolRuntime
  ctx.provide('tools', tools)
  await ctx.plugin(FaberLoomMwt)
  return { mwt: ctx.faberloomMwt, calls, remote }
}

/** Prepare the one-field proposal used by the composition checks. */
async function prepare(mwt: FaberLoomMwt) {
  return await mwt.prepare(ACTOR, {
    target: TARGET,
    fields: [{ field: 'moneda', label: 'Moneda', value: 'CRC' }],
    reason: 'Moneda confirmada',
    sources: ['correo:<a@b>'],
  })
}

describe('O8A tools composition', () => {
  it('registers the MCP transport and prepares from expediente_obtener', async () => {
    const { mwt, calls } = await harness()

    const proposal = await prepare(mwt)

    expect(mwt.transportReady).toBe(true)
    expect(proposal.versionBefore).toBe(UPDATED_AT)
    expect(proposal.fields[0]).toMatchObject({ field: 'moneda', before: 'USD', after: 'CRC' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: READ_TOOL,
      arguments: { expediente_id: 'PO-505433' },
    })
    expect(String(calls[0]?.callId)).toMatch(/^[0-9a-f-]{36}$/u)
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not reach a write when expediente_obtener returns isError', async () => {
    const { mwt, calls } = await harness({ readError: 'lectura MCP rechazada' })

    await expect(prepare(mwt)).rejects.toThrow('lectura MCP rechazada')

    expect(calls.map(call => call.name)).toEqual([READ_TOOL])
    expect(calls.some(call => call.name === WRITE_TOOL)).toBe(false)
  })

  it('does not mark an expediente_editar isError result as written', async () => {
    const { mwt, calls, remote } = await harness({ writeError: 'edición MCP rechazada' })
    const proposal = await prepare(mwt)
    const authorization = await mwt.authorize(ACTOR, proposal.id, { scope: 'moneda' })

    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })

    expect((await mwt.get(ACTOR, proposal.id)).status).toBe('unknown')
    expect(remote['moneda']).toBe('USD')
    expect(calls.filter(call => call.name === WRITE_TOOL)).toHaveLength(1)
  })
})
