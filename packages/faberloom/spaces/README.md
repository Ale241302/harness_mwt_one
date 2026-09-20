---
description: "Native product module (ctx.faberloomSpaces) for thematic spaces and effective context in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-spaces

English | [中文](README.zh.md)

## Summary

This package carries thematic spaces and effective context. It registers the `ctx.faberloomSpaces` host service with durable records through the storage domain and console-role access control; the model tools live in `dsh-tool-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomSpaces`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomSpaces` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Console-role scoping** — access uses the console role, company, and read-only flag the gateway injects; a member from another company is denied and a read-only role cannot mutate spaces.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
