/**
 * The deterministic answer of an iteration-chat field instruction (§9.7).
 *
 * The board applies the change; this module writes the exchange into the
 * session log so the reader sees the instruction and its result without a model
 * call. The assistant message is durable and replayable, and it declares the
 * router as its producer so nobody mistakes it for a model answer.
 * @module @deepseek-ai/dsh-faberloom-session-agent/instruction
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** One field change the board applied. */
export interface IterationInstructionChange {
  /** Field name as the item declares it. */
  readonly field: string
  /** Parsed value. */
  readonly value: string | number | boolean | null
}

/** What the board reports after one deterministic instruction. */
export interface IterationInstructionOutcome {
  /** Changes the router recognized. */
  readonly changes: readonly IterationInstructionChange[]
  /** Whether the attempt was live and the draft now carries the changes. */
  readonly applied: boolean
}

/** The board surface this row reads; the service itself lives in its own package. */
export interface IterationInstructionBoard {
  /**
   * Apply one instruction to the draft the chat session is attached to.
   * @param sessionId - chat session that typed the instruction.
   * @param text - the instruction.
   * @returns what changed, or undefined when the sentence belongs to the agent.
   */
  applyIterationInstruction(sessionId: string, text: string): Promise<IterationInstructionOutcome | undefined>
}

/**
 * The one line the chat shows after a routed instruction.
 * @param outcome - what the board applied.
 * @returns the user-facing reply.
 */
export function instructionReply(outcome: IterationInstructionOutcome): string {
  const changes = outcome.changes.map(change => `${change.field} = ${JSON.stringify(change.value)}`).join(', ')
  return outcome.applied
    ? `Apliqué ${changes} al borrador del intento. No llamé al modelo: fue el router determinista.`
    : `Reconocí ${changes}, pero el intento ya no está vivo: no escribí el borrador.`
}

/**
 * Write one instruction exchange into the session: the user's message, the
 * deterministic reply, and the step that contains both. The caller returns an
 * empty enter decision, so the loop closes the turn without a model call.
 * @param session - session the exchange belongs to.
 * @param messages - user messages the step claimed.
 * @param turn - turn the loop opened.
 * @param step - step the exchange occupies.
 * @param reply - text of the deterministic answer.
 */
export function appendInstructionExchange(
  session: Session,
  messages: readonly UserMessage[],
  turn: number,
  step: number,
  reply: string,
): void {
  session.append('step/start', { turn, step })
  for (const message of messages) session.append('user/message', message, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step,
    stream: [],
    message: {
      id: brandString<MessageId>(randomUUID()),
      role: 'assistant',
      content: [{ type: 'text', text: reply }],
      source: { kind: 'model', provider: 'faberloom', model: 'iteration-router' },
    },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step })
}
