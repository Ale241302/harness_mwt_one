---
description: "Native product routine step handlers (ctx.faberloomHandlers): the implementation behind each handler name a routine step declares — wait, agent, and mcp — with one hidden durable Session per execution; for users and maintainers of the FaberLoom Rutinas module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-handlers

English | [中文](README.zh.md)

## Summary

The handlers service owns the implementation behind every `handler` name a routine step declares. The routines engine refuses to activate a routine whose steps name an unregistered handler, so this package is what turns a declared routine into a runnable one. It registers the agent turns (`agent`, `mcp`), the Work Flow step handlers (`condition`, `transform`, `delay`, `imap`, `smtp`, `memory.remember`, `memory.teach`, `board.create`, `reference`, `subroutine`, `notify`, `deadletter`), and `wait`, through `ctx.faberloomRoutines`, and removes each one with the fiber that contributed it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomRoutines` is present.

- **`wait`** parks the run until the event its step declares arrives: the engine holds a step whose `waitFor` is set, and the handler settles it when that event does, recording which event resumed the run. A step whose `waitFor` is empty is a manual barrier the handler settles when a person advances the run.
- **`agent`** runs one turn in the execution's hidden Session with the step's recorded `instruction` as the prompt.
- **`mcp`** runs the same turn, framed to use the MCP tools the profile exposes, and records the calls the turn made.
- **Work Flow handlers** read their node configuration from `StepContext.config` and resolve their optional services through `ctx.get`, so a deployment may mount a subset. `condition` evaluates `<path> <op> [value]` (`==`, `!=`, `contains`, `exists`, `>`, `<`) over `event`, `input`, and prior step `result`s; `transform` renders a `{{path}}` template; `delay` waits for the step's `waitFor` event or sleeps inline up to 300 seconds; `imap` marks, moves, reads, or searches the owner's mailbox through `ctx.faberloomInbound`; `smtp` sends through `ctx.faberloomConnections`; `memory.remember` and `memory.teach` write to `ctx.faberloomSpaces` and `ctx.faberloomMemory`; `board.create`, `notify`, and `deadletter` open `ctx.faberloomBoard` items; `reference` resolves another Space's effective context; `subroutine` starts another active routine idempotently; `mcp.call` calls one MCP tool through `ctx.tools` as `mcp__<server>__<tool>`, after an allowlist check for `mcp:<server>:<tool>` when `ctx.faberloomAccess` is mounted.
- **`agent` runtime** — an agent step resolves the Space's effective context and memory, the responsible agent (`ctx.faberloomAgents.getAgent`) with its skills, and an invoked skill's body (`ctx.skills.get`); it adds the delegation directive (`faberloom_spaces_reference` / `faberloom_spaces_ask`) and runs the hidden Session in the Space's mirrored workspace path (`space.workspaceId` → `ctx.workspaceRegistry`). Without those services the prompt falls back to the step instruction alone.
- **`agent` Space context** — when the node sets `config.useSpaceContext`, the step prompt adds the effective context of `config.spaceId` under a `Contexto del Space` heading; without it the prompt is unchanged.

The execution's Session is created on the first `agent` or `mcp` step and reused by every later step of the same execution, so a multi-step routine accumulates one conversation. The step result carries the Session id, the final assistant text, the turn's end kind, and the calls the turn made, which is the link a reader follows into the durable log.

Only a turn that ends `completed` settles its step. Any other end — `error`, `aborted`, `blocked`, `max-tokens`, or no `turn/end` at all — fails the step with the Session id and the failure in the message, so the routine's `failurePolicy` decides what happens next and the executions panel shows why.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

The prompt of each `agent` and `mcp` step: a stable template carrying the step id, the instruction the running version recorded, and the case context (`input` and the event that resumed the run, as JSON, up to 4000 characters). An `mcp` step adds one line instructing the turn to use the available MCP tools. The hidden Session holds the whole conversation, so a later step of the same execution sees the earlier steps' turns.

#### Token effect

One ordinary agent turn per `agent` and `mcp` step: the step prompt plus the hidden Session's derived history, with the profile's normal tools. `wait` costs no tokens.

#### KV Cache effect

Each hidden Session keeps its own request prefix; steps of one execution share it, different executions do not.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No conditional edges yet.** `condition` computes a boolean and `transform` a value, but the routines engine executes a dependency graph: both branches' steps run, and true branching and loops wait for the v2 graph executor. Effects a graph should skip are gated by the step results the handlers read.
- **`delay` waits on the engine clock.** A Work Flow `wait` node with `seconds` compiles to the reserved `@delay:<seconds>` wait: the engine parks the step until its deadline and resumes it, so a pass never sleeps in place. The handler's own bounded inline sleep remains only for a step authored directly with `seconds` and no `waitFor`.
- **Effect steps need a grant.** `imap`, `smtp`, `board.create`, and `mcp.call` run only under an active grant for the routine's declared action (and `mcp.call` additionally for `mcp:<server>:<tool>`), and the engine ledgers them.
- **Per-step agent model selection is deferred.** The agent step uses the deployment default model; the catalog agent's identity, skills, and Space context shape the prompt, but its provider/model does not yet override the step.
- **Hidden Sessions are ordinary Sessions.** They record the deployment working directory — the assembled system prompt reads it — and are marked `origin: "subagent"`, which is the classification the workspace tree filters out of the owner's session list. Reading one means reading the session store by the id the step result carries.
- **A step names no model, agent, or permissions of its own.** Every step turn uses the deployment's default model selection and the profile's global tool plane. Per-step model and permission selection is deferred.
- **Sessions live until the handlers service is disposed.** They are not disposed when an execution completes, so their log stays readable for as long as the process runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The registry is the routines engine's own `registerHandler`; this package contributes rows to it instead of owning a second registry, so `listHandlers()` reports one authoritative set and disposal is the engine's own disposer. A failed Session creation is dropped from the per-execution cache so the next step retries instead of inheriting a rejected promise.

</details>

**Runtime invariant:** No companion is published. The service holds no derived state: the registered handlers are closures over the engine's registry, and the only state it owns is the per-execution Session cache it disposes itself.
