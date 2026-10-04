---
description: "Workspace/Space Context (ctx.faberloomContext): durable, versioned, approvable context entries separate from Memory, with per-owner indexing and restore."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-context

English | [中文](README.zh.md)

## Summary

The context service (`ctx.faberloomContext`) owns durable, versioned context entries a Workspace or Space shares. An owner or a member holding `index-context` writes entries straight to the shared context; any other member's contribution starts `pending`, visible only to its author and the Space owner until the owner indexes it (`approve`), keeps it private (`reject`), or removes it. Every change appends an immutable version, so any earlier context can be restored. Records are durable through `ctx.storageDomain`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limited)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.storageDomain`; `ctx.faberloomSpaces` and `ctx.faberloomShares` are optional and only sharpen the placement decision. The service opens the `faberloom_context` domain, registers `ctx.faberloomContext`, and exposes `create`, `list`, `get`, `update`, `versions`, `restore`, `approve`, `reject`, and `remove`. `create(actor, { title, body, spaceId })` decides visibility: a personal entry stays `local`; a Space entry is `shared` for its owner (or a member with an active `index-context` grant) and `pending` otherwise. `update` appends a version and returns a member's edit to `pending`; `restore(actor, id, version)` copies an earlier version forward as a fresh one.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomContext` is a host-side service: it registers no tools, injects no prompt text, and writes no session events. The opt-in `faberloom_context_*` tools live in `dsh-tool-faberloom`.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limited"></a>

- **Placement needs the Space or a grant** — without `ctx.faberloomSpaces` the service treats the actor as the owner, and without `ctx.faberloomShares` a member's entry always lands `pending`; the authorization still resolves once those services are mounted.
- **Approval is per entry, not per line** — the owner indexes or rejects a whole entry; there is no field-level merge.

No invariant companion is published because the service's unit specs already assert the lifecycle, the visibility matrix, and the version history.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Visibility is decided once, at write time, from the Space owner and the `index-context` grant; reads then filter by `shared`, `authorId`, or `ownerId`. Version rows are keyed `${entryId}:${version}` and are append-only, so `restore` never rewrites history. The domain is opened lazily and closed with the calling fiber, like the other FaberLoom services.

</details>
