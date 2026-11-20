/**
 * O8A · one expediente write, one authorization.
 *
 * A fake destination observes every read and write: the proposal carries the
 * before values and document digests, an ambiguous proposal cannot be
 * authorized, the approved revision is written exactly once, a changed
 * destination refuses before writing, and a lost answer stays unknown until a
 * person reconciles it.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomMwt from '../src/index.ts'
import { FaberLoomMwtRefusal, MwtDeliveryUnknown, type MwtRemoteState, type MwtTransport } from '../src/types.ts'

const ACTOR = { id: 'ceo@muitowork.com' }
const TARGET = { expedienteId: 'PO-505433', label: 'PO 505433 — Marluvas', collection: 'purchase-orders' }
const DOCUMENT = Buffer.from('%PDF-1.4 proforma')

/** A destination that records its reads and writes and can lose an answer. */
function fakeTransport(options: { loseAnswer?: boolean; readBackFields?: Record<string, string | null> } = {}): MwtTransport & {
  readonly writes: readonly {
    readonly fields: readonly { field: string; value: string; unit: string | null }[]
    readonly idempotencyKey: string
    readonly expectedVersion: string
  }[]
  state: MwtRemoteState
} {
  const writes: {
    fields: readonly { field: string; value: string; unit: string | null }[]
    idempotencyKey: string
    expectedVersion: string
  }[] = []
  const transport = {
    state: {
      version: 'v1',
      fields: { total: '1000', moneda: 'USD', nota: null },
      documents: [],
    } as MwtRemoteState,
    writes,
    read: async () => transport.state,
    write: async (
      _target: unknown,
      body: { fields: readonly { field: string; value: string; unit: string | null }[]; expectedVersion: string },
      writeOptions: { idempotencyKey: string },
    ) => {
      writes.push({ fields: body.fields, idempotencyKey: writeOptions.idempotencyKey, expectedVersion: body.expectedVersion })
      const fields = { ...transport.state.fields }
      for (const entry of body.fields) fields[entry.field] = entry.value
      transport.state = { ...transport.state, version: 'v2', fields: options.readBackFields ?? fields }
      if (options.loseAnswer === true) throw new MwtDeliveryUnknown('timeout después de enviar')
      return { ref: 'MWT-REF-1' }
    },
  }
  return transport
}

/** Boot storage plus the write service with one destination. */
async function harness(transport: MwtTransport | null = fakeTransport()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomMwt)
  if (transport !== null) ctx.faberloomMwt.useTransport(transport)
  return { mwt: ctx.faberloomMwt, transport }
}

