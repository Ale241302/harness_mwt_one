# Revisión independiente de O3, ronda 1

- Fecha: 2026-11-17
- Alcance: O3-01, O3-02A, O3-02B, O3-02C, O3-03, O3-04, O3-05 y O3-06 de `tasks/todo.md`, más T10-E1 y la revisión de seguridad del gate. No incluye O4, PC3, E2 ni los casos T12/T13 globales.
- Revisión verificada: `2f6eee258e` para el código, HEAD `7fa33cb7b2` para la ejecución.
- Método: lectura de código y de composición (C1-L) más pruebas y programas de tipos ejecutados sobre el árbol limpio (C1-E).
- Veredicto: **NEEDS_WORK**.

## 1. Revisión y árbol

`2f6eee258e` existe y es ancestro de HEAD. Seis rutas del código de O3 se leen en esa revisión sin faltar: `packages/faberloom/access/src/credentials.ts`, `packages/faberloom/access/src/refusal.ts`, `packages/faberloom/effects-mail/src/index.ts`, `packages/faberloom/handlers/src/steps.ts`, `packages/faberloom/notices/src/index.ts` y `packages/faberloom/routines/src/index.ts`. `git diff --stat 2f6eee258e..HEAD -- packages apps` no muestra archivos, así que lo que se ejecuta en HEAD es el código que declaran los expedientes.

El árbol estaba limpio antes y después de la revisión (`git status --porcelain` sin líneas). Las corridas se hicieron sobre HEAD y no dejaron cambios versionados.

Un detalle de la envoltura: cuando vitest escribe su aviso de `vite-tsconfig-paths` en stderr, PowerShell lo reporta como error de comando aunque las pruebas pasen. La misma corrida lanzada con `cmd /c` devuelve código de salida 0. Los resultados de abajo son los de esa segunda forma.

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `vitest run access connections effects-mail execution shares notices handlers workflows tool-faberloom routines view --project thread-safe` | 66 archivos, 648 pruebas pasan, salida 0 |
| `vitest run packages/faberloom/inbound packages/faberloom/board` | 25 archivos, 371 pruebas pasan, salida 0 |
| `vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx` | 140 pruebas pasan, salida 0 |
| `vitest run packages/faberloom/access` | 4 archivos, 41 pruebas pasan |
| `tsc --noEmit` en `access`, `effects-mail`, `handlers` y `tool-faberloom` | salida 0 en los cuatro |
| `tsx scripts/faberloom-daily/check-plan.ts` | PASS (modelo, documentos, baseline) |
| `tsx scripts/faberloom-daily/check-closure.ts` | PASS (configuración, evidencia: 16 archivos, 0 problemas) |
| `git cat-file -e 2f6eee258e:<ruta>` para seis rutas de O3 | las seis existen |
| `git diff --stat 2f6eee258e..HEAD -- packages apps` | vacío |

No se reejecutó la suite completa de `packages/faberloom` ni las cifras globales de `identity.md` (1.712 pruebas), que exigen correr el paquete entero. Lo que sí se ejecutó del alcance está en la tabla.

## 3. Lo que la evidencia sostiene

