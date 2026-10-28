# Agent Note: Iteration is one attempt, one lock, one draft

Status: implemented

English | [中文](2026-10-28-mesa-iteration-lock-and-draft.zh.md)

## Problem

The Mesa could not iterate. An item carried `iterationId`, `iterationLockGeneration`, `iterationLockUntil`, and `iterationDraftKey` from the E10 model, but nothing wrote them: no command opened a chat on the workspace of the item, nothing held a lock while a person worked, and nothing stopped a stale write from another tab from landing on the item.

Three failure modes shape the machine the spec asks for in §9.7.1. First, a write from a previous attempt, another tab, or an answer that arrives after the user left must never reach the item; the spec requires state, `iteration_id`, generation, and base version to agree, and requires a late answer to be kept as a draft of its own dead attempt (W-43, W-57). Second, no exit may decide on a pending candidate: Guardar y salir, Volver sin resolver, cancel without a choice, and lock expiry all leave it pending, and only an explicit adopt/keep changes the version (W-41, W-97). Third, a lock needs a deadline that means something on read: an `ITERANDO` item whose 15 minutes passed has to behave as Guardar y salir and offer its draft back (W-44), while a record written before this version of the service carries no deadline and must keep refusing edits.

## Decision

**The attempt is the lock subject, not the user.** `iterate` requires `PENDIENTE_CRITERIO` and a space (`NO_SPACE` otherwise, W-31), mints a new `iterationId`, bumps `iterationLockGeneration`, records `iterationBaseVersion`, writes `iterationLockUntil` from the resolved policy, and stores the tab session in `iterationLockBy`. The artifact version does not move (W-11). Two tabs of one user are two attempts: the second `iterate` is refused with `LOCK_LOST` and reads the first attempt instead of sharing it.

**One predicate decides whether a write may touch the attempt.** `attemptRejection(record, input, now)` returns `LOCK_LOST` when the item is not iterating or the deadline passed, and `ITERATION_STALE` when the named id or generation is not the current one; `requireAttemptBase` adds the base-version comparison. `renewIteration`, `pauseIteration`, `cancelIteration`, `applyIteration`, and the draft write all consult them before changing anything, so a stale write has no effect and no audit event (W-43, W-57).

**Expiry is derived on read.** `stateAfterExpiry` maps an `ITERANDO` record with a recorded deadline in the past to `PENDIENTE_CRITERIO`, and `stateOf` applies it for every read and command. `get` therefore returns a paused item with its draft, `approve`, `discard`, and `saveEdits` see the pause, and no read writes the item. A record with no recorded deadline counts as live, so rows written before this change keep refusing edits. The raw record keeps `ITERANDO` until the next command writes the item; that is recorded as a known limitation.

**The working draft lives in its own table.** `iteration_drafts` is keyed `<itemId>:<iterationId>` and stores the base version, summary, evidence, content, an `archived` mark, an `outdated` mark, and a `retainUntil` from D-09. The item links exactly one key. A write for an attempt that is no longer live is stored with `archived: true` and the item is not written at all (W-57). A fresh attempt archives the previously linked draft, so work written against an older version never reappears as the current draft. Retention is enforced on read and on resume.

**Each exit has one meaning.** `pauseIteration` covers Guardar y salir, Llevar a SpaceLoom, Volver sin resolver, and `lock-vencido`: it releases the lock, invalidates the attempt id, keeps the draft and any pending candidate, and returns to `PENDIENTE_CRITERIO` (W-67, W-97). `cancelIteration` deletes the draft and refuses with `CANDIDATE_PENDING` unless the caller names `adopt` or `keep`; `keep` leaves the version alone, `adopt` is the only version bump (W-41). `applyIteration` writes the next version and hash from the draft and the caller's overrides, records the learning scope on its audit event, consumes the draft, and refuses when a pending candidate is not named. `resumeIteration` takes a new attempt over the retained draft and, when the draft was written against an older version, marks it outdated and returns the differing fields instead of overwriting (W-68).

