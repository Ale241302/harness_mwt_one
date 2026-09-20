# Agent Note: FaberLoom routine steps run in one hidden Session per execution

Status: implemented

English | [中文](2026-09-18-faberloom-routine-step-handlers.zh.md)

## Problem

The routines engine refused to activate any routine: `activateRoutine` reports `MISSING_HANDLER:<step>:<handler>` when a step names a handler that no plugin registered, and nothing in the product layer registered one. Every routine the panels showed was therefore inert — the executions panel could read, start, and advance, but nothing could run. The engine executes tools inside the agent loop, so an `agent` or `mcp` step needs a live Agent and Session; a step handler runs from the routines engine with no ambient agent, no session, and no owner.

## Decision

`packages/faberloom/handlers` owns the step handlers. It registers three names through `ctx.faberloomRoutines` and removes each with its own fiber: `wait`, `agent`, and `mcp`.

`agent` and `mcp` run their turn in **one hidden durable Session per execution**, created on the first such step and reused by the later steps of the same execution, so a multi-step routine accumulates one conversation. The Session resolves the deployment working directory through the `fs` service — the assembled system prompt reads `{{cwd}}`, so a Session without one fails its first turn — and is marked `origin: "subagent"`, the classification the workspace tree filters out of the owner's session list. The step turn uses the deployment's default model selection and the profile's global tool plane.

The handler selects the final non-empty `assistant/message` text, the `turn/end` kind, and the `tool/call` names with their call ids from the Session's durable log, and stores them as the step result next to the Session id. That id is the audit link: the execution record identifies the Session, and the Session log holds the turn.

Only a turn that ends `completed` settles its step. Any other end — `error`, `aborted`, `blocked`, `max-tokens`, or no `turn/end` — throws with the Session id and the failure in the message, so the routine's `failurePolicy` decides what happens next and the executions panel shows why.

## Alternatives considered

- **Run the step in the owner's own conversation Session.** Rejected: a routine triggered by mail or a schedule has no user present, and mixing routine turns into a person's conversation hides the run's own record.
- **One reused Session per owner.** Rejected: concurrent executions would interleave in one history, and a later execution would inherit an unrelated conversation.
- **A model completion with no Agent.** Rejected: routine steps exist to call the product's MCP tools and skills, which only exist inside the agent loop.
- **Hide the Session by omitting `cwd`.** Rejected after it failed in production: the deployment's system prompt requires `{{cwd}}`, so the turn died before reaching the model. Hiding moved to `origin: "subagent"`, which the workspace tree already filters.
- **Treat any settled turn as success.** Rejected: it marked a failed turn as a completed step, which is what hid the missing-`cwd` defect until the step result started recording the failure.

## Consequences

- A routine whose steps name an unregistered handler still fails activation; the shipped profile mounts the handlers row, so `agent`, `mcp`, and `wait` are the names available out of the box.
- Hidden Sessions are ordinary durable Sessions: they appear in the session store and stay live until the handlers service is disposed, not until their execution completes.
- Recorded text is bounded by what the model produced; the panel shows the selected step's text with the full value in its title, and the record keeps it verbatim.
- Per-step model and permission selection is deferred; every step turn uses the deployment default.
