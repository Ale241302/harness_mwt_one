---
description: "Native product module (ctx.faberloomWorkflows) for versioned work-flow graphs, their compilation to routines, and the offline runtime in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-workflows

English | [中文](README.zh.md)

## Summary

This package carries the native Work Flow module: a versioned graph of nodes and edges scoped to a Space or the personal scope, whose runtime is a Routine compiled from it. `ctx.faberloomWorkflows` owns the durable records (create, list, get, update, status, validate, compile, remove) with DAG validation and `compileWorkFlow`. Activating a flow creates and activates its routine; editing one versions the routine and migrates its waiting executions. Model tools live in `dsh-tool-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain` and `ctx.faberloomRoutines` are present. The service opens the `faberloom_workflows` domain lazily on first use and closes it with the calling plugin's fiber, so disposing that fiber removes it. Every operation carries the authenticated actor; this slice treats the owner as the only identity that may read or manage a flow. Activation refuses an invalid graph and refuses a graph whose handler names the mounted handlers do not register.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomWorkflows` is a host-side service: it registers no tools, injects no prompt text, and writes no session events; the graph tools live in `dsh-tool-faberloom` and are opt-in.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Editing surfaces arrive on later slices** — chat tools, the browser editor, scheduling, sharing, liveness, and templates are Fases 3–9; the compiled runtime, activation, and migration are in place.
- **Branches are gated, not looped** — an edge from a `condition` node whose branch condition ends in `== true` or `== false` compiles to a step gate: the target step runs only when the condition's `{passed}` result matches, and is skipped otherwise. Loops and richer control flow still wait for the v2 graph executor.
- **Owner-only access** — per-action permissions and cross-user grants arrive with the sharing slice.

No invariant companion is published because the service owns one durable graph relation, and its unit and integration specs assert it; no observation outside those tests can diverge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The graph is the source of truth and a compiled `routineId` is a derived artifact; the runtime reuses the routines engine and its dispatcher rather than adding a second executor. See the proposed Agent Note on the Work Flow module for the contracts and phases.

</details>
