# Agent Note: each tenant's `dsh` runs as its own uid and no longer inherits the deployment's secrets

Status: implemented

English | [中文](2026-11-24-tenant-uid-isolation.zh.md)

## Problem

Every process in the gateway container ran as root, including the `dsh` the supervisor starts per user (`gateway/server.mjs`, `startInstance`). Root ignores file permissions, so the `0700` some homes already had did not stop one tenant's agent from reading another tenant's home — home directories hold that tenant's MCP credentials (`storages/faberloom_mcp.json`, `storages/*token*`). The child also inherited `process.env` verbatim, which carries `SESSION_SECRET` (forges a session cookie for any user), `DATABASE_URL` (the board database password) and `MEMORY_ADMIN_KEY`, none of which a tenant's agent needs. A `bash` tool or a `run_code` program was enough to read either.

Measured on the deployed host before the change: of the 13 directories under `/data/users`, 10 were `0755 root` and 3 were `0700 root`; the gateway reported `sandbox de shell para dsh: danger-full-access`.

## Decision

`scripts/harden-homes.mjs` is the data half. It assigns each tenant `uid = gid = 30000 + slot` (slots 1..999), persists the mapping in `<dir of DATA_DIR>/tenant-uids.json`, gives the home `chown -R <uid>:<uid>` and `0700`, and leaves `/data` and `/data/users` in `755` so the gateway can still reach the homes. It also puts every file of `/data/secrets/*` plus `gateway-users.json`, `mcp-token-index.json` and `memory-users.json` in `0600 root`, and makes the deployment's shared data (`/data/shared`, `/data/users/shared`) world-readable because the child now reads it as an unprivileged uid: `faberloom-global-agents.json` was `0600 root` and would have become unreadable.

The script is a dry run unless `--apply` is passed, is idempotent (a second run prints `sin cambios` for every entry), writes a run record (`/data/harden-homes-<ts>.json`) with every owner and mode it found before touching anything, and stops at the first failure instead of leaving a home half-migrated. `--rollback <record>` restores those owners and modes and moves the uid table aside, so a gateway that still has `HARNESS_TENANT_UID=1` fails loudly at boot instead of serving homes that belong to root again.

`shared` and `tenants` are not tenant homes and receive no uid. `shared` is the deployment-wide directory inside `DATA_DIR` (the exempt-owner list lives there) that every tenant's `dsh` reads; `tenants` is the reserved segment of `gateway/tenant-home.mjs` for shared tenant homes.

`gateway/tenant-uids.mjs` owns the table format and the operations on it. A table entry is `{ uid, gid, slot }` with `uid === gid === 30000 + slot`, validated on read: an inconsistent, duplicated or out-of-range entry stops the gateway instead of assigning uids at random.

`gateway/server.mjs` is the process half:

- `HARNESS_TENANT_UID=1` turns the mode on. With it on and no table, the gateway exits with `FATAL` instead of spawning root; with it on and the gateway not running as root, it warns and keeps the previous behaviour.
- `startInstance` passes `uid` and `gid` to `spawn` only when the mode is active, so `prlimit` and then `dsh` run as the tenant. `prlimit --nofile` keeps working because lowering a limit needs no privilege; measured on the host at 8192 with `uid=30001`.
- The child environment is `stripChildSecrets(...)`: `SESSION_SECRET`, `DATABASE_URL` and `MEMORY_ADMIN_KEY` are dropped from the copy of `process.env` and from the explicit entries, and everything else is kept. `FABERLOOM_MIRROR_KEY` travels explicitly (its resolved value, so `<NAME>_FILE` works) because the tenant's local MCP server validates it for the desktop mirror, and `FABERLOOM_CEO_SIGNERS` is inherited because it is a list of signing authorities, not a credential, and the board reads it inside the `dsh`.
- After the gateway has written the patch, the token files, the presets and the recreated workspace directories as root, `adoptHomeOwnership` walks the home and `lchown`s to the tenant every entry whose owner differs. Without that step the child cannot read its own `0600 root` console token nor write in a workspace the gateway just recreated. Symlinks are chowned without being followed.
- The uid table gains an entry for a tenant it does not name (a new account) in one atomic write, and `/etc/passwd` and `/etc/group` gain `tenant-<slot>` so `id`, `ls -l` and `os.userInfo()` behave; the shell tool calls `userInfo()` because `SHELL` is empty in this image.
- `/data/shared/skills` belongs to the first tenant with role `admin`, `superadmin` or `ceo` in `gateway-users.json` (file order decides), in `2775`: the panel writes a global skill as the editor's uid, and `2775` lets every tenant read the catalogue while only the owner writes it. Opening it to every tenant would let any of them rewrite the global catalogue. With no such role the directory stays in root and the script prints a warning; the gateway logs the owner it found at boot.

