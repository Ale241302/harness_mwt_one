# Agent Note: A refused remote Mesa degrades the overview instead of blanking it

Status: implemented

English | [中文](2026-11-05-board-remote-refusal-degrades-overview.zh.md)

## Problem

The Espacios panel read `faberloomBoard.list` inside the same `Promise.all` that loads Spaces, Agents, Routines, and memory. When the central Mesa answered `401 UNAUTHENTICATED` — an expired board token, or a session the gateway could not identify — the whole overview rejected. Local Spaces and Routines, which do not touch the network, disappeared behind `faberloom: REMOTE_UNAVAILABLE — list failed on the remote board: la sesión no identifica email y tenant`. The message also hid the difference between an expired session and a transport failure: `BoardRemoteError` carried no `faberloom:` code, and the board folds every uncoded failure into `REMOTE_UNAVAILABLE`.

## Decision

`FaberLoomOverview` carries `boardError: string | null`, and the view reads the Mesa through a private `readBoard` that catches the failure, logs one warning, and returns an empty list with the message. Spaces, Agents, Routines, and memory keep loading. The Spaces panel renders one notice under the write feedback: an `UNAUTHENTICATED` code asks the person to sign in again; any other code says the remote Mesa could not be read and the rest of the Spaces still work.

`BoardRemoteError` prefixes its message with `faberloom: <CODE> — `, so the board's coded-refusal rule — propagate unchanged — applies to every remote failure. A 401 reaches the panel as `UNAUTHENTICATED`, not as `REMOTE_UNAVAILABLE`.

## Alternatives considered

**Retrying the read.** A revoked session never recovers by retry, and the panel would spin while still blank; the retry also hides the moment the session died.

**Answering from local rows in `on` mode.** That mode promises the remote is the only store, so a silent local answer would make a stale board look current, which is worse than an empty Mesa.

**Showing the raw gateway text.** It names internals and does not tell the person what to do next.

## Consequences

An expired session now costs the Mesa only. The panel still shows an empty Mesa, but `boardError` prevents that emptiness from reading as a valid, empty board. The board token still lives one hour with no refresh channel; the notice makes the failure actionable until a refresh path exists. A deployment that mounts no remote adapter keeps `boardError: null`.

## Verification

- `packages/faberloom/board/tests/remote.spec.ts`: a 409 and a 504 keep their exact messages with the code prefix.
- `packages/faberloom/board/tests/remote-mode.spec.ts`: a coded adapter refusal propagates unchanged; a transport failure still becomes `REMOTE_UNAVAILABLE`.
- `packages/faberloom/view/tests/workspace-board.spec.ts`: the overview keeps local Spaces and reports `boardError`.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: the Spaces screen keeps the list and shows the sign-in notice for `UNAUTHENTICATED`, and the transport notice otherwise.
