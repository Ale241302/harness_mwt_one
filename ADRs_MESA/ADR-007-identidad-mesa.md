# ADR-007 · Identidad canónica de los ítems de la Mesa

**Estado:** aceptado · **Fecha:** 2/11/2026 · **Decisión:** cierre P1
**Relacionado:** `ADR-006` (Mesa central con PostgreSQL y RLS), `packages/faberloom/board/src/keys.ts` (§2.1), `packages/faberloom/board/src/index.ts` (`proposeSourceRef`, `rekeyAll`)

## Contexto

La migración a la Mesa central escribió `business_key = 'legacy:<uuid>'` para los 436 de los 460 ítems del tenant `5525986c-3b09-4d13-bf8f-43ccaa2deae3` que no traían una clave de productor ni un `sourceRef` propio. Esa marca cumple la restricción `NOT NULL` del esquema, pero se leyó como provisional: mientras siga ahí, `business_key` no es una identidad decidida y el dedupe del servicio no puede confiar en ella.

Hay que decidir si esos 436 tienen una identidad mejor en su propio registro, y con qué regla se adopta sin romper nada.

## Qué mide el registro

Los 436 ítems son homogéneos: `artifactType = 'tarea'`, `spaceId = null`, `accountRef = null`, `sourceRef = null` en los 436; `payload.businessKey` es exactamente `legacy:<id>` en los 436. Ni `spaceId`, ni `accountRef`, ni `artifactType` distinguen una fila de otra.

Lo único que cada ítem sí registra es el asunto que trata, en la última revisión:

| Campo | Ítems | Qué identifica |
|---|---|---|
| `sourceRef` | 0 de 436 | La referencia propia del ítem. No existe en ningún ítem legado. |
| `revisions[].documentRef` | 2 de 436 (1 con token de expediente) | El expediente (`mwt:expediente:PF 2515-2026`): el asunto. El otro es un `imap:` sin token. |
| `revisions[].evidence` | 436 de 436 | Expediente, documento, SAP, ejecución o correo: el asunto. |
| `payload.runId` | 1 de 436 | La ejecución que produjo el aviso. |
| `payload.idempotencyKey` | 1 de 436 | La llamada del modelo que lo produjo. |

La evidencia no identifica la fila. Los 436 ítems cubren 123 pares distintos de (primera referencia de la evidencia, `artifactType`): 313 ítems comparten su primera referencia con otro ítem. La Mesa guarda varios avisos por expediente a propósito —«falta el SAP», «falta subir la OC/PO», «el estado quedó desfasado»— y cada uno es un ítem que un humano decide por separado.

Ese 313 no es una estimación: es el número que el propio servicio registra en el comentario de `rekeyAll` («el colapso de 313 artefactos del primer intento en producción») y la razón por la que existen `rollbackRekey` y `restoreRekeyCollisions`. Un intento anterior derivó claves de la evidencia y cerró 313 ítems como `SUSTITUIDO`.

El patrón de token del servicio tampoco es una identidad estable: `SOURCE_REF_PATTERN` corta en el separador del año, así que `PF 2515-2026` produce el token `PF 2515`. Dos expedientes con el mismo número en años distintos colapsarían al mismo token.

## Decisión

