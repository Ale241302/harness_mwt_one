---
description: "Native model catalog (ctx.faberloomModelCatalog): the fixed provider protocol table, dynamic model discovery through each provider's models endpoint authenticating with a caller-named credential, and a credential probe answering whether a reference works and whether its account is out of quota."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-model-catalog

English | [中文](README.zh.md)

## Summary

The model catalog publishes `ctx.faberloomModelCatalog`: the fixed provider protocol table, dynamic model discovery through each provider's own models endpoint, and a credential probe. `discover` resolves the credential reference you name through `ctx.credentials`, or the launch environment while no seam is mounted, and normalizes every provider response into one model row. `probe` makes a single bounded request and reports `ok`, `no-credential`, `invalid-credential`, `quota-exhausted`, `rate-limited`, `bad-request`, `unreachable`, or `unsupported`, each carried by a stable machine code (`MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `QUOTA`, `RATE_LIMIT`, `BAD_REQUEST`, `TRANSPORT`, `UNSUPPORTED`). `models` returns the cached last discovery per provider with its timestamp. No payload carries the key.

## Table of Contents

- [Use this package](#use-this-package)
- [Providers](#providers)
- [Credentials and failure kinds](#credentials-and-failure-kinds)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row wherever the product asks which models a provider serves or whether a credential works. It publishes `ctx.faberloomModelCatalog` and requires no other service: the credentials seam is optional and read once per call. `requestTimeoutMs` bounds one provider request (default 5000, at most 60000). `origins` redirects one provider's egress to a self-hosted gateway or a regional host or a test server; the provider ids, protocols, and models paths stay those of the table.

-----

<a id="providers"></a>
## Providers

`providers()` returns this table, frozen at module load. `discover` and `probe` read the origin for egress, the models path for the request, the auth entry for the credential transport, and the error shape for a rejected response.

| id | label | origin | protocol | models path | auth | error shape |
|---|---|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai` | `/models` | bearer | openai |
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai` | `/models` | bearer | openai |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `messages` | `/v1/models` | `x-api-key` + `anthropic-version: 2023-06-01` | anthropic |
| `kimi` | Kimi Code | `https://api.kimi.com/coding/v1` | `openai` | `/models` | bearer | openai |
| `moonshotai` | Moonshot (platform) | `https://api.moonshot.ai/v1` | `openai` | `/models` | bearer | openai |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `google` | `/models` | `key` query parameter | google |

`auth` is one of: `{ kind: 'bearer' }` sending `Authorization: Bearer <key>`; `{ kind: 'header', name, static? }` sending the key under a named header beside any constant headers; or `{ kind: 'query', name }` sending the key as a query parameter. Each entry also carries `docs`, the provider documentation pages its origin, models path, and auth were read from.

Each entry carries two harness facts beside its wire facts. `routes` names the harness LLM route ids whose requests resolve their model listing from this provider's discovery — only `deepseek` names one (`deepseek-official`) today; a route absent here reads its own adapter knowledge. `credentialRef` is the conventional credential reference discovery authenticates with when a caller names none. A selection surface that projects a route's discovered rows reads both fields and calls `discover` itself, so an open picker shows live ids with no separate reconcile step.

`kimi` is the Kimi Code coding plan (`https://api.kimi.com/coding/v1/models`), the surface the product's `kimi` route calls; its models endpoint answers `200` with a `{ "data": [ ... ] }` list under either `x-api-key` or `Authorization: Bearer`. The published platform documentation states the Kimi Code API is independent of the pay-as-you-go API and the two keys are not interchangeable ([product plans](https://platform.kimi.ai/docs/guide/product-plans)); its credential reference is therefore `KIMI_API_KEY`. `moonshotai` is the separate pay-as-you-go platform surface, documented at `https://platform.kimi.ai/docs/api/list-models`, whose key is referenced as `MOONSHOT_API_KEY`; the PRC console issues keys for `https://api.moonshot.cn/v1`, which exposes the same path.

`error shape` names where a rejected response puts its message and which identifier classifies the failure. `openai` reads `error.message`, `error.type`, and `error.code` (DeepSeek, OpenAI, Kimi). `anthropic` reads `error.message` and `error.type`. `google` reads `error.message` and `error.status`; Google reports an invalid key as a 400 with status `API_KEY_INVALID` rather than a 401, and this shape is what keeps that case out of `bad-request`.

-----

<a id="credentials-and-failure-kinds"></a>
## Credentials and failure kinds

`discover` and `probe` resolve the reference you name once per call, in this order: `ctx.credentials.resolve(reference)` while a credentials provider is mounted, otherwise the launch environment value of that reference. A mounted provider that resolves nothing is not retried against the environment, so an empty stored value is never shadowed by an inherited export. No value is cached: a changed credential reaches the next call with no restart, and the key enters no returned payload.

`probe` makes one request with `requestTimeoutMs` as its timeout and reports one of eight kinds, each with a stable machine code from `PROBE_FAILURE_CODES`. `ok` means the credential authenticated and the provider served its model list. `no-credential` means no usable value resolved for the reference — absent or empty — and carries `MISSING_CREDENTIAL`, deliberately distinct from a rejected key. `invalid-credential` covers 401, a 403 without billing wording, a 400 the provider's own error body marks as an invalid key (Google), and a reference that resolves a value no HTTP header can carry. `quota-exhausted` covers 402 and any status whose body carries balance, credit, budget, or quota wording. `rate-limited` covers a 429 that names a rate rather than a balance. `bad-request` covers a 400 that names no credential problem. `unreachable` means the request never completed. `unsupported` means the provider id is unknown, or the provider answered a status or body this probe cannot act on. `detail` carries the provider's own message excerpt, bounded in length and with the key replaced by `[redacted]`. `discover` throws an `LlmError` carrying the same code as the matching kind.

-----

<a id="model-experience"></a>
## Model Experience

### Discovery and probe requests

#### What the model sees

Nothing directly. The catalog makes host-side requests between a caller and its provider and registers no tool, prompt section, or session event. A caller that renders a discovered row into a model request owns every model-visible consequence; the normalized fields such a caller can forward are `id`, `name`, `contextWindow`, `maxOutputTokens`, `inputModalities`, `outputModalities`, `effortLevels`, and `systemPromptUpdate`. DeepSeek reports a row's `systemPromptUpdate` under `api_capabilities.anthropic_messages.system_prompt_update`; only `in-history` is modeled, so any other spelling stays absent.

#### Token effect

Zero direct tokens: no request field, prompt section, or tool schema comes from this package.

#### KV Cache effect

Independent of live requests: the catalog never reads or rewrites a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The provider set is fixed.** `providers()` reports six providers, and adding one is a source change because the table also fixes the credential transport, the models path, and the error shape. `origins` redirects egress only.
- **Discovery reads a provider response, not a capability manifest.** A provider that omits `context_window`/`context_length`, `max_output_tokens`, modalities, an effort scale, or an `api_capabilities` declaration yields a row without those fields, and a caller must not invent them.
- **The probe classifies; it does not retry.** One attempt per call, bounded by `requestTimeoutMs`, and each failure keeps a stable machine code. No rate-limit backoff or `Retry-After` handling lives here.
- **The cached snapshot is process-local.** `models()` reflects discoveries this process made; it is not durable and no timer refreshes it.

No invariant companion is published because the unit spec asserts the table, every provider normalization, both credential-resolution paths, the probe classification, and the cached snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Credential resolution mirrors `resolveApiKey` in `dsh-llm-deepseek`, and the quota classification reuses `isQuotaExceededError`, `QUOTA_EXCEEDED_CODE`, and `INVALID_CREDENTIAL_CODE` from `dsh-llm`, so a quota verdict agrees with the adapter that will serve the request. A provider models response is untrusted wire JSON: a 200 body without a readable model list fails loud instead of reporting an empty catalog, and a row without an id is dropped rather than normalized to a nameless model.

</details>
