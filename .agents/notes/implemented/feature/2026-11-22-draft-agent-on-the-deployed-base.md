# Agent Note: The draft agent runs on the deployed base without the upstream migration

Status: implemented

English | [中文](2026-11-22-draft-agent-on-the-deployed-base.zh.md)

## Problem

Editing a FaberLoom email draft was a one-shot action: the panel asked a model for new text, replaced the body, and kept no durable record of what changed. An agent that iterates on a draft needs a conversation that survives closing the editor, an exact revision it can compare-and-swap against, a restorable history, and tools that cannot reach any other draft or mailbox operation. A later work-in-progress branch implemented all of it on top of an unreviewed upstream migration that bumped `SESSION_FORMAT_VERSION` and changed harness APIs. That migration is not part of the deployed base.

## Decision

**Port only the draft feature onto commit `3c730ec969`.** `packages/faberloom/connections` owns numbered, owner-scoped draft revisions and the compare-and-swap update; `packages/faberloom/view` owns the draft RPCs, the bounded seed, the restricted Session, and the Space suggestion; `packages/faberloom/tool-faberloom` registers the four model tools; `packages/client/ui-faberloom` opens the Host-owned Session and exposes revision restore and explicit Space linking. The base Session format stays at version 3, and the domain storage form advances to v2 with `compatibleVersions: [1]`.

**Adapt at the seams instead of changing the base.** The Client refreshes the Session list and renames the binding before navigating, because the base has no use-and-discard Session reference. The base tools executor keeps its single-call `execute` method; the composition test calls it that way. `connections.sendDraft` keeps its optional revision argument, while the Remote `sendEmailDraft` requires it before the Host accepts a send. Draft-bound Sessions refuse the general `seedMailSession` path.

## Alternatives considered

**Bring the upstream migration and the feature together.** Rejected: it changes the Session log format, message sources, tool execution, subagent activation, and LLM request fields for every package, and the deployed base must keep running the current production composition.

**Keep `saveDraft` able to replace an existing draft.** Rejected: the feature's compare-and-swap only protects a write if the blind replacement path is gone. Existing tests and callers now use `updateDraft` with the reviewed revision.

**Leave the ported UI on a floating conversation.** Rejected: the base already opens real Sessions in the central Conversation, and the draft Session must be the one the owner reopens after a reload.

## Consequences

A draft now has one durable agent Session, an append-only revision history, and a Host-owned first seed. No draft-agent path sends mail or activates a lesson, and only four draft tools are advertised to a draft Session. The WIP recording of the draft snapshot is not portable: it is a version-4 Session, while the base reads and writes version 3, so the ported tree has no `snapshots/session/faberloom-draft` case.

## Testing

`pnpm run typecheck` passes. The focused Vitest run over `packages/faberloom/view`, `packages/faberloom/connections`, `packages/faberloom/tool-faberloom`, and `packages/client/ui-faberloom` passes 795 tests in 75 files, including the new draft RPC, composition, tool, revision, authority, and client suites.
