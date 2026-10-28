---
description: "Native product proforma checks over MWT.ONE: the six D-8 controls of the board filled from the MWT MCP reads, mounted from ctx.effect."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-checks-mwt

English | [中文](README.zh.md)

## Summary

The board declares six proforma controls and refuses every proforma approval with `CHECK_UNAVAILABLE` until an adapter registers them. This package is that adapter for MWT.ONE: it fills the board's `BoardCheckSource` with the MWT MCP reads and mounts the registration from `ctx.effect`, so disposing the row's fiber removes all six controls. The control implementations, their ids, and their classes stay in `dsh-faberloom-board`; this package never restates them.

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
| `expediente(reference)` | `expediente_buscar`, `expediente_lineas` | the order lines a purchase-order reference resolves to; a UUID is read directly |
| `skuExists(sku)` | `producto_buscar` | true only for an exact catalog SKU match |
| `stockAvailable(sku)` | `producto_buscar`, `stock_listar` | available units for the SKU, summed over the rows the identity can list |
| `priceBand(accountRef)` | `cliente_listar`, `cliente_obtener` | the account's band id and payment term |
| `catalogPrice(sku, band)` | `producto_precio_cliente` | the list price and the price the account pays under that band |

`mcpMwtCheckClient(call)` implements the port over one tool call, and the row builds that call on the existing tools seam: `ctx.tools.execute({ name: 'mcp__mwt__<tool>' })`. No JSON-RPC client lives here, and no endpoint, credential, or tenant id is hardcoded.

A read returns `null` when the payload does not carry the datum. It never returns a zero, a default band, or a substituted price: that is what keeps D-01's blocking failure and D-02's required confirmation honest.

### Registration

`registerProformaChecks(board, client)` registers the six controls through the board's own `registerProformaChecks`, so the classes are the ones D-8 signed and a mismatch is impossible.

| Control | Class | Source the row reports |
|---|---|---|
| `proforma.price` | bloqueante | `mwt.price`; a missing band, list price, or account price fails |
| `proforma.sku` | bloqueante | `mwt.catalog`; an unknown SKU fails |
| `proforma.quantity` | bloqueante | `mwt.order`; an OC the source cannot resolve fails |
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

- **`price` reads the account band and the catalog, not the expediente line** — `BoardCheckSource.price` carries the account and the SKU but no document reference, so the adapter cannot reach `expediente_lineas` for that read. It resolves the band from the client record and asks `producto_precio_cliente` for both prices; the overcharge is their difference. D-01's exact source returns when the port carries the expediente reference.
- **No price-history read exists to call** — D-01 names `historial_precios_*`, but the `historial-precios` module in `skills-catalog` records no direct MCP tool, so only the current catalog price is read.
- **`separation` has no MWT source** — no MWT.ONE read states whether the account needs a complement letter or a new proforma. The control reports no record and the `confirmacion` class requires an explicit confirmation; it never passes silently.
- **Response field names are unverified against the live server** — the readers accept the aliases the business rules and skills use (`unit_price_mwt`/`precio_mwt`, `qty`/`cantidad`, `banda_id`, ...). A server that renames a field makes the control fail, which is the intended direction, but the confirmed names need a recorded MCP session.
- **One stock page** — `stock_listar` is read once with `limit: 200`; a SKU whose rows exceed one page is undercounted. Pagination waits for an observed case.
- **Stock is summed over every node the identity can list** — no node filter is configured, because D-02 names no node and a per-deployment choice has no signed decision.
- **Account resolution is strict** — a query that returns more than one distinct client leaves the band unresolved and the blocking price control fails, instead of pricing against a guessed account.
- **`orderRef` must be an OC number or an expediente UUID** — a PF or SAP reference is not resolved, and the quantity control fails as missing source data.

No invariant companion is published because the package registers board controls and exposes no independent observation its specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The row depends on `tools`, so the MWT server must be mounted before the adapter registers. The MCP registry mounts enabled servers at boot and the loader resolves both injections, so a composition that names the row without the server never applies it. Field aliases are the only place MWT vocabulary appears; widening the approved read set means adding a tool name to `MwtToolName` and a method to `MwtCheckClient`, not reaching into the board.

</details>
