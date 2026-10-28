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
- `approve(writer, id, { expectedRowVersion, expectedArtifactVersion, expectedArtifactHash, confirmations? })`
- `approveWithEdits(writer, id, approval + edits)`
- `discard(writer, id, { expectedRowVersion, reason, note? })`
- `resolveCandidate(writer, id, candidateId, candidateHash, 'adopt' | 'keep')`
- `assignWorkspace(writer, id, workspaceId)`
- `events(actor, id)`

`approve` requires a severity and refuses a pending candidate, a stale item, or a version/hash that is not current. The pilot never sends an external effect from an approval. `saveEdits` and `discard` refuse an item that is `ITERANDO` or closed, and `discard` also refuses `DESCONOCIDO`; the panel hides those controls, and the service is what enforces it for MCP and agent callers. The legacy `review`, `submitRevision`, `reopen`, `requestData`, `fail`, and `complete` remain as aliases for the existing panels; `review` requires the artifact hash to approve, so a caller approves the content it saw, and `fail(writer, id, 'DESCONOCIDO')` records an unconfirmed effect.

`assignWorkspace` keeps the item's business key, requires a destination Space inside the actor's tenant (`NO_ACCESS`) that serves the item's account (`ACCOUNT_MISMATCH`), and returns the live item. A collision with another live item on the same key closes a substitutable peer, or transfers the artifact as a candidate to an `ITERANDO`, `EJECUCION_PENDIENTE`, or `DESCONOCIDO` peer and opens that peer.

### Verifications (E12)

Checks are a port: the board declares which controls an artifact type requires and invokes them; implementations live outside the package (ADR-003).

`registerCheck(artifactType, checkId, fn, { class, source })` returns its disposer, so an adapter mounts it from `ctx.effect` the way the handlers package mounts its handlers. `DECLARED_CHECKS` holds the ids and the classes D-8 signed; a registration for an id the board does not declare is refused with `CHECK_UNKNOWN`, and one whose class disagrees is refused with `CHECK_CLASS_MISMATCH`, so a typo fails at load instead of silently never running. The registry is empty by default: an artifact type that declares no control approves as before, and an artifact type that declares one refuses approval with `CHECK_UNAVAILABLE` while any declared control has no adapter.

`fn` receives `{ item, artifact, source }` — the projected item, the revision under review (`type`, `version`, `content`), and the source port the registration carried — and returns `{ status: 'ok' | 'warning' | 'fail', source, sourceVersion, checkedAt, fields }` plus an optional stable `reason`. A check that throws (a source timeout, a broken adapter, a registration with no port) is reported as `fail` with `SOURCE_UNAVAILABLE`: an unavailable source is a failed control, never a skipped one.

`registerProformaChecks(board, source)` registers the six proforma controls of D-8 and returns their disposer. The adapter implements `BoardCheckSource`; the board never derives a commercial value itself. A source that cannot answer throws, and a source that answers "no record" returns `value: null`.

| Control | Class | Reads |
|---|---|---|
| `proforma.price` | bloqueante | the billed total equals the client total the expediente records, and both order-total sides (`total_client`, `total_mwt`) are readable (D-01 at order level); a missing reference, billed price, or side fails |
| `proforma.sku` | bloqueante | the catalog knows every billed SKU |
| `proforma.quantity` | bloqueante | billed quantities equal the purchase order `orderRef` names |
| `proforma.total` | bloqueante | the line sum equals the billed total (artifact only) |
| `proforma.stock` | confirmacion | available stock covers every billed quantity (D-02); missing stock data requires confirmation |
| `proforma.separation` | confirmacion | the draft's `separation` mode agrees with the account rule |

`runChecks(actor, id)` executes the declared controls on the current revision without persisting anything, for the panel's verification zone. `approve` and `approveWithEdits` run the same path again immediately before the transition, with no cache (W-49, W-50); `approveWithEdits` evaluates the edited content, because that is the version being approved. A blocking control in failure rejects the approval with `BLOCKING_CHECK`, a failed `confirmacion` control the caller did not list in `confirmations` rejects it with `CHECK_CONFIRMATION_REQUIRED`, and the approval event records every control with its source, version, read instant, and the confirmations the human gave.

### Field origin (W-36)

Each revision carries its editable `content` (a proforma: `orderRef`, `lines`, `total`, `separation`), and the item projects `fieldOrigins`: one entry per editable field — top-level keys plus the keys of object values and of array elements, e.g. `lines[0].unitPrice` — with the `source`, `ref`, and read instant the run declared, or `{ source: null }` for a field with no origin. `submit` and `submitRevision` accept `content` and `fieldOrigins`; `saveEdits` and `approveWithEdits` rewrite content and drop the origin of every field under a key the edit changed, because the new value no longer comes from the old source.

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
- **No shipped check adapter** — the package carries the port, the declared controls, and the proforma implementations only. A deployment that approves a proforma mounts `registerProformaChecks` from its own package, filling `BoardCheckSource` with MCP calls; until then every proforma approval is refused with `CHECK_UNAVAILABLE`, by design.
- **No `informativo` control declared yet** — D-8 signed only blocking and confirmation controls for a proforma, so the `informativo` class has no registered example and its branch is exercised by no control.
- **No check result is persisted** — the item stores no verification snapshot. The panel re-reads `runChecks`, and the approval event keeps the results that allowed the decision; a stored per-item verification record arrives with the persistence work.
- **Revalidation before the external effect is E15** — the controls run before `approve`; the dispatch path that must run them again before sending does not exist yet.


No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
