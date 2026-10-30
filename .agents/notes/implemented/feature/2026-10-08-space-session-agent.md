# Agent Note: Space session composition

Status: implemented

English | [中文](2026-10-08-space-session-agent.zh.md)

## Problem

A Space carried a responsible agent with a persona, a capability plane, and skills, but only a delegated consultation (`faberloom_spaces_ask`) ran as that agent. A session opened in the Space ran the deployment composition, so it behaved like a generalist: the agent's instructions, its MCP masks, and its skills never reached the conversation the user was actually having.

## Decision

Add the package `@deepseek-ai/dsh-faberloom-session-agent` with the host service `ctx.faberloomSessionAgent`. In the awaited `agent/created` window it resolves the session's Space agent from the working-directory chain — `cwd` to a registered workspace, the workspace to the Space that mirrors it, the Space to its `agentId` — the same chain the `faberloom_spaces_ask` caller check uses. When an agent resolves, it installs on that agent's scope: the agent's persona as the `deployment:persona-prefix` section (shadowing the deployment persona, the child-composition precedent), the `faberloomAgentPlane.resolve` tool mask for the sources the agent may not use, and a short directive naming the agent's skills. The composition installs once before the first turn and disposes with its agent; a session outside a Space, a Space without an agent, or a missing service leaves the session unchanged. `toolSourcesOf` moved into `agent-plane` so the delegated child and the session build one sources set from the live registry. The gateway injects the acting identity per user, and the faberloom bundle mounts the row.

## Alternatives considered

**Mutate the agent's `options` to set the model route.** Rejected: `options` is read-only and there is no per-agent creation seam; a session resolves its route from its logged header or the deployment default, and the agent's model policy already applies when it delegates.

**Register a new prompt slot for the agent persona.** Rejected: shadowing `deployment:persona-prefix` in the agent scope is the established way a child composition and a preset change an agent's identity, so a Space session needs no new slot.

**Resolve the Space through the client.** Rejected: the browser never carries identity; the host resolves the actor from config, matching the view and tools.

## Consequences

A Space session now reads as its responsible agent and executes under its plane: the model sees the agent's persona and skills directive, and the disabled sources' tools are absent from the request. The model route is not composed here; it stays with the session's header or the deployment default. The resolution is by working directory, so an adopted workspace or a Space's deterministic area both work, and a Space session started before its workspace is registered is not composed. The service is optional at the composition level (`ctx.get`), so a deployment without the product plane keeps its plain sessions, and the space snapshot fixtures are unchanged because their composition mounts neither the service nor MCP tools.

Tests cover the composition matrix: persona plus mask plus skills, the persona-only case, and every early return (no identity, no working directory, each missing service, a session outside a Space, a Space without an agent).
