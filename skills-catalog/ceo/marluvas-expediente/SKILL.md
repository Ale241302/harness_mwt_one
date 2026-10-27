---
name: marluvas-expediente
description: "Úsala cuando haya que crear o actualizar un expediente en MWT.ONE a partir de una OC, proforma, PF o pedido: resolver el cliente y el operador, crear productos o tallas que falten, fijar precios, plazos, comisión y líneas SKU × talla, y dejar la OC y el expediente listos. También cuando el expediente ya exista y haya que corregirlo."
module: expedientes
action: create
---

# Expediente, cliente, productos y precios

## Orden de trabajo

1. Resuelve el cliente.
2. Resuelve el operador (Muito Work Limitada o el cliente).
3. Resuelve los productos y las tallas.
4. Resuelve la OC.
5. Busca si el expediente ya existe.
6. Crea o actualiza el expediente y sus líneas.
7. Verifica y registra.

## 1. Cliente

Busca con `mcp__mwt__cliente_listar(q="<razón social o tax id>")` y confirma
con `mcp__mwt__cliente_obtener`. Prueba también el nombre comercial, el
`codigo_marluvas` y la razón social alterna (por ejemplo, un pedido puede venir
como MELEXA SAS y pertenecer a SONEPAR COLOMBIA SAS; mismo `cliente_id`).

Si no existe, créalo con `mcp__mwt__cliente_crear(datos={...})` usando datos
reales del correo o del documento:

- `razon_social`, `tax_id` o `cedula_juridica`, `pais_iso2`, `ciudad`.
- `tipo`: B2B, DISTRIBUIDOR o CONSUMIDOR.
- `codigo_marluvas` solo si son exactamente 10 dígitos.
- `contacto_nombre`, `contacto_email`, `medio_pago`, `dias_credito`, `moneda`.
- `comision_pct` y `credito_limit_usd` son CEO-only; si la identidad no es
  CEO, no los envíes.

No inventes el `tax_id`. Si el documento no lo trae, crea el cliente con lo
confirmado y deja una tarea por el dato faltante.

## 2. Operador

El operador decide los precios y la comisión:

- Si la operación la hace **Muito Work Limitada** (operación triangular),
  `operating_company_id` es el UUID del cliente operador Muito Work Limitada.
  Búscalo con `cliente_listar(q="Muito Work Limitada")` y confirma el registro
  exacto. No inventes el UUID.
- Si la operación la hace **el cliente** (compra directa), usa el UUID del
  cliente como operador o omite el campo si el backend lo infiere.

Si el correo no dice quién opera, búscalo en la OC, la proforma o el
expediente existente. Si sigue ambiguo, no crees el expediente: deja una tarea.

## 3. Productos y tallas

Para cada SKU:

1. `mcp__mwt__producto_buscar(q="<sku>")`; si no aparece, prueba
   `producto_listar(q="<sku>")` y busca por nombre.
2. Si existe, guarda su `producto_id`.
3. Si no existe:
   - Resuelve las tallas con `mcp__mwt__tallas_listar(tipo_producto="calzado")`.
   - Crea con `mcp__mwt__producto_crear(datos={...})`:
     `sku`, `nombre`, `marca_id`, `categoria`, `unidad="PAR"`,
     `precio_lista`, `precio_mwt`, `hs_code`, `pais_origen_iso2="BR"`,
     `estado="ACTIVO"`, `colores`, `tallas=[UUIDs]` y
     `especificaciones={ncm, color, sizes:[los MISMOS UUIDs]}`.
   - Nunca pongas labels de talla ni "UNICA" en `tallas` o `sizes`.
   - Después crea el alias del cliente con `mcp__mwt__producto_alias_crear`.
4. Si el producto existe pero le falta una talla, actualízalo con
   `mcp__mwt__producto_editar` añadiendo el UUID a `especificaciones.sizes` y a
   `tallas`.
5. Si le falta precio, actualízalo con `producto_editar` (ver regla de precios).

## 4. OC

Busca la OC con `mcp__mwt__oc_listar(q="<número>", client="<cliente_id>")` y
`mcp__mwt__oc_obtener`. El número es el de la OC del cliente, no el nombre del
archivo.

