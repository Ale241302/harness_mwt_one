---
description: "Shared Session catalog (ctx.faberloomSessionShares): a Space's Sessions captured on each member's host, published to and imported from the MWT.ONE console."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-shares

English | [中文](README.zh.md)

## Summary

The shared-Session catalog (`ctx.faberloomSessionShares`) makes a Space's Sessions visible to every member, not only the host that ran them. Capturing a local Session stores its portable snapshot under the Space and publishes it to the MWT.ONE console; syncing imports the rows other members published, so the owner sees a guest's Sessions and the guest sees the owner's. Every read requires `view` on the Space (owner, or an active grant). Records are durable through `ctx.storageDomain`, and the console is the cross-host transport.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limited)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.storageDomain`, and configure `consoleBase` and `consoleToken` (or leave them empty to fall back to `CONSOLA_API_BASE` and `CONSOLA_TOKEN`). `ctx.faberloomSpaces` and `ctx.faberloomShares` are optional and only enforce the `view` check. The service opens the `faberloom_session_shares` domain, registers `ctx.faberloomSessionShares`, and exposes `capture`, `list`, `content`, `remove`, and `sync`. `capture(actor, input)` stores one Session's portable snapshot under the Space and POSTs it to the console; `list(actor, spaceId)` returns the Space's rows; `content(actor, spaceId, ownerId, sessionId)` returns one row with its snapshot; `sync(readerId)` imports and prunes the console's rows for one member.

The console contract is `${consoleBase}/harness/sessions`: `POST` one `{ space_id, session_id, owner_email, title, workspace_id, created_at, updated_at, message_count, content }` row, `GET` for the caller's visible rows as `{ incoming: [...] }`, and `DELETE /{id}` to retract one.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomSessionShares` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limited"></a>

- **The console is the cross-host transport** — without it a member sees only its own captures; publishing and importing need the `${consoleBase}/harness/sessions` endpoints.
- **Content is a portable snapshot, not a live Session** — a shared row carries the captured snapshot JSON and is read-only; it is never imported into the local Session store, so it adds no sidebar Session.
- **A row is current to its last capture** — the author re-captures to publish new turns; there is no streaming push.

No invariant companion is published because the service's unit specs already assert the capture/list/content lifecycle, the `view` authorization, and the console import and prune.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Local captures are keyed `owner:<spaceId>\u0000<ownerId>\u0000<sessionId>`; imported rows are keyed `console:<readerId>\u0000<consoleId>` so `sync` prunes exactly the rows the console no longer carries for one reader. Authorization resolves the Space owner through `ctx.faberloomSpaces` and checks the `view` permission through `ctx.faberloomShares`; without either service the actor is trusted. The domain is opened lazily and closed with the calling fiber, like the other FaberLoom services.

</details>
