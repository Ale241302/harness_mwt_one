---
name: dsh-usage-limits
description: Use when describing, enforcing, or testing what a FaberLoom account may consume, especially the claim that a user's own provider key removes limits. Covers provider balance and quota errors, context windows, the gateway model proxy and MCP rate limits, and product copy that must not promise unlimited use.
---

# Usage limits: what BYOK does and does not remove

Owns the statements the product makes about consumption, and the code paths that enforce them. It spans `gateway/llm-proxy.mjs`, `gateway/server.mjs`, `packages/llm/llm`, `packages/faberloom/session-agent/src/policy.ts`, and the shared skill `skills-shared/politica-llave-compartida`.

A user's own key removes one limit: the shared-key scope policy. It removes no provider limit and no product limit.

## Limit inventory

Every row needs an owner, an enforcement point, and a test. A row without a test is a copy change waiting to become a lie.

| Limit | Applies to | Owner | Enforced at | Test |
|---|---|---|---|---|
| Scope: work about MWT.ONE, SICOP, and the account's mail | Shared key only | session-agent guard | `llm/stream` | `session-agent.spec.ts` C-B02.1–C-B02.8 |
| Provider balance and quota | Both keys | provider | HTTP 402/429 mapped to `QUOTA` in `packages/llm/llm/src/error.ts` | `ui-chat` turn-error projection; `routing-e2e` credit exhaustion |
| Provider request rate | Both keys | provider | provider HTTP 429 | provider-side; no product test |
| Model context window and max output | Both keys | model catalog | request assembly | catalog payload; no product test |
| Model proxy 120 requests per account per minute | The proxy route, i.e. the shared key | `gateway/llm-proxy.mjs` | 429 `rate_limit_error` | `gateway/llm-proxy.test.mjs` C-B03.2–C-B03.4 |
| MCP 120 requests per account per minute | Both keys | `gateway/server.mjs` | 429 JSON-RPC error | `gateway/gateway-limits.test.mjs` C-B03.7 pins the body; the 429 status line is asserted by source, not exercised |
| Login 12 attempts per minute | Both keys | `gateway/server.mjs` | 429 | no product test; `C-B03.5` pins only the `/healthz` field |
| Board API per-request authorization and tenant scope | Both keys | `gateway/board-api.mjs` | 403/404 | `gateway/board-api.test.mjs` |
| Product token quota | — | none exists | no code path; do not claim one | — |

## Invariants

1. **No shipped string claims unlimited use.** The phrases "sin límite", "no tiene límite", "ilimitado", and "unlimited" are false for this product. Say instead: "sale del límite de alcance de FaberLoom; el proveedor aplica su saldo, su cuota y su ventana de contexto".
2. **One home per limit.** The table above is the source; a prompt, a skill, and a settings hint restate the user-facing consequence, never a different number.
3. **Limits that survive BYOK are named as such.** The MCP rate limit, the login limit, the board authorization, and the provider limits apply with either key.
4. **A limit surfaced to the user names the actor and the remedy.** A `QUOTA` failure names the provider and says to top up or raise the limit in the user's own account; a product rate limit says to wait.
5. **No invented quotas.** Do not add a daily or monthly token budget for BYOK. The deployment cannot meter a provider it does not call, and a client-side counter would be advice, not enforcement.

## Procedure

1. Reproduce the current claim: search the shipped copies and record each hit with `file:line`.
2. Fix the copy in the same change as the test that guards it: the product persona, the usage policy, the bundle comment, and the shared skill table.
3. Export the model-proxy window from `gateway/llm-proxy.mjs` and add it to the gateway `healthz` payload, so the limit is observable beside the other two.
4. Add `gateway/llm-proxy.test.mjs` with `node:test`: 120 requests pass, the 121st answers 429, a second account keeps its own window, and the window reopens after the interval.
5. Confirm the `QUOTA` path still reaches the chat as a provider-named failure; add a case if the provider id is dropped.
6. State the residual: with BYOK the deployment cannot see usage, so it cannot warn before the provider cuts the account off.

## Copy gate

Add one test that reads the shipped policy strings and fails on `/sin l[ií]mite|no tiene l[ií]mite|ilimitad|unlimited/i`. Keep the list of sources in the test, not in prose, so a new string is a deliberate edit.

## Required cases

| Case | Expected |
|---|---|
| Personal request under the shared key | Refused; text offers Ajustes → Modelos |
| Own key, provider returns 402 | `QUOTA` failure naming the provider |
| Own key, provider returns 429 | Provider rate-limit failure, not a product quota |
| Own key, MCP call 121 in a minute | 429 from the gateway; unchanged by the key |
| Proxy route, 121 model requests in a minute | 429 `rate_limit_error`; the window is per account |
| `/healthz` | Reports login, MCP, and model-proxy windows |
| Any shipped policy string | Contains no unlimited claim |

## Reject

- Promising unlimited use to sell BYOK.
- Hiding the MCP or login limits because they are not model limits.
- Adding a client-side quota that the server does not enforce.
- Reading or logging a credential value to count usage.
- Blaming the provider for a product limit, or the product for a provider limit.

## Evidence

```sh
node --test gateway/llm-proxy.test.mjs
npx vitest run packages/faberloom/session-agent/tests/session-agent.spec.ts --reporter=dot
pnpm run typecheck
```

Deployment verification: `curl -fsS https://harness.mwt.one/healthz` reports the three windows.
