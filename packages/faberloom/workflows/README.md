---
description: "Native product module (ctx.faberloomWorkflows) for versioned work-flow graphs, their compilation to routines, and the offline runtime in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-workflows

English | [中文](README.zh.md)

## Summary

This package carries the native Work Flow module: a versioned directed graph of nodes and edges, scoped to a Space or the personal scope, whose source of truth is the graph and whose runtime is a Routine compiled from it. The host service `ctx.faberloomWorkflows` owns the graph records; the model tools live in `dsh-tool-faberloom`, and the browser editor is a panel in `dsh-client-ui-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain`, `ctx.faberloomRoutines`, and `ctx.faberloomSpaces` are present. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

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

- **Skeleton only** — this package currently exposes the design and the module surface; the durable graph domain, the compilation to a Routine, the node handlers, the chat tools, and the browser editor arrive on later slices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The graph is the source of truth and a compiled `routineId` is a derived artifact; the runtime reuses the routines engine and its dispatcher rather than adding a second executor. See the proposed Agent Note on the Work Flow module for the contracts and phases.

</details>
