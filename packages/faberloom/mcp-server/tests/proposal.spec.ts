import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomBoard from '../../board/src/index.ts'
import { PROPOSAL_LIMITS } from '../../board/src/proposal.ts'
import FaberLoomSpaces from '../../spaces/src/index.ts'
import { PROPOSAL_TOOL } from '../src/protocol.ts'
import { PROPOSAL_TOOL_DEFINITION } from '../src/proposal.ts'
import { FaberLoomToolHost, toolNames } from '../src/tools.ts'

const OWNER = 'compras2@sondelsa.com'

/** Boot the board surface and the tool host, with the scopes under test. */
async function harness(scopes: readonly string[] | null = null, companyId?: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  await ctx.plugin(FaberLoomBoard)
  return { ctx, board: ctx.faberloomBoard, host: new FaberLoomToolHost(ctx, OWNER, scopes, companyId) }
}

/** One valid tool call. */
function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    archivo: 'knowledge/procedimiento.md',
    versionBase: 'rev-7',
    cambio: 'Añadir la verificación previa.',
    motivo: 'La revisión detectó un hueco.',
    evidencia: ['oc:505288'],
    claveCliente: 'mcp-clave-1',
    title: 'Verificar antes de publicar',
    ...overrides,
  }
}

/** Read the JSON payload of one tool result. */
function payload(result: { content: readonly { text: string }[] }): unknown {
  return JSON.parse(result.content[0]?.text ?? '')
}

describe('proposal tool', () => {
  it('is advertised in the catalogue and under its own scope', () => {
    expect(toolNames()).toContain(PROPOSAL_TOOL)
    expect(PROPOSAL_TOOL_DEFINITION.name).toBe(PROPOSAL_TOOL)
    expect(PROPOSAL_TOOL_DEFINITION.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ['archivo', 'versionBase', 'cambio', 'motivo', 'evidencia', 'claveCliente', 'title'],
    })
  })

  it('returns exactly the receipt of a pending proposal', async () => {
    const { host, board } = await harness([PROPOSAL_TOOL])
    const result = await host.call(PROPOSAL_TOOL, args())
    const receipt = payload(result) as { recibida: boolean; id: string }
    expect(receipt.recibida).toBe(true)
    expect(typeof receipt.id).toBe('string')

    const item = await board.get({ id: OWNER }, receipt.id as never)
    expect(item).toMatchObject({
      state: 'PENDIENTE_CRITERIO',
      artifactType: 'propuesta-conocimiento',
      approvedRevision: null,
    })
    // The receipt is the whole answer: no artifact content is echoed back.
    expect(Object.keys(receipt)).toEqual(['recibida', 'id'])
  })

  it('carries the token company into the writer', async () => {
    const { host, board } = await harness([PROPOSAL_TOOL], 'co-sondel')
    const receipt = payload(await host.call(PROPOSAL_TOOL, args())) as { id: string }
    const item = await board.get({ id: OWNER, companyId: 'co-sondel' }, receipt.id as never)
    expect(item.companyId).toBe('co-sondel')
  })

  it('rejects every authority field and an unknown field at the executor', async () => {
    const { host } = await harness([PROPOSAL_TOOL])
    for (const field of ['id', 'ownerId', 'companyId', 'spaceId', 'state', 'status', 'approvedRevision', 'human']) {
      await expect(host.call(PROPOSAL_TOOL, args({ [field]: 'forged' })))
        .rejects.toThrow('PROPOSAL_AUTHORITY_FIELD')
    }
    await expect(host.call(PROPOSAL_TOOL, args({ nuevo: 'x' })))
      .rejects.toThrow('PROPOSAL_FIELD_UNKNOWN')
  })

  it('refuses a call from a token scoped to another tool', async () => {
    const { host } = await harness(['faberloom_board'])
    await expect(host.call(PROPOSAL_TOOL, args())).rejects.toThrow('not scoped')
    expect(host.tools().map(tool => tool.name)).not.toContain(PROPOSAL_TOOL)
  })

  it('keeps distinct keys and conflicts on a reused key with another content', async () => {
    const { host, board } = await harness([PROPOSAL_TOOL])
    const first = payload(await host.call(PROPOSAL_TOOL, args({ claveCliente: 'clave-a' }))) as { id: string }
    const second = payload(await host.call(PROPOSAL_TOOL, args({ claveCliente: 'clave-b' }))) as { id: string }
    expect(first.id).not.toBe(second.id)

    await expect(host.call(PROPOSAL_TOOL, args({ claveCliente: 'clave-a', cambio: 'Otro cambio.' })))
      .rejects.toThrow('PROPOSAL_CONFLICT')
    expect(await board.list({ id: OWNER }, { state: 'PENDIENTE_CRITERIO' })).toHaveLength(2)
  })

  it('enforces the approved bounds at the executor', async () => {
    const { host } = await harness([PROPOSAL_TOOL])
    await expect(host.call(PROPOSAL_TOOL, args({ cambio: 'x'.repeat(PROPOSAL_LIMITS.cambio + 1) })))
      .rejects.toThrow('PROPOSAL_LIMIT')
    await expect(host.call(PROPOSAL_TOOL, args({
      evidencia: Array.from({ length: PROPOSAL_LIMITS.evidenciaItems + 1 }, (_, index) => `ref:${String(index)}`),
    }))).rejects.toThrow('PROPOSAL_LIMIT')
  })
})
