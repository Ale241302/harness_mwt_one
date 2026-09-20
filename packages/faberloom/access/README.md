---
description: "Native product module (ctx.faberloomAccess) for identity bindings, connections, and elective autonomy in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-access

English | [中文](README.zh.md)

## Summary

This package carries identity bindings, connections, and elective autonomy. It registers the `ctx.faberloomAccess` host service; tools, settings, and durable records arrive on later slices.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomAccess`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomAccess` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Skeleton only** — this package exposes the `Access` service surface without durable records, settings, or tools; those arrive on later slices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