- **Denegación por defecto.** `FaberLoomAccess.check()` recorre los grants del dueño y la acción y devuelve `{ allowed: false, reason: 'NO_GRANT' }` cuando no hay coincidencia (`access/src/index.ts:285-304`). Los cinco refusos de credencial existen en `access/src/refusal.ts` y se lanzan en `credentials.ts`: `CREDENTIAL_NOT_FOUND`, `CREDENTIAL_REVOKED`, `CREDENTIAL_EMPTY`, `CREDENTIAL_SCOPE_REQUIRED` y `CREDENTIAL_USE_FAILED`. Ninguna respuesta del mediador devuelve el secreto a su llamador (el callback de `withSecret` lo recibe como argumento, por diseño); el único error que puede citar el texto del transporte lo pasa por `redactSecret`.
- **`withSecret` no tiene llamadores de producción.** Solo aparece en su declaración, en `access/tests/credentials.spec.ts` y `access/tests/canary.spec.ts`, y en documentación. `authority-mounted.md` §5 lo declara como límite S-5 en vez de presentarlo cerrado, y coincide con el código.
- **Montaje condicionado.** `effects-mail` inyecta `faberloomAccess` y `faberloomCredentials` (`effects-mail/src/index.ts:29`) y `apply` comprueba ambos servicios con `ctx.get`; si falta uno, advierte y no registra adaptador (`:118-125`). La prueba `registers the adapter on the board and removes it with the fiber` y la prueba `does not start the send capability without the authority and the mediator` pasan en la corrida.
- **Escritura denegada antes del servicio.** `emailSendHandler` rechaza con `WRITE_NOT_APPROVED` sin tocar `ctx` (`handlers/src/index.ts:316-323`); el manejador `smtp` rechaza en la primera línea (`handlers/src/steps.ts:176-179`); la herramienta rechaza antes de resolver conexiones (`tool-faberloom/src/index.ts:3452-3459`); `mcp.call` consulta la autoridad antes de `tools.execute` (`steps.ts:256-271`); `sendDraft` compara la versión antes de `sendMail` (`connections/src/index.ts:348-356`). Las pruebas de `t10-effect-false`, `mail-send-denied` y `drafts` pasan.
- **Censo de tres archivos.** `access/tests/effect-census.spec.ts` fija tres rutas (`connections`, `effects-mail`, `view`) y la prueba pasa; el paquete `access` da 41 pruebas, incluidas las 3 del censo.
- **Avisos.** `notices` publica, lista y marca leído sin enviar (`notices/src/index.ts`), con 6 pruebas. `shares` publica un aviso `share-invitation` y no llama a `connections` (`shares/src/index.ts:345-362`); `execution` publica `routine-review` con libro de avisos (`execution/src/index.ts:575-589`). La política de racha ya no decide ningún envío: `emailPolicy` solo se lee para actualizar contadores tras un envío humano (`connections/src/index.ts:360-366`), y el panel no expone el control.
- **Transición.** `classifyInherited` pausa los pasos con `smtp` o `email.send` y los manejadores no registrados, conserva definición y ejecuciones y no toca lo ya pausado (`routines/src/index.ts:518-565`, conjunto en `:54`). El despachador la llama en el constructor aunque `enabled` sea falso (`execution/src/index.ts:356-368`), y las pruebas de `routines/tests/transition.spec.ts` y `execution/tests/transition.spec.ts` pasan.
- **Identidad.** La clave de ocurrencia incluye la conexión y, sin `Message-ID`, también `UIDVALIDITY` (`inbound/src/index.ts:417-419`); el cursor guarda `uidValidity` (`:441-448`) y `fetchMessages` descarta el cursor cuando cambia (`inbound/src/imap.ts:275-283`). Las pruebas de `inbound` sobre relectura y `UIDVALIDITY` pasan en la corrida de 371 pruebas.
- **Guardas de cierre.** PC1 está firmada en `decisions/PC1-2026-11-16.md` y PC2 tiene su decisión registrada en `decisions/PC2-2026-11-17.md` (look A por delegación expresa); ambas figuran en `decision-register.md` §3. DC-3 está registrada en §2. No hay `.only` en `packages/faberloom` ni en `packages/client/ui-faberloom`; los `skipIf` que aparecen dependen de plataforma o de una clave real y no reducen el alcance de O3.

## 4. Hallazgos

### H-1 · T10 declara ausente el shell y la composición del producto lo monta

**Qué.** `t10-surfaces.md` §1 marca Shell como "No", con la justificación "no hay `dsh-shell`, `tool-bash` ni `tool-pwsh`; solo `shell-env`, y `web-app` apaga `tool-bash`/`tool-pwsh`". Marca HTTP como "No" porque el parche de producto desactiva `tool-web`, `web-search-deepseek` y `web-fetch-http`.

**Dónde.**
- `docs/scratch/faberloom-daily-work/e1/t10-surfaces.md`, filas Shell y HTTP de la tabla de §1.
- `packages/bundle/web-app/cordis.patch.yml:369-373` desactiva `tool-bash` y `tool-pwsh` en la capa host, y `:478-479` desactiva `tool-web`. La misma capa monta el catálogo de presets con `default: standard` (`:489-492`).
- `packages/preset/agent-presets/presets/standard/agent.cordis.yml:45-51` vuelve a montar `tool-bash` y `tool-pwsh`; `:57-58` monta `tool-fs` y `tool-fs-search`; `:267-271` monta `tool-web` con `fetch: true`. Los presets `agent` (`:46-51`) y `ptc` (`:52-57`) montan los mismos dos, y `minimal` monta `tool-bash-persistent`, `tool-pwsh-persistent` y `terminal-bash` (`:30-58`).
- `packages/bundle/base/cordis.patch.yml:217-225` monta los ejecutores `bash-sandbox` y `pwsh-sandbox`, que el propio preset describe como el ejecutor de esos tools.
- `packages/faberloom/session-agent/src/index.ts:1278` define `SHELL_TOOLS` como `bash` y `pwsh`, y el comentario de `:394` habla de "a leftover shell or filesystem call". El producto, entonces, cuenta con que el shell exista.
- `packages/sandbox/sandbox-windows-acl/src/index.ts:24` declara que el sandbox restringe escrituras y no la red.

