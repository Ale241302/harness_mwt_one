# Agent Note: Autonomy levels per unit, and the suspension that keeps them honest

Status: implemented

English | [中文](2026-10-28-mesa-autonomy-levels-and-suspension.zh.md)

## Problem

§7.1–§7.3 define an autonomy level per unit `(tenant, space, agent, actionType)`, the promotion rule of §7.2, and the monitoring rule of §7.3; D-13 fixes the sample and suspension values, while the period and the statistical minimum stay unsigned.

Delegating a unit removes the human decisions that fed its evaluation, so a delegated unit loses its own safety signal exactly when it needs one.

Nothing durable held the level: the board owns items and approvals, and the learning package counts outcomes but grants nothing.

Two constraints shape the fix.

The board is being changed by another lane, so this package must not import it; and `ctx.storageDomain` offers one durable write per record with `update()` as the only read-modify-write.

W-53 forbids promoting a unit automatically while the period and the statistical minimum are unsigned.

## Decision

**One durable record per unit, one level, and two rules that move it — promotion by explicit command, suspension by the service.**

### The unit and its level

`autonomyUnitId(ref)` joins the four §7.2 fields with NUL separators, so two distinct units never share a key and a tenant cannot address another tenant's record.

`ensureUnit` registers at `SHADOW` and is idempotent; `promote` reaches `DELEGADO`; `supervise`, a delegation-rate breach, and a rejected sample item all return the unit to `SUPERVISADO`.

A read whose reference names another tenant is refused with `TENANT_MISMATCH` before the store is touched, and lists filter on the record's tenant.

### The outcome port

`AutonomyOutcomePort` is the only way this package learns what happened: one call per unit and optional period, answering `approved`, `approved-with-intervention`, `discarded`, `delegated-confirmed`, `delegated-reversed`, `delegated-failed`, or `technical-failure`.

The composition provides it as `faberloomAutonomyOutcomes`; the board adapter implements it. Without a mounted port, `report`, `promote`, `assess`, and `planSample` refuse with `OUTCOME_SOURCE_UNAVAILABLE`, because an empty history and an unreadable history are different facts.

A `technical-failure` without a `reason` is refused: §7.2 excludes those items only when the reason is recorded.

### Denominators

Real runs are the human decisions — approved, approved with intervention, discarded — because §7.2 counts items closed by human decision.

Delegations feed the monitoring window, never the promotion share; counting them in both would let a delegated unit promote itself on its own output.

Technical failures sit outside every denominator and are reported on their own.

### Promotion

`promote` re-reads the numbers, checks `minimumRealRuns` (10), `minimumApprovalShare` (0.70), and `statisticalMinimum` when one is configured, then requires `governanceRoles` (`owner`, `admin`) of the tenant.

It stores who promoted the unit, when, and the numbers, and appends a `promoted` audit entry.

No operation promotes without that command. `report` publishes `automaticPromotion: 'DISABLED'` and names `period` and `statistical-minimum` as unsigned when they are, so W-53 is visible in the data rather than implied by a missing button.

### Suspension and the sample

`assess` applies §7.3: while a unit is `DELEGADO`, a reversal-or-failure rate above `suspensionRate` (0.10) over the last `monitoringWindow` (20) delegations returns it to `SUPERVISADO` and audits the cause with the window, the counts, and the rate.

`reviewSample` suspends on the spot when a rejected sample item reaches `sampleRejectionsToSuspend` (1).

`planSample` selects `max(sampleMinimum, ceil(sampleFraction × delegations))` — 10 % with a minimum of one — from the earliest delegations not yet sampled, and only records the queue: execution never waits for review.

Reactivation is a new `promote`, so W-64's fresh Owner/Admin gate and the §7.2 thresholds apply again; the promotion clears the suspension field and the audit keeps every suspension.

### The audit

Each entry carries the unit, the tenant, the instant, the event, the actor (`automatic` when the service decided), the cause, the item or period, and the numbers.

The key is the instant plus a per-process sequence, so entries written in the same millisecond still read back in order.

## Alternatives considered

- **Import the board and read its items directly.** Rejected: it couples two packages that change for different reasons, and this lane cannot touch the board.
- **Promote automatically once the port reports eligibility.** Rejected by W-53: the period and the statistical minimum are unsigned, so the rule is incomplete and the service may only report.
- **Derive the period from the calendar month.** Rejected: the business period is a signed value, and a calendar month would be an invented one.
- **Pick the sample with a random draw.** Rejected: a reviewer cannot reproduce or challenge the selection; ordering by instant is auditable.
- **Treat technical failures as ordinary failures.** Rejected by §7.2 and by D-13's intent: an integration timeout is not evidence about the agent.

## Consequences

- Two values stay `null` until the business signs them, and every report names them; no default stands in.
- The package is usable as soon as a port provider exists; until then its evaluation paths refuse loudly instead of reporting zeros.
- `assess` needs a caller. The board adapter or a routine runs it after recording delegated outcomes; nothing schedules it from inside the service.
- A tenant member without a governance role cannot promote, supervise, or record a sample verdict, so a rejection cannot be used to suspend a unit by someone outside the gate.
- A unit promoted again after suspension keeps the audits of both decisions and starts a new promotion record.

## Testing

`packages/faberloom/autonomy/tests/autonomy.spec.ts` covers the acceptance paths: nine runs do not promote, 69 % does not and 70 % does, a member cannot promote while an admin can, three reversals in twenty delegations suspend with the cause in the audit, one rejected sample item suspends, a technical failure alone does not, two tenants with the same unit name never see each other, and the sample is 10 % with a minimum of one.
