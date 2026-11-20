# PC5-A · reglas S3

Estado: **mecanismo cerrado, activación real pendiente de cohorte y firma**. PC4 no está `CLOSED`.

## Qué queda cerrado

| Pieza | Evidencia |
|---|---|
| Cohorte: misma versión de regla, espacio, buzón, tipo de acción y ventana | `packages/faberloom/autonomy/tests/cohort.spec.ts` |
| 10 ejecuciones reales y ≥70 % aprobadas sin corrección; fixtures y duplicados fuera | mismo spec |
| Fallos técnicos aparte del denominador | mismo spec |
| Cambio material reinicia la cohorte | `isMaterialChange` en el mismo spec |
| Ejecutor S3: S4 bloqueado, autorización acotada, límite de ejecuciones, duplicado, suspensión | `packages/faberloom/autonomy/tests/s3.spec.ts` |
| Recuperación real del efecto al fallar o al suspenderse durante la ejecución | mismo spec: `undo` llamado y `reverted` |
| Esquema de activación con alcance, vigencia, volumen, recuperación y suspensión | `packages/faberloom/autonomy/tests/activation.spec.ts` y `docs/e3/rule-activation-schema.json` |

## Qué falta y quién lo firma

| Requisito | Estado |
|---|---|
| 10 ejecuciones productivas por regla | **PENDIENTE — datos reales**. Ningún fixture cuenta. |
| `AUTH-RULE-ACTIVATION` por regla | **PENDIENTE — CEO**. |
| PC4 `CLOSED` | **PENDIENTE**. Sin él, PC5-A no se abre. |
| Ventana común de informe y promoción en la UI | **PENDIENTE** de uso real; el mecanismo ya valida la cohorte. |

## Criterio de parada

Una regla no se activa con fixtures, con duplicados, con menos de 10 ejecuciones reales, por debajo del 70 %, sin autorización o con un cambio material sin cohorte nueva.
