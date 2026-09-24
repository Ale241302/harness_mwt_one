/**
 * Native product routine step handlers (`ctx.faberloomHandlers`): the
 * implementation behind each `handler` name a routine step declares. The engine
 * refuses to activate a routine whose steps name an unregistered handler
 * (`MISSING_HANDLER`), so this package is what makes a runnable routine runnable.
 *
 * Each handler is registered through the routines service and removed with its
 * own fiber. `agent` and `mcp` run their turn in one hidden durable Session per
 * execution ({@link RoutineStepSessions}); `wait` parks the run on an event.
 * @module @deepseek-ai/dsh-faberloom-handlers
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { FaberLoomExecutionId, StepContext, StepHandler } from '@deepseek-ai/dsh-faberloom-routines'
import type {} from '@deepseek-ai/dsh-faberloom-backup'
// Type-only: pulls the ctx.faberloomConnections and ctx.faberloomInbound merges.
import type {} from '@deepseek-ai/dsh-faberloom-connections'
import type {} from '@deepseek-ai/dsh-faberloom-inbound'
import { RoutineStepSessions, type RoutineStepToolCall } from './step-agent.ts'

export type * from './step-agent.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomHandlers: FaberLoomHandlers
  }
}

/** Outcome of the `wait` handler. */
export interface WaitStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'wait'
  /** Key of the event that resumed the step, or null when it never waited. */
  readonly matched: string | null
}

/** Outcome of the `agent` and `mcp` handlers. */
export interface AgentStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'agent' | 'mcp'
  /** Durable Session the step ran in; the audit link a reader follows. */
  readonly sessionId: string
  /** Final assistant text of the step's turn, or an empty string. */
  readonly text: string
  /** Why the turn ended, or null when the log carried no `turn/end`. */
  readonly endReason: string | null
  /** Structured failure the turn ended with, or null when it ended otherwise. */
  readonly failure: string | null
  /** Tools the turn called, in call order. */
  readonly toolCalls: readonly RoutineStepToolCall[]
}

/** Outcome of the `email.send` handler. */
export interface EmailSendStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'email.send'
  /** Recipients the message was sent to. */
  readonly to: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Body sent. */
  readonly text: string
  /** `Message-ID` the send generated, for reply threading. */
  readonly messageId: string
}

/** Outcome of the `email.extract-spreadsheet-link` handler. */
export interface EmailExtractStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'email.extract-spreadsheet-link'
  /** The first spreadsheet link found, or null. */
  readonly link: string | null
}

/** Outcome of the `email.followup` handler. */
export interface EmailFollowupStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'email.followup'
  /** Whether a follow-up was sent. */
  readonly resent: boolean
  /** Why the handler did or did not resend. */
  readonly reason: string
}

/** Outcome one step handler returns; the engine stores it as the step result. */
export type StepOutcome =
  | WaitStepOutcome
  | AgentStepOutcome
  | BackupStepOutcome
  | EmailSendStepOutcome
  | EmailExtractStepOutcome
  | EmailFollowupStepOutcome

/** Outcome of the `backup` handler. */
export interface BackupStepOutcome {
  /** Handler that produced the outcome. */
  readonly handler: 'backup'
  /** Manifest id of the captured snapshot; a reader follows it to the backup. */
  readonly backupId: string
  /** Number of product domains captured. */
  readonly domains: number
  /** Integrity digest of the captured payload. */
  readonly digest: string
}

/**
 * Complete a step that was parked until a matching event arrived.
 *
 * The engine parks a step whose `waitFor` is set and no event matches it yet;
 * this handler runs when that event arrives, so it records which event resumed
 * the run. A step whose `waitFor` is empty is a manual barrier: the run stops on
 * it until a person advances it, and the handler settles it on that pass.
 * @param context - the step being executed.
 * @returns the settled outcome.
 */
async function waitHandler(context: StepContext): Promise<StepOutcome> {
  return { handler: 'wait', matched: context.event?.key ?? null }
}

/**
 * Run one agent turn in the execution's hidden Session.
 * @param ctx - context that owns the routine service and the Session.
 * @param sessions - per-execution Session owner.
 * @param context - the step being executed.
 * @param handler - which handler asked for the run.
 * @returns the settled outcome, carrying the Session id.
 */
