# Agent Note: Serve a named provider route from the deployment

Status: implemented

English | [中文](2026-10-12-bring-your-own-provider.zh.md)

## Problem

The harness ran every session on the deployment's single DeepSeek connection. The pi-ai adapter could route to other providers, but the shipped composition declared no non-DeepSeek route, and a profile that declared one by hand had to restate the endpoint, the protocol, and the model catalog the installed catalog already knew. The product's own name for Kimi's coding plan did not resolve at all, so an agent naming it had nothing to reach. When a route did run, an account-level refusal arrived as a generic failure: the supplied credential authenticated, but the account held no credit, and the wording the provider returned was not one the classifier matched or the client reported.

## Decision

**A product route key resolves an installed catalog provider under a different id.** `packages/llm/llm-pi-ai/src/catalog.ts` declares `CATALOG_ROUTE_ALIASES`, currently `{ kimi: 'kimi-coding' }`, and `catalogIdFor` reads it on every provider lookup, so the product route key `kimi` resolves the installed `kimi-coding` provider's endpoint, protocol, display name, and model catalog exactly as the catalog id itself would, without the profile restating any of them. `moonshotai` needs no alias because the Moonshot platform is already its own catalog provider, so Kimi's coding plan and the Moonshot platform stay separate routes with separate credentials. The alias exists only at the route key: the profile still configures `apiKeyEnv`, and credential resolution never reads the table, so a per-call `credentialRef` still wins.

**Which provider routes run is the deployment's, declared in the product bundle.** `packages/bundle/faberloom-app/cordis.patch.yml` declares five pi-ai profiles — `openai`, `anthropic`, `google`, `kimi`, `moonshotai` — each naming only an `apiKeyEnv` reference, because which adapters exist is composition (`packages/bundle/base/cordis.patch.yml` mounts `dsh-llm-pi-ai` dormant, with no routes) while which providers run is the deployment's. `gateway/server.mjs` restates the same five profiles in the per-user patch it renders, resolves each key through `readSecret` so the `<NAME>_FILE` Docker-secret form works, and injects the value into the child process environment, so the patch carries the reference and never the value. `.env.example` and `README.mwt-one.md` document the reference set.

**The five shipped routes and the protocols they resolve.** `packages/llm/llm-pi-ai/tests/config.spec.ts` asserts each route resolves the installed catalog's endpoint and wire protocol: `openai` at `https://api.openai.com/v1` over `openai-responses`; `anthropic` at `https://api.anthropic.com` over `anthropic-messages`; `google` at `https://generativelanguage.googleapis.com/v1beta` over `google-generative-ai`; `kimi` at `https://api.kimi.com/coding` over `anthropic-messages`, taking its model ids from the catalog because that endpoint publishes no models list; and `moonshotai` at `https://api.moonshot.ai/v1` over `openai-completions`. The native `deepseek-official` route belongs to the separate `dsh-llm-deepseek` adapter — chat-completions at `https://api.deepseek.com` and Anthropic Messages at `https://api.deepseek.com/anthropic` — and the spec leaves `deepseek` out for that reason.

**An agent's own key wins per call.** `GenerateOptions.credentialRef` overrides the route's `apiKeyEnv` reference on that request, and the route's key is only the deployment fallback for a call that names none; the [agent-credential-route note](2026-10-12-agent-credential-route.md) owns credential resolution.

**An unfunded account is classified.** `packages/llm/llm/src/error.ts` declares the wording a live exhausted account returns: `isQuotaExceededError` matches a flattened message that asserts an absent balance ("no credits remaining"), which the earlier patterns missed, and the pattern requires the absent balance, so a genuine throttle — which names a rate — cannot match it. `providerAccountFailureCode` reports that response as `QUOTA`, so an HTTP 429 whose body is a billing message is classified as an empty account rather than a transient rate limit.

**The failure names the account, and the client says where to fix it.** `providerFailureMessage` appends ` (provider "<route>")`, whose format is that composer's documented contract, and `packages/client/ui-chat` reads the suffix back and renders a localized notice for the `QUOTA` and `AUTH` cases that names the provider and points at the provider's own account. The route id travels beside the failure code rather than as a structured field on the durable failure, because a new durable field is a declared persistence-type change; the client therefore reads the route id from the message suffix the harness composes.

## Alternatives considered

**Serving Kimi only as the Moonshot platform route.** The platform and the coding plan are different products with different endpoints and different credentials, and the credential the owner holds is the coding plan, so one route would authenticate the wrong product. The catalog ships them as two providers and the alias resolves the coding plan's route key.

**One adapter row per provider.** Every route already resolves through one installed catalog provider that owns its endpoint, protocol, display name, and model catalog, so a hand-declared row per provider would restate a route profile with twenty-six configurable compat fields for facts the catalog already holds.

**Burning a model list into configuration.** The installed catalog owns each provider's model list, and a provider that adds a model would wait for a release to appear; the alias resolves the catalog's list instead, including for the coding plan that publishes none.

**Adding a structured provider field to the durable failure now.** A field on the durable failure is the clean shape, and it is deferred: the change needs the declared persistence-type-change acknowledgement machinery. The route id travels in the failure message's documented ` (provider "<route>")` suffix until that change is made.

## Consequences

Five provider routes come from five key references, and each provider's endpoint, protocol, and model catalog stay the catalog's data, so a shipped route is one configuration line and a model a provider adds appears without a release. The product presents Kimi's coding plan and the Moonshot platform as distinct routes, and an agent can name either. A user whose provider account is unfunded is told which account to top up, and a rejected key is told where to correct it, without either message carrying a credential value.

A live OpenAI key with no credit answers HTTP 429 with the "no credits remaining" wording, and the owner's Kimi coding credential answers HTTP 403 with a monthly-quota message at the coding endpoint; both credentials authenticated. Every credential supplied for this work authenticated but held no funds, so the non-DeepSeek routes are covered by their verified catalog endpoints and by mock servers rather than by a live round trip.
