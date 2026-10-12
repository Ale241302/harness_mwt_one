# Agent Note: Run a Space session on its agent's provider, model, and key

Status: implemented

English | [中文](2026-10-12-agent-credential-route.zh.md)

## Problem

The product could already record an agent's provider, model, and API key, and the client collected all three. Nothing consumed them. Every chat session ran on the deployment's single DeepSeek connection, and a key stored on an agent was written to the agent record and echoed back only as a tail. Assigning an agent to a Space, or naming one in a chat, could not bill that provider's account. The platform had no way at all to authenticate one call with a caller-supplied credential: the request vocabulary carried a provider route and a model, never a key.

## Decision

**A request can name the credential it authenticates with.** `packages/llm/llm` gains `GenerateOptions.credentialRef` and `LlmCallConfig.credentialRef`, both typed as the credentials seam's own `CredentialRef`, so a request carries a name and never a secret. `llm-deepseek` and `llm-pi-ai` resolve `credentialRef ?? the route's configured reference` through `ctx.credentials`, per call, exactly as they resolved the route reference before. A reference that resolves to nothing fails the call with `MISSING_CREDENTIAL` naming it and sends no request. The field is documented as request state that is never durable.

**The key leaves the agent record.** `packages/faberloom/agents` writes a saved key with `ctx.credentials.set(ref, value)`; the record keeps `hasApiKey` and `apiKeyTail` (the last four characters), and `hasApiKey` is derived from `credentials.describe(ref).configured`, so a key rotated outside the app stops reporting as present. The reference is derived from the agent id rather than stored: `AGENT_CREDENTIAL_REF_PREFIX` plus the uppercase hex of the id's UTF-8 bytes. That derivation is legal for the reference grammar, total for every id the service can mint, and injective; a derivation that substituted characters would make `a-b` and `a_b` collide. A record written before this change still holding a raw key moves it into the seam on its next read, idempotently, and keeps the value if the write is refused. No method of the service resolves or returns the value, so `duplicateAgent` no longer copies a key: it cannot read one back.

**A Space session defaults to its agent's route.** `packages/faberloom/agent-plane` resolves the plane's `credentialRef` when the agent stores a key. `packages/faberloom/session-agent` publishes that as `SessionComposition.route` for the session it composes. `packages/api/session-controller` resolves a session's model in this order: an explicit selection in the durable projection, then the route the session log recorded, then the Space agent's route when the agent declares a provider and a model and stores a key, then the deployment default. The agent's reference is attached to a request only when the effective provider and model equal the agent's route, so a user who picks another model keeps the route's own reference.

**A consultation bills the consulted agent.** `packages/faberloom/tool-faberloom` puts the consulted agent's reference into `AgentOptions` through `planeStartFields()`, so `faberloom_spaces_ask` and `faberloom_spaces_followup` authenticate with that agent's key. The subagent driver hands a child exactly the consulted agent's fields and inherits none from the parent, so an unkeyed target gets no reference and falls back to the deployment default.

**The reference never becomes durable.** `AgentOptions.credentialRef` is request state. The loop seeds it from its own options on every step, because the logged header does not carry it and a multi-step agent must reapply its own key, and it is excluded from the logged `request/header` while still dispatching the request. The model-selection projection, `SessionSelectModelRequest`, and the `model/selection` event carry no reference; tests assert that directly rather than trusting the code path.

**A provider catalog replaces a burned-in model list.** The new `packages/faberloom/model-catalog` (`ctx.faberloomModelCatalog`) owns a frozen provider table (deepseek, openai, anthropic, kimi, google, each with its origin, protocol, and models path), `discover(providerId, credentialRef)` which asks that provider for the models it serves today and normalizes the four reply shapes into one `DiscoveredModel`, `probe(providerId, credentialRef)` which answers `ok`, `invalid-credential`, `quota-exhausted`, `unreachable`, or `unsupported`, and `models()` for the cached last answer. It reuses the LLM package's quota and credential classification, so a verdict agrees with the adapter that will serve the request.

## Alternatives considered

**Storing the reference on the agent record instead of deriving it.** That adds durable state that can drift from the id it names, and it makes a credential reference editable by a record write for no gain. Deriving it keeps one source of truth.

**Keeping the key in the agent record and copying it into the seam on read.** Two homes for one secret, and the record would stay the thing a reader has to audit. Moving it outright costs one lazy migration and removes the second home.

**Adding `credentialRef` to the durable `ModelSelection`.** It is the type that already carries provider and model, so it is the convenient home, and it is exactly wrong: the projection and the session log are durable, and the platform rule is that anything reaching a model request must be reconstructable from the log while a secret never is. A derived name is reconstructable and a stored one would be neither.

**One adapter package per provider.** The shipped adapter already speaks both protocols the providers use (OpenAI chat-completions and Anthropic messages), and every target provider exposes one of them or an OpenAI-compatible shim, so a second adapter would be a copy of the first with a different base URL.

**A distinct failure code for a rate limit that carries billing wording.** HTTP 402 and a billing 403 or 429 describe the same account-level outcome the product has to report. A second code would be a parallel taxonomy for one message, so the existing `QUOTA` classification covers both and a plain 429 stays `RATE_LIMIT`.

**Letting the catalog refresh itself inside the LLM layer.** Model discovery there answers a Models page draft; the routing catalog is owned by settings. Refreshing belongs where the pool is fed, which is the product's own concern, so the catalog lives in the product domain and reads the LLM layer's classification rather than the other way round.

## Consequences

A session no longer needs a deployment-wide key to work: a Space can run on the key its agent holds, a consultation on the key of the agent being consulted, and the credentials seam resolves per operation, so a rotated key reaches the next request without a restart. The agent catalog cannot leak a key it cannot read. The provider set is data, and a model that a provider adds appears on the next discovery instead of waiting for a release.

Three costs and limits are accepted. The shipped DeepSeek model list in `llm-deepseek/src/common/models.ts` is still hardcoded and is already behind what the provider reports (`deepseek-flash` and `deepseek-v4-pro` today); pointing the pool at the catalog is the next step and is why the catalog exists. The surface that tells a user their provider account is out of credit does not exist yet: the classification stops at the error code, and the client renders no `QUOTA` or `AUTH` copy today. And only DeepSeek authenticated among the credentials supplied for this work, so the other four providers are covered by mock servers and by their verified endpoints, not by a live round trip.

Verification: 1364 tests pass across the changed and consuming packages, with 100 percent statement, branch, function, and line coverage on the changed runtime files. A session-controller spec asserts that the agent's route and reference reach the adapter while the session log carries no reference, that an unkeyed or unrouted agent stays on the deployment default, and that an explicit user selection wins and drops the reference. A loop spec asserts that every request dispatches the reference while the logged header omits it.
