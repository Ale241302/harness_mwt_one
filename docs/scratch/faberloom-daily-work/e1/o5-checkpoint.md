# Punto de control — Ola O5 (E1: asignar, iterar, proponer)

- Contrato: C-FL-04 · Etapa E1
- Fecha: 2026-11-18
- Rama de trabajo: `fix/guarda-operadores` publicada en `main` del fork `Ale241302/harness_mwt_one`
- Estado global: **O5 cerrado**. Los huecos que este documento listaba quedaron cerrados el 2026-11-24: O5-07A/B/C en `docs/e1/o5-07b-telemetry.md` y `o5-07c-copies-restore.md`; copias en `copies-inventory.md`; demos y paquete PC3 en `demos-a-d.md`; PC3 en `D/decisions/PC3-2026-11-23.md`. Lo que sigue en la sección 4 es historial.

## 1. Contratos entregados antes de esta sesión

| Contrato | Expediente | Qué demuestra |
|---|---|---|
| O5-01 frontera de espacios | `space-boundary.md` | Un Space no presta memoria, referencias ni autoridad a otro |
| O5-02A/B/C reglas y gesto de asignación | `assignment-rules.md`, `assignment-gesture.md` | La regla visible no mueve ni envía |
| O5-03 conversación única | `iteration-conversation.md` | La iteración ocurre en una sola conversación |
| O5-04 tres entradas | `task-entries.md` | Las tres entradas de E1 comparten contrato |
| O5-05 filtro de experiencia | `experience-filter.md`, `evidence-O5-05-live.md`, `evidence-O5-05-session.md` | Abstención, citas, conflictos y faltantes; inspección con modelo real y sesión completa |

## 2. Lo que esta sesión agrega

| Contrato | Estado | Evidencia |
|---|---|---|
| O5-06A activación humana | **PASS** revisión independiente ronda 2 | `teaching-activation.md`; `learning/tests/activation.spec.ts`; `view/tests/teachings.spec.ts` |
| O5-06B ninguna ruta activa sola | **PASS** revisión independiente ronda 3 | `activation.spec.ts`; rechazo en tool, flujo y MCP; mirror y restore degradan a propuesta; el journal del mirror compara los bytes degradados y conserva la aprobación local frente al eco del par (`fb5a633db0`) |
| O5-07A restore seguro | **parcial** | `restore-daily-state.md`; `backup/tests/restore-daily-state.spec.ts` |

## 3. Huecos reales que la ola encontró

| Hueco | Dónde estaba | Cómo quedó |
|---|---|---|
| MCP creaba la enseñanza activa sin persona | `mcp-server/src/tools.ts` | Registra propuesta y rechaza `active:true` |
| La tool ofrecía `active` y el flujo lo aceptaba | `tool-faberloom`, `handlers/src/steps.ts` | Ninguna ruta automática activa; prueba por ejecutor |
| El perfil de voz del correo leía propuestas y revocadas | `view/src/index.ts` (`emailVoice`, `emailDraftWithAi`) | Lee con `retrieve`, solo activas |
| Una copia restaurada devolvía lecciones activas | `backup/src/index.ts` | Plan diario siempre aplicado |
| El mirror replicaba lecciones activas | `mirror/src/sync.ts` | Llegan como propuesta |
| El journal del mirror comparaba la fila activa con la degradada | `mirror/src/index.ts` | El hash usa los mismos bytes degradados; una edición del par sí llega |

## 4. Lo que falta, con dueño

| Pendiente | Dueño | Disparador |
|---|---|---|
| O5-07B eventos, costos y límites durables con denominadores y avisos | E1 | Antes de PC3 |
| O5-07C e2e de copias, restore, telemetría y no reactivación | E1 | Tras 07A/07B |
| O5-08 demos a–d, DC-4 y paquete PC3 | CEO + E1 | Requiere observación del CEO y `AUTH-REAL-READ` |
| Inventario y retirada de copias del piloto | OPS/CEO | Antes de PC3 |
| e2e de navegador propuesta → aprobación → uso | E1 | Puede entrar con 07C |
| Límite de ejecución que detiene y avisa | E1 | O5-07B |

O5-08 no se puede cerrar por el agente: las demos y PC3 exigen al CEO y la autorización de lectura real.
