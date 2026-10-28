# Agent Note: The Mesa price control compares every order line

Status: implemented

English | [中文](2026-10-28-mesa-per-line-price-checks.zh.md)

> Supersedes the order-level price comparison of [the real-shape port](2026-10-28-mesa-check-source-real-shapes.md); that note's source port and line-unreachable finding stay current only for the reads it names.

## Problem

D-01 signs one overcharge per line: `sobreprecio = unit_price_client - unit_price_mwt`. The adapter shipped comparing the billed total with the expediente's `total_client`, because `expediente_lineas` appeared to require an expediente id that no read returns (`.artifacts/mwt-shapes.md` §3).

A live probe of `mwt-one 1.30.0` showed the tool accepts the proforma or purchase-order reference itself and answers one text block per line. For `PF 2521-2026` it returns 36 blocks across 7 SKUs, each block carrying `sku`, `size`, `qty`, `unit_price_mwt`, `unit_price_client` and `total_price`. The order-total comparison can therefore pass while one line overcharges and another undercharges by the same amount, and the blocking `proforma.quantity` control had no line source at all.

## Decision

**`orderLines(reference)` is the line read, and it sends the reference.** `MwtToolCall` gains `expediente_lineas`; `MwtCheckClient` gains `orderLines(reference)`, which sends `{ expediente_id: reference }` and reads four answer forms: one text block per line (what the deployed server sends), one block holding a list, one block holding a `{ results }` page, and one lone line object. A block that is not JSON, or a line without a SKU or a readable `qty`, leaves the whole answer unusable: comparing the rows that happen to parse would price a partial order. A price side the answer omits stays null.

**`proforma.price` walks every billed line.** For each line it takes the order lines of the same SKU and requires `unitPrice - unit_price_mwt` to equal `unit_price_client - unit_price_mwt` at cent precision. A billed line the order does not carry, a line whose `unit_price_mwt` or `unit_price_client` is missing, and a draft line without a price all fail blocking. The order totals stay as a second, independent assertion: when the expediente states both sides, the billed total must equal `total_client`; when it states neither, the per-line read is authoritative.

**`proforma.quantity` sums before it compares.** The order's `qty` is summed per SKU and size and compared with the per-SKU quantity the draft bills. A SKU that only one side carries fails with `ORDER_LINE_MISSING`; a different total fails with `QUANTITY_MISMATCH`. The artifact states no size, so the comparison stops at the SKU total instead of inventing a size dimension.

**The row ships mounted.** `cordis.patch.yml` mounts `faberloom-checks-mwt` with no environment flag and keeps `serverName: mwt`; an offline deployment sets `FABERLOOM_CHECKS_MWT=0` to take it back out. A shipped row that must be switched on was the blocking gap: a deployment that never set the flag kept refusing every proforma with `CHECK_UNAVAILABLE`.

## Alternatives considered

**Keep the order-total comparison.** It needs one read and no container handling, and it already passed on equal totals. It lost because D-01 signs a per-line difference: two lines that offset each other pass an order total and fail D-01, and the control would call that order verified.

**Compare quantities per SKU and size in the artifact.** The order states a size, so the exact comparison would be per size. It lost because the artifact carries `sku`, `quantity`, and `unitPrice` only; reading a size the draft never writes would compare against an invented field. The row sums the order's lines and documents that limit.

**Leave the profile row opt-in.** Keeping `FABERLOOM_CHECKS_MWT=1` avoids mounting controls on a deployment with no `mwt` server. It lost because the row is now proven against the live server, and an opt-in row leaves every shipped proforma blocked by default. An explicit opt-out names the exception instead of making it the default.

## Consequences

- An MWT-backed proforma now passes all blocking controls on real data: `PF 2521-2026` yields 36 lines, `0.00` overcharge on every one, `proforma.price` ok, and `proforma.quantity` ok.
- The control proves the overcharge side of D-01, not `precio_lista + sobreprecio`: no read returns a list price, so `unit_price_client` stands in for `lista + sobreprecio`.
- Two sizes of one SKU that the draft bills as separate lines are checked as a SKU total, because the artifact has no size dimension to compare.
- A server that answers a truncated or unreadable line read fails the control instead of passing on the rows it could parse.
- A stock query restricted to available units answers no content block when it matches nothing; the row reads that as zero available units, so `proforma.stock` reports `STOCK_INSUFFICIENT` and keeps its confirmation instead of failing as an outage.
- `expediente_lineas` is the only line read that resolves a reference: `expediente_obtener` carries no `lineas` and `expediente_edit_full_get` answers a 500 validation error for a proforma code.
- `catalogPrice` and `priceBand` still have no control consumer.

## Verification

`packages/faberloom/checks-mwt/tests/fixtures/mwt-answers.json` holds the sanitized line answer. Tests prove a matching per-line overcharge passes, a differing overcharge fails blocking, a missing `unit_price_mwt` fails, a billed line the order omits fails, equal quantities pass, a differing quantity fails, the order's lines are summed per SKU and size, and a single object, a `results` page, a one-block list, and one block per line produce the same answer. `packages/faberloom/checks-mwt/tests/profile-row.spec.ts` reads the shipped patch and proves the row mounts with no environment flag and only `FABERLOOM_CHECKS_MWT=0` disables it. `.artifacts/mwt-check-live.ts` drives `mcpMwtCheckClient` and the board's own registration against the real MCP for `PF 2521-2026`. `npx tsc -b packages/faberloom/checks-mwt/tsconfig.json`, `npx tsc -p tsconfig.host.json --noEmit`, `npx oxlint`, `npx vitest run packages/faberloom/checks-mwt/tests packages/faberloom/board/tests`, and `npx tsx scripts/verify-cordis-config.ts` are green.
