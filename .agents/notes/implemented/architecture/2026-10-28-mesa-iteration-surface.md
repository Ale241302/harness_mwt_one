# Agent Note: The Mesa iteration surface reads, renews, and records

Status: implemented

English | [中文](2026-10-28-mesa-iteration-surface.zh.md)

## Problem

The iteration machine shipped with a board that could take, apply, and release an attempt, and the Mesa showed the attempt's phase, its draft, and its doors. Three gaps kept that screen from standing on its own.

First, nothing renewed the attempt. D-09 signs a renewal every 30 seconds of activity and a 15-minute expiry, and no client renewed: real work lost its lock within a quarter hour, and the only way back was to reopen the item after the attempt had ended.

Second, the panel could not tell its own attempt from another tab's. §9.7.1 makes the attempt, not the user, the lock subject and requires a second tab to show the item in reading mode with the attempt's state; the projection the view returned carried the deadline but not the session holding it, so a second tab rendered the exits of an attempt it did not own.

Third, W-34 was half done. `applyIteration` recorded the chosen scope on its audit event and nothing reached the correction registry, so inline edits and applied iterations left no correction at all, and the learning package's `onCorrection` had no caller.

## Decision

**The view owns the iteration surface as ten Remotes.** `boardIteration` reads the attempt, `boardIterationContext` the pinned chat context, `boardIterationStart` opens one, `boardIterationSaveDraft` stores its work, `boardIterationApply` closes it with one new version, `boardIterationPause` covers the exits, `boardIterationCancel` discards the work, `boardIterationResume` reopens the retained draft, `boardIterationDraft` reads that draft with its differences, and `boardIterationRenew` extends the lock. Not one of them asks the client who the actor is or what it may do: identity, owner, company, and read-only arrive as deployment configuration, the board applies its own authorization before every read and write, and the panel derives no permission of its own. The panel decides what to offer from the attempt's phase and from the session that holds it; the board decides what is allowed.

**The chat context is pinned and minimised.** `boardIterationContext` returns the item id, title, account, space id and readable space title, version, summary, the working draft's summary, and the rounds. The board filters the item by owner and company, the spaces service filters the title, and no account history, space memory, or other item travels with it (§8.5). The panel hands that value to the task chat as the prompt it starts from, so the human never repeats what the item already says (W-32).

**The screen offers three exits and one apply.** The action bar of a live attempt carries Apply with its scope selector, Discard my changes, Save and exit, and Take to SpaceLoom; Leave unresolved sits inside the apply dialog. Each one releases the lock, invalidates the attempt id, keeps the working draft, and returns the user to the same item with the version it now has (W-33, W-67, W-97). A pending candidate blocks the apply until the human picks adopt or keep.

**This tab renews only the attempt it holds.** `boardIteration` projects `lockBy`, and the panel starts one timer on the projected `renewalSeconds` while the attempt is live, the lock names this tab's session (or names none), and the document is visible. It clears when the attempt ends and when the panel unmounts. A renewal refused with `LOCK_LOST` or `ITERATION_STALE` means the attempt ended elsewhere: the panel keeps the stored draft, drops the local mirror, shows the pause message, and re-reads the item, and a renewal never writes the artifact.

**Another tab's attempt reads and offers no door.** When the lock names another session the item renders read-only: the draft area and the severity and space controls stay disabled, one notice says another tab is iterating the item, and the exits are neither rendered nor opened by the keyboard, so this tab cannot overwrite the other tab's work. There is no cross-panel jump; the notice is the whole affordance. The board still enforces state, id, generation, and base version, so the rule is a courtesy on top of the refusal, not a replacement for it.

**The view bridges both corrections, best effort.** After a successful apply it calls `onCorrection` once with origin `iterate`, the chosen scope, the attempt's stored summary as the instructions, the fields where the applied version differs from the item the panel read as the diffs, the round count, and the item's lineage, data class, and fields used. After a successful `boardSaveEdits` it calls `onCorrection` once per changed field with origin `edit`, scope `puntual`, that field's previous and next value, and the item's classifications. Both run after the board commit, so both are best effort: a failure returns a message for the panel's one-line write feedback and never fails or reverses the command, which means a correction may be missing while the item is committed. The view creates no candidate; the learning package decides that from the scope, and a provisional data class records the correction without feeding a derived product (D-10).

