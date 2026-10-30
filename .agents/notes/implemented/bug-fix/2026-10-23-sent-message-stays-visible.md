# Agent Note: A sent message stays visible until its durable row arrives

Status: implemented

English | [中文](2026-10-23-sent-message-stays-visible.zh.md)

## Problem

In the web and desktop chat, a message sent into a fresh or idle session disappeared from the transcript during the first-token wait. It reappeared only when the turn started logging — first the context-injection rows, then the durable user bubble. While the provider was still working, the reader saw the turn status (“Explorando a fondo…”) over an otherwise empty conversation and could not tell whether the message had been sent.

The Chat view renders a local submission echo until its durable counterpart arrives, and hides it when `observedRpcIds` reports the request id as observed. That set included every queue occurrence, not only durable user nodes. The session controller had the same rule: `observeSubmissionQueue` retired any echo whose prompt appeared in the Host inbox. As soon as the Host listed the accepted prompt as a queued occurrence — before the turn wrote its `user/message` event — the echo was removed from the snapshot, leaving a window with neither the echo nor the durable row.

## Decision

**Only durable evidence retires a transcript echo.** `observedRpcIds` adds a request id from a durable `user` or `steering` node, or from a queue occurrence whose placement is `steering`. A queued occurrence alone no longer hides the echo. The session controller applies the same rule: `observeSubmissionQueue` skips an echo whose placement is `transcript`, because that echo has no other visual home; a `queued` or `steering` echo still retires when its inbox occurrence arrives, since the queue dock or pending-steering row already renders it.

**Steering keeps its immediate handoff.** A steering occurrence already carries the same content in the pending-steering row, so it retires the local echo exactly as before; otherwise the two would render side by side.

## Alternatives considered

**Render queued echoes in the transcript as well.** Rejected: the Queue dock already owns queued occurrences, and rendering both would show one sent message twice.

**Change the Host to delay the queue projection until the durable event.** Rejected: the queue projection is legitimate and drives the queue dock; the renderer was drawing the wrong conclusion from it.

**Only adjust follow-scroll.** Rejected: the first reproduction had an empty transcript below the status, not a bubble parked out of view. Scrolling would not create a row that the filter had removed.

## Consequences

A sent message is visible from the click through the first token, then the durable bubble takes over with no gap and no duplicate. A queued message beyond the running turn continues to live only in the Queue dock; its transcript echo was never placed there in the first place.

## Testing

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` covers a transcript echo whose request id appears only in a queued occurrence: the echo remains visible, then exactly one bubble remains after the durable user node arrives. `packages/api/session-controller/tests/session-pending-submissions.client.spec.ts` pins the snapshot side: an idle transcript echo survives a queue frame and retires only on the durable prompt event, while a running-turn queued echo still retires from its inbox occurrence. The existing steering-handoff and queued-echo cases remain green.
