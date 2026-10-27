---
name: marluvas-aduana
description: "Úsala cuando llegue un DUA, DUE, liquidación de impuestos, consulta de tributos o factura comercial con flete y seguro, y haya que extraer los valores aduaneros, mapearlos a los costos del movimiento y verificar la factura. También cuando el país de destino sea Costa Rica, Colombia, Guatemala, Honduras, Panamá o El Salvador."
module: transferencias
action: update
---

# DUA, DUE, tributos y costos

## Documentos por país

| País destino | Documento de importación | Tributos típicos → `kind` |
| --- | --- | --- |
| Costa Rica | DUA + consulta de impuestos | `DAI`, `IVA` (13 %, Ley 9635), `PROCOMER`, `LEY_6946` (1 %), `TIMBRE_ARCHIVO`, `TIMBRE_AGENTES`, `TIMBRE_CONTADORES`, `AGENCIAMIENTO`, `MANIPULEO`, `FLETE`, `SEGURO` |
| Colombia | DUA / declaración de importación (DIAN) | `DAI`, `IVA` (19 %), `FLETE`, `SEGURO`, `MANIPULEO`, `ALMACENAJE`, `AGENCIAMIENTO` |
| Guatemala | DUA / declaración (SIRE/DGA) | `DAI`, `IVA` (12 % o 15 %), `MANIPULEO`, `ALMACENAJE`, `AGENCIAMIENTO`, `FLETE`, `SEGURO` |
| Honduras | DUA / liquidación | `DAI`, `IVA`/ISV (15 %), selectivos, `MANIPULEO`, `ALMACENAJE`, `AGENCIAMIENTO`, `FLETE`, `SEGURO` |
| El Salvador | DUA / liquidación | `DAI`, `IVA` (13 %), selectivos, `MANIPULEO`, `ALMACENAJE`, `AGENCIAMIENTO`, `FLETE`, `SEGURO` |
| Panamá | DUA / liquidación ANA | `DAI`, `ITBMS` (7 %), tasas portuarias, `MANIPULEO`, `ALMACENAJE`, `AGENCIAMIENTO`, `FLETE`, `SEGURO` |

El arancel siempre es `DAI`. El IVA local es `IVA` y **no se capitaliza** en el
landed; va aparte. `AGENCIAMIENTO` son honorarios del agente de aduanas;
`MANIPULEO` es handling; `ALMACENAJE` es bodegaje.

## DUE de Brasil (exportación)

El DUE / extrato simplificado trae:

- Número DUE y chave de acesso / RUC.
- Exportador (Marluvas) e importador.
- Peso líquido, moneda, valor total de mercancías.
- `VMLE` = valor de la mercancía en el local de embarque ≈ **FOB**.
- `VMCV` = valor de la mercancía en la condición de venta ≈ **CIF**.
- Local de embarque, recinto aduanero, NF-e.

Usa `VMLE` y `VMCV` para verificar la factura comercial, no para inventar
costos.

## DUA de Costa Rica (ejemplo de extracción)

La consulta de impuestos trae, por cada tributo: descripción, valor en USD y
porcentaje. Mapea:

- Derechos arancelarios → `DAI`.
- IVA Ley 9635 → `IVA`.
- PROCOMER → `PROCOMER`.
- Ley 6946 → `LEY_6946`.
- Timbre Archivo Nacional → `TIMBRE_ARCHIVO`.
- Timbre Asociación Agentes de Aduana Ley 7017 → `TIMBRE_AGENTES`.
- Timbre Contadores Privados → `TIMBRE_CONTADORES`.
- Total en moneda nacional (CRC) como referencia.

## Extraer sin inventar

1. Descarga el documento y aplica OCR/visión si es escaneado.
2. Anota cada valor literal, su moneda y su porcentaje.
3. Identifica el país de destino del expediente.
4. Convierte a USD con `mcp__mwt__tipo_cambio` o con el tipo de cambio que trae
   el documento/correo. Guarda también el valor original.
5. Si el documento no está, marca `[PENDIENTE]` y di dónde buscaste. No pongas
   un monto estimado.

## Dónde van los costos

- **Recepción de inventario** (`recepcion_crear`, `cost_lines`): flete y seguro
  de la factura comercial Marluvas; aranceles/impuestos si la recepción los
  causa.
- **Movimiento entre nodos** (`transfer_costo_agregar`): flete, seguro, DAI,
  IVA, PROCOMER, Ley 6946, timbres, agenciamiento, manipuleo, almacenaje,
  consolidación y otros.

`kind` válidos: `DAI`, `IVA`, `PROCOMER`, `LEY_6946`, `ALMACENAJE`,
`TIMBRE_ARCHIVO`, `TIMBRE_AGENTES`, `TIMBRE_CONTADORES`, `AGENCIAMIENTO`,
`MANIPULEO`, `FLETE`, `SEGURO`, `CONSOLIDACION`, `OTRO`.

Cada costo lleva `amount`, `currency`, `fx_to_usd`, `source` y `scope_json`.
Un costo global usa `{"applies_to_all": true}`; uno por NCM/expediente usa
`{"applies_to_all": false, "expediente_ids": [...], "lines": [...]}`.

## Verificar la factura comercial

La factura de Marluvas suele traer:

- `TOTAL MERCADERIA` (coincide con el valor del expediente).
- `SEGURO` → `kind="SEGURO"`.
- `COSTO DEL FRETE` / `FLETE` → `kind="FLETE"`.
- `SUB TOTAL`, descuentos, otros gastos.
- `TOTAL CIF` = mercancía + flete + seguro.

Si el CIF de la factura no cuadra con la suma, registra la diferencia. Si el
flete o el seguro vienen en 0 o vacíos, no los agregues como costo.

## Verificar antes de liquidar

- `transfer_costos_listar(transferencia_id)`.
- `transfer_liquidacion_preview(transferencia_id)`.
- `transfer_liquidar(transferencia_id)` solo después de revisar el preview.
- El IVA queda fuera del landed; no lo sumes al costo aterrizado.

## Reporte

Devuelve: documento, país, número, FOB/CIF, cada tributo con su `kind`, valor
original, valor USD, tipo de cambio y fuente; además, qué costos agregaste a la
recepción o al movimiento y cuáles quedaron `[PENDIENTE]`.