## Alternatives considered

**Renew from the host on a schedule.** A server-side sweeper extending every live attempt would survive a closed tab and needs no client timer. It lost because D-09 signs renewal with activity: a lock extended without a reader keeps an abandoned attempt alive for as long as the process runs, and the panel already knows when the document is visible and when the attempt is its own.

**Let the panel derive who may iterate.** Passing the actor or a permission flag with each Remote would let the screen hide controls by role. It lost because the identity rule is that the gateway injects the owner and a client never names it, and because a client-side permission check is a suggestion the board would still have to repeat.

**Send the correction before the board command.** Writing the correction first would let a failed commit leave a correction for a change that never happened. It lost because the artifact is the fact: the commit comes first, and a correction that cannot follow it is reported, not invented.

**Record one correction per save instead of one per field.** A single record carrying a field list would be smaller. It lost because the registry's edit payload names one field with its previous and next value, and the maturity report counts edited fields from those records.

## Consequences

- `FaberLoomBoardIteration` carries `lockBy`; the panel compares it with the session it opened the attempt with, and an attempt that names no session reads as this tab's own.
- `boardIterationApply` answers `FaberLoomBoardIterationApplyResult` and `boardSaveEdits` answers `FaberLoomBoardEditResult`, each carrying `correctionError` beside the committed value, so a correction that failed is never confused with a command that failed.
- Four locale keys carry the other-tab notice and its sentence, the pause after a lost lock, and the correction line, and no panel string is hardcoded.
- An applied iteration's correction carries the draft's summary as its instructions; an attempt that stored no summary and applied no summary cannot describe itself, and the registry refuses that correction, which the panel reports.
- The view reads the item and the retained draft before each apply and the item before each edit to diff them; a read that fails costs the correction's detail and never the command.
- The renewal interval comes from `iterationStatus().renewalSeconds`, so the panel keeps no copy of the D-09 value.
- A second tab cannot take the attempt over: it reads until the first tab exits or the lock expires, which the board treats as Save and exit (W-44).
- The tab session lives in `sessionStorage`, so returning from the iteration chat to the Mesa keeps the attempt this tab opened its own instead of reading as another tab's; resuming names that session too, so a reopened attempt is never anonymous.

## Verification

`packages/faberloom/view/tests/board-iteration.spec.ts` proves the view half: the projection carries `lockBy`, a renewal forwards the attempt id and generation and answers the attempt, the apply records one `iterate` correction with its scope, instructions, diffs, rounds, lineage, data class, and fields used, a provisional class travels with it, a save records one `edit` correction per changed field with its previous and next value, a field written with the value the item already carried records nothing, a refused correction still answers the committed attempt and the committed detail with its message, and a read-only identity is refused every iteration write.

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` proves the panel half: the timer renews with the attempt id and generation on the projected cadence, a `LOCK_LOST` renewal returns to the paused state with its draft and never saves the item, another tab's lock renders the item read-only with one notice and no exit while no renewal or write is attempted, and a failed correction lands on the one-line message after both the apply and the save.

`apps/web/tests/mesa-panel.e2e.ts` proves both over the assembled product: saving the draft records the `edit` correction with the item's summary before and after, and applying the iteration with scope `cuenta` records the `iterate` correction with its instructions, its diff, one round, and the item's tenant, space, account, and data class. `npx tsc -p tsconfig.host.json --noEmit`, `npx tsc -p tsconfig.client.json --noEmit`, `npx tsx scripts/verify-client-ui-i18n.ts`, `npx vitest run packages/client/ui-faberloom/tests packages/faberloom/view/tests`, and `DSH_SNAPSHOT=replay npx vitest run --config vitest.web.config.ts apps/web/tests/mesa-panel.e2e.ts` are green.
