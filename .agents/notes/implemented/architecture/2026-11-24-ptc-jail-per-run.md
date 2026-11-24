# Agent Note: `run_code` runs every program inside a per-run bubblewrap jail

Status: implemented

English | [中文](2026-11-24-ptc-jail-per-run.zh.md)

## Problem

`run_code` (PTC) executes model-authored TypeScript in a child Node process that keeps `fs`, `net` and `child_process`. The harness sandbox restricts writes only: under `danger-full-access` the PTC argv is not wrapped at all, and under `workspace-write` the runner profile is `--ro-bind / /`, which keeps every path of the host readable. The gateway keeps one `DSH_HOME` per tenant under `/data/users/<id>`, and each home holds that tenant's MCP credentials (`storages/faberloom_mcp.json`, `storages/*token*`). A program written by the model can therefore read another tenant's token and call the MCP as that tenant — with no policy check and no approval — and nothing in the process boundary stops it. Turning Code Mode on for tenants without closing this path is not a trade-off; it is handing one tenant's credentials to another.

## Decision

`deploy/jail/node-jail` ships at `/opt/dsh/bin/node-jail` and is selected through the package's existing `nodeExecutable` config on the `ptc-runtime` row, so `packages/ptc-runtime/ptc-runtime-node` is unchanged. The wrapper takes the arguments the package would have passed to `node` and re-executes `node` under `bwrap --unshare-all --die-with-parent --new-session`.

The tenant home reaches the wrapper through the child's working directory, because the runtime replaces `process.env` with an empty dictionary before the spawn and owns the argv. The session workspace is `/data/users/<id>` or a subdirectory of it, the wrapper derives the home from that path, requires exactly one component below `/data/users`, and exits 126 for any other working directory. `PTC_JAIL_HOME` overrides the derivation for manual runs and is subject to the same rule.

`tenants` is a reserved segment. With `FABERLOOM_TENANT_HOME=1` the gateway gives a tenant the shared home `/data/users/tenants/<key>` (`shouldShareTenantHome` in `gateway/tenant-home.mjs`), whose first component under `/data/users` is the directory holding every tenant. Deriving a home there would mount all of them writable without any error, so the wrapper refuses that segment by name and Code Mode does not run on a deployment with shared tenant homes. Supporting it would need the depth derived from `homeFor`, not guessed from the path.

Inside the jail: new user, mount, pid, net, ipc and uts namespaces; `/usr` and `/opt/dsh` read-only; `/bin`, `/sbin`, `/lib`, `/lib64` as the merged-`/usr` symlinks; `/etc/ssl`, `/etc/passwd`, `/etc/group` and `/etc/ld.so.cache` read-only when present; a fresh procfs on `/proc`; a 1777 tmpfs on `/tmp`; and the tenant home writable at its own absolute path. `/app` and every other tenant home are absent from the mount set, not merely unreadable.

The subprocess control channel is the inherited descriptor 7. `bwrap` keeps inherited descriptors that are not named by `--sync-fd` and closes the ones that are, immediately before the exec; the wrapper must never pass `--sync-fd 7`.

Failure is loud in both directions. A missing `bwrap`, a working directory outside `/data/users/<id>`, or a `bwrap` that cannot create its namespaces ends the run with a message on stderr instead of a confined run; the runtime reports it as `worker-exit` with the `bwrap` text.

`deploy/jail/bwrap-seccomp.json` keeps Docker's default profile with one added allow rule for `clone`, `unshare`, `mount`, `umount2`, `pivot_root` and `setns`, and `deploy/jail/README.md` records the container options that would be needed. The measured result on the deployed host (below) is that the profile alone is not enough, so `docker-compose.yml` does not apply it: the jail is an artifact for hosts that permit what the next section describes, and `PTC_JAIL` defaults to empty.

`DSH_PERMISSION_MODE` stays where it was: `.env` or the gateway's own `detectSandboxMode()` probe. The jail enforces the same mounts under either mode, because it is the executable the runtime launches rather than the sandbox wrapper around it. Under `workspace-write` the runtime wraps that executable in the shell profile first, so the jail runs nested inside it; that combination is not verified here.

The gateway refuses to serve Code Mode with no confinement at all. `HARNESS_TOOLS_MODE` other than `native` needs one of two paths: `PTC_JAIL` (this wrapper, for hosts that permit unprivileged user namespaces) or the per-tenant uid isolation of [the uid note](2026-11-24-tenant-uid-isolation.md) (`HARNESS_TENANT_UID=1` with the table present). With neither, the boot aborts with the same FATAL line an invalid mode uses, instead of writing a per-user patch whose `tools` row enables PTC with the runtime's default `process.execPath`. The `ptc-runtime` row travels with `PTC_JAIL` alone: under uid isolation the patch enables `tools` and lets the runtime use `process.execPath`, because the kernel separates tenants and no wrapper is needed.

## What the jail does not cover

