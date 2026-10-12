# Agent Note: Browse the workspace folder from the `@` menu

Status: implemented

English | [中文](2026-10-12-workspace-folder-browse.zh.md)

## Problem

Typing `@` in the composer listed at most twenty workspace files from a fuzzy index rooted at the session's working directory. In a project folder that index cannot reach an arbitrary file, and it never showed the folder structure, so the only way to point a model at a file the user could see in their own folder was to type its path by hand. The Host already exposed a confined directory listing to the browser, and the trigger menu already supported drilling into a candidate and walking back through breadcrumbs; nothing connected the two.

## Decision

**The `@` file half browses one real directory at a time.** `packages/client/ui-reference` now builds its file candidates from `ctx.remote.workspaceFiles.list(sessionId, path)`, the Host listing confined to the session's workspace root, which for a product Space is the folder the user adopted. A query that contains a path separator browses that directory and filters its children by the typed fragment; `@` alone lists the workspace root. A query with no separator keeps the fuzzy index, so typing a name still searches the whole workspace. One section, two modes, chosen by whether the user typed a path.

**The listing is reused, not rebuilt.** Directories sort before files, a row's icon distinguishes the two, a folder row drills, the menu's breadcrumbs walk back, a listing the Host truncated says so rather than hiding entries, and each error kind the Host reports (`outside-workspace`, `not-found`, `not-directory`, and the rest) renders a readable line. A picked file inserts the same mention text as before (`formatFileMention`), so a mention stays plain path text that the model reads and the Host resolves against the same root.

**It works on web and desktop alike, with one architectural limit.** Both run the same client against a Host, and on desktop that Host is local with a native folder picker, so a user's own folder is reachable there. The web app picks a directory on the Host, not on the visitor's machine, and this change does not alter that: reaching a visitor's own disk from the web needs a different mechanism, not a listing tweak.

## Alternatives considered

**Adding a second `@` source that lists files.** The existing source already owns the `@` group, the drill plumbing, the icons, the mention grammar, and the session rows. A second file source would put two file sections in one menu whose contents differ, with no way for a user to tell which one browses, so the file half was replaced instead.

**Repointing the fuzzy index at the workspace root.** A fuzzy index answers "find this name"; the request here is "show me this folder". Making the index recursive would not produce a browsable tree, and it would lose the cheap whole-workspace search that a bare name still deserves.

**Building a new tree service.** `workspaceFiles.list` already confines itself to the workspace root, already reports truncation, and already names its failures; a parallel implementation would have to re-derive all of that.

## Consequences

A user can now reach any file in the Space's folder from the composer, including files the fuzzy index's twenty-result cap hid, and the model receives a real path. The `@` menu has one obvious way to browse and one to search. The cost is that browsing is bounded by the Host's per-listing cap (2000 entries) and confined to the workspace root, so a folder outside it stays out of reach, and the web app still cannot list a visitor's local disk. Reading and then editing, deleting, or attaching a workspace file from the interface is a separate change: the Host exposes no mutation verb, and attachments today are uploaded copies rather than workspace paths.

Verification: the package's 29 client tests pass with 100 percent coverage, covering the root listing, drilling into a child directory, breadcrumbs, folders-before-files ordering, the truncation note, four error kinds, a slash-less query still using the fuzzy index, and the mention text a pick produces.
