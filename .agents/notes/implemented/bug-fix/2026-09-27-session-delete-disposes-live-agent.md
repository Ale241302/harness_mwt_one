# Agent Note: deleting an open session disposes its agent

Status: implemented

English | [中文](2026-09-27-session-delete-disposes-live-agent.zh.md)

## Problem

The [permanent Session delete feature](../feature/2026-09-25-session-delete.md) refused every Session live in `ctx.sessions` with `session/busy`, but nothing ever closed one. A Session becomes live as soon as its history is opened or a prompt is admitted, and `ApiSessionAgentController` discarded the `AgentHandle` that `ctx.agents.create`/`resume` returns. The Agent registry exposes disposal only through that handle, so once the controller dropped it the process held no capability to tear the Agent down, and the Session stayed live for the life of the process. A conversation the user had ever opened could therefore never be deleted: the Delete dialog always answered `session/busy`, which the user saw as "sessions are not deleted".

## Decision

`ApiSessionAgentController` retains the `AgentHandle` of every ordinary Agent it creates or resumes, and `SessionCommandController` disposes the live Agents it owns before removing their storage.

- `ApiSessionAgentController` keeps a `Map<SessionId, AgentHandle>` and `retainHandle()`s the handle at every activation site — the create and resume branches of `createOrAdopt`, `resumeObserved`, and the fork child creation in `SessionCommandController.fork`. `resolve()` still returns the bare `Agent` to callers.
- `ownsSession(sessionId)` reports whether this controller holds the disposer for a Session. `disposeSession(sessionId)` cancels, drains, unregisters, and detaches that Agent through `handle.dispose()`, then forgets the handle; a Session with no retained handle is left untouched.
- `SessionCommandController.removeAll` refuses first when any live id has no retained handle, then disposes every live id it owns, re-checks that none remain live, and only then deletes storage. A Session left live by another creator is still `session/busy`, and a Session that survives its disposal is refused before any storage is touched.
- `deleteOrphans` keeps skipping live Sessions: a bulk cleanup never closes a conversation the user may be reading.

## Alternatives considered

**Close the Session from the Client before calling delete.** The Web Host exposes no `session/close` Remote, and the Client cannot dispose a Host Agent. The Host is the only holder of the handle, and a Client-side close would race the delete that follows it.

**Add `AgentRegistry.dispose(id)` so deletion can dispose any id.** The registry deliberately exposes disposal only through the `AgentHandle` capability of the consumer that created the Agent; a by-id disposal would let any caller tear down an Agent it does not own.

**Stop activating Agents for history reads.** Background promotion needs a live Agent for the promoted observation, so the handle must be retained rather than avoided.

## Consequences

- Deleting an open Session now cancels any running turn and closes the conversation first; the delete no longer fails because the Session is live.
- `session/busy` remains for a Session whose Agent this controller does not own.
- The controller holds one disposer per live ordinary Agent until that Agent is deleted or superseded. Disposal is single-shot and idempotent, so a superseded handle is harmless.

## Testing

`packages/api/session-controller/tests/commands-delete.host.spec.ts` covers disposing an owned live Session before deleting, refusing an unowned live Session, refusing one that survives disposal, sibling ordering, and the `deleteOrphans` selection. `packages/api/session-controller/tests/agent.host.spec.ts` covers retaining a resumed handle and disposing it once.
