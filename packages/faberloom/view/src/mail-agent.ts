/**
 * The durable agent behind the floating mail assistant. Each conversation key
 * owns one session created through the harness agent registry, so the answer
 * runs the real loop: model routing, tools, MCP servers, skills, and files in
 * the session workspace — not a one-shot completion with a token cap.
 * @module @deepseek-ai/dsh-faberloom-view/mail-agent
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** One tool the mail agent called during a turn. */
export interface MailAgentToolCall {
  /** Tool name as the model requested it. */
  readonly name: string
}

/** What one settled mail-agent turn produced. */
export interface MailAgentRun {
  /** Final assistant text, with any max-token continuation appended. */
  readonly text: string
  /** Tools the turn called, in call order. */
  readonly toolCalls: readonly MailAgentToolCall[]
  /** Durable session the turn ran in; the owner can open it in the chat. */
  readonly sessionId: string
  /** Why the last turn ended, or null when the log carried no `turn/end`. */
  readonly endReason: string | null
  /** Structured failure the turn ended with, or null. */
  readonly failure: string | null
}

/** Model route the owner chose in the assistant composer. */
export interface MailAgentRoute {
  readonly provider: string
  readonly model: string
}

interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

interface MailAgentLike {
  readonly session: {
    readonly id: unknown
    readonly seq: number
    snapshotEvents(): readonly SessionEventLike[]
  }
  followup(message: unknown): void
  whenIdle(): Promise<void>
}

interface MailAgentHandle {
  readonly agent: MailAgentLike
  dispose(): Promise<void>
}

interface AgentsLike {
  create(options: {
    readonly sessionId: never
    readonly meta: { readonly cwd: string }
    readonly agentOptions: { readonly provider: string; readonly model: string }
  }): Promise<MailAgentHandle>
}

/** Narrow one assistant text block list into plain text. */
function assistantText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const message = (data as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block: unknown) => {
    if (typeof block !== 'object' || block === null) return []
    const typed = block as { type?: unknown; text?: unknown }
    return typed.type === 'text' && typeof typed.text === 'string' ? [typed.text] : []
  }).join('')
}

/** Read the turn that started at `from`, including its calls and ending. */
function readRun(agent: MailAgentLike, from: number): Omit<MailAgentRun, 'sessionId'> {
  let text = ''
  let endReason: string | null = null
  let failure: string | null = null
  const toolCalls: MailAgentToolCall[] = []
  for (const event of agent.session.snapshotEvents().slice(from)) {
    if (event.type === 'assistant/message') {
      const joined = assistantText(event.data)
      if (joined.length > 0) text = joined
      continue
    }
    if (event.type === 'tool/call') {
      const name = typeof event.data === 'object' && event.data !== null
        ? (event.data as { name?: unknown }).name
        : undefined
      if (typeof name === 'string' && name.length > 0) toolCalls.push({ name })
      continue
    }
    if (event.type === 'turn/end' && typeof event.data === 'object' && event.data !== null) {
      const reason = (event.data as { reason?: unknown }).reason
      if (typeof reason === 'object' && reason !== null) {
        const typed = reason as { kind?: unknown; error?: unknown }
        if (typeof typed.kind === 'string') endReason = typed.kind
        const error = typed.error
        if (typeof error === 'object' && error !== null) {
          const message = (error as { message?: unknown }).message
          if (typeof message === 'string') failure = message
        }
      }
    }
  }
  return { text, toolCalls, endReason, failure }
}

/**
 * Owns the agent sessions the floating assistant talks to. One key (owner,
 * mail, route, agent, skills, Space) owns one session, so follow-ups continue
 * the same conversation and keep their tool history.
 */
export class MailAgentSessions {
  private readonly handles = new Map<string, Promise<MailAgentHandle>>()
  private readonly running = new Set<string>()

  /** Live conversations kept at once; older idle ones release their agent. */
  private static readonly LIVE_LIMIT = 8

