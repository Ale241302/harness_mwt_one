# Agent Note: a daily execution ceiling the dispatcher enforces itself

Status: implemented

English | [中文](2026-11-23-daily-execution-limit.zh.md)

## Problem

The dispatcher starts work with no ceiling of its own. A routine misconfigured to run every minute, or a mailbox that keeps producing trigger events, spends provider budget and queue capacity without a person noticing, and the only signal was a review row per failure after the fact. The E1 package also owed durable denominators: what the system did by itself, what it left to a person, and what failed, published where the panel and the gateway already read.

## Decision

### The ceiling is a configuration field, not a constant

`maxRunsPerDay` joins `ownerId`, `enabled`, `intervalMs` and `alertWindowMs`. Zero or absent means no ceiling, because a deployment that has not chosen a number has not chosen one, and a hidden default would either stop real work or promise a bound it does not hold.

### The counter belongs to the day, not to the process

`<DSH_HOME>/faberloom-usage.json` stores `{ day, runs }` keyed by the UTC day. A restart, a second process, or a redeploy must not hand the owner a second budget, and the reset needs no scheduler: a ledger from another day reads as zero. Only started runs count, so a pass that deduplicated onto an existing execution spends nothing.

### Reaching the ceiling is a notice, never an email

The pass returns `skipped = "daily execution limit reached (n/max)"`, starts nothing, and publishes one `usage-limit` notice deduped per day. The notice says what stopped, that in-flight work continues, and how to change the limit. A ceiling that announces itself by mail would break the rule that no automatic message is sent.

### Denominators are published with their owner

`faberloom-metrics.json` carries `totals`, `denominators` and `usage`. `denominators` names autonomy counters — `autonomyRuns`, `awaitingPerson`, `failed`, `unknownResult` — and deliberately does not mix in the owner's own actions. `unknownResult` is zero here because uncertain send results belong to the mail attempt ledger, not to the dispatcher; the field is present so the panel reads one shape.

### No parallel event bus

Proposals, approvals, corrections and discards are already durable board rows with an audit event per state change. A second ledger of the same facts would own the same data twice and double-count in the month report. What was missing was the ceiling and the published denominators, not another record.

## Alternatives considered

**A token or currency budget instead of a run count.** Rejected for this slice: per-agent `BudgetPolicy` already bounds an execution's spend, and an aggregate currency ceiling needs a price per run that the dispatcher does not own.

**Stop by pausing the routines.** Rejected: pausing rewrites the owner's configuration, and the owner would have to reactivate each routine by hand. A ceiling must be reversible tomorrow without touching their routines.

**Publish the ceiling only in logs.** Rejected: the panel and the gateway already read one metrics file, and a limit nobody can see is a limit nobody trusts.

## Consequences

A routine that would storm stops by itself and says so once per day. A deployment that wants a different cadence changes one field. The counter is a file, so a home without write access degrades to a process-local count rather than failing the pass.

## Testing

`vitest run packages/faberloom/execution/tests` passes 40 tests. New coverage: two passes start one execution each and the third returns the skip reason with one notice and `atLimit: true` in the metrics; the day's counter is durable in `faberloom-usage.json` and a later day resets it; an unconfigured ceiling never blocks and never publishes.