- **No syscall filter inside the jail.** `bwrap` runs without `--seccomp`, so the program may call anything the kernel allows to its user namespace, including creating further nested user namespaces. Nested namespaces only reduce reach; they cannot widen the mount set.
- **No resource limits of its own.** CPU, memory and pid ceilings stay where they already are: `maxOldGenerationSizeMb` in the runtime and `mem_limit`/`pids_limit` on the container.
- **The tenant's own home is fully writable, including its own tokens.** A program can read the credentials of its own tenant. That is self-access, not cross-tenant access, and it does not survive the run because there is no network.
- **No protection against the `bash` tool or another agent.** Both still run under the container's policy, which this change leaves as it was: `.env` or the gateway's probe.
- **No exfiltration control through the conversation.** A program that returns data to the model puts it in the transcript; the model already sees that tenant's data through its tools, so the transcript is not a new channel. The jail protects disks and sockets, not the answer.
- **No audit of denials.** A refused path surfaces only as an `ENOENT`/`EPERM` inside the program's own output.

Enabling `ptc` for tenants under this jail is safe when, on the deployed image, `verify.sh` prints `PASS` for every case with at least two tenants present in `/data/users` and one of them holding `storages/faberloom_mcp.json`. The [presentation switch](2026-11-24-harness-tools-presentation-switch.md) decides who gets `ptc`; this note only makes it safe to do so. On a deployment with uid isolation the jail is not needed and `verify.sh` does not run: the control is the kernel, and [the uid note](2026-11-24-tenant-uid-isolation.md) carries its own verification.

## Alternatives considered

**Editing `packages/ptc-runtime/ptc-runtime-node` to add an argv prefix.** Rejected: the package already delegates the executable to the deployment through `nodeExecutable`, and a second deployment knob inside the runtime would have to carry its own tests, README and JSDoc for a capability the config already provides.

**Passing the tenant home as an argument or in `PTC_JAIL_HOME` from the supervisor.** Rejected: the runtime blanks the child environment and owns the argv, so neither channel can carry a per-run value without changing the package. The working directory already carries it exactly.

**Constraining the program with `workspace-write` instead of a jail.** Rejected: that profile is `--ro-bind / /`; it stops writes and leaves every other tenant's home readable, which is the risk being closed.

**Running PTC inside a separate container per call.** Rejected for now: it is a larger operational surface (image distribution, volume mounts, container lifecycle per call) for the same isolation, and the runtime already runs the program as a child process over an inherited channel.

**`--sync-fd 7` to keep the control channel.** Rejected on the source: `bwrap` closes the `--sync-fd` descriptors in the child before exec, so the channel must survive as an ordinary inherited descriptor.

**`seccomp=unconfined` for the container.** Rejected: it removes the whole deny list — `keyctl`, `bpf`, `perf_event_open`, the module loaders — to recover six syscalls.

## Consequences

The image carries two shell scripts and the build fails if either stops parsing (`sh -n` at image build). Enabling the jail on a host that permits unprivileged user namespaces needs `PTC_JAIL` set and nothing else. If the code runs on a host that forbids unprivileged user namespaces, or under an AppArmor profile without the `userns` rule, every PTC run fails with `bwrap: No permissions to create a new namespace` — an availability failure of Code Mode, never an unconfined fallback. A session whose stored working directory lies outside `/data/users/<id>` — any session created before `HOME` became per user — is refused the same way, until it starts a new session.

This deployment runs neither the jail nor an unconfined PTC: `PTC_JAIL` stays empty and Code Mode rests on per-tenant uids with `0700` homes and the child dropped to that uid.

## Verification

Locally verified: both scripts parse under `dash -n`; the embedded checker parses under `node --check`; the profile is valid JSON whose first rule is the added one; `docker-compose.yml` parses and resolves `PTC_JAIL` as written. The checker was also executed outside the jail, where it fails `jaula activa`, `/data/users` and every network case and exits 1 — the fail-closed control.

Measured on the deployed host (`srv1416291`, Linux 6.8.0-147, kernel `apparmor_restrict_unprivileged_userns = 1`, LSM list carries `landlock`):

- Inside the gateway container, `bwrap --unshare-all` exits 1 with `No permissions to create a new namespace`, and `unshare -U true` fails with `Operation not permitted`.
- A throwaway container with only `deploy/jail/bwrap-seccomp.json` plus `systempaths=unconfined` gets further and fails at `Failed to make / slave: Permission denied`: `/` belongs to the parent user namespace, so remounting it slave needs `CAP_SYS_ADMIN` there.
- `apparmor=unconfined` alone changes nothing.
- `CAP_SYS_ADMIN` + `CAP_NET_ADMIN` + the seccomp profile + `apparmor=unconfined` does create the namespaces (the probe then fails only because the throwaway run bound no filesystem), so the jail is reachable **only** by granting those two capabilities to the multi-tenant gateway.

That price was rejected for this deployment: `CAP_SYS_ADMIN` on the container that already holds every tenant's home is a worse exposure than the one the jail closes. `PTC_JAIL` therefore defaults to empty, `docker-compose.yml` applies no extra security option, and the gateway keeps `native` unless the uid isolation described in [the uid note](2026-11-24-tenant-uid-isolation.md) is active. The same run found that 10 of the 13 directories under `/data/users` are `0755 root`, so any process in the container could read them, jail or no jail; the uid note records that migration and its measurements (12 tenant homes moved to `30001..30012` at `0700`, cross-reads failing with `Permission denied`, a `dsh` environment without the five deployment secrets).
