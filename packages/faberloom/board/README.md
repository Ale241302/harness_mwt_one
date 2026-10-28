---
description: "Native product board (ctx.faberloomBoard): versioned work items with evidence-gated submits, version-bound approvals, revalidation, and authorization-gated effects."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

English | [中文](README.zh.md)

## Summary

This package carries the work table: prepared results and exceptions with versioned revisions, approval bound to the exact revision, revalidation after a change, and effects that require an explicit authorization. It registers the `ctx.faberloomBoard` host service; the model tools live in `dsh-tool-faberloom`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomBoard`. The service is an effect on the calling plugin's fiber, so disposing that fiber removes it.

### Reads and isolation

`get(actor, id)` and `list(actor, filter)` require a `BoardActor`; there is no unfiltered listing. An item is readable by its owner only when the company also matches: if the item carries a `companyId`, the actor must carry the same one. `companyId: null` means a single-tenant deployment, not a wildcard: an actor with no company can read only company-less items. The MCP token carries the company and the view passes the deployment's actor, so the browser, the API, and an external agent share one read and write rule.

### WorkLoom commands

`submit(writer, request)` requires `runId`, `idempotencyKey`, and `businessKey`; a repeated idempotency key returns the existing item. The item carries a persisted `state` (`PENDIENTE_CRITERIO`, `APROBADO`, `DESCARTADO`, `DESCONOCIDO`, ...), a derived `column`, `severity` with its source and confidence, `rowVersion`, `artifactHash`, `events[]`, and a `pendingCandidate`.

`create` and `submit` reject a referenced object of another tenant with `CROSS_TENANT_REFERENCE`. A `spaceId` is resolved through the mounted `faberloomSpaces` service, which owns the Space tenant; `runId`, `executionId`, and `accountRef` are opaque, so the first item that stores one records the tenant that may reuse it (`references` table). A reference the board cannot verify is refused instead of stored.

`runId` and `businessKey` are claimed in the `keys` table before the item record is written, and the claims are released when the record write fails, so a crash leaves a key without an item rather than two live items on the same key. Uniqueness is per tenant: a live item of another owner in the same company holding the key returns `DUPLICATE`.

A conversation prompt is not an item. The item is a prepared result from a run, or a concrete missing-data task with its PF/OC/SAP, account, and evidence; `artifactType` distinguishes `proforma` from `tarea`. `submit` accepts `accountRef`, `valueAmount`, `valueCurrency`, `dueAt`, `dataClass`, `severity`, and `severityConfidence`, so the Mesa can show money, deadline, and classification without a second write.

`list` returns the canonical queue order: priority rank descending, where an unclassified or space-less item outranks every `CRITICAL`, then due date, then USD value, then creation instant, then id. Severity and data classification come from `classify.ts`: deterministic rules run first, and an artifact no rule resolves stays unclassified rather than guessed. A provisional item permits no field, so it is neither indexed nor sent to a provider until it is classified.

Commands mutate through one `KvTable.update` transform, so the state change and its audit event commit in one record:

- `setSeverity(writer, id, severity, source, confidence, expectedRowVersion?)`
- `saveEdits(writer, id, { expectedRowVersion, baseVersion, changes })`
- `approve(writer, id, { expectedRowVersion, expectedArtifactVersion, expectedArtifactHash })`
- `approveWithEdits(writer, id, approval + edits)`
- `discard(writer, id, { expectedRowVersion, reason, note? })`
- `resolveCandidate(writer, id, candidateId, candidateHash, 'adopt' | 'keep')`
- `assignWorkspace(writer, id, workspaceId)`
- `events(actor, id)`

`approve` requires a severity and refuses a pending candidate, a stale item, or a version/hash that is not current. The pilot never sends an external effect from an approval. `saveEdits` and `discard` refuse an item that is `ITERANDO` or closed, and `discard` also refuses `DESCONOCIDO`; the panel hides those controls, and the service is what enforces it for MCP and agent callers. The legacy `review`, `submitRevision`, `reopen`, `requestData`, `fail`, and `complete` remain as aliases for the existing panels; `review` requires the artifact hash to approve, so a caller approves the content it saw, and `fail(writer, id, 'DESCONOCIDO')` records an unconfirmed effect.

`assignWorkspace` keeps the item's business key, requires a destination Space inside the actor's tenant (`NO_ACCESS`) that serves the item's account (`ACCOUNT_MISMATCH`), and returns the live item. A collision with another live item on the same key closes a substitutable peer, or transfers the artifact as a candidate to an `ITERANDO`, `EJECUCION_PENDIENTE`, or `DESCONOCIDO` peer and opens that peer.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. `ctx.faberloomBoard` is a host-side service: it registers no tools, injects no prompt text, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Owner-only review** — mutations require the item owner; member-based review needs the access layer.
- **Single-writer uniqueness** — `idempotency_key` and `business_key` claims are serialized in one process. A deployment with more than one product writer needs a real unique constraint or a lease; the project's ADR-001 records the decision and the trigger to revisit it.
- **Thin reference registry** — the board owns no run, execution, or account registry, so an opaque reference is tenant-scoped by the first item that stored it. Another tenant is refused from the second use on; a first use is trusted, and a reference whose owner service is absent is refused.
- **Opaque documents** — documents are references; binary documents arrive with the blob store.


No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