async function runAgentStep(
  ctx: Context,
  sessions: RoutineStepSessions,
  context: StepContext,
  handler: 'agent' | 'mcp',
): Promise<StepOutcome> {
  const instruction = await stepInstruction(ctx, context)
  const run = await sessions.run(context.executionId, stepPrompt(handler, context, instruction))
  return { handler, ...run }
}

/**
 * Read the instruction the running version recorded for this step.
 * @param ctx - context carrying the routines service.
 * @param context - the step being executed.
 * @returns the step's instruction text.
 */
async function stepInstruction(ctx: Context, context: StepContext): Promise<string> {
  const execution = await ctx.faberloomRoutines.getExecution(context.executionId as FaberLoomExecutionId)
  const version = await ctx.faberloomRoutines.getRoutineVersion(execution.routineId, execution.routineVersion)
  const step = version.steps.find(entry => entry.id === context.stepId)
  if (step === undefined) {
    throw new Error(`faberloom: step ${context.stepId} is not part of routine version ${String(execution.routineVersion)}`)
  }
  return step.instruction
}

/** Longest case context the prompt carries; the rest is a marker, not a truncation that hides data. */
const CASE_CONTEXT_LIMIT = 4000

/**
 * Build the model-facing prompt for one step turn.
 * @param handler - which handler asked for the run.
 * @param context - the step being executed.
 * @param instruction - the step's recorded instruction.
 * @returns the prompt delivered to the hidden Session.
 */
export function stepPrompt(handler: 'agent' | 'mcp', context: StepContext, instruction: string): string {
  const rendered = JSON.stringify({ input: context.input ?? null, event: context.event ?? null })
  const lines = [
    `Paso "${context.stepId}" de la rutina en curso.`,
    '',
    instruction,
    '',
    'Contexto del caso:',
    rendered.length > CASE_CONTEXT_LIMIT ? `${rendered.slice(0, CASE_CONTEXT_LIMIT)}…` : rendered,
  ]
  if (handler === 'mcp') {
    lines.push('', 'Ejecuta la operación con las herramientas MCP disponibles y devuelve el resultado.')
  }
  return lines.join('\n')
}

/** The handler names this package registers, in registration order. */
export const HANDLER_NAMES = [
  'wait', 'agent', 'mcp', 'backup',
  'email.send', 'email.extract-spreadsheet-link', 'email.followup',
] as const

/**
 * Capture a product backup for the execution's owner. The dispatcher runs a
 * routine with a recurrence trigger, so a scheduled step gives the product the
 * periodic snapshot its plan asks for (E8 / F20) without a separate scheduler.
 * @param ctx - context carrying the routines and backup services.
 * @param context - the step being executed.
 * @returns the settled outcome, carrying the captured manifest.
 */
async function backupHandler(ctx: Context, context: StepContext): Promise<StepOutcome> {
  const execution = await ctx.faberloomRoutines.getExecution(context.executionId as FaberLoomExecutionId)
  const manifest = await ctx.faberloomBackup.createBackup(execution.ownerId, { note: `rutina:${String(context.routineId)}` })
  return { handler: 'backup', backupId: manifest.id, domains: manifest.domains.length, digest: manifest.digest }
}

/** The owner of the running execution. */
async function executionOwner(ctx: Context, context: StepContext): Promise<string> {
  const execution = await ctx.faberloomRoutines.getExecution(context.executionId as FaberLoomExecutionId)
  return execution.ownerId
}

/** Read `{ to, subject, text }` from the step input or the event data. */
function readMail(context: StepContext): { to: string[]; subject: string; text: string } | undefined {
  for (const candidate of [context.input, context.event?.data]) {
    if (candidate === null || typeof candidate !== 'object') continue
    const source = candidate as Record<string, unknown>
    const rawTo = source['to']
    const to = Array.isArray(rawTo)
      ? rawTo.map(String)
      : typeof rawTo === 'string' ? rawTo.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0) : undefined
    if (to !== undefined && to.length > 0 && typeof source['subject'] === 'string' && typeof source['text'] === 'string') {
      return { to, subject: source['subject'], text: source['text'] }
    }
  }
  return undefined
}

