---
description: "Native product module (ctx.faberloomMirror) for keeping the desktop's local home and the deployed host's home carrying the same product rows and skill files."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mirror

English | [中文](README.zh.md)

## Summary

The deployment keeps one home per account under `/data/users/<id>`; the Desktop keeps `%USERPROFILE%\.dsh`. This package is the desktop half of the mirror between them. `ctx.faberloomMirror` pulls the deployed side's versioned transfer document at boot and on an interval, applies its rows into the local storage domains, writes the skill files it carries, listens to `domain/changed` for the mirrored domains, and pushes local changes with a debounce through the gateway's mirror route. The other half is `gateway/mirror-route.mjs`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `faberloom-app` bundle mounts this row disabled; a deployment turns it on and names its wiring through the environment:

```yaml
- id: faberloom-mirror
  name: '@deepseek-ai/dsh-faberloom-mirror'
  disabled: !!js process.env.FABERLOOM_MIRROR_ENABLED !== '1'
```

| Config | Environment | Meaning |
|---|---|---|
| `enabled` | `FABERLOOM_MIRROR_ENABLED` | Whether the mirror runs at all. Absent means off. |
| `gatewayUrl` | `FABERLOOM_MIRROR_URL` | Harness origin holding the mirror route. |
| `consoleBase` | `CONSOLA_API_BASE` | Console API base; `consola.<host>` derives `<host>`. |
| `ownerId` | `FABERLOOM_MIRROR_OWNER` | The signed-in account email. |
| `consoleToken` | `CONSOLA_TOKEN` | The console bearer token the Desktop wrote at sign-in. |
| `mirrorKey` | `FABERLOOM_MIRROR_KEY` | Internal credential the owner's product MCP server accepts. |
| `skillsRoot` | - | Owner skills root; defaults to `$DSH_HOME/skills`. |
| `intervalMs` | - | Milliseconds between two cycles; defaults to 120000. |
| `debounceMs` | - | Milliseconds a local change waits before it is pushed; defaults to 3000. |

Every missing piece of wiring is named in the log, and the mirror then stays off. It never runs half-wired, and a failed cycle only logs: the next interval retries, so a gateway outage never breaks the Host.

The internal credential is one shared secret the deployment sets on both sides (`FABERLOOM_MIRROR_KEY`): the gateway injects it into each child and compares it on the route, and the owner's `dsh` validates it on every mirror tool call. A deployment that prefers one key per account writes `<dataDir>/<id>/.mirror-key`, which the route reads before the shared value.

### What it carries

`FABERLOOM_MIRROR_DOMAINS` in `src/domains.ts` is the transfer scope: agents, routines, work flows, spaces (including the captured Space memory), context, connections, grants, board, inbound, the MCP tokens, the Space and session shares, and the workspace entities. A domain this process did not mount is reported as skipped, never read as empty, because the two homes keep different rows and an absent domain is not a deletion.

Skills travel as files: `$DSH_HOME/skills/<name>/SKILL.md` becomes one entry of the document's `skills` map. The deployment's own read-only catalogs (`/opt/skills-catalog/<role>`, `/opt/skills-shared`) are not mirrored, and neither is anything outside the owner's own skills root.

### Conflict rule

Each synced row has a journal entry holding two digests: the local value and the remote value as of the last sync that touched it. An incoming remote row is written only when the local side still holds what that sync left there and the remote value moved since then. A row both sides changed keeps the local value, is reported as `keptLocal`, and is pushed back. A row only the local side changed is pushed. A row the local side does not hold at all is written, which is how a first pull lands the other home's rows.

Local deletions are pushed as tombstones, and remote tombstones are applied, so a delete travels in both directions under the same rule.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing by itself. `ctx.faberloomMirror` registers no tools and writes no prompt text. Its model-visible surface is the two tools the native product MCP server publishes over it: `faberloom_mirror_export` returns a document, and `faberloom_mirror_apply` applies one.

#### Token effect

Zero direct tokens on every request: a cycle is an HTTP call, not a model call. The tools cost only what their JSON arguments and results cost when another agent calls them.

#### KV Cache effect

Independent of live requests: a cycle never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Whole-document requests.** Each cycle pulls the complete document and pushes the changed subset; a home with very many rows pays for the full read on every interval. Per-table pages are the next slice.
- **The deployment needs two lines.** The gateway must inject `FABERLOOM_MIRROR_KEY` into each child for the owner's `dsh` to accept a mirror call, and it must mount the route (`installMirrorRoute(app, { dataDir: DATA_DIR })`). Until then the mirror is off and says so in the log.
- **Sessions do not travel.** A session log is a per-cwd artifact; `faberloom-session-shares` is the path for sharing one, and the mirror does not carry them.
- **Skills are files, not rows.** A skill holds no journal entry beyond its content digest, so a bundle renamed on both sides keeps both names.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`src/document.ts` owns the version rule, the route path, and the row and skill digests; `src/domains.ts` owns the transfer scope; `src/sync.ts` owns the storage-domain traversal the product backup also uses. The document version is refused before any row is inspected, so an unknown format never reaches a write.

</details>
