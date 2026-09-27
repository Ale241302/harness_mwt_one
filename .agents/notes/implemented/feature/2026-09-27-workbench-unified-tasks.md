# Agent Note: the Work bench aggregates tasks and works them in chat

Status: implemented

English | [中文](2026-09-27-workbench-unified-tasks.zh.md)

## Problem

The Work bench (`ctx.faberloomBoard`) listed only board items and could not remove them; a task could not be tied to the routine that runs it; and the two other queues a FaberLoom owner actually works — email drafts waiting to be sent and unread inbox mail waiting for an answer — lived only in the Email panel. Nothing turned a task into a conversation that already knew which task it was, and the MWT.ONE follow-ups (missing OC/PO/SAP, an expired phase, a missing operator, an expiring price list) had no home at all.

## Decision

The Work bench becomes one queue over several sources, with a source-agnostic "open chat" gesture, a routine link on board items, and an MWT.ONE scan that the agent performs through the `mwt` MCP.

- `FaberLoomBoard` items gain `routineId` (`setRoutine(ownerId, id, routineId | null)`), persisted in the `faberloom_board` domain with a nullable default so existing rows parse. `remove(ownerId, id)` permanently deletes an item.
- The `faberloomView` Remote exposes `deleteBoardItem` and `setBoardRoutine`, and `overview().board` / `boardDetail()` carry `routineId`.
- The panel reads three live sources — board items from `overview`, `emailDrafts()`, and `emailInbox()` (IMAP unread) — into one table with a source chip; drafts offer Send/Discard, unread mail offers Reply, and any row offers **Open chat**.
- **Open chat** (`runTaskChat`) creates a harness session, seeds it with a model-facing prompt that names the exact task (board item, draft, pending email, or the MWT review), and opens it. The task context is a prompt, not UI copy.
- The MWT.ONE source is a single **Scan MWT.ONE** task, shown only while the `mwt` MCP server is connected (`ctx.faberloomView.mwtStatus().servers`). Selecting it opens a chat seeded with the review rules; the agent uses `mcp__mwt__*` (`expediente_listar`, `expediente_obtener`, `documento_listar`, `expediente_phase_durations_get`, `expediente_avanzar_estado`, …) and files each follow-up as a board item through `faberloom_board_create`. "Omitir" is deleting the created board item.
- The mailbox gains two explicit write gestures, shared by the panel and the model: `ctx.faberloomInbound.markSeen` (`UID STORE +FLAGS (\Seen)`) and `moveToTrash` (`UID MOVE`, with a `COPY` + `\Deleted` + expunge fallback and a candidate mailbox list). `faberloomView` exposes `emailMarkSeen`/`emailTrash`; the tools `faberloom_mail_mark_read`/`faberloom_mail_trash` expose the same to the agent.
- Discarding mail records the sender and subject as an `email-trash` teaching; sent AI drafts were already recorded as `email` teachings. The voice profile and the discard patterns both grow from real actions, and `emailDraftWithAi` reads the voice examples.
- The Work bench resolves a task with **Approve and close** (approve the revision, then complete), which leaves the queue; completed and failed tasks are filtered out. Opening a task's chat seeds it with the `grill-me-lite` summary rule before it acts.
- The seed catalog ships a **Vigía de correo** routine: an `email` trigger runs an agent step that classifies each message (discard / answer / expediente) and an `mcp` step that, for an OC/PO/SAP mail, resolves the expediente through the `mwt` MCP. That routine is the live agent: it acts with nobody in the panel.

## Alternatives considered

**A host service that calls the MWT MCP directly and parses expedientes.** The tool signatures are known, but the exact response fields of `expediente_listar`/`expediente_obtener` are not in any shipped contract, so a host parser would be guessing against a live, RBAC-scoped service; the agent already holds the MCP tools and the same identity, so it parses defensively at the source.

**A segmented control with a separate inspector per source.** More chrome for the same rows. One table with a source chip keeps a single selection, inspector, and chat entry point.

**Auto-running the MWT scan on panel open.** The scan spends model and MCP calls; it stays an explicit, one-click task.

## Consequences

- An open conversation is no longer required to be closed before deleting a board task; the delete is permanent and immediate.
- Board items now depend on the `faberloom_board` record adding `routineId`; old rows read as `null`.
- The Work bench makes an IMAP read and a draft read on mount and after every write; a deployment without mail connections shows an empty Mail source rather than failing.
- MWT follow-ups surface through the agent, so their quality tracks the connected MCP tools; a missing tool is reported in chat instead of inventing a task.

## Testing

`packages/faberloom/board/tests/board.spec.ts` covers `remove`, `setRoutine`, and create-with-routine. `packages/client/ui-faberloom/tests/registration.client.spec.tsx` covers deleting a board task, sending and discarding a draft, listing an unread email to answer, and marking read / trashing a message. `packages/client/ui-faberloom/tests/task-chat.client.spec.ts` covers the seed (including the `grill-me-lite` rule) for every source and the failure path. `packages/faberloom/view/tests/email-actions.spec.ts` covers the mailbox writes and the learned discard pattern.
