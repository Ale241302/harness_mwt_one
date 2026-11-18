# O5-07A — Restauración segura del estado diario

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Estado: **parcial**: el plan de restauración está entregado y probado; el inventario/retirada de copias y su auditoría quedan abiertos
- Depende de: O3-06 (custodia) y O5-06B (ninguna ruta activa lecciones sola)

## 1. Qué hace el plan

`planDailyRestore(payload)` en `packages/faberloom/backup/src/restore-plan.ts` recibe el payload verificado de una copia y devuelve:

1. Un payload nuevo, sin mutar el original.
2. Un plan con cada campo cambiado, su valor anterior, el nuevo y el motivo.
3. Contadores separados y el modo en que debe quedar el producto.

| Estado en la copia | Estado restaurado | Motivo |
|---|---|---|
| Rutina `active` | `paused` | `ROUTINES_PAUSED` |
| Ejecución `running` o `waiting` | `needs_review`, sin espera ni fecha límite | `EXECUTIONS_DETACHED` |
| Lección `active` | `candidate` | `TEACHINGS_REQUIRE_APPROVAL` |
| Concesión no revocada | Se conserva y se inventaría | `ACCESS_RESTORED` |
| Dominio `faberloom_backup` en el payload | Se retira | `COPIES_NOT_REPLICATED` |

`restoreBackup(ownerId, id)` aplica ese plan siempre antes de escribir; no hay una opción para restaurar lecciones activas sin aprobación. El resultado lleva `plan` con `degraded`, `mode: 'read-only-until-review'`, `review`, `changes` y `counts`. `dryRun` devuelve el mismo plan sin tocar el medio.

## 2. Qué conserva

Historia de versiones, pasos y evidencia de las ejecuciones, concesiones para inventario, textos y versiones de las lecciones, y los registros de rendimiento. Lo que no se conserva es la *efectividad*: nada arranca solo al restaurar.

## 3. Evidencia ejecutada

```
vitest backup                                               13 pruebas, 3 archivos
tsc -b backup                                               exit 0
```

| Prueba | Qué demuestra |
|---|---|
| `restore-daily-state.spec.ts` plan puro | Pausa rutinas, desengancha ejecuciones, propone lecciones y retira el dominio de copias |
| `restore-daily-state.spec.ts` original intacto | El plan no muta el payload capturado |
| `restore-daily-state.spec.ts` restauración real | Una lección activa vuelve como propuesta y conserva su texto |
| `restore-daily-state.spec.ts` dry run | Informa el plan y no escribe |

## 4. Lo que falta para cerrar O5-07A

- Inventario observable de copias del piloto, paro de nuevas copias/replicación y retirada donde corresponda (`scripts/audit-faberloom-copies.mjs`), con su prueba.
- Restauración de un estado E1 completo medido de punta a punta, no solo la tabla de lecciones.
- Decisión escrita sobre qué concesiones restauradas requieren re-aprobación del dueño y cuáles se conservan efectivas.

No se presenta como cerrado.
