# Agent Note: Local mode is a composition, not a hidden error path

Status: implemented

English | [中文](2026-11-06-local-composition-without-mwt.zh.md)

## Problem

Wave 2.1 gave a local home its own owner id and forced the mirror switch off, but the composition still mounted the deployment rows. `renderProductMcpEntries` mounted MWT whenever an inherited `MWT_MCP_URL` and credential resolved, and FaberLoom whenever its URL and gateway key did. The local identity patch omitted the `faberloom-shares` row, but omitting a patch row does not disable the bundle row that mounts the service. `credentials-console`, `faberloom-checks-mwt`, `faberloom-mirror`, `faberloom-session-shares`, `faberloom-inbound`, and the MCP bridge stayed mounted, so they could register tools, retry, and reach the deployment even though the home was local.

## Decision

**Local mode is selected before product MCP rows are rendered.** `resolveProductMcpServers` takes `remote` or `local`. In `local`, it returns only the public SICOP server; MWT and the deployment FaberLoom server are never rendered, even when every variable resolves.

**The local patch starts from a sanitized environment.** `localProductEnvironment` removes `MWT_*`, `CONSOLA_*`, `FABERLOOM_MCP_URL`, `FABERLOOM_GATEWAY_KEY`, `FABERLOOM_GATEWAY_URL`, `FABERLOOM_LLM_PROXY_URL`, and the mirror names. Provider keys and `SICOP_MCP_URL` stay. `writeLocalIdentityPatch` renders `local: true`: the local MCP server keeps its loopback socket but gets `bridge: false` and empty gateway/console bases, and the patch disables `credentials-console`, `faberloom-checks-mwt`, `faberloom-mirror`, `faberloom-shares`, `faberloom-session-shares`, `faberloom-inbound`, and `faberloom-publication` by id.

**The bundle gates the same rows for the CLI.** `packages/bundle/faberloom-app/cordis.patch.yml` disables those rows when `FABERLOOM_LOCAL=1`, and the MCP server row reads its bridge switch from the same value. A CLI launch with `FABERLOOM_LOCAL=1` composes the local profile; no separate profile duplicates the local rows.

**The Desktop host applies a last overlay.** `apps/desktop-host/config/desktop-local.patch.yml` disables the same rows and sets the bridge off. `desktopComposition` appends it after the profile, the desktop patch, and the identity patch when `FABERLOOM_LOCAL=1`, so a home whose identity patch predates this change cannot re-enable the deployment rows. `main.ts` sets `FABERLOOM_LOCAL=1` and passes the sanitized environment to the child.

**Local product rows stay.** Mesa, context, memory, routines, workflows, defaults, view, session agent, skills, and the loopback MCP endpoint remain mounted. SICOP is the only product MCP server; the provider key is untouched.

## Alternatives considered

**Hide the rows or catch their errors.** A mounted service still registers tools, retries, and can reach the deployment. The acceptance measures absence, not silence.

**Only remove the rows from the identity patch.** Omitting a patch row does not disable a bundle row, and a later identity patch could re-add it. The bundle gate and the last overlay make the absence compositional.

**A separate local profile.** It would duplicate every local row and drift from the remote profile. The same bundle with an explicit local mode keeps one definition.

**Clearing the variables from `.env`.** A home that once signed in must keep its credentials for a later sign-in; deleting them would force a new login and could lose the device grant. The local patch ignores them instead.

## Consequences

A local launch has no MWT or deployment FaberLoom MCP client, no credential console, checks, mirror, bridge, shares, session sync, inbound mail, or publication service. It keeps SICOP, the local product services, and the loopback MCP endpoint. A remote launch is unchanged. Full disconnect and data-retention evidence after revocation remains LIFE-01 in 5.3; this note covers the 2.2 composition slice.

## Verification

- `apps/desktop/tests/local-composition.spec.ts`: the real Desktop profile (base, web, faberloom), the desktop overlay, the local identity patch, and the host's last overlay; no `mwt`/`faberloom` MCP client, the remote rows disabled, the local rows enabled, and the bridge off. The remote control keeps `mwt`/`faberloom`.
- `apps/desktop/tests/local-network.spec.ts`: a fake MWT endpoint with synthetic credentials; start, wait, and restart observe zero requests in local mode.
- `apps/desktop/tests/identity.spec.ts`: the local patch drops every deployment variable and emits the disabled rows; `localProductEnvironment` keeps only provider and SICOP.
- `apps/desktop/tests/product-mcp.spec.ts`: local mode returns only SICOP with every remote variable present.
