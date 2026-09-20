# Agent Note: FaberLoom backup captures the durable domains

Status: implemented

English | [中文](2026-09-20-faberloom-backup.zh.md)

## Problem

`ctx.faberloomBackup` was a registered service with no behaviour: the plan's backup slice (E8) asks for export, restore, and integrity over the product's knowledge, and the package README admitted it carried no durable records. Without it the product had no way to snapshot spaces, agents, routines, executions, teachings, grants, connections, or the MCP tokens — only the infrastructure's volume backup existed, and a restore could not prove the payload it read was the payload it wrote.

## Decision

The service owns one durable domain and snapshots the other product domains through the storage-domain facility.

`packages/faberloom/backup` declares `faberloom_backup` (one `backups` table) and a fixed manifest of the nine product domains and their tables. `createBackup(ownerId, options?)` reads each open domain through `ctx.storageDomain.get(name)`, copies every table's records, and writes one row holding the canonical JSON payload, a manifest of per-table record counts and sha256 digests, the payload digest, and an optional note. `verifyBackup` recomputes every digest from the stored payload, and `restoreBackup` refuses a payload whose digest no longer matches before it writes anything; a restore upserts each record through `table.put` and reports domains the process does not have open instead of failing. `listBackups`, `getBackup`, and `deleteBackup` complete the surface.

The domains are read through the facility's diagnostic `get` surface rather than per-service export methods, so one module covers all nine without a bespoke contract on each; the table names are the fixed manifest in `spec.ts`. Encryption at rest and off-host retention stay with the platform backup (gpg, rclone).

## Alternatives considered

- **Per-service export/import methods.** Each service owns its domain and could answer a typed snapshot. Rejected for this slice: nine contracts to keep current, and the learning service's existing `exportKnowledge` already shows the duplication a generic read avoids.
- **A second storage backend for snapshots.** Rejected: the domain form already gives durability and schema validation, and a snapshot is ordinary record data.
- **Encrypting the payload in the service.** Rejected: the deployment already encrypts the volume copy, and a second key-management surface inside the product adds cost without a consumer; the README records the boundary.

## Consequences

- A snapshot is integrity-checked end to end, and a tampered payload is refused before any write, so a restore cannot silently reintroduce corrupted knowledge.
- The service captures domains that are open; a domain whose plugin is unmounted is omitted from the manifest, which is visible in `listBackups` rather than silently empty.
- Restore upserts records; it does not reconcile effects already produced against external systems, and the deferred slice wires the Conexiones surface and the recurring run.
