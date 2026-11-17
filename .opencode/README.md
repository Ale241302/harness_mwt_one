# FaberLoom Web en OpenCode V2

Esta configuración ejecuta el plan de `docs/scratch/faberloom-daily-work/` sin conceder
acceso a producción, buzones reales, MWT.ONE ni despliegues.

## Qué hay aquí

- `opencode.jsonc`: once agentes, siete comandos y las reglas de permiso. Se recarga sin reiniciar.
- `skills/`: diez skills propias del proyecto, cada una con su contrato y sus referencias.

No se fija ningún `model`. Cada agente hereda el modelo de la sesión. La política de modelos
del producto se decide por espacio en N3, no aquí.

## Agentes

| ID | Puede escribir | No puede |
|---|---|---|
| `faberloom-orchestrator` | `docs/scratch/faberloom-daily-work/**` | Producto, aprobar cierres, shell sin permiso |
| `faberloom-architect` | Documentos de arquitectura | Código de producto, decidir por el CEO |
| `faberloom-evidence` | Expedientes de evidencia | Código, contenido real, secretos, declarar un nivel sin ejecutarlo |
| `faberloom-mail` | `packages/faberloom/{inbound,connections,effects-mail,view,action-authority,board}` y tests asignados | UI fuera de contrato, credenciales reales, despliegue, núcleo |
| `faberloom-security` | Solo su informe | Cualquier parche, leer secretos, aprobar su propio informe |
| `faberloom-ui` | `packages/client/ui-faberloom/**`, `ui-theme/**` y tests | Lógica de efectos, núcleo, recursos de terceros |
| `faberloom-learning` | `learning`, `autonomy`, `board`, `spaces`, `routines`, `handlers` | Activación real, memoria entre espacios, envío |
| `faberloom-qa` | Tests, fixtures, evidencia | Código de producto, bajar umbrales, cuentas reales |
| `faberloom-release` | `deploy/**`, `scripts/faberloom-daily/**`, Compose | `ssh`, `docker`, reinicios, DNS, `.env`, producción |
| `faberloom-reviewer` | Nada | Editar, aceptar narrativa sin prueba |
| `faberloom-docs` | Documentación y trazabilidad | Código, afirmar capacidades no demostradas |

## Comandos

| Comando | Uso | Qué hace |
|---|---|---|
| `/faberloom/wave <ola> <tarea>` | Preparar un encargo | Exige contrato completo y archivos acotados |
| `/faberloom/verify <ola>` | Reunir evidencia | Ejecuta solo verificaciones permitidas |
| `/faberloom/review <ola>` | Revisión independiente | Abre el revisor; no edita |
| `/faberloom/close <ola>` | Validar cierre | Nunca fuerza; rechaza evidencia incompleta |
| `/faberloom/inventory <alcance>` | Inventario | Prepara inventario sin secretos |
| `/faberloom/prototype <look>` | Laboratorio visual | Solo fixtures sintéticos |
| `/faberloom/transition <aprobación>` | Runbook | Valida; no despliega |

## Cómo se trabaja un contrato

1. El orquestador entrega el contrato con los campos de `docs/scratch/faberloom-daily-work/`.
2. El agente dueño lee el contrato, sus archivos permitidos y las fuentes.
3. Escribe primero la prueba que falla por el motivo correcto. Después el cambio mínimo.
4. Guarda el expediente en `docs/scratch/faberloom-daily-work/evidence/<ola>/<contrato>.md`.
5. El revisor, en otra sesión, empieza en `NEEDS_WORK` y exige pruebas para cambiarlo.

## Estados

`PLANNED`, `IN_PROGRESS`, `BLOCKED`, `READY_ISOLATED`, `READY_FOR_CEO`, `CLOSED`,
`NOT_APPLICABLE_APPROVED`.

Solo `CLOSED` cuenta como cierre, y solo con observación, control positivo, control negativo,
limitaciones escritas, aprobación cuando el contrato depende de un gate y veredicto `PASS` de
otra persona. `READY_ISOLATED` y `READY_FOR_CEO` son estados abiertos.

## Qué no autoriza esta configuración

Nada de negocio. Un `allow` de OpenCode permite usar una herramienta de desarrollo; no aprueba
un mensaje, una regla, una escritura en un expediente, un despliegue ni una ola. Esas
decisiones están en `FaberLoom_tarea_2026-11-16/tasks/authorizations.md` y las firma el CEO.

Ningún agente recibe credenciales productivas. Ningún handoff contiene secretos ni correo real.
Ningún agente edita `.opencode` para ampliar sus permisos.

## Comprobación

```sh
corepack pnpm exec tsx scripts/faberloom-daily/check-closure.ts
```

Verifica que el JSONC se lea, que estén los once agentes y los siete comandos, y que las
denegaciones ganen donde deben: `.env`, `.opencode/**`, `git show`/`git diff` con argumentos
extra, y los comandos `ssh`, `scp`, `rsync`, `docker`, `git push`, `sudo`, `rm`, `curl`, `wget`.
