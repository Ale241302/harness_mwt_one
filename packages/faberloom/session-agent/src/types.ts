/**
 * Public type vocabulary of the Space session composition: the persona, tool
 * mask, skills, and model route one session runs under. Types only — the
 * service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-session-agent/src/types
 */

import type { AgentPlane } from '@deepseek-ai/dsh-faberloom-agent-plane'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/**
 * The model route a Space session runs on: its responsible agent's provider,
 * model, and the reference naming that agent's API key. A complete route
 * requires all three, so an unkeyed or unrouted agent contributes no route and
 * the session keeps the deployment default.
 */
export interface SessionAgentRoute {
  /** Registered provider route the agent declares. */
  readonly provider: string
  /** Provider-owned model id the agent declares. */
  readonly model: string
  /** Reference naming the agent's own API key in the credential seam; a name, never the key. */
  readonly credentialRef: NonNullable<AgentPlane['credentialRef']>
}

/** The composition one Space session runs under. */
export interface SessionComposition {
  /** The agent's base instruction, shadowing the deployment persona for this session. */
  readonly persona: string
  /** The tool mask for the sources the agent may not use, or `undefined` when nothing is masked. */
  readonly toolFilter: ToolRestriction | undefined
  /** Skill names the agent declares. */
  readonly skills: readonly string[]
  /** The Space owner's directive for this session's agent; empty when unset. */
  readonly prompt: string
  /** The agent's model route, or `undefined` when it declares no complete routed and keyed route. */
  readonly route: SessionAgentRoute | undefined
}
