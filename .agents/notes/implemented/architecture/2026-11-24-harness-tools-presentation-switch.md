# Agent Note: the gateway turns Code Mode on per deployment or per pilot

Status: implemented

English | [中文](2026-11-24-harness-tools-presentation-switch.zh.md)

## Problem

The bundle base mounts `tools` with no `config`, so every tenant runs the `native` presentation and the PTC runtime mounted beside it stays idle. Code Mode is a deployment choice — one pilot may need it while every other account must keep the current tool catalogue — but the image carried no way to choose it without rebuilding and shipping a different profile. The per-user `harness.patch.yml` that `renderPatch()` already writes before each `dsh` launch is the only place where a deployment-varying value can reach one account without touching another.

## Decision

`HARNESS_TOOLS_MODE` (`native`, `both`, `ptc`; default `native`) and `HARNESS_TOOLS_MODE_USERS` (comma-separated emails; empty means everyone) join the gateway's environment configuration. `parseToolsMode` validates the mode at boot and `process.exit(1)`s with a FATAL line on an unknown value, because a deployment that mistyped `both` must not discover afterwards that its pilot ran `native` in silence. The same block aborts the boot when the resolved mode is not `native` and `PTC_JAIL` is empty: Code Mode without a jail runs the model's program against every tenant home, so a patch that enables it must never be written.

`toolsModeFor(email, mode, pilots)` resolves one user: the deployment mode when no pilot list exists, the deployment mode when the email is in the list, and `native` otherwise. Emails are trimmed and lowercased on both sides, so a console that reports `Ana@MWT.one` still matches a list written in lowercase.

`renderToolsEntry(mode)` returns the empty string for `native` and, otherwise, the rows `- id: tools` / `config:` / `mode: <value>` followed by `- id: ptc-runtime` / `config:` / `nodeExecutable: <PTC_JAIL>`. `renderPatch` splices them into the top-level list, after the `- insert:` block and before `- id: tool-faberloom`. It reconfigures the entries the base bundle already mounts rather than inserting new ones, which would duplicate the registry and the runtime. In `native` the spread contributes no element at all, so the patch of an account outside the pilot stays byte for byte the file it receives today; the test pins both the empty string and the conditional splice.

The mode is quoted with `yamlScalar`, the file's existing convention for deployment-supplied values.

## Alternatives considered

**Editing `packages/bundle/base/cordis.patch.yml`.** Rejected: the mode would become part of the image and identical for every tenant, and changing it for one pilot would need a new build.

**Falling back to `native` on an invalid value.** Rejected: the operator would be told nothing and the pilot would silently measure the old catalogue.

**Writing the row for every user and letting the plugin default apply.** Rejected: it adds a row to patches that must stay identical to today's, and it hides whether the deployment actually chose a mode.

## Consequences

An operator turns Code Mode on by setting two variables in the deployment `.env` and naming a working `PTC_JAIL` wrapper, then restarting the gateway container; no image rebuild. The rows reach each user's patch on its next `dsh` start, so an instance that is already running keeps its previous mode until it restarts. Nothing here turns `ptc` on for a tenant by itself: with no `HARNESS_TOOLS_MODE` the patch carries no `tools` row, and with no jail the boot refuses to start. On the current deployment no jail is available yet — the bubblewrap path needs `CAP_SYS_ADMIN` on the gateway, which the [jail note](2026-11-24-ptc-jail-per-run.md) rejects — so the variable stays `native`.

## Testing

`node --test gateway/tools-mode.test.mjs` passes seven tests: an unset or empty mode resolves to `native` and contributes no row; `both` and `ptc` produce the exact `tools` and `ptc-runtime` blocks; a listed pilot receives the deployment mode while an unlisted email stays `native`; an empty pilot list applies the mode to everyone; pilot email matching ignores case and surrounding spaces; unknown modes throw; and the shipped source reads both variables, splices the rows through the conditional, names `PTC_JAIL` on the runtime row, aborts the boot when it is empty, and routes an unknown mode to the FATAL exit. The full gateway cannot be booted in a unit test (it needs the deployment secret, console and supervisor), so the pure helpers are sliced from `gateway/server.mjs` and executed directly.
