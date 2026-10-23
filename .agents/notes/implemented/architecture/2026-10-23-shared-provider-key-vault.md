# Agent Note: Provider keys sync through an encrypted console vault

Status: implemented

English | [中文](2026-10-23-shared-provider-key-vault.zh.md)

## Problem

The desktop app and `harness.mwt.one` are separate harness installations: the desktop reads and writes `%USERPROFILE%\.dsh` on the user's PC, while each web user gets a `dsh` process with its own `/data/users/<id>` home on the VPS. Model-provider API keys live in the local credential store of each installation, so a key entered in Settings → Models on one side never reached the other. The user had to type every provider key twice, and a key rotated on one side silently broke turns on the other.

Both sides already authenticate to the same MWT.ONE console account, and the gateway already hands each web `dsh` a `CONSOLA_TOKEN` and `CONSOLA_API_BASE`. That account is the natural shared identity; what was missing was a shared, authenticated place to keep the provider secrets.

## Decision

**The console owns a per-account, encrypted provider-key vault.** `core.harness_provider_keys` stores `(owner_email, ref, ciphertext, updated_at)`; the Django viewset exposes `GET/POST /api/harness/provider-keys/` and `DELETE /api/harness/provider-keys/<ref>/`, self-scoped to the authenticated email and bypassing module RBAC because it only touches the caller's rows. Values are encrypted with Fernet: `HARNESS_VAULT_KEY` when configured, otherwise a key derived from `DJANGO_SECRET_KEY`. A write response carries the reference and timestamp, never the value.

**A host plugin keeps both installations converged.** `@deepseek-ai/dsh-credentials-console` injects the local `credentials` service, reads the vault on boot and every 60 seconds, applies remote values through `credentials.set`, and pushes every local write. Only references ending in `_API_KEY` participate. A console base or token that is missing leaves the plugin inert, so a composition without a console login keeps working locally.

**First sync seeds existing local keys.** The plugin derives the configurable provider references from the settings descriptors (`llm-pi-ai` provider `apiKeyEnv` or derived `<ROUTE>_API_KEY`, plus `llm-deepseek.apiKeyEnv`) and publishes local values whose source is the stored file. An environment-inherited deployment key is never published as a user key.

**A failed push is a local edit in flight.** The reference stays in a dirty set, so a later pull does not overwrite it before the console accepts it. Remote values otherwise win a pull; the last write across devices wins.

## Alternatives considered

**Run the desktop against the cloud harness.** Rejected by the owner: the Windows installation must stay local so it can read the user's folders and files.

**Sync the whole settings document.** Rejected: provider keys are secrets with a different trust boundary from theme or locale preferences, and the vault must be able to exclude OAuth grants and MCP tokens.

**Store the vault in FaberLoom context or shared content.** Rejected: those rows are visible to Space members and to the context UI. A provider key must stay readable only by its account.

**Derive the vault key from the login password.** Rejected: neither client retains the password after sign-in, and a password change would make existing rows unreadable. `HARNESS_VAULT_KEY` (or the deployment `SECRET_KEY`) is stable and already trusted.

## Consequences

A key saved in the desktop app reaches the web app within one interval (and vice versa), and the first sync after upgrade publishes keys that already existed locally. The console database and its encryption key become part of the provider-secret trust boundary; rotating `DJANGO_SECRET_KEY` without `HARNESS_VAULT_KEY` makes old rows undecryptable, and the plugin simply skips them until the key is written again. OAuth grants, MCP tokens, and credential records stay installation-local.

## Testing

`packages/credentials/credentials-console/tests/vault.spec.ts` covers remote application, dirty-write protection, the seed list and derived reference, local push and unset deletion, the unwired case, and interval disposal. The console endpoint was exercised live with the test account: POST stored an encrypted row, GET returned it to the owner, and DELETE removed it.
