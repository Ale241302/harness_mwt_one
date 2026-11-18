# Revisión independiente · Ola O4 (ronda 2)

- Fecha: 2026-11-18
- Revisor: TestingRealityChecker, independiente. No escribí el código ni los expedientes revisados; este informe es lo único que escribo.
- Alcance: O4-01 a O4-05 de `tasks/todo.md`, más los casos que su gate nombra: T1-E1, T6-E1, T7, T16-E1, T17, T22 y la apariencia E1 aplicable. No cubre O5, PC3, E2 ni T12/T13 globales.
- Revisión verificada: `32fc221910` (código y evidencia). `a7c181b060` es el commit de documentación que apunta el campo `Revisión` de los cinco expedientes.
- Rama: `fix/guarda-operadores`.
- Estado de partida: NEEDS_WORK (ronda 1).
- Veredicto: **PASS**, con dos correcciones de registro que se hacen en el mismo commit que escriba `CLOSED` (hallazgos 1 y 2) y dos observaciones (3 y 4).

## 1. Revisión y rutas comprobadas

`git diff --stat 32fc221910..HEAD -- packages apps` no muestra archivos, así que el código medido es el del commit citado.

`git cat-file -e 32fc221910:<ruta>` devuelve cero para las diez rutas que comprobé: `imap.ts`, `inbound.spec.ts`, `external-content.spec.ts`, `panels.tsx`, `email-panel.e2e.ts`, los cinco expedientes de O4 y `wave-checkpoint.md`.

