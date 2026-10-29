# Agent Note: One effect key, one reservation, one window

Status: implemented

English | [中文](2026-10-28-mesa-effect-identity-and-reservation.zh.md)

## Problem

The board can record an effect after it happened; nothing decides before a send whether it may happen.

`recordEffect` accepts any `APROBADO` item that names an authorization, and `complete` accepts any approved item.

Neither knows an `effect_key`, so neither can refuse a second execution of one intent.

The 15-minute window had nowhere to live: no recorded intent to postpone, no state to revert.

The store rules out the obvious fix.

`boardDomainSpec` is a schema-validated key-value domain: one durable write per record and no cross-table transaction (ADR-001).

It has no secondary index either.

A reservation written beside the approval as a second `put` is two commits.

`CONTRATO_EFECTOS_MESA.md` signs the formula, the four reservation states, the 15-minute window, the outbox, and reconciliation.

SPEC §10.1 leaves the formula and per-destination idempotency open.

This note pins what an implementer can still get wrong: component spelling, record location, the clock, and the destination boundary.

## Decision

**One function mints `effect_key`, and every component is normalised before it is hashed.**

`effectKeyOf` is that function, and no other code path may produce a key:

```text
effect_key = sha256(tenant_id + ":" + action_type + ":" + destination + ":" + business_key + ":" + artifact_hash)
```

### The five components

| Component | Normalisation | A second spelling would |
|---|---|---|
| `tenant_id` | the item's `companyId`, spelled as the reservation keys spell it | move one effect into another tenant |
| `action_type` | the caller's action type, trimmed | key `Mail Send` as a second effect |
| `destination` | mail lists lowercased, split, deduped, sorted; else trimmed, verbatim | key one mail per recipient order |
| `business_key` | the item's `businessKey`, never its id | delete the competitor case |
| `artifact_hash` | the hash of the approved revision | hash one version into two keys |

`tenant_id` is the item's company, never the caller's.

A deployment with no company uses the `sin-empresa` sentinel the reservation keys use, so both keys name the same tenant.

The residual risk is a tenant literally named `sin-empresa`; that needs a new formula, not a second sentinel.

`action_type` is trimmed and used as spelled.

Nothing refuses a second spelling yet, so `Mail Send` and `mail.send` mint two keys for one effect.

A destination is a mail list when the action type starts with `mail.` or the value contains `@`.

That list is trimmed, lowercased, split on comma or semicolon, stripped of empties, deduplicated, and sorted.

Whitespace is not a separator: `a@x b@y` and `a@x;b@y` are two keys, so a caller writes one of the two accepted separators.

Any other destination is the external id trimmed and otherwise verbatim, because the board cannot verify a system's case rule.

`business_key` has no fallback: an item without one is refused with `EFFECT_IDENTITY_INCOMPLETE`, never keyed by its item id.

An item id in the key would make every item unique and delete the competitor case.

`artifact_hash` is the hash `approve` already bound to the approved revision, read from the item.

The effects code never hashes a payload again, so an acceptance and its effect cannot name two versions of one document.

The components are joined with `:`, and nothing refuses a component that contains it.

A business key holding a colon can therefore make two tuples share one string; closing that is a new formula under D-12.

**A retry of the same execution keeps the key.**

`execution_id` is not a component, so a retry re-derives the same key from the same item and finds its own row.

The idempotency key is stored once and defaults to `effect:<effect_key>`; every retry reuses it.

Minting a key per attempt would turn one effect into N.

**A new artifact version does not compete.**

`artifact_hash` moves, so the key moves, and the old live reservation does not refuse the new execution.

The old item stays blocked until its reservation settles (contract §1), so nothing re-sends while the outcome is unknown.

**Two items with the same business and artifact are competitors.**

The key carries no item id, so the second acceptance resolves to the row the first one holds.

It is refused with `EFFECT_TAKEN` while that row is `RESERVADA` or `DESPACHADA`, including after `admin_close` (W-84).

The key, not the item, is the unit of competition.

### Where each of the three lives

**The item records the decision; the reservation and the message are rows addressed by the key.**

`approveWithExecution` runs in the per-tenant `serial` section and checks the live reservation before it writes anything.

It then writes `effect_reservations` and `effect_outbox` under `<tenant>:<effect_key>`, and commits the item.

If that commit throws, the same section cancels the message and releases the reservation.

The item lands in `DELEGADO_EN_VENTANA` when the action type has a window and in `EJECUCION_PENDIENTE` when it has none.

The item keeps `effectKey`, `reversalDeadline`, and `executionOutcome`; `pruneEffects` only touches the rows.

Rows rather than fields, because the competitor and the consumer both address an effect by key with no item in hand.

A row keyed by that address is the only key-addressed lookup this store offers.

The cost is that one acceptance is three writes.

A crash between the reservation write and the item commit leaves a `RESERVADA` row the item never recorded.

Its own execution repairs it on retry, because the takeover guard refuses only another execution.

Every other acceptance of that key is refused, and `pruneEffects` deletes settled rows alone, so the key stays held.

**The key is claimed by the reservation row itself, not by an index.**

One row per `<tenant>:<effect_key>`: the table key is the claim, the claim-before-write shape the routines domain uses for `event_keys`.

SPEC §10.1 names a partial unique index, which this store cannot build.

`claimKey` is not reusable: it refuses while the holder item is non-terminal, and this refusal follows the reservation.

Three failures follow from moving the claim off that row.

Without the per-tenant section, two acceptances both read no row and both write, which is two reservations for one key and W-96 broken.

With an in-memory map, a restart forgets the claim and a crash re-opens every effect.

