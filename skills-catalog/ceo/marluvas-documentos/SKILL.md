---
name: marluvas-documentos
description: "Úsala cuando llegue un documento de un expediente (packing list, romaneiro, BL, AWB, booking, factura comercial, certificado de origen, DUA, seguro, evidencia de carga) y haya que descargarlo, leerlo, persistirlo como artefacto del Builder, asociarlo a uno o varios expedientes y productos, y publicarlo. También cuando haya que verificar que un documento tiene archivo y no solo registro."
module: documentos
action: upload_doc
---

# Documentos y artefactos del Builder

## Dos capas distintas

- **Documentos** (`documento_subir`, `documento_listar`): OC, proforma, SAP,
  factura, DUA, BL. Viven en la capa de documentos del expediente.
- **Artefactos del Builder** (`nodo_artefacto_crear`, `artefacto_editar`): una
  instancia de una plantilla con `data` (valores y archivos), `lines`
  (expediente × producto × talla) y `publicado`. Es la capa oficial de la
  evidencia logística.

La carpeta local es el respaldo; la Consola es el registro oficial. Todo
documento que tenga plantilla debe quedar como artefacto.

## 1. Identificar la plantilla

`mcp__mwt__builder_templates_listar(only_published=true)` y busca por título o
tipo. Referencias habituales:

| Documento | Plantilla |
| --- | --- |
| AWB / BL / booking | `AWB/BL` (id 9) |
| Factura comercial | `Factura Comercial` (id 13) |
| Packing list / romaneiro | `Packing List Dellado` (id 23) |
| Certificado de origen | `Certificado de Origen` (id 25) |
| DUA / DUE / liquidación | la plantilla aduanera publicada que corresponda |
| OC / Proforma / SAP | `OC Cliente`, `Proforma MWT`, `Confirmación SAP` si están publicadas |

Si no encuentras una plantilla para el documento, **no inventes un id**. Usa la
plantilla genérica publicada más cercana o deja una tarea. Confirma con
`builder_template_obtener(template_id)` y guarda su `structure_json` como
`structure_snapshot`.

## 2. Resolver el alcance

- `expediente_id`: el expediente del pedido. Si el documento ampara varias PF,
  incluye todas.
- `nodo_id`: el nodo donde cuelga el artefacto. Normalmente el nodo del
  expediente o el nodo de recepción. Búscalo con `nodo_listar` / `nodo_obtener`.
- `lines`: una entrada por (expediente × producto × talla) real del documento:
  `{expediente_id, producto_id, talla, qty, sku?, nombre?}`. Un artefacto
  multi-expediente lleva todas las líneas; no dupliques el artefacto por
  carpeta.

## 3. Subir el archivo

Para cada campo de tipo `file` del template:

```
mcp__mwt__storage_subir_archivo(
  file_path="<ruta local del PDF/imagen>",
  scope="artifact-field/<field_id>",
  filename="<nombre real>",
)
```

La respuesta trae `key`, `content_type` y `size`. Construye:

```
data["<field_id>"] = {
  "key": "<key>",
  "url": "https://consola.mwt.one/api/storage/download/?key=<key>",
  "name": "<filename>",
  "mime": "<content_type>",
  "size": <size>,
}
```

El mínimo imprescindible es `key`, pero incluye los demás campos para que la
descarga se vea bien.

## 4. Crear o actualizar el artefacto

Antes de crear, busca si ya existe:

- `mcp__mwt__inventario_artefactos_expediente(expediente_id)`.
- `mcp__mwt__nodo_artefactos_listar(nodo_id, template_id)`.

Compara por template + documento + expediente + líneas. Si existe, actualiza:

```
mcp__mwt__artefacto_editar(
  nodo_id="<uuid>",
  artifact_id="<uuid>",
  cambios={"data": {...}, "lines": [...], "structure_snapshot": {...}},
)
```

Si no existe, crea:

```
mcp__mwt__nodo_artefacto_crear(
  nodo_id="<uuid>",
  template_id=<id>,
  template_title="<titulo>",
  data={...},
  structure_snapshot=<structure_json>,
  lines=[...],
)
```

Llena `data` con los valores extraídos por OCR/lectura:

- `number`: cajas, peso bruto, peso neto, m³, totales.
- `date`: fechas en `YYYY-MM-DD`.
- `select`/`radio`: el **label** de la opción, no el id.
- `text`: números de BL/AWB, booking, contenedor, precinto, naviera, puerto.

## 5. Publicar

```
mcp__mwt__artefacto_publicar(
  nodo_id="<uuid>",
  artifact_id="<uuid>",
  publicado=true,
)
```

Publica solo lo que el cliente debe ver. Si el documento es interno (por
ejemplo, una factura de compra o un costo), déjalo sin publicar.

## 6. Verificar cobertura

Al cerrar el pedido, revisa que cada archivo de la carpeta que tenga plantilla
esté como artefacto:

- `inventario_artefactos_expediente(expediente_id)`.
- `nodo_artefactos_listar(nodo_id)`.
- `documento_listar(expediente=<uuid>)`.

Si falta un artefacto, créalo. Si el documento no tiene plantilla, deja la
tarea y no lo inventes.

## 7. Documentos que también van a la capa de documentos

- OC: `match_subir(document_type="ART-01_OC")` o `documento_subir(kind="OC",
  codigo="<nº real>")`.
- Proforma: `match_subir(document_type="ART-02_PROFORMA")` o
  `documento_subir(kind="PROFORMA", codigo="####-####")`.
- SAP: `sap_upsert(file_path=...)` o `match_subir(document_type="ART-04_SAP")`.
- BL/AWB, DUA, factura, certificado: `documento_subir` con su `kind` y
  `codigo`.

## Reporte

Devuelve: documento, template, `artifact_id`, expediente(s), producto(s),
archivo subido, valores extraídos, `publicado` y cualquier brecha.
