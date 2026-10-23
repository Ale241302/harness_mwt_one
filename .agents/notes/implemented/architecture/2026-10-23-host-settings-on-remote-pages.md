# Agent Note: Remote web pages read and write the Host settings document

Status: implemented

English | [中文](2026-10-23-host-settings-on-remote-pages.zh.md)

## Problem

The Models settings page on `harness.mwt.one` failed with “No se pudo cargar el directorio de proveedores: settings are unavailable in this browser”. The Client selected its settings mirror's process-local mode whenever `remote.$host.isLoopback` was false, so a page served from a remote origin never called `settings.describe` and every provider row stayed inert. An owner could type OpenAI, Anthropic, Google, Moonshot, or Kimi keys in the desktop app but not in the web app, even though both run the same UI and the same Host composition.

The deployment already authenticates the browser session, runs one `dsh` per user with its own `DSH_HOME`, and answered `settings.describe` with `writable: true` for the signed-in user. The loopback classification therefore withheld a working, per-user transport rather than protecting anything: the settings document it refused to read belongs to the same identity that already owns the Session, its Workspace, and its shell.

## Decision

**Settings availability follows the Host answer, not the page origin.** `ui-settings` builds its one describe mirror without a persistence mode. Every page calls `settings.describe` and derives its namespace scopes from the answer; the mirror's terminal `unavailable` state and the scope snapshot's `mode` field are gone. A Host without a settings provider answers with a typed failure, and each surface renders its own unavailable or error state instead of silently keeping defaults.

**Only the native document opener remains loopback-only.** `ui-settings-general` still withholds the “open the settings file” action off-loopback because it runs a Host desktop command. Reading and writing the document do not require a desktop.

**Provider credentials ride the same durable user document.** The Models page lists every declared configurable provider (`DeepSeek`, and the pi-ai routes `openai`, `anthropic`, `google`, `kimi`, and `moonshotai` in the product bundle) and stores a typed key in that user's credential store. The key reference comes from the provider profile (`apiKeyEnv`) or the page's derived `<ROUTE>_API_KEY`, so a web-entered key reaches the next request exactly like a desktop-entered one.

**Authorization stays with the existing transport.** Settings writes use the same browser-session authentication, Host/Origin checks, and field redaction as every other Host API. Each user's `dsh` process owns its own settings document under its own `DSH_HOME`, so a remote write changes only that user's preferences. No new privilege is granted by removing the origin check.

## Alternatives considered

**Add a second, Models-only settings transport for remote pages.** Rejected: the page needs the same describe/mutate/credential reads as every preference row, and a second reader would duplicate the mirror and let two surfaces disagree about the document revision.

**Probe the Host and keep process-local mode as a fallback.** Rejected: the mirror already reports a failed read and keeps the last good view. A second classification state would have no consumer and would hide the real diagnostic behind a silent local mode.

**Read remotely but restrict writes to loopback.** Rejected: it would let a remote user see provider state while being unable to add a key, which is the reported defect. The authenticated user can already run commands and edit their own files through the same page.

## Consequences

A signed-in web user can add or replace the DeepSeek, OpenAI, Anthropic, Google, Moonshot, and Kimi API keys from Settings → Models, and the next request uses them. Appearance, language, busy-Enter, and permission-preset choices also become Host-backed on remote pages, so they follow the user across browsers and origins instead of resetting on reload. The web and desktop now read one settings document per user.

Remote settings writes can change any namespace the Host exposes, including permission defaults and MCP server configuration. That is the same authority the desktop app already offers to the same identity; a deployment that serves untrusted browsers must enforce authentication at its Connection layer, as the shipped web profile does.

A custom composition without a settings provider now reports a failed read on every page rather than keeping preferences process-local. The shipped web and desktop profiles mount the file provider.

## Testing

`packages/client/ui-settings/tests/settings-mirror.client.spec.ts` and `settings-scope.client.spec.ts` cover the host-answered mirror, scope derivation, write fencing, and recovery. `packages/client/ui-settings-models/tests/` covers the provider join, key references, and the missing-document diagnostic. `packages/client/ui-settings-general/tests/apply.client.spec.ts` pins that an off-loopback page still withholds the native document action while reading the Host locale. `packages/client/ui-permission-presets/tests/` covers the permission row over the same mirror.
