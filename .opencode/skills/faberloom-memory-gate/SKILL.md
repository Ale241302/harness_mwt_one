---
name: faberloom-memory-gate
description: Controla la experiencia y las lecciones de FaberLoom: sin base no propone, la activación es humana, la revocación es persistente y ninguna experiencia cruza espacios sin autorización. Usar al implementar o revisar memoria, asignación, sugerencias o curación.
---

# Compuerta de memoria

## Las tres reglas de la experiencia

1. **Sin base, no hay propuesta.** Si no hay experiencia pertinente, el agente presenta el
   pendiente y no inventa una solución.
2. **Con base, se cita.** Toda sugerencia declara espacio, fuentes, diferencias y vacíos.
3. **Conflicto visible.** Si dos lecciones se contradicen, se muestran ambas; no se elige en
   silencio la más reciente.

## Activación y revocación

- Una lección nace como propuesta. No influye en ninguna respuesta mientras no haya aprobación
  humana explícita.
- Aprobar una respuesta **no** aprueba una generalización. Son dos actos distintos.
- Ninguna ruta acepta `active: true` desde una tool, un flujo, un MCP o un import. La activación
  se registra como acto humano con autor y fecha.
- Revocar surte efecto tras reinicio y tras restaurar una copia. Si la lección revive desde una
  caché, la revocación está rota.

## Frontera de espacios

- Cada tarea pertenece a un espacio. Un espacio principal y, como mucho, una referencia a otro.
- La lección se guarda en el principal.
- Lo heredado de otro espacio no entra sin autorización registrada.
- Lo que no se asignó queda en «Sin espacio». No se adivina.

## Curación

Conservar, editar, unir, revocar y descartar conservan linaje, historial y versión. Una unión no
duplica ni pierde el origen. Las versiones antiguas dejan de usarse.

## Mediciones honestas

Cada informe separa denominadores: con sugerencia y sin sugerencia, útiles, corregidas,
descartadas, revocadas. Los motivos desconocidos se cuentan como desconocidos. Inventar un
porcentaje cuando falta base es un cierre falso.

## Prohibiciones

- Memoria entre espacios sin autorización.
- Activación automática por volumen de uso.
- Reaparición de lecciones revocadas tras restore.
- Presentar una aprobación de mensaje como aprobación de conocimiento.
