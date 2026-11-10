# Agent Note: MWT.ONE authorization uses PKCE, not a chat password

Status: proposed

English | [中文](2026-11-10-mwt-oauth-pkce.zh.md)

## Problem

The product needs a "Conectar MWT.ONE" path that survives restarts and provisions the MWT MCP client. The console's password login belongs to the host shell; asking for the password inside a model conversation would hand credentials to the transcript and to every model turn.

## Decision

**The protocol core is a pure module.** `packages/faberloom/connections/src/mwt-oauth.ts` creates a PKCE verifier and its S256 challenge, builds the authorization URL with an exact loopback redirect, exchanges the code, and refreshes the token. It performs no storage and opens no server, so its behavior is tested without an identity provider.

**The browser owns the credential.** The host opens the authorization URL, receives the code on a loopback callback, and exchanges it. The password never reaches the model, the transcript, or the plugin package.

**The host stores the refresh token and provisions the MCP client.** The service that wires this module writes the token set to the credential seam, saves the `mwt` server in the MCP registry with a bearer header, and refreshes before expiry. Disconnecting deletes the credential and the server row.

## Alternatives considered

**A password form inside the chat.** It exposes the password to the session log and to the model, contradicts the product rule that the plugin never captures credentials, and cannot support MFA or SSO.

**Reusing the console's `/auth/login/` token directly.** It is a console session, not an OAuth grant; it cannot be refreshed under the host's control and would couple the desktop to the console's private login shape.

## Consequences

The core is implemented and tested. The card, the loopback service, the credential write, and the MCP provisioning remain pending because they need an OAuth client registered at `idp.mwt.one` with an exact loopback redirect, and the audience the MWT MCP endpoint accepts. Until that client exists, the card can only report that the deployment is not configured.

## Verification

- `packages/faberloom/connections/tests/mwt-oauth.spec.ts`: PKCE derivation, authorization URL, code exchange body, refresh, and a failed exchange with its status.
