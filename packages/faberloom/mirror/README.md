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
| `skillsRoot` | - | Owner skills root; defaults to `<home>/skills`. |
| `storagesRoot` | - | Root of the `single`-layout domain documents; defaults to `<home>/storages`. |
| `platform` | `FABERLOOM_MIRROR_PLATFORM` | Which side this process reports itself as; `desktop` unless the deployment says `web`. |
| `intervalMs` | - | Milliseconds between two cycles; defaults to 120000. |
| `debounceMs` | - | Milliseconds a local change waits before it is pushed; defaults to 3000. |

Every missing piece of wiring is named in the log, and the mirror then stays off. It never runs half-wired, and a failed cycle only logs: the next interval retries, so a gateway outage never breaks the Host.

Every cycle writes `<home>/mirror-status.json`: whether it is enabled and active, which wiring is still missing, the route and the account it talks to, how many cycles ran and how many failed, the last reason a request or a cycle was refused, and a count per domain and skill of the last document the peer answered. That document is the operator's one line, and `ctx.faberloomMirror.refreshStatus()` rewrites it on demand.

The internal credential is one shared secret the deployment sets on both sides (`FABERLOOM_MIRROR_KEY`): the gateway injects it into each child and compares it on the route, and the owner's `dsh` validates it on every mirror tool call. A deployment that prefers one key per account writes `<dataDir>/<id>/.mirror-key`, which the route reads before the shared value.

### Where the rows are read and written

A product domain opens lazily: `ctx.storageDomain.get(name)` answers `undefined` until its owning service first touches it, so a traversal that only asks the facility sees the handful of domains some other code happened to open and reports every other one as `domain-not-open` in a home that holds its records. `src/store.ts` answers for every mirrored domain instead: the open domain when the process holds one, whose in-memory state is authoritative and whose writes run on the domain's own write chain, and the medium's document otherwise — the very file that domain loads on its first open. A row written to the medium is read by a domain opened later, and a row written through an open domain is published by that domain as usual.

Creating a document needs the format version its owner stamps, and only the medium carries it: the document a peer sends names it per domain, and a domain neither side has materialized stays unaddressed and is reported instead of guessed.

### What it carries

`FABERLOOM_MIRROR_DOMAINS` in `src/domains.ts` is the transfer scope: agents, routines, work flows, spaces (including the captured Space memory), context, connections, grants, board, inbound, the MCP tokens, and the Space and session shares. A domain this process did not mount is reported as skipped, never read as empty, because the two homes keep different rows and an absent domain is not a deletion.

The `workspace` registry is deliberately outside that scope. A Workspace record names an absolute folder and the Session identities of the machine that created it, and the service that owns the registry builds its ordered view once when it opens and never adopts a row written beside it — the Workspace feed drops an id it never knew — so a carried row would name a folder that does not exist on the other side in a registry that ignores it. The Space is the product's travelling work area, and it carries its memory and context with it.

Skills travel as files: `$DSH_HOME/skills/<name>/SKILL.md` becomes one entry of the document's `skills` map. The deployment's own read-only catalogs (`/opt/skills-catalog/<role>`, `/opt/skills-shared`) are not mirrored, and neither is anything outside the owner's own skills root.

### Conflict rule

Each synced row has a journal entry holding two digests: the local value and the remote value as of the last sync that touched it. An incoming remote row is written only when the local side still holds what that sync left there and the remote value moved since then. A row both sides changed keeps the local value, is reported as `keptLocal`, and is pushed back. A row only the local side changed is pushed. A row the local side does not hold at all is written, which is how a first pull lands the other home's rows. A row this side never journaled lands when it is absent **or** when both sides already hold the same value: two homes that were filled independently record their agreement on the first cycle instead of sending every equal row back over the wire.

Local deletions are pushed as tombstones, and remote tombstones are applied, so a delete travels in both directions under the same rule.

A row the journal recorded as synced whose value is still local while the peer answered for that domain without it is pushed again: a medium rewritten from an older state loses rows the journal had already recorded, and re-sending them is what makes a cycle self-healing. A domain the peer could not read at all is not evidence of a deletion, and neither is a peer that never answered.

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
- **A Workspace registry entry does not travel.** Its folder and its sessions belong to the machine that created them; the Space is the travelling work area, and a Workspace is registered on each machine that holds the folder.
- **Skills are files, not rows.** A skill holds no journal entry beyond its content digest, so a bundle renamed on both sides keeps both names.
- **A non-JSON medium for a domain nobody opened is unreadable.** The store reads the medium's own `single`-layout document; a deployment that routes a mirrored domain to another medium reaches it only while a service holds it open.
- **A new document needs the peer's version stamp.** A row whose domain neither side has materialized is reported (`domain-not-open`) instead of being written with a guessed version, because a wrong stamp would refuse the domain's next open.
- **Wiring is read once, at load.** `consoleToken` and `gatewayUrl` come from the process environment, which the Desktop fills when it starts the harness, so a token the installation renews mid-run is picked up at the next start and not before.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`src/document.ts` owns the version rule, the route path, and the row and skill digests; `src/domains.ts` owns the transfer scope; `src/store.ts` owns the medium view (the open domain first, the medium's document otherwise) and `src/sync.ts` the storage-domain traversal over it that the product backup also uses. The document version is refused before any row is inspected, so an unknown format never reaches a write. `tests/medium.spec.ts` boots a test-only `cordis.yml` over the real JSON backend and pins the case the store exists for; `tests/store.spec.ts` pins every medium shape the store must refuse.

</details>
