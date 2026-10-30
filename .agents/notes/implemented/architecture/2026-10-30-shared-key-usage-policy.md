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
- The guard reads the credential seam: a value whose source is not `env` is the account's own key and is never limited, so a user who configures Gemini, Claude, OpenAI, or their own DeepSeek key can use it for personal work.

The refusal is one visible assistant text block that points to Settings → Models for a personal key. The policy text is also installed as `faberloom:usage-policy` so the model sees the same scope the guard enforces.

## Consequences

- The decision is enforced at the provider boundary, not by prompting or by hiding a button; a blocked request costs no tokens and sends no attachment content.
- The domain check is a fail-closed heuristic: a work request that names no product term is refused. The accepted terms are MWT, SICOP, mail, expediente, proforma, invoice, quote, order, client, supplier, dispatch, customs, container, booking, BL, AWB, tracking, arrival, ETA/ETD, inventory, stock, SKU, price, product, shipment, SAP, PF, OC, and PO, plus short continuations of an earlier work turn.
- A Space with a responsible agent keeps that agent's persona and skills; only its tool set is narrowed. Staff roles are unchanged.
- The per-Space `+` already creates the session inside that Space. A session outside a Space still cannot use a product-external tool or answer a personal prompt on the shared key.
