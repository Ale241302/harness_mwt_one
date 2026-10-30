# Agent Note: Install a skill from a folder and register an MCP server

Status: implemented

English | [中文](2026-10-12-install-a-skill-and-an-mcp-server.zh.md)

## Problem

The product could show the skills a role, the deployment's shared catalog, and the owner had uploaded, but a user who pointed at a folder holding a skill had no way to install it, and no way to remove one the product had copied. A skill the user supplied lived wherever the skill provider's own roots happened to look, and installing one into a project root meant placing files by hand. MCP servers were no better: the harness could mount the fixed set written into a composition, but there was no durable, per-owner configuration of a user's own servers, no way to prove one connected before keeping it, and no way to add one without a restart.

## Decision

**A folder installs as a skill under one of two roots.** `packages/faberloom/view` adds `installSkill(source, destination, replace?, workspaceRoot?)`, with `skillInstallTargets()` reporting the two roots before anything is written, `skillInstalls()` listing the installs, and `uninstallSkill(name, destination)` removing one, all routed through `ctx.skillInstall` ([one-path note](2026-10-13-one-native-skill-install-path.md)). A workspace install writes under `<workspaceRoot>/.dsh/skills`, the rank-100 root the filesystem skill provider already scans for a project, resolved from `sandboxPolicy.resolve().workspaceRoot`; a global install writes under `$DSH_HOME/skills`, and an empty workspace root counts as no workspace.

**Validation precedes every write, inside the installer.** `detect` treats the source as one skill directory when it holds `SKILL.md` and otherwise as a directory of skill directories, and checks every candidate's front matter name before any copy happens, so a refused name cannot leave a half-installed folder set behind. The whole skill directory is copied with its assets — the one exception is the installer's own marker of a previous install — and an existing skill of the same name is skipped unless `replace` is set. The whole call can be refused before a root exists (`read-only`, `no-workspace`, `outside-workspace`, `source-missing`, `not-a-skill`), and one candidate can be refused inside a running call (`name-missing`, `name-illegal`) or skipped (`exists`).

**Installs are durable in the installer's marker.** Each install writes `.dsh-skill-install.json` beside `SKILL.md`, recording the source, the destination, the instant, and the digest of the installed `SKILL.md`, so a repeat install is a reported no-op and an install can be listed and removed as an install rather than as an unnamed file under a skills root.

**The model tool and the panel share the method.** The `faberloom_skill_install` tool in `packages/faberloom/tool-faberloom` calls the same `installSkill` method, taking the workspace root from the session's sandbox policy and falling back to the session's working directory, and the Skills screen in `packages/client/ui-faberloom` asks the user which destination and shows the resolved root before calling it.

**Confinement uses the package's own path idiom, not `ctx.fs`.** The install resolves a candidate against the workspace and checks containment with the package's own `resolve()` plus `sep` comparison; the installer copies with `node:fs` (`cp`, `rm`, `mkdir`), because `ctx.fs` has no binary copy operation and resolves its own opaque targets, which may be workspace-relative.

**A new package owns a user's MCP servers.** `packages/faberloom/mcp-registry` (`@deepseek-ai/dsh-faberloom-mcp-registry`) publishes `ctx.faberloomMcpRegistry` over a durable `faberloom_mcp_registry` domain, one record per owner and server name, holding the transport (stdio with `command`, `args`, and `cwd`, or streamable-http with an absolute HTTP(S) `url`), the entry names, the enabled flag, and the timestamps.

**Every header and environment value is a secret.** `save` writes each value to the credential seam under a reference derived from the owner, the server, and the entry name — `MCP_SECRET_REF_PREFIX` plus the uppercase hexadecimal UTF-8 of the three parts, so no two parts can collide and the reference is always a valid environment-variable name — and the record keeps only `{ name, credentialRef }`. A caller-facing read projects `present` from `credentials.describe`, so the value never leaves the host and no read can return it.

