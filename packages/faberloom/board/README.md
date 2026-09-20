---
description: "Native product board (ctx.faberloomBoard): versioned work items with evidence-gated submits, version-bound approvals, revalidation, and authorization-gated effects."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

English | [中文](README.zh.md)

## Summary

This package carries the work table: prepared results and exceptions with versioned revisions, approval bound to the exact revision, revalidation after a change, and effects that require an explicit authorization. It registers the `ctx.faberloomBoard` host service; the model tools live in `dsh-tool-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomBoard`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomBoard` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Owner-only review** — mutations require the item owner; member-based review needs the access layer.
- **Opaque documents** — documents are references; binary documents arrive with the blob store.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
