# Contrato · Cierre P3 — outbox de efectos y auditoría N3/N4 en la Mesa central

**Dueño:** agente de implementación. **Estado:** abierto. **Autoridad:** decide el diseño y lo implementa con pruebas.

## Objetivo

En modo `on`, que ninguna escritura de ítem quede solo en SQLite. Los dos casos
conocidos son:

1. `noteAccess`: la auditoría de lectura de un ítem N3/N4 se escribe hoy en el
   respaldo local; debe quedar en `mesa_events` de la Mesa central.
2. El outbox de efectos (`expireForDispatch`, consumo/revalidación) lee y escribe
   ítems en local; un ítem aprobado en la Mesa central no debe quedar invisible
   para el consumidor.

## Decisión que debes tomar (y registrar)

- Si el outbox sigue siendo una cola de lease por proceso (correcto para una
  cola de trabajo) o si pasa a tablas centrales. Si lo dejas por proceso, debe
  ser una decisión escrita con su porqué y una prueba de que no pierde ni
  duplica despachos; los **ítems** que toca deben ir a la Mesa central.
- Cómo auditar el acceso sin inflar `mesa_events` (una vez por hora y actor, como
  hoy) y sin abrir una ruta que permita falsificar el actor.

## Entregables

- `packages/faberloom/board/src/index.ts`, `remote-port.ts`,
  `remote-adapter.ts` y `remote.ts` actualizados.
- Si hace falta, `gateway/board-api.mjs` y
  `packages/faberloom/board/postgres/schema.sql` (DDL aditivo, idempotente).
- Pruebas nuevas en `packages/faberloom/board/tests/` y
  `gateway/board-api.test.mjs` que prueben el modo `on` con dos usuarios.
- `ADRs_MESA/ADR-009-outbox-y-auditoria-mesa.md` con la decisión.
- `docs/faberloom/mesa-outbox-auditoria.md` con el comportamiento resultante.

## Invariantes

- En `on`, ningún ítem se lee ni se escribe solo en SQLite para estas rutas.
- Un acceso N3/N4 deja exactamente un evento por actor y hora en la Mesa.
- El consumidor no despacha dos veces el mismo efecto ni lo pierde.
- El respaldo local sigue recibiendo copia, pero nunca decide.
- `off` y `shadow` conservan el comportamiento actual.

## Evidencia obligatoria

1. `npx tsc -p packages/faberloom/board/tsconfig.json --noEmit`.
2. `npx vitest run packages/faberloom/board/tests` verde (≥284).
3. `node --test gateway/board-api.test.mjs` verde (≥34).
4. Una prueba que demuestre el acceso N3/N4 remoto y otra del dispatch con el
   ítem solo en la Mesa central.

## Límites

- No despliegues el gateway ni toques la base real de producción.
- No cambies el contrato de las seis comandos ya cerradas.
- No imprimas tokens.
