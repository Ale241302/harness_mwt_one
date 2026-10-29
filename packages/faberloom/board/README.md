---
description: "Native product board (ctx.faberloomBoard): versioned work items with evidence-gated submits, version-bound approvals, revalidation, and authorization-gated effects."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

English | [中文](README.zh.md)

## Summary

This package carries the work table: prepared results and exceptions with versioned revisions, approval bound to the exact revision, revalidation after a change, and effects that require an explicit authorization. It also runs one iteration attempt per item — lock, working draft, and a round counter that only suggests — and the external effect machine of E15: a per-tenant effect reservation, a transactional outbox with a verifying consumer, the reversal window, reconciliation, and the recovery sweep for reservations a crashed acceptance left behind. It registers the `ctx.faberloomBoard` host service; the model tools live in `dsh-tool-faberloom`.

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

A conversation prompt is not an item. The item is a prepared result from a run, or a concrete missing-data task with its PF/OC/SAP, account, and evidence; `artifactType` distinguishes `proforma` from `tarea`. A submission that names no type is a `tarea`: it carries no priced commitment, and an untyped record would have no deterministic class to release its content. `submit` accepts `accountRef`, `valueAmount`, `valueCurrency`, `dueAt`, `dataClass`, `severity`, and `severityConfidence`, so the Mesa can show money, deadline, and classification without a second write.

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

`assignWorkspace(writer, id, workspaceId)` keeps the item's business key, requires a destination Space inside the actor's tenant (`NO_ACCESS`) that serves the item's account (`ACCOUNT_MISMATCH`), and returns a `BoardAssignment`: the live item plus the drafts a collision moved to it. A collision with another live item on the same key closes a substitutable peer, or transfers the artifact as a candidate to an `ITERANDO`, `EJECUCION_PENDIENTE`, or `DESCONOCIDO` peer and opens that peer (W-87, W-88). The drafts of the item that closes — its linked iteration draft and its inline edit drafts — move to the live item, marked with the version they were written on and a `transferredFrom` reference to the item they were made on, so the panel can offer them as work made on an earlier version (W-98). `transferredDrafts(actor, id)` lists them; a row the source key does not attribute to that item, or a destination key already taken, stays where it is instead of being guessed. `recoverTransferredDraft` turns one listed draft into the live attempt's draft, so the receiving item can continue the work instead of only comparing it (W-98).

### Verifications (E12)

Checks are a port: the board declares which controls an artifact type requires and invokes them; implementations live outside the package (ADR-003).

`registerCheck(artifactType, checkId, fn, { class, source })` returns its disposer, so an adapter mounts it from `ctx.effect` the way the handlers package mounts its handlers. `DECLARED_CHECKS` holds the ids and the classes D-8 signed; a registration for an id the board does not declare is refused with `CHECK_UNKNOWN`, and one whose class disagrees is refused with `CHECK_CLASS_MISMATCH`, so a typo fails at load instead of silently never running. The registry is empty by default: an artifact type that declares no control approves as before, and an artifact type that declares one refuses approval with `CHECK_UNAVAILABLE` while any declared control has no adapter.

`fn` receives `{ item, artifact, source }` — the projected item, the revision under review (`type`, `version`, `content`), and the source port the registration carried — and returns `{ status: 'ok' | 'warning' | 'fail', source, sourceVersion, checkedAt, fields }` plus an optional stable `reason`. A check that throws (a source timeout, a broken adapter, a registration with no port) is reported as `fail` with `SOURCE_UNAVAILABLE`: an unavailable source is a failed control, never a skipped one.

`registerProformaChecks(board, source)` registers the six proforma controls of D-8 and returns their disposer. The adapter implements `BoardCheckSource`; the board never derives a commercial value itself. A source that cannot answer throws, and a source that answers "no record" returns `value: null`.

