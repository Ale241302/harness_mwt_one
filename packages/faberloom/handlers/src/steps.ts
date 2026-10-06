/**
 * Work-flow step handlers: the config-driven implementations behind the
 * handler names the Work Flow compiler emits. Each handler reads its node's
 * configuration from `StepContext.config`, resolves optional services through
 * `ctx.get` (they are optional, since a deployment may mount a subset), and
 * returns a JSON outcome the engine stores as the step result.
 *
 * Effect handlers (`imap`, `smtp`, `board.create`) run only after the engine's
 * grant check; the engine marks the step `effect` and ledgers it.
 * @module @deepseek-ai/dsh-faberloom-handlers/src/steps
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { FaberLoomExecutionId, FaberLoomRoutineId, StepContext, StepHandler } from '@deepseek-ai/dsh-faberloom-routines'
import type { FaberLoomSpaceId, SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import type { WorkFlowId } from '@deepseek-ai/dsh-faberloom-workflows'
import type { TeachingScope } from '@deepseek-ai/dsh-faberloom-learning'
import type {} from '@deepseek-ai/dsh-faberloom-access'
import type {} from '@deepseek-ai/dsh-faberloom-board'
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type {} from '@deepseek-ai/dsh-faberloom-inbound'
import type {} from '@deepseek-ai/dsh-tools'

/** Longest one direct MCP tool call may take before it is abandoned. */
export const MCP_CALL_TIMEOUT_MS = 120_000

/** Longest an inline `delay` handler waits, so a misconfigured node cannot stall a pass indefinitely. */
export const MAX_DELAY_SECONDS = 300

/** The owning identity of the running execution. */
async function ownerOf(ctx: Context, context: StepContext): Promise<string> {
  const execution = await ctx.faberloomRoutines.getExecution(context.executionId as FaberLoomExecutionId)
  return execution.ownerId
}

/** The admin actor the engine's own automations act as, scoped to one owner. */
function actorOf(ownerId: string): SpaceActor {
  return { id: ownerId, role: 'admin', companyId: undefined, readOnly: false }
}

/**
 * Render one value as text: `''` for absent, the value itself for a string, and
 * JSON otherwise.
 * @param value - the value to render.
 * @returns the text.
 */
export function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}

/**
 * Resolve a dotted path against the step context: `event.<field>`,
 * `input.<field>`, or `result.<stepId>[.<field>…]`.
 * @param path - the dotted path.
 * @param context - the running step.
 * @returns the resolved value, or `undefined` when the path does not resolve.
 */
export function resolvePath(path: string, context: StepContext): unknown {
  const [root, ...rest] = path.split('.')
  let value: unknown
  if (root === 'event') value = context.event
  else if (root === 'input') value = context.input
  else if (root === 'result') value = context.results[rest.shift() ?? '']
  else return undefined
  for (const segment of rest) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

/**
 * Replace `{{path}}` placeholders with their resolved, rendered values.
 * @param template - the template text.
 * @param context - the running step.
 * @returns the rendered text.
 */
export function renderTemplate(template: string, context: StepContext): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => stringValue(resolvePath(path, context)))
}

/**
 * Evaluate the small condition grammar `<path> <op> [value]`, with `==`, `!=`,
 * `contains`, `exists`, `>`, and `<`.
 * @param expression - the condition text.
 * @param context - the running step.
 * @returns whether the condition holds.
 * @throws when the expression is malformed or names an unknown operator.
 */