**Por qué importa.** La misma tabla reconoce que "cada preset monta los suyos" en la fila del subagente, así que la capa de presets forma parte del modelo que usa T10. El preset `standard` es el que corre por defecto en el producto (`base` + `web-app` + `faberloom-app`, con `default: standard`), y sus archivos vuelven a montar shell, sistema de archivos y fetch después de que la capa host los apague. El gate de efectos exige que toda ruta capaz de provocar el efecto pase por la misma autoridad o se desmonte. Con el shell montado, la frase de `gate-security-review.md` §5 ("ninguna vía montada produce un envío sin una persona") y la de `wave-checkpoint.md` §7 ("Todas las vías montadas rechazan escritura sin aprobación") no están probadas: el negativo de T10 nunca se corrió sobre esa ruta, y el censo solo mira llamadas a los emisores declarados en `packages/faberloom`, que no ve un comando de shell.

Esto es lectura de composición: no ejecuté un envío por shell. Lo que está probado es que la tabla no coincide con la composición, no que el shell haya enviado correo. Para T10 eso basta: la fila que dice "No" tiene que decir "Sí" y traer su control, o el shell tiene que dejar de montarse.

Para HTTP pasa lo mismo en menor grado: desactivar la fila host no alcanza al `tool-web` del preset. El único control que queda es el plano del agente (`faberloom-agent-plane`, `webAccess`), que enmascara `web_search` y `web_fetch` para los agentes del catálogo con `webAccess: false`, pero no cubre una sesión que no tenga ese plano. La fila necesita repetirse con la composición real, no con el `disabled` de la capa host.

**Qué lo cierra.** Una de dos, con evidencia ejecutada: (a) un preset de producto sin `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-fs-search` ni `tool-web`, montado por defecto, y una comprobación de composición que muestre el catálogo de tools del agente sin ellos; o (b) aceptar el shell como vía montada, correr su negativo T10 (un comando de shell que intente abrir SMTP, con y sin aprobación humana) y actualizar `t10-surfaces.md` §1, `write-denied.md` §5, `wave-checkpoint.md` §7 y `gate-security-review.md` §5. En el caso (b) también hay que decir qué control sustituye a la autoridad para el shell: hoy solo hay la política de aprobación `ask` del sandbox, que no es la autoridad de FaberLoom ni la aprobación del mensaje exacto.

### H-2 · El censo ancla sus líneas a la revisión anterior y declara `2f6eee258e`

**Qué.** `authority-census.md` lleva "Revisión: `2f6eee258e`" en la cabecera, pero las rutas `archivo:línea` de su tabla §2 corresponden a `0b01ca3936`, el commit anterior a la entrada de O3.

**Dónde y cómo se comprobó.** Con `git show 0b01ca3936:<ruta>` las líneas del censo caen sobre las llamadas de envío: `handlers/src/steps.ts:281`, `effects-mail/src/index.ts:100`, `view/src/index.ts:5045`, `view/src/index.ts:5124-5128`, `connections/src/index.ts:342-347`, `execution/src/index.ts:561`, `shares/src/index.ts:340` y `tool-faberloom/src/index.ts:3438`. En `2f6eee258e` y en HEAD esas mismas líneas son otras cosas: `notices.publish`, el `catch` del adaptador, un JSDoc, la construcción del prompt de redacción, la firma de `sendDraft` en la 348, un `catch`, un JSDoc y un parámetro de la tool. La tabla describe bien el estado anterior; lo que está mal es el encabezado que dice sobre qué revisión se midió.

**Por qué importa.** El censo es C1-L y su valor es que cada fila se pueda abrir en la revisión citada. Un revisor que lea la línea 281 del archivo en `2f6eee258e` no encuentra lo que la tabla dice. No invalida el contenido, pero convierte la comprobación en un acto de fe.

**Qué lo cierra.** Declarar en la cabecera que §2 es el estado medido en `0b01ca3936` y que el cierre se verifica en `2f6eee258e`; o volver a anclar cada fila a la revisión que dice. Con una línea alcanza si se nombra el commit correcto.

### H-3 · `no-auto-send.md` dice que el censo baja a 6 archivos; la prueba fija 3

**Qué.** `no-auto-send.md` §3, fila `effect-census`, dice: "El censo baja de 8 a 6 archivos que pueden enviar y el documento los nombra".