  /**
   * @param ctx - host context that creates the sessions.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Deliver one prompt to the conversation's agent and wait for its turn.
   * @param key - conversation identity; repeat turns reuse its session.
   * @param seed - first-turn context, used only when the session is created.
   * @param question - the owner's current message.
   * @param route - chosen provider and model.
   * @returns the settled answer, its tool calls, and the session id.
   */
  async run(key: string, seed: string, question: string, route: MailAgentRoute): Promise<MailAgentRun> {
    const { handle, fresh } = await this.ensure(key, route)
    this.running.add(key)
    try {
      const agent = handle.agent
      let from = agent.session.seq
      // The seed and the question travel together on the first turn; later turns
      // carry only the question, because the session already holds the context.
      this.send(agent, fresh && seed.length > 0 ? `${seed}\n\n---\n\nPregunta del owner:\n${question}` : question)
      await agent.whenIdle()
      const first = readRun(agent, from)
      let text = first.text
      let endReason = first.endReason
      let failure = first.failure
      const toolCalls = [...first.toolCalls]
      // A max-token ending is a truncation, not a failure: ask the same session
      // to continue at the exact cut, so the owner receives the complete answer.
      for (let attempt = 0; attempt < 2 && endReason === 'max-tokens'; attempt += 1) {
        from = agent.session.seq
        this.send(agent, 'Continúa exactamente donde te quedaste. No repitas lo anterior; termina la respuesta.')
        await agent.whenIdle()
        const next = readRun(agent, from)
        text += `${text.length === 0 ? '' : '\n\n'}${next.text}`
        toolCalls.push(...next.toolCalls)
        endReason = next.endReason
        failure = next.failure
      }
      return { text, toolCalls, sessionId: String(agent.session.id), endReason, failure }
    } finally {
      this.running.delete(key)
      this.evict(key)
    }
  }

  /** Dispose every agent session this owner still holds. */
  async dispose(): Promise<void> {
    const pending = [...this.handles.values()]
    this.handles.clear()
    for (const handle of pending) {
      try {
        await (await handle).dispose()
      } catch (error: unknown) {
        this.ctx.logger.warn(`faberloom: mail agent disposal failed: ${String(error)}`)
      }
    }
  }

  private async ensure(
    key: string,
    route: MailAgentRoute,
  ): Promise<{ readonly handle: MailAgentHandle; readonly fresh: boolean }> {
    const existing = this.handles.get(key)
    if (existing !== undefined) {
      // Refresh insertion order so the least recently used conversation is the
      // first candidate for release.
      this.handles.delete(key)
      this.handles.set(key, existing)
      return { handle: await existing, fresh: false }
    }
    const created = this.create(route)
    this.handles.set(key, created)
    void created.catch(() => {
      if (this.handles.get(key) === created) this.handles.delete(key)
    })
    return { handle: await created, fresh: true }
  }

  /** Release the least recently used idle conversation past the live limit. */
  private evict(current: string): void {
    if (this.handles.size <= MailAgentSessions.LIVE_LIMIT) return
    for (const key of [...this.handles.keys()]) {
      if (this.handles.size <= MailAgentSessions.LIVE_LIMIT) return
      if (key === current || this.running.has(key)) continue
      const handle = this.handles.get(key)
      this.handles.delete(key)
      if (handle !== undefined) {
        void handle.then(async (settled) => { await settled.dispose() }).catch((error: unknown) => {
          this.ctx.logger.warn(`faberloom: mail agent eviction failed: ${String(error)}`)
        })
      }
    }
  }

  private async create(route: MailAgentRoute): Promise<MailAgentHandle> {
    const agents = this.ctx.get('agents') as unknown as AgentsLike | undefined
    if (agents === undefined) throw new Error('faberloom: the mail assistant needs the agents service')
    return await agents.create({
      sessionId: `faberloom-mail-${randomUUID()}` as never,
      meta: { cwd: await this.cwd() },
      agentOptions: { provider: route.provider, model: route.model },
    })
  }

  /** Deliver one user line through the session's agent. */
  private send(agent: MailAgentLike, text: string): void {
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-faberloom-view' },
    })
  }

  /** Resolve the working directory the session header and its prompt expect. */
  private async cwd(): Promise<string> {
    const fs = this.ctx.get('fs') as unknown as {
      processPath(path: string): string
      resolve(path: string): Promise<string>
    } | undefined
    if (fs === undefined) return process.cwd()
    return fs.processPath(await fs.resolve('.'))
  }
}