| Control | Class | Reads |
|---|---|---|
| `proforma.price` | bloqueante | every billed line's overcharge (the billed unit price minus `unit_price_mwt`) equals the order's `unit_price_client - unit_price_mwt` at cent precision, and the billed total equals `total_client` when the order states both sides (D-01); a missing line, price side, or reference fails |
| `proforma.sku` | bloqueante | the catalog knows every billed SKU |
| `proforma.quantity` | bloqueante | billed quantities equal the purchase order `orderRef` names, whose lines are summed per SKU and size; a SKU only one side carries fails |
| `proforma.total` | bloqueante | the line sum equals the billed total (artifact only) |
| `proforma.stock` | confirmacion | available stock covers every billed quantity (D-02); missing stock data requires confirmation |
| `proforma.separation` | confirmacion | the draft's `separation` mode agrees with the account rule |

`runChecks(actor, id)` executes the declared controls on the current revision without persisting anything, for the panel's verification zone. `approve` and `approveWithEdits` run the same path again immediately before the transition, with no cache (W-49, W-50); `approveWithEdits` evaluates the edited content, because that is the version being approved. A blocking control in failure rejects the approval with `BLOCKING_CHECK`, a failed `confirmacion` control the caller did not list in `confirmations` rejects it with `CHECK_CONFIRMATION_REQUIRED`, and the approval event records every control with its source, version, read instant, and the confirmations the human gave.

### Field origin (W-36)

Each revision carries its editable `content` (a proforma: `orderRef`, `lines`, `total`, `separation`), and the item projects `fieldOrigins`: one entry per editable field — top-level keys plus the keys of object values and of array elements, e.g. `lines[0].unitPrice` — with the `source`, `ref`, and read instant the run declared, or `{ source: null }` for a field with no origin. `submit` and `submitRevision` accept `content` and `fieldOrigins`; `saveEdits` and `approveWithEdits` rewrite content and drop the origin of every field under a key the edit changed, because the new value no longer comes from the old source.

### Iteration (E14)

`iterate(writer, id, { baseVersion, actorSession })` opens one attempt over the version the caller saw. It requires `PENDIENTE_CRITERIO` and a space (`NO_SPACE`), mints a new `iterationId`, bumps `iterationLockGeneration`, records `iterationBaseVersion`, writes the lock deadline from the resolved policy, and leaves the artifact version untouched (W-31, W-11). Two tabs of one user are two attempts: the attempt, not the user, is the lock subject, and `actorSession` records the tab that opened it.

`iterateWithEdits(writer, id, { expectedRowVersion, baseVersion, changes, actorSession })` saves the edits as the next version and starts the attempt over it in the same `update`, so a conflicting row, base version, or state creates no version, applies no transition, and leaves the caller's edits outside the item (W-69).

The lock lives on the item, in `iterationId`, `iterationLockGeneration`, `iterationBaseVersion`, `iterationLockUntil`, `iterationLockBy`, and `iterationDraftKey`. `renewIteration(writer, id, { iterationId, generation, actorSession })` extends the deadline and refuses a stale attempt. `iterationStatus(actor, id)` reports the phase, the lock, the rounds, and the draft the item offers: the linked one, or the retained draft of a dead attempt the item no longer links, with its attempt id, base version, `archived`, `superseded`, and `retained` flags, and `draftLinked` saying which of the two it is. An `ITERANDO` record whose recorded deadline passed reports `expired` and reads as `PENDIENTE_CRITERIO`, so expiry behaves as Guardar y salir without any read writing the item (W-44). A record with no recorded deadline counts as live, so rows written before this version keep refusing edits.

Every iteration write carries the caller's tab session in `actorSession`, and the attempt's `iterationLockBy` is part of the write predicate: a second tab that read a valid id and generation is refused with `LOCK_HELD` before anything is stored, written, or audited (§9.7.1). `LOCK_LOST` and `ITERATION_STALE` keep their order and meaning, so a stale attempt id is still reported as stale rather than as a held lock. A record with no recorded holder matches no session; it stays writable only through a new attempt over it (W-44).

`saveIterationDraft(writer, id, { iterationId, generation, actorSession, baseVersion, summary?, evidence?, content? })` stores the attempt's work in the `iteration_drafts` table under `<itemId>:<iterationId>`, merged over the previous draft of that attempt, and links it from the item. A write whose attempt is no longer live — paused, expired, cancelled, or replaced by another tab — is stored as a draft of that dead attempt and the item is not written at all (W-57). A write from another tab session is refused with `LOCK_HELD` and stores nothing.

