# Agent Note: A local installation mounts its product MCP servers from the resolved environment

Status: implemented

English | [中文](2026-10-14-local-product-mcp-servers.zh.md)

## Problem

The shared gateway injects the product's external tools into every `dsh` it starts: the MWT.ONE console MCP, the public SICOP MCP, the FaberLoom spaces MCP, and the skill catalog, each as a row in a patch generated per user from the deployment's own configuration. A local installation composes the same product bundles and writes its own identity patch at sign-in, but that patch carried identity alone, so the local harness reached none of those servers. The product modules worked and the external tools did not, which is the difference an operator notices first when the Desktop stops being a client of the gateway.

## Decision

**The sign-in patch mounts the product MCP servers whose endpoints it can resolve.** `apps/desktop/src/product-mcp.ts` renders the `- insert:` entries, and `renderIdentityPatch` writes them as the patch's first layer. Each entry carries the fields the gateway's rows carry, so both compositions mount the same servers with the same `failOnStartupError: false`, the same thirty-attempt reconnect, and the same 120-second tool-call budget.

**Mounted means reachable, from configuration rather than from a deployment file.** The decision reads the environment the child boots with, which `main.ts` builds as the Harness-home `.env` layer under the launching process environment, because the child reads that layer first and the inherited environment overrides it. Three outcomes:

- SICOP mounts unless `SICOP_MCP_URL` is blank, and its default is the public `https://sicop.vlinte.work/mcp`. It carries no identity, so a desktop reaches it exactly as the gateway does.
- The MWT.ONE server mounts when both `MWT_MCP_URL` and `MWT_MCP_GATEWAY_KEY` resolve to a non-empty value, and its headers send the signed-in owner in `X-Forwarded-User-Email`, the gateway key through the loader, and the non-JWT `Bearer dsh-gateway` value that skips the console MCP's OAuth challenge.
- The FaberLoom server mounts under the same URL-and-key condition, with `X-Faberloom-User-Id` and `X-Faberloom-Gateway-Key`.

**No secret reaches the patch.** Each secret-bearing header holds the environment name and the loader resolves it when it mounts the row, which is the mechanism the gateway's patch already uses. The shipped default URLs for the MWT.ONE and FaberLoom servers name container hostnames, so a local installation does not mount a row that could only fail: with neither endpoint configured, the local harness mounts SICOP alone.

`readHomeEnv(dshHome)` in `apps/desktop/src/home-env.ts` parses the layer the shell already writes, with the value quoting dotenv accepts, so an operator who sets `MWT_MCP_URL` in the Harness-home `.env` is read the same way the child reads it.

## Alternatives considered

**Mounting the MWT.ONE and FaberLoom rows unconditionally, with the loader resolving the URL too.** An empty URL becomes a row that retries thirty times and logs each failure, and the shipped default points at a container hostname that no machine outside the deployment network resolves. Absence of an endpoint is not an outage, so it must not be presented as one.

**Gating only on the URL and letting a missing key fail at the first tool call.** The key is already resolved at patch time, because the environment is read for the same decision. A row that authenticates nowhere costs a live reconnect budget and a tool schema the model can see and cannot use.

**Writing the secret values into the patch.** The gateway's own patch keeps the environment reference and the child resolves it, and the identity patch is a durable file in a shared directory. A header value there would put a shared gateway key on disk in plain text for the lifetime of the sign-in.

**Reusing `ctx.faberloomMcpRegistry` instead of patch rows.** The registry is the operator's own surface: durable records, credentials through the seam, a probe, and a mount without a restart. It stays the way to add a server the product does not ship. It cannot express "the deployment publishes this endpoint for every installation", because nothing in the deployment can write a registry record, and SICOP would then need a manual step on a fresh install.

**Reading the deployment's configuration file.** There is none on the operator's computer. The environment is the only layer a deployment can ship through packaging (`DSH_DESKTOP_HOME_ENV_FILE`) and an operator can edit.

## Consequences

A local installation reaches SICOP from the first sign-in and reaches the MWT.ONE and FaberLoom servers as soon as the deployment publishes an endpoint a computer outside its network can resolve, with no code change on either side: the URL and the key are configuration. The skill catalog the gateway also injects stays out of scope, because it points at deployment directories.

The cost is that the mount set is decided when the patch is written, so changing the environment takes a sign-out and a new sign-in. The MWT.ONE headers omit `X-MWT-Client-ID`: the gateway derives it from the console's company list, which the Desktop sign-in does not resolve, so the console MCP sees no default company for an operator who has one and the tools that accept a company answer per call.

The FaberLoom-as-server direction was already composed and is unchanged: the patch enables `faberloom-mcp-server` with `socketPath` at `$DSH_HOME/faberloom-mcp.sock`, and `apps/desktop/tests/profile-mcp.spec.ts` still asserts the shipped Desktop composition carries one `mcp-resources` consumer and no `mcp-client` row, which is what keeps the patch the only place a client row appears.

## Testing

`apps/desktop/tests/product-mcp.spec.ts` covers the SICOP default, a blanked and a replaced SICOP URL, the MWT.ONE server with its owner header and key reference, the FaberLoom server, the omission of a server that lacks its URL or its key, the rendered row against a recorded expectation, and the escaping of a quoted owner. `apps/desktop/tests/identity.spec.ts` covers a patch that mounts the public server and mounts nothing when the operator blanks it, and asserts that no key value reaches the patch. `apps/desktop/tests/home-env.spec.ts` covers the layer parser: comments, `export`, surrounding whitespace, single and double quotes, an empty value, a malformed line, and a repeated name.
