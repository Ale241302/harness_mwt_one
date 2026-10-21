import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
}

const OWNER = 'compras2@sondelsa.com'
const CONFIG: Config = { ownerId: OWNER, role: 'client_b2b', readOnly: false }

/** Boot storage, access, and routines, then capture the product tools. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  ctx.faberloomRoutines.registerHandler('receive', () => 'ok')
  ctx.faberloomRoutines.registerHandler('agent', () => 'ok')
  const registered = new Map<string, CapturedTool>()
  const stub = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string): unknown => (ctx.get as (key: string) => unknown)(name),
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(stub as never, CONFIG)
  return { ctx, tools: registered }
}

describe('routine chat tools', () => {
  it('creates a routine active by default and tolerates a missing permissions list', async () => {
    const { ctx, tools } = await harness()
    const created = await tools.get('faberloom_routines_create')!.execute({
      name: 'Barrido SICOP',
      definition: {
        intent: 'Buscar oportunidades',
        triggers: [{ kind: 'recurrence', match: '1h' }],
        steps: [{ id: 's1', instruction: 'revisar', handler: 'receive' }],
        expectedResult: 'oportunidades',
        failurePolicy: 'review',
      },
    } as never) as { id: string; status: string }

    expect(created.status).toBe('active')
    expect((await ctx.faberloomRoutines.getRoutine(created.id as never)).status).toBe('active')
    expect((await ctx.faberloomRoutines.getRoutine(created.id as never)).definition.permissions).toEqual([])
  })

  it('accepts the model-shaped definition that used to stay in draft', async () => {
    const { ctx, tools } = await harness()
    const created = await tools.get('faberloom_routines_create')!.execute({
      name: 'Forma del modelo',
      definition: {
        intent: 'Saludar',
        triggers: [{ type: 'manual' }],
        steps: [{ id: 'paso-1', title: 'hola', type: 'manual' }],
        expectedResult: 'saludo',
        failurePolicy: { onStepFailure: 'stop' },
      },
    } as never) as { id: string; status: string }

    expect(created.status).toBe('active')
    const routine = await ctx.faberloomRoutines.getRoutine(created.id as never)
    expect(routine.definition.steps[0]).toMatchObject({ instruction: 'hola', handler: 'agent' })
    expect(routine.definition.failurePolicy).toBe('stop')
  })

  it('keeps the draft escape hatch and does not require a grant to activate', async () => {
    const { ctx, tools } = await harness()
    const created = await tools.get('faberloom_routines_create')!.execute({
      name: 'Resumen SICOP',
      draft: true,
      definition: {
        intent: 'Resumir',
        triggers: [{ kind: 'recurrence', match: '1d' }],
        steps: [{ id: 's1', instruction: 'resumir', handler: 'receive' }],
        expectedResult: 'resumen',
        permissions: 'mwt',
        failurePolicy: 'review',
      },
    } as never) as { id: string; status: string }

    expect(created.status).toBe('draft')
    expect((await ctx.faberloomRoutines.getRoutine(created.id as never)).definition.permissions).toEqual(['mwt'])
    const activated = await tools.get('faberloom_routines_activate')!.execute({ id: created.id } as never) as { status: string }
    expect(activated.status).toBe('active')
  })
})
