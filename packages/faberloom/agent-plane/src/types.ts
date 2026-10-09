/**
 * Public type vocabulary of the agent capability plane: the registered tool
 * names a deployment enumerates and the enforced plane one catalog agent
 * resolves to. Types only — the service lives in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-agent-plane/src/types
 */

import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/** The registered tool names a plane masks, grouped by the source they come from. */
export interface AgentToolSources {
  /** Full registered tool names per MCP server name (for example `mwt`, `sicop`). */
  readonly mcp: Readonly<Record<string, readonly string[]>>
  /** Registered open-web tool names. */
  readonly web: readonly string[]
}

/** One catalog agent's enforced capability plane. */
export interface AgentPlane {
  /** The agent's base instruction, delivered to a child as its persona. */
  readonly persona: string
  /** The tool mask for the sources the agent may not use, or `undefined` when nothing is masked. */
  readonly toolFilter: ToolRestriction | undefined
  /** Declared provider id, or `undefined` when unset. */
  readonly provider: string | undefined
  /** Declared model id, or `undefined` when unset. */
  readonly model: string | undefined
  /** Skill names the agent declares. */
  readonly skills: readonly string[]
}
