---
description: "Native product module (ctx.faberloomBackup) for knowledge export, restore, integrity, and migrations in this DeepSeek Harness build."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-backup

English | [中文](README.zh.md)

## Summary

This package carries knowledge export, restore, integrity, and migrations. It registers the `ctx.faberloomBackup` host service, which snapshots the open FaberLoom storage domains into one durable, integrity-checked backup and restores them. A backup is a canonical, deterministic JSON payload plus a manifest of per-domain and per-table record counts and sha256 digests; the payload digest is the integrity anchor, and a restore refuses a payload that no longer matches.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomBackup`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomBackup` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Domain-level, not signal-level.** The snapshot reads every record of the declared domains open in the process. Encryption at rest and off-host retention are owned by the platform backup (gpg and rclone), not by this service; a snapshot stored on the harness volume is only as durable as that volume.
- **No UI or scheduled surface yet.** `ctx.faberloomBackup` is a host-side service: `createBackup`, `listBackups`, `verifyBackup`, and `restoreBackup` are called by a host consumer. Wiring the Conexiones surface and the recurring run arrives on a later slice.
- **Upsert restore.** Restore writes records back with `put`; it does not reconcile effects already produced against external systems, and it does not version the destination domains.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
