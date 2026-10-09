---
description: "Native product Space session composition (ctx.faberloomSessionAgent): a Space session runs as its responsible agent's persona, tool plane, and skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

English | [中文](README.zh.md)

## Summary

The session composition service (`ctx.faberloomSessionAgent`) makes a Space session run as the Space's responsible agent. When a session's working directory is a registered workspace mirrored by a Space, the service installs, for that session alone, the agent's persona (shadowing the deployment persona), the agent's tool mask for the sources it may not use, and a directive naming its skills. A session outside a Space, or a Space without a responsible agent, is left on the deployment composition. The composition happens in the awaited `agent/created` window, before the first turn.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.agents`, `ctx.faberloomSpaces`, `ctx.faberloomAgents`, `ctx.faberloomAgentPlane`, and the workspace registry are present, and set `ownerId`, `role`, `companyId`, and `readOnly` to the acting identity. The service registers `ctx.faberloomSessionAgent`, resolves each session's Space agent from its working directory, and installs the composition on that agent's scope through `agent.ctx.inject`. It applies to agents listed at mount and to every `agent/created`; a composition is disposed with its agent. The model route is not set here: a session resolves its route from its logged header or the deployment default, and the agent's model policy applies when it delegates.

-----

<a id="model-experience"></a>
## Model Experience

### Session composition

#### What the model sees

A Space session's request carries the responsible agent's persona as the `deployment:persona-prefix` section, a short `faberloom:session-agent` directive listing the agent's skills, and a tool set with the disabled sources' tools removed. A session outside a Space sees the deployment composition unchanged.

#### Token effect

One persona section and, when the agent declares skills, one short directive per request of that session; the removed tools also drop their schemas from the request.

#### KV Cache effect

Prefix-stable for the life of the session: the composition installs once before the first turn and never re-reads.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The model route is not composed here.** A session's route comes from its logged header or the deployment default, and there is no per-agent creation seam to override it; the agent's model policy is applied when it delegates.
- **Resolution needs the workspace mirror.** A session whose working directory is not a registered workspace mirrored by a Space carries no composition, which is the correct default for a plain session.
- **A Space session started before its workspace is registered is not composed.** The workspace must exist when the session is created; the Spaces panel registers it when the Space is opened.

No invariant companion is published because the service's unit specs already assert the composition matrix and the disposal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The persona shadows `deployment:persona-prefix` the same way a child composition does, so a Space session reads as its agent without a new prompt slot. The tool mask reuses `ctx.faberloomAgentPlane`, so the workspace session and a delegated child enforce one plane. The resolution chain (working directory → workspace → Space → agent) is the same the `spaces_ask` caller check uses.

</details>
