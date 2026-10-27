---
name: marluvas-estados
description: "Úsala cuando haya que avanzar o corregir el estado de un expediente, poner fecha de inicio y fin de una fase, o inferir el estado desde un SAP, un BL/AWB, un packing list, un DUA o un correo de embarque. También cuando el usuario pregunte en qué estado está un pedido."
module: expedientes
action: update
---

# Ciclo de estados del expediente

## Los estados

El orden es:

```
REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO
```

- `REGISTRO`: la OC/PF existe y el expediente se creó.
- `PRODUCCION`: el SAP está confirmado o la fábrica confirmó el arranque.
- `PREPARACION`: se está preparando el despacho (packing list, factura
  comercial, certificado de origen, booking, documentación de exportación).
- `DESPACHO`: la mercancía salió de fábrica/origen y se despachó.
- `TRANSITO`: está en el transporte internacional (BL/AWB emitido, ETD
  confirmado, contenedor o vuelo en curso).
- `EN_DESTINO`: llegó al país/puerto/depósito de destino o se nacionalizó.
- `CERRADO`: se entregó al cliente y no queda gestión operativa.

## Regla de fechas

Cada transición se registra con `occurred_at` (ISO-8601, `YYYY-MM-DD` o
`YYYY-MM-DDTHH:MM:SS`). Esa es la **fecha real del evento**, no la de hoy.

- La fecha de inicio de una fase es la fecha de la transición que la abrió.
- La fecha de fin es la fecha de la transición que abrió la siguiente.
- Si el correo da un rango ("producción del 1 al 20 de junio"), usa el 1 para
  `PRODUCCION` y el 20 para `PREPARACION`.
- Si solo hay una fecha, úsala para la transición que corresponda y deja la
  otra como `[PENDIENTE]` en el reporte. No inventes.
- Si el estado actual ya está más adelante, no retrocedas. Registra la
  evidencia nueva en una nota o en el documento y sigue.

## Cómo avanzar

```
mcp__mwt__expediente_avanzar_estado(
  expediente_id="<uuid o referencia>",
  fase_to="PRODUCCION",
  note="<evidencia y fuente>",
  idempotence_token="<uuid unico por transicion>",
  documento_id="<documento que respalda, si existe>",
  occurred_at="YYYY-MM-DD",
)
```

Reglas:

- Un `idempotence_token` distinto por transición; reutilízalo solo si reintentas
  la misma.
- `note` debe decir qué documento o correo respalda la fecha.
- Si la herramienta exige pasar por una fase intermedia, avanza una por una con
  la misma fecha si la evidencia lo permite; no inventes una fase que no
  ocurrió.
- No cierres (`CERRADO`) sin evidencia de entrega al cliente.
- Si el expediente ya está en el estado destino, no vuelvas a llamar; verifica
  con `expediente_obtener` / `expediente_tiempos`.

## Inferencia desde documentos

| Evidencia | Estado que abre | Fecha |
| --- | --- | --- |
| OC, PF o pedido creado | REGISTRO | Fecha de la OC/PF |
| SAP confirmado o arranque de fábrica | PRODUCCION | Fecha del SAP/fabricación |
| Packing list, factura comercial, certificado de origen, booking, DUE | PREPARACION | Fecha del documento o del correo |
| Salida de fábrica, despacho aduanero, contenedor lleno | DESPACHO | Fecha de salida/despacho |
| BL/AWB emitido, ETD, vessel/flight confirmado | TRANSITO | ETD o fecha de emisión |
| Arribo, ETA cumplido, DUA pagado, nacionalización | EN_DESTINO | Fecha de arribo/nacionalización |
| Entrega al cliente, POD, cierre administrativo | CERRADO | Fecha de entrega |

Si dos documentos dan fechas distintas, usa el documento oficial (BL/AWB, DUA,
factura) y registra la diferencia como discrepancia.

## Verificar el estado

- `mcp__mwt__expediente_obtener` muestra el estado y los tiempos por fase.
- `mcp__mwt__expediente_tiempos(expediente_id)` muestra duraciones y fechas.
- Confirma que la fecha de inicio de una fase no es anterior a la de la fase
  previa. Si lo es, corrige con una nota o registra la discrepancia; no avances
  a ciegas.

## Reporte

Devuelve: estado anterior, estado nuevo, fecha real usada, fuente, documento
vinculado y qué fase queda pendiente con su fecha `[PENDIENTE]`.
