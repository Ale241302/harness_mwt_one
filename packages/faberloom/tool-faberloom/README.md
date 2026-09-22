---
description: "Model-facing product tools (faberloom_*) over the native FaberLoom service modules of this DeepSeek Harness build, including the multi-company MWT.ONE tenant router."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

English | [中文](README.zh.md)

## Summary

This package registers the model-visible product tools that read and write the native product services: spaces, agents, models, routines, executions, board, sources, mail (IMAP search and SMTP send), and the MWT.ONE tenant router. The router — `faberloom_companies`, `faberloom_mwt_call`, `faberloom_mwt_find` — answers "which of the user's companies holds this data" by fanning one read query out to every `legal_entity_ids` tenant, never outside them; each company call goes through the same JSON-RPC client with that tenant in `X-MWT-Client-ID`, and the console still enforces role and permissions on every call.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.tools` and the product services are present. The tools register on the calling plugin's fiber and disappear with it.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`faberloom_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-faberloom).

#### Token effect

Every tool schema rides every request while the package is mounted; results are ordinary text blocks.

#### KV Cache effect

Adding or removing a tool changes the tool block, which can invalidate reuse from the first altered token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The tenant router trusts the console for effects.** `faberloom_mwt_call` and `faberloom_mwt_find` constrain only the tenant (never outside the user's companies); whether a tool reads or writes stays with the MWT.ONE console's RBAC, not with a FaberLoom-side allowlist.
- **Company names are ids.** The console returns `legal_entity_ids` as opaque ids; a display-name mapping is deferred until the console exposes one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
