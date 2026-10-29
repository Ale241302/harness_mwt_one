---
description: "Native product autonomy (ctx.faberloomAutonomy): the SHADOW, SUPERVISADO, and DELEGADO level of each (tenant, space, agent, actionType) unit, its §7.2 promotion report, the sampled review of delegated items, and the automatic suspension of §7.3."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-autonomy

English | [中文](README.zh.md)

## Summary

This package carries the autonomy level of every unit `(tenant, space, agent, actionType)` and the two rules that move it: the promotion rule of §7.2 and the monitoring rule of §7.3 with the values of D-13. It registers the `ctx.faberloomAutonomy` host service, reads closed items through a narrow port provided as `faberloomAutonomyOutcomes`, and imports nothing from the board.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition, next to the adapter that answers the outcome port, to expose `ctx.faberloomAutonomy`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

### Unit and level

The unit is `(tenantId, spaceId, agentId, actionType)`; `spaceId` is the workspace of the specification. `autonomyUnitId(ref)` returns its storage key, so the panel and the board adapter address the same record. One durable record per unit holds the level, the promotion in force, and the last automatic suspension:

| Level | Meaning |
|---|---|
| `SHADOW` | The agent produces; no item executes under its authority |
| `SUPERVISADO` | A human decides every item, as §7.1 stages 1–3 |
| `DELEGADO` | The unit executes alone inside its reversal window |

`ensureUnit(actor, ref)` registers a unit at `SHADOW`; `getUnit`, `listUnits`, `report`, and `listAudit` are the reads for the panel and the board adapter. Every read is tenant-scoped: another tenant's reference is refused with `TENANT_MISMATCH`, and a list never contains a unit of another tenant.

### Evaluation and the outcome port

`report(actor, ref, { period? })` reads the closed items of the unit through `AutonomyOutcomePort` and reports the numbers separately:

| Number | Denominator |
|---|---|
| Real runs | Items closed by human decision: `approved`, `approved-with-intervention`, `discarded` |
| Approved without intervention | Real runs approved with no edit, iteration, or answered doubt (W-80) |
| Approval share | Real runs |
| Reversal and failure rate | The last 20 delegations, technical failures excluded |
| Technical failures | Counted on its own; excluded from every denominator (§7.2) |

A `technical-failure` outcome without a `reason` is refused (`TECHNICAL_FAILURE_REASON_REQUIRED`): §7.2 excludes those items only when the reason is recorded. Without a mounted port the service refuses with `OUTCOME_SOURCE_UNAVAILABLE` instead of reporting an empty history.

### Promotion

`promote(actor, ref)` is the only path to `DELEGADO`. It requires a governance role of the tenant and a unit that meets the signed thresholds: 10 real runs and an approval share of at least 0.70, plus the statistical minimum when one is configured. The promotion records who promoted it, when, and the numbers it was decided on, and appends a `promoted` audit entry.

There is no automatic promotion. `report` states whether the unit meets the thresholds, names the values that are still unsigned, and reports `automaticPromotion: 'DISABLED'` on every call (W-53). Nothing in this package promotes a unit by itself.

### Monitoring and suspension

`assess(actor, ref)` applies the rule of §7.3 to a delegated unit: when the reversal-or-failure rate of the last 20 delegations exceeds 10 %, it returns the unit to `SUPERVISADO` and appends a `suspended` entry with the cause, the window, and the rate. The decision needs no human command; the caller that records delegated outcomes calls `assess` after them.

Technical failures sit outside the window, so a unit whose delegations failed technically keeps its level. `supervise(actor, ref, cause)` is the human narrowing command, and `reviewSample` suspends on a rejected sample item on the spot.

Reactivation is a new `promote`: it needs the thresholds of §7.2 again and the governance gate of W-64. The promotion clears the suspension field; the audit keeps every suspension.

### Sample of delegated items

`planSample(actor, ref, period)` selects 10 % of the delegated items of the period, at least one, from the earliest delegations that are not in the sample yet (D-13). `planSample` only selects: execution never waits for the review. `reviewSample(actor, ref, { period, itemId, verdict, note? })` records the human verdict once, and a rejection suspends a delegated unit; only a governance role may record it.

The sample size is `max(sampleMinimum, ceil(sampleFraction × delegations))`; the period is the caller's, labelled by `AutonomyPeriod.label` or by its bounds.

### Configuration

Every field is validated. The documented values of §7.2 and D-13 are defaults; the two values without a business signature have no value here:

| Field | Default | Source |
|---|---|---|
| `minimumRealRuns` | `10` | §7.2 |
| `minimumApprovalShare` | `0.70` | §7.2 |
| `statisticalMinimum` | `null` (unsigned) | §7.2, W-53 |
| `period` | `null` (unsigned) | §7.2 |
| `sampleFraction` | `0.10` | D-13 |
| `sampleMinimum` | `1` | D-13 |
| `sampleRejectionsToSuspend` | `1` | D-13 |
| `monitoringWindow` | `20` | D-13 |
| `suspensionRate` | `0.10` | D-13 |
| `governanceRoles` | `['owner', 'admin']` | §7.2 gate |

`statisticalMinimum` and `period` are `null` because the business has not signed them: the report names them as unsigned, and the service supplies no substitute. An evaluation without a period covers every outcome the port reports for the unit.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAutonomy` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Outcome port has no provider in this package** — `faberloomAutonomyOutcomes` is provided by the board adapter, which reads items, approvals, reversals, and failures from the work table. Until that row exists, `report`, `promote`, `assess`, and `planSample` refuse with `OUTCOME_SOURCE_UNAVAILABLE`.
- **Period and statistical minimum are unsigned** — `statisticalMinimum` and `period` default to `null` and are reported as `unsignedValues` (§7.2, W-53). A deployment signs them in its row; this package invents neither value nor a cohort.
- **Automatic promotion does not exist** — no operation promotes without an Owner or Admin command, and no timer or listener calls `promote`. The row can be enabled without granting autonomy to any unit.
- **Monitoring is caller-driven** — `assess` applies the rule, but nothing schedules it. The board adapter or a routine calls it after recording delegated outcomes.
- **Sample planning is per period as the caller declares it** — the period label, its bounds, and how often `planSample` runs belong to the deployment; the sample never spans two labels.
- **Execution is not blocked by the sample** — the package records the review queue only; pausing or holding a delegated item is not part of its contract.
- **Manual supervision keeps no numbers** — `supervise` audits the cause; only the automatic suspensions carry the numbers they were decided on.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
