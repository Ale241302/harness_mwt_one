# @deepseek-ai/dsh-faberloom-effects-mwt

English | [中文](README.zh.md)

Expediente writes against MWT.ONE (`ctx.faberloomMwt`).

## Contract

`prepare` reads the destination through a registered `MwtTransport` and stores one proposal: the exact expediente, every field with its before value and unit, every document with its bytes and SHA-256, the destination version it was prepared against, and the ambiguities that block approval. The revision hashes the target, the version and every written byte.

`authorize` records a single-use authorization for one revision, with the scope a person states. It refuses a proposal that still carries ambiguities.

`execute` re-reads the destination, refuses a changed version, consumes the authorization, writes once, and reads the result back. Every approved field must match its read-back value; a mismatch marks the proposal `failed` with the field, expected value and actual value. A destination that may have accepted the write but did not answer leaves the proposal `unknown`; the executor never retries by itself.

`reconcile` settles an `unknown` proposal with the owner's decision. `discard` closes a proposal that was never written.

The board drives the same path: an item approved with action `mwt.write` reaches the registered adapter, which consumes an existing authorization and never creates one. A missing authorization fails the effect instead of writing.

## Configuration

When `ctx.tools` is mounted, the service registers `createMwtToolTransport` through dynamic injection and disposes that registration with the injecting scope. Each call resolves `mcp__<server>__expediente_obtener` or `mcp__<server>__expediente_editar` from the current schemas and executes it through `tools.execute` with a 120-second cancellation signal. The package opens no MCP connection and owns no endpoint or credential. Without `tools`, it registers no automatic transport.

A deployment or test can register another destination per process with `useTransport(transport)`. Without any transport, `prepare` refuses with `NO_TRANSPORT` and `transportReady` is false.

The MCP transport reads with only `expediente_id` and writes with `expediente_id` and a `cambios` record. The parser accepts MCP text `content` containing JSON and `structuredContent`, exposes root fields, and uses `version`, `etag` or `updated_at` as the revision token.

The MCP writer accepts only the header fields allowed by the deployed server: identity, operation, freight, dispatch, Incoterm, payment, credit days, currency, PO number, state, origin, destination, tracking, carrier and shipment dates. The three credit-day values become safe JSON integers; the other values remain strings. Unsupported fields and document changes throw before the invoker calls MCP.

## Model Experience

No model-visible input changes: the service exposes no tool and no prompt. Proposals, authorizations and attempts are product data, not session events.

## Known Limitations and Deferred Work

- `expediente_editar` does not write documents. The generic proposal model retains document changes for other transports, but the MCP transport rejects them before invocation.
- The real MCP tools accept neither `version_esperada` nor `idempotency_key`. The service still checks the revision before writing, consumes one authorization and invokes the write once, but the server supplies no compare-and-write or deduplication guarantee.
- MCP credentials, endpoint registration and rate limits belong to the deployment.
- Document bytes are retained with the proposal until it settles; a retention sweep belongs to the deployment.
- A write whose answer was lost stays `unknown` until a person reconciles it; no automatic probe is implemented.
