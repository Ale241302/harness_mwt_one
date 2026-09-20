---
description: "Native product modules of this DeepSeek Harness build: thematic spaces, agent catalogs with model policy, routines, persistent execution, memory, autonomy, and backup."
kind: "package-group"
---

# Native product modules

English | [中文](README.zh.md)

## Summary

This group carries the native product capabilities of this DeepSeek Harness build as first-class Cordis subsystems: thematic spaces, agent catalogs with model policy, declarative routines, persistent execution, memory, elective autonomy, and knowledge backup. Each package registers one `ctx.faberloom*` host service and follows the repository package rules.

The subsystem reference is [docs/subsystems/faberloom.md](../../docs/subsystems/faberloom.md).

## Table of Contents

- [Packages](#packages)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

- `@deepseek-ai/dsh-faberloom-spaces` — thematic spaces and effective context.
- `@deepseek-ai/dsh-faberloom-agents` — the agent catalog and versioned model policy.
- `@deepseek-ai/dsh-faberloom-board` — the work table: versioned items, approvals, and revalidation.
- `@deepseek-ai/dsh-faberloom-routines` — declarative versioned routines.
- `@deepseek-ai/dsh-faberloom-execution` — persistent execution, waits, and the effects ledger.
- `@deepseek-ai/dsh-faberloom-learning` — memory, versioned teachings, and contextual performance.
- `@deepseek-ai/dsh-faberloom-access` — identity bindings, connections, and elective autonomy.
- `@deepseek-ai/dsh-faberloom-backup` — knowledge export, restore, integrity, and migrations.
- `@deepseek-ai/dsh-tool-faberloom` — the model-facing product tools (`faberloom_*`).
- `@deepseek-ai/dsh-faberloom-app` — the profile bundle that mounts the modules and tools.

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. The group registers host-side services only: no tools, no prompt text, and no session events, so no request field carries their data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registrations never touch a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Skeleton slice** — the packages currently expose the service surfaces without durable records, settings, or tools; those arrive on later slices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