**Dónde.** `packages/faberloom/access/tests/effect-census.spec.ts:21-25` declara `CLASSIFIED` con tres rutas: `connections/src/index.ts`, `effects-mail/src/index.ts` y `view/src/index.ts`. La prueba `finds exactly the senders the census classifies` pasa en mi corrida. `write-denied.md` §2 y `authority-census.md` §4 dicen tres.

**Por qué importa.** Es la cifra que sostiene el argumento de "de nueve vías a tres archivos" en el documento que cierra O3-03. Un lector que compare los dos expedientes encuentra dos números distintos para el mismo test.

**Qué lo cierra.** Corregir la cifra en `no-auto-send.md` §3 a tres archivos, o explicar qué se está contando si el número 6 se refiere a otra cosa (por ejemplo, archivos de prueba del paquete), y dejarlo dicho.

### H-4 · La evidencia de `authority-fail-closed.md` no reproduce su propio conteo

**Qué.** `authority-fail-closed.md` §5 dice "38 pruebas (25 de autoridad, 3 de censo, 10 de credenciales)".

**Dónde.** `vitest run packages/faberloom/access` da 41 pruebas en 4 archivos. Los archivos tienen 26 en `access.spec.ts`, 3 en `effect-census.spec.ts`, 10 en `credentials.spec.ts` y 2 en `canary.spec.ts`. El conteo del documento omite el archivo de canarios y cuenta una prueba menos de autoridad.

**Por qué importa.** Es un bloque de evidencia ejecutada, no una estimación. Un número que no se reproduce obliga a dudar del resto del bloque, y en este caso el archivo omitido es justamente el que prueba el canario de O3-06.

**Qué lo cierra.** Rehacer el bloque con la salida real: 41 pruebas, 26 de autoridad, 3 de censo, 10 de credenciales y 2 de canario.

### H-5 · El censo sigue diciendo que la identidad de la Mesa estaba rota, y `identity.md` dice que no

**Qué.** `authority-census.md` §2, fila 1, deja el adaptador de la Mesa como "Aceptable en diseño, pendiente de la identidad de la Mesa"; H-7 dice que su problema "es la identidad del ítem, que hoy falla en 212 pruebas". `identity.md` §1 y `board-failures-diagnosis.md` establecen que esos 212 fallos eran el entorno de pruebas heredando `FABERLOOM_BOARD_REMOTE`, no el producto.

**Dónde.** `e1/authority-census.md` fila 1 de §2 y H-7; `e1/identity.md` §1 y §6; `board-failures-diagnosis.md`, aviso inicial.

**Por qué importa.** Son dos expedientes de la misma ola que afirman cosas contrarias sobre el mismo hecho. El censo es el inventario que el gate cita para decir que cada vía tiene dueño y control; si su veredicto sobre la vía de la Mesa se apoya en un diagnóstico que el propio equipo declaró falso, la fila necesita otra justificación. La identidad de la Mesa no estaba rota; lo que faltaba era el aislamiento de la suite.

**Qué lo cierra.** Actualizar la fila 1 y H-7 al diagnóstico corregido: el adaptador lee el cuerpo aprobado, la identidad del ítem no estaba rota, y lo que O3-04 añadió es la identidad de correo (cuenta, `UIDVALIDITY`, UID).

### H-6 · La descripción de la herramienta promete un envío que la herramienta siempre rechaza

**Qué.** `faberloom_mail_send` se describe como "This is an external effect: it requires the mail.send grant, and the message leaves the system once accepted" (`tool-faberloom/src/index.ts:3433`) y su `execute` rechaza siempre con `WRITE_NOT_APPROVED` (`:3452-3459`). La prueba `keeps the tool definition honest: it says the message leaves and still denies` fija esa contradicción, y `t10-surfaces.md` §2 la presenta como "coherencia entre lo que el modelo lee y lo que pasa".

**Por qué importa.** `packages/AGENTS.md` pide escribir los contratos que ve el modelo desde la perspectiva del modelo. Un modelo al que se le dice que la herramienta envía con un grant va a intentarlo, y el rechazo no le enseña que en E1 no existe aprobación del mensaje exacto. La prueba convierte el defecto en contrato: cualquier corrección futura de la descripción rompe un test que dice que la descripción debe prometer el envío. No es un agujero de seguridad, porque falla cerrado, pero es una instrucción falsa en la superficie que más importa.

**Qué lo cierra.** Cambiar la descripción para decir lo que hace hoy (prepara y rechaza porque E1 no tiene aprobación del mensaje exacto) y ajustar la prueba para que fije esa frase; o sacar la herramienta del catálogo hasta E2. En `t10-surfaces.md` §2, dejar de llamar coherencia a la contradicción.

