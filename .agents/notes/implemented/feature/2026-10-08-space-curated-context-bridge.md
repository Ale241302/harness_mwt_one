# Agent Note: Space curated context bridge

Status: implemented

English | [中文](2026-10-08-space-curated-context-bridge.zh.md)

## Problem

FaberLoom keeps a Space's curated context in two layers that never met. `ctx.faberloomContext` owns the versioned, approvable entries a Space remembers; `ctx.faberloomSpaces` owns the Space's `context` key/value map, its effective memory, and its attached files. `find`, `reference`, and the `spaces_ask` brief read only the second layer, so a Space's curated context was invisible to cross-Space work: SONDEL asking about SICOP missed everything SICOP recorded through the Context panel, even though the same person can see it there.

## Decision

The context service gains `listForSpace(actor, spaceId)`, which returns the entries attached to one Space that the actor may read (the `shared` entries plus the actor's own), newest first. `SpaceIndexEntry` gains `contextEntries` (the joined title and body text) and `SpaceReference` gains `entries` as `SpaceEntryRef`, a neutral shape declared in the spaces package so spaces never imports the context package.

`spaces.find` and `spaces.reference` read the optional `ctx.faberloomContext` service through a module-local structural interface and the documented `ctx.get` overload for names outside the typed surface, so no dependency edge is added in either direction and a deployment without the context service keeps its map-and-memory behavior. `find` scores the joined entries with the context weight (reason `context-entries`); `reference` returns them; `faberloom_spaces_reference` renders and returns them (`id`, `title`, `body`, `version`); `askBrief` hands them to the responsible agent.

## Alternatives considered

**Make `spaces` depend on `context`.** Rejected: `context` already depends on `spaces` for placement, so a hard edge would create a package cycle, and the join would couple two services that only optionally co-exist.

**Do the join only in `tool-faberloom`.** Rejected: `find`'s ranking lives in the spaces service, so an entries-aware find would either be bypassed or duplicated; the seam (`ctx.spaceIndex`) receives `SpaceIndexEntry`, which the tool cannot enrich.

**Copy curated entries into the Space's `context` map.** Rejected: it would give one datum two owners and lose the version history and the approval gate.

## Consequences

`find` now finds a Space by what its curated context says, `reference` returns that context beside the map and memory, and `spaces_ask` briefs the responsible agent with it. The two layers stay separate on purpose: `context` is the Space's key/value map and `entries` is the versioned `ctx.faberloomContext` set. No package dependency was added; the context service is read structurally through `ctx.get`.

Tests cover `listForSpace` scoping and visibility, `reference.entries` (populated and empty without the service), and `find` scoring an entry; the cross-reference and space-ask snapshot fixtures carry `entries` and the cross-reference session log reflects the new rendered line. READMEs for the three packages document the bridge.
