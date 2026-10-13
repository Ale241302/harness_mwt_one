---
description: "Web @file and @session reference source for the composer: workspace-folder browsing, fuzzy name search, and atomic inline references (unified file/session picking)."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-reference

English | [中文](README.zh.md)

## Summary

Use `dsh-client-ui-reference` when users need to mention files, folders, or sessions from one `@` completion menu. The file half browses the Session's workspace: `@` lists the root, a typed path descends into it, a folder row or Tab drills deeper, and the breadcrumb walks back; a name with no separator instead searches the workspace through the fuzzy index. Picking a file, folder, or session inserts an atomic reference with a stable clipboard form, and a folder row lets the user descend without closing completion. Session mentions are validated before model context is captured; browsing candidates has no model effect.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The source is active whenever the composition mounts this package and the Host `ctx.fileReferences` and `ctx.workspaceFiles` providers are available. Type `@` to list the Session's workspace root, folders first. Keep typing a path (`@src/`, `@src/module1/`) to descend into it, or drill with a folder row's chevron or Tab; the menu header carries the workspace-root breadcrumb, where an earlier step is one click back. A typed name with no separator (`@readme`) instead searches the whole workspace by name through the fuzzy file index. Open `@"…` to search files only with a path that may contain spaces. The candidate list is a completion menu, not a search result page: pick once and keep typing.

### What a pick inserts

A file closes completion as an atomic inline reference displayed with a file glyph and business-color filename. A directory row carries two verbs: the settling pick (row click or Enter) resolves the folder itself as the same kind of atomic reference — folder glyph, trailing-slash label, canonical `@dir/` mention as its serialized form — while the drill action (Tab or the row's chevron) keeps plain editable path text with a folder glyph and the menu active at its trailing slash, so you can descend another level. Paths containing whitespace use `@"path with spaces"`, and a quote the user opened explicitly remains quoted. Every mention is a workspace-relative path, whether it came from the browser or the fuzzy index.

A session pick inserts an atomic inline reference whose hidden `ref` and clipboard representation is the canonical `@[label](dsh-session:…)` mention returned by the Host; its visible form is a chat-bubble glyph plus the session title. Sending carries the mention through `session.prompt`, and the session-reference service validates it and captures model context at `agent/pre-step`.

Every file row carries a second verb beside its mention: the attach row reads the file's bytes through the Host (`workspaceFiles/readAll`) and hands them to the composer's existing attachment intake, so the draft gains the same background upload, rail card, and staged receipt a browser-picked file gets. Attaching never truncates: a file the Host refuses — too large, gone, or not a regular file — shows one readable notice and nothing joins the draft. The mention keeps pointing at a path; the attach row hands over the content.

### Failure behavior

One unavailable or failed candidate domain yields no rows for that domain while the other still lists. A directory that cannot be listed — gone, outside the workspace, not a directory, or an unclassified Host failure — shows one row naming the reason instead of an empty file section, and a listing cut by the Host's entry cap ends with a row saying some entries are not shown. A session-reference preparation failure occurs after prompt acceptance and terminates that agent turn.

Click a file reference in the composer to preview its current contents in the right Sidebar. Quoted paths retain their spaces, and paths resolve in the composer Session. Folder and Session references retain their editing behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The source keeps candidate encoding internal to the registration effect: the `/client` export is the plugin body (`apply`/`inject`) only.

### Candidate flow

The file section is one browser, not two: an empty query or a typed path lists the real directory through the confined `workspaceFiles/list`, folders first, each row carrying the glyph and the `@path` mention its pick uses. The fuzzy `fileReferences/list` stays for the one case it does better — a typed name with no separator, which can match anywhere in the workspace. Keeping both inside one source, rather than registering a second `@` source, leaves the menu with one obvious way to browse a folder. Candidate encoding and the name/path split live in `browse.ts`; the registration wires them.

For such a query the browser starts the `fileReferences/list` fuzzy search and the `sessionReferenceResolver/candidates` call together, then deterministically orders files before sessions with locale-registered folder/file/session labels. Rows render under non-selectable file and session section headings without a redundant raw `reference` source title. A session row is dated from the Host session list's `updatedAt` through the same relative-time bucket that list uses, so one session reads the same age on both surfaces; a session the list does not carry falls back to the candidate's creation time. A drilled query publishes a breadcrumb from the workspace root to the directory being listed; each crumb carries the drill payload a folder row would, so returning to a step and descending into one are one outcome.

### Serialization

File picks preserve the natural text defined by the shared `@path` grammar as the hidden serialized and clipboard form. Session picks use the canonical `@[label](dsh-session:…)` mention; serialization never reconstructs identity from the visible title.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the suggestion machinery, the reference seams, and the input pipeline.

- [ui-input-trigger](../ui-input-trigger/README.md) — the inline suggestion machinery the source registers into.
- [file-reference](../../context/file-reference/README.md) — the `@file` seam and its provider contract.
- [session-reference](../../context/session-reference/README.md) — the `@session` seam and prepared snapshot semantics.
- [Web input machine and slash pipeline](../../../.agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) — how references and commands share the input machine.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through Host-owned providers, which own the file guidance and session snapshot preparation this package's reference selection delegates to them, and the workspace listing its folder browser reads.

#### KV Cache effect

Candidate browsing has no model effect. A selected file or session changes only the new user-message suffix and any Host-prepared session-reference context that follows that message; earlier target history remains unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the reference source cannot help; they are current package constraints.

- **Candidate failure is intentionally quiet** — one unavailable or failed Remote discovery call yields no rows for that domain; only a directory that cannot be listed gets a row naming why. A session-reference preparation failure occurs after prompt acceptance and terminates that agent turn.
- **Folder browsing is workspace-confined** — the browser reads only inside the Session's workspace root through `workspaceFiles/list`; a path outside it surfaces as a row, not as content, and the browser cannot fall back to its own filesystem.
- **Name search stays index-backed** — a typed name with no separator goes through `fileReferences/list` and inherits that provider's result cap; reaching an arbitrary file is the folder browser's job.
- **Session search remains metadata-only** — discovery filters session id, cwd, and the latest log-backed title through `ctx.sessionReferenceResolver`; message bodies and full transcripts are not searched.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A single slash-source registration whose disposal is proven by the HMR-safety spec — it emits no cordis events and owns no cross-plugin mutable state.
