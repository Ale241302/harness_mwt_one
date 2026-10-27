---
name: marluvas-calidad
description: "Úsala cuando cierres un expediente o cuando haya que comparar dos fuentes que no cuadran (cajas, bultos, peso, cantidades, precios, contenedores, precintos, fechas, DUA), registrar la discrepancia, revisar comisión/margen/pagos y dejar el reporte final. También cuando falte un dato y haya que decidir si se bloquea o se continúa."
module: expedientes
action: view
---

# Calidad, discrepancias, finanzas y cierre

## Matriz de discrepancias

Compara cada campo entre TODAS las fuentes: cuerpo del correo, historial,
adjunto, enlace, OCR, imagen, OC, PF, SAP, factura, packing list, romaneiro,
BL/AWB, DUA y expediente.

Campos que se comparan siempre:

- Cajas / bultos.
- Contenedores y precintos.
- Peso bruto, peso neto y volumen.
- Cantidades por SKU × talla.
- Precios unitarios y totales.
- PF ↔ OC ↔ SAP ↔ HBL/AWB ↔ booking ↔ contenedor.
- ETD, ETA, fechas de producción, despacho, arribo y entrega.
- FOB, flete, seguro, CIF, DAI, IVA, otros tributos.
- Razón social, tax id y dirección del importador.

Registra siempre las dos fuentes y los dos valores literales. No promedies, no
"corrijas" en silencio y no elijas una fuente sin evidencia.

### Clasificación

- **BLOQUEANTE**: cajas/bultos, contenedores/precintos, peso/volumen,
  cantidades por SKU/talla, identificadores, valores aduaneros o razón social.
  Impacto típico: multa aduanera, sobrestadía, rechazo de documento o descuadre
  de inventario.
- **ADVERTENCIA**: fechas estimadas sin impacto operativo, formato o un valor
  que se puede explicar con evidencia unidireccional.

### Modo autónomo

Una discrepancia **no detiene** el pedido. Haz esto:

1. Regístrala en el reporte y, si el expediente lo permite, en una nota o campo
   de observaciones.
2. Marca el pedido como `BLOQUEADO (discrepancia)` en el reporte.
3. Continúa con las partes que sí están confirmadas, usando la fuente de mejor
   evidencia y anotando `fuente_usada`.
4. Deja una tarea en el banco de trabajo con el campo, las fuentes, los valores
   y el impacto.
5. Repórtala al final. Solo detente si la discrepancia impide identificar el
   expediente (sin PF/OC/cliente); en ese caso deja el pedido documentado y
   pasa al siguiente.

## Finanzas

Para el expediente:

- `mcp__mwt__finanzas_overview()` para los KPIs y el top de expedientes.
- `mcp__mwt__finanzas_comisiones(client_id="<cliente>")` para comisión, margen
  y devengo.
- `mcp__mwt__pago_listar(expediente_id="<uuid>")` y `pago_obtener` para
  anticipos, saldos, SWIFT y estado.
- `mcp__mwt__finanzas_cliente(client_id)` si hace falta el perfil del cliente.

Anota: `commission_rate`, `total_client`, `total_mwt`, `delta_total`,
`commission_amount`, `margen_pct`, forma de pago, días MWT/cliente,
`devengo_estado`, `fecha_devengo_esperada`, `fecha_facturada`,
`mes_pago_aproximado` y pagos.

Si falta la tasa de comisión, no la inventes: revisa el cliente y deja la
tarea. Si el cliente no tiene `comision_pct` y la identidad es CEO, se puede
asignar con `cliente_editar`; si no, deja la tarea.

## Cierre del expediente

Antes de cerrar:

- El estado es `EN_DESTINO` y hay evidencia de entrega al cliente.
- La recepción y el movimiento están conciliados.
- Los artefactos están persistidos y publicados según corresponda.
- Las finanzas están revisadas.
- Las discrepancias están registradas.

Avanza a `CERRADO` con `expediente_avanzar_estado`, `occurred_at` = fecha de
entrega y `note` = fuente. No cierres por conveniencia ni por silencio.

## Reporte final del pedido

Devuelve un bloque con:

1. PF / OC / SAP / cliente / operador.
2. Correos e hilos leídos y adjuntos descargados.
3. Expediente: `expediente_id`, estado actual, fechas por fase.
4. Nodos origen/destino.
5. Productos y líneas: SKU, talla, cantidad, precio cliente, precio MWT, NCM.
6. Recepción: `recepcion_id`, nodo, items, costos, artefactos.
7. Movimiento: `transferencia_id`, origen → destino, `legal_context`, tracking,
   costos, artefactos, estado.
8. Documentos y artefactos: template, `artifact_id`, archivo, publicado.
9. Finanzas: comisión, margen, devengo, pagos.
10. Discrepancias: campo, fuentes, valores, clasificación, estado.
11. Pendientes: qué falta, dónde se buscó, qué tarea quedó.
12. Veredicto: `COMPLETO`, `BLOQUEADO-DISCREPANCIA` o `EN_PROCESO`.

## Memoria

Si descubres un patrón útil (un asunto de Marluvas, un formato de SAP, una
convención de SKU/talla, un error que corregiste), guárdalo con
`faberloom_memory_teach` para que la próxima corrida sea más rápida. No guardes
datos personales innecesarios ni credenciales.
