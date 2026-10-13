# Agent Note: per-agent routing is proved over a real composition with provider stubs

Status: implemented

English | [中文](2026-10-13-per-agent-routing-real-composition-proof.zh.md)

## Problem

An agent's declared provider, model, and own API key must decide its turn's route: a keyed agent leaves through its own provider authenticated with its own key, an unkeyed agent keeps the route's own `.env` credential, and a credit-exhausted account is a typed outcome rather than a generic failure. The package's specs proved route selection over a hand-built `ctx.plugin(...)` context with a scripted `MockAdapter`. That shows the `agent/request` waterfall rewrites a config object; it cannot show that a request reaches the declared provider authenticated with the declared credential, because no provider boundary and no credential seam participate. The package-rules policy also requires a real-composition test for a product-visible plugin, which this package did not have.

## Decision

A real-composition end-to-end suite in `packages/faberloom/session-agent/tests/`.

- `routing-harness.ts` boots the real `dsh-llm`, `dsh-agent-loop`, `dsh-session`, `dsh-system-prompt`, `dsh-tools`, `dsh-credentials-local`, `dsh-faberloom-agent-plane`, and `dsh-faberloom-session-agent` from a test-only `cordis.yml` through the actual Loader, with a custom importer mirroring a deployed `node_modules`. Only the external systems are doubles: the provider endpoint, and the catalog, workspace registry, and Space records that are the durable product stores outside the routing seam.
- `routing-provider.ts` runs a local OpenAI-compatible HTTP stub that records every request's `Authorization` header and body, plus the adapter that performs the exchange. The adapter resolves the request's credential reference through `ctx.credentials` and falls back to the route's own reference, and it maps a provider HTTP failure through the shipped `providerAccountFailureCode` and `providerFailureMessage`, so credit exhaustion is classified by `dsh-llm` rather than by a private table.
- `routing-e2e.host.spec.ts` pins the Fase 1 claims: a keyed agent's turn arrives at its own provider with its own key and the deployment environment key is never used; an unkeyed agent's turn keeps the route's own `.env` credential; one session runs two agents on two providers; a Space session runs its assigned agent while a mention's route wins; a `402` `insufficient_balance` body surfaces as `QUOTA` with the provider suffix and the session completes its next turn; and no raw key or key reference appears in the session log or a failure payload.
- `routing-live.e2e.ts` is the keyed live smoke, run against real provider origins and self-skipping without each credential it needs. Three turns are covered: a keyed catalog agent's own key reaches OpenAI (`OPENAI_API_KEY`); an agent without a key keeps the deployment DeepSeek route's own `.env` credential (`DEEPSEEK_API_KEY`); and a keyed agent's own key reaches DeepSeek while the route's own credential is empty. The provider double records the origin, model, and `Authorization` header of each exchange, so an assertion reads which provider and credential the turn used rather than a message. A funded-key-less OpenAI account answers with OpenAI's own credit-exhaustion body, which surfaces as the typed `QUOTA` outcome with the `(provider "openai")` suffix; that answer is the passing result, because it proves the provider, model, and key were used.

The README now states the contract these specs exercise: a mention wins for its turn over the session's own route, including the Space agent's route a composed session starts from.

## Alternatives considered

- **Extend the existing `MockAdapter` suite.** Rejected: an adapter that never performs a wire exchange cannot show which credential the provider received, and the package-rules policy requires Loader-level composition for a product-visible plugin.
- **Use the shipped DeepSeek adapter for the deployment route and a second real adapter for the agent routes.** Rejected: `llm-deepseek` registers a fixed provider route and belongs to another workstream, and `llm-pi-ai` is out of scope; a stub the spec owns keeps the proof deterministic and offline, and the keyed live smoke still crosses a real provider boundary.
- **Assert credit exhaustion against the stub's own error mapping only.** Rejected: the taxonomy lives in `dsh-llm`, so the double maps the body through the shipped classifier and the assertion reads the real machine code; a private mapping would have proved the fixture, not the product.

## Consequences

- A regression in per-agent routing, credential selection, or account-failure typing fails a Loader-composition suite within seconds, without a network call and without a provider key.
- The suite owns three HTTP stubs and a temporary harness home per test, disposed with the composition; specs run concurrently beside other gate processes.
- A new provider route used by a fixture agent must also be served by the stub adapter, so a routing change that needs a real wire format change updates the double in the same change.
- The keyed live smoke is the only case that crosses a real provider boundary; it skips without a credential, so it runs where one exists rather than in keyless CI, and a routing change that breaks a real provider's wire contract is caught there.
