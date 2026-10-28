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

Mount the row beside the board and the MWT MCP server. The bundle ships it disabled; a deployment turns it on when the `mwt` server is mounted under that name.

```yaml
- id: faberloom-checks-mwt
  name: '@deepseek-ai/dsh-faberloom-checks-mwt'
  config:
    serverName: mwt
    toolTimeoutMs: 15000
```

`serverName` is the local name of the MCP server, so the row calls `mcp__<serverName>__<tool>`. Its endpoint and credential belong to the MCP registry row, not here. `toolTimeoutMs` bounds each tool call; a call that exceeds it aborts and the control fails instead of waiting.

### Reads

`MwtCheckClient` is the narrow port between the check logic and the transport: five methods, each returning a fact or throwing, so no MCP vocabulary reaches the controls.

| Read | MWT.ONE tools | Answers |
|---|---|---|
| `expediente(reference)` | `expediente_buscar` as an existence probe, `expediente_listar` paged and matched | `total_client`, `total_mwt`, `moneda`, `client_name`, `credit_days_cliente`, `credit_band` |
| `skuExists(sku)` | `producto_buscar` | true only for an exact catalog SKU match |
| `stockAvailable(sku)` | `producto_buscar`, `stock_listar` | `cantidad_disponible` summed over the records the answer carries; a decimal string is read as its number |
| `priceBand(sku)` | `producto_precio_cliente` | `banda_vigente.id` and `plazo_dias` |
| `catalogPrice(sku)` | `producto_buscar` | `precio_venta`; zero is a stated price, not absence |

`expediente(reference)` never asks for a UUID: no read returns an expediente id. The search tool only proves the reference exists, so the row is found by paging `expediente_listar` and matching `proforma_codigos` and `oc_codigos`. Two rows naming the same reference leave it unresolved rather than choosing one, and so does an unreadable page. `expediente_lineas` is never called and is not in `MwtToolName`.

`mcpMwtCheckClient(call)` implements the port over one tool call, and the row builds that call on the existing tools seam: `ctx.tools.execute({ name: 'mcp__mwt__<tool>' })`. No JSON-RPC client lives here, and no endpoint, credential, or tenant id is hardcoded.

A read returns `null` when the payload does not carry the datum. It never returns a zero, a default band, or a substituted price: that is what keeps D-01's blocking failure and D-02's required confirmation honest. The exception that is data, not a default, is a stated zero (`precio_venta: 0`, an inventory record that names zero available units).

### Registration

`registerProformaChecks(board, client)` registers the six controls through the board's own `registerProformaChecks`, so the classes are the ones D-8 signed and a mismatch is impossible.

| Control | Class | Source the row reports |
|---|---|---|
| `proforma.price` | bloqueante | `mwt.price`; the billed total must equal the expediente's `total_client`, and both order-total sides must be readable |
| `proforma.sku` | bloqueante | `mwt.catalog`; an unknown SKU fails |
| `proforma.quantity` | bloqueante | `mwt.order`; no read returns the expediente lines, so it always fails |
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

- **No expediente id is readable, so the quantity control cannot pass** — `expediente_lineas` requires an `expediente_id`, and no `mwt-one 1.30.0` read returns one. `orderLines` therefore answers no record, and the blocking `proforma.quantity` control fails on every MWT-backed draft. Until the server exposes a line read (or an id), every MWT-backed proforma approval is blocked.
- **The price control compares order totals, not line prices** — D-01 names `unit_price_client - unit_price_mwt` per line. Without a line read there is no per-line pair, and `producto_precio_cliente` returns neither a list price nor a client price (`clientes` is empty without a client). The control compares the draft total with the expediente's `total_client`, and requires `total_mwt` so the order overcharge is provable. D-01's exact per-line comparison returns when a line read exists.
- **`catalogPrice` and `priceBand` have no control consumer** — they expose what the catalog states for a SKU (`precio_venta`, `banda_vigente.id`, `plazo_dias`) and stay available for a per-line price control. No current control reads them.
- **No price-history read exists to call** — D-01 names `historial_precios_*`, but the `historial-precios` module in `skills-catalog` records no direct MCP tool, so only the current catalog price is read.
- **`separation` has no MWT source** — no MWT.ONE read states whether the account needs a complement letter or a new proforma. The control reports no record and the `confirmacion` class requires an explicit confirmation; it never passes silently.
- **The existence probe picks its argument from the code prefix** — a reference starting with `PF` is sent as `proforma`; anything else is sent as `oc_number` without its `PO`/`OC` prefix. A server that rejects the argument makes the reference unresolved, which fails the blocking control rather than passing it.
- **Only a proforma or purchase-order code resolves** — SAP codes are listed by `expediente_buscar` but the adapter does not search them; a SAP reference fails as missing source data.
- **One stock page** — `stock_listar` is read once with `limit: 200`; a SKU whose records exceed one page is undercounted. Pagination waits for an observed case.
- **Stock is summed over every node the identity can list** — no node filter is configured, because D-02 names no node and a per-deployment choice has no signed decision.
- **Listing pagination ends on a short page or the reported count** — a page that reports neither is read once, and a reference beyond it stays unresolved (a blocking failure, never a pass).

No invariant companion is published because the package registers board controls and exposes no independent observation its specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row depends on `tools`, so the MWT server must be mounted before the adapter registers. The MCP registry mounts enabled servers at boot and the loader resolves both injections, so a composition that names the row without the server never applies it. Response field names appear only in `wire.ts` and `client.ts`; widening the approved read set means adding a tool name to `MwtToolName` and a method to `MwtCheckClient`, not reaching into the board.

</details>
