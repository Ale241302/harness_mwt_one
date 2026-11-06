# Agent Note: One durable, idempotent entry for knowledge proposals

Status: implemented

English | [中文](2026-11-06-knowledge-proposal-reception.zh.md)

## Problem

The board had no dedicated entry for a knowledge proposal. A producer could call `submit`, which is run-oriented: it requires a run id, treats the idempotency key as tenant-scoped rather than owner-scoped, and supersedes a non-terminal item with the same business key. An external agent that retried after a lost answer could therefore create a second item, and an agent that reused a key with different content would silently get the first item back instead of a conflict. There was also no field-level boundary: nothing stopped a caller from sending `ownerId`, `companyId`, `spaceId`, `state`, or `approvedRevision` alongside the proposal.

## Decision

**One tool, seven fields, explicit limits.** `faberloom_proposal_submit` accepts `archivo`, `versionBase`, `cambio`, `motivo`, `evidencia`, `claveCliente`, and `title`. `parseProposalInput` is the boundary for both the MCP tool and a direct board call: it rejects any unknown key, names the authority fields with `PROPOSAL_AUTHORITY_FIELD`, and enforces the bounds in `PROPOSAL_LIMITS` (512 / 128 / 20,000 / 2,000 / 20 × 512 / 128 / 200). The MCP schema repeats those bounds for the model, and the board repeats them because the tool layer is not the only caller.

**The namespace is the identity.** The source reference is `PROPUESTA:<company>:<owner>:<space>:<key>` with each slot URI-encoded; the same four canonical slots are hashed into the idempotency key. The item id is derived from that hash, so two processes receiving the same namespace write the same row instead of two. The durable `idem` and `bkey` claims are written before the row, in the same order `submit` uses. The space slot is part of the namespace and stays `null` in this cut because the seven fields carry no space; a later wave derives it from a verified reference instead of letting the caller name it.

**A retry is a replay, not a new submission.** `submitProposal` first reads the deterministic id: an identical content hash returns `{ recibida: true, id }` without mutating the row; a different content hash, a foreign owner, or a non-proposal row is `PROPOSAL_CONFLICT`. The hash reads the first revision, which is the proposal as received, so a later human edit or approval does not invalidate a client retry. If no row exists, a live item that already holds the business key (a scheduled effect, or a row written before this method) is also a conflict; the proposal never supersedes it and never exposes it. The owner and company are compared and serialized in canonical form, so two spellings of one identity do not open a second row or a second lock bucket.

**The path is data, but it is validated as a path.** `archivo` must be repository-relative: an absolute path, a drive letter, a backslash, or a `..` segment is refused with `PROPOSAL_FIELD_INVALID` before the row exists.

**A proposal is work, not a decision.** The item enters `PENDIENTE_CRITERIO` with `approvedRevision: null`, no effect key, and no reservation. `propuesta-conocimiento` has its own LOW severity rule and N2 permitted-fields rule in `classify.ts`; both rule-table versions move to `2026-11-06.1` so the classification cache and the audit trail can tell the tables apart. Approval still requires a human writer (`kind: 'human'`), and the evidence rules from 1.1 apply unchanged.

## Alternatives considered

**Reusing `submit` with a namespaced idempotency key.** The idempotency claim is tenant-scoped, so two owners using the same client key would collide; `submit` also supersedes a live item on the same business key, which is exactly what a proposal must not do to a scheduled effect.

**Keeping the deduplication in a process Map.** A restart loses it, and the tool server and the board can run in different processes. The deterministic id plus the durable claims survive both.

**A random item id plus the claim table.** Two processes can both read "no claim" before either writes one. The derived id makes the row write idempotent even when that read races; the read-back verification turns different payloads into a conflict.

**Accepting authority fields and ignoring them.** A caller that sends `state: 'APROBADO'` would believe it changed the decision. Rejecting the field names the boundary instead of silently discarding it.

## Consequences

The proposal is durable before the tool answers, and a retry after a crash resolves to the same row. A reused key with different content fails loudly instead of returning someone else's work. The board never creates an effect, a teaching, a context entry, or an index row from a proposal; those remain consequences of the human decision that follows.

The deterministic id means the proposal namespace is immutable: changing the owner, space, or client key creates a different proposal, which is the intended identity. The read-back comparison after the row write detects a concurrent different payload, but two processes that both read their own write before the other lands can still return two successes; the deployment keeps one board writer per home, and the durable claims plus the derived id are what make the common retry path correct.

## Verification

- `packages/faberloom/board/tests/proposal.spec.ts`: exact receipt and pending item; two distinct keys; identical retry after a restart over the same medium; eight concurrent identical calls; different content on the same key with the first row untouched; owner isolation and every authority field; a scheduled item holding the business key unchanged; no effect, no completion, no agent approval; oversized change and evidence list with another proposal intact; unsafe paths and non-string fields; identical retry after a human edit and after an approval; a foreign-owner or non-proposal row at the deterministic id.
- `packages/faberloom/mcp-server/tests/proposal.spec.ts`: the tool is advertised and scope-filtered; the receipt has exactly `recibida` and `id`; authority and unknown fields are refused at the executor; a token scoped elsewhere cannot call it; distinct keys and a conflicting retry; the limits.
- `packages/faberloom/board/tests/classify.spec.ts`: `propuesta-conocimiento` resolves LOW and N2 with the permitted fields.
