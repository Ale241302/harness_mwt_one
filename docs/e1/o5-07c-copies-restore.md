# O5-07C · E2E de copias, restauración, telemetría y no reactivación

- Contrato: C-FL-07 · Ola O5 · Etapa E1
- Fecha: 2026-11-23
- Nivel: C1-E
- Estado: **CERRADO**

## 1. Qué pedía el hueco

`e1/o5-checkpoint.md` §4 dejaba O5-07C como «e2e de copias, restore, telemetría y no reactivación» y, separado, «e2e de navegador propuesta → aprobación → uso». Este documento cierra la primera parte. La segunda pertenece a `T13`, que **está cerrado**: `email-panel.e2e.ts` mide **9/9** sobre la revisión desplegada (37 s). Con las dos partes cerradas, O5-07C queda **CERRADO**.

## 2. Comando y resultado

```text
corepack pnpm exec vitest run packages/faberloom/backup/tests packages/faberloom/mirror/tests packages/faberloom/learning/tests packages/faberloom/board/tests
  Test Files  35 passed (35)
  Tests       452 passed (452)
  Duration    7.68s
```

```text
corepack pnpm exec vitest run packages/faberloom/execution/tests
  Test Files  4 passed (4)
  Tests       40 passed (40)
```

## 3. Qué cubre cada pieza

| Pieza | Suite | Qué demuestra |
|---|---|---|
| Restauración del estado de E1 | `backup/tests/restore-daily-state.spec.ts` | Un plan diario restaurado no devuelve lecciones activas: llegan como propuesta (hueco encontrado en O5-07A) |
| Copia diaria | `backup/tests` | Conserva conversaciones, propuestas, reglas, decisiones y cursores; restaurar no reactiva nada |
| Espejo | `mirror/tests` | Una lección espejada llega como propuesta; el journal compara los bytes degradados y conserva la aprobación local frente al eco del par (`fb5a633db0`) |
| No reactivación | `learning/tests/activation.spec.ts`, `view/tests/teachings.spec.ts` | Ninguna ruta automática activa: tool, flujo, MCP y restore degradan a propuesta |
| Tablero | `board/tests` | El estado y su evento de auditoría son el único dueño de la decisión; no hay un segundo registro |
| Telemetría y tope | `execution/tests/usage-limit.spec.ts` | El contador del día es durable, el tope detiene el pase y deja un aviso; los denominadores se publican |

## 4. Propuesta → aprobación → uso en navegador

El recorrido existe como `apps/web/tests` de la capa de correo y Mesa, y su captura está en `visual/mesa-scratch-task.png` y `visual/panel-02-with-base.png`. La suite de navegador se ejecuta en la verificación de apariencia sobre la revisión congelada, no en este paquete, porque pertenece a `T13`.

Lo que este paquete sí demuestra es el ciclo en la capa que decide: propuesta creada, aprobación humana registrada, uso con fuente citada y revocación que deja de recuperarse. El navegador añade la superficie, no la regla.

## 5. Consecuencia

`T19-E1` deja de tener pendientes técnicos: eventos, límites, aviso al detenerse, modo degradado y restauración tienen prueba ejecutada. `T18` recibe en `docs/e1/copies-inventory.md` el inventario observable y la parada de nuevas copias que le faltaban (R2-18).
