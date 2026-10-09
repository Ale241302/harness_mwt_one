---
description: "Native product agent capability plane (ctx.faberloomAgentPlane): resolves one catalog agent's enforced tool mask (MWT/SICOP MCP and open-web) and its delegation allowlist."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agent-plane

English | [中文](README.zh.md)

## Summary

The agent plane service (`ctx.faberloomAgentPlane`) turns one catalog agent's declared capabilities into the tool mask a delegated child or a Space session executes under. A source the agent may not use (`mwtMcp`, `sicopMcp`, `webAccess`) becomes a `deny` entry over the exact registered tool names that source publishes, so the mask is enforced where the delegation happens rather than left declarative. `resolve` also carries the agent's persona, model route, and skills, and `allowsSubagent` answers the caller-side delegation allowlist. The service reads no storage and registers no tools.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.tools` and `ctx.faberloomAgents` are present. The service registers `ctx.faberloomAgentPlane`. A consumer enumerates the registered tool names grouped by source — for example `ctx.tools.schemas()` split by the `mcp__<server>__` prefix and the open-web names — and calls `resolve(agent, sources)`. When the returned `toolFilter` is present it is passed to a subagent start (the `spawn` provider applies it as a scoped `tools.restrict()` in the child's creation window) or applied as a scoped restriction; `deny` lists only names that exist, so the restriction never fails on an unknown tool. `enforceSources` (default `true`) turns the flags into enforcement; turning it off keeps every flag declarative while `resolve` still reports the persona, model, and skills.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAgentPlane` is a host-side service: it registers no tools, injects no prompt text, and writes no session events. What the model sees is what a consumer does with the resolved plane — a child that lacks a disabled source's tools simply never receives them.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Caller-side `subagents` enforcement needs the caller's agent.** `allowsSubagent` answers whether a consulting agent may reach a target, but the consulting agent's catalog identity is only known once a session composes as its Space agent; until then a caller-side check has no agent to read.
- **The mask is limited to the sources this package knows.** `mwtMcp`, `sicopMcp`, and `webAccess` map to the `mwt`/`sicop` MCP servers and the open-web tool names; a new source needs a flag and an entry here.
- **An unknown-name restriction would fail loud.** The service only denies names a consumer enumerated from the live registry; a caller that passes fabricated names would trip `tools.restrict()`'s unknown-name check by design.

No invariant companion is published because the service's unit specs already assert the visibility matrix, the omission of an empty mask, and the allowlist.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`resolve` is pure with respect to the agent and the sources: the same inputs produce the same plane. `deny` is de-duplicated and sorted so the mask is deterministic. The open-web names (`web_search`, `web_fetch`) live in the consumer's grouping helper, not here, so a deployment that renames a web tool updates one place.

</details>