describe('O8A expediente writes', () => {
  it('prepares the exact diff with units and document digests', async () => {
    const { mwt } = await harness()
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [
        { field: 'total', label: 'Total', value: '1250', unit: 'USD' },
        { field: 'nota', label: 'Nota', value: 'Entrega 24/11' },
      ],
      documents: [{
        name: 'proforma.pdf',
        mediaType: 'application/pdf',
        contentBase64: DOCUMENT.toString('base64'),
      }],
      reason: 'Cliente confirmó el total por correo',
      sources: ['correo:<a@b>', 'expediente:PO-505433'],
    })

    expect(proposal.status).toBe('proposed')
    expect(proposal.ambiguities).toEqual([])
    expect(proposal.versionBefore).toBe('v1')
    expect(proposal.fields).toEqual([
      { field: 'total', label: 'Total', before: '1000', after: '1250', unit: 'USD' },
      { field: 'nota', label: 'Nota', before: null, after: 'Entrega 24/11', unit: null },
    ])
    expect(proposal.documents[0]?.sha256).toBe(
      createHash('sha256').update(DOCUMENT.toString('base64')).digest('hex'),
    )
    expect(proposal.documents[0]?.bytes).toBe(DOCUMENT.byteLength)
    expect(proposal.sources).toEqual(['correo:<a@b>', 'expediente:PO-505433'])
  })

  it('refuses to authorize an ambiguous proposal', async () => {
    const { mwt } = await harness()
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [
        { field: 'total', label: 'Total', value: '1250', unit: null },
        { field: 'total', label: 'Total', value: '1250', unit: 'USD' },
        { field: 'nota', label: 'Nota', value: '  ' },
      ],
      reason: 'Prueba',
      sources: [],
    })
    expect(proposal.ambiguities).toEqual([
      'FIELD_DUPLICATED:total',
      'FIELD_EMPTY:nota',
      'UNIT_MISSING:total',
    ])
    await expect(mwt.authorize(ACTOR, proposal.id, { scope: 'todo' }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS' })
  })

  it('writes the approved revision once and consumes its authorization', async () => {
    const { mwt, transport } = await harness()
    const fake = transport as ReturnType<typeof fakeTransport>
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [{ field: 'total', label: 'Total', value: '1250', unit: 'USD' }],
      reason: 'Total confirmado',
      sources: ['correo:<a@b>'],
    })
    const authorization = await mwt.authorize(ACTOR, proposal.id, { scope: 'PO 505433 · total' })
    const written = await mwt.execute(ACTOR, proposal.id, authorization.id)

    expect(written.status).toBe('written')
    expect(written.ref).toBe('MWT-REF-1')
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]?.idempotencyKey).toBe(proposal.id)
    expect(fake.writes[0]?.expectedVersion).toBe('v1')
    expect(fake.writes[0]?.fields).toEqual([{ field: 'total', value: '1250', unit: 'USD' }])

    // The same authorization cannot send a second write.
    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toMatchObject({ code: 'ALREADY_SETTLED' })
    expect(fake.writes).toHaveLength(1)
  })

  it('marks the proposal failed when read-back does not match an approved field', async () => {
    const { mwt, transport } = await harness(fakeTransport({ readBackFields: { total: '1000', moneda: 'USD' } }))
    const fake = transport as ReturnType<typeof fakeTransport>
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [{ field: 'total', label: 'Total', value: '1250', unit: 'USD' }],
      reason: 'Total confirmado',
      sources: ['correo:<a@b>'],
    })
    const authorization = await mwt.authorize(ACTOR, proposal.id, { scope: 'PO 505433 · total' })

    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toThrow(/lectura posterior.*total.*1250.*1000/u)

    const failed = await mwt.get(ACTOR, proposal.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/total/u)
    expect(failed.ref).toBeNull()
    expect(fake.writes).toHaveLength(1)
  })

  it('refuses a destination that moved after the proposal was prepared', async () => {
    const { mwt, transport } = await harness()
    const fake = transport as ReturnType<typeof fakeTransport>
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [{ field: 'total', label: 'Total', value: '1250', unit: 'USD' }],
      reason: 'Total confirmado',
      sources: [],
    })
    const authorization = await mwt.authorize(ACTOR, proposal.id, { scope: 'total' })
    fake.state = { ...fake.state, version: 'v9' }

    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(fake.writes).toHaveLength(0)
  })

  it('leaves a lost answer unknown and settles it only by decision', async () => {
    const { mwt } = await harness(fakeTransport({ loseAnswer: true }))
    const proposal = await mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [{ field: 'total', label: 'Total', value: '1250', unit: 'USD' }],
      reason: 'Total confirmado',
      sources: [],
    })
    const authorization = await mwt.authorize(ACTOR, proposal.id, { scope: 'total' })

    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })
    expect((await mwt.get(ACTOR, proposal.id)).status).toBe('unknown')
    // No blind retry: the proposal is not 'proposed' anymore.
    await expect(mwt.execute(ACTOR, proposal.id, authorization.id))
      .rejects.toMatchObject({ code: 'ALREADY_SETTLED' })

    const settled = await mwt.reconcile(ACTOR, proposal.id, 'written', 'MWT-REF-9')
    expect(settled.status).toBe('written')
    expect(settled.ref).toBe('MWT-REF-9')
  })

  it('fails loud without a destination instead of pretending to write', async () => {
    const { mwt } = await harness(null)
    expect(mwt.transportReady).toBe(false)
    await expect(mwt.prepare(ACTOR, {
      target: TARGET,
      fields: [{ field: 'total', label: 'Total', value: '1', unit: 'USD' }],
      reason: 'x',
      sources: [],
    })).rejects.toBeInstanceOf(FaberLoomMwtRefusal)
  })
})
