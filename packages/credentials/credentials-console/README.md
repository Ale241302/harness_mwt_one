---
description: "Synchronizes model-provider API keys between the local desktop harness and the cloud web harness through the encrypted MWT.ONE console vault."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-console

English | [中文](README.zh.md)

## Summary

`dsh-credentials-console` keeps the model-provider API keys a person enters in the desktop app and in the web app identical. Both harnesses sign in to the same MWT.ONE console account; the console stores each key encrypted, and this plugin pulls that set on boot and on an interval while pushing every local write. A composition without `CONSOLA_API_BASE` or `CONSOLA_TOKEN` stays fully local.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The product bundle mounts it automatically; no configuration is required when the process carries the console credentials:

```yaml
- name: '@deepseek-ai/dsh-credentials-console'
```

| Field | Default | Meaning |
|---|---|---|
| `consoleBase` | `$CONSOLA_API_BASE` | Console API base, e.g. `https://consola.mwt.one/api` |
| `consoleToken` | `$CONSOLA_TOKEN` | Bearer token; read from the live environment on every call |
| `intervalMs` | `60000` | How often the local store re-reads the vault |
| `refSuffix` | `_API_KEY` | Reference suffix the vault owns |

Only references ending in the suffix are synchronized; a saved key takes effect on the other installation within one interval, and immediately after its own write.

### Setting it up

The console must expose `GET/POST /api/harness/provider-keys/` and `DELETE /api/harness/provider-keys/<ref>/`, authenticated to the same account. The console encrypts values with `HARNESS_VAULT_KEY` (Fernet) or, when absent, a key derived from `DJANGO_SECRET_KEY`.

### What it does on each pass

On boot it reads the vault, writes any remote key the local store does not already hold, and then publishes local `*_API_KEY` values that the vault is missing, so an existing installation does not need its keys re-typed. Every later local write publishes immediately; a failed push is remembered so a pull cannot overwrite that edit before it reaches the console.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin injects `credentials` and reads the optional `settings` seam. It never blocks activation: the first synchronization runs in the background, and a console outage only logs a warning.

### Direction and conflicts

Remote values win on a pull and are applied through `credentials.set`, which emits `credentials/reference-updated`; the plugin ignores that event while a pull is applying. A local write resolves the current value and posts it, or deletes the row when the local source is no longer the stored file (an unset, or a fallback to the deployment environment). Simultaneous edits on two devices are last-write-wins.

### Seed list

The first sync derives provider references from the settings descriptors: each `llm-pi-ai` provider's `apiKeyEnv`, or the derived `<ROUTE>_API_KEY` when the profile names none, plus `llm-deepseek.apiKeyEnv`. Only local values whose source is the stored file are seeded, so a deployment key inherited from the environment never becomes a user key.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [credentials](../credentials/README.md) — the seam this plugin synchronizes.
- [credentials-local](../credentials-local/README.md) — the file-backed store each harness keeps.
- [settings](../../settings/settings/README.md) — the namespace descriptors the seed reads.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly: provider keys are configuration, not prompt content. Synchronizing them changes which credential the next request resolves, never the request prefix.

#### KV Cache effect

None; no key value enters a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Last write wins across devices** — the vault has no revision fence per key; two people or two devices saving the same reference converge on the later push.
- **Removing a key does not reach the other installation** — the vault row is deleted, but a copy already stored on the other harness stays there until that harness saves or clears it.
- **Only `*_API_KEY` references sync** — OAuth grants, MCP tokens, and records stay in the installation that wrote them.
- **A vault outage is invisible beyond a warning** — local keys keep working, and the failed push is retried on the next local write or interval pass.
- **The console holds the key material** — values are encrypted at rest, but the console deployment and its `HARNESS_VAULT_KEY`/`DJANGO_SECRET_KEY` become part of the trust boundary.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The owned relation — a local write reaching the vault and a remote write reaching the local store — is asynchronous network behavior pinned by the unit suite; the credentials seam owns its own event lifecycle invariant.
