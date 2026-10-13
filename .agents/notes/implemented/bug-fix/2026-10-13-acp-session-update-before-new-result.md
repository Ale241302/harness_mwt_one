# Agent Note: the ACP bridge publishes a session only after its result

Status: implemented

English | [中文](2026-10-13-acp-session-update-before-new-result.zh.md)

## Problem

`AcpSession.newSession` stored the record in the bridge's live-session map before it discovered the session's configuration options, so the map entry existed while the `session/new` response was still unwritten; `resumeSession` did the same for `session/resume`. `LlmRuntime.registerConfigurableProviders` emits `llm/adapters-updated` synchronously from its directory commit, and the shipped `llm-pi-ai` plugin commits a dormant configurable-provider directory at boot. That event makes the bridge call `topologyChanged()` on every mapped record and push a `config_option_update`. A commit that landed inside the activation window therefore sent a session-scoped update for a `sessionId` the client had not received yet.

The defect is a race, not stable drift: it appeared in four scenarios of a cold, full-file concurrent ACP snapshot run and zero times in fifteen isolated serial runs, and disabling `llm-pi-ai` removed it in every full concurrent run. The wire symptom is a client receiving `session/update` for a session it cannot address — every `session/prompt`, `session/set_config_option`, or `session/close` for that id fails until the result arrives. The premature entry is broader than the update: map membership is the bridge's only "the client knows this session" claim, so `session/event` routing, `requireSession`, the permission answerer, and `session/list` filtering all treated an unannounced session as known.

## Decision

`newSession` and `resumeSession` insert the record into `sessions` only after `record.configOptions()` settles, immediately before returning the result. The result already carries those settled options, so a topology commit that the read absorbs is delivered in the response instead of as an early update; no state is lost. The failure paths drop their `sessions.delete` because the record is never published before the result.

## Alternatives considered

**Guard `topologyChanged()` while a session is still activating.** Rejected. It patches one symptom while leaving the map entry itself wrong: the record would stay mapped for the whole activation, so `session/event` routing, `requireSession`, the permission answerer, and list filtering still treat an unannounced session as addressable. It also needs a second activation flag consulted by a global listener, and that flag must be cleared at the true client-known boundary — the transport write after the handler returns, which the bridge does not observe — so it either reopens the race when cleared early or suppresses a legitimate later topology update when cleared late. Moving the insert makes map membership mean "the client has been told" at a single commit point.

**Change the emitter timing in `packages/llm`.** Rejected as the wrong owner. `registerConfigurableProviders` publishing a synchronous topology event from its commit is correct for that registry; the fault is the bridge acting on a session it has not announced. Making the emitter asynchronous would hide the same premature-publication class elsewhere and change an unrelated package's contract.

## Consequences

- A client never receives a `session/update` for a session before that session's `session/new` or `session/resume` result.
- A topology commit the config-options read observes is folded into the returned `configOptions`; a commit that lands after the read is not separately pushed, exactly as any commit that lands around a response — the next topology change carries it.
- Each session now has one publication point, so every map reader agrees with what the client has been told.

## Testing

`packages/acp/acp/tests/bridge.spec.ts` holds the config-options read open, commits a configurable-provider directory so `llm/adapters-updated` lands inside that window, withholds the durability barrier so the result cannot be written, and asserts through the connected SDK client that no `config_option_update` reached it before the result. A second test drives the same emitter against six concurrent activations. Both fail against the pre-fix insert order and pass after it.
