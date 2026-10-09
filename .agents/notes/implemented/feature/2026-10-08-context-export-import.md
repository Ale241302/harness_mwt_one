# Agent Note: Context export, import, and replace

Status: implemented

English | [中文](2026-10-08-context-export-import.zh.md)

## Problem

The Context panel could create, edit, version, approve, reject, and remove entries, but a Space's context record was trapped in one host. An owner could not back it up, move it between Spaces or deployments, or replace a Space's record wholesale; a member's knowledge could not leave the panel.

## Decision

The context service gains three operations. `export(actor, { spaceId?, format })` returns the entries the actor may read, optionally restricted to one Space, each with its version history, as JSON (default) or Markdown. `import(actor, payload)` parses that JSON and creates each entry whose title does not already exist in its Space under the actor's placement (an owner writes shared, a member writes pending), so importing the same record twice is idempotent. `replace(actor, spaceId, entries)` is owner-only and replaces one Space's record wholesale: an entry whose title is not in the new set is removed, a retained title gets a new version, and a new title is created. The tools `faberloom_context_export` and `faberloom_context_import` expose export and import (opt-in with `contextTools`). The view exposes `exportContext`, `importContext`, and `replaceContext`; the Context panel adds an **Export** button that downloads the JSON and an **Import** control that reads a file, both localized.

## Alternatives considered

**Export one entry at a time.** Rejected: the record — the Space's set of entries with its history — is the unit a backup or a hand-off moves.

**Import as new versions of one entry.** Rejected: import creates entries, not a version of a single entry; the record is a set.

**A new tool for replace.** Rejected: replace is a panel/destructive operation, so it stays a view Remote the panel drives, not a model tool.

## Consequences

A Space's context record is portable: an owner exports it to JSON or Markdown, imports it elsewhere, or replaces a Space's record in one call. Import respects the visibility machine — an owner's import is shared, a member's import starts pending — and skips duplicate titles, so a re-import is a no-op. `replace` keeps a retained entry's history by appending a version and removes dropped entries with their history. The READMEs and the panel copy are localized, and the tools stay opt-in so a deployment without them adds no request schema.

Tests cover the context service (JSON export with versions, Markdown, import idempotency, malformed payloads, owner-only replace), the tools (export and import), and the view (the three Remotes and the malformed-payload refusal).
