# Agent Note: A local provider wizard, an explicit SICOP probe, and a local task that survives a reopened composition

Status: implemented

English | [中文](2026-11-07-local-provider-and-sicop.zh.md)

## Problem

The local profile had no first-class way to tell whether SICOP was configured or actually reachable. The SICOP client mounted from the environment, so a URL looked like availability even when the server was down, and the provider key and SICOP shared one screen without stating that they are independent. The first-run provider dialog asked for a key but did not say that saving it tests neither the network nor the provider. The local task path — proposal, context, memory — had no restart test that read the result outside the model session.

## Decision

**SICOP has two states, and only a probe crosses from one to the other.** `faberloomView.sicopStatus` reads `SICOP_MCP_URL` and reports `configured` without touching the network. `faberloomView.probeSicop` mounts an isolated MCP client through `ctx.faberloomMcpRegistry.probe`, lists the tools, and disposes it. The probe input carries the URL and no provider key, header, or shared secret. The Connections screen shows the URL, states that configured is not available, and offers **Test SICOP**; a failure is shown with its named cause and never blocks startup or local rows.

**The provider wizard states its own limit.** The first-run DeepSeek dialog now says that saving the key does not test the network or the provider; the first model request does. The key still travels only through `credentials.set`; the local identity patch records the environment name (`DEEPSEEK_API_KEY`) and the test asserts the value is absent.

**The local task survives a reopened composition without a provider or MWT.** A test submits a knowledge proposal, approves it, creates a context entry, and writes a Space memory, then disposes the composition and reads the same rows from a fresh composition over the same in-memory medium. This is a simulated restart; disk durability is not exercised. The reader is the service, not the model session. SICOP is not mounted in that test; the task does not depend on it.

## Alternatives considered

**Probe SICOP automatically on mount.** A configured URL would still be the only startup fact, and an unreachable server would add a startup request and a retry surface. The explicit button keeps configured and available separate.

**Use the provider key for SICOP.** SICOP is public and carries no identity; reusing the model credential would couple two independent capabilities and risk leaking it into a probe. The probe sends no credential.

**Hide SICOP when it is down.** Hiding the failure looks like availability. The card keeps the endpoint and names the failure so the user knows what to fix.

**Treat a saved provider key as proof of inference.** The key is a write-only credential, not a network test. The dialog says so instead of claiming readiness.

## Consequences

The Connections screen distinguishes not configured, configured but unprobed, reachable with tools, and a named failure. SICOP failure leaves the local product usable. The provider key never appears in the local patch or the SICOP probe. The real SICOP endpoint was exercised manually on 2026-11-07 against `https://sicop.vlinte.work/mcp` without auth: `initialize` returned `serverInfo.sicop` and `tools/list` returned 71 `sicop_*` tools; the product `McpClient` path registered the same 71. The automated test still uses a registry stub so CI does not depend on the network. The human task evidence remains pending.

## Verification

- `packages/faberloom/view/tests/mcp-servers.spec.ts`: configured without probing; probe through the isolated client; no `API_KEY` in the probe call; named failure; not configured; no registry.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`: configured/unprobed copy, explicit probe, reachable tools, failure without blocking the panel.
- `packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx`: the no-network caveat is rendered with the key step.
- `packages/faberloom/board/tests/local-task.spec.ts`: proposal, approval, context, and Space memory survive a reopened composition over the same in-memory medium (simulated restart; disk durability is not exercised) and are read back outside the model session.
- `apps/desktop/tests/identity.spec.ts`: the local patch keeps the provider environment name and not its value.
- Manual (2026-11-07): `initialize` and `tools/list` against `https://sicop.vlinte.work/mcp` with no Authorization header returned `serverInfo.sicop` and 71 `sicop_*` tools; the product `McpClient` path registered the same 71. The automated tests above keep the stub for CI.
