/**
 * The agent capability plane (`ctx.faberloomAgentPlane`): turns one catalog
 * agent's declared capabilities into the tool mask a delegated child (or a
 * Space session) executes under. A disabled MCP source or open-web access
 * becomes a `deny` entry over the registered tool names, so the plan is
 * enforced in the operation that delegates rather than left declarative. The
 * delegation allowlist (`agent.subagents`) is exposed for the caller-side
 * check. The service reads no storage and registers no tools.
 * @module @deepseek-ai/dsh-faberloom-agent-plane
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FaberLoomAgent } from '@deepseek-ai/dsh-faberloom-agents'
import type { AgentPlane, AgentToolSources } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomAgentPlane: FaberLoomAgentPlane
  }
}

/** Deployment configuration for the agent plane. */
export interface Config {
  /**
   * Whether a source the agent is not allowed to use is masked from its tool
   * plane. Defaults to `true`; a deployment may turn it off to keep every flag
   * declarative, in which case the plane still reports the persona and model.
   */
  enforceSources?: boolean
}

/** Schemastery configuration for the agent plane. */
export const Config: z<Config> = z.object({
  enforceSources: z.boolean().default(true),
})

/** Registered open-web tool names the plane masks when `webAccess` is off. */
const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(['web_search', 'web_fetch'])

/**
 * Group registered tool names into MCP servers and the open-web tools.
 * @param schemas - the registered tool schemas, as `ctx.tools.schemas()` returns them.
 * @returns the sources the agent plane masks.
 */
export function toolSourcesOf(schemas: readonly { readonly name: string }[]): AgentToolSources {
  const mcp: Record<string, string[]> = {}
  const web: string[] = []
  for (const schema of schemas) {
    const match = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(schema.name)
    if (match !== null && match[1] !== undefined) {
      const names = mcp[match[1]] ?? []
      names.push(schema.name)
      mcp[match[1]] = names
      continue
    }
    if (WEB_TOOL_NAMES.has(schema.name)) web.push(schema.name)
  }
  return { mcp, web }
}

/**
 * The agent capability plane service: resolves one agent's enforced tool mask
 * and its delegation allowlist.
 */
export class FaberLoomAgentPlane extends Service {
  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - enforcement configuration.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'faberloomAgentPlane')
  }

  /**
   * Resolve one catalog agent's enforced plane. A source the agent may not use
   * denies exactly the registered tool names that source publishes; a source
   * the agent may use, or a source with no registered names, contributes no
   * mask. The mask is omitted entirely when nothing is denied, so a caller
   * never passes an empty-restriction no-op.
   * @param agent - the catalog agent whose capabilities are enforced.
   * @param sources - the registered tool names grouped by source.
   * @returns the agent's persona, tool mask, model route, and skills.
   */
  resolve(agent: FaberLoomAgent, sources: AgentToolSources): AgentPlane {
    const deny: string[] = []
    if (this.config.enforceSources !== false) {
      if (!agent.mwtMcp) deny.push(...(sources.mcp['mwt'] ?? []))
      if (!agent.sicopMcp) deny.push(...(sources.mcp['sicop'] ?? []))
      if (!agent.webAccess) deny.push(...sources.web)
    }
    const unique = [...new Set(deny)].sort()
    return {
      persona: agent.responsibility,
      toolFilter: unique.length > 0 ? { deny: unique } : undefined,
      provider: agent.provider,
      model: agent.model,
      skills: [...agent.skills],
    }
  }

  /**
   * Whether one agent may consult another. An empty allowlist means the agent
   * is unrestricted; a non-empty allowlist authorizes only its listed agent
   * ids.
   * @param agent - the consulting agent.
   * @param targetAgentId - the catalog agent id the agent wants to consult.
   * @returns `true` when the consultation is authorized.
   */
  allowsSubagent(agent: FaberLoomAgent, targetAgentId: string): boolean {
    return agent.subagents.length === 0 || agent.subagents.some(entry => entry.agentId === targetAgentId)
  }
}

export default FaberLoomAgentPlane
