/**
 * Public type vocabulary of the agent runtime: one durable consultation a
 * caller session holds with a Space agent. Types only — the service lives in
 * `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-agent-runtime/src/types
 */

/** One durable consultation between a caller session and a Space agent. */
export interface AgentConsultation {
  /** The Space the consulted agent leads. */
  readonly spaceId: string
  /** The caller session that started the consultation. */
  readonly callerSessionId: string
  /** The durable child session answering the consultation. */
  readonly childSessionId: string
  /** Display label recorded at start. */
  readonly label: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-change instant. */
  readonly updatedAt: string
}

/** Input accepted when recording one consultation. */
export interface AgentConsultationInput {
  /** The Space the consulted agent leads. */
  readonly spaceId: string
  /** The caller session starting the consultation. */
  readonly callerSessionId: string
  /** The durable child session answering it. */
  readonly childSessionId: string
  /** Display label. */
  readonly label: string
}