The `HARNESS_TOOLS_MODE` guard accepts two kinds of confinement: `PTC_JAIL` (bwrap, for hosts that allow user namespaces) or this uid isolation. With neither, the boot aborts as before. `renderToolsEntry` writes the `ptc-runtime` row only when `PTC_JAIL` names a wrapper; under uid isolation the runtime keeps its `process.execPath` and the kernel is the jail.

## Alternatives considered

**`chmod 700` without dropping privileges.** Rejected: root ignores the mode bits; the measured baseline (3 homes already at `0700 root`) is the proof.

**bwrap per run.** Rejected for this deployment: creating the namespaces needs `CAP_SYS_ADMIN` + `CAP_NET_ADMIN` on the container that already holds every home, which is a worse exposure than the one it closes. It stays available through `PTC_JAIL` for hosts that permit unprivileged user namespaces.

**One container per tenant.** Rejected for now: a larger operational surface (image distribution, volume mounts, lifecycle) for the same kernel isolation.

**Per-tenant MCP tokens.** Out of scope here: the MCP still trusts `X-Forwarded-User-Email` plus the deployment-wide `MWT_MCP_GATEWAY_KEY`, so a tenant that holds that key can still claim another identity at the MCP. Closing it needs a credential per tenant on the MCP side; the gateway already passes the key because that is how the `dsh` authenticates today.

**`setgroups`/per-tenant supplementary groups.** Not used: `spawn` sets uid and gid only, so a shared group would have to be granted through `initgroups`, which Node does not do.

## Consequences

The child keeps `FABERLOOM_MIRROR_KEY` and `FABERLOOM_CEO_SIGNERS` because the desktop mirror and the board need them inside the `dsh`; what it loses is the three credentials that only the gateway uses. The mirror key is a deployment-wide credential shared by every tenant's mirror path, so a tenant that reads its own environment still holds it — the same known limit as `MWT_MCP_GATEWAY_KEY`, closed by per-tenant credentials, not by this change.

The global skill catalogue now has one owner, so an Admin moving to another account leaves the directory with the previous one until `scripts/harden-homes.mjs --apply` runs again; the gateway's boot line names the current owner so the drift is visible.

The whole container still shares one network namespace, one pid namespace and one filesystem: uid isolation closes cross-home reads and the secret leak in the environment, not a tenant that exhausts memory or ports, which stay with the container limits (`mem_limit`, `pids_limit`, `cpus`).

Root inside the container can still read every home: that is the supervisor's job. It also can no longer read another uid's `/proc/<pid>/environ` (the container has no `CAP_SYS_PTRACE`), which is why the evidence for the child environment is gathered as the tenant's own uid.

## Verification

Local: `node --test gateway/*.test.mjs` passes (77 pass, 1 skipped on Windows: the POSIX ownership walk), including the new `gateway/tenant-uid.test.mjs` (uid arithmetic, table validation and idempotence, the five denied names absent and `DSH_HOME`, `HOME`, `MWT_MCP_GATEWAY_KEY`, `DEEPSEEK_API_KEY` present, the ownership walk, and the wiring assertions) and the updated `gateway/tools-mode.test.mjs` (the `ptc-runtime` row is written only when `PTC_JAIL` names a wrapper).

On the deployed host, with a verified `tar czf` of the volume (`4.28 GB`, `tar tzf` listable, one file extracted and its sha256 equal to the original) taken before any `chown`:

- The dry run and `--apply` assigned 30001..30012 to the 12 tenant homes, left the 13th (`shared`, the deployment's shared directory) root `755`, and reported every secret file already at `0600`. A second `--apply` printed `sin cambios` for all of it.
- As uid 30001, `cat /data/users/<other>/storages/faberloom_mcp.json`, `ls /data/users/<other>`, `cat /data/gateway-users.json` and `cat /data/secrets/mwt_mcp_gateway_key` all fail with `Permission denied`; writing in its own home succeeds.
- Eight `dsh` processes are alive after the recreate, each with its own uid and gid, and `context-mode` children inherit it.
- The environment of a `dsh` read as its own uid lists no `SESSION_SECRET`, `DATABASE_URL` or `MEMORY_ADMIN_KEY`, and does list `FABERLOOM_MIRROR_KEY`, `FABERLOOM_CEO_SIGNERS`, `DSH_HOME`, `HOME`, `MWT_MCP_GATEWAY_KEY`, `DEEPSEEK_API_KEY` and `DSH_PERMISSION_MODE`.
- The tenant's local MCP server answers `initialize` to a request carrying the mirror key and answers `unknown or revoked token` to one carrying a wrong key.
- Writing in `/data/shared/skills` succeeds as the Admin's uid and fails with `Permission denied` as another tenant's; the directory is `tenant-5:tenant-5 2775`.
- As uid 30004, an MCP client reached `consola-mwt-one-mcp:8765` with the deployment key and that tenant's headers, listed 52 tools and `mwt_whoami` returned that tenant's identity.
- A `node` process with the pilot tenant's uid and cwd failed with `EACCES` on another home, on `gateway-users.json` and on the MCP key, and wrote in its own home.
