---
description: "Native model catalog (ctx.faberloomModelCatalog): the fixed provider protocol table, dynamic model discovery through each provider's models endpoint authenticating with a caller-named credential, and a credential probe answering whether a reference works and whether its account is out of quota."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-model-catalog

English | [中文](README.zh.md)

## Summary

The model catalog publishes `ctx.faberloomModelCatalog`: the fixed provider protocol table, dynamic model discovery through each provider's own models endpoint, and a credential probe. `discover` resolves the credential reference you name through `ctx.credentials`, or the launch environment while no seam is mounted, and normalizes every provider response into one model row. `probe` makes a single bounded request and reports `ok`, `invalid-credential`, `quota-exhausted`, `unreachable`, or `unsupported`. `models` returns the cached last discovery per provider with its timestamp. No payload carries the key.

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

`providers()` returns this table, frozen at module load. `discover` and `probe` read the origin for egress and the protocol for the credential transport.

| id | label | origin | protocol | models path |
|---|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai` | `/models` |
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai` | `/models` |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `messages` | `/v1/models` |
| `kimi` | Kimi (Moonshot) | `https://api.moonshot.ai/v1` | `openai` | `/models` |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `google` | `/models` |

The `openai` protocol sends `Authorization: Bearer <key>`. The `messages` protocol sends `x-api-key: <key>` with `anthropic-version: 2023-06-01`. The `google` protocol sends the key as the `key` query parameter.

-----

<a id="credentials-and-failure-kinds"></a>
## Credentials and failure kinds

`discover` and `probe` resolve the reference you name once per call, in this order: `ctx.credentials.resolve(reference)` while a credentials provider is mounted, otherwise the launch environment value of that reference. A mounted provider that resolves nothing is not retried against the environment, so an empty stored value is never shadowed by an inherited export. No value is cached: a changed credential reaches the next call with no restart, and the key enters no returned payload.

`probe` makes one request with `requestTimeoutMs` as its timeout and reports one of five kinds. `ok` means the credential authenticated and the provider served its model list. `invalid-credential` covers 401, a 403 without billing wording, and a reference that resolves no usable value. `quota-exhausted` covers 402 and a 429 or 403 whose body carries balance, credit, budget, or quota wording. `unreachable` means the request never completed. `unsupported` means the provider id is unknown, or the provider answered a status or body this probe cannot act on. `detail` carries a bounded response excerpt with the key replaced by `[redacted]`.

-----

<a id="model-experience"></a>
## Model Experience

### Discovery and probe requests

#### What the model sees

Nothing directly. The catalog makes host-side requests between a caller and its provider and registers no tool, prompt section, or session event. A caller that renders a discovered row into a model request owns every model-visible consequence; the normalized fields such a caller can forward are `id`, `name`, `contextWindow`, `maxOutputTokens`, `inputModalities`, `outputModalities`, and `effortLevels`.

#### Token effect

Zero direct tokens: no request field, prompt section, or tool schema comes from this package.

#### KV Cache effect

Independent of live requests: the catalog never reads or rewrites a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The provider set is fixed.** `providers()` reports five providers, and adding one is a source change because the table also fixes the credential transport and the models path. `origins` redirects egress only.
- **Discovery reads a provider response, not a capability manifest.** A provider that omits `context_window`, `max_output_tokens`, modalities, or an effort scale yields a row without those fields, and a caller must not invent them.
- **The probe classifies; it does not retry.** One attempt per call, bounded by `requestTimeoutMs`. A rate-limited 429 without billing wording is reported as `unsupported` with its status, because no kind in this catalog describes a throttle.
- **The cached snapshot is process-local.** `models()` reflects discoveries this process made; it is not durable and no timer refreshes it.

No invariant companion is published because the unit spec asserts the table, every provider normalization, both credential-resolution paths, the probe classification, and the cached snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Credential resolution mirrors `resolveApiKey` in `dsh-llm-deepseek`, and the quota classification reuses `isQuotaExceededError`, `QUOTA_EXCEEDED_CODE`, and `INVALID_CREDENTIAL_CODE` from `dsh-llm`, so a quota verdict agrees with the adapter that will serve the request. A provider models response is untrusted wire JSON: a 200 body without a readable model list fails loud instead of reporting an empty catalog, and a row without an id is dropped rather than normalized to a nameless model.

</details>
