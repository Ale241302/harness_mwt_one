# Agent Note: Only the approved diff reaches a Git commit

Status: implemented

English | [中文](2026-11-07-approved-diff-only-application.zh.md)

## Problem

A knowledge proposal is approved in Mesa, but approval alone fixes nothing: the approved diff still needs a writer that cannot be induced to touch another path, apply against a newer base, follow a symlink, or commit twice after a crash. A single-file applier that resolves only one configured path also leaves the board's `archivo` as a second editable authority and does not carry concurrent approvals.

## Decision

**`apply` owns Git; `publish` adds object storage.** `FaberLoomPublication.apply(approval)` reads `itemId`, `revision`, `diff`, `artifactHash`, `motivo`, and `evidence` from the approved board item. It never accepts a repository path, a destination, or a commit to produce. `commitApplication` in `git.ts` resolves every path in the diff against `Config.inventory`, a server-owned list; an empty inventory fails closed with `PUBLICATION_INVENTORY`. `commitPublication` delegates to the same function with a one-path inventory, so the two entry points cannot disagree about validation.

**Pre-write revalidation is one guarded sequence.** Under `.git/faberloom-apply.lock`, the applier rechecks that `HEAD` is still the approved base (`PUBLICATION_BASE_STALE`), that each existing component of every destination is not a symbolic link (`PUBLICATION_SYMLINK`), that the work tree has no tracked changes (`PUBLICATION_WORKTREE_DIRTY`), and that every applied file stays under `maxBytes`. Rename, copy, mode-only, and binary sections are refused with `PUBLICATION_PATCH_INVALID` because they carry no `---`/`+++` header for the inventory to resolve. After applying, the staged path set must equal the inventory paths, every destination must resolve under the work tree, and a hardlink is refused. The diff text is passed to `git apply` as input; no command, commit hook, or shell expansion from the content runs, and the commit uses an empty `core.hooksPath` so `post-commit` cannot execute either. A lock held by a live process refuses with `PUBLICATION_LOCKED`; a dead holder's lock is reclaimed.

**Identity and diff digest make retries safe and changes reviewable.** A durable `applications` row is keyed by `itemId\0revision\0artifactHash` and stores the SHA-256 of the exact approved diff. A replay with the same diff returns the same receipt. A different diff under the same identity is `PUBLICATION_REQUEST_CONFLICT` and requires a new review. Before applying, the applier looks for its deterministic commit subject between the base and `HEAD`; a crash after the commit but before the row was written is reconciled to that commit instead of producing a second one. A base, inventory, path, symlink, work-tree, lock, or patch refusal is stored as `conflict`; infrastructure failures stay `failed`.

**The board item is the only editable source for the link.** `faberloomView.boardApprove` and `boardApproveWithEdits` call `applyApprovedKnowledge` after the board records the approval. That method reads `versionBase`, `cambio`, `motivo`, `evidencia`, and `artifactHash` from the durable item; it skips anything that is not `propuesta-conocimiento`, has no approved revision, or is N3/N4. A refusal from the applier is logged and leaves the approval intact, because the approval is a board fact and the application is a separate durable fact. The optional service is read through `ctx.get('faberloomPublication')`, so a composition without publication keeps approving.

## Alternatives considered

**Keep one applier per path and loop over files.** Multiple calls would each re-check the same work tree and could land between competing approvals; a partial loop leaves a multi-file proposal half applied. One lock around the whole diff keeps the commit atomic.

**Trust the board item's `archivo` as destination.** The item is user-editable content; the server inventory is not. Resolving against the inventory keeps a manipulated field from naming a new path while the approval identity stays the same.

**Compare the diff text instead of a digest.** The digest is what the durable row can compare after a restart, and it covers whitespace and line endings that an approval must treat as a change. The digest is stored before the work tree is touched.

**Recompute `HEAD` and accept whatever is current.** That silently applies an approval to a newer base. The stored revision must remain `HEAD`; a moved base is a conflict and a new approval.

**Roll back the board approval when Git refuses.** Approval and application are separate effects with separate durable rows; reverting the approval would destroy the human decision because of an infrastructure condition. The conflict is recorded and surfaced instead.

## Consequences

An approved multi-file diff becomes exactly one commit whose subject carries the item, revision, and artifact hash, and whose body lists every path. A competing approval either runs after the first and sees a stale base, or waits on the lock; only one commit lands. A crash after the commit is recoverable by identity, and a changed diff cannot reuse the old approval. The cost is that an application needs a configured inventory and a clean work tree, and a legitimate concurrent edit elsewhere in the checkout blocks it until the operator resolves the conflict. The Git applier refuses an empty inventory, so a deployment that never configures one cannot apply anything. A local writer that swaps a parent directory for a junction between the pre-check and `git apply` can cause a transient write outside the work tree; the post-apply real-path check detects and reverses it, so the zero-write guarantee excludes that race.

## Verification

- `packages/faberloom/publication/tests/application.spec.ts`: multi-file commit and retry reuse; durable row across a reopened composition; path outside inventory; file symlink and symlinked parent directory; stale base; two competing approvals in one process; two services sharing one work tree and one medium; a live lock holder refused and retried after release; foreign work-tree change; diff content not executed; a rename section smuggled beside an allowed hunk; a changed diff under the same identity; retry after a conflict; reconciliation of a commit that exists before the row. The expected tree lives in `tests/fixtures/application-expected` and the test compares the committed contents and paths against it.
- `packages/faberloom/view/tests/approvals.spec.ts`: approval forwards the durable diff and identity; an applier refusal keeps the approval; N3 items never reach the applier.
- `packages/faberloom/mcp-server/tests/mcp.spec.ts`: the publish tool refuses an N3 proposal and a reopened proposal before calling the publication service.
- `packages/faberloom/board/tests/board.spec.ts`: reopening an approved item clears its approved revision.
- `packages/faberloom/publication/tests/git.spec.ts` and `publication.spec.ts`: the single-path publication and object-store chain still pass through the shared applier.
- Pending: an external QA fixture prepared independently of the final tree; the test compares final contents and the resulting commit, not a third-party expected tree.
