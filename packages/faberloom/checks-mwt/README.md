---
description: "Native product proforma checks over MWT.ONE: the six D-8 controls of the board filled from the MWT MCP reads, mounted from ctx.effect."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-checks-mwt

English | [中文](README.zh.md)

## Summary

The board declares six proforma controls and refuses every proforma approval with `CHECK_UNAVAILABLE` until an adapter registers them. This package is that adapter for MWT.ONE: it fills the board's `BoardCheckSource` with the MWT MCP reads and mounts the registration from `ctx.effect`, so disposing the row's fiber removes all six controls. The control implementations, their ids, and their classes stay in `dsh-faberloom-board`; this package never restates them.

The response fields are the ones recorded from the live server (`mwt-one 1.30.0`, `.artifacts/mwt-shapes.md`); the fixtures under `tests/fixtures/` are sanitized copies of those answers.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row beside the board and the MWT MCP server. The bundle ships it mounted; a deployment that has no `mwt` server sets `FABERLOOM_CHECKS_MWT=0` to take it back out.

```yaml
- id: faberloom-checks-mwt
  name: '@deepseek-ai/dsh-faberloom-checks-mwt'
  config:
    serverName: mwt
    toolTimeoutMs: 15000
```

`serverName` is the local name of the MCP server, so the row calls `mcp__<serverName>__<tool>`. Its endpoint and credential belong to the MCP registry row, not here. `toolTimeoutMs` bounds each tool call; a call that exceeds it aborts and the control fails instead of waiting.

### Reads

`MwtCheckClient` is the narrow port between the check logic and the transport: six methods, each returning a fact or throwing, so no MCP vocabulary reaches the controls.

| Read | MWT.ONE tools | Answers |
|---|---|---|
| `expediente(reference)` | `expediente_buscar` as an existence probe, `expediente_listar` paged and matched | `total_client`, `total_mwt`, `moneda`, `client_name`, `credit_days_cliente`, `credit_band` |
| `orderLines(reference)` | `expediente_lineas` | one line per SKU and size: `sku`, `size`, `qty`, `unit_price_mwt`, `unit_price_client`; a price side the answer omits stays null |
| `skuExists(sku)` | `producto_buscar` | true only for an exact catalog SKU match |
| `stockAvailable(sku)` | `producto_buscar`, `stock_listar` | `cantidad_disponible` summed over the records the answer carries; a decimal string is read as its number, and an answer with no record states zero available units |
| `priceBand(sku)` | `producto_precio_cliente` | `banda_vigente.id` and `plazo_dias` |
| `catalogPrice(sku)` | `producto_buscar` | `precio_venta`; zero is a stated price, not absence |

`expediente(reference)` never asks for a UUID: no read returns an expediente id. The search tool only proves the reference exists, so the row is found by paging `expediente_listar` and matching `proforma_codigos` and `oc_codigos`. Two rows naming the same reference leave it unresolved rather than choosing one, and so does an unreadable page.

`orderLines(reference)` sends the reference itself: the server resolves a proforma, purchase-order, SAP, or `EXP-` code to its internal id, so no caller needs the UUID. `mwt-one 1.30.0` answers one text block per line, which the shared JSON reader would concatenate into several documents; `lineRecords` reads that form and also a list, a `{ results }` page, and one lone line object, because a deployment may answer any of the four. A block that is not JSON, or a line without a SKU or a readable `qty`, leaves the whole answer unusable instead of shortening the order.

`mcpMwtCheckClient(call)` implements the port over one tool call, and the row builds that call on the existing tools seam: `ctx.tools.execute({ name: 'mcp__mwt__<tool>' })`. No JSON-RPC client lives here, and no endpoint, credential, or tenant id is hardcoded.

A read returns `null` when the payload does not carry the datum. It never returns a zero, a default band, or a substituted price: that is what keeps D-01's blocking failure and D-02's required confirmation honest. The exception that is data, not a default, is a stated zero (`precio_venta: 0`, an inventory record that names zero available units).

### Registration

`registerProformaChecks(board, client)` registers the six controls through the board's own `registerProformaChecks`, so the classes are the ones D-8 signed and a mismatch is impossible.