With the claim in a second table, the row and the claim can disagree, and nothing says which one refuses the competitor.

**The consumer verifies before it emits.**

`dispatchEffect` needs a `PENDIENTE` dispatchable message, an `EJECUCION_PENDIENTE` item, and a `RESERVADA` reservation.

The reservation must name the message's execution and item.

Before that it enforces the window: a live `DELEGADO_EN_VENTANA` item returns `WINDOW_OPEN`, and a passed deadline expires the item first.

On any failure it cancels the message, releases the reservation, and returns a refusal that names the reason (contract §2.6, W-102).

It then claims the message `DESPACHADO` before calling the adapter, so a crash after the claim cannot emit the effect twice.

Moving the check into the producer makes it a check against the past: revalidation, revert, and substitution release the reservation.

A sender that decided at acceptance time emits the effect W-102 forbids.

### Two clocks, one transition each

**The window postpones; it is not a race.**

The deadline is stamped at acceptance from `effectReversalWindowMs` and persisted on the item: 15 minutes for `mail.send`.

Money, inventory, and shipments default to no window, because the CEO signature replaces it (D-12).

Nothing may be emitted before it, so a revert inside the window cannot lose to a fast sender; the consumer waits.

The deadline is a stored instant, not a config read at dispatch time, so changing the map later moves no existing window.

An action type with no window records no deadline, so the item reaches `EJECUCION_PENDIENTE` on acceptance and no revert is offered.

**Revert and expiry are one transition each way, decided once.**

`revert` needs a delegated item whose deadline is still ahead; `expireWindow` needs the deadline to have passed.

Both run inside the per-tenant section, so whoever arrives second sees the state the first wrote.

A reverted effect cannot later expire into dispatch, and an expired one cannot be reverted (contract §3).

A revert clears `effectKey`, cancels the message, and releases the reservation in the same section.

`revalidateEffect` follows the same rule for a control that fails before dispatch.

The item returns to `PENDIENTE_CRITERIO`, the message is cancelled, and the reservation released, so a fresh approval passes (W-95).

### The boundary with the destination

**The board decides identity, reservation, window, and reconciliation.**

It owns `effect_key`, the two rows, the four reservation states, the deadline, the message states, and each outcome transition.

`CONFIRMADO` reaches `EJECUTADO`, `FALLIDO` reaches `ERROR_RECUPERABLE`, and `DESCONOCIDO` stays there.

`CONCILIADA` and `LIBERADA` are terminal, and `adminClose` closes the item while its reservation stays `DESPACHADA` (W-65).

A late confirmation raises an alert row, audits `effect.late_confirmation`, and does not reopen the item (W-85).

**The adapter decides whether its destination is idempotent.**

`BoardEffectAdapter.idempotent` is the only place that fact lives; the contract leaves it per destination and this note does not decide it.

`retry` refuses `DESCONOCIDO` unless the adapter declares `idempotent: true`, so no declaration means only `reconcile`.

The board never infers idempotency from an action type or a destination string.

A retry against a non-idempotent destination duplicates an effect that nothing on either side can undo.

### Forbidden after this note

1. A second key formula, in an adapter, a console job, an MCP surface, or a test helper. One function, one spelling.
2. An acceptance outside the per-tenant `serial` section, or a reservation written by anything but `approveWithExecution`.
3. A dispatch without the consumer check: no emit from the acceptance path and no verified fast path around it.
4. An `admin_close` that frees the reservation. It closes the item; the reservation stays `DESPACHADA` until reconciliation.
5. A `retry` of `DESCONOCIDO` on a destination that has not declared itself idempotent, or a `revert` after the deadline.
6. A second route to `EJECUTADO` or to a recorded effect: `complete` and `recordEffect` predate the reservation.

## Alternatives considered

**The reservation and the message as fields of the item record.** One `KvTable.update` would hold state, event, reservation, and message.

It lost because the competitor and the consumer address an effect by key with no item in hand.

Keeping both would be two sources for one truth, and keeping only the field would need a scan per acceptance.

**A partial unique index on `effect_key`.** That is what SPEC §10.1 names.

It lost because the store has no secondary index and no insert-if-absent; the only unique key is a table key.

**Verify in the producer and emit from the acceptance path.** It removes the consumer and the delay.

It lost because the reservation can be released between acceptance and send, which is the case W-102 forbids.

**Derive the key from the item id.** It is unique by construction and needs no normalisation.

It lost because two items describing one effect would never compete, and W-84's refusal would be unreachable.

**Let each destination adapter mint the key.** The adapter knows its destination's spelling best.

It lost because two adapters would key one effect twice, and the board could no longer refuse a competitor.

## Consequences

- Three new tables: `effect_reservations`, `effect_outbox`, `effect_alerts`, and three new item fields, all defaulted to null.
- Existing rows load unchanged, because every new field defaults to null and the domain version stays 1.
- The board refuses a competitor before a second send, keeps a revert out of a race, and retries without a new identity.
- Tenant isolation is the row key: no key crosses `companyId`, so another tenant's reservation is never read (contract §2.7).
- `pruneEffects` deletes a settled row past `effectRetentionDays` (90); a live reservation and an unsettled message are never pruned.
- An orphan `RESERVADA` row holds its key until its own execution retries; no command settles a row whose item never recorded the key.
- `complete` and `recordEffect` still reach `EJECUTADO` and record an effect with no reservation, so W-84 and W-96 do not hold there.
- `action_type` has no closed set and a component holding `:` is not refused; both are formula-level gaps, not normalisation choices.
- The evidence is `CONTRATO_EFECTOS_MESA.md` §6: nine cases covering W-84, W-95, W-96, and W-102.
