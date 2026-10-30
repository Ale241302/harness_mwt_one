---
name: marluvas-correo
description: "Úsala cuando necesites leer un correo de Marluvas o de un cliente, reconstruir el hilo completo, descargar adjuntos o enlaces, y extraer PF, OC, SAP, productos, tallas, cantidades, precios, fechas o tracking. También cuando el correo no traiga un documento claro y haya que buscar la evidencia en el historial."
module: correo
action: view
---

# Lectura y extracción del correo

## Qué lees

El evento de la rutina trae `uid`, `from`, `subject`, `date` y el buzón. Empieza
por `faberloom_mail_read(uid)`. Esa tool devuelve:

- `text`: el cuerpo en texto plano.
- `links`: enlaces de descarga encontrados en el cuerpo.
- `attachments`: cada adjunto con su nombre, tipo y contenido convertido a
  Markdown cuando se puede (PDF, XLSX, DOCX, CSV, imágenes).

No basta con el asunto. Lee el cuerpo completo, el historial citado y las
imágenes del cuerpo. Muchos pedidos solo aparecen en el historial o en una
captura pegada.

## Reconstruir el hilo

1. Normaliza el asunto: quita `Re:`, `RE:`, `Fwd:`, `RV:`, `[Marluvas]`,
   `[Ticket #...]` y espacios repetidos.
2. Busca con `faberloom_mail_search(query, limit)` por:
   - el asunto normalizado;
   - cada PF, OC y SAP que aparezca;
   - el remitente;
   - el número de ticket, booking, BL, AWB o contenedor.
3. Lee todos los `uid` relacionados, del más viejo al más nuevo. Si el hilo
   tiene más de 10 mensajes, prioriza los que traen documentos o cambios de
   fecha/estado, pero no ignores el primero ni el último.
4. Si el correo dice "sincronizar con el despacho 2393 y 2404", replica la
   evidencia en las dos PF. Un correo puede amparar varios expedientes.

## Descargar la evidencia

- Adjunto: `faberloom_mail_attachment(uid, name?)` guarda el archivo original
  en el workspace y devuelve su ruta. Úsalo para subirlo a MWT.ONE.
- Enlace del cuerpo: `faberloom_mail_download(url, name?)` guarda el archivo.
  Los tickets de Marluvas suelen traer un enlace tipo `275150.xlsx` o
  `[Y5R25X-ZM0LP]`; ese es el SAP o el documento, no lo ignores.
- Imagen inline: viene dentro de `attachments`; guárdala y aplica OCR/visión
  con `faberloom_mail_read` o leyendo el archivo.
- Si el enlace pide login y no puedes abrirlo, deja una tarea con el enlace y
  el motivo. No lo marques como descargado.

## Qué extraes

Por cada correo relevante anota, con la fuente legible (asunto del correo y fecha, o documento):

- Remitente, fecha y asunto. El `uid` es transporte: nunca se escribe en la evidencia.
- PF / proforma, OC / PO, SAP, pedido o remesa.
- Cliente final y razón social alterna si la hay.
- Operador: Muito Work Limitada o el cliente.
- Productos: SKU, descripción, talla, cantidad, precio MWT, precio cliente,
  moneda, NCM.
- Términos: forma de pago, días de crédito MWT, días de crédito cliente,
  incoterm, modo de operación, modo de flete, modo de despacho.
- Comisión del cliente o del expediente, si aparece.
- Fechas: emisión de PF/OC, confirmación SAP, fabricación, cargo ready, ETD,
  ETA, arribo, nacionalización, entrega.
- Tracking: naviera/aerolínea, forwarder, buque/vuelo, booking, MBL/HBL/AWB,
  contenedor(es), tipo, precinto(s), bultos, peso bruto/neto, volumen.
- DUA/DUE: número, país, tributos, FOB/CIF, tipo de cambio.
- Documentos: packing list, romaneiro, factura comercial, certificado de
  origen, BL/AWB, booking, DUA, SAP, OC, PF, seguro.

## Cómo se escribe la evidencia del ítem

Cada referencia va en su propia línea y se entiende sin abrir el correo:

- Correo: `Correo «<asunto completo>» de <remitente> (<fecha>)`.
- Adjunto: `Adjunto «<nombre original>» guardado en <ruta del workspace> y en el almacén (key documento/<...>)`.
- Expediente: `Expediente <código> (PF <código>, PO <código>, SAP <código>) en estado <ESTADO>`.
- Nunca uses el `uid`, un UUID suelto ni una clave de almacenamiento como única referencia.
- Al crear el ítem manda `documentRef` con la `key documento/...` del adjunto principal: la Mesa la firma y la abre en otra pestaña.
## Reglas de extracción

- Un dato que no está, no se inventa. Se marca `[PENDIENTE]` con dónde se
  buscó.
- Si dos fuentes dicen cosas distintas, registra las dos y la diferencia. No
  promedies ni corrijas en silencio.
- Si el correo trae una tabla, respeta las tallas y cantidades. Una fila por
  SKU × talla.
- Si el PDF es escaneado, usa OCR/visión; si no se puede leer, guarda el
  archivo y deja la tarea.
- No marques como leído ni muevas a la papelera salvo que el usuario lo pida.
- No respondas automáticamente. Si hace falta una respuesta, crea un borrador
  con `faberloom_email_draft` y dilo en el reporte.

## Salida

Devuelve un bloque corto con:

1. Qué es el correo (tipo y expediente).
2. Qué evidencia encontraste y qué descargaste.
3. Qué datos quedaron confirmados y con qué fuente.
4. Qué falta o es ambiguo.
5. Qué skill sigue (`marluvas-expediente`, `marluvas-sap`, etc.).