Every iteration write validates state, `iterationId`, generation, the tab session, and base version together and refuses with `LOCK_LOST`, `ITERATION_STALE`, or `LOCK_HELD` without effects (W-43, W-57). An attempt whose artifact moved past its base version is stale: it is never applied over newer content.

`pauseIteration(writer, id, { iterationId, generation, actorSession, reason })` covers Guardar y salir, Llevar a SpaceLoom, Volver sin resolver, and `lock-vencido`: it releases the lock, invalidates the attempt id, returns the item to `PENDIENTE_CRITERIO`, keeps the draft linked to its base version, and leaves any pending candidate untouched (W-67, W-97). `cancelIteration` deletes the draft and does not change the version, except through the adopt choice it accepts while a candidate is pending (W-41); it refuses with `CANDIDATE_PENDING` when the caller leaves that choice out. Both require the holder's session, so a pause or cancel from another tab is refused; after either exit, any session starts a fresh attempt.

`resumeIteration(writer, id, { baseVersion, actorSession })` takes a new attempt over the draft the item offers and records the session as its holder: the draft it links, or the draft a dead attempt left behind that the item never linked, so a late answer is reachable instead of stranded (W-57). When the draft was written against an older version, it marks the draft outdated, returns `status: 'outdated'` with the differing fields, and overwrites nothing (W-68). A draft a fresh attempt replaced (`superseded`) and one past its retention window are not offered. Starting an attempt writes the state and the lock only; the draft reaches the artifact through `applyIteration`.

`recoverTransferredDraft(writer, id, { draftKey, actorSession })` turns one draft `transferredDrafts` listed into the live attempt's draft (§2.3, W-98). It refuses a key that is not transferred to this item (`NO_DRAFT`) and one past its retention window (`DRAFT_EXPIRED`). When the draft's base version is still current it moves the row under the new attempt's key, clears `transferredFrom` so the notice stops offering it, records `iteration.recovered` with the item it came from, and starts the attempt; when it is not, it marks the draft outdated, returns the differing fields, and writes no item. Recovery never applies the work: the version moves only through `applyIteration` with its scope.

`applyIteration(writer, id, { iterationId, generation, actorSession, baseVersion, scope, summary?, evidence?, candidate? })` writes the next version and hash from the draft and the caller's overrides, records `scope` on the audit event for the learning side, releases the lock, deletes the draft, and returns the item to `PENDIENTE_CRITERIO`. A pending candidate stays a candidate of the item (W-40) and must be named in the same call: `adopt` makes it the live version and that is the only version bump, `keep` discards it. Only the current attempt applies, and only from its holder's session (W-57).

`iterationRoundCount` lives on the item. `iterationStatus().suggestRewrite` turns true once it reaches `iterationRoundLimit`; nothing blocks, because D-10 only suggests rewriting or discarding.

| Config field | Default | Meaning |
|---|---|---|
| `iterationRenewalSeconds` | 30 | Seconds a client waits between renewals (D-09) |
| `iterationLockSeconds` | 900 | Seconds an attempt lives without activity (D-09) |
| `iterationDraftRetentionDays` | 30 | Days a working draft stays recoverable (D-09) |
| `iterationRoundLimit` | 5 | Applied rounds before the suggestion (D-10) |

`iterationPolicy()` returns the resolved values, so the panel schedules from the deployment's numbers instead of carrying its own.

### Execution (E15)

`approveWithExecution(writer, id, input)` approves the exact artifact version and accepts one execution for it: the approval, the effect reservation, and the outbox message are acquired in one command, so an authorized item cannot exist without the intention to emit it (§10.1). It requires the preconditions of `approve` plus `executionId`, `actionType`, `destination`, and an explicit `authorization`; `idempotencyKey` defaults to `effect:<effectKey>`. `actionType` must be one the deployment accepts (`effectActionTypes`), and when the `faberloomAccess` service is mounted the acceptance asks it for the CEO signature W-16 requires before it acquires anything, letting its refusal propagate unchanged. It returns the item, the reservation, and the message.

