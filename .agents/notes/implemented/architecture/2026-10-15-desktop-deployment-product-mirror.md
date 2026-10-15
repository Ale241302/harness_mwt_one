# Agent Note: The desktop and the deployment mirror each other's product data

Status: implemented

English | [中文](2026-10-15-desktop-deployment-product-mirror.zh.md)

## Problem

The Desktop starts its own harness, so it keeps its product rows under `%USERPROFILE%\.dsh`; the deployment keeps one home per account under `/data/users/<id>` and its gateway boots one `dsh` per owner. The two homes are separate storage-domain volumes with no federation between them, so an agent, a routine, a Space, or a skill created on one side simply does not exist on the other. The former MWT.ONE mode hid the gap by making the window a client of the deployment, which is exactly the mode the sign-in rework removed ([decision](2026-10-15-desktop-launch-backend-and-sign-in-card.md)).

Everything the two sides need already existed. Every persistent product row is a `(domain, table, key) -> JSON` tuple reachable through `ctx.storageDomain`, which the product backup already traverses; skills are files under `$DSH_HOME/skills/<name>/SKILL.md`; the gateway already runs one `dsh` per owner and already reverse-proxies to it; and the native product MCP server already listens on `<DSH_HOME>/faberloom-mcp.sock` with a bearer credential of its own. The Desktop, for its part, already writes the console token it obtained at sign-in into `$DSH_HOME/.env` and boots its child with `CONSOLA_API_BASE` and `CONSOLA_TOKEN`, so the local side already holds a credential the gateway also knows for the same account.

What was missing was the transfer itself and the rule for two live writers.

## Decision

**One versioned transfer document carries rows and skills.** `FABERLOOM_MIRROR_FORMAT_VERSION` is checked before any location is inspected, so a document this build does not understand is refused without a write. Rows travel as `{domain: {table: {key: {deleted, value}}}}`, which is the same generic tuple walk the product backup performs, plus the tombstone rule a live mirror needs and a snapshot does not; skills travel as `{name: SKILL.md text | null}`.

**The mirror scope is its own list.** `FABERLOOM_MIRROR_DOMAINS` in `packages/faberloom/mirror/src/domains.ts` restates the backup's domains and adds the ones a snapshot omits: work flows, context, the Space shares, the session shares, the Space memory table, and the workspace entity. A snapshot scope and a mirror scope are separate product decisions, so the mirror states its own rather than inheriting the backup's. A domain a process did not mount is reported as skipped, never read as empty, because the two homes hold different rows and an absent domain is not a deletion.

**The gateway route is a new module, not a slice of `server.mjs`.** `gateway/mirror-route.mjs` exports `installMirrorRoute(app, options)`; the caller mounts it with one line. The route authenticates the Bearer console token against the gateway's own per-user state file by default (a caller with another store passes `resolveOwner`), refuses a request whose claimed owner is not the token's, resolves the internal credential, parses its own JSON body so it needs no mounted parser, and forwards a JSON-RPC `tools/call` to `<home>/faberloom-mcp.sock`. Nothing in the module reads product data itself.

**The dsh side is reached through two new MCP tools.** `faberloom_mirror_export` and `faberloom_mirror_apply` are catalogue entries in the native product MCP server, implemented by `ctx.faberloomMirror`. The service is mounted as its own bundle row, disabled unless the deployment enables it, so an installation that never mirrors carries the service inert and the gateway's own profile answers the tools with a readable refusal instead of a silent no-op.

**The internal credential is one shared secret.** `FABERLOOM_MIRROR_KEY` is injected into each child by the deployment and set on the local side; the route also reads a per-owner `<home>/.mirror-key` when a deployment provisions one key per account. This is the only value a deployment has to set on both sides, and the mirror stays off with a loud log when it is absent.

**The conflict rule is a two-value journal, not a timestamp.** Each synced row records the digest of the local value and of the remote value as of the last sync that touched it. An incoming remote row lands only when the local side still holds what that sync left there and the remote value moved since. A row both sides changed keeps the local value, is reported as `keptLocal`, and is pushed back. A row the local side does not hold at all is written, which is how a first pull fills an empty local home. Local deletions push tombstones and remote tombstones are applied, so deletes travel in both directions under one rule. Wall-clock comparison would have needed clock agreement between a user's PC and a container, which no part of this repo can assume.

**Skills are files and the read-only catalogs are not mirrored.** A skill bundle's Markdown crosses as text, and its name is validated against the harness skill-name rule before a path is built. The deployment's own catalogs (`/opt/skills-catalog/<role>`, `/opt/skills-shared`) are installer-provided content, not owner rows, so they stay out of the document.

## Alternatives considered

**Two `@Remote` methods on `faberloomView`.** The view is the browser's read face; a mirror is a host-to-host transport with its own credential, and routing it through the client Remote would have put a machine credential on a wire built for browser sessions.

**Reusing the MCP bearer tokens for the internal credential.** Those are owner-minted, stored in the product's own domain, and revocable from a panel. The gateway is a different caller with a different trust level, so it gets its own credential rather than sharing the owner's.

**A per-row timestamp or vector clock.** Two untrusted clocks and a field on every record was more machinery than the journal needs: the journal answers the same question from two digests the service already computes.

**Pushing every row the local side holds, and deleting every row it lacks.** A local row the remote never had would be created everywhere, and a row the remote holds and the local side never synced would be deleted on the first cycle. The journal bounds both directions to rows one side actually changed.

**Editing the desktop identity patch to mount the row.** The row belongs to the `faberloom-app` bundle, which both the deployment and the desktop mount; the desktop sign-in patch configures per-user values, not the composition.

## Consequences

An agent, routine, Space, memory entry, connection, work flow, or skill created on either side reaches the other within one cycle, and a change made on both sides keeps the local value and is reported rather than silently losing either write.

Three costs are accepted. The deployment must inject `FABERLOOM_MIRROR_KEY` into each child and mount the route, or the mirror stays off; that is one line in the gateway's spawn environment and one line at the route's mount site. Each cycle pulls the whole document, so a home with very many rows pays for a full read on every interval until per-table paging exists. And sessions do not travel: a session log is a per-cwd artifact, so `faberloom-session-shares` remains the path for sharing one.

## Testing

`packages/faberloom/mirror/tests/document.spec.ts` pins the version refusal, the structural validation, the domain list, the canonical row hash, and the traversal round trip including tombstones and unreachable locations. `packages/faberloom/mirror/tests/sync.spec.ts` drives the real service against a fake gateway: a pull lands rows and a skill file, a local edit is pushed once, an idle cycle sends nothing, a remote move lands on a row the local side never touched, a row changed on both sides is kept and reported, a tombstone is applied, and a transport failure only logs. `packages/faberloom/mirror/tests/loader-composition.spec.ts` boots a test-only `cordis.yml` through the real Loader and asserts the row pulls into the composition's own domains and skills root. `packages/faberloom/mcp-server/tests/mcp.spec.ts` publishes the two tools and pins the export, the version refusal, the applied row, and the written skill. `gateway/tests/mirror-route.spec.mjs` pins the refusals (no token, unknown token, mismatched credential, forged owner, missing credential), the key resolution order, and, over a real socket, the forwarded request fields and both answers.
