---
description: "Native product module (ctx.faberloomSpaces) for thematic spaces and effective context in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-spaces

English | [中文](README.zh.md)

## Summary

This package carries thematic spaces and effective context. It registers the `ctx.faberloomSpaces` host service with durable records through the storage domain and console-role access control; the model tools live in `dsh-tool-faberloom`. It also resolves a referenced space by lexical lookup and returns its effective context, memory, and attached-file metadata.

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

- **Console-role scoping** — access uses the console role, company, and read-only flag the gateway injects; a member from another company is denied, while a read-only role still creates and manages its own spaces (a space is the user's own container, not company data).
- **Workspace mirror** — a space may store the id of the harness Workspace it mirrors when a Workspace is adopted as a Space; the service keeps the id only (never a path), and the view resolves it through the workspace registry. A space with no mirror uses the deterministic `<DSH_HOME>/spaces/<ref>` area.
- **Lexical reference lookup (v1)** — `find` matches a space title, its context values, and its memory text by folded terms; it does not search attached-file contents, and it excludes archived spaces. `reference` returns file metadata without bytes. When `ctx.faberloomContext` is mounted, `find` also scores the Space's curated context entries (shared, plus the reader's own) and `reference` returns them; the Space's `context` map and the versioned entries stay separate layers. While a `ctx.spaceIndex` ranker is mounted, `find` also scores the readable text of the Space's attached files, bounded to 50 KB.
- **Pluggable ranking seam (6.1)** — `find` ranks through `ctx.spaceIndex` when a provider is mounted, otherwise through the built-in lexical ranker; the seam lets an embeddings or knowledge-hub provider replace ranking without touching storage or access control.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