### H-7 · El censo cuenta mal sus vías y una fila de su tabla está partida

**Qué.** `authority-census.md` §2 se titula "Las nueve vías" y enumera diez filas (1 a 10). §4 dice que O3-02C cerró "las seis vías", mientras `write-denied.md` §1 enumera siete cambios. La fila de O3-02A/B de la tabla de §4 termina con `||` y pega dos filas en una, así que la tabla se renderiza con una fila de seis celdas.

**Dónde.** `e1/authority-census.md`, encabezado de §2, primera fila de §4 y fila de O3-02A/B de §4.

**Por qué importa.** El número de vías es la medida del trabajo de O3-02C. Un documento que dice nueve, diez y seis en tres lugares no permite saber qué se cerró. La fila partida, además, esconde la fila de O3-03 de cualquier lectura en tabla.

**Qué lo cierra.** Fijar un solo número con su definición (por ejemplo, diez vías censadas, siete cerradas en el ejecutor y tres sustituidas por aviso o retiradas) y separar la fila partida en dos.

### H-8 · La skill de cierre declara un estado del plan que ya no es cierto

**Qué.** `.opencode/skills/faberloom-close-wave/SKILL.md`, sección "Estado del plan hoy", dice que O0 y O1 no están cerradas y que PC1 exige la firma del CEO. `f0-status.md` registra los catorce checks de O0 y O1 en `CLOSED` con PASS, y `decisions/PC1-2026-11-16.md` está firmada.

**Por qué importa.** Es la regla que se aplica literalmente al cerrar una ola, y su propio resumen contradice el registro de cierre. Un revisor que empiece por la skill (como pide el procedimiento) bloquea O3 por O0, O1 y PC1 sin llegar a leer `f0-status.md`. La lista de comprobación de la skill sigue siendo válida; lo que está viejo es el párrafo de estado.

**Qué lo cierra.** Reemplazar ese párrafo por una remisión a `f0-status.md` y a `decision-register.md` §3, o actualizarlo con el estado real. Es un cambio de una sección y no toca el veredicto de esta revisión, pero deja la puerta coherente con el registro.

### H-9 · `shares` se salta el aviso en silencio si falta el servicio

**Qué.** `shares/src/index.ts:345-347`: si `faberloomNotices` no está montado, `notify` hace `return` y el grant se crea sin aviso ni error.

**Por qué importa.** La convención del repositorio es que una configuración incompleta falle ruidosamente y no se salte un referente que falta. En el producto `notices` está montado, así que hoy no se dispara; el problema es que una composición futura sin `notices` crea invitaciones que nadie ve y no deja rastro. La alternativa segura es fallar el grant o registrar el fallo, no devolver sin más.

**Qué lo cierra.** Lanzar un error con nombre cuando falte el servicio, o publicar en el log y devolver un resultado que el llamador pueda tratar como no avisado, con una prueba del caso.

## 5. Qué no cubre esta revisión

- O4 (recepción de dos cuentas, lector, búsqueda, adjuntos), PC3, E2 y los casos T12/T13 globales: el expediente declara que no los cierra y esta revisión no los abre.
- Un envío real por shell o por cualquier vía. H-1 es lectura de composición; no ejecuté un comando que abra un socket SMTP.
- La suite completa de `packages/faberloom` y las cifras de `identity.md` sobre 1.712 pruebas. Solo se ejecutaron los paquetes del alcance y los dos añadidos para identidad y T10.- Un prompt de modelo real con canario. `custody.md` §2 ya declara que eso es E2, y aquí no se ejecutó ningún proveedor.
- El cliente MCP autenticado con el token del dueño y la delegación de ese token, que `gate-security-review.md` §4 deja al CEO.
- La rotación de credenciales y la retirada de copias 3, 4 y 5, que siguen en manos del CEO según `decision-register.md` §6.

## 6. Consecuencia para el cierre

La ola no se puede marcar `CLOSED` con esta revisión. H-1 es un bloqueo de T10-E1: la tabla de superficies no coincide con la composición del producto y la frase que cierra el gate no está sostenida para el shell. H-2 a H-5 son correcciones de expediente que un lector puede reproducir y que hoy hacen que las cifras y las citas no cuadren. H-6 a H-9 son defectos acotados, con arreglo local.

No hay frase firmable en esta ronda. La revisión que habilite el cierre tiene que nombrar `2f6eee258e` o una revisión posterior, decir qué pasó con el shell (desmontado con evidencia de composición o probado como vía controlada) y traer los conteos corregidos de `access` y del censo.
