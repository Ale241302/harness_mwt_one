# Agent Note: a mail attachment reaches the user as a file or a storage link

Status: implemented

English | [中文](2026-09-24-faberloom-mail-attachment-link.zh.md)

## Problem

The agent could read a mailbox message and save its attachment as a real workspace file, but the chat cannot carry a binary: the tool-result vocabulary has no download card and the harness attachments are model-input images. Handing the user the original ordered document therefore needs a link, and producing one means uploading the bytes to MWT.ONE storage as the signed-in user — but the dsh had no per-user console identity to authenticate that upload.

## Decision

The gateway keeps each user's console token and injects it per dsh; a companion tool uploads the attachment through the console's own storage API.

- At login the gateway stores the console `access`/`refresh` in `gateway-users.json` (atomic write, `chmod 600`), preserving an existing token when a later write does not carry one. `refreshConsolaAccess` refreshes through `POST /api/auth/refresh/` when the access is within ten minutes of expiry and re-persists it; a failed refresh keeps the previous token.
- `startInstance` injects `CONSOLA_API_BASE` and `CONSOLA_TOKEN` (the current access) into that user's dsh — never the shared `MWT_MCP_TOKEN` service credential, so authorship and permissions stay the user's.
- `faberloom_mail_attachment_link(uid, name?, scope?)` reads the message through `faberloomInbound.readEmail`, uploads the chosen attachment with `POST ${CONSOLA_API_BASE}/storage/upload-proxy/` (`multipart`: `file`, `filename`, `scope`, default `correo`) under `Authorization: Bearer ${CONSOLA_TOKEN}`, and returns `${CONSOLA_API_BASE}/storage/download/?key=<key>&token=<access>`. A missing token or a failed upload throws, so the agent falls back to the workspace file.
- `faberloom_mail_attachment` still writes the original bytes to `correo-adjuntos/` under the session workspace; the workspace mail rule tells the agent to use the file or the link and never to rebuild the document with a report.

## Alternatives considered

**Upload with the shared `MWT_MCP_TOKEN`.** One long-lived service credential for every user; it erases per-user authorship and grants the harness more than the user has, which is exactly what per-user identity avoids.

**Talk to MinIO directly from the harness.** It would put a storage credential in the harness and re-implement the console's key scoping and public/private rules that `upload-proxy` and `download` already own.

**Upload from the browser, where the JWT already lives.** The client holds the user's token, but the deliverable was the agent handing over the file; a UI-only upload does not let the model answer "give me the PDF" and adds a button per flow instead of a tool.

## Consequences

- Users' console JWTs now rest per user in `gateway-users.json` (`0600`); rotating `DJANGO_SECRET_KEY` invalidates the refresh token and forces a new login.
- Refresh is best-effort: when it fails the link cannot be produced and the agent falls back to the workspace file, which is why both delivery paths exist.
- The stored token only exists after a login under this change, so a user who has not signed in again yields no link until they do.
- The tool has no unit test yet (the converter does); the upload path is verified only by the deployed build, which is a coverage gap to close.

## Testing

`packages/faberloom/inbound/tests/documents.spec.ts` covers the attachment conversion the same message feeds. The link tool's upload path has no automated test yet; it was exercised manually against the deployed console storage.
