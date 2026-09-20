import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomBackup from '../../backup/src/index.ts'
import FaberLoomRoutines from '../../routines/src/index.ts'
import type { RoutineDefinitionInput, RoutineStepInput } from '../../routines/src/index.ts'
import FaberLoomHandlers from '../src/index.ts'
import type { AgentStepOutcome } from '../src/index.ts'

/** Scripted provider: one queued chunk list per model call. */
class ScriptedAdapter extends LlmAdapter {
  calls = 0

  constructor(private readonly script: readonly StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string }> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script[this.calls]
    this.calls += 1
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    yield * entry
  }
}

/** Provider that fails every call, as a dead route does. */
class FailingAdapter extends LlmAdapter {
  constructor(private readonly message: string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string }> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error(this.message)
  }
}

/** One assistant text answer, as a provider streams it. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One tool call for `mwt.stock`, as a provider streams it. */
function stockCallResponse(callId: string): StreamChunk[] {
  const id = ToolCallId(callId)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'mwt.stock', argumentsDelta: '{"sku":"A-1"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'mwt.stock', arguments: '{"sku":"A-1"}' } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Boot the shipped loop, the given provider, the product services, and the handlers. */
async function harness(adapter: LlmAdapter) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  await ctx.plugin(FaberLoomRoutines)
  await ctx.plugin(FaberLoomBackup)
  await ctx.plugin(FaberLoomHandlers)
  ctx.llm.registerAdapter(['routine-mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'mwt.stock',
    description: 'stock disponible',
    parameters: { sku: { type: 'string' } },
    async execute(args) {
      return [{ type: 'text', text: `sku ${String(args.sku)}: 12` }]
    },
  }))
  await ctx.plugin(AgentDefaultModel, { provider: 'routine-mock', model: 'routine-mock' })
  await ctx.plugin(AgentLoop, { agents: [] })
  return { ctx, routines: ctx.faberloomRoutines }
}

/** Build a definition from steps. */
function definition(steps: RoutineStepInput[]): RoutineDefinitionInput {
  return { intent: 'procesar el caso del cliente', triggers: [], steps, expectedResult: 'resultado', permissions: ['mwt'], failurePolicy: 'stop' }
}

/** The user prompts one hidden Session recorded, oldest first. */
function promptsOf(ctx: Context, sessionId: string): string[] {
  return ctx.agents.get(SessionId(sessionId))?.session.snapshotEvents()
    .flatMap(event => event.type === 'user/message' ? event.data.content : [])
    .flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
}

const OWNER = 'compras2@sondelsa.com'

describe('FaberLoomHandlers agent steps', () => {
  it('F15 — runs an agent step in one hidden durable Session and stores its text and session id', async () => {
    const { ctx, routines } = await harness(new ScriptedAdapter([textResponse('Pedido confirmado por el cliente.')]))
    const routine = await routines.createRoutine(OWNER, {
      name: 'Confirmar pedido',
      definition: definition([{ id: 's1', instruction: 'confirma el pedido con el cliente', handler: 'agent' }]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-1', channel: 'ui' })

    expect(started.execution.status).toBe('completed')
    const outcome = started.execution.steps.s1?.result as AgentStepOutcome
    expect(outcome).toMatchObject({ handler: 'agent', text: 'Pedido confirmado por el cliente.', endReason: 'completed', toolCalls: [] })
    expect(outcome.sessionId).toMatch(/^faberloom-step-/)

    const session = ctx.agents.get(SessionId(outcome.sessionId))
    expect(session).toBeDefined()
    expect(session?.session.header.cwd).toBe(process.cwd())
    expect(session?.session.header.origin).toBe('subagent')
    expect(promptsOf(ctx, outcome.sessionId)).toEqual([
      ['Paso "s1" de la rutina en curso.', '', 'confirma el pedido con el cliente', '', 'Contexto del caso:', '{"input":null,"event":null}'].join('\n'),
    ])
  })

  it('F15 — prompts an mcp step to use the tools and records the calls its turn made', async () => {
    const { ctx, routines } = await harness(new ScriptedAdapter([stockCallResponse('call-1'), textResponse('Hay 12 unidades.')]))
    const routine = await routines.createRoutine(OWNER, {
      name: 'Consultar stock',
      definition: definition([{ id: 's1', instruction: 'consulta el stock del producto A-1', handler: 'mcp' }]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-2', channel: 'ui' })

    const outcome = started.execution.steps.s1?.result as AgentStepOutcome
    expect(outcome.handler).toBe('mcp')
    expect(outcome.toolCalls).toEqual([{ name: 'mwt.stock', callId: 'call-1' }])
    expect(outcome.text).toBe('Hay 12 unidades.')
    expect(promptsOf(ctx, outcome.sessionId)[0]).toContain('Ejecuta la operación con las herramientas MCP disponibles')
  })

  it('F15 — fails the step when its turn ends in error, naming the session and the failure', async () => {
    const { routines } = await harness(new FailingAdapter('proveedor caído'))
    const routine = await routines.createRoutine(OWNER, {
      name: 'Caída del proveedor',
      definition: definition([{ id: 's1', instruction: 'consulta el stock', handler: 'agent' }]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-4', channel: 'ui' })

    expect(started.execution.status).toBe('failed')
    expect(started.execution.reason).toContain('proveedor caído')
    expect(started.execution.reason).toContain('faberloom-step-')
    expect(started.execution.steps.s1).toMatchObject({ status: 'failed', result: null })
  })

  it('F15 — reuses one Session across the steps of the same execution', async () => {
    const { ctx, routines } = await harness(new ScriptedAdapter([textResponse('primer paso'), textResponse('segundo paso')]))
    const routine = await routines.createRoutine(OWNER, {
      name: 'Dos pasos',
      definition: definition([
        { id: 's1', instruction: 'primer paso de la rutina', handler: 'agent' },
        { id: 's2', instruction: 'segundo paso de la rutina', handler: 'agent', dependsOn: ['s1'] },
      ]),
    })
    await routines.activateRoutine(OWNER, routine.id)
    const started = await routines.startExecution({ routineId: routine.id, idempotencyKey: 'caso-3', channel: 'ui' })

    const first = started.execution.steps.s1?.result as AgentStepOutcome
    const second = started.execution.steps.s2?.result as AgentStepOutcome
    expect(second.sessionId).toBe(first.sessionId)
    expect(promptsOf(ctx, first.sessionId)).toHaveLength(2)
  })
})
