---
description: "Native product connections (ctx.faberloomConnections): the per-user IMAP and knowledge-backup settings the owner enters, independent of the MWT.ONE MCP; for users and maintainers of the FaberLoom Conexiones module."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-connections

English | [中文](README.zh.md)

## Summary

The connections service owns the integrations the owner configures for themselves: an IMAP mailbox and a knowledge-backup destination. They are FaberLoom's own data, stored per identity through `ctx.storageDomain`, and never an MWT.ONE MCP operation. The password is stored but never returned; `probe` checks the configuration for real, logging in over IMAP or writing to the backup destination.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.storageDomain` is present. The browser reads and writes it through `ctx.faberloomView.connections()`, `saveConnection`, `removeConnection`, and `probeConnection`.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomConnections` is a host-side service read by the browser panels: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the service never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The password is stored in the product domain.** There is no field-level encryption yet; at-rest protection relies on the host volume and on the encrypted backups. A managed secret store is deferred.
- **Only IMAP and backup destinations.** Mailbox synchronisation, calendar, and other providers are out until their modules land.
- **Remote backup destinations are not probed here.** `probe` reports that an rclone destination is checked by the backup flow instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The IMAP probe speaks the protocol directly over `node:tls`/`node:net` because the host has no IMAP client; it reads the greeting, sends `LOGIN`, and settles on the tagged reply, always destroying the socket.

</details>

**Runtime invariant:** No companion is published. The service holds no derived state: every read resolves the owner's rows from the storage domain at call time.
