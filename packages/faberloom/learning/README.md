---
description: "Native product module (ctx.faberloomMemory) for memory, versioned teachings, the correction registry, learning candidates, maturity metrics, and contextual performance in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-learning

English | [中文](README.zh.md)

## Summary

This package carries memory, versioned teachings, the correction registry with its scope taxonomy, learning candidates with lineage and an allowed destination, per-task-type maturity metrics, and contextual performance. It registers the `ctx.faberloomMemory` host service; the board and the model tools live in other packages.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomMemory`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

### Correction registry

`onCorrection(actor, input)` is the single entry point for a human correction, whatever produced it. One durable record carries the origin, the origin item, the tenant, the space, the account, the agent, the actor, the classifications it touched, the fields it used, and the scope the human chose:

| Origin | Payload |
|---|---|
| `edit` | field, previous value, new value |
| `answer_doubt` | question the agent asked, answer the human chose |
| `iterate` | instructions, diffs, rounds |

An applied iteration must carry a scope; an inline edit and an answered doubt default to `puntual` with no extra step (W-34). A correction is never edited or deleted: a late error updates a teaching instead.

### Learning scope

The scope is `puntual`, `cuenta`, `espacio`, or `agente`. `puntual` is recorded and teaches nothing: it creates no candidate. The other three create one candidate and name its allowed destination. Recording a correction never promotes anything (W-35).

A candidate inherits the highest data classification of its origin, keeps every classification it inherited, and copies the fields it used (W-46). An origin whose classification is still provisional records the correction and yields no candidate, because provisional data feeds no derived product.

### Promotion and widening

`promoteCandidate(actor, id, { destination, acceptedDataClasses })` is the only path that activates a candidate. It revalidates the tenant, the actor scope, the classification against the destination, the destination reference, and the provenance back to its correction before it commits. A destination other than the allowed one is rejected (W-60), and no candidate crosses a tenant (W-47).

The classifications a destination accepts come from the caller, because the classification policy is unsigned; a promotion never assumes a ceiling of its own.

`widenCandidate(actor, id, { destination, text, acceptedDataClasses })` widens a candidate from account to space, or from space to agent. It never moves the original candidate: it creates a new candidate whose content the reviewer rewrote, and that candidate still needs its own explicit promotion (W-47). Narrowing is rejected.

### Reading and isolation

`getCorrection`, `listCorrections`, `getCandidate`, and `listCandidates` require a `LearningActor`: the tenant, plus the spaces, accounts, and agents the identity holds. An origin whose space, account, or agent the actor does not list is not readable. `tenantId: null` is a single-tenant deployment, not a wildcard. The caller resolves those lists from its authorization model; this package never widens them.

The board hands over the chosen scope of an applied iteration as a plain value, so this package imports nothing from `dsh-faberloom-board`.

### Maturity metrics

`recordOutcome(actor, input)` records what happened to one item: `approved`, `discarded`, `skipped`, `delegated`, or `delegated-reversed`. `maturity(actor, filter)` reports one entry per task type `(space, artifactType, actionType)`:

| Metric | Denominator |
|---|---|
| Correction load: iterations, edited fields, answered doubts, total, per item | observed items |
| Resolved without intervention: approved with no correction of any origin | closed items |
| Discarded share | closed items |
| Skipped share: items skipped at least once | observed items |
| Delegation reversals | delegated outcomes |
| Volume and closed items | context |

Each metric is reported on its own. There is no composite index, and an approval with an answered doubt is not a success (W-80).

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomMemory` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No activation target** — promotion records the decision and its revalidation. Writing the promoted content into account knowledge, space rules, or agent instructions belongs to the packages that own those stores.
- **Unsigned business values** — which classifications a destination accepts (POL_DATA_CLASSIFICATION), the cohort definition and alert threshold of §10.2, how many skips count as repeated, the owner and promotion permissions, retention, and the inheritance chain between account, space, and agent are pending a business signature. The service takes them as parameters or does not decide them.
- **Scope lists come from the caller** — mapping Owner, Admin, and member roles to the tenant, space, account, and agent lists is not implemented here.
- **Two commits per correction** — the correction and its candidate are two durable writes on one chain. A failed candidate write rejects the call and leaves the correction recorded.
- **No period bucketing beyond the filter** — `maturity` filters on the outcome instant and groups by task type only; it builds no cohorts and compares no periods.
- **Provisional origins yield no candidate** — until the permitted field list of D-10 exists, a provisional item records corrections only.
- **Not in the portable snapshot** — candidates carry tenant-bound lineage, so `exportKnowledge` leaves corrections, candidates, and outcomes out.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
