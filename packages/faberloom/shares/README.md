---
description: "Native product sharing (ctx.faberloomShares): durable per-action share grants on Spaces and Work Flows with emailed acceptance, console transport, and revocation."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-shares

English | [中文](README.zh.md)

## Summary

The sharing service (`ctx.faberloomShares`) owns durable, per-action grants on Spaces and Work Flows. An owner grants named emails a permission subset; the grantee is notified through the owner's own SMTP connection with an acceptance link, and a grant authorizes an action only once it is active. Cross-user shares publish to the MWT.ONE console and import into the grantee's process; revoking removes the console mirror. Spaces and Work Flows consult the service for each read and manage check.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.storageDomain`, and configure `consoleBase`, `consoleToken`, and `acceptBase` (or leave them empty to fall back to `CONSOLA_API_BASE`, `CONSOLA_TOKEN`, and the console base). The service opens the `faberloom_shares` domain, registers `ctx.faberloomShares`, and calls `ctx.get('faberloomConnections')` to email a grantee. `create(ownerId, input)` stores a pending grant, publishes a portable snapshot to the console, and sends the acceptance link; `accept(grantee, id)` flips it to active; `revoke(ownerId, id)` revokes it and deletes the console mirror; `list`, `permissionsFor`, and `can` drive the panels and the enforcement checks; `sync(grantee)` imports the console's incoming grants and prunes revoked ones.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomShares` is a host-side service: it registers no tools, injects no prompt text, and writes no session events. The opt-in `faberloom_workflows_share/_revoke/_permissions` tools live in `dsh-tool-faberloom`.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The console is a transport seam** — publishing and importing need the MWT.ONE console endpoints; without them the service stays local and email-only.
- **Acceptance is an explicit call** — the emailed link is handled by the console, which flips the grant to active; the local `accept` exists for the same-process and test path.

No invariant companion is published because the service's unit specs already assert the permission matrix and the lifecycle.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The permission set is closed (`SHARE_PERMISSIONS`). `can` allows the owner unconditionally and a grantee only through an `active` grant; a `pending` grant authorizes nothing, which is what the acceptance step exists for. The portable snapshot travels inside the grant row so an imported grant materializes without a second read.

</details>
