# Agent Note: Agent capability plane

Status: implemented

English | [中文](2026-10-08-agent-capability-plane.zh.md)

## Problem

A catalog agent declared which sources it may use — `mwtMcp`, `sicopMcp`, `webAccess` — and which agents it may consult (`subagents`), but the flags were declarative. `faberloom_spaces_ask` started the child with the parent's merged tool plane, so an agent whose `sicopMcp` was off still received `mcp__sicop__*` through a delegated consultation; the same flags never touched a session. The declaration and the enforced plane disagreed.

## Decision

Add the package `@deepseek-ai/dsh-faberloom-agent-plane` with the host service `ctx.faberloomAgentPlane`. `resolve(agent, sources)` turns the flags into a `ToolRestriction`: a source the agent may not use denies exactly the registered tool names that source publishes, and an empty mask is omitted so a caller never passes a `restrict({})` no-op. The same call carries the agent's persona, model route, and skills. `allowsSubagent(agent, targetAgentId)` answers the caller-side allowlist, where an empty list means unrestricted. `enforceSources` (default `true`) turns the flags into enforcement; a deployment may turn it off to keep every flag declarative.

`tool-faberloom` groups the live registry — `ctx.tools.schemas()` split by the `mcp__<server>__` prefix and the open-web names `web_search`/`web_fetch` — into the sources the plane reads. `faberloom_spaces_ask` resolves the responsible agent's plane and passes `toolFilter` and `persona` to the subagent start, plus `agentOptions` with the agent's provider and model when the provider advertises it. The tool mask is mandatory: a provider that advertises no `toolFilter` capability while the plane needs a mask fails loud instead of widening the child's plane. The faberloom bundle mounts the service. `faberloom_spaces_ask` also enforces the caller side: a session whose working directory is a registered workspace mirrored by a Space carries that Space's responsible agent, and a consultation to a target that agent does not list is refused before the child starts.

## Alternatives considered

**Enforce by name prefix in the core tool runtime.** Rejected: `ToolRestriction` masks exact registered names, and the plane only names names the live registry publishes, so `restrict()` never fails on an unknown tool.

**Apply `agent.tools` as a global allow mask.** Rejected: `agent.tools` is the executable-tool allowlist that `faberloomAgents.executeTool` enforces; making it a global allow would strip skills and MCP tools the agent legitimately holds.

**Keep the flags declarative.** Rejected: the requirement is that an agent without a source cannot reach it, which a label does not satisfy.

## Consequences

A source an agent may not use never reaches its delegated child, and the mask is deterministic (`deny` is de-duplicated and sorted). The service is optional in `tool-faberloom` (`ctx.get`), so a composition that does not mount it keeps the previous behavior, and the space snapshot fixtures are unchanged because their composition mounts neither the plane nor MCP tools. Caller-side `subagents` enforcement reads the consulting agent's allowlist; the consulting agent is the Space agent that owns the caller session's working directory, resolved through the workspace registry. A session whose working directory is not a workspace mirrored by a Space carries no identity and is not restricted, and a caller resolving to the target itself is allowed.

Tests cover `resolve` (per-source masking, the empty mask, declarative mode, the union), `allowsSubagent`, the registry grouping (`toolSourcesOf`), and the start-field builder (`planeStartFields`), including the loud failure when the provider cannot enforce a needed mask. `faberloom_spaces_ask` carries the mask, persona, and route when the plane is mounted, and fails loud when it cannot be enforced.
