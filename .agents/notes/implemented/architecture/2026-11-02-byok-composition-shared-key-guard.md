# Agent Note: Own-key composition, fail-closed scope guard, and real usage limits

Status: implemented

English | [中文](2026-11-02-byok-composition-shared-key-guard.zh.md)

## Problem

Three gaps survived the Mesa closure and made the BYOK promise false. The session composition read the role alone, so a `client_b2b` session kept the shared-key prompt and product tool mask even when its route authenticated with the account's own key. The guard still trusted a business word in the message and any tool result in the history, and its classifier fallback allowed the request by default. And the product text promised that an own key removes every limit, while the gateway proxy, the MCP surface, and the provider each keep their own.

## Decision

The restriction follows the credential the request actually uses. An own key requires an explicit `credentialRef` on the request, resolved from the writable store (`file`) with a value whose SHA-256 is absent from the deployment fingerprints. Without a reference the request is shared, because the desktop proxy route authenticates with `CONSOLA_TOKEN` and a stored key the route does not use proves nothing about who pays. The `faberloom:usage-policy` section and the product tool mask read that state; a key change lands on the next request and lifts or restores the mask, while Space isolation stays enforced under either key.

The guard classifies every human turn. The vocabulary fast path and the tool-result continuation are gone; only a short continuation of an immediately previous turn that the classifier called `work` passes, and that memory is dropped when the credential store changes. `scopeFallback` defaults to `refuse`, and an unverifiable turn receives its own text instead of a personal refusal. A `work` verdict must also clear `scopeWorkConfidence` (0.80) and a second, independently framed confirmation call, so one wrong answer is not enough to spend the deployment's key.

The product states the limits it actually has. The own-key copy says the account leaves FaberLoom's scope limit and the provider still applies its balance, quota, and context window. `LLM_RATE_LIMIT_PER_MIN` is exported and reported by `/healthz` beside the login and MCP windows, the MCP 429 names its limit, and a copy gate fails if an unlimited claim returns. No token quota is invented: the deployment cannot meter a provider it does not call.

## Consequences

- A session can change behaviour between turns without a fiber rebuild: the prompt section is a getter and the mask is a disposer held per agent.
- The guard costs one small classifier call per human turn. That is the price of removing the deterministic bypasses.
- A stored key the route does not use no longer unlocks personal use, which closes the false positive that the old `sharedCredentialRefs[0]` fallback created.
- Space isolation now runs for product tools under both keys, in the same gate that enforces the product set.
- Provider balance, provider rate limits, the model context window, the MCP 120/min, the login 12/min, and the proxy 120/min remain. Only the scope policy is lifted by an own key.
- `gateway/llm-proxy.test.mjs` owns the proxy window: 120 pass, 121 is 429, windows are per account, and the window reopens.

## Alternatives considered

**Keeping the vocabulary fast path and adding more terms** was rejected: any fixed vocabulary is a bypass by construction, and the audit reproduced it with a personal request that contained "MWT".

**Trusting any tool result as continuation** was rejected: it let a personal request ride an unrelated earlier turn. Continuation now needs a recorded work verdict and a human-turn count.

**Resolving `sharedCredentialRefs[0]` when the request carries no reference** was rejected as a false positive: on the proxy route it marks the session as own while the deployment pays.

**Rebuilding the agent fiber on every key change** was rejected: it races a stream in flight and re-registers prompt sections. A dynamic section plus a mask disposer keeps the same effect at the turn boundary.

**Adding a client-side monthly token quota** was rejected: it would be advice, not enforcement, and the deployment never sees BYOK usage.

## Testing

`packages/faberloom/session-agent/tests/session-agent.spec.ts` covers `C-B01.1` through `C-B01.5` and `C-B02.1` through `C-B02.11`, including the stored-key false positive, the install-time own-key composition, the mid-session key change, the credential event and its turn-boundary mask move, the business-word bypass, the tool-history bypass, the unverified refusal, the cached continuation, a low-confidence work verdict, and a disagreeing confirmation. `tests/copy-limits.spec.ts` is `C-B03.1`; `gateway/llm-proxy.test.mjs` covers `C-B03.2` through `C-B03.4`; `routing-e2e.host.spec.ts` covers `C-B03.6`; `gateway/gateway-limits.test.mjs` covers `C-B03.5` and `C-B03.7`. Package suite: 90 tests; gateway: 7 tests; `tsc` on the package at zero.

A live probe against DeepSeek classified «MWT: escribime un poema de amor» as personal (0.98 with the previous instruction, 0.99 with the current one, 0.98 in the confirmation) and the work control as work (0.98 and 0.95). The known adversarial case is not misclassified; the two-step decision covers the rest.

## Deferred

The provider's own balance and quota cannot be raised from the product, and with an own key the deployment cannot warn before the provider cuts the account off. `C-B03.7` pins the MCP error body and asserts its 429 status line by source, because the gateway cannot boot without its deployment environment; the deployed `/healthz` reports the third window only after this change ships. A personal phrase of forty characters or fewer that opens with a continuation token (`dale, escribime un poema`) passes without classification after a turn the classifier called work; the length limit keeps it from covering a longer request. A route that resolves its key through `apiKeyEnv` reports that reference through `listProviders()`, so a stored value the route wins counts as the account's without a per-request reference. Two independent answers that both call a personal request `work` remain a model error; one wrong answer no longer suffices to spend the key.