1. **La identidad canónica de cada uno de los 436 ítems es `legacy:<uuid>`**, con el uuid del propio ítem. Es inmutable (no depende de ningún campo editable), única por construcción (el uuid es la clave primaria `(tenant_id, id)`), reproducible en cualquier corrida y legible: dice de qué ítem viene sin consultar nada más. No hay una fuente mejor en el registro, y fabricar una a partir del asunto fusionaría ítems que el negocio quiere separados.
2. **Solo se adopta una referencia que el ítem declara como suya**: `payload.sourceRef`, o una clave de productor (`payload.businessKey`) que no sea la marca `legacy:<uuid>` de la migración. Con esa referencia la clave se recalcula con `businessKeyOf` (§2.1). En los 436 no hay ninguna: la distribución por motivo es `recorded` = 0.
3. **`documentRef` y `evidence` se reportan, nunca se adoptan.** Nombran el asunto; adoptarlos reproduce el colapso de 313. El reporte los cuenta en sus propios motivos (`document` = 1, `evidence` = 128) para que la decisión sea auditable ítem por ítem.
4. **Una clave derivada nunca pisa la de otro ítem vivo.** Si el destino ya pertenece a una fila no terminal, o a otra fila del mismo plan, el ítem conserva su clave actual y el reporte nombra la colisión y el ítem que la retiene. El índice `mesa_items_live_business_key_uniq` respalda la regla en la base.
5. **El backfill no toca las claves que decidió un productor.** Su alcance son las filas que todavía llevan la marca provisional; una fila viva con clave propia se clasifica e informa aparte. Cambiar la identidad de un ítem vivo es una decisión del servicio que la escribió, no de un backfill.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Derivar la clave de la evidencia (lo que hizo el primer intento) | Identifica el asunto, no la fila: 436 ítems → 123 referencias distintas, 313 colisiones. Cerró 313 ítems en producción y hubo que revertirlo. |
| Derivar la clave del `documentRef` | Mismo defecto, con un agravante: el token del patrón pierde el año (`PF 2515`), así que dos expedientes homónimos de años distintos chocarían. |
| Rehashar el literal `legacy:<uuid>` como si fuera un `sourceRef` | Es lo que haría `rekeyAll` sobre estas filas (toma `businessKey` como fuente cuando no hay `sourceRef`). Produciría una clave válida y única, pero deja de decir de qué ítem viene y no aporta dedupe: cambia legibilidad por nada. |
| Borrar los ítems sin identidad | Son 436 decisiones de negocio abiertas; el título y el estado son su contenido. |
| Dejar `business_key` sin decidir | Es el estado que este ADR cierra: el ítem no tiene identidad declarada, y quien lea la columna no puede saber si el valor es definitivo. |

## Consecuencias

- Los 436 ítems quedan con identidad definitiva. Una segunda corrida del backfill no cambia nada: `rekeyed` = 0, `unchanged` = 436.
- `business_key` sigue sirviendo para lo que sirve: dedupe por asunto cuando un productor declara `sourceRef`. Los ítems legados no participan de ese dedupe porque no declaran fuente; su unicidad la sostiene el uuid.
- El tenant queda con 0 claves vivas duplicadas (451 filas vivas, 451 claves distintas) y 2413 eventos intactos.
- Nada de `payload`, `state`, `row_version` ni `events` cambia en esta corrida, porque no hubo ninguna clave que adoptar.

## Hallazgos

1. **`rekeyAll` rehasheaba las 436 claves; corregido.** `packages/faberloom/board/src/index.ts` tomaba `record.businessKey` como fuente cuando `sourceRef` estaba vacío. Ahora una clave `legacy:<id>` no se usa como `sourceRef`: la fila se salta y conserva su clave, y solo migra cuando declara `sourceRef`. La prueba `keeps a legacy:<uuid> identity instead of rehashing it` en `packages/faberloom/board/tests/board-identity.spec.ts` fija las dos ramas.
2. **Cuatro ítems vivos tienen una clave que no concuerda con su propio registro.** No los tocó este backfill; se reportan en `liveIdentityObservations` del informe para que su dueño decida: `1967df17` y `c82a12d1` (descartados), `85ed32e0` (`PENDIENTE_CRITERIO`, `sourceRef = 'PF 2488-2026'`) y `81264287` (clave de productor `PF 2520-2026`, que además choca con `528c898d`).
3. **`SOURCE_REF_PATTERN` pierde el año** (`PF 2515-2026` → `PF 2515`). Cualquier propuesta derivada de ese token es ambigua entre ejercicios; se documenta y no se usa para identidad.

## Evidencia

| Hecho | Dato |
|---|---|
| Base | PostgreSQL 16.15 en `consola-mwt-one-postgres`, base `faberloom_mesa` |
| Ítems / eventos del tenant | 460 / 2413 |
| Ítems en alcance | 436 con `business_key = legacy:<id>` |
| Motivos (dry-run y apply) | `recorded` 0 · `document` 1 · `evidence` 128 · `legacy` 307 |
| Claves adoptadas | 0 (`rekeyed` 0, `collisions` 0) |
| Distribución final | `legacy:<uuid>` 436 · sha256 23 · otra 1 |
| Claves vivas duplicadas | 0 (451 vivas, 451 distintas) |
| API | 460/460 para `alejandro@muitowork.com` y `alvaro@muitowork.com` |
| Idempotencia | segunda corrida idéntica a la primera |
| Sin cambios | las tablas de claves y de eventos coinciden línea por línea con el respaldo previo |
| Herramienta | `scripts/rekey-board-postgres.mjs` (`--dry-run` por defecto, `--apply`) |
| Pruebas | `node --test scripts/rekey-board-postgres.test.mjs`: 15/15 |
| Informe | `docs/faberloom/rekey-mesa.md` |