export function evaluateCondition(expression: string, context: StepContext): boolean {
  const parts = expression.trim().split(/\s+/)
  const path = parts[0] as string
  const op = parts[1]
  if (path.length === 0 || op === undefined) {
    throw new Error(`faberloom: condition expression "${expression}" must be "<path> <op> [value]"`)
  }
  const right = parts.slice(2).join(' ').replace(/^["']|["']$/g, '')
  switch (op) {
    case '==': return stringValue(resolvePath(path, context)) === right
    case '!=': return stringValue(resolvePath(path, context)) !== right
    case 'contains': return stringValue(resolvePath(path, context)).includes(right)
    case 'exists': return resolvePath(path, context) !== undefined
    case '>': return Number(stringValue(resolvePath(path, context))) > Number(right)
    case '<': return Number(stringValue(resolvePath(path, context))) < Number(right)
    default: throw new Error(`faberloom: unknown condition operator "${op}"`)
  }
}

/**
 * Read one config value as text, falling back when it is absent or empty.
 * @param value - the raw config value.
 * @param fallback - the text when the value renders empty.
 * @returns the text.
 */
function configString(value: unknown, fallback = ''): string {
  const text = stringValue(value)
  return text.length > 0 ? text : fallback
}

/** Read a message uid from the resuming event or the step input. */
function readUid(context: StepContext): number | undefined {
  const fromEvent = context.event?.data?.['uid']
  if (typeof fromEvent === 'number') return fromEvent
  const fromInput = context.input === null || typeof context.input !== 'object' ? undefined : (context.input as Record<string, unknown>)['uid']
  return typeof fromInput === 'number' ? fromInput : undefined
}

/**
 * Build the config-driven handlers this package registers.
 * @param ctx - context that owns the routines, connections, inbound, board, spaces, and memory services.
 * @returns handler name → handler.
 */
export function createWorkflowHandlers(ctx: Context): Record<string, StepHandler> {
  return {
    condition: (context) => {
      const expression = stringValue(context.config['expression'] ?? '')
      return { handler: 'condition', expression, passed: evaluateCondition(expression, context) }
    },
    transform: (context) => {
      const expression = stringValue(context.config['expression'] ?? '')
      return { handler: 'transform', expression, value: renderTemplate(expression, context) }
    },
    delay: async (context) => {
      const waitFor = context.config['waitFor']
      if (typeof waitFor === 'string' && waitFor.length > 0) return { handler: 'delay', matched: context.event?.key ?? null }
      const seconds = typeof context.config['seconds'] === 'number' ? context.config['seconds'] : 0
      const bounded = Math.min(Math.max(seconds, 0), MAX_DELAY_SECONDS)
      if (bounded > 0) await new Promise(resolve => setTimeout(resolve, bounded * 1000))
      return { handler: 'delay', waitedSeconds: bounded }
    },
    imap: async (context) => {
      const inbound = ctx.get('faberloomInbound')
      if (inbound === undefined) throw new Error('faberloom: the inbound receiver is not mounted')
      const owner = await ownerOf(ctx, context)
      const op = configString(context.config['op'])
      if (op === 'search') return { handler: 'imap', op, count: (await inbound.searchMailbox(owner, configString(context.config['query']))).length }
      const uid = readUid(context)
      if (uid === undefined) throw new Error(`faberloom: imap action "${op}" needs a message uid in event.data.uid or input.uid`)
      if (op === 'mark' || op === 'flag') return { handler: 'imap', op, uid, done: await inbound.markSeen(owner, uid) }
      if (op === 'move' || op === 'delete') return { handler: 'imap', op, uid, mailbox: await inbound.moveToTrash(owner, uid) }
      if (op === 'read') return { handler: 'imap', op, uid, text: (await inbound.readEmail(owner, uid)).text }
      throw new Error(`faberloom: unknown imap action "${op}"`)
    },
    smtp: async (context) => {
      const connections = ctx.get('faberloomConnections')
      if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
      const to = Array.isArray(context.config['to']) ? context.config['to'].map(String) : []
      if (to.length === 0) throw new Error('faberloom: smtp.send needs at least one recipient')
      const owner = await ownerOf(ctx, context)
      const subject = renderTemplate(configString(context.config['subject']), context)
      const template = context.config['template']
      const text = typeof template === 'string' ? renderTemplate(template, context) : ''
      const connectionId = context.config['connectionId']
      const sent = await connections.sendMail(owner, { to, subject, text }, typeof connectionId === 'string' ? connectionId : undefined)
      return { handler: 'smtp', to, subject, messageId: sent.messageId }
    },
    'memory.remember': async (context) => {
      const spaces = ctx.get('faberloomSpaces')
      if (spaces === undefined) throw new Error('faberloom: the spaces service is not mounted')
      const spaceId = configString(context.config['spaceId'])
      if (spaceId.length === 0) throw new Error('faberloom: memory.remember needs a spaceId')
      const owner = await ownerOf(ctx, context)
      const text = renderTemplate(configString(context.config['text']), context)
      const entry = await spaces.remember(actorOf(owner), text, [brandString<FaberLoomSpaceId>(spaceId)])
      return { handler: 'memory.remember', id: entry.id, spaceId }
    },
    'memory.teach': async (context) => {
      const memory = ctx.get('faberloomMemory')
      if (memory === undefined) throw new Error('faberloom: the memory service is not mounted')
      const owner = await ownerOf(ctx, context)
      const active = context.config['active']
      const teaching = await memory.createTeaching(owner, {
        scope: configString(context.config['scope'], 'case') as TeachingScope,
        text: renderTemplate(configString(context.config['text']), context),
        source: configString(context.config['source'], 'workflow'),
        author: owner,
        ...typeof active === 'boolean' ? { active } : {},
      })
      return { handler: 'memory.teach', id: teaching.id }
    },
    'board.create': async (context) => {
      const board = ctx.get('faberloomBoard')
      if (board === undefined) throw new Error('faberloom: the board service is not mounted')
      const owner = await ownerOf(ctx, context)
      const spaceId = context.config['spaceId']
      const item = await board.create(owner, {
        title: renderTemplate(configString(context.config['title']), context),
        summary: renderTemplate(configString(context.config['summary']), context),
        evidence: [`routine:${context.executionId}:${context.stepId}`],
        routineId: String(context.routineId),
        executionId: context.executionId,
        ...typeof spaceId === 'string' ? { spaceId } : {},
      })
      return { handler: 'board.create', id: item.id }
    },
    reference: async (context) => {
      const spaces = ctx.get('faberloomSpaces')
      if (spaces === undefined) throw new Error('faberloom: the spaces service is not mounted')
      const spaceId = configString(context.config['spaceId'])
      if (spaceId.length === 0) throw new Error('faberloom: space.reference needs a spaceId')
      const owner = await ownerOf(ctx, context)
      const effective = await spaces.effectiveContext(actorOf(owner), brandString<FaberLoomSpaceId>(spaceId))
      return { handler: 'reference', spaceId, resolved: effective.resolved, sources: effective.sources }
    },
    subroutine: async (context) => {
      const routineId = configString(context.config['routineId'])
      if (routineId.length === 0) throw new Error('faberloom: routine.invoke needs a routineId')
      const started = await ctx.faberloomRoutines.startExecution({
        routineId: brandString<FaberLoomRoutineId>(routineId),
        idempotencyKey: `${context.executionId}:${context.stepId}`,
        channel: 'subroutine',
      })
      return { handler: 'subroutine', executionId: String(started.execution.id), deduped: started.deduped }
    },
    workflow: async (context) => {
      const workflowId = configString(context.config['workflowId'])
      if (workflowId.length === 0) throw new Error('faberloom: workflow.invoke needs a workflowId')
      const workflows = ctx.get('faberloomWorkflows')
      if (workflows === undefined) throw new Error('faberloom: the workflows service is not mounted')
      const owner = await ownerOf(ctx, context)
      const started = await workflows.invoke(
        { id: owner },
        brandString<WorkFlowId>(workflowId),
        { idempotencyKey: `${context.executionId}:${context.stepId}` },
      )
      return { handler: 'workflow', executionId: started.executionId, deduped: started.deduped }
    },
    'mcp.call': async (context) => {
      const server = configString(context.config['server'])
      const tool = configString(context.config['tool'])
      if (server.length === 0 || tool.length === 0) throw new Error('faberloom: mcp.call needs a server and a tool')
      const owner = await ownerOf(ctx, context)
      const access = ctx.get('faberloomAccess')
      if (access !== undefined) {
        const decision = await access.check({ ownerId: owner, action: `mcp:${server}:${tool}`, context: String(context.routineId) })
        if (!decision.allowed) throw new Error(`faberloom: mcp.call ${server}:${tool} is not allowed (${decision.reason})`)
      }
      const tools = ctx.get('tools')
      if (tools === undefined) throw new Error('faberloom: the tools service is not mounted')
      const raw = context.config['arguments']
      const result = await tools.execute({
        callId: ToolCallId(`routine-${context.executionId}-${context.stepId}`),
        name: `mcp__${server}__${tool}`,
        arguments: raw !== null && typeof raw === 'object' ? raw : {},
        signal: AbortSignal.timeout(MCP_CALL_TIMEOUT_MS),
      })
      return { handler: 'mcp.call', server, tool, isError: result.isError }
    },
    notify: async (context) => {
      const text = renderTemplate(configString(context.config['text']), context)
      if (configString(context.config['kind'], 'board') === 'email') {
        const connections = ctx.get('faberloomConnections')
        if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
        const owner = await ownerOf(ctx, context)
        const sent = await connections.sendMail(owner, { to: [owner], subject: 'Work Flow', text })
        return { handler: 'notify', channel: 'email', messageId: sent.messageId }
      }
      const board = ctx.get('faberloomBoard')
      if (board === undefined) throw new Error('faberloom: the board service is not mounted')
      const owner = await ownerOf(ctx, context)
      const item = await board.create(owner, {
        title: text.length > 0 ? text : 'Work Flow',
        summary: text,
        evidence: [`routine:${context.executionId}:${context.stepId}`],
        routineId: String(context.routineId),
        executionId: context.executionId,
      })
      return { handler: 'notify', channel: 'board', id: item.id }
    },
    deadletter: async (context) => {
      const board = ctx.get('faberloomBoard')
      if (board === undefined) throw new Error('faberloom: the board service is not mounted')
      const owner = await ownerOf(ctx, context)
      const reason = renderTemplate(configString(context.config['reason'], 'node failed'), context)
      const item = await board.create(owner, {
        title: `Dead letter: ${context.stepId}`,
        summary: reason,
        evidence: [`routine:${context.executionId}:${context.stepId}`],
        routineId: String(context.routineId),
        executionId: context.executionId,
      })
      return { handler: 'deadletter', id: item.id, reason }
    },
  }
}
