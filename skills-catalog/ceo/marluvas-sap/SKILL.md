---
name: marluvas-sap
description: "Úsala cuando un correo traiga un SAP, una confirmación de fabricación, un archivo XLSX/PDF de SAP o líneas confirmadas, o cuando haya que registrar, corregir o actualizar el SAP de un expediente y pasar su producción. También cuando el SAP llegue por un enlace de descarga de Zendesk/Backoffice."
module: expedientes
action: update
---

# SAP y producción

## Identificar el SAP

Extrae del correo, del adjunto o del enlace:

- Número de SAP (`sap_id`), por ejemplo `275150` o `257021`.
- Fecha de fabricación o fecha de confirmación.
- Líneas confirmadas: SKU, talla, cantidad, precio si viene.
- Archivo original (XLSX/PDF) y su ruta local.
- PF/OC a la que pertenece.

Si el correo trae un enlace tipo `275150.xlsx`, descárgalo con
`faberloom_mail_download` y guárdalo. Ese archivo es el SAP real; no lo
reemplaces por una tabla reconstruida.

## Buscar antes de escribir

1. `mcp__mwt__expediente_buscar(sap="<sap_id>", proforma="<pf>", oc_number="<oc>")`.
2. Si el expediente no aparece, búscalo por cliente y por la PF del cuerpo.
3. Si el SAP ya existe, actualízalo; no crees otro expediente.

## Registrar el SAP

```
mcp__mwt__sap_upsert(
  expediente_id="<uuid o referencia>",
  sap_id="<numero>",
  lineas_confirmadas=[
    {"sku": "<sku>", "talla": "<talla>", "qty": 10, "unit_price": 0.0},
  ],
  fecha_fabricacion="YYYY-MM-DD",
  file_path="<ruta local del XLSX/PDF>",
)
```

Reglas:

- `lineas_confirmadas` debe tener una entrada por SKU × talla real. No uses
  `UNICA`, `PENDING` ni cantidades inventadas.
- Si el SAP confirma menos cantidad que el expediente, registra la diferencia;
  no ajustes las líneas del expediente sin evidencia.
- `file_path` es obligatorio cuando tengas el archivo. Sin archivo, el SAP
  queda sin binario.
- `sap_upsert` no cambia el estado; para pasar a producción usa
  `expediente_avanzar_estado` (ver `marluvas-estados`).
- Si el SAP ya existía y solo cambian líneas o fecha, vuelve a hacer
  `sap_upsert` con el mismo `sap_id`.

## Verificar

1. `mcp__mwt__sap_obtener(expediente_id, sap_id)`.
2. Confirma número, fecha, líneas y archivo.
3. `mcp__mwt__documento_listar(expediente="<uuid>", kind="SAP")` para comprobar
   que el binario quedó almacenado.
4. Si hay diferencias entre SAP y expediente, usa
   `mcp__mwt__sap_sincronizar_discrepancias` con acciones explícitas
   (`ADD_LINE`, `UPDATE_QTY`, `ATTACH_SAP`, `NOTIFY_CLIENT`) o deja una tarea.

## Pasar a producción

Cuando el SAP esté confirmado:

```
mcp__mwt__expediente_avanzar_estado(
  expediente_id="<uuid>",
  fase_to="PRODUCCION",
  note="SAP <numero> confirmado; fuente <archivo/correo y fecha>",
  idempotence_token="<uuid unico>",
  documento_id="<id del documento SAP si lo tienes>",
  occurred_at="<fecha real de confirmacion o fabricacion>",
)
```

La fecha de inicio de producción es la fecha real del SAP o de la confirmación
de fábrica. Si el correo solo trae una fecha de fabricación, usa esa. No uses la
fecha de hoy si el documento trae otra.

## Correcciones

- Si el SAP cambió (cantidades, fecha, archivo), actualízalo con `sap_upsert`.
- Si hay que corregir términos del SAP (operador, forma de pago, cliente,
  líneas), usa `sap_editar`; es CEO-only. Si la identidad no es CEO, deja la
  tarea.
- No borres el SAP anterior; `sap_upsert` mantiene el historial del expediente.

## Reporte

Devuelve número de SAP, expediente, líneas confirmadas, fecha de fabricación,
estado al que pasó, archivo subido y diferencias detectadas.
