# Agent Note: a stale-run timeout the dispatcher resolves itself

Status: implemented

English | [中文](2026-11-23-stale-run-timeout.zh.md)

## Problem

The real deployment showed eleven executions stuck in `running`, the oldest from 2026-10-22, across three routines. A pass expires waits (`expireWaits`) and reconciles pending effects, but nothing ever looks at a run that started and never finished. A process that dies mid-step leaves the record `running` forever: it keeps holding its routine's concurrency slot, the panel shows work that will never move, and the case never counts as a failure.

## Decision

### The threshold is a configuration field with an explicit default

`staleRunTimeoutMs` joins `ownerId`, `enabled`, `intervalMs`, `alertWindowMs` and `maxRunsPerDay`. It defaults to six hours and zero disables the check. Six hours is long enough for the slowest legitimate step this dispatcher runs and short enough that a dead run is resolved the same working day; a deployment whose steps take longer raises the number instead of the code knowing it.

### The engine owns one new method, because nothing existing fits

`reconcile(id)` only moves an execution to review when an effect is still pending, and `expireWaits(now)` only touches `waiting` records with a deadline. Neither can resolve a `running` execution with no pending effect, and the dispatcher has no generic write into the executions table. The minimum change is `FaberLoomRoutines.expireRuns(timeoutMs, now)`, placed beside `expireWaits`: it selects `running` records whose `createdAt` is older than `now - timeoutMs`, marks each still-running step failed with `RUN_TIMEOUT`, and sets the execution to `needs_review` with the same reason.

`Execution` carries no `startedAt`; `createdAt` is the instant `startExecution` created the record in `running`, so it is the start instant the type actually has. A run that resumes from a wait keeps it, and that is intended: the timeout measures the case's wall clock, not the last step's.

### Only state changes, so no effect repeats

The method calls no step handler and no effect adapter, and leaves the effect ledger untouched. An effectful step may already have applied its effect before the process died, so re-running it would duplicate a mail or an MWT write; the person who opens the reviewed case decides what to do with the evidence. For the same reason the engine method does not notify review listeners: the dispatcher's dead-letter and alert path would add a second notice for one event.

### The pass reports and notifies once per routine and day

`DispatchReport` gains `expiredRuns` (the ids), additive to the existing fields. Each affected routine gets one `stale-run` notice per UTC day with `dedupeKey = stale-run:<routineId>:<day>`, through `ctx.get('faberloomNotices')`, in the same form as `stopAtDailyLimit`. The notice names the routine, how many runs, the oldest start instant, and states that nothing was mailed and no effect was repeated. The check runs first in the pass, before the daily-limit check and therefore before `startDue` and `tick`, whose relative order is unchanged: a stuck run is not work the ceiling governs, so it is resolved even on a pass the ceiling stops.

### A second pass is a no-op

The engine only selects `running` records. Once a run is `needs_review` the next pass skips it, so neither the state change nor the notice repeats.

## Alternatives considered

**Reuse `reconcile` and report `RECONCILE_REQUIRED`.** Rejected: reconcile checks the effect ledger and does nothing when no effect is pending, which is the common case for a hung or dead step. Reporting a pending effect that does not exist would send the operator to the wrong place.

**Mark the execution `failed` instead of `needs_review`.** Rejected: the failure count would claim the step failed when the truth is that no one knows whether it finished, and a failed execution leaves the panel with nothing to inspect.

**Pause or edit the routine.** Rejected: the owner's configuration is not the cause, and reactivating routines by hand is not a repair.

**Mail the owner.** Rejected: E1 retired automatic mail; a durable notice is the product surface.

**Use `updatedAt` instead of `createdAt`.** Rejected: `updatedAt` moves with every step write, so a long multi-step run would look fresh while the case is old; `createdAt` is the only field that means "when this execution started".

## Consequences

A run whose step is legitimately slow but still alive is resolved to review when it crosses the threshold; the person sees the step and can restart the routine deliberately. The threshold is a deployment choice, so a different workload changes one field. The dispatcher performs one extra table scan per pass, over the executions it already lists elsewhere in the pass.

## Testing

`vitest run packages/faberloom/execution/tests` passes 44 tests. New coverage in `tests/stale-runs.spec.ts`, over the same Context + Storage + DomainFacility + access + routines harness: an old `running` execution is moved to `needs_review` with `RUN_TIMEOUT`, its running step is marked failed, `expiredRuns` names it, and the handler ran only once; a run younger than the timeout stays `running` and publishes nothing; `staleRunTimeoutMs: 0` disables the check even a day later; two consecutive passes expire once and publish one `stale-run` notice.
