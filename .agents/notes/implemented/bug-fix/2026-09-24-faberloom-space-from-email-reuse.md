# Agent Note: the Space action reuses a space and opens its session

Status: implemented

English | [中文](2026-09-24-faberloom-space-from-email-reuse.zh.md)

## Problem

The Email read modal's Space action created the space but the browser did not move into it: it stayed on the session that was already active (an unrelated workspace), so the newly created space looked created but unusable. Pressing Space again with the same subject created a second space with the same title instead of adding the new email to the existing record.

## Decision

`spaceFromEmail` matches an existing space by title and opens a session in whatever space results.

- **Reuse by title.** The remote lists the owner's spaces and picks the first whose title, trimmed and lower-cased, equals the requested name; when one exists it is reused, otherwise a space is created with the chosen agent. Reuse never overwrites the existing agent; the email body is remembered and its files attached in the matched space, so sending a follow-up about the same subject threads into the same space.
- **Return the workspace that was just registered.** The remote returns the `Workspace` object `ensureSpaceWorkspace` resolved, instead of re-resolving the space's workdir and looking it up in the registry by path. The re-lookup raced the registry: `registry.list()` did not yet contain the row `registry.create()` had returned, so `workspaceId` came back `null`, which the panel reads as "nothing to open" and leaves the active session untouched.

## Alternatives considered

**Name the space after the message id or timestamp.** It would never collide, but the same client thread would scatter across spaces and stop accumulating the record, which is the point of the workflow.

**Compare titles exactly.** A follow-up rarely reproduces the subject's spacing and case byte for byte, so exact comparison would still duplicate; trimming and folding case is the smallest rule that matches what a user sees as "the same space".

**Keep the registry re-lookup and fall back to a search.** Two reads of the same registry in one operation, with a fallback that hides the lag, is more code for a value the operation already holds; returning `ensureSpaceWorkspace`'s result is the direct fix.

## Consequences

- A space is now the stable key for a subject: repeated Space presses accumulate memory and files instead of creating duplicates, which also means two genuinely different emails that share a subject land in one space (intended for this workflow).
- The panel always receives a usable `workspaceId` when the workspace registry is mounted, so the Space action reaches the new session; a deployment without the registry still stores the email and reports `workspaceId: null`.

## Testing

`packages/faberloom/view/tests/space-from-email.spec.ts` covers a fresh space returning its new workspace id, a same-title press reusing the space (no `create`, memory and attachment written to the existing id), and the registry-absent path returning `null` while still creating the space.
