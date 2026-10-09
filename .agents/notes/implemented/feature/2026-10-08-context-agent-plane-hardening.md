# Agent Note: Context and agent-plane hardening

Status: implemented

English | [中文](2026-10-08-context-agent-plane-hardening.zh.md)

## Problem

An independent review of the Context / agent-plane suite found defects that the focused specs had not exercised. `FaberLoomContext.placement` swallowed a `spaces.get` failure and fell back to treating the actor as the Space owner, so a non-member could place an entry — and, through `replace`, rewrite a Space's whole context record. `list` admitted every `shared` entry to every actor, regardless of whether they could read its Space, so `export` could exfiltrate another Space's context. `FaberLoomSessionAgent` read `ctx.agents` without declaring the injection, so a real composition could drop the plugin. A delegated child re-ran the composition and registered the `deployment:persona-prefix` section a second time, failing child creation. The context tools' output schema declared `spaceId` as a string while a personal entry carries `null`, so listing a personal entry raised a tool-output error. A one-shot `faberloom_spaces_ask` returned a non-completed run as if it were an answer, its `continuable` parameter still described itself as unsupported, and `import` created a duplicate when one payload repeated a title.

## Decision

`placement` resolves the Space through its read ACL and fails closed: an entry cannot be placed into a Space the actor may not read, and a readable Space owned by someone else still lands `pending` without the `index-context` grant. A read admits an entry the actor wrote or owns, or a `shared` entry whose Space the actor may read; the readable set is computed once per `list`. `FaberLoomSessionAgent` declares `static inject = ['agents']`, guards concurrent installs, and skips a delegated child (`header.parentSession` set), which already inherits the parent's composition. `summarize` renders a personal entry's `spaceId` as the empty string. A one-shot `faberloom_spaces_ask` fails loud when the run's `stopReason` is not `completed`, and its `continuable` description names the durable follow-up. `import` tracks titles already seen in the payload so a repeat skips. Reading the actor's curated entries in `find` moved to a single `ctx.faberloomContext.list` grouped by Space, instead of one `listForSpace` per Space.

## Alternatives considered

**Distinguish “not found” from “access denied”.** Rejected: `spaces.get` raises the same error for both, and both must refuse placement, so one closed path is correct and simpler.

**Scope shared entries by a stored reader list.** Rejected: the Space ACL is the single authority for who reads a Space; copying members into each entry would drift from it.

**Keep swallowing the placement failure for bare compositions.** Kept only when no spaces service is mounted (the degraded composition has no owner to resolve); with spaces mounted, the check is enforced.

## Consequences

A non-member can neither place nor replace a Space's context, and a shared entry is readable only by a reader of its Space. The session composition loads under a real composition, delegated children inherit their parent's agent without a duplicate section, and a personal entry lists without a schema error. A delegated run that did not complete surfaces as an error rather than a partial answer. The added tests pin each path: placement and `replace` refusal, shared-entry scoping in `list`/`export`/`get`, payload idempotency, the child skip, and the non-completed stop reason.
