# Punto de control · olas O3 y O4

- Contrato: C-FL-04 · Etapas E1 · PC1/PC2
- Revisión medida: `9b35cdb12b` (el código de O3 entró en `6b71b071ba`; las pruebas se reejecutaron sobre la revisión citada). Después solo cambian expedientes: `git diff --stat 9b35cdb12b..HEAD -- packages apps` no muestra archivos.
- Estado: **O3 READY_FOR_CEO · O4 READY_FOR_CEO** (firma independiente pendiente en ambas)
- Fecha: 2026-11-17

## 1. Qué queda cerrado

| Ítem | Evidencia |
|---|---|
| O3-01 censo de vías | `authority-census.md` |
| O3-02A/B/C autoridad, montaje y vías cerradas | `authority-fail-closed.md`, `authority-mounted.md`, `write-denied.md` |
| O3-03 autoenvío y avisos internos | `no-auto-send.md` |
| O3-04 identidad de correo | `identity.md` |
| O3-05 transición sin reactivar | `transition.md` |
| O3-06 custodia, destinos y copias | `custody.md` |
| Gate O3: T10-E1 y seguridad | `t10-surfaces.md`, `gate-security-review.md` |
| O4-01 dos cuentas | `accounts.md` |
| O4-02 backlog, búsqueda e identidad | `search-limits.md` |
| O4-03 bandeja y lectura al lado | `panel-layout.md` |
| O4-04 visor aislado | `hostile-viewer.md` |
| O4-05 adjuntos con límites | `attachments.md` |

## 2. Defectos que la ola encontró y cerró

| Defecto | Dónde estaba | Cómo se cerró |
|---|---|---|
| La guarda de versión no corría en el panel | `sendDraft` opcional y el remoto no lo pasaba | Versión obligatoria en toda la cadena; prueba del caso ausente |
| La política de destinos era un archivo | `egress-policy.json` sin lector | Comprobación en `imap`, `smtp`, `sendMail` y `probe` |
| El receptor escribía flags pese a su README | `markSeen`/`moveToTrash` ejecutaban `STORE`/`COPY` | Rechazo `WRITE_NOT_APPROVED`; servidor byte-idéntico |
| `notices` fuera del typecheck del host | Falta en `tsconfig.host.json` | Referencia, catálogo y página regenerados |
| El párrafo partido llevaba rojo desde F0 | 57 documentos de scratch | Unificado sin cambiar contenido; gate verde |
| Deuda de tema desde O2 | Bordes de 1 px, radios sin `corner-shape`, scrollbar sin rebind | Corregida; escaneos de tema verdes |

## 3. Evidencia de la última corrida

```
vitest access, connections, effects-mail, execution, shares, notices,
       handlers, workflows, tool-faberloom, routines, view,
       preset/agent-presets                                    841 pruebas, 79 archivos
tsc --noEmit (access, connections, effects-mail, handlers, tool-faberloom, shares, presets)   exit 0
client/ui-faberloom                                          281 pruebas, 23 archivos
doc wrap / links                                             PASS
```

Los conteos que cita cada expediente corresponden a la corrida en que se entregó; este agregado es el de la revisión medida y lo sustituye para el cierre. La suite completa de `packages/faberloom` (1.789 pruebas) tiene dos casos intermitentes ajenos a esta ola: `mirror/tests/sync.spec.ts` y `mcp-server/tests/oauth.spec.ts`. No se presentan como verdes ni se corrigen aquí.

## 4. Abierto, con dueño

| Pendiente | Dueño |
|---|---|
| Rotar credenciales expuestas y retirar copias 3-5 | CEO |
| Objeto de aprobación del mensaje exacto; habilitar el adaptador `mail.send` | E2 |
| Subagente con modelo real y canario en prompt | E2 |
| T7 en navegador real (red y eventos) y aspecto a dos anchos y dos looks | PC3 |
| Aviso de truncamiento del Markdown de adjuntos | O6 |
| Barrida de `ui-theme/apply` y `ui-reference/acceptance-real-folder` | ventana de PR |

Los dos últimos no los tocó esta ola: el primero falla aislado y el segundo espera una carpeta real que no está en este equipo.

## 5. Estado del repositorio

El trabajo de O3 y O4 está commiteado sobre `fix/guarda-operadores`: entró en `6b71b071ba` y viaja en la revisión medida `9b35cdb12b`. Lo nuevo incluye el paquete `notices`, la autoridad con custodia, el censo de vías, la transición de rutinas, el prototipo F1 y `deploy/faberloom-lab`. El `.env` del laboratorio está ignorado por `.gitignore` y solo lleva valores sintéticos.

## 6. Estado por ola

| Ola | Contratos | Estado | Firma |
|---|---|---|---|
| O3 · E1 autoridad | O3-01, 02A/B/C, 03, 04, 05, 06 + T10-E1 + revisión de seguridad | `READY_FOR_CEO` | pendiente: `reviews/O3-review-round-1.md` |
| O4 · E1 lectura | O4-01 a O4-05 | `READY_FOR_CEO` | pendiente |

El cierre de O3 no cierra O4: la recepción, el lector, la búsqueda y los adjuntos son la ola siguiente y conservan su propia firma.

Al cerrar O3 queda registrada **DC-3**: los avisos automáticos pasan a avisos internos persistentes y ningún correo de rutina, seguimiento o invitación sale solo.

## 7. Qué demuestra el gate O3, pieza por pieza

| Requisito del gate | Evidencia | Cómo se comprobó |
|---|---|---|
| Todas las vías montadas rechazan escritura sin aprobación | `write-denied.md`, `t10-surfaces.md` | Pruebas por vía: tool, flujo, rutina, `mcp.call`, UI y API; el censo fija tres archivos con salida; el preset del producto omite shell, fs y web (`faberloom-preset.spec.ts`) |
| Lectura y borrador funcionan | `accounts.md`, `authority-mounted.md` | Lectura con dos cuentas y borrador guardado sin efecto externo |
| Cero efectos en servidores de prueba | `no-auto-send.md`, `write-denied.md` | Servidor de prueba sin `STORE`, `COPY` ni SMTP; avisos internos en lugar de correo |
| Estado heredado conservado | `transition.md` | Rutina pausada, definición y ejecuciones intactas, sin reactivación al arrancar |
| Revisión de seguridad sin hallazgos abiertos en E1 | `gate-security-review.md` | S-1 a S-3 cerrados; S-4, S-5, S-6, S-7 y S-8 declarados con dueño y disparador |
| Canarios fuera de las superficies que rodean la clave | `custody.md` | Descripción, rechazo, error, aviso y log limpios |

## 8. Lo que O3 no cierra, y con qué disparador

| Hallazgo o límite | Dueño | Disparador |
|---|---|---|
| S-4 · aprobación por MCP con el adaptador montado | E2 | Se resuelve al montar `mail.send` con aprobación del mensaje exacto (O6) |
| S-7 · subagente con modelo real | E2 | Necesita proveedor y clave; el ejecutor hijo ya es el mismo |
| S-5 · código en proceso con acceso a la credencial | E2 (endurecimiento) | `withSecret` en el transporte; hoy es límite aceptado |
| S-6 · credenciales y copias 3-5 | CEO | Decisión registrada en `decision-register.md` §6: no se rotan |
| S-8 · envío de archivo del Space sin guarda de versión | E2 | Entra en la aprobación exacta de O6 |

Cerrar O3 no habilita lectura real: eso es PC3 y exige `AUTH-REAL-READ`.
