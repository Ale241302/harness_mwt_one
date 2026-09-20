# Agent Note: elective autonomy, versioned teachings, and the case log reach the product

Status: implemented

English | [中文](2026-09-18-faberloom-autonomy-teachings-log.zh.md)

## Problem

Three capabilities the plan treats as central were implemented and covered but unreachable from the product:

- **Autonomy** (§10, E7): `ctx.faberloomAccess` held elective, action-scoped grants and a `check`, and nothing consulted it. A routine with an effectful step ran that effect whether or not the owner had ever authorized the action, and revoking a grant changed nothing.
- **Teachings** (§9.1, E7): `ctx.faberloomMemory` held versioned teachings with scope, source, authorship, supersession, uses, contextual performance, late errors, and a portable snapshot. The Memoria panel reads and writes the TencentDB agent memory instead, so a correction had nowhere to live that could be reviewed, versioned, or revoked.
- **The case log** (§9, E6, pantallas 3 and 9): executions lived inside the Rutinas panel, one routine at a time, with no screen for what a case received, what it did, what it cost, or for correcting a result after the fact.

## Decision

**Autonomy is enforced by the engine and granted from the panel.** Before a step whose definition records an effect, the routines engine asks the access service whether the owner granted the action the routine declares — its first permission entry, falling back to `faberloom.effect.<stepId>` — scoped to that routine as the grant's context. Denial is a failure: the step is marked failed with `NOT_AUTHORIZED:<reason>` and the execution goes to `needs_review`, so the case lands on the Mesa instead of acting. The check runs before every effect, so `REVOKED` and `EXPIRED` stop the next one. The engine declares the access service as an injection, so a composition without grants cannot run an effect at all. Grants are created and revoked only from the Conexiones panel: a model that could grant itself autonomy would defeat the rule that learning never widens permission.

**Teachings coexist with the memory server.** The model's active memory stays TencentDB, injected by the proxy; the native teachings registry is the product's own record of corrections, and the Memoria panel now shows both. A teaching can be recorded by hand or applied from a case, edited (producing a new version and keeping the previous), revoked, and read with the case it came from, the person who stated it, its scope, its uses, and the contextual performance evidence behind it. Nothing copies TencentDB rows into teachings or the reverse.

**The case log is its own screen.** Ejecución lists every execution with the routine it belongs to, its status, its wait or reason, and its deadline; the inspector renders the plan's log fields — input, context, decision, run (each step with status, reason, recorded text, and whether it records an effect), cost, review, effect — and a correction form whose treatment and teaching text create the teaching that closes the loop. The rows carry the routine name, the event that started the case, each step's reason and effect flag, and the creation instant, all projected at call time.

## Alternatives considered

- **Enforcing autonomy in the tools only.** Rejected: a routine step runs through the engine, not through a model tool, so a tool-side guard would leave the plan's own example unguarded.
- **Letting the model grant.** Rejected: it inverts §10. Consult and revoke are readable; granting is a human act.
- **Replacing the memory server with native teachings.** Rejected for now: the server injects context into every model call, which the registry does not; the registry answers "what did we correct, and is it still in force".
- **The case log inside the Rutinas panel.** Rejected: the plan separates "Rutinas" (definitions) from "Ejecución" (what happened), and a case must be readable without knowing its routine.

## Consequences

- An effectful routine stops at `NOT_AUTHORIZED` until the owner grants its action, and a revocation stops the next effect — F16 and F17 are executable product behavior, not just engine tests.
- A correction applied from a case becomes a teaching with the case as its source, and the same teaching can be edited or revoked later without losing its history.
- The log makes the wait deadline and the effect flag visible where a person judges the result.
- Cost is not yet recorded per case, so the log says so instead of showing a number nobody measured.
