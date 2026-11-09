# Agent Note: One evidence chain from proposal receipt to loaded revision

Status: implemented

English | [中文](2026-11-09-cycle-evidence-chain.zh.md)

## Problem

Waves 1.x, 3A, and 4A.1 proved their own segments, but no test carried one proposal through the whole path and compared every answer with the durable row: proposal receipt, Mesa rejection or human approval, Git commit, object, activation, and a read through a fixed reference. A rejection could have changed the source unnoticed, a receipt could have disagreed with storage, a conversation could have crossed revisions, or a hidden model call could have answered instead of the local runtime.

## Decision

**The cycle is one scenario over the real services.** `packages/faberloom/mcp-server/tests/oauth.spec.ts` composes the board, the publication service with a real Git repository and the in-memory object store, the MCP server, and the work references. One proposal enters through `faberloom_proposal_submit`; a human discards it and the source and object store are checked unchanged; a second proposal is approved by a human, applied and published, and read through a reference fixed to the resulting commit. The published receipt (`commit`, `objectKey`, `sha256`, `state`) is compared with the durable `publications` row, and the read records `loadedAt` on the reference.

**A1/A2 and the new session stay separate.** The 3A.4 reference test fixes one reference to each of two published revisions; the first returns only its revision and the second only its own. The cycle also records the load only on the reference that read it. A new reference to the new revision is the new conversation; the old reference is never re-resolved.

**IA-01 is observed, not inferred.** `portable/tests/no-hidden-model.spec.ts` spies on `globalThis.fetch` while it plans, installs, validates, loads, and removes a Claude package, and asserts it was never called. It scans every package file for provider endpoints, `fetch(`, `XMLHttpRequest`, `child_process`, `spawn(`, and `exec(`. The package contains skills and resources only; the MCP connection is attached by the host.

**External host evidence is a separate record.** The Claude package writes `faberloom/load.json` with the exact host version and components. That record is not the DSH publication receipt; the cycle compares the receipt with the durable publication row, while the host record proves what Code loaded.

**No session snapshot is added without a model-visible DSH change.** The cycle uses the external package and the MCP tool surface; it does not alter a DSH model-visible event or prompt. If a later change alters one, the snapshot requirement applies to that change, not to this package-only slice.

## Alternatives considered

**Keep per-wave tests and call the cycle covered.** Each test proves one edge, not the handoff between edges. A receipt could pass its own test and still disagree with the row the read uses.

**Use the publication test's memory store without the MCP server.** That omits the proposal, approval, and reference layers where the chain actually breaks. The cycle composes all four.

**Run a real Claude model task.** It needs the D01 account and a network model; 4A.2 certifies the local chain, while the human-observed chat task belongs to 4A.3. The host record and the MCP tool calls are the external evidence here.

**Invent a session snapshot for the package.** A snapshot is required for a model-visible DSH change. The adapter is an external package and does not change a DSH request prefix.

## Consequences

One test now fails if a rejection writes, a receipt disagrees with storage, a reference crosses revisions, or a hidden model call appears in the adapter. The cycle uses the in-memory object store; the real MinIO retention evidence remains the 3A.3 run, and the local Claude package load remains 4A.1. The cost is a slower integration test and the need to keep the board, publication, MCP, and reference harnesses in one composition.

## Verification

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`: proposal, rejection with unchanged source and zero object writes, human approval, commit, object, activation, persisted receipt comparison, fixed-reference read and `loadedAt`.
- `packages/faberloom/mcp-server/tests/oauth.spec.ts` A1/A2 and rollback tests: fixed revision, new reference, revoked reference.
- `packages/faberloom/portable/tests/no-hidden-model.spec.ts`: no `fetch`, provider endpoint, process or shell call during package build/load/remove; no forbidden text in the package.
- `packages/faberloom/publication/tests/publication.spec.ts`: crash after upload, source-down resume, and the signed object and manifest the cycle reads.
