---
name: marluvas-proforma
description: "Úsala cuando haya que generar, regenerar o subir una proforma/PF de un expediente, o cuando el correo pida las tres versiones HTML: cliente, Marluvas y Muito Work Limitada. También cuando haya que verificar que la PF coincide con las líneas y precios del expediente."
module: expedientes
action: upload_doc
---

# Proforma / PF

## Antes de generar

La proforma se construye con las **líneas actuales** del expediente. Si el
expediente no tiene líneas o precios, la PF sale en cero. Primero:

1. `mcp__mwt__expediente_obtener` para confirmar el expediente.
2. `mcp__mwt__expediente_lineas` para confirmar SKU, talla, cantidad y precios.
3. Si falta una línea o un precio, corrige con `expediente_edit_full_patch` o
   `lineas_actualizar_precios` antes de generar.

## Las tres versiones

Cuando el expediente lo opera **Muito Work Limitada**, `proforma_generar`
genera y persiste **tres documentos HTML en una sola llamada**:

- `CLIENT`: vista del cliente final, con el precio de venta.
- `MWT_INTERNAL`: vista CEO/triangular, con compra y reventa.
- `FABRICA`: vista Marluvas/proveedor, con el precio de compra de MWT.

Por eso **no llames tres veces**. Llama una vez:

```
mcp__mwt__proforma_generar(
  expediente_id="<uuid o referencia>",
  codigo="<PF ####-#### si ya existe>",
)
```

El parámetro `audience` por defecto es `CLIENT`; en una operación MWT el
backend ignora la selección y crea las tres. No inventes una audiencia
"Marluvas": la versión de Marluvas es `FABRICA`.

Si el expediente **no** lo opera MWT, se genera solo la vista que pidas:
`CLIENT` para el cliente, o `MWT_INTERNAL`/`ADMIN_ONLY` para la vista interna
tri-vista.

## Verificar las tres

Después de generar:

1. `mcp__mwt__documento_listar(expediente="<uuid>", kind="PROFORMA")`.
2. Deben aparecer tres filas con `audience` `CLIENT`, `MWT_INTERNAL` y
   `FABRICA`, el mismo `codigo` y `storage_url` no nulo.
3. Si alguna fila tiene `storage_url=null` o `file_size_bytes=0`, el documento
   está roto: bórralo con `documento_eliminar` y vuelve a generar.
4. Para entregar el archivo, usa `proforma_html` o `proforma_documento` y
   devuelve las URLs de descarga. No reconstruyas el HTML a mano.

## Subir la PF real del cliente

Si el correo trae la PF emitida por el cliente o por Marluvas, súbela además
como documento:

```
mcp__mwt__documento_subir(
  file_path="<ruta local>",
  kind="PROFORMA",
  codigo="####-####",
  expediente_id="<uuid>",
  audience="CLIENT",
)
```

El `codigo` debe ser el número limpio de la PF (por ejemplo `2453-2026`), no el
nombre del archivo. Si el código no cumple el formato, corrige el nombre antes
de subir.

Para OC/Proforma/SAP que deban cruzar líneas, prefiere:

```
mcp__mwt__match_subir(expediente_id="<uuid>", document_type="ART-02_PROFORMA",
                      file_path="<ruta>")
```

y resuelve las diferencias con `match_resolver`.

## Regenerar

Si la PF ya existe y cambió una línea, un precio o un plazo:

1. Corrige el expediente.
2. Vuelve a llamar `proforma_generar` con el mismo `codigo` para reemplazar la
   versión vigente.
3. Verifica que las tres audiencias tengan la versión nueva.
4. No dejes dos PF vigentes con el mismo código y contenidos distintos.

## Reporte

Devuelve:

- PF y expediente.
- Las tres audiencias con su URL o `documento_id`.
- Totales: pares, total cliente, total MWT y margen si la vista lo trae.
- Si falta una versión o un archivo, dilo.
