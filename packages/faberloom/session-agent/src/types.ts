/**
 * Public type vocabulary of the Space session composition: the persona, tool
 * mask, and skills one session runs under. Types only — the service lives in
 * `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-session-agent/src/types
 */

import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/** The composition one Space session runs under. */
export interface SessionComposition {
  /** The agent's base instruction, shadowing the deployment persona for this session. */
  readonly persona: string
  /** The tool mask for the sources the agent may not use, or `undefined` when nothing is masked. */
  readonly toolFilter: ToolRestriction | undefined
  /** Skill names the agent declares. */
  readonly skills: readonly string[]
}
