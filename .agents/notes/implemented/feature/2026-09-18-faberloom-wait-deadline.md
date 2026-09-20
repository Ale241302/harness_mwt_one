# Agent Note: a routine wait carries a deadline

Status: implemented

English | [中文](2026-09-18-faberloom-wait-deadline.zh.md)

## Problem

A step that parked on `waitFor` could wait forever. If the reply never arrived — the client never answered, the follow-up came from a mailbox nobody polls, the person forgot — the execution stayed `waiting` with no signal, no review, and nothing on the panels to distinguish "still expecting an answer" from "this case is dead". The plan asks a persistent dispatcher to reconcile timeouts, and the execution record carried no instant to compare against.

## Decision

An execution that parks records when the wait stops being reasonable, and the dispatcher honours it.

`packages/faberloom/routines` gains a validated `Config.waitTimeoutMs` (default one day, refused below a minute) and one engine operation, `expireWaits(now)`. When `runSteps` parks a step on `waitFor`, the record gets `deadlineAt = now + waitTimeoutMs`; a reply clears it, and completion, failure, and revalidation do too. `expireWaits` moves every `waiting` execution whose `deadlineAt` has passed to `needs_review`, marks the waiting step failed with `WAIT_TIMEOUT`, and clears the field — so a later pass cannot expire the same case twice.

`packages/faberloom/execution` calls it as the fourth step of its pass, after tick and reconcile, and reports the ids in the new `DispatchReport.expired`.

The durable change is one optional field on the execution record, `deadlineAt: string | null`, declared with `.default(null)`. Rows written before the field read back as null, so the table keeps schema version 1 and the persistence gates keep passing; the product domain is not a released session format, so no persistence-change acknowledgement is required. The panels read it through `executionRow` and show the time beside the wait.

## Alternatives considered

- **A timeout declared per step.** More expressive, and the right end state: it needs a field on the routine step schema (both the routine record and its versions), an editor control, and its own migration story. A deployment-level default answers the report this slice exists for.
- **Expiring inside `tick`.** Rejected: `tick` takes events and answers with what it resumed; a timeout is not an event, and two causes in one operation would make the panels and the tools unable to tell them apart.
- **Marking the execution `failed`.** Rejected: nobody answered, which is not the routine failing at its work. Review is where a person decides, and it is what the failure policy of most steps already means.
- **Retrying the wait or renaming the notification.** Rejected for now: a retry needs a notification channel this product does not have yet, and a deadline that never escalates is the bug this fixes.

## Consequences

- A case whose reply never arrives reaches `needs_review` on its own, with `WAIT_TIMEOUT` as the reason and the waiting step failed, so the panel shows a case that needs a person instead of one that looks patient.
- The deadline is deployment policy, not per routine: shortening it to catch lost replies sooner also expires legitimate long waits. A step override is the deferred work.
- Expiry does not re-notify anyone; it surfaces the case where the owner already looks.
- `DispatchReport.expired` makes the expiry visible to whatever drives passes, including a deployment that calls `runOnce` itself.
