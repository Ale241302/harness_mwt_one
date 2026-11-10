# Agent Note: MWT.ONE onboarding uses a device token, not a chat password

Status: proposed

English | [中文](2026-11-10-mwt-oauth-pkce.zh.md)

## Problem

The product needs a "Conectar MWT.ONE" path that picks a client, survives restarts, and mounts that client's MCP server. The IdP exposes no dynamic registration and its token endpoint accepts only `client_secret_post`/`client_secret_basic`, so a public desktop client cannot complete a PKCE-only flow. The console already holds each client's OAuth secret and already issues a device-bound credential per company.

## Proposal

**The console is the broker.** The host asks the operator for the console account in a local form, calls `POST /auth/login/`, then `POST /onboarding/device-token` with a stable device id. The console answers one credential per company: `{ key, token, mcp_url }`. The harness saves each as an MCP server row named `mwt-<key>` with `Authorization: DeviceToken <token>`, so the agent's tools become `mcp__mwt-<key>__*`.

**No IdP client and no refresh token.** The DeviceToken is the durable credential; the console can revoke it and issue another. The password never reaches the model or the transcript: the form is part of the host surface, and the backend performs the two calls.

**The client picker is the credentials the account can reach.** The console returns every company the account may use; the card lists them and the chosen keys are the rows that mount.

## Acceptance criteria

1. Signing in with a client account lists its companies and mounts one MCP server per company.
2. The rows carry only the credential reference in the registry; the DeviceToken is stored in the credential seam.
3. A restart keeps the rows and their tools without another sign-in.
4. Revoking the device token on the console makes the tools fail closed; signing in again replaces the rows.
5. A refused sign-in and an empty credential list report a recoverable error and mount nothing.

## Risks

- The password is handled by the host form and the local backend; it must never be logged, stored, or sent to a model.
- The DeviceToken grants the account's MCP scope; its blast radius is the console's grants, and revocation is the only authority.
- The console must keep `/onboarding/device-token` scoped to the authenticated account; the client trusts that list.
- The MCP URL per company comes from the console; the harness must not derive it from a name.

## Alternatives considered

**Direct OAuth at `idp.mwt.one`.** The provider has no `registration_endpoint` and requires a client secret on the token exchange, so a public desktop client cannot finish the flow; each per-client secret would have to live on every device.

**A password form inside the chat.** It exposes the password to the session log and to the model and cannot support MFA.

## Verification

- `packages/faberloom/connections/tests/mwt-onboarding.spec.ts`: sign-in parsing and refusal, device-token request shape, row filtering, and the server name.
- `packages/faberloom/connections/tests/mwt-oauth.spec.ts`: the PKCE primitives kept for a future public provider.