/** First spreadsheet link in a text body; `xlsx` or `xls`, query string allowed. */
const SPREADSHEET_LINK = /https?:\/\/[^\s"'<>)]+\.(?:xlsx|xls)(?:\?[^\s"'<>)]*)?/i

/**
 * Find the first spreadsheet link in one text.
 * @param text - the message body.
 * @returns the link, or null.
 */
export function extractSpreadsheetLink(text: string): string | null {
  const match = SPREADSHEET_LINK.exec(text)
  return match === null ? null : match[0]
}

/** The most recent `email.send` result among the completed steps. */
function findSent(results: Readonly<Record<string, unknown>>): EmailSendStepOutcome | undefined {
  for (const value of Object.values(results)) {
    if (value !== null && typeof value === 'object' && (value as { handler?: unknown }).handler === 'email.send') {
      return value as EmailSendStepOutcome
    }
  }
  return undefined
}

/**
 * Send one email from the step input or event data.
 * @param ctx - context carrying the connections service.
 * @param context - the step being executed.
 * @returns the settled outcome.
 */
async function emailSendHandler(ctx: Context, context: StepContext): Promise<StepOutcome> {
  const mail = readMail(context)
  if (mail === undefined) throw new Error('faberloom: email.send needs {to, subject, text} in the step input or event data')
  const connections = ctx.get('faberloomConnections')
  if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
  const sent = await connections.sendMail(await executionOwner(ctx, context), mail)
  return { handler: 'email.send', to: mail.to, subject: mail.subject, text: mail.text, messageId: sent.messageId }
}

/**
 * Extract the first spreadsheet link from the message that triggered the run.
 * @param ctx - context carrying the inbound receiver.
 * @param context - the step being executed.
 * @returns the settled outcome.
 */
async function emailExtractHandler(ctx: Context, context: StepContext): Promise<StepOutcome> {
  const inbound = ctx.get('faberloomInbound')
  if (inbound === undefined) throw new Error('faberloom: the inbound receiver is not mounted')
  const uid = context.event?.data === undefined ? undefined : context.event.data['uid']
  if (typeof uid !== 'number') return { handler: 'email.extract-spreadsheet-link', link: null }
  const content = await inbound.readEmail(await executionOwner(ctx, context), uid)
  const text = content.text.length > 0 ? content.text : content.html ?? ''
  return { handler: 'email.extract-spreadsheet-link', link: text.length === 0 ? null : extractSpreadsheetLink(text) }
}

/**
 * After a wait, resend the earlier email when no reply arrived in the thread.
 * @param ctx - context carrying the connections service.
 * @param context - the step being executed.
 * @returns the settled outcome.
 */
async function emailFollowupHandler(ctx: Context, context: StepContext): Promise<StepOutcome> {
  const sent = findSent(context.results)
  if (sent === undefined) return { handler: 'email.followup', resent: false, reason: 'no previous send' }
  const replied = context.events.some((event) => {
    const data = event.data ?? {}
    const references = [data['in-reply-to'], data['inReplyTo'], data['references']]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
    return references.includes(sent.messageId)
  })
  if (replied) return { handler: 'email.followup', resent: false, reason: 'replied' }
  const connections = ctx.get('faberloomConnections')
  if (connections === undefined) throw new Error('faberloom: the connections service is not mounted')
  await connections.sendMail(await executionOwner(ctx, context), { to: sent.to, subject: sent.subject, text: sent.text })
  return { handler: 'email.followup', resent: true, reason: 'no reply' }
}

/** Step handler registry owned by the FaberLoom product layer. */
export class FaberLoomHandlers extends Service {
  static inject = ['faberloomRoutines', 'faberloomBackup']

  /**
   * @param ctx - Cordis context owning the service fiber.
   */
  constructor(ctx: Context) {
    super(ctx, 'faberloomHandlers')
    const sessions = new RoutineStepSessions(ctx)
    const handlers: Record<(typeof HANDLER_NAMES)[number], StepHandler> = {
      wait: waitHandler,
      agent: context => runAgentStep(ctx, sessions, context, 'agent'),
      mcp: context => runAgentStep(ctx, sessions, context, 'mcp'),
      backup: context => backupHandler(ctx, context),
      'email.send': context => emailSendHandler(ctx, context),
      'email.extract-spreadsheet-link': context => emailExtractHandler(ctx, context),
      'email.followup': context => emailFollowupHandler(ctx, context),
    }
    for (const [name, handler] of Object.entries(handlers)) {
      this.ctx.effect(() => ctx.faberloomRoutines.registerHandler(name, handler), `faberloom.handlers.${name}`)
    }
    this.ctx.effect(() => () => sessions.dispose(), 'faberloom.handlers.sessions')
  }
}

export default FaberLoomHandlers