| Control | Class | Source the row reports |
|---|---|---|
| `proforma.price` | bloqueante | `mwt.order`: every billed line's overcharge (`unitPrice - unit_price_mwt`) equals the order's (`unit_price_client - unit_price_mwt`) at cent precision; and `mwt.price` when the expediente states both order totals, which must agree with the billed total |
| `proforma.sku` | bloqueante | `mwt.catalog`; an unknown SKU fails |
| `proforma.quantity` | bloqueante | `mwt.order`: the order's `qty`, summed per SKU and size, equals the quantity the draft bills for that SKU |
| `proforma.total` | bloqueante | artifact only, no source read |
| `proforma.stock` | confirmacion | `mwt.stock`; missing stock requires an explicit confirmation |
| `proforma.separation` | confirmacion | `mwt.separation`; no MWT read states the split rule, so it always requires confirmation |

A client that throws reaches the board as `SOURCE_UNAVAILABLE`: a source outage is a failed control, never a skipped one (ADR-003).

-----

<a id="model-experience"></a>
## Model Experience

### Registered controls

#### What the model sees

Nothing. The row registers deterministic board controls and no prompt, schema, or tool result. A failed control reaches the model only through the board's own approval refusal, which the `faberloom_board` tools report.

#### Token effect

Zero direct tokens on every request: the row adds no model-visible text.

#### KV Cache effect

Independent of live requests: the registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The artifact states no size, so quantities compare per SKU** — the order answers one line per SKU and size, and the row sums them into the SKU total the draft bills. A draft that bills two sizes of one SKU as separate lines passes on the correct per-SKU total, because the artifact carries no size dimension to compare.
- **The per-line price compares overcharges, not a list price** — D-01 writes `price = lista + sobreprecio`, but `producto_precio_cliente` returns neither a list price nor a client price (`clientes` is empty without a client), so the row proves the overcharge side: the billed unit price must equal the order's `unit_price_client` through `unitPrice - unit_price_mwt = unit_price_client - unit_price_mwt`. A line the order does not carry, or a line whose `unit_price_mwt` or `unit_price_client` is missing, fails blocking.
- **`expediente_lineas` is the only line read that resolves a reference** — `expediente_obtener` answers no `lineas`, and `expediente_edit_full_get` rejects a proforma code with a 500 validation error, so both need the internal UUID the server never returns.
- **`catalogPrice` and `priceBand` have no control consumer** — they expose what the catalog states for a SKU (`precio_venta`, `banda_vigente.id`, `plazo_dias`) and stay available for a price rule that needs the list price. No current control reads them.
- **No price-history read exists to call** — D-01 names `historial_precios_*`, but the `historial-precios` module in `skills-catalog` records no direct MCP tool, so only the current catalog price is read.
- **`separation` has no MWT source** — no MWT.ONE read states whether the account needs a complement letter or a new proforma. The control reports no record and the `confirmacion` class requires an explicit confirmation; it never passes silently.
- **The existence probe picks its argument from the code prefix** — a reference starting with `PF` is sent as `proforma`; anything else is sent as `oc_number` without its `PO`/`OC` prefix. A server that rejects the argument makes the reference unresolved, which fails the blocking control rather than passing it.
- **Only a proforma or purchase-order code resolves** — SAP codes are listed by `expediente_buscar` but the adapter does not search them; a SAP reference fails as missing source data.
- **One stock page** — `stock_listar` is read once with `limit: 200`; a SKU whose records exceed one page is undercounted. Pagination waits for an observed case.
- **Stock is summed over every node the identity can list** — no node filter is configured, because D-02 names no node and a per-deployment choice has no signed decision.
- **An empty stock answer states zero** — a `stock_listar` query restricted to available units answers no content block when nothing matches, which the row reads as zero available units; the confirmation control then reports `STOCK_INSUFFICIENT`, not a source outage.
- **Listing pagination ends on a short page or the reported count** — a page that reports neither is read once, and a reference beyond it stays unresolved (a blocking failure, never a pass).

No invariant companion is published because the package registers board controls and exposes no independent observation its specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row depends on `tools`, so the MWT server must be mounted before the adapter registers. The MCP registry mounts enabled servers at boot and the loader resolves both injections, so a composition that names the row without the server never applies it. Response field names appear only in `wire.ts` and `client.ts`; widening the approved read set means adding a tool name to `MwtToolName` and a method to `MwtCheckClient`, not reaching into the board.

</details>
