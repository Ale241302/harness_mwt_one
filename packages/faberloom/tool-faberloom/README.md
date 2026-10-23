---
description: "Model-facing product tools (faberloom_*) over the native FaberLoom service modules of this DeepSeek Harness build, including the multi-company MWT.ONE tenant router."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-faberloom

English | [中文](README.zh.md)

## Summary

This package registers the model-visible `faberloom_*` tools over the native services: spaces, agents, models, routines, executions, board, sources, mail, cross-space resolution (`faberloom_spaces_find`, `_reference`, `_ask`), the session Space scope (`faberloom_spaces_scope`, `_open_read`: the current subtree plus an approved read-only grant for an outside Space), skill installation (`faberloom_skill_install`: a folder into the workspace or the global root), MCP server installation (`faberloom_mcp_install` reads handed-over documentation, `_add` takes the facts directly, `_list`/`_remove` manage the rest; a server is proven by one connection before it is saved, and credentials go to the credential seam), workspace file changes (create/rename/delete through `workspaceFiles`), and opt-in memory and teaching tools. The router fans one read query to every `legal_entity_ids` tenant; the console enforces role and permissions per call.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.tools` and the product services are present. The tools register on the calling plugin's fiber and disappear with it. The workspace file tools also need the `workspaceFiles` capability mounted — they resolve the calling session's own workspace root there and perform every change through it, so a call without that capability fails loud instead of guessing a path.

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
- **The Space scope is subtree-first.** `faberloom_spaces_scope` reads the session's own Space, every sub-Space below it, and the subtrees granted in that session; `faberloom_spaces_open_read` asks the user through `ctx.approval` before adding a Space outside the subtree, records one durable read-grant event, and returns the same detailed scope text. A Space the identity cannot read is refused by the spaces service before any approval is requested. A session already running under `danger-full-access` records the grant without a prompt, because that standing mode already authorizes the user's own file operations and the grant is narrower (read-only); a confined preset asks and fails closed on rejection or an unavailable channel. The grant is read-only by contract: writes outside the session's sandbox root stay denied, and the file tools refuse paths under a foreign Space folder until the grant exists.
- **Space lookup.** `faberloom_spaces_find` ranks by folded terms over a space title, context, memory, and the Space's curated context entries; while a `ctx.spaceIndex` ranker is mounted it also scores the readable text of the Space's attached files. An empty query lists the most recently created readable spaces. `faberloom_spaces_reference` returns file metadata without bytes.
- **Delegated consultation.** `faberloom_spaces_ask` runs one delegated turn through `askProvider` (default `spawn`) and returns its answer; `continuable: true` starts a durable child that `faberloom_spaces_followup` continues. Delegation depth applies and the child inherits the responsible agent's plane, including, when that agent stores a key, its credential reference, so the consultation runs on the consulted agent's own provider account. The child runs in the parent's workspace because `resolveWorkdir` returns an opaque reference, not a path; running in the Space's real workdir is deferred.
- **Memory tools are opt-in.** `memoryTools` (default off) registers the space-memory (`faberloom_spaces_remember`/`_memory_list`/`_forget`) and teaching (`faberloom_memory_teach`/`_teachings`/`_revoke`/`_retrieve`) tools; it stays off by default because they add permanent request schema. This explicit, versioned layer is FaberLoom's; automatic episodic memory is distilled by the external memory server (see `MANIFEST.md`), not by these tools.
- **Work Flow tools are opt-in.** `workflowTools` (default off) registers the graph tools (`faberloom_workflows_list`/`_get`/`_create`/`_add_node`/`_update_node`/`_remove_node`/`_connect`/`_disconnect`/`_set_trigger`/`_validate`/`_activate`/`_pause`/`_run_now`/`_runs`) and the directive to build an automation as a graph and validate before activating. It stays off by default because they add permanent request schema.
- **MCP installation probes before it saves.** `faberloom_mcp_add` connects once to prove the server works and records it only when that probe succeeds; a server that cannot be reached, rejects the credentials it was given, or does not answer as an MCP server is reported and nothing is saved. `faberloom_mcp_install` reads the documentation the user handed over (a `mcpServers` JSON block, a launcher command, or a server URL), names every environment or header value the page asks for, and asks the user for them through `ctx.userQuestions` before it connects; a value it cannot get is returned as a list of missing inputs so the model asks the user, and the server is never saved with an invented value. Each install adds or replaces exactly one server and leaves the others working; the user may have many, one per purpose. A name already installed is reported with the existing server's state and nothing is saved unless `replace` is true, so a working server is never overwritten silently. The probe carries the values supplied in the call, so re-testing an already saved server that needs a secret means supplying the value again; the tool never reads a saved value back. `faberloom_mcp_list` reports each server's transport, whether it is proven and available (an enabled server whose mount failed reads `saved but not proven yet` with the redacted reason), and which of its entries are present, never a value. A saved server belongs to the user, so every workspace and Space of theirs can use its tools.
- **Workspace file tools own no filesystem rules.** `faberloom_files_create`, `_rename`, and `_delete` call the mounted `workspaceFiles` capability with the calling session's own scope, so containment, refusals, and the answer (what changed, and where) are that capability's; the tool only validates its own arguments and turns the answer into one model-facing line. `_rename` replaces one path segment, never a move to another directory, and it refuses a name carrying a separator before anything is sent.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
