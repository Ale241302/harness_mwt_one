---
name: marluvas-logistica
description: "Úsala cuando haya que identificar nodos de origen y destino, registrar una recepción de inventario, crear o cerrar un movimiento entre nodos, cargar BL/AWB/contenedor/ETD/ETA, o verificar stock y saldos de un expediente. También cuando un correo de embarque, arribo o entrega cambie la situación física del pedido."
module: inventario
action: update
---

# Nodos, recepción y movimiento

## Nodos

Un nodo es el origen (fábrica, puerto de salida, almacén) o el destino (puerto
de llegada, depósito fiscal, bodega del cliente). Identifícalo leyendo el
cuerpo del correo, los documentos y las imágenes; no solo el asunto.

1. `mcp__mwt__nodo_listar(q="<código o nombre>", pais="<ISO-2>")`.
2. `mcp__mwt__nodo_obtener(nodo_id)` para confirmar tipo y capacidades
   (`receive`, `store`, `dispatch`).
3. Si no existe, `mcp__mwt__nodo_crear(datos={codigo, nombre, tipo,
   pais_iso2, ciudad, capabilities, status})`. No inventes la ciudad ni el
   país; si no se sabe, deja la tarea.
4. Registra los ids en el reporte. El destino de la recepción debe tener
   capacidad `receive`; el origen del movimiento, `dispatch`.

Tipos habituales: `FACTORY`, `ALMACEN`, `HUB`, `OFICINA`, `DISTRIBUTOR`.

## Recepción de inventario

La recepción asigna cantidades de uno o más expedientes al nodo destino,
prorratea costos y vincula artefactos.

### Antes de crear

- `mcp__mwt__inventario_expedientes_con_pendiente` o
  `inventario_saldos_por_expediente` para ver qué falta recibir.
- `mcp__mwt__expediente_lineas` para confirmar SKU, talla y cantidad.
- `mcp__mwt__inventario_lineas_en_nodo` para no recibir dos veces lo mismo.
- Resuelve el `nodo_id` destino con capacidad `receive`.

### Crear

```
mcp__mwt__recepcion_crear(
  items=[
    {"expediente_id": "<uuid>", "producto_id": "<uuid>", "talla": "39",
     "qty_asignada": 10, "nodo_id": "<destino>"},
  ],
  cost_lines=[
    {"kind": "SEGURO", "amount": 118.97, "currency": "USD", "fx_to_usd": 1.0,
     "source": "MANUAL", "scope": {"applies_to_all": true}},
    {"kind": "FLETE", "amount": 2930.00, "currency": "USD", "fx_to_usd": 1.0,
     "source": "MANUAL", "scope": {"applies_to_all": true}},
  ],
)
```

Reglas:

- Una entrada por expediente × producto × talla.
- `qty_asignada` no puede superar lo pendiente del expediente.
- Flete y seguro salen de la factura comercial Marluvas. Si vienen en 0 o
  vacíos, no los agregues.
- Los impuestos del DUA que correspondan a la recepción también pueden ir en
  `cost_lines`; el IVA no se capitaliza.
- Vincula los artefactos de la recepción (packing list, BL/AWB, factura,
  certificado) en el nodo destino con `nodo_artefacto_crear` y las mismas
  líneas.
- Verifica el stock con `stock_listar(nodo)` y
  `inventario_saldos_por_expediente`.

## Movimiento entre nodos

El movimiento traslada stock de un nodo a otro con contexto legal, tracking y
costos. Se crea cuando el expediente está en destino o cuando la operación lo
exige.

### Crear

```
mcp__mwt__transferencia_crear(
  origen_id="<nodo con dispatch>",
  destino_id="<nodo con receive>",
  legal_context="NATIONALIZATION",  # INTERNAL | NATIONALIZATION | EXPORT | DISTRIBUTION | CONSIGNMENT
  lineas=[
    {"producto_id": "<uuid>", "sku": "700282", "size": "39",
     "qty_transfer": 10, "unit_cost": 15.43, "unit_value": 15.43},
  ],
  ref_tracking="<BL/AWB/booking>",
  context_data={"bl_awb_number": "<nro>", "dua_number": "<nro>",
                "transfer_pricing_amount": 4719.15},
  idempotency_key="<uuid unico>",
)
```

- `lineas` solo con stock real en el origen.
- `legal_context` = `NATIONALIZATION` cuando hay DUA de importación.
- `unit_cost` y `unit_value` salen del expediente o de la factura; no los
  inventes.

### Aprobar, despachar, recibir, conciliar, cerrar

```
transferencia_aprobar(transferencia_id)
transferencia_despachar(transferencia_id)
transferencia_editar(transferencia_id, {"eta": "YYYY-MM-DD",
                     "dispatched_at": "YYYY-MM-DD", "ref_tracking": "..."})
transferencia_recibir(transferencia_id, lineas=[{"id": "<linea_id>",
                     "qty_received": 10}])
transferencia_conciliar(transferencia_id, reconciled_by_id="<uuid>",
                        reconciled_note="...", gap_justification="...")
transferencia_cerrar(transferencia_id)
```

- Si lo recibido difiere de lo despachado, el movimiento queda en
  `DISCREPANCY`; registra la diferencia y concilia con evidencia.
- `transferencia_conciliar` exige documento de excepción o justificación de
  brecha. No concilies sin evidencia.
- No cierres un movimiento con stock pendiente o una discrepancia abierta.

### Costos

Agrega los costos del DUA/factura con `transfer_costo_agregar` (ver
`marluvas-aduana`). Revisa `transfer_costos_listar` y
`transfer_liquidacion_preview` antes de `transfer_liquidar`.

### Artefactos

Vincula DUA, factura comercial, BL/AWB, packing list y certificado al
movimiento con `transfer_artefacto_crear`, usando el mismo formato de `data`
que `nodo_artefacto_crear`.

## Fechas y estados

- La recepción y el movimiento deben tener fechas reales: `dispatched_at`,
  `eta`, `received_at`, `occurred_at` del estado.
- El estado del expediente y el estado del movimiento no son lo mismo, pero
  deben ser coherentes: un BL emitido respalda `TRANSITO`; un arribo respalda
  `EN_DESTINO`; una entrega respalda `CERRADO`.
- Si el movimiento ya existe, actualízalo; no crees otro con el mismo tracking.

## Verificación

- `transferencia_obtener` y `transferencia_listar`.
- `stock_listar` en origen y destino.
- `inventario_saldos_por_expediente`.
- `transfer_costos_listar`.
- `transfer_liquidacion_preview`.

## Reporte

Devuelve: nodos origen/destino, recepción (`recepcion_id`, items, costos,
artefactos), movimiento (`transferencia_id`, estado, tracking, costos,
artefactos), stock verificado y discrepancias.
