/**
 * The hidden durable Session a routine's `agent` and `mcp` steps run under. One
 * Session is created per execution and reused by every later step of it, so a
 * multi-step routine accumulates one conversation instead of starting over.
 *
 * The Session records the deployment working directory, because the assembled
 * system prompt reads it, and is marked `origin: "subagent"`, which is the
 * classification the workspace tree filters out of the owner's session list.
 * @module @deepseek-ai/dsh-faberloom-handlers/step-agent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** One tool the step's turn called, in call order. */
export interface RoutineStepToolCall {
  /** Tool name as the model requested it. */
  readonly name: string
  /** Provider call id, which pairs the call with its `tool/result`. */
  readonly callId: string
}

/** What one routine step observed from its hidden Session. */
export interface RoutineStepRun {
  /** Durable Session the step ran in; its id is the step result's audit link. */
  readonly sessionId: string
  /** Final non-empty assistant text of the step's turn, or an empty string. */
  readonly text: string
  /** Why the turn ended, as its `kind`, or null when the log carried no `turn/end`. */
  readonly endReason: string | null
  /** Structured failure the turn ended with, or null when it ended otherwise. */
  readonly failure: string | null
  /** Tools the turn called, in call order. */
  readonly toolCalls: readonly RoutineStepToolCall[]
}

/** Owns the hidden Sessions routine steps run in, one per execution. */
export class RoutineStepSessions {
  private readonly handles = new Map<string, Promise<AgentHandle>>()

  /**
   * @param ctx - context that owns every Session this object creates.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Deliver one prompt to the execution's Session and resolve when its turn settles.
   * @param executionId - execution whose Session owns the step.
   * @param prompt - model-facing step prompt.
   * @returns what the settled turn produced.
   */
  async run(executionId: string, prompt: string): Promise<RoutineStepRun> {
    const agent = (await this.handle(executionId)).agent
    const from = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'faberloom-handlers' },
    }))
    await agent.whenIdle()
    const run = summarize(agent, from)
    if (run.endReason !== 'completed') {
      throw new Error(
        `faberloom: el paso no completó (${run.endReason ?? 'sin turn/end'})${run.failure === null ? '' : `: ${run.failure}`} (sesión ${run.sessionId})`,
      )
    }
    return run
  }

  /** Dispose every Session this object still owns. */
  async dispose(): Promise<void> {
    const pending = [...this.handles.values()]
    this.handles.clear()
    for (const handle of pending) {
      try {
        await (await handle).dispose()
      } catch (error: unknown) {
        this.ctx.logger.warn(`faberloom: routine step session disposal failed: ${String(error)}`)
      }
    }
  }

  private handle(executionId: string): Promise<AgentHandle> {
    let pending = this.handles.get(executionId)
    if (pending === undefined) {
      pending = this.create()
      this.handles.set(executionId, pending)
      // A failed creation must not pin the execution to a rejected promise.
      void pending.catch(() => {
        if (this.handles.get(executionId) === pending) this.handles.delete(executionId)
      })
    }
    return pending
  }

  private async create(): Promise<AgentHandle> {
    const agents = this.ctx.get('agents')
    if (agents === undefined) throw new Error('faberloom: routine agent steps need the agents service')
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
    const agentOptions: AgentOptions | undefined = selection === undefined
      ? undefined
      : {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      }
    return await agents.create({
      sessionId: brandString<SessionId>(`faberloom-step-${randomUUID()}`),
      meta: { cwd: await this.cwd(), origin: 'subagent' },
      ...agentOptions === undefined ? {} : { agentOptions },
    })
  }

  /** Resolve the working directory the session header and the system prompt need. */
  private async cwd(): Promise<string> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return process.cwd()
    return fs.processPath(await fs.resolve('.'))
  }
}

/**
 * Read one settled turn from the session's durable log.
 * @param agent - the Agent whose turn settled.
 * @param from - session sequence the prompt started at.
 * @returns the selected text, the end reason, and the calls the turn made.
 */
export function summarize(agent: Agent, from: number): RoutineStepRun {
  let text = ''
  let endReason: string | null = null
  let failure: string | null = null
  const toolCalls: RoutineStepToolCall[] = []
  for (const event of agent.session.snapshotEvents().slice(from)) {
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      if (joined.length > 0) text = joined
      continue
    }
    if (event.type === 'tool/call') {
      toolCalls.push({ name: event.data.name, callId: String(event.data.callId) })
      continue
    }
    if (event.type === 'turn/end') {
      endReason = event.data.reason.kind
      if (event.data.reason.kind === 'error') failure = event.data.reason.error.message
      continue
    }
  }
  return { sessionId: String(agent.session.id), text, endReason, failure, toolCalls }
}
