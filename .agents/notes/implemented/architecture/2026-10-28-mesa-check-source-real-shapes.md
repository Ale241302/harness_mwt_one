# Agent Note: The Mesa verification port runs on the real MWT answer shapes

Status: implemented

English | [中文](2026-10-28-mesa-check-source-real-shapes.zh.md)

> Superseded in part by [the per-line price control](2026-10-28-mesa-per-line-price-checks.md): `expediente_lineas` accepts the reference, so `proforma.price` compares every line and the order total is a second assertion.

## Problem

The Mesa refuses a proforma approval while a declared blocking control has no adapter, and a declared control with no source is a failure by design (ADR-003, D-01). The first adapter registered all six controls against guessed response aliases: `lines`, `qty`, `precio_mwt`, `precio_lista`, `cantidad`. A live probe of `mwt-one` 1.30.0 showed none of them exist, so enabling the adapter would have failed every check closed while looking configured.

The probe also settled what the source can and cannot answer:

- `expediente_buscar` answers `{existe, total, matches[]}`; a match carries codes, `estado`, `product_count` and `monto_cliente_usd`, and no expediente id.
- `expediente_listar` answers `{count, limit, offset, results[]}`; a row carries `total_client`, `total_mwt`, `moneda`, `client_name`, `credit_days_cliente` and `credit_band`, and no id either, even when `campos` names one.
- `expediente_lineas` requires an `expediente_id`, so it is unreachable.
- `producto_buscar` answers `{productos[], total}` with `precio_venta`; `producto_precio_cliente` answers `{sku, banda_vigente, plazo_dias, clientes}` with no list or client price, and an empty `clientes`.
- `stock_listar` answers a flat object whose `cantidad_disponible` is a decimal string.

## Decision

**The order is the unit of price verification.** `BoardCheckSource` exposes `orderTotals(orderRef)` and no longer exposes a per-line `price`; `proforma.price` compares the billed total against the expediente's `total_client` at cent precision and requires both sides plus a resolved reference. A reference that resolves to no row, to two rows, or to a row without either total fails the control. `proforma.quantity` keeps its class and fails when no line source answers, because quantities cannot be proven without lines.

**Envelopes are read where they are, not reshaped in the check.** `wire.ts` owns four readers for the real answers, parses decimal strings into numbers, keeps a stated zero as data, and leaves an absent field null. `resolveExpediente` pages `expediente_listar` and matches `proforma_codigos` or `oc_codigos`; `expediente_buscar` is only an existence probe. `expediente_lineas` is removed from the tool union rather than left as a call that cannot succeed.

## Alternatives considered

- Keep the per-line price control and let it fail closed. It can never pass, so it would block the pilot forever without telling anyone why.
- Ask MWT for an expediente id first and ship nothing. Correct, but it leaves the adapter unverified against the live service in the meantime.
- Reclassify `proforma.quantity` as a confirmation without a signature. Fast, and it would approve quantities nobody verified.

## Consequences

- The adapter matches the live source, and the profile row is enabled by default (`FABERLOOM_CHECKS_MWT=0` opts an offline deployment out).
- A later probe found that `expediente_lineas` resolves a proforma reference without an id, so the order-total comparison was superseded by the per-line check and the row is now enabled by default ([per-line price and quantity checks](2026-10-28-mesa-per-line-price-checks.md)).
- Per-line overcharge, D-01's `unit_price_client - unit_price_mwt`, is now reachable through `expediente_lineas`; `quantity` stays blocking and sums the order per SKU and size.
- `catalogPrice` serves the SKU control; `priceBand` still has no control consumer.

## Verification

`packages/faberloom/checks-mwt/tests/fixtures/mwt-answers.json` holds sanitized copies of the captured answers. Tests prove a differing total fails blocking, equal totals pass, an unresolved reference fails, a row without `total_mwt` fails, decimal stock sums, and a zero catalog price stays data. `npx vitest run packages/faberloom/checks-mwt/tests packages/faberloom/board/tests` is green, and `npx tsc -p tsconfig.host.json --noEmit` reports nothing.
