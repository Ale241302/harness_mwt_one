# Agent Note: Mesa guardrails closed against the WorkLoom spec

Status: implemented

English | [中文](2026-10-29-mesa-guardrails-closure.zh.md)

## Problem

An audit of the WorkLoom Mesa against `SPEC_FB_WORKLOOM_v1.6.1` and `PLAN_MESA_IMPLEMENTACION` found sixteen gaps that the stage status had reported as closed:

- The API returned `summary` and `valueUsd` for N3/N4 items; only the panel hid them, so the payload still travelled.
- `submit` accepted `dataClass` from the caller, so an agent could declare its own item N0.
- Non-USD amounts never converted: `valueUsd` was filled only when the currency was already USD.
- The classification cache did not exist and no classifier port was mounted, although W-51/W-61 require a per-context cache.
- `dispatchEffect` had no consumer; the profile still offered three execution action types and the CEO-signature list was empty.
- An iteration chat could not write the draft: no `iteration_context`/`iteration_propose` tool existed, so the model could only talk.
- The approval panel kept a chosen action type after closing, so `A` could start an external acceptance with no panel.
- Filters, grouping, skip rounds, and the round-limit hint were missing from the panel.

## Decision

The architecture decisions are recorded in `DECISIONES_MESA_ARQUITECTO.md` (A-01…A-15). The load-bearing ones:

- The data class is computed on the server from the artifact type and account; callers describe artifacts, never sensitivity.
- N3/N4 is projected by the API, not the client, and opening one appends an `access` audit event without moving `rowVersion`.
- A conversion names its rate, source, and date; the board converts and refuses an item that omits them.
- The classifier is a port (`faberloomBoardClassifier`) with a full §5.1 cache key; without it an item stays unclassified and still enters.
- The outbox consumer runs on a fiber-owned timer with per-message backoff and one `DISPATCH_REFUSED` alert; the pilot ships with no execution action types.
- The iteration agent writes through `iteration_context` and `iteration_propose`, bound to the attempt id, generation, and holder session.

## Verification

- `packages/faberloom/board/tests` 186 tests, `view` 193, `mcp-server`/`tool-faberloom`/`backup` 158, `ui-faberloom` 168, plus learning/autonomy/access: 817 tests green.
- New focused suites: `board-guardrails.spec.ts` (server class, FX, cache, timeout, access audit), the outbox-consumer cases in `board-effects.spec.ts`, and the restricted-projection case in `board-iteration.spec.ts`.
- `tsc -p tsconfig.host.json`, `tsc -p tsconfig.client.json`, and `verify-cordis-config` (230 files) pass.

## Deferred with a decision, not an unknown

- W-14/W-15 (bulk approval) stay out of the pilot by D-11.
- W-63 (Jev shadow) stays off by D-14.
- W-25 holds by absence: no signed URLs exist; documents are read through the service with the actor identity.
- W-94 requires a governance reclassification command before any N3/N4 ceiling is enabled (A-14).
- Saved filter views and an agent filter wait for a product decision and for the item to carry an agent (D-1).
