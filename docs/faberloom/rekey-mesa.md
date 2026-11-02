# Rekey de la identidad de la Mesa

English | [中文](rekey-mesa.zh.md)

Esta página registra el estado de la identidad de los ítems de `faberloom_mesa` después del cierre P1: los 460 ítems del tenant `5525986c-3b09-4d13-bf8f-43ccaa2deae3`, de los cuales 436 llevaban la clave provisional `legacy:<uuid>` de la migración. La decisión y sus alternativas están en [ADR-007](../../ADRs_MESA/ADR-007-identidad-mesa.md); aquí queda el procedimiento y lo que devolvió contra la base real.

## Decisión en una línea

`legacy:<uuid>` es la identidad canónica y permanente de los 436 ítems: ningún campo del registro identifica la fila, y los que nombran el expediente identifican el asunto —la Mesa guarda varios avisos por expediente a propósito—. Solo se adopta una clave derivada cuando el ítem declara `sourceRef` o una clave de productor propia; en este tenant no hay ninguno.

## Ejecución

```sh
node scripts/rekey-board-postgres.mjs --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_DATABASE_URL" --export-dir .artifacts/mesa-rekey

node scripts/rekey-board-postgres.mjs --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_DATABASE_URL" --export-dir .artifacts/mesa-rekey --apply
```

Sin `--apply` el script es un dry-run: lee el tenant, clasifica cada ítem, escribe el informe y no modifica ninguna fila. Con `--apply` abre una transacción, exporta las claves actuales antes de escribir, aplica solo las claves adoptables y verifica dentro de la misma transacción que el número de ítems no cambió y que no quedó ninguna clave viva duplicada. El export incluye un `<informe>-revert.sql` con la reversión concreta de esa corrida.

La sesión entra con `SET LOCAL ROLE mesa_app` y fija `app.tenant_id` y `app.role = 'admin'`, igual que la migración: las políticas RLS de `mesa_items` se evalúan de verdad y el backfill puede escribir filas de cualquier owner del tenant.

## Resultado del tenant

| Dato | Valor |
|---|---|
| Ítems / eventos | 460 / 2413 |
| Ítems en alcance (`legacy:<uuid>`) | 436 |
| Claves adoptadas | 0 |
| Colisiones | 0 |
| Distribución final | `legacy:<uuid>` 436 · sha256 23 · otra 1 |
| Claves vivas | 451 filas, 451 claves distintas |
| Dry-run | 2/11/2026 17:44:00Z |
| Apply | 2/11/2026 17:45:19Z |
| Segunda corrida | idéntica: `rekeyed` 0, `unchanged` 436 |

Ninguna fila cambió de clave, `payload`, `state`, `row_version` ni eventos: no había ninguna clave que adoptar. El valor del cierre es que la identidad deja de ser provisional por decisión registrada, no por falta de decisión.

## Motivos por ítem

| Motivo | Ítems | Qué registra | Se adopta |
|---|---|---|---|
| `recorded` | 0 | `sourceRef` o clave de productor propia | Sí |
| `document` | 1 | `revisions[].documentRef` con un token de expediente | No: nombra el asunto |
| `evidence` | 128 | Un único token de expediente en la evidencia | No: nombra el asunto |
| `legacy` | 307 | Nada reconocible, o dos referencias mezcladas | No aplica |

Los 436 ítems tienen `artifactType = 'tarea'`, `spaceId = null`, `accountRef = null` y `sourceRef = null`; `payload.businessKey` es exactamente `legacy:<id>`. La primera referencia de la evidencia cubre 123 valores distintos entre los 436 ítems: 313 comparten su primera referencia con otro, que es el colapso que sufrió el primer intento de rekey en producción.

## Ítems vivos que el backfill no toca

Cuatro ítems vivos tienen una clave que no concuerda con su propio registro. Su identidad la escribió el servicio, así que el backfill los informa en `liveIdentityObservations` y no los cambia.

| Ítem | Estado | Clave actual | Clave que propone su registro |
|---|---|---|---|
| `1967df17-a631-490c-bba4-980b78dd181c` | `DESCARTADO` | `a9ca771b…` | `eee92c9d…` |
| `81264287-9eca-483a-a6b2-7dc1f1cd60ad` | `PENDIENTE_CRITERIO` | `PF 2520-2026` | `9f70a1f2…` |
| `85ed32e0-2a83-46bb-9aef-3a1570fedf3d` | `PENDIENTE_CRITERIO` | `c851cb74…` | `deb2266c…` |
| `c82a12d1-b53c-432f-80a3-e98baaaa373c` | `DESCARTADO` | `1ca3114c…` | `c1323a2e…` |

`81264287` es además el caso que prueba el guardia de colisión: su clave de productor `PF 2520-2026` resuelve al mismo asunto que `528c898d-bf28-450f-8e9f-660d72d41d05`, y el plan lo reporta como colisión en vez de escribirla.

## Verificación

```sql
SELECT count(*) FROM mesa_items WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3';  -- 460
SELECT count(*) FROM mesa_items
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND business_key LIKE 'legacy:%';                                                        -- 436
SELECT count(*) FROM (
  SELECT business_key FROM mesa_items
   WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
     AND state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO')
   GROUP BY 1 HAVING count(*) > 1
) duplicadas;                                                                               -- 0
```

La API responde 460 ítems para `alejandro@muitowork.com` y 460 para `alvaro@muitowork.com` con su token real, paginando de 200 en 200, y la distribución de estados no cambió: 450 `PENDIENTE_CRITERIO`, 6 `SUSTITUIDO`, 3 `DESCARTADO`, 1 `ERROR_RECUPERABLE`.

```sh
node --test scripts/rekey-board-postgres.test.mjs
```

Las pruebas cubren el dry-run sin escrituras, el apply idempotente, la colisión con un ítem vivo, la colisión entre dos filas del mismo plan y la conservación de `legacy:<uuid>` cuando el único rastro es el expediente del asunto.

## Respaldo y reversión

Antes del apply se exportó la tabla de claves y la de eventos del tenant a `.artifacts/mesa-rekey/`, con fecha en el nombre. Después del apply las dos exportaciones vuelven a coincidir línea por línea con el respaldo, así que el estado de la Mesa es el mismo que antes de la corrida. El informe de cada corrida incluye todas las claves anteriores y el SQL de reversión de las filas que esa corrida cambió; como esta corrida no cambió ninguna, el archivo lo dice.

## Revisión del servicio

`rekeyAll` ya salta la marca `legacy:<id>` de la propia fila: no la usa como `sourceRef`, así que una segunda pasada no rehashea los 436 ítems y solo migra los que declaran `sourceRef`. La prueba `keeps a legacy:<uuid> identity instead of rehashing it` en `packages/faberloom/board/tests/board-identity.spec.ts` fija las dos ramas.

## Pendientes

- `SOURCE_REF_PATTERN` corta en el separador del año (`PF 2515-2026` produce `PF 2515`), así que un token derivado no distingue expedientes homónimos de ejercicios distintos.
- Los cuatro ítems vivos de la tabla anterior siguen con una clave que no concuerda con su registro.
