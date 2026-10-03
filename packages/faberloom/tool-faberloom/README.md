---
description: "Model-facing product tools (faberloom_*) over the native FaberLoom service modules of this DeepSeek Harness build, including the multi-company MWT.ONE tenant router."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

English | [中文](README.zh.md)

## Summary

This package registers the model-visible `faberloom_*` product tools over the native services: spaces, agents, models, routines, executions, board, sources, mail, the MWT.ONE tenant router, cross-space resolution (`faberloom_spaces_find`, `_reference`, `_ask`), and opt-in space-memory and teaching tools. The router fans one read query out to every `legal_entity_ids` tenant, never outside them, and the console still enforces role and permissions on each call.

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
- **Lexical space lookup (v1).** `faberloom_spaces_find` ranks by folded terms over a space title, context, and memory; it does not read attached-file contents, and an empty query lists the most recently created readable spaces. `faberloom_spaces_reference` returns file metadata without bytes.
- **Delegated consultation (v1).** `faberloom_spaces_ask` runs one one-shot delegation through `askProvider` (default `spawn`); `continuable` is rejected, delegation depth applies, and the child inherits the parent's merged tool plane. The child runs in the parent's workspace because `resolveWorkdir` returns an opaque reference, not a path; running in the Space's real workdir is deferred.
- **Memory tools are opt-in.** `memoryTools` (default off) registers the space-memory (`faberloom_spaces_remember`/`_memory_list`/`_forget`) and teaching (`faberloom_memory_teach`/`_teachings`/`_revoke`/`_retrieve`) tools; it stays off by default because they add permanent request schema. This explicit, versioned layer is FaberLoom's; automatic episodic memory is distilled by the external memory server (see `MANIFEST.md`), not by these tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