- Si existe, usa su `oc_id`.
- Si no existe, `expediente_crear` la crea a partir de `po_number` y
  `file_path`.
- Si hay que corregirla, usa `oc_editar` (código, cliente, moneda, estado,
  total, proforma, SAP, fecha).

Nunca escribas "SIN-PO" ni un número inventado. Si no hay OC, omite
`po_number` y deja que el backend genere una OC automática, o deja la tarea.

## 5. Buscar antes de crear

Siempre ejecuta `mcp__mwt__expediente_buscar` con al menos uno de:

- `oc_number` (OC/PO del cliente),
- `proforma` (PF),
- `sap`,
- `client_id`.

Si `existe=true`, **no crees otro**. Usa el `expediente_codigo` que devuelve y
actualiza.

## 6. Crear el expediente

`mcp__mwt__expediente_crear` acepta:

- `client_id`, `operating_company_id`, `brand_id`, `po_number`, `moneda`,
  `forma_pago` (`CREDITO` o `CONTADO`), `credit_days_mwt`,
  `credit_days_cliente`, `mode` (`COMISION` o `FULL`), `freight_mode`
  (`SEA` o `AIR`), `transport_mode`, `dispatch_mode`
  (`FCL`, `LCL`, `CONSOLIDADO`), `price_basis`, `idempotence_token`,
  `file_path`.
- `lines=[{sku, size, qty, unit_price?, producto_id?}]` o
  `ocr_payload={lines:[...]}`.

Reglas:

- Una línea por SKU × talla real. Nunca `PENDING`, `UNICA` o una línea vacía.
- `file_path` debe ser la ruta local del PDF/XLSX de la OC. Sin archivo, la OC
  queda con `storage_url=null`.
- Usa un `idempotence_token` único por intento lógico; si reintentas el mismo
  alta, reutilízalo.
- Los precios se re-derivan en el servidor; si el motor no tiene el precio,
  después fija los valores exactos con `lineas_actualizar_precios`.

### Regla de precios

- **Operado por Muito Work Limitada (triangular):**
  - `unit_price_client` = precio de la **OC** (lo que paga el cliente).
  - `unit_price_mwt` = precio de la **proforma** (costo proveedor).
  - En el producto: `precio_lista` = OC, `precio_mwt` = proforma.
- **No operado por Muito Work (compra directa):**
  - El precio del producto y de la línea es el de la **proforma**.
  - `unit_price_mwt` solo si el documento lo trae.

Si la OC y la proforma no coinciden, aplica la regla anterior y registra la
diferencia como discrepancia. No cambies un precio sin fuente.

## 7. Actualizar un expediente existente

- Cabecera: `mcp__mwt__expediente_editar` con `brand_id`, `modo_operacion`,
  `freight_mode`, `dispatch_mode`, `incoterm`, `forma_pago`,
  `operating_company_id`, `credit_days`, `credit_days_mwt`,
  `credit_days_cliente`, `moneda`.
- Líneas y operador: `mcp__mwt__expediente_edit_full_patch` con
  `lines_added=[{producto_id, sku, talla, qty}]`,
  `lines_removed=[linea_id]`, `lines_updated=[{id, qty}]`,
  `operating_company_id`, `forma_pago`, `payment_days`, `client_id`.
- Precios exactos: `mcp__mwt__lineas_actualizar_precios(updates=[{linea_id,
  unit_price_mwt, unit_price_client}])`. Obtén los `linea_id` con
  `expediente_lineas`.
- Verifica con `expediente_obtener`, `expediente_lineas` y
  `expediente_edit_full_get`.

## 8. Verificación

Antes de decir que el expediente quedó listo, comprueba:

- Cliente correcto y activo.
- Operador correcto.
- OC con número real y archivo almacenado.
- Una línea por SKU × talla, con cantidades y precios coherentes con la fuente.
- Forma de pago y plazos MWT/cliente.
- Moneda e incoterm.
- Comisión del cliente si aplica.
- Estado inicial `REGISTRO` y su fecha.
- Documentos de OC/PF subidos y verificables.

Si algo no cuadra, corrígelo o deja una tarea con la diferencia y la fuente.
