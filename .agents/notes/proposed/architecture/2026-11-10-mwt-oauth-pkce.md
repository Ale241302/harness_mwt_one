# Agent Note: MWT.ONE authorization uses PKCE, not a chat password

Status: proposed

English | [中文](2026-11-10-mwt-oauth-pkce.zh.md)

## Problem

The product needs a "Conectar MWT.ONE" path that survives restarts and provisions the MWT MCP client. The console's password login belongs to the host shell; asking for the password inside a model conversation would hand credentials to the transcript and to every model turn.

## Proposal

**The protocol core is a pure module.** `packages/faberloom/connections/src/mwt-oauth.ts` creates a PKCE verifier and its S256 challenge, builds the authorization URL with an exact loopback redirect, exchanges the code, and refreshes the token. It performs no storage and opens no server, so its behavior is tested without an identity provider.

**The browser owns the credential.** The host opens the authorization URL, receives the code on a loopback callback, and exchanges it. The password never reaches the model, the transcript, or the plugin package.

**The host stores the refresh token and provisions the MCP client.** The service that wires this module writes the token set to the credential seam, saves the `mwt` server in the MCP registry with a bearer header, and refreshes before expiry. Disconnecting deletes the credential and the server row.

## Acceptance criteria

1. With a registered client id and loopback redirect, the card opens the provider, receives the code, and shows the connected account without the user typing a password into the chat.
2. The refresh token survives a restart; the MCP server row is present after boot and its tools answer.
3. A refresh before expiry replaces the bearer header without duplicating the server row.
4. Disconnect removes the credential and the row; the tools stop answering.
5. A mismatched `state`, a denied consent, or a failed exchange reports a recoverable error and stores nothing.

## Risks

- A shared client id without an exact redirect lets another local process intercept a code. The client must allow only the loopback redirect the host binds.
- The refresh token is a long-lived credential; it belongs in the host's credential store, never in the MCP row or a log.
- The MWT MCP endpoint may require a console token rather than the IdP access token. That audience must be confirmed before the card is declared working.
- Revocation on the provider side is authoritative; the local disconnect only forgets the record.

## Alternatives considered

**A password form inside the chat.** It exposes the password to the session log and to the model, contradicts the product rule that the plugin never captures credentials, and cannot support MFA or SSO.

**Reusing the console's `/auth/login/` token directly.** It is a console session, not an OAuth grant; it cannot be refreshed under the host's control and would couple the desktop to the console's private login shape.

## Verification

- `packages/faberloom/connections/tests/mwt-oauth.spec.ts`: PKCE derivation, authorization URL, code exchange body, refresh, and a failed exchange with its status.