**A probe proves one candidate before it is kept.** `probe(input)` mounts the MCP client inside an isolated scope under the registry's fiber, awaits the connection, lists the `mcp__<name>__` tools it registered, and always disposes the scope, returning `{ ok: true, tools }` or `{ ok: false, failure, detail }`, where `failure` is `unreachable`, `bad-credential`, or `protocol` and `detail` carries the server's deepest message with every supplied secret replaced by `[redacted]`.

**Every enabled server mounts process-globally.** An enabled server mounts through `ctx.plugin(dsh-mcp-client, config)` at the registry's own scope, the mechanism `dsh-acp` uses per session and here once per process. `save` unmounts the previous client before mounting the new one, `remove` unmounts before deleting, a disabled server is never mounted, and `apply` mounts every enabled record at boot. The tools belong to the global tool registry, which the agent loop reassembles on every request, so a session already running sees `mcp__<name>__<tool>` in its next request without a restart, while the request already in flight does not.

**A Settings page is the user surface for those servers.** `packages/client/ui-faberloom` contributes the page into `settings.section` (id `faberloom-mcp-servers`, order 30): it lists the owner's servers with their transport, whether they are enabled and mounted, and which credentials are present — never a value — adds one by naming its transport and the values it authenticates with, which go to the credential seam, tests a candidate by one real connection before saving it and shows the tools it found or the named failure with the redacted detail, and removes one behind an inline confirmation. The browser reaches the registry only through new methods on `ctx.faberloomView` (`mcpServers`, `saveMcpServer`, `removeMcpServer`, `probeMcpServer`), whose owner identity comes from the Remote's `Config` rather than any call argument, so no registry code reaches the browser.

## Alternatives considered

**Storing the MCP configuration the way opencode does.** opencode keeps its MCP servers in a configuration file with a separate lock ledger; the product instead owns the record in its own storage domain, so the configuration is durable, per-owner, and read through the same seam as every other product record, and no second file has to be kept consistent with the domain.

**Copying skill assets through `ctx.fs`.** The skill copy carries binary assets in a directory tree, and `ctx.fs` exposes text writes and opaque resolved targets rather than a directory copy, so routing the copy through it would either lose bytes or require re-deriving paths the install already holds.

**Mounting MCP servers per session.** A per-session mount would make a saved server a session-composition concern and hide it from the next request of a session already running; one process-global mount at the registry's own scope makes every workspace and Space see the tools from their next request.

**A probe tool addressed by name.** `packages/faberloom/tool-faberloom` registers three MCP tools over this service — `faberloom_mcp_add`, `faberloom_mcp_list`, and `faberloom_mcp_remove` — so the model installs a server from the documentation it was handed, lists the installed ones, and removes one, and `faberloom_mcp_add` probes the candidate and saves nothing when the probe fails. A probe addressed by name deliberately does not ship: this package's `probe` takes a full candidate carrying the credential values, so a caller holding only a reference could not retest a saved server without misleading it.

## Consequences

A skill installs into the workspace it will run in or into the deployment's global root, and the provider's own root rules decide which sessions see it, so a workspace install reaches the sessions rooted there and a global install reaches every session. An install is removable as an install, and the model-facing tool and the panel install the same way. A workspace install appears in the installer's markers, not in the `skills()` table, which enumerates the role catalog, the shared catalog, and `$DSH_HOME/skills`; the workspace root is discovered live by the mounted provider and recorded by `skillInstalls()`.

An MCP server is durable and per-owner, and its secrets live only in the credential seam, so no read — list, save, or probe — can return a value. An enabled server's tools reach every session and Space from their next request. Two limits are accepted. The mount is process-global, so two owners enabling servers of the same name fail the later mount loudly and that row reports `mounted: false` until a later save or boot retries. And a saved server cannot be retested by name: the model tools and the Settings page install, list, and remove one, but this package's `probe` takes a full candidate carrying the credential values, so re-testing a saved server means supplying its values once more.
