# Agent Note: FaberLoom's routines advance without a person or an open session

Status: implemented

English | [中文](2026-09-18-faberloom-persistent-dispatcher.zh.md)

## Problem

The plan promises that closing the browser or the conversation does not stop the work: a routine with a `date`, `recurrence`, `email`, or `event` trigger must start on its own, and a run that is waiting must be advanced and reconciled without someone opening a panel. Everything the engine needed existed — durable executions, idempotency keys, waits, the effect ledger, a dispatcher lock, and an ingest path — but nothing called them. `tick` and `reconcile` were reachable only from a panel button or a model tool, so a routine no person touched never ran, and `faberloom-execution` was still a skeleton.

## Decision

`packages/faberloom/execution` becomes the dispatcher that the plan maps to it. `ctx.faberloomExecutions` takes the deployment identity (`ownerId`) and a cadence (`enabled`, `intervalMs`, defaulting to off and one minute), starts one pass immediately, repeats it on a timer, and stops with its own fiber. `runOnce(now)` is public so a deployment can drive passes itself.

One pass, under the routines engine's own dispatcher lock:

1. starts every active routine whose `date` trigger instant has passed, and every active routine whose `recurrence` trigger reached a new slot;
2. advances the executions that have runnable steps through `tick`;
3. moves the executions in review whose effect is still pending to `RECONCILE_REQUIRED` through `reconcile`.

The work of being idempotent is left where it belongs — in the engine's dedupe, not in the timer. A `date` start is keyed by the instant the trigger named and a `recurrence` start by the interval slot it falls in (`floor(now / interval)`), so a repeated pass, a pass after a restart, and two processes serving the same owner each produce one run. That is also why no cursor is stored: the key is derivable from the routine and the clock.

A `recurrence` match accepts `every:<minutes>`, `<n>m`, `<n>h`, or `<n>d`; anything else is reported once per process, naming the routine, and skipped. A failed pass logs a warning and leaves the timer alive.

## Alternatives considered

- **A stored cursor per routine.** Rejected: a derived key needs no migration, cannot drift from the executions it describes, and already dedupes across processes.
- **Reuse `ctx.schedule` or `ctx.jobs`.** Rejected: both are local to a live session or process, which is exactly the condition the plan says must not hold.
- **Tick inside the routines engine itself.** Rejected: the engine is a library over storage; a timer in it would fire in every composition that mounts it for tests, and would hide who is allowed to start work.
- **Call `startExecution` at load and trust an in-memory marker.** Rejected: a process that restarts, or a second process for the same owner, would start the run again.
- **Fail the plugin on an unparseable interval.** Rejected: one bad routine would take the whole dispatcher down and silently stop every other routine; naming it in the log is loud enough.

## Consequences

- A routine with a `date` or `recurrence` trigger now runs with the browser closed, and its steps execute in the hidden per-execution session the handlers package already owns.
- An `email` or `event` trigger still waits for someone to call the engine's ingest: a pass cannot invent an event. The inbound receiver (webhook or mailbox poller) remains a separate slice, as does a deadline policy for a step that waits forever.
- The row carries one owner, matching one process per user; a single dispatcher serving several owners would need a different identity binding.
- Reconciliation now happens without a person watching. A run whose effect stayed pending reaches `needs_review` on its own and appears in the executions the panels read.
