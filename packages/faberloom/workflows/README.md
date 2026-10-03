---
description: "Native product module (ctx.faberloomWorkflows) for versioned work-flow graphs, their compilation to routines, and the offline runtime in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-workflows

English | [中文](README.zh.md)

## Summary

This package carries the native Work Flow module: a versioned directed graph of nodes and edges, scoped to a Space or the personal scope, whose source of truth is the graph and whose runtime is a Routine compiled from it. The host service `ctx.faberloomWorkflows` owns the durable graph records — create, list, get, update, set status, validate, compile, and remove — with DAG validation and `compileWorkFlow`. The model tools live in `dsh-tool-faberloom` and the browser editor is a panel in `dsh-client-ui-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain` is present. The service opens the `faberloom_workflows` domain lazily on first use and closes it with the calling plugin's fiber, so disposing that fiber removes it. Every operation carries the authenticated actor; this slice treats the owner as the only identity that may read or manage a flow.

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

- **Runtime and editing arrive on later slices** — node handlers, activation through `ctx.faberloomRoutines`, connectivity nodes, chat tools, the browser editor, scheduling, sharing, liveness, and templates are Fases 2–9. `setStatus('active')` validates the graph and resolves the compiled routine id from the work-flow id; it does not yet create the routine through the routines engine.
- **Owner-only access** — per-action permissions and cross-user grants arrive with the sharing slice.

No invariant companion is published because the service owns one durable graph relation, and its unit and integration specs assert it; no observation outside those tests can diverge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The graph is the source of truth and a compiled `routineId` is a derived artifact; the runtime reuses the routines engine and its dispatcher rather than adding a second executor. See the proposed Agent Note on the Work Flow module for the contracts and phases.

</details>
