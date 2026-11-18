# Punto de control · olas O3 y O4

- Contrato: C-FL-04 · Etapas E1 · PC1/PC2
- Revisión medida: `32fc221910` (el código de O3 entró en `6b71b071ba`; O4 se entregó en `3c68b6505a` y se corrigió en `32fc221910`). Después solo cambian expedientes: `git diff --stat 32fc221910..HEAD -- packages apps` no muestra archivos.
- Estado: **O3 CLOSED · O4 CLOSED** (ambas con firma independiente PASS)
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
       preset/agent-presets, session-controller                    1.612 pruebas, 119 archivos
tsc --noEmit (access, connections, effects-mail, handlers, tool-faberloom, shares, presets)   exit 0
client/ui-faberloom                                          281 pruebas, 23 archivos
conjunto O4 (inbound, tool, handlers, view, access)          501 pruebas, 52 archivos
apps/web email-panel e2e                                     3 pruebas, 6 capturas y la hostil
doc wrap / links                                             PASS
```

Los conteos que cita cada expediente corresponden a la corrida en que se entregó; este agregado es el de la revisión medida y lo sustituye para el cierre. La suite completa de `packages/faberloom` (1.789 pruebas) tiene dos casos intermitentes ajenos a esta ola: `mirror/tests/sync.spec.ts` y `mcp-server/tests/oauth.spec.ts`. No se presentan como verdes ni se corrigen aquí.

## 4. Abierto, con dueño

| Pendiente | Dueño |
|---|---|
| Rotar credenciales expuestas y retirar copias 3-5 | CEO |
| Objeto de aprobación del mensaje exacto; habilitar el adaptador `mail.send` | E2 |
| Subagente con modelo real y canario en prompt | E2 |
| Aviso de truncamiento del Markdown de adjuntos | O6 |
| Barrida de `ui-theme/apply` y `ui-reference/acceptance-real-folder` | ventana de PR |

Los dos últimos no los tocó esta ola: el primero falla aislado y el segundo espera una carpeta real que no está en este equipo.

## 5. Estado del repositorio

El trabajo de O3 y O4 está commiteado sobre `fix/guarda-operadores`: entró en `6b71b071ba` y viaja en la revisión medida `32fc221910`. Lo nuevo incluye el paquete `notices`, la autoridad con custodia, el censo de vías, la transición de rutinas, el prototipo F1 y `deploy/faberloom-lab`. El `.env` del laboratorio está ignorado por `.gitignore` y solo lleva valores sintéticos.

## 6. Estado por ola

| Ola | Contratos | Estado | Firma |
|---|---|---|---|
| O3 · E1 autoridad | O3-01, 02A/B/C, 03, 04, 05, 06 + T10-E1 + revisión de seguridad | `CLOSED` | PASS 2026-11-17 · `O3-review-round-4` |
| O4 · E1 lectura | O4-01 a O4-05 | `CLOSED` | PASS 2026-11-18 · `O4-review-round-2` |

El cierre de O3 no cierra O4: la recepción, el lector, la búsqueda y los adjuntos son la ola siguiente y conservan su propia firma.

Al cerrar O3 queda registrada **DC-3**: los avisos automáticos pasan a avisos internos persistentes y ningún correo de rutina, seguimiento o invitación sale solo.

## 7. Qué demuestra el gate O3, pieza por pieza

| Requisito del gate | Evidencia | Cómo se comprobó |
|---|---|---|
| Todas las vías montadas rechazan escritura sin aprobación | `write-denied.md`, `t10-surfaces.md` | Pruebas por vía: tool, flujo, rutina, `mcp.call`, UI y API; el censo fija tres archivos con salida; el producto arranca con el preset `faberloom` sin shell, fs ni web, cierra el selector y lo prueba en `preset-composition.e2e.ts` |
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

## 9. O4: lo que se entregó y lo que faltaba

| Contrato | Expediente | Qué demuestra |
|---|---|---|
| O4-01 dos cuentas | `accounts.md` | Cursores por conexión, caída y reconexión, `FLAGS` leído sin escribir, `WRITE_NOT_APPROVED` en marcar/mover |
| O4-02 backlog y búsqueda | `search-limits.md` | Ventana por cuenta y «Mostrar más», búsqueda con `complete`/`scanned`, identidad con `connectionId` en cada superficie |
| O4-03 bandeja y lector | `panel-layout.md` | Rail, lista y lector; estados; el look en dos anchos |
| O4-04 visor aislado | `hostile-viewer.md` | Sanitizado, CSP y `sandbox`; **T7 en Chromium** con red observada |
| O4-05 adjuntos | `attachments.md` | Límites por documento, omisiones nombradas y originales íntegros |

Los dos pendientes que la ola declaraba quedaron cerrados:

- **T7 en navegador real**: `apps/web/tests/email-panel.e2e.ts` abre un correo hostil en el producto ensamblado y comprueba que el texto legítimo se lee, que `srcdoc` no contiene `<script>`, `<form>` ni el origen del atacante, que el `sandbox` está vacío y que **no se observa ninguna petición** al origen hostil. Captura: `email-hostile.png`.
- **Verificación visual a dos anchos y dos looks**: la misma corrida deja seis capturas, `email-wide-look-a/b.png` y `email-narrow-list/reader-a/b.png`, con cero desbordamiento horizontal en los dos anchos.

Lo que sigue fuera de O4: los buzones reales (PC3, `AUTH-REAL-READ`) y el envío (E2).

Los casos que el gate de O4 nombra, con su evidencia:

| Caso | Evidencia | Límite |
|---|---|---|
| T1-E1 recepción y lectura | `accounts.md`, `panel-layout.md` | Dos cuentas del piloto: PC3 |
| T6-E1 contenido externo | `hostile-viewer.md` (el cuerpo se pinta aislado), `access/tests/external-content.spec.ts` (un texto hostil como contexto no autoriza ni toma prestada una concesión ajena) y `write-denied.md` (ninguna vía envía sin una persona) | Inyección con modelo real: E2 (S-7) |
| T7 visor hostil | `hostile-viewer.md` y el caso hostil de `email-panel.e2e.ts`, con red observada | La red se observa en el navegador, no a nivel de sistema |
| T16-E1 identidad adversaria | `identity.md`, `search-limits.md` | — |
| T17 adjuntos y búsqueda | `search-limits.md`, `attachments.md` | Aviso de truncamiento del Markdown: O6 |
| T22 volumen y caída | `accounts.md` | Volumen real: PC3 |
| T13-E1 apariencia integrada | `panel-layout.md` y las seis capturas | Los dos looks y los dos anchos, con fixture |

### Firma de la revisión independiente (O4)

> La ola O4, contratos O4-01 a O4-05, los casos T1-E1, T6-E1, T7, T16-E1, T17 y T22 y la apariencia E1 aplicable, queda cerrada sobre la revisión `32fc221910` con la evidencia ejecutada de la revisión independiente ronda 2; no cubre O5, PC3 ni E2, y acepta los límites L-1 a L-4 de este informe.

| Límite | Qué es | Cómo se cerraría |
|---|---|---|
| L-1 | El receptor está probado en C1-E con servidor de sockets; la lectura con los dos buzones reales es PC3 | `AUTH-REAL-READ` sobre los buzones del piloto |
| L-2 | La inyección con modelo real no está probada: E1 demuestra aislamiento y una autoridad que no acepta texto como concesión | E2 (S-7), con proveedor y clave |
| L-3 | El aviso de truncamiento del Markdown de adjuntos no se muestra aún | O6, con la tarjeta del lector de adjuntos |
| L-4 | La corrida del e2e no fue determinista en este equipo: 4 de 5 pasadas verdes, un fallo por `net::ERR_NETWORK_CHANGED` al crear la tarea desde cero | Endurecer el paso y repetir la corrida |

Los límites no abren trabajo nuevo de O4: están aceptados por la firma y tienen dueño.

El 2026-11-18 el panel pasó de tres zonas a gestor de correo (carpetas del servidor, vistas, búsqueda y paginador). Esa superficie nueva necesita su delta de revisión antes de heredar la firma de O4; el expediente `panel-layout.md` lo declara.

## 10. Firma de la revisión independiente (O3)

> La ola O3, contratos O3-01 a O3-06, T10-E1 y la revisión de seguridad del gate, queda cerrada sobre la revisión `afe9da6cf8` con la evidencia ejecutada de la revisión independiente ronda 4; no cubre O4, PC3 ni E2, y acepta los límites L-1, L-2 y L-3 de este informe.

Los límites que la firma acepta, con su archivo:

| Límite | Qué es | Cómo se cerraría |
|---|---|---|
| L-1 | Una adopción en frío con `agentPreset` explícito igual al del log se rechaza con `agent-preset/locked`: el guard distingue “nueva” con `ctx.sessions.get`, que solo ve sesiones vivas. El cliente del producto no envía ese campo al reanudar, así que las sesiones antiguas abren por la vía normal, y el rechazo falla cerrado sin montar el shell | Mover el techo a `createOrAdopt` después de `sessionQuery.observeSession`, con su prueba de adopción en frío |
| L-2 | `docs/config-catalog.zh.md` aún no lista `modeSelectionEnabled`; el catálogo inglés generado y verificado sí | Rutina de traducción de documentos |
| L-3 | La firma pendiente apuntaba a la ronda 3; queda apuntada a la ronda 4 en este mismo commit | Cerrado en este commit |

Con esta firma, O3-01 a O3-06, T10-E1 y el gate quedan `CLOSED` en la revisión `afe9da6cf8`. O4 conserva su propia firma y PC3 sigue exigiendo `AUTH-REAL-READ`.
