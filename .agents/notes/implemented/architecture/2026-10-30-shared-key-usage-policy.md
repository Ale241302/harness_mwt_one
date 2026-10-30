# Agent Note: Limit the shared deployment key to product work

Status: implemented

English | [中文](2026-10-30-shared-key-usage-policy.zh.md)

## Problem

B2B accounts sign in with a deployment-owned DeepSeek key. That key may answer questions about MWT.ONE, SICOP, and the account's mail, but it must not become a general-purpose assistant for personal tasks. At the same time, a Space or sub-Space without a responsible agent still has to answer a business question such as the state of a purchase order, and every Space chat must keep working.

## Decision

`ctx.faberloomSessionAgent` already receives the signed-in role and composes each Space session. Under a restricted role (`restrictedRoles`, default `client_b2b`) and while `productOnly` is not false, that service owns the whole policy:

- A Space without a responsible agent composes a product persona with the MWT.ONE, SICOP, and mail tools instead of falling back to the deployment composition.
- Every composed session is restricted to `allowedToolPrefixes` (MWT, SICOP, and the `faberloom_` product tools) plus the read tools, `skill`, and `ask_user`.
- An `llm/stream` listener refuses a personal first turn before the provider is called, and `tools/pre-execute` denies a product-external tool for a session still on the shared key. Continuing a work turn after a tool result, auxiliary calls with a purpose, and internal calls without a session bypass the guard, so classification, compaction, and titles keep working.
- The guard reads the credential seam and decides by value, not by route name. A credential is the account's own only when the seam reports `file` **and** its SHA-256 fingerprint differs from every value the deployment supplied for `sharedCredentialRefs`. The fingerprints are read at construction from each launch-environment layer, because the resolved value is the account's once one is stored and cannot answer what the deployment configured. Every reference is resolved, so a session routed to another provider is not exempt for its name alone.
- `dsh-credentials-local` gained `storedOverridesEnvironment`: for the references a deployment hands out as a default, a stored value outranks the inherited environment and the configuration row stays writable. The same provider refuses storing a value that equals one a lower layer already supplies, because that write would relabel the deployment's key as the account's own.
- The desktop stopped promoting its Harness-home `.env` into the Host's process environment. The Host boots from the launching environment only and reads that file itself as the `user-env` layer, so a key a packaged defaults document carries is a default the store can replace rather than a read-only inherited value. A build for an account that must not hold a deployment credential omits `DSH_DESKTOP_HOME_ENV_FILE`, and no key travels in the installer.

The refusal is one visible assistant text block that points to Settings → Models for a personal key. The policy text is also installed as `faberloom:usage-policy` so the model sees the same scope the guard enforces.

## Alternatives considered

**Trust `source === 'file'` alone.** It was the shipped test, and it is cheaper: no fingerprint set, no launch-environment read. It loses because provenance is not identity — an account that pastes the shared key into its own store is then reported as having a key of its own and gets unlimited personal use on the deployment's bill.

**Compare the stored key with the deployment's literal value.** Equivalent security, but it requires the deployment to hand the guard its own key value in configuration and cannot follow a rotation. Fingerprinting every layer at construction keeps the property without a second copy of the secret and without a config field holding it.

**Move the deployment key out of the process environment into a `.env` layer.** That is the other way to let the store win, but it needs a launcher change per deployment and a `.env` file written for every account. `storedOverridesEnvironment` reaches the same precedence inside the credential seam, where the layers are already resolved, and leaves a single-account deployment untouched.

**Exit the shared key entirely and require every account to bring one.** Cleanest separation of cost, and rejected for the product: a B2B account must be able to answer a purchase-order question the day it signs in, before it has configured any key.

## Consequences

- The decision is enforced at the provider boundary, not by prompting or by hiding a button; a blocked request costs no tokens and sends no attachment content.
- The domain check is a fail-closed heuristic: a work request that names no product term is refused. The accepted terms are MWT, SICOP, mail, expediente, proforma, invoice, quote, order, client, supplier, dispatch, customs, container, booking, BL, AWB, tracking, arrival, ETA/ETD, inventory, stock, SKU, price, product, shipment, SAP, PF, OC, and PO, plus short continuations of an earlier work turn.
- The own-key test is a comparison of values, not of sources alone. Copying the shared key into the account's store keeps the policy, and a route named for another provider is classified like every other one. The fingerprints live in process memory, so a key the deployment rotates after launch is recognized by source only until the process restarts.
- The policy still cannot stop an account that reads the shared key from its own process environment and calls the provider directly. It bounds what the product will do with the shared key; separating cost requires a key per account.
- A Space with a responsible agent keeps that agent's persona and skills; only its tool set is narrowed. Staff roles are unchanged.
- The per-Space `+` already creates the session inside that Space. A session outside a Space still cannot use a product-external tool or answer a personal prompt on the shared key.
