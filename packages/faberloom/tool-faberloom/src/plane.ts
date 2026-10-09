/**
 * Bridge between the live tool registry and the agent capability plane: group
 * the registered tool names the plane masks — the `mcp__<server>__<tool>`
 * registrations and the open-web tools — into the sources the plane service
 * reads. The names are the exact registered ones, so a `deny` mask never trips
 * `tools.restrict()`'s unknown-name check.
 * @module @deepseek-ai/dsh-tool-faberloom/src/plane
 */

import type { AgentPlane } from '@deepseek-ai/dsh-faberloom-agent-plane'
import type { SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

/** The mutable plane fields before they are spread into a start request. */
interface PlaneStartFields {
  toolFilter?: ToolRestriction
  persona?: string
  agentOptions?: { provider: string; model: string }
}

/** One Space as the caller-identity chain reads it. */
interface CallerSpace {
  /** Mirrored workspace id, or `undefined`. */
  readonly workspaceId: string | undefined
  /** Responsible agent id, or `undefined`. */
  readonly agentId: string | undefined
}

/** One registered workspace as the caller-identity chain reads it. */
interface CallerWorkspace {
  /** Workspace id. */
  readonly id: string
  /** Filesystem path the session runs in. */
  readonly path: string
}

/**
 * Resolve the catalog agent responsible for the Space a caller session runs in.
 * The session's working directory is matched to a registered workspace, and the
 * workspace to the Space that mirrors it; the Space's responsible agent is the
 * caller. Returns `undefined` when any link is missing, so a caller outside a
 * Space carries no identity to enforce.
 * @param spaces - the caller's readable spaces.
 * @param workspaces - the registered workspaces.
 * @param cwd - the caller session's working directory, when known.
 * @returns the caller's catalog agent id, or `undefined`.
 */
export function resolveCallerAgentId(
  spaces: readonly CallerSpace[],
  workspaces: readonly CallerWorkspace[],
  cwd: string | undefined,
): string | undefined {
  if (cwd === undefined) return undefined
  const workspace = workspaces.find(entry => entry.path === cwd)
  if (workspace === undefined) return undefined
  return spaces.find(space => space.workspaceId === workspace.id)?.agentId
}

export { toolSourcesOf } from '@deepseek-ai/dsh-faberloom-agent-plane'

/**
 * Build the start-request fields the agent capability plane contributes to a
 * delegated child: the tool mask for the sources the agent may not use, its
 * persona, and its model route. The persona and model route are applied only
 * when the chosen provider advertises the matching capability; the tool mask
 * is mandatory, so a provider that cannot enforce it fails loud instead of
 * silently widening the child's plane.
 * @param plane - the agent's resolved plane.
 * @param capabilities - the chosen provider's advertised capabilities.
 * @returns the fields to spread into the subagent start request.
 * @throws when the plane masks tools and the provider cannot enforce the mask.
 */
export function planeStartFields(
  plane: AgentPlane,
  capabilities: SubagentProvider['capabilities'],
): Pick<SubagentStartRequest, 'toolFilter' | 'persona' | 'agentOptions'> {
  const fields: PlaneStartFields = {}
  if (plane.toolFilter !== undefined) {
    if (!capabilities.toolFilter) {
      throw new Error('faberloom: the subagent provider cannot enforce the agent capability plane (toolFilter)')
    }
    fields.toolFilter = plane.toolFilter
  }
  if (capabilities.persona && plane.persona.length > 0) fields.persona = plane.persona
  if (capabilities.agentOptions && plane.provider !== undefined && plane.model !== undefined) {
    fields.agentOptions = { provider: plane.provider, model: plane.model }
  }
  return fields
}