**The round counter is per item and only suggests.** `iterationRoundCount` rises on each applied attempt; `iterationStatus().suggestRewrite` turns true at `iterationRoundLimit` and nothing blocks (D-10).

**Four D-09/D-10 values are validated `Config` fields.** `iterationRenewalSeconds` (30), `iterationLockSeconds` (900), `iterationDraftRetentionDays` (30), and `iterationRoundLimit` (5) are parsed by the plugin row and exposed through `iterationPolicy()`, so the panel schedules from the deployment's numbers and no constant hides in the machine.

## Alternatives considered

**A separate lock table keyed by item.** It would let a sweeper read locks without scanning items and would keep the item record smaller. It lost because ADR-001 keeps state and audit in one record: a lock in a second table can disagree with the state that authorizes it, and `update` on the item is the only commit point the service trusts.

**Write the pause when a read finds an expired lock.** Persisting the pause from `get` would leave no raw `ITERANDO` row behind. It lost because a read would then mutate, emit domain-changed events, and turn a listing into a write storm on every expired item; deriving the pause is idempotent, and the next command persists the released fields anyway.

**Keep the draft fields on the item.** One record per item matches ADR-001 and needs no new table. It lost because a late answer for a dead attempt would either overwrite the live draft or need a second set of draft fields on the item, and cancel has to delete exactly one attempt's work without touching the recorded state.

**One generation counter per user session.** A per-session counter would let a user resume their own attempt without a new id. It lost because the spec makes the attempt, not the user, the lock subject: two tabs of one person are two attempts, and the generation has to belong to the attempt to tell them apart.

## Consequences

- Six new fields and one new table: `iterationBaseVersion`, `iterationLockBy`, `iterationRoundCount`, and `iteration_drafts`. Existing records load unchanged because every field carries a default.
- `iteration.ts` exports the machine as pure helpers over one record plus a clock; the service keeps authorization and the single `update` commit, and a reader can resolve the same phase the next write enforces.
- An expired attempt reads as paused but keeps `ITERANDO` in the raw row until the next command writes the item.
- A candidate resolved through `resolveCandidate` during an attempt still moves the version; the attempt then refuses with `ITERATION_STALE` rather than applying over it.
- The lock is serialized in one process by `KvTable.update` per item, not by a lease; a second writer process needs a real lease.
- Draft rows are never swept: retention is enforced when a draft is read or resumed, so the table grows until a sweeper owns it.
- `applyIteration` records the learning scope and stops there; the correction record is written by the view after the commit, and candidate creation and promotion stay in the learning work (T4.5–T4.7). The iteration Remotes the Mesa reads it through are recorded in [the Mesa iteration surface](2026-10-28-mesa-iteration-surface.md).

## Verification

`packages/faberloom/board/tests/board-iteration.spec.ts` proves each acceptance criterion it names: W-31 refuses an item without a space, W-10 refuses approval, discard, and edits during a live attempt, W-43 refuses a write with the previous attempt's generation, W-67 releases the lock and keeps the draft, W-97 keeps the draft and the pending candidate on Volver sin resolver, W-41 leaves a candidate untouched on expiry and on a keep choice, W-44 reads an expired attempt as paused and resumes its draft, W-68 returns the differing fields without overwriting, W-57 stores a late answer as an archived draft of its dead attempt, W-40 keeps an arriving artifact as a candidate of the same item, W-69 applies neither edits nor attempt on a conflict, and D-10 turns the suggestion true only at the fifth applied round. `npx tsc -b packages/faberloom/board/tsconfig.json`, `npx tsc -p tsconfig.host.json --noEmit`, `npx oxlint packages/faberloom/board/src packages/faberloom/board/tests`, and `npx vitest run packages/faberloom/board/tests packages/faberloom/view/tests packages/faberloom/mcp-server/tests packages/faberloom/tool-faberloom/tests` are green.
