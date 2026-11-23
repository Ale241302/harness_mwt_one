# Agent Note: an enabled MCP server mounts after the credential seam, and an unmounted one stays visible

Status: implemented

English | [中文](2026-11-23-mcp-boot-waits-for-credentials.zh.md)

## Problem

The MCP registry mounted every enabled saved server while it applied. Mounting resolves the server's stored credential references, and `credentials` was not one of the plugin's dependencies. On a process start where the credential seam had not registered yet, every enabled server failed to mount with "the credential ... is not configured". The record stayed enabled and the failure was recorded, but the Correo panel filtered `server.mounted` and hid the account completely. The server only came back after someone saved it again, because a save mounts after the seam is ready. A container restart therefore removed the MCP inboxes until a manual save.

## Decision

### Boot waits for the seam

`apply` mounts synchronously when `ctx.get('credentials')` already resolves, and otherwise registers `ctx.inject(['credentials'], () => boot())`. The service is published either way, so callers can list and edit records while the seam is absent. Boot skips a record that is already mounted, so a later seam registration cannot create a second fiber for the same server.

### `mounted` means the tools exist

`mount` publishes the entry in `mounts` after `await fiber`, not before. A server whose client is still connecting is not reported as mounted, and `callTool` cannot race the registration.

### Unmounted servers stay visible

The inbox page and the mailbox groups read every enabled server, not only the mounted ones. An unmounted server becomes a failure entry carrying its recorded error, so the account appears in the rail with a reason instead of disappearing. A server whose mailbox discovery fails already behaved this way; this extends the same rule to the mount itself.

## Alternatives considered

**Add `credentials` to `inject`.** Rejected: compositions without a credential seam are supported and tested, and a required dependency would leave the plugin pending forever instead of reporting "no credential service is mounted" on a save.

**Retry the mount on a timer.** Rejected for this change: a silent retry policy hides the failure and adds a timer to every process. The boot dependency and the visible failure cover the real case.

**Keep filtering `mounted` and log instead.** Rejected: the account still disappears from the only surface where the owner could act on it.

## Consequences

An enabled MCP server mounts on process start as soon as the credential seam is available. A server that cannot mount is visible with its reason, and the owner can fix the credential or re-save it. The mount map and the reported state now agree with the tool registry.

## Testing

`vitest run packages/faberloom/mcp-registry/tests/mcp-registry.spec.ts`: 37/37, including a new case where the credential seam arrives after the registry and the seeded server mounts. `vitest run packages/faberloom/view/tests`: 321/321. `tsc -b` for both packages and `oxlint` return 0.
