import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import FaberLoomWorkflows from '../../workflows/src/index.ts'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
}

const OWNER = 'compras2@sondelsa.com'
const CONFIG: Config = { ownerId: OWNER, role: 'client_b2b', companyId: 'co-sondel', readOnly: false, workflowTools: true }

/**
 * Boot storage, access, routines, and the real workflows service, then capture
 * the registered product tools over a stub registry that reads the real services.
 */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomWorkflows)
  ctx.faberloomRoutines.registerHandler('imap', () => 'ok')
  const registered = new Map<string, CapturedTool>()
  const stub = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string): unknown => (ctx.get as (key: string) => unknown)(name),
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(stub as never, CONFIG)
  return { ctx, tools: registered }
}

describe('workflow chat tools end to end', () => {
  it('F4 · creates and activates the anti-spam flow only through the tools', async () => {
    const { ctx, tools } = await harness()

    const created = await tools.get('faberloom_workflows_create')!.execute({ name: 'Anti-spam' } as never) as { id: string }
    const workflowId = created.id
    await tools.get('faberloom_workflows_set_trigger')!.execute({ workflowId, kind: 'trigger.email', config: { match: 'Antispam' } } as never)
    const withTrigger = await tools.get('faberloom_workflows_get')!.execute({ workflowId } as never) as { id: string }
    const graph = await ctx.faberloomWorkflows.get({ id: OWNER }, workflowId as never)
    const triggerId = graph.definition.nodes.find(node => node.kind === 'trigger.email')!.id
    void withTrigger

    await tools.get('faberloom_workflows_add_node')!.execute({ workflowId, id: 'n2', kind: 'imap.action', title: 'borra el spam', config: { op: 'delete' } } as never)
    await tools.get('faberloom_workflows_connect')!.execute({ workflowId, from: triggerId, to: 'n2' } as never)

    const verdict = await tools.get('faberloom_workflows_validate')!.execute({ workflowId } as never)
    expect(verdict).toMatchObject({ valid: true })

    await tools.get('faberloom_workflows_activate')!.execute({ workflowId } as never)
    const active = await ctx.faberloomWorkflows.get({ id: OWNER }, workflowId as never)
    expect(active.status).toBe('active')
    expect(active.routineId).toBeTypeOf('string')
    expect((await ctx.faberloomRoutines.getRoutine(active.routineId as never)).status).toBe('active')

    const started = await tools.get('faberloom_workflows_run_now')!.execute({ workflowId } as never)
    expect(started).toMatchObject({ deduped: false })
    const runs = await tools.get('faberloom_workflows_runs')!.execute({ workflowId } as never) as { runs: readonly unknown[] }
    expect(runs.runs.length).toBeGreaterThan(0)
  })
})
