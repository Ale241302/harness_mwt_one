---
description: "Native product module (ctx.faberloomRoutines) for declarative versioned routines in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-routines

English | [中文](README.zh.md)

## Summary

This package carries declarative versioned routines. It registers the `ctx.faberloomRoutines` host service; tools, settings, and durable records arrive on later slices.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomRoutines`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomRoutines` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A wait carries a deadline.** A step that parks on `waitFor` records `deadlineAt = now + waitTimeoutMs` (one day by default, a Config field a deployment shortens). `expireWaits(now)` marks a wait nobody answered as failed with `WAIT_TIMEOUT` and moves the execution to review; a reply clears the deadline.
- **An effectful step needs a grant.** Before running a step whose definition records an effect, the engine asks `ctx.faberloomAccess` whether the owner authorized the routine's first declared permission (or `faberloom.effect.<stepId>`), scoped to the routine. Without it the step fails with `NOT_AUTHORIZED` and the case goes to review, so a revocation stops the next effect.
- **Removing a routine keeps its history.** `removeRoutine` deletes the definition and its stored versions; the executions it produced and the effect ledger stay, so a case that already ran keeps its record.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
