# @deepseek-ai/dsh-faberloom-effects-mwt

Expediente writes against MWT.ONE (`ctx.faberloomMwt`).

## Contract

`prepare` reads the destination through a registered `MwtTransport` and stores one proposal: the exact expediente, every field with its before value and unit, every document with its bytes and SHA-256, the destination version it was prepared against, and the ambiguities that block approval. The revision hashes the target, the version and every written byte.

`authorize` records a single-use authorization for one revision, with the scope a person states. It refuses a proposal that still carries ambiguities.

`execute` re-reads the destination, refuses a changed version, consumes the authorization, writes once with the proposal id as idempotency key, and reads the result back. A destination that may have accepted the write but did not answer leaves the proposal `unknown`; the executor never retries by itself.

`reconcile` settles an `unknown` proposal with the owner's decision. `discard` closes a proposal that was never written.

The board drives the same path: an item approved with action `mwt.write` reaches the registered adapter, which consumes an existing authorization and never creates one. A missing authorization fails the effect instead of writing.

## Configuration

The destination is registered per process with `useTransport(transport)`; the package embeds no endpoint or credential. Without a transport, `prepare` refuses with `NO_TRANSPORT` and `transportReady` is false.

## Model Experience

No model-visible input changes: the service exposes no tool and no prompt. Proposals, authorizations and attempts are product data, not session events.

## Known Limitations and Deferred Work

- The production MWT.ONE transport (MCP calls, credentials, rate limits) lives outside this package and is not shipped here.
- Document bytes are retained with the proposal until it settles; a retention sweep belongs to the deployment.
- A write whose answer was lost stays `unknown` until a person reconciles it; no automatic probe is implemented.