`effect_key` is the signed identity: `sha256(tenant_id + ":" + action_type + ":" + destination + ":" + business_key + ":" + artifact_hash)`. The tenant is the item's `companyId` and is never omitted, so a company-less deployment uses the reserved literal `sin-empresa`. A mail destination is one address list — trimmed, lowercased, split on a comma, a semicolon, or whitespace, de-duplicated, sorted — so the same recipients in another order or with another separator produce the same key; any other destination is an external system id kept as written. No component may contain `:`, the separator the formula joins them with, so two tuples never share one key string (`EFFECT_COMPONENT_INVALID`). `effectKeyOf` and `normaliseDestination` are exported, so a caller computes the key the board stores.

The reservation lives in `effect_reservations`, one row per tenant and `effect_key` (ADR-001: a key-claim table, like `keys` and `references`), with the states `RESERVADA`, `DESPACHADA`, `CONCILIADA`, and `LIBERADA`. A competing execution of the same key is refused with `EFFECT_TAKEN` while the reservation is `RESERVADA` or `DESPACHADA`, including after `admin_close`. A retry of the owner keeps the same row, the same `executionId`, and the same idempotency key; a released or conciliated row frees the key. Reservations never cross tenants: the row key carries the tenant, and a consumer of another tenant finds no message.

The item lands in `DELEGADO_EN_VENTANA` when the action type has a reversal window and in `EJECUCION_PENDIENTE` when it has none; `reversalDeadline` is the instant the effect may leave. `revert(writer, id, { expectedRowVersion?, reason? })` inside the window returns the item to `PENDIENTE_CRITERIO`, releases the reservation, and cancels the message, so no effect happens (W-17, W-19). A revert at or after the deadline is refused with `WINDOW_EXPIRED`, a delegated item with no recorded deadline with `EFFECT_NO_DEADLINE`, and `expireWindow(writer, id)` is the one transition to `EJECUCION_PENDIENTE`: revert and expiry are serialized on the item, so exactly one of them applies (W-18).

`effect_outbox` holds one message per effect with the key and the execution id, in `PENDIENTE`, `DESPACHADO`, `CONFIRMADO`, `FALLIDO`, or `CANCELADO`; a `CANCELADO` message is not dispatchable. `dispatchEffect(actor, effectKey)` is the consumer: inside one tenant section it requires a dispatchable message, a `RESERVADA` reservation owned by the same execution, an item that still authorizes the effect, and controls that still pass; otherwise it emits nothing, releases the reservation, and marks the message `CANCELADO` (W-95, W-102). It also refuses to emit before `reversalDeadline` and commits the window expiry itself when the deadline passed (W-19). The adapter is a port: `registerEffectAdapter(actionType, adapter)` mounts it from `ctx.effect`, the board sends `{ effectKey, executionId, itemId, actionType, destination, idempotencyKey, attempt }`, and an action type with no adapter is refused with `EFFECT_NO_ADAPTER` while the message stays `PENDIENTE`. A throw, an aborted signal, or the configured dispatch timeout is `DESCONOCIDO`: the item is never `EJECUTADO` without a confirmation (W-22). The same port carries an optional `probe(dispatch, { signal })`, which asks the destination what became of an effect already emitted, without emitting it again; a throw, an aborted signal, or the dispatch timeout there is `DESCONOCIDO` too. `pendingEffects(actor)` lists what the tenant may still emit.

`reconcile(writer, id, { outcome, ref?, detail? })` settles a dispatched effect: `CONFIRMADO` closes the item as `EJECUTADO`, `FALLIDO` moves it to `ERROR_RECUPERABLE` with that outcome, and `DESCONOCIDO` records the attempt and leaves the unknown state in place (W-21, W-76). `probeEffect(writer, id, { expectedRowVersion? })` asks the destination (§9.8) and settles the answer through the same command, returning the effect projection after it: an adapter that declares `probe` answers `CONFIRMADO`, `FALLIDO`, or `DESCONOCIDO`, and an adapter without one makes the command write nothing, so the operator keeps stating the outcome and the projection reports `adapter.probe: false`. `retry(writer, id)` keeps the original execution id, reservation, and idempotency key and returns the item to `EJECUCION_PENDIENTE`; an unknown outcome is refused with `OUTCOME_UNKNOWN` unless the adapter declares the destination idempotent (W-21, W-84). While the outcome is unknown, `submitRevision` and `discard` stay refused and a new artifact becomes a candidate, so the effect keeps its trail (W-76).

