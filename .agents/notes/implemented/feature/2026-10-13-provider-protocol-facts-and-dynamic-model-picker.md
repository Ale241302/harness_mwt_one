# Agent Note: provider protocol facts, distinct discovery failures, and a discovery-backed model picker

Status: implemented

English | [中文](2026-10-13-provider-protocol-facts-and-dynamic-model-picker.zh.md)

## Problem

The model catalog carried one protocol fact per provider — the models path and a protocol-derived credential transport — and mapped every rejected models request to one of four kinds with no distinction between a rejected key, an absent key, an exhausted balance, a throttle, and a malformed request. A provider whose own error body reports an invalid key as a 400 (Google) was classified `unsupported`, and a missing credential was reported as `invalid-credential`, so a surface could not tell "configure a key" from "replace the key".

The composer's model picker localized descriptions for two hardcoded DeepSeek model ids, which contradicts a catalog that exists to replace a burned-in list, and it re-read its catalog only on a Host event with no freshness policy and no visible last-checked state. `llm-deepseek` advertised a literal list of upstream model ids as its default catalog, so the list a user picked from was a source constant rather than what the provider serves.

## Decision

- `ProviderDescriptor` (`packages/faberloom/model-catalog/src/types.ts`) gains `auth` (a discriminated credential transport: `bearer`, a named `header` with constant headers, or a `query` parameter), `errorShape` (`openai`, `anthropic`, or `google`), and `docs` (the provider documentation pages the entry was read from). Every `PROVIDERS` entry states all three. `kimi` is the Kimi coding plan — `https://api.kimi.com/coding/v1/models`, the surface the product's `kimi` route calls — and the pay-as-you-go Moonshot platform is its own `moonshotai` entry, documented at its recorded source URL. (Live correction recorded in [the picker/discovery note](2026-10-13-live-discovery-picker-and-kimi-origin.md): the coding plan publishes a models endpoint, so it is a row here, not only a pi-ai route.)
- `ProbeKind` gains `no-credential`, `rate-limited`, and `bad-request`. `probe` reports `no-credential` for a reference that resolves nothing and keeps `invalid-credential` for a value that cannot travel in a header, so absent and malformed are different states. Classification reads the provider's own error body (`error.message` plus `error.type`/`error.code`, or Google's `error.status`) and judges billing wording before the status, then 429 as a throttle, then a 400 whose text names the credential as a rejection, then 401/403.
- `PROBE_FAILURE_CODES` and the individual machine codes (`NO_CREDENTIAL_CODE`, `RATE_LIMITED_CODE`, `BAD_REQUEST_CODE`, `UNREACHABLE_CODE`, `UNSUPPORTED_CODE`) are exported. The user-facing text stays with the surface that renders a verdict; the catalog exposes codes and the provider's own bounded message excerpt only.
- `llm-pi-ai` endpoint discovery gives each refusal its own code too: 401/403 `INVALID_CREDENTIAL`, 402 `QUOTA`, 429 `RATE_LIMIT`, 400 `BAD_REQUEST`, otherwise `DISCOVERY_FAILED`.
- `ui-model-selection` drops the hardcoded model-id description map; a model's detail is the provider name plus the description the Host reported. `ModelCatalogDirectory` gained a freshness window, so an open inside it serves the cache and an open after it re-reads, and the composer menu shows the last-checked line with a refresh control.
- `llm-deepseek` resolves its catalog from the deployment's discovery: `resolveCatalogModels` returns a written `models` list outright, otherwise the rows `ctx.faberloomModelCatalog.models()` reports for `deepseek`, and nothing when nothing has been discovered. The plugin reads the snapshot through `ctx.get` and versions its memo by the snapshot time, so a new discovery reaches the next request without a restart. (The reviewed fallback this bullet once named is retired by [the picker/discovery note](2026-10-13-live-discovery-picker-and-kimi-origin.md); the endpoint reports the capability the fallback used to carry.)

## Alternatives considered

- **Keep the protocol table protocol-only and let each caller infer auth and error handling.** Rejected: Moonshot and Google read the key differently and report failures in different body fields, so the inference belongs to the provider entry, not to every caller.
- **Rename the `google` provider id to `gemini`.** Rejected: the id crosses into `packages/llm/llm`, `packages/api/session-controller`, and the product panels, which other workstreams own; the label already reads "Google Gemini".
- **One shared error parser for all providers.** Rejected: Google reports an invalid key as a 400 with status `API_KEY_INVALID`, so a status-only parser would call it a bad request and send the user to fix the wrong thing.
- **`failureKind` reads the shared classifier.** The catalog's probe classification delegates to `providerAccountFailureCode` and `isContextWindowExceededError`, so Kimi's cycle-scoped quota refusal on 403 is an exhausted account rather than a rejected key ([detail](2026-10-13-live-discovery-picker-and-kimi-origin.md)).
- **Delete `DEFAULT_MODELS` outright and default the DeepSeek catalog to empty.** Originally rejected because the committed session snapshots and the `apps/web` model settings goldens encode the default catalog's ids, and because `systemPromptUpdate: in-history` looked like a fact no listing endpoint reports. [The picker/discovery note](2026-10-13-live-discovery-picker-and-kimi-origin.md) reverses this: the live endpoint reports the capability under `api_capabilities`, replay compositions disable `llm-deepseek`, and the keyless snapshot composition now pins its own list.
- **Make the composer picker read the faberloom model pool instead of `ctx.llm.listModels`.** Rejected: that projection lives in `packages/api/session-controller` and `packages/faberloom/view`, outside this change's ownership.

## Consequences

- A caller can route on a stable code and pick its own copy: absent credential, rejected credential, exhausted balance, throttle, malformed request, unreachable endpoint, and unclassifiable response are seven distinct outcomes.
- Discovery is the source for which DeepSeek ids exist; a model the provider starts serving appears with no code change once discovery has run, and nothing is advertised until it has.
- Live verification covers DeepSeek, OpenAI, and the Kimi coding plan with their real keys, and the keyless states for Kimi, Moonshot, and Google: `packages/faberloom/model-catalog/tests/live-discovery.e2e.ts` self-skips without a key and proves discovery and probe against the real endpoints.
- The composer picker reads the Host projection built by `packages/api/session-controller/src/catalog.ts`, which now folds discovery for the routes a catalog descriptor links: [the picker/discovery note](2026-10-13-live-discovery-picker-and-kimi-origin.md) carries that change.
