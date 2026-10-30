# Agent Note: the picker reads live discovery, and the adapter's last id list retires

Status: implemented

English | [中文](2026-10-13-live-discovery-picker-and-kimi-origin.zh.md)

## Problem

The Host projection that feeds the model picker ([`packages/api/session-controller/src/catalog.ts`](../../../../packages/api/session-controller/src/catalog.ts)) listed each route through `ctx.llm.listModels` but never called discovery, so an open picker showed live ids only after the deployment's reconcile path had run. `llm-deepseek` still advertised a burned-in id list (`FALLBACK_MODELS`) whenever nothing had been discovered, and the picker could not tell a discovered catalog from an invented one: a keyless or unreachable provider and a provider that serves nothing looked the same.

Two live facts measured today changed what the catalog table can claim. The `kimi` entry named the Moonshot platform surface, but the key the product holds is the Kimi coding plan's — the entry reported `invalid-credential` for a working key. And a Kimi generation refusal arrives as a 403 whose body carries cycle-scoped quota wording ("You've reached your monthly usage limit for this billing cycle. Your quota will be refreshed in the next cycle."), which the catalog's own table read as a rejected credential before it looked at the body.

## Decision

- `buildModelCatalog` folds discovery. For each mounted route, a descriptor whose `routes` lists it is asked through `ctx.faberloomModelCatalog.discover` before `ctx.llm.listModels` reads the snapshot that call just recorded, so an open picker shows the provider's live ids with no separate reconcile step. `ProviderDescriptor` gains `routes` (the harness route ids whose listing this provider resolves) and `credentialRef` (the reference discovery authenticates with when a caller names none). A route no descriptor lists is left alone: `discover` is never called for it, and its listing stays its adapter's own answer.
- A discovery refusal is reported, never hidden. When a route's listing is empty and its discovery refused, the projection reports a `ModelCatalogFailure` carrying the refusal's machine code (`MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `QUOTA`, `RATE_LIMIT`, `BAD_REQUEST`, `TRANSPORT`, `UNSUPPORTED`) instead of an empty or invented group. `ModelCatalogModel` gains `contextWindow` and `maxOutputTokens`, read from the discovered row; a capacity the provider did not declare stays absent.
- `llm-deepseek` carries no id list. `resolveCatalogModels` returns a written `models` list, else the discovered rows with every fact the provider declared — including `systemPromptUpdate`, which DeepSeek reports under `api_capabilities.anthropic_messages.system_prompt_update` and the catalog now normalizes. The `Config.models` default is empty, so a deployment that pins nothing and discovers nothing advertises nothing.
- `kimi` points at the coding plan (`https://api.kimi.com/coding/v1`), and the pay-as-you-go platform is its own `moonshotai` entry with its own `MOONSHOT_API_KEY` reference.
- `failureKind` delegates to the shared `providerAccountFailureCode` and `isContextWindowExceededError`, so a 401 is a rejected credential, quota wording on any status is an exhausted account, and only then does the status decide a throttle or a refused request.
- The keyless snapshot composition (`snapshots/session/system-prompt-in-history/cordis.yml`) pins its own `llm-deepseek.models`, because a keyless record-time composition mounts no discovery and cannot invent a capability.

## Alternatives considered

- **Keep the reviewed fallback under discovery and mark it visible.** Rejected: the fallback's ids and 1,000,000-token context were already stale against the live endpoint (which reports 1,048,576), so it was a wrong answer with a correct-looking shape. The capability that justified it is reported by the endpoint, so discovery alone is enough.
- **Pin the reviewed catalog in base or in `faberloom-app`.** Rejected: a written list wins outright over discovery, so pinning the product's ids would disable live discovery for the one deployment that has a working key. Only a composition that cannot discover — a keyless snapshot record — pins.
- **Keep the route-to-provider correspondence in `session-controller`.** Rejected: the mapping belongs to the catalog entry that owns the surface, and a route no discovered row feeds must not trigger a network call.
- **Keep the catalog's own failure table.** Rejected: it read 403 before the body, so Kimi's quota refusal was reported as a credential problem; the shared classifier already orders quota wording ahead of the status and the adapters use it, so one classifier keeps the verdict the surface shows and the verdict a request would hit in agreement.

## Consequences

- An open picker shows the ids the provider serves after one discovery, with the provider's own names, context windows, and output caps; the page no longer needs a deployment reconcile step.
- A provider that served nothing says so: a missing key is `MISSING_CREDENTIAL` and renders as a localized no-credential line, and a ready catalog with no rows renders the no-results copy. No id is invented anywhere.
- `kimi` authenticates the coding-plan key and lists its four models; `moonshotai` stays the platform surface for a deployment that holds that key.
- Recorded-session replay is unaffected: replay compositions disable `llm-deepseek` and declare their models through `llm-replay`, so the adapter's catalog never reaches them.
- Live verification (`packages/faberloom/model-catalog/tests/live-discovery.e2e.ts`) covers DeepSeek, OpenAI, and the Kimi coding plan with their real keys, and the keyless states for Kimi, Moonshot, and Google; the composed picker projection was checked live against `https://api.deepseek.com/v1/models`.
