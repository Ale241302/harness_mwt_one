---
description: "Native product agent runtime (ctx.faberloomAgentRuntime): the durable consultations between a caller session and a Space agent, keyed per owner, Space, and caller session."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-agent-runtime

English | [中文](README.zh.md)

## Summary

The agent runtime service (`ctx.faberloomAgentRuntime`) records the durable consultations a caller session holds with a Space agent. `faberloom_spaces_ask` records one row when it starts a continuable child, and `faberloom_spaces_followup` reads it to continue the same child; the view reads the rows to report a Space's live agents. One row per owner, Space, and caller session, so a follow-up finds its child and a second continuable ask replaces the caller's earlier one. Records are durable through `ctx.storageDomain`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.storageDomain`. The service opens the `faberloom_agent_runtime` domain, registers `ctx.faberloomAgentRuntime`, and exposes `record`, `consultation`, `listForSpace`, and `remove`. `record(ownerId, { spaceId, callerSessionId, childSessionId, label })` upserts the caller's consultation for the Space and preserves its creation instant.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAgentRuntime` is a host-side service: it registers no tools, injects no prompt text, and writes no session events. The tools that read it live in `dsh-tool-faberloom`.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One child per caller and Space.** A second continuable ask from the same caller session replaces the first child, so the caller holds one durable consultation per Space at a time.
- **Residency is process-local.** The recorded child is addressable while its process holds the parent; cross-process continuation waits for the durable-mailbox work the subagent seam defers.

No invariant companion is published because the service's unit specs already assert the upsert, read, list, and remove.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The key is `${ownerId}\u0000${spaceId}\u0000${callerSessionId}`, so two callers in one Space keep separate children. `listForSpace` filters and sorts newest first; the view maps the rows to its own client-safe shape.

</details>