`adminClose(writer, id, { reason, expectedRowVersion? })` is the administrative close of an item whose outcome is unknown (D-9): the owner or an administrator of the tenant (`actor.role === 'admin'`), a mandatory reason, and a reservation that stays `DESPACHADA` with `closedAt`, `closedBy`, and `closeReason`, so the reconciliation remains open (W-65). A pending candidate becomes a new item linked with `supersedesItemId` and carrying the candidate hash (W-86). A later reconciliation on a closed item writes `effect.late_confirmation`, updates `executionOutcome`, raises a `LATE_CONFIRMATION` alert visible through `alerts(actor)`, and never reopens the item (W-85). `effectStatus(actor, id)` projects the effect for the panel: reservation, message, alerts, `reversalDeadline`, `executionOutcome`, whether the reconciliation is still open, the action type, and the declaration of the adapter that serves it — whether one is registered, whether it declares the destination idempotent, and whether it can be asked about the destination.

Substituting an item in `DELEGADO_EN_VENTANA` (`submit`, `assignWorkspace`) cancels its scheduled execution: the message is `CANCELADO` and the reservation `LIBERADA`, and no effect is emitted (W-56).

`recoverOrphanedReservations(actor)` is the recovery sweep. An acceptance writes the reservation and its message before it commits the item, so a crash in between leaves a `RESERVADA` row no item records; `revert`, `reconcile`, and `pruneEffects` all need an item for it, so the key would stay taken and every other execution of that effect would be refused with `EFFECT_TAKEN`. The sweep releases a row older than `effectReservationLeaseMs` whose key no item records, cancels its message, stores an `effect.orphaned` audit event in `effect_events`, and raises an `ORPHAN_RELEASED` alert; it returns the keys it freed with the rows it wrote. A row whose key an item records is never swept, in whatever state, because a failed execution still needs its reservation to retry (W-84), and a row younger than the lease is left alone because its acceptance may still be committing.

`complete` and `recordEffect` predate the reservation and stay for items that never had one: `complete` refuses an item whose `effectKey` has no `CONCILIADA` reservation (`EFFECT_NOT_CONCILIATED`), and `recordEffect` refuses an item that carries an effect key (`EFFECT_VIA_OUTBOX`), because that effect belongs to the outbox and its reconciliation (W-84).

| Config field | Default | Meaning |
|---|---|---|
| `effectReversalWindowMs` | `{ 'mail.send': 900000 }` | Reversal window per action type in milliseconds; an unlisted type has none (D-12). A deployment maps `FABERLOOM_REVERSAL_WINDOW_MS` onto it for mail |
| `effectActionTypes` | `['mail.send', 'inventory.reserve', 'shipment.create']` | Action types an acceptance or an adapter may name; a deployment extends the list instead of minting a second spelling, and an unlisted type is refused with `EFFECT_ACTION_UNKNOWN` |
| `effectRetentionDays` | 90 | Days a settled reservation and message stay stored before `pruneEffects` may delete them |
| `effectDispatchTimeoutMs` | 30000 | Milliseconds one dispatch attempt may take before the outcome is `DESCONOCIDO` |
| `effectReservationLeaseMs` | 300000 | Milliseconds a `RESERVADA` row may sit unreachable before `recoverOrphanedReservations` releases it; must outlast the three writes of one acceptance |

`effectPolicy()` returns the resolved values, including the accepted action types, so a client reads the board's list instead of keeping its own. `pruneEffects(actor)` deletes settled rows past their retention window — including the audit events of effects no item names — and never touches a live reservation or an unsettled message; no task calls either sweep automatically.

