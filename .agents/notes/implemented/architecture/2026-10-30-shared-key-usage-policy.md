# Agent Note: Limit the shared deployment key to product work

Status: implemented

English | [中文](2026-10-30-shared-key-usage-policy.zh.md)

**Amended by [Own-key composition, fail-closed scope guard, and real usage limits](2026-11-02-byok-composition-shared-key-guard.md), whose guard thresholds are now owned by [Scope guard refuses only a confident personal request](2026-11-10-scope-guard-open-on-doubt.md).** Every human turn is classified except one that names only a business record, a tool result no longer authorizes a later turn, `scopeFallback` defaults to `allow`, and an own key requires an explicit request reference. The shared-key boundary itself is unchanged.

## Problem

B2B accounts sign in with a deployment-owned DeepSeek key. That key may answer questions about MWT.ONE, SICOP, and the account's mail, but it must not become a general-purpose assistant for personal tasks. At the same time, a Space or sub-Space without a responsible agent still has to answer a business question such as the state of a purchase order, and every Space chat must keep working.

## Decision

`ctx.faberloomSessionAgent` already receives the signed-in role and composes each Space session. Under a restricted role (`restrictedRoles`, default `client_b2b`) and while `productOnly` is not false, that service owns the whole policy:

- A Space without a responsible agent composes a product persona with the MWT.ONE, SICOP, and mail tools instead of falling back to the deployment composition.
- Every composed session is restricted to `allowedToolPrefixes` (MWT, SICOP, and the `faberloom_` product tools) plus the read and search tools (`read`, `read_image`, `grep`, `glob`), `skill`, and `ask_user`. The search tools read files inside the session's readable roots without a shell, so an agent that receives a large tool result can search it instead of re-reading it chunk by chunk.
- An `llm/stream` listener refuses a personal turn before the provider is called, and `tools/pre-execute` denies a product-external tool for a session still on the shared key. Every human turn is classified except one that names only a business record; only a short continuation of a turn the classifier called work passes without a second call, and a doubt now allows the turn. [The 2026-11-02 note](2026-11-02-byok-composition-shared-key-guard.md) removed the vocabulary fast path and the tool-result continuation this note originally shipped; [the 2026-11-10 note](2026-11-10-scope-guard-open-on-doubt.md) owns the guard's current thresholds, fallback, and record-reference rule.
- The guard decides by intent, not by vocabulary: one small call on the session's own route, with the Space title and the previous human turn when the session has them, capped by `scopeTimeoutMs`. The classifier call carries its own `purpose`, so it never re-enters the guard. A personal verdict at or above `scopeWorkConfidence` is refused; a doubt follows `scopeFallback`, which defaults to `allow`.
- The guard reads the credential seam and decides by value, not by route name. A credential is the account's own only when the request carries its reference, the seam reports `file`, **and** its SHA-256 fingerprint differs from every value the deployment supplied for `sharedCredentialRefs`. A request with no reference is shared: the route supplies the credential, and on the proxy route that is the deployment's console token. The fingerprints are read at construction from each launch-environment layer, because the resolved value is the account's once one is stored and cannot answer what the deployment configured. A build that ships no key leaves those layers empty, so `sharedCredentialFingerprints` adds the digests a deployment declares instead of a value ([declared digests](2026-11-12-declared-shared-key-fingerprints.md)).
- `dsh-credentials-local` gained `storedOverridesEnvironment`: for the references a deployment hands out as a default, a stored value outranks the inherited environment and the configuration row stays writable. The same provider refuses storing a value that equals one a lower layer already supplies, because that write would relabel the deployment's key as the account's own.
- The desktop stopped promoting its Harness-home `.env` into the Host's process environment. The Host boots from the launching environment only and reads that file itself as the `user-env` layer, so a key a packaged defaults document carries is a default the store can replace rather than a read-only inherited value. A build for an account that must not hold a deployment credential omits `DSH_DESKTOP_HOME_ENV_FILE`, and no key travels in the installer.
- The gateway exposes a model proxy (`/llm/chat/completions`, `/llm/messages`) that validates the account's console token against `portal/me/`, caches the answer for five minutes, limits each account to 120 requests per minute, and forwards with the deployment key. A desktop configured with `FABERLOOM_LLM_PROXY_URL` points `llm-deepseek` and the agent routes there and authenticates with `CONSOLA_TOKEN`, so the key stays on the server and the shared-key policy still applies because the ref resolves from the `.env` layer.

The refusal is one visible assistant text block that points to Settings → Models for a personal key. The policy text is also installed as `faberloom:usage-policy` so the model sees the same scope the guard enforces.

## Alternatives considered

**Trust `source === 'file'` alone.** It was the shipped test, and it is cheaper: no fingerprint set, no launch-environment read. It loses because the source layer is not the identity of the value — an account that pastes the shared key into its own store is then reported as having a key of its own and gets unlimited personal use on the deployment's bill.

**Compare the stored key with the deployment's literal value.** Equivalent security, but it requires the deployment to hand the guard its own key value in configuration and cannot follow a rotation. Fingerprinting every layer at construction keeps the property without a second copy of the secret and without a config field holding it.

**Move the deployment key out of the process environment into a `.env` layer.** That is the other way to let the store win, but it needs a launcher change per deployment and a `.env` file written for every account. `storedOverridesEnvironment` reaches the same precedence inside the credential seam, where the layers are already resolved, and leaves a single-account deployment untouched.

**Exit the shared key entirely and require every account to bring one.** Cleanest separation of cost, and rejected for the product: a B2B account must be able to answer a purchase-order question the day it signs in, before it has configured any key.

## Consequences

- The decision is enforced at the provider boundary, not by prompting or by hiding a button; a blocked request costs no tokens and sends no attachment content.
- The domain check is no longer a fast path: every human turn is classified by intent, so a paraphrase, another language, or a dialect is understood instead of refused, and a business word inside a personal request does not authorize it. The shared-key boundary still covers MWT, SICOP, mail, purchasing and sales, the footwear catalog, and contracting.
- The own-key test is a comparison of values, not of sources alone, and it requires an explicit reference on the request. Copying the shared key into the account's store keeps the policy, a request without a reference is shared, and a route named for another provider is not exempt for its name. The fingerprints live in process memory, so a key the deployment rotates after launch is recognized by source only until the process restarts.
- The policy still cannot stop an account that reads the shared key from its own process environment and calls the provider directly. It bounds what the product will do with the shared key; separating cost requires a key per account.
- A Space with a responsible agent keeps that agent's persona and skills; only its tool set is narrowed. Staff roles are unchanged.
- The per-Space `+` already creates the session inside that Space. A session outside a Space still cannot use a product-external tool or answer a personal prompt on the shared key.
