---
description: "Native product dispatcher (ctx.faberloomExecutions): the timer that starts due date and recurrence routines, advances runnable executions, and reconciles pending effects without a person or an open session; for users and maintainers of the FaberLoom Rutinas module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-execution

English | [中文](README.zh.md)

## Summary

This package owns the only component that starts and advances work on its own. A timer runs one pass at a time over the routines engine: it starts every active routine whose `date` or `recurrence` trigger came due, advances runnable executions, and moves executions with a pending effect to review. A start is keyed by the trigger's instant or recurrence slot, so repeated passes, restarts, and two processes still produce one run. Closing the browser or restarting never leaves work waiting for someone to press a button.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.faberloomRoutines` is present, with the deployment identity and cadence:

```yaml
- id: faberloom-executions
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    intervalMs: 60000
```

`enabled` defaults to off and `intervalMs` to one minute; an interval below one second is refused at load. The timer starts one pass immediately and then every interval, and it stops with the plugin's fiber. `runOnce(now)` is public so a deployment can drive passes itself, with its own clock.

### What a pass does

1. For every active routine, each `date` trigger whose instant has passed and each `recurrence` trigger that reached a new slot starts one execution.
2. Runnable steps of existing executions advance through the engine's tick.
3. Executions in review whose effect stayed pending are reconciled.
4. Waits whose deadline passed are expired, and their executions move to review.

The `recurrence` match accepts `every:<minutes>`, `<n>m`, `<n>h`, or `<n>d`. Any other text is a misconfiguration the pass reports once per process, naming the routine, and then skips: the dispatcher never invents a cadence.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing directly. `ctx.faberloomExecutions` writes no prompt text and registers no tools; what reaches a model is the step turn of each execution it starts, described by the handlers package. A started run is visible in the executions the panels and the routines tools read.

#### Token effect

Zero direct tokens on every request. Each started execution costs what its steps cost.

#### KV Cache effect

Independent of live requests: the dispatcher never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No event receiver yet.** A pass can advance and reconcile, but an `email` or `event` trigger still waits for someone to call the routines engine's ingest; the inbound webhook or mailbox poller is a separate slice.
- **A wait expires, it does not retry.** A parked step whose deadline passed moves its execution to review with `WAIT_TIMEOUT`; nothing re-attempts the wait or re-notifies the person.
- **One owner per row.** The row is configured with a single owner, which matches one process per user; serving several owners from one dispatcher would need a different identity binding.
- **Cadence, not calendars.** Business-day and timezone-aware schedules are not expressed by `every:`/`m`/`h`/`d`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The pass takes the routines engine's own dispatcher lock, so an overlapping timer tick or a manual pass reports `another pass is running` instead of working twice. A failed pass logs a warning and leaves the timer alive: a dispatcher that dies on one bad routine would silently stop every routine. The recurring key is the interval slot, `floor(now / interval)`, which gives exactly one run per interval with no stored cursor.

</details>

**Runtime invariant:** No companion is published. The service derives every scheduling decision from the routines and executions the engine already persists; its only state is the process-local lock and the set of misconfigurations already reported.