The stable errors of this surface are `EFFECT_IDENTITY_INCOMPLETE` (no action type, execution id, destination, business key, or artifact hash), `EFFECT_COMPONENT_INVALID` (a component carries the formula separator), `EFFECT_ACTION_UNKNOWN` (an action type the deployment does not accept), `EFFECT_TAKEN` (another live execution holds the key), `EFFECT_NOT_CONCILIATED` (`complete` on an item with an unsettled reservation), `EFFECT_VIA_OUTBOX` (`recordEffect` on an item with an effect key), `NOT_DELEGATED`, `EFFECT_NO_DEADLINE`, `WINDOW_OPEN`, `WINDOW_EXPIRED`, `EFFECT_DISPATCHED`, `NO_EFFECT`, `NOT_RETRYABLE`, `OUTCOME_UNKNOWN`, `OUTCOME_KNOWN`, `REASON_REQUIRED`, `EFFECT_NO_ADAPTER`, `OUTBOX_NOT_PENDING`, and `NOT_FOUND`.

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
- **The outbox consumer is not scheduled here** — `dispatchEffect` and `pendingEffects` are the surface; a deployment drives them from its own timer or worker, and the board starts no loop.
- **No effect adapter ships** — the package carries the port only. A deployment that emits mail, inventory, or shipment effects mounts one adapter per action type; until it does, a dispatch of that type is refused with `EFFECT_NO_ADAPTER` and the message stays `PENDIENTE`, by design.
- **Reservation claims are single-writer** — the claim, the item commit, and the message write run in one in-process section per tenant, like the key claims; a second product writer needs a real unique constraint on `(tenant, effect_key) WHERE status IN (RESERVADA, DESPACHADA)`, which is ADR-001's revisit trigger.
- **The outbox is not atomic with the destination** — the message becomes `DESPACHADO` before the adapter is called, so a crash between the claim and the result leaves a dispatched reservation without a confirmation; `reconcile` settles it, and no state ever claims an effect the destination did not confirm.
- **The signature lives in the access package** — when `faberloomAccess` is mounted, `approveWithExecution` asks it for the signature W-16 requires and propagates its refusal unchanged; a composition without that service enforces no signature, because the board cannot tell which action types are protected.
- **The legacy effect paths keep one exemption** — `complete` closes an approved item whose reservation is `CONCILIADA`, and `recordEffect` records an effect on an item that never carried an effect key. Both refuse an item with a live reservation and neither acquires one; `approveWithExecution` is the only path that does.
- **Retention and the recovery sweep are not scheduled** — `pruneEffects` and `recoverOrphanedReservations` run when a caller runs them; no task calls either, so settled rows and orphaned reservations wait for an operator.
- **The recovery sweep scans the tenant** — finding the keys no item records reads every item of the tenant, because the store has no secondary index on `effectKey`; the sweep is an operator cadence, not a per-dispatch check.
- **A revalidation reads controls once per attempt** — the consumer runs the declared controls outside the item's write chain and refuses the dispatch when the item moved while they ran (`STALE_REVALIDATION`), leaving the message `PENDIENTE` for the next attempt; it never emits on a stale verdict.
- **Iteration lock holder is per attempt, not per process** — the write predicate compares the caller's tab session with `iterationLockBy`, and `KvTable.update` serializes one item inside one process. Two writers on one item in different processes still need a real lease; the holder check refuses a second tab, not a second host.
- **Applied scope is recorded, not learned** — `applyIteration` writes `scope` on its audit event and stops there. Correction records, learning candidates, and promotion live outside this package (T4.5–T4.7).
- **Drafts are not swept** — retention is enforced when a draft is read or resumed; no task deletes expired rows, so `iteration_drafts` grows until a later sweeper owns it.
- **An expired attempt is derived, not rewritten** — the record keeps `ITERANDO` and its draft key until the next command writes the item, so a raw-row reader still sees `ITERANDO` for a lock the service already reports as paused.
- **A candidate can still be resolved outside an attempt** — `resolveCandidate` does not check the iteration lock, so adopting during an attempt moves the version and the attempt then refuses with `ITERATION_STALE` instead of applying over it.
- **No iteration surface outside the service** — MCP tools and Remote methods for iteration are not part of this package, so the panel reaches these commands through the host service only.


No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