Los cinco expedientes apuntan a `32fc221910` en su campo `Revisión` (`accounts.md:4`, `search-limits.md:4`, `panel-layout.md:4`, `hostile-viewer.md:4`, `attachments.md:4`). El punto de control no: ver hallazgo 1.

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git diff --stat 32fc221910..HEAD -- packages apps` | vacío |
| `git cat-file -e` sobre 10 rutas de `32fc221910` | las 10 existen |
| `corepack pnpm exec vitest run packages/faberloom/inbound packages/faberloom/tool-faberloom packages/faberloom/handlers packages/faberloom/view packages/faberloom/access --project thread-safe` | 52 archivos, 501 pruebas, todas pasan |
| `corepack pnpm exec vitest run packages/client/ui-faberloom --project thread-safe` | 23 archivos, 281 pruebas, todas pasan |
| `corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json` | exit 0 |
| `DSH_SNAPSHOT=replay ... vitest run --config vitest.web.config.ts apps/web/tests/email-panel.e2e.ts` | 3 pruebas; 5 corridas, 4 verdes y 1 con un fallo (detalle abajo) |

Nota de consola: en este equipo `corepack pnpm` devuelve código 1 porque vite escribe su aviso en stderr; los resúmenes de vitest y el exit 0 de `tsc` son los que cuentan.

La corrida del e2e no fue determinista en este equipo. La primera pasada falló en el paso de la tarea desde cero (`email-panel.e2e.ts:236`, espera de 15 s): la consola registró `Failed to load resource: net::ERR_NETWORK_CHANGED` y la corrida reescribió `nav-debug.png`, señal de una página lenta por un cambio de red del equipo. En esa misma pasada, las pruebas de contraste y del visor hostil pasaron. Las cuatro pasadas siguientes terminaron con 3 de 3 en verde. Lo trato en el hallazgo 2.

La corrida reescribe capturas: `email-wide-look-a.png` y `mesa-scratch-task.png` cambiaron de bytes, y `nav-debug.png` en la pasada fallida. Comparé los píxeles de `email-wide-look-a.png` contra la evidencia commiteada (1440x900, muestreo cada 3 px) y son idénticas. Restauré todo con `git checkout --` y el árbol quedó limpio.

## 3. Cierre de los seis hallazgos de la ronda 1

### 1. `FLAGS` en el listado

`searchMessages` pide ahora `(UID FLAGS BODY.PEEK[HEADER.FIELDS ...])` en `imap.ts:660`, y esa es la función que usan `listInbox` y `searchMailbox`, así que el panel recibe la bandera. El servidor falso responde `FLAGS (\Seen)` según el fixture (`inbound.spec.ts:65-66`), y la prueba de búsqueda comprueba el comando emitido y el resultado: `uid 11` vuelve con `seen: true` y `uid 10` con `false` (`inbound.spec.ts:309-311`). La prueba es de `searchMailbox`, pero el `FETCH` vive en la función compartida, y por eso cubre también la ruta del panel. La captura lo confirma de forma visible: con dos mensajes, el rail dice «Inbox 1» y solo una fila lleva punto.

Cerrado.

### 2. Teclado

La fila que citaba `f1/captures/keyboard.json` desapareció. `panel-layout.md:53` dice lo que el panel hace: las filas son botones, Enter y Espacio abren por semántica del navegador, y no hay listbox propio ni traspaso de foco al lector. Es cierto para `panels.tsx`: las filas son `<button>` y no hay `readingTitleRef` ni manejador de Escape en la pantalla. La afirmación ya no toma prestada evidencia de otra superficie.

Cerrado.

### 3. T6-E1

`access/tests/external-content.spec.ts` añade dos casos: un texto hostil como contexto no autoriza (`NO_GRANT`, `:31-42`) y una concesión viva para `mail.send` no se puede usar con otro contexto (`:44-56`). El segundo es el que carga el peso, porque hay una concesión real en juego; la prueba positiva del mismo servicio existe en `access.spec.ts:54-57` (`GRANTED` con el contexto correcto), así que el negativo no pasa por un servicio inerte. La fila de T6-E1 en `wave-checkpoint.md:124` cita ahora `hostile-viewer.md`, ese archivo y `write-denied.md`, con la inyección con modelo real como límite de E2.

Cerrado, con la precisión del hallazgo 4.

### 4. A5

El panel se mide en Chromium sobre el producto ensamblado, en los dos looks, con seis pares por look (`email-panel.e2e.ts:247-284`): cuerpo, remitente, dirección, contador del rail y remitente y asunto no leídos. La medición usa `getComputedStyle` y la fórmula de luminancia de WCAG, y falla la prueba si algún par baja de 4,5:1. Revisé los fondos que encuentra el recorrido: todos terminan en una superficie opaca (`.screen` con `bg-base`, la tarjeta del panel o la fila activa con `bg-layer-2`), así que no mide contra negro por accidente. Los seis colores que estaban en `label-caption` pasaron a `label-secondary` (`faberloom.module.css:479`, `516`, `635`, `666`, `675`, `707`). La prueba pasó en las cinco corridas.

Cerrado para contraste. El foco queda en la observación 3.

### 5. Nivel

`panel-layout.md:6` declara C1-E más C1-I, con dos cuentas y una caída en el producto ensamblado. El e2e guarda dos conexiones reales en el servicio de conexiones (`:99-107`), una rechaza, y la corrida comprueba la banda de fallo, la cuenta sana en el rail y el punto único de no leído (`:178-182`). Eso satisface la definición de C1-I para el panel. El receptor sigue en C1-E con servidor de sockets, que es lo que declaran `accounts.md` y `search-limits.md`, y la lectura con los buzones reales queda en PC3 como límite escrito.

Cerrado para lo que la ola puede integrar sin `AUTH-REAL-READ`.

### 6. Multi-carpeta

`accounts.md:70` y `search-limits.md:71` declaran que solo se lee la carpeta configurada y que listar y mover carpetas es O7 (T1-E2). O7-02 nombra «carpetas» en `todo.md`, así que el destino existe.

Cerrado.

## 4. Casos del gate

| Caso | Estado | Qué lo sostiene |
|---|---|---|
| T1-E1 recepción y lectura | Verde en composición aislada | `accounts.spec.ts` (cursores, caída, reconexión, lote, rechazo de escritura) y el panel C1-I con dos cuentas. Límite: buzones reales en PC3 |
| T6-E1 contenido externo | Verde en E1 | Visor aislado con red observada, autoridad que no acepta texto como concesión ni presta una concesión de otro contexto. Límite: inyección con modelo real en E2 |
| T7 visor hostil | Verde | Caso hostil del e2e con red observada y las cuatro pruebas del sanitizador. Límite: red del navegador, no del sistema |
| T16-E1 identidad adversaria | Verde con límite escrito | `connectionId` en cada superficie, `UIDVALIDITY` y deduplicación; carpeta única declarada en `search-limits.md`. Límite: carpetas en O7 |
| T17 adjuntos y búsqueda | Verde con dos límites | Seis razones de omisión, límites por documento y búsqueda que declara `complete`/`scanned`/`total`. Límites: aviso de truncamiento en O6; original íntegro por construcción, sin control propio |
| T22 volumen y caída | Verde en composición aislada | Lote 2/2/1/0, cuenta caída y reconexión, tope de 500. Límite: volumen real en PC3 |

## 5. Apariencia E1

| ID | Estado |
|---|---|
| A1 dos looks propios | PASS: densidad y superficie distintas, solo variables, dos capturas de ancho |
| A2 solo cambia presentación | PASS: los looks solo fijan `--fl-look-*` |
| A3 misma aprobación | No aplica a lectura E1 |
| A4 misma conducta | PASS: el e2e recorre abrir, cerrar y cambiar de look en A y en B |
| A5 legibilidad y acceso | PASS en contraste (seis pares por look, medidos); foco visible por el anillo del navegador, sin recorrido registrado (observación 3) |
| A6 tamaño y densidad | Parcial: 1440x900 y 420x800 medidos; 1024x768, 390x844 y zoom 200 % no se midieron en esta ola |
| A7 modos y carga | PASS para la elección del look: persistencia, valor inválido reparado y almacenamiento bloqueado. El modo oscuro no se capturó |
| A8 correo hostil | PASS |
| A9 actualización | No aplica |

## 6. Hallazgos de esta ronda

### 1. El punto de control sigue midiendo una revisión anterior (se corrige al escribir `CLOSED`)

- **Qué.** `wave-checkpoint.md:4` dice «Revisión medida: `afe9da6cf8`» y «Después solo cambian expedientes: `git diff --stat afe9da6cf8..HEAD -- packages apps` no muestra archivos». `:66` repite que el trabajo de O3 y O4 viaja en `afe9da6cf8`. `:58` sigue listando «T7 en navegador real (red y eventos) y aspecto a dos anchos y dos looks» como pendiente de PC3, y `:73` apunta la firma de O4 a la ronda 1.
- **Dónde.** La medición real: `git diff --stat afe9da6cf8..HEAD -- packages apps` muestra cinco archivos y 263 inserciones (`email-panel.e2e.ts`, `faberloom.module.css`, `external-content.spec.ts`, `imap.ts`, `inbound.spec.ts`). T7 y el aspecto a dos anchos están entregados y verificados en esta revisión; con el cuerpo real de un tercero solo queda PC3.
- **Por qué importa.** El punto de control es donde se va a escribir `CLOSED`. Si la línea de revisión medida nombra una revisión sin el arreglo de `FLAGS`, quien verifique ahí leerá el código anterior.
- **Qué lo cierra.** En el mismo commit que escriba `CLOSED`: poner `32fc221910` como revisión medida, quitar o reescribir el pendiente de T7 y apuntar la firma a `O4-review-round-2`.

### 2. La corrida del e2e no es determinista en este equipo (no bloquea el PASS)

- **Qué.** Una de cinco pasadas falló en la creación de la tarea desde cero, con `net::ERR_NETWORK_CHANGED` en consola y una página que tardó en pintar. Las otras cuatro terminaron con 3 de 3.
- **Dónde.** `email-panel.e2e.ts:236`, espera de 15 s por el título de la tarea. En esa misma pasada, contraste y visor hostil pasaron.
- **Por qué importa.** El comando de gate debe ser verde de forma reproducible; una pasada roja hace perder tiempo y debilita la evidencia. El paso es auxiliar: el gesto desde cero está cubierto de forma determinista en `registration.client.spec.tsx:1651`, y la aserción de una tarea por gesto se mide como delta (`email-panel.e2e.ts:221` y `:242`).
- **Qué lo cierra.** Esperar la creación por el resultado del RPC o reintentar la acción una vez, y repetir la corrida hasta que sea estable en un equipo con cambios de red.

### 3. A5: el foco no tiene recorrido registrado (observación)

La compuerta de apariencia pide registrar el orden de teclado y el foco, y una captura no lo demuestra. El panel no quita el contorno de los botones (solo hay `outline: none` en dos campos de texto, `faberloom.module.css:126` y `:1130`), así que el anillo del navegador sigue visible. No encontré un fallo, solo la falta del registro. Sugerencia: una pasada de teclado que deje el orden y el foco en el expediente.

### 4. T6-E1: la fila del punto de control describe de más el primer caso (observación)

El primer caso de `external-content.spec.ts` es un `NO_GRANT` genérico con un texto hostil como contexto; lo que demuestra que el texto no manda es el segundo, con una concesión viva. La fila dice «un texto hostil como contexto no autoriza ni toma prestada una concesión ajena», y el préstamo se prueba con `atacante@example.com`, no con texto hostil. Precisar la fila, sin cambiar el límite declarado.

## 7. Cierre de la ola: los diez puntos

| Punto de `faberloom-close-wave` | Estado |
|---|---|
| 1. Cada check cerrado con su expediente | Sí: O4-01 a O4-05 con su expediente y su campo `Revisión` |
| 2. Cada caso T con sus partes cerradas | Sí para E1, con los límites de PC3 y E2 escritos |
| 3. Dueño, nivel y gate por requisito | Sí: el nivel de cada parte está declarado en su expediente |
| 4. Dependencias cerradas | Sí: O2 y O3 con firma, PC1 y PC2 firmadas |
| 5. Gates humanos con autorización registrada | Sí: PC1 y PC2 en `decision-register.md` §3 |
| 6. Pruebas sobre la revisión actual | Sí: las ejecuté sobre `32fc221910`; el e2e, 4 de 5 pasadas (hallazgo 2) |
| 7. Controles negativos | Sí: escritura cero comandos, búsqueda parcial, HTML hostil y autoridad sin concesión |
| 8. Sin `.only`, `.skip`, supresiones ni umbrales bajados | Comprobado en los archivos del alcance: nada |
| 9. Sin TODO, mocks sin rótulo, botones sin acción ni errores silenciados | Sin TODO; el receptor del e2e está rotulado como servicio externo sustituido; marcar y papelera fallan con `WRITE_NOT_APPROVED` y muestran el motivo, declarado en `accounts.md` §3 |
| 10. Límites escritos y aceptados | Escritos; la aceptación es del CEO, que todavía no firmó (estado `READY_FOR_CEO`) |

## 8. Qué no cubre esta revisión

- O5, PC3, E2, T12 y T13 globales.
- Los buzones reales: no hay `AUTH-REAL-READ` y no la uso.
- El agregado de 1.612 pruebas de `wave-checkpoint.md` §3 y la suite completa de `packages/faberloom`.
- El modo oscuro, los tamaños 1024x768 y 390x844, y el zoom 200 % en el panel nuevo.
- El envío y la aprobación del mensaje exacto, que son E2.
- La auditoría de todo el repositorio: revisé los archivos del alcance, no el árbol completo.

## 9. Frase firmable

Con los seis hallazgos de la ronda 1 cerrados sobre `32fc221910`, la firma que se puede escribir sin reinterpretar es:

> La ola O4, contratos O4-01 a O4-05, los casos T1-E1, T6-E1, T7, T16-E1, T17 y T22 y la apariencia E1 aplicable, queda cerrada sobre la revisión `32fc221910` con la evidencia ejecutada de la revisión independiente ronda 2; no cubre O5, PC3 ni E2, y acepta los límites L-1 a L-4 de este informe.

Los límites que la firma acepta:

| Límite | Qué es | Cómo se cerraría |
|---|---|---|
| L-1 | El receptor de correo está probado a nivel C1-E con servidor de sockets; la lectura con los dos buzones reales es PC3 y exige `AUTH-REAL-READ` | PC3 sobre los buzones del piloto |
| L-2 | La inyección con modelo real no está probada: E1 demuestra aislamiento, no ejecución y una autoridad que no acepta texto como concesión | E2 (S-7), con proveedor y clave |
| L-3 | El aviso de truncamiento del Markdown de adjuntos no se muestra todavía, y el original íntegro se sostiene por construcción, sin control propio | O6, con la tarjeta del lector de adjuntos |
| L-4 | La corrida del e2e no fue determinista en este equipo: 4 de 5 pasadas verdes, con un fallo por `net::ERR_NETWORK_CHANGED` en la tarea desde cero | Endurecer el paso y repetir la corrida (hallazgo 2) |
