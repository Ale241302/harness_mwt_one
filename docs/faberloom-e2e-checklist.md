# FaberLoom — checklist de pruebas F01–F50

English | [中文](faberloom-e2e-checklist.zh.md)

Complementa el plan §17. Cada caso tiene su verificación automatizada (spec del paquete) o su recorrido manual en el VPS (dos usuarios de prueba, datos autorizados, sin comunicaciones externas). El piloto es navegador.

Prioridad de ejecución: **F08, F10, F16, F17, F18, F23, F28, F43, F50** (marcadas ★).

| ID | Verificación | Tipo |
|---|---|---|
| F01 | `spaces/tests/spaces.spec.ts`: espacio sin MWT se crea y opera | Automática |
| F02 | `spaces/tests/spaces.spec.ts`: herencia desactivada no trae contexto excluido | Automática |
| F03 | `agents/tests/agents.spec.ts`: duplicar no copia confianza ni memoria privada | Automática |
| F04 | `mcp-server/tests/mcp.spec.ts`: rutina por MCP y misma identidad/versión | Automática |
| F05 | `routines/tests/routines.spec.ts`: editar no cambia la ejecución en curso | Automática |
| F06 | `routines/tests/routines.spec.ts`: `MISSING_HANDLER` declara el faltante | Automática |
| F07 | Manual VPS: misma OC por dos canales → un caso con ambas evidencias | Manual |
| F08 ★ | Manual VPS: proforma de Eguisa comprobada contra MWT (datos, términos, archivo) | Manual |
| F09 | `board/tests/board.spec.ts`: revalidar antes del efecto si cambia el precio | Automática |
| F10 ★ | Manual VPS: cerrar sesión/reiniciar gateway y reanudar sin repetir efectos | Manual |
| F11 | `routines/tests/routines.spec.ts`: timeout tras escritura se reconcilia | Automática |
| F12 | `routines/tests/routines.spec.ts`: respuesta previa cancela el borrador | Automática |
| F13 | `learning/tests/memory.spec.ts`: corrección se recupera en un caso posterior | Automática |
| F14 | `learning/tests/memory.spec.ts`: muchas iteraciones no son fallo del agente | Automática |
| F15 | `learning/tests/memory.spec.ts`: error tardío conserva historia y versiona | Automática |
| F16 ★ | `board/tests/board.spec.ts`: preparar autorizado, nunca enviar | Automática |
| F17 ★ | `access/tests/access.spec.ts`: revocar deniega el próximo efecto | Automática |
| F18 ★ | `mcp-server/tests/mcp.spec.ts` + `access`: sin acceso a otro cliente, denegación efectiva | Automática |
| F19 | `agents/tests/agents.spec.ts`: fallback registra modelo efectivo y motivo | Automática |
| F20 | `backup/tests/backup.spec.ts`: respaldo y restauración con integridad | Automática |
| F21 | Manual VPS: actualización del harness con `update-harness.sh` y rollback | Manual |
| F22 | `execution/tests/dispatcher.spec.ts`: segundo proceso reutiliza el motor | Automática |
| F23 ★ | `agents/tests/agents.spec.ts`: exclusividad detiene el paso si falla el proveedor | Automática |
| F24 | `agents/tests/agents.spec.ts`: recomendación explica evidencia e incertidumbre | Automática |
| F25 | `agents/tests/agents.spec.ts`: costo por resultado útil, no tarifa por token | Automática |
| F26 | `agents/tests/agents.spec.ts`: escalamiento autorizado dentro del presupuesto | Automática |
| F27 | `agents/tests/agents.spec.ts`: falta de dato no se inventa | Automática |
| F28 ★ | `agents/tests/agents.spec.ts`: presupuesto compartido se agota y detiene llamadas | Automática |
| F29 | `mcp-server/tests/mcp.spec.ts`: política por MCP y consulta en UI, misma versión | Automática |
| F30 | `agents/tests/agents.spec.ts`: tarifa desconocida se muestra como incertidumbre | Automática |
| F31 | `agents/tests/agents.spec.ts`: subagente con modelo más capaz y costo agregado | Automática |
| F32 | `backup/tests/backup.spec.ts`: restaurar especialista conserva política y métricas | Automática |
| F33 | `agents/tests/agents.spec.ts`: pool, cero y tarea entran al mismo catálogo | Automática |
| F34 | `defaults/tests/defaults.spec.ts`: especialista conserva procedimiento, no contexto ajeno | Automática |
| F35 | `handlers/tests/agent-steps.spec.ts`: subagente temporal no ocupa el catálogo | Automática |
| F36 | `learning/tests/memory.spec.ts`: editar/revocar usa la versión vigente y conserva historia | Automática |
| F37 | Manual VPS: iniciar sin espacio/agente/rutina con contexto personal aislado | Manual |
| F38 | Manual VPS: iterar con adjunto y reiniciar recuperando borrador y referencias | Manual |
| F39 | Manual VPS: crear especialista o rutina desde la propuesta de conversación conserva origen | Manual |
| F40 | Manual VPS: dos conversaciones separadas sin mezcla de historial | Manual |
| F41 | Manual VPS: vincular conversación personal a un espacio compartido revisa audiencia antes | Manual |
| F42 | Manual VPS: delegar a un agente con otro modelo respeta política y presupuesto | Manual |
| F43 ★ | `context/tests/context.spec.ts`: un no-miembro no puede colocar ni reemplazar contexto en un Space (fail-closed) | Automática |
| F44 | `context/tests/context.spec.ts`: un `shared` solo es visible para lectores de su Space (`list`/`export`/`get`) | Automática |
| F45 | `context/tests/context.spec.ts`: `import` idempotente (incluido el payload repetido) y `replace` solo del owner | Automática |
| F46 | `spaces/tests/reference.spec.ts` + `knowledge-index/tests`: `find` puntúa entradas curadas y texto de adjuntos (con ranker), KB/embeddings con fallback léxico | Automática |
| F47 | `tool-faberloom/tests/spaces-ask.spec.ts` + `plane.spec.ts`: el plano del agente responsable deniega fuentes deshabilitadas y respeta la allowlist de subagentes del llamador | Automática |
| F48 | `session-agent/tests/session-agent.spec.ts`: una sesión de Space se compone como su agente; el hijo delegado no se recompone | Automática |
| F49 | `agent-runtime` + `tool-faberloom/tests/spaces-ask.spec.ts`: consulta durable `continuable` + `followup`; una corrida no completada falla | Automática |
| F50 ★ | Manual VPS: una sesión en el Space de SONDEL consulta al agente del Space de SICOP con `faberloom_spaces_ask` y el MCP `sicop` real; `reference`/`find` devuelven el contexto curado de SICOP; export/import del registro de contexto; plano y allowlist se respetan | Manual |

Comandos locales:

```sh
pnpm exec vitest run packages/faberloom
```
