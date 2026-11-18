# Revisión independiente · Ola O4 (ronda 1)

- Fecha: 2026-11-18
- Revisor: TestingRealityChecker, independiente. No escribí el código ni los expedientes revisados; este informe es lo único que escribo.
- Alcance: O4-01 a O4-05 de `tasks/todo.md`, más los casos que su gate nombra: T1-E1, T6-E1, T7, T16-E1, T17, T22 y la apariencia E1 aplicable. No cubre O5, PC3, E2 ni T12/T13 globales.
- Revisión verificada: `3c68b6505a` (código y evidencia). `a9ff2c746d` es el commit de documentación que apunta el campo `Revisión`.
- Rama: `fix/guarda-operadores`.
- Estado de partida: NEEDS_WORK.
- Veredicto: **NEEDS_WORK** (hallazgos en §7, cierre en §10).

## 1. Revisión y rutas comprobadas

`git diff --stat 3c68b6505a..HEAD -- packages apps` no muestra archivos, así que el código medido es el del commit citado y la evidencia de los cinco expedientes corresponde a ese código.

`git cat-file -e 3c68b6505a:<ruta>` devuelve cero para las dieciséis rutas que comprobé: los cinco expedientes (`accounts.md`, `search-limits.md`, `panel-layout.md`, `hostile-viewer.md`, `attachments.md`), `wave-checkpoint.md`, `apps/web/tests/email-panel.e2e.ts`, las siete capturas del panel y del visor, y las cuatro fuentes que cito en los hallazgos (`safe-email.ts`, `panels.tsx`, `inbound/src/index.ts`, `view/src/index.ts`).

## 2. Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git diff --stat 3c68b6505a..HEAD -- packages apps` | vacío |
| `git cat-file -e` sobre 16 rutas de `3c68b6505a` | las 16 existen |
| `corepack pnpm exec vitest run packages/faberloom/inbound packages/faberloom/tool-faberloom packages/faberloom/handlers packages/faberloom/view --project thread-safe` | 47 archivos, 458 pruebas, todas pasan |
| `corepack pnpm exec vitest run packages/client/ui-faberloom --project thread-safe` | 23 archivos, 281 pruebas, todas pasan |
| `corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json` | exit 0 |
| `DSH_SNAPSHOT=replay corepack pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/email-panel.e2e.ts` | 2 pruebas, ejecutado dos veces, las dos pasan |
| `corepack pnpm run verify-client-ui-i18n` | 686 archivos de cliente, sin cadenas fijas |
| Comparación de píxeles de capturas contra una corrida nueva | 0 píxeles distintos en `email-wide-look-a.png` y `email-hostile.png` (1440x900, muestreo cada 4 px) |

Nota de consola: en este equipo `corepack pnpm` devuelve código 1 porque vite escribe su aviso en stderr; los resúmenes de vitest y el exit 0 de `tsc` son los que cuentan y están arriba.

La corrida del e2e reescribe capturas. En la primera pasada cambiaron de bytes `email-hostile.png`, `email-wide-look-a.png` y `mesa-scratch-task.png`; en la segunda, `email-wide-look-a.png` y `mesa-scratch-task.png`. Las cuatro capturas estrechas y `email-wide-look-b.png` conservaron sus bytes. Comparé los píxeles de las dos que podían haber cambiado de contenido y son idénticas a la evidencia commiteada; `mesa-scratch-task.png` cambia por diseño, porque el título de la tarea desde cero es único por corrida. Restauré con `git checkout --` todo lo que la corrida reescribió y el árbol quedó limpio.

No ejecuté el agregado de 1.612 pruebas que cita `wave-checkpoint.md` §3: queda fuera de los comandos de esta revisión y no lo uso como evidencia.

## 3. Lo que sí queda demostrado

### 3.1 Evidencia vigente (punto 1)

`panel-layout.md` describe el panel que existe, no otro:

- Rail con vistas y cuentas: `panels.tsx:2185-2213`.
- Lista buscada por rol `list` con nombre «Inbox» (`<ul aria-label>`) y una fila por botón: `panels.tsx:2237-2267`.
- Lector en `aside` con remitente, cuenta y fecha, y cuerpo como texto: `panels.tsx:2058-2075` y `:2116-2124`.
- No queda ningún campo «De / Para / Fecha»: el lector no los pinta, y la página lo dice de forma explícita.

Las seis capturas citadas existen y son las que escribe el e2e: `email-wide-look-a.png`, `email-wide-look-b.png`, `email-narrow-list-a.png`, `email-narrow-list-b.png`, `email-narrow-reader-a.png` y `email-narrow-reader-b.png`. Las miré una por una. `email-wide-look-a.png` se commiteó un día antes que las demás, pero su contenido coincide píxel a píxel con una corrida nueva sobre la revisión medida, así que no está desactualizada.

### 3.2 Dos anchos y dos looks (punto 2)

- A 1440x900 el e2e exige que el lector empiece después del punto medio de la lista y mida más de 200 px (`email-panel.e2e.ts:116-123`). La rejilla de `faberloom.module.css:442-445` fija dos columnas desde 900 px, así que las dos zonas no pueden solaparse.
- A 420x800 exige un solo panel: el lector por encima de 380 px, la lista oculta mientras se lee (`:129-140`), y `scrollWidth - clientWidth <= 1` en los dos looks (`:138-140` y `:156-158`). La regla que oculta una zona u otra está en `faberloom.module.css:757-771`.
- Las cuatro capturas lo muestran: en ancho se ven rail, lista y lector; en estrecho se ve una zona por vez.
- Los dos looks difieren de verdad y solo por variables: densidad de fila (36 px contra 44 px), radio (8 px contra 6 px), superficie de tarjeta y tratamiento de etiquetas, en `looks/look-a.module.css` y `looks/look-b.module.css`. Ninguna regla de esos dos archivos pinta un color literal ni toca `--dsw-alias-*`.

### 3.3 T7 en navegador real (punto 3)

El caso hostil de `email-panel.e2e.ts:187-218` sí observa la red y no se autoengaña:

- El registro de peticiones se declara y se engancha antes de abrir el correo: `requests` y `page.on('request', onRequest)` en `:190-192`, y `openMail()` y el clic al segundo mensaje en `:195-198`. No hay ventana entre la carga del cuerpo y el observador.
- El cuerpo hostil llega por el fixture `readEmail` (`:189`), y es la segunda fila, que no se había leído en la corrida; si el panel hubiera pintado un cuerpo cacheado, la espera por «Hola desde el proveedor» (`:200`) fallaría antes de llegar a las aserciones.
- Comprueba texto legítimo legible (`:200`), CSP dentro del documento (`:203`), ausencia de `<script` (`:204`), de `<form` (`:205`) y de `tracker.example` en el `srcdoc` (`:206`), `sandbox` presente y vacío (`:207`), cero peticiones al origen hostil tras 600 ms (`:209-210`), `window.__pwned` indefinido (`:211`) y cero formularios en el artículo (`:212`).
- Las tres capas están en el código: `sandbox=""` en `panels.tsx:2122`, sanitizado antes de `srcDoc` en `panels.tsx:1758-1763` con `safe-email.ts`, y la CSP de `safe-email.ts:19-31`.
- Las cuatro pruebas de `safe-email.client.spec.tsx` cubren además lo legítimo que sobrevive, los recursos remotos y las anclas internas.

Límites que el expediente declara y que confirmo: la red se observa en el navegador, no a nivel de sistema; el buzón es un fixture. Añado uno que el expediente no declara: el fixture hostil no incluye un `<style>` con `url(...)`, `@import` o `@font-face`, y el sanitizador no elimina `<style>`; esa vía queda cubierta solo por la CSP, sin un caso que la ejercite.

### 3.4 Dos cuentas, cursores, reconexión y rechazo de escritura (punto 4)

Lo que queda demostrado en `accounts.spec.ts`:

- Cursores por conexión y dos cuentas en una pasada (`:137-157`).
- Cuenta A caída con B útil, y A recuperando su atraso al reabrirse en el mismo puerto sin que B arranque dos veces (`:159-190`).
- Lote de 2 con 5 mensajes: lecturas 2, 2, 1, 0 y cinco arranques únicos (`:192-217`).
- `markSeen` y `moveToTrash` rechazan con `WRITE_NOT_APPROVED`, el registro del servidor no crece y no aparece `STORE`, `COPY` ni `EXPUNGE` (`:219-233`). El propio rechazo está en `index.ts:310-333`; la lectura usa `BODY.PEEK` para sobres y cuerpo (`imap.ts:286` y `:351`).

Lo que no queda demostrado es la lectura de `FLAGS` en el camino que alimenta el panel. Ver hallazgo 1.

### 3.5 Backlog y búsqueda (punto 5)

- Ventana por cuenta: `emailInbox` pide `limit` envelopes por conexión, 50 por defecto y acotado a 1..500 (`view/src/index.ts:4754`), y el panel amplía de 50 en 50 con «Mostrar más» (`panels.tsx:2290-2294`). Probado en `inbox-accounts.spec.ts:87-95` y `:66-85` (dos cuentas de 40 devuelven 80 filas, 40 por cuenta).
- Cobertura de búsqueda: `complete`, `scanned`, `total` y `matched` en `imap.ts:608-623`, y el caso del servidor que rechaza `CHARSET UTF-8` en `inbound.spec.ts:320-342`: `complete: false`, `scanned: 2`, `total: 3`. La búsqueda nunca avanza el cursor (`inbound.spec.ts:311-312`).
- Identidad con cuenta: cada fila lleva `connectionId` (`view/src/index.ts:4760`), todas las acciones parsean `<conexión>:<uid>` (`requireInbound`), la tool repite `connectionId` por fila (`tool-faberloom/src/index.ts:3165`) y el paso `imap` de rutina informa `complete` y `scanned` y acepta `connectionId` (`handlers/src/steps.ts:162-173`).

Un detalle que no rompe nada pero conviene saber: la condición de «Mostrar más» compara el total agregado de filas contra el tope por cuenta (`panels.tsx:2290`), así que el botón puede aparecer antes de que una cuenta se agote. Nunca oculta correo, porque si una cuenta se topó con el límite el agregado ya lo alcanza.

### 3.6 Adjuntos (punto 6)

- Límites en `documents.ts:87-95`: 25 MB de entrada, 20 s por documento, 200 KB de salida, 8 KB de diagnóstico, temporal por lote borrado en `finally` (`:207-220`).
- Omisiones nombradas: `unsupported`, `oversized`, `timeout`, `failed`, `empty` y `converter-missing` (`:36-42`), con seis pruebas nuevas en `documents.spec.ts` que separan cada una (`:105-170`).
- Original íntegro: los bytes se copian a un archivo temporal (`:159-163`) y nunca se escribe el archivo del correo. Esto vale por construcción del camino, no por una aserción ejecutada: ninguna prueba compara los bytes del original después de convertir. La afirmación «originales íntegros» del expediente no tiene control negativo propio.

## 4. Casos del gate (punto 7)

| Caso | Estado | Qué lo sostiene |
|---|---|---|
| T1-E1 recepción y lectura | Demostrado en composición aislada, con dos límites | `accounts.spec.ts` completo y el e2e sobre el panel. Límites: buzones reales en PC3; nivel C1-I del receptor, ver hallazgo 5 |
| T6-E1 contenido externo como dato | **No cerrado como está escrito** | Aislamiento y no ejecución sí (`hostile-viewer.md` y el caso hostil). La parte «no altera destinatarios ni memoria» no tiene prueba, y la fila del checkpoint cita el expediente equivocado. Ver hallazgo 3 |
| T7 visor hostil | Demostrado | Caso hostil del e2e con red observada, más las cuatro pruebas del sanitizador. Límites: red del navegador, no del sistema; `<style>` sin caso |
| T16-E1 identidad adversaria | Parcial | `connectionId` y `UIDVALIDITY` probados (`search-limits.md`, `identity.md`). Carpetas sin evidencia ni límite escrito. Ver hallazgo 6 |
| T17 adjuntos y búsqueda | Demostrado con dos límites | Seis razones de omisión, límites por documento y búsqueda que declara cobertura. Límites: aviso de truncamiento en O6; original íntegro sin control propio |
| T22 volumen y caída | Demostrado en composición aislada | Lote 2/2/1/0, cuenta caída y reconexión, tope de 500. Límite: volumen real en PC3 |

Sobre T6-E1 en concreto: lo que hay prueba es que el cuerpo hostil no ejecuta, no carga recursos y no dibuja controles. Lo que el caso pide en `evidence-assignments.md:59` es además que el hostil no altere política, memoria ni destinatarios. Eso no se puede probar sin un modelo en el bucle, y `gate-security-review.md:71` ya lo difiere a E2. Es un límite, no un pase, y hoy está escrito como si `write-denied.md` lo cubriera.

## 5. Apariencia E1

| ID | Estado en O4 |
|---|---|
| A1 dos looks propios | PASS: densidad y superficie distintas, solo variables, y las dos capturas de ancho |
| A2 solo cambia presentación | PASS: los dos looks solo fijan `--fl-look-*`; ninguna lógica ni servicio en esos archivos |
| A3 misma aprobación | No aplica a lectura E1: la aprobación con To/Cc/Bcc/adjuntos/versión es O6 |
| A4 misma conducta | PASS en lo observable: abrir, cerrar y cambiar de look en los dos looks; el e2e hace el mismo recorrido en A y en B |
| A5 legibilidad y acceso | **Parcial**: el contraste medido en O2 es de la superficie F1, no del panel nuevo; el hover de la acción de papelera usa `color-mix` sobre el color de error (`faberloom.module.css:989-991`) y ese par no está medido. La navegación por teclado del panel tampoco está registrada (hallazgo 2) |
| A6 tamaño y densidad | Parcial: 1440x900 y 420x800 medidos; 1024x768, 390x844 y zoom 200 % no se midieron en esta ola |
| A7 modos y carga | PASS para la elección del look: persistencia, valor inválido reparado y almacenamiento bloqueado en `appearance.client.spec.tsx:43-63`. El modo oscuro no se capturó en O4 |
| A8 correo hostil | PASS: el caso hostil del e2e |
| A9 actualización | No aplica: no hay `PRE_DEPLOY_E1_UPDATE` |

La compuerta dice que una captura no demuestra teclado ni foco. En O4 no hay medición de teclado ni de contraste para el panel nuevo, y la fila de teclado del expediente apunta a otro artefacto.

## 7. Hallazgos

### 1. `FLAGS` no se pide en el camino que llena el panel, y el expediente dice que sí (bloqueante)

- **Qué.** `accounts.md:35` afirma: «El listado pide además `FLAGS` en el mismo `FETCH` para publicar `seen`; pedir la bandera no la escribe, y la pantalla distingue leído de no leído sin mutar el buzón». El panel no recibe esas banderas.
- **Dónde.** El panel llama `emailInbox` (`panels.tsx:1692`), que llama `inbound.listInbox` (`view/src/index.ts:4757`), que usa `searchMessages` (`inbound/src/index.ts:256`). Ese `FETCH` es `(UID BODY.PEEK[HEADER.FIELDS ...])`, sin `FLAGS` (`imap.ts:660`). `FLAGS` solo aparece en el `FETCH` del sondeo (`imap.ts:286`), cuyos mensajes no alimentan la pantalla. `messagesOf` sí sabe leer banderas si llegan (`imap.ts:713`), pero un servidor que responde lo que se le pide no las manda.
- **Por qué importa.** Con el receptor real, toda fila llega con `seen: false`: el punto de no leído queda siempre encendido y `railCount` (`panels.tsx:1822`) devuelve siempre el total, así que la rama «cuando todo está leído» es inalcanzable. La captura lo esconde porque el fixture del e2e inventa `seen` (`email-panel.e2e.ts:36-38`), y ninguna prueba del listado mira `seen`: los fixtures de `inbox-accounts.spec.ts` no traen la propiedad y `inbound.spec.ts:278` prueba solo el parser de `messagesOf`. Es una capacidad declarada que la superficie mostrada no tiene.
- **Qué lo cierra.** Añadir `FLAGS` al `FETCH` de `searchMessages` y una prueba de extremo a receptor donde un mensaje con `\Seen` llegue como `seen: true` (el servidor de prueba tiene que responder la bandera), o corregir `accounts.md` §3 y `panel-layout.md` §1 y §2 y declarar que en E1 el panel no distingue leído de no leído.

### 2. La fila de teclado del expediente es del prototipo F1, no del panel integrado (bloqueante)

- **Qué.** `panel-layout.md:51` sostiene: «Enter abre y lleva el foco al título; Escape cierra y vuelve a la fila (`f1/captures/keyboard.json`)».
- **Dónde.** `f1/captures/keyboard.json` registra paradas con etiquetas del prototipo en castellano («Cambiar look: Papel», «Lista y lectura», «Iterar sobre este correo», «Distribuidora Central (sintético)»). El panel del producto usa otros controles («Change look», «Inbox») y no tiene lista con `listbox`, ni `readingTitleRef`, ni traspaso de foco al título. La pantalla de Correo no registra ningún manejador de Escape: los dos de `panels.tsx` (líneas 4221 y 5166) son de la tarjeta de Mesa y de un `details`.
- **Por qué importa.** Es la única evidencia de teclado de O4-03, y no es de la superficie que el propio expediente describe y que muestran las seis capturas. Enter funciona solo como activación nativa del botón de fila; Escape no cierra el lector; el foco no se mueve. La compuerta de apariencia exige registrar el orden de teclado para el panel, no para el prototipo.
- **Qué lo cierra.** Quitar la fila del expediente y declarar el teclado del panel como no verificado, o implementar Escape y el traspaso de foco en `panels.tsx` con una prueba que recorra el orden y lo capture, y citar esa prueba.

### 3. La fila de T6-E1 cita el expediente equivocado y no escribe el límite que corresponde (bloqueante)

- **Qué.** `wave-checkpoint.md:123` da como evidencia de T6-E1 `write-denied.md` y `gate-security-review.md`, y como límite «Prueba de inyección con modelo real: E2 (S-7)».
- **Dónde.** Esos dos documentos tratan del rechazo de escritura y de los canarios de O3; no contienen la prueba de contenido externo. La evidencia de O4 para T6-E1 es `hostile-viewer.md` §1 a §3 y el caso hostil del e2e. Además, `evidence-assignments.md:59` pide para T6-E1 «hostil no altera política/memoria/destinatarios y preparación legítima funciona» a nivel C1-I, y nada de eso se prueba: no hay modelo en el bucle y no hay camino del cuerpo a los destinatarios ni a la memoria (`gate-security-review.md:71` ya lo difiere a E2).
- **Por qué importa.** Tal como está, la tabla deja creer que T6-E1 está verde citando documentos que no lo tratan, y el límite menciona solo la inyección con modelo, no la parte de destinatarios y memoria que tampoco está cubierta.
- **Qué lo cierra.** Reescribir la fila con la evidencia real (`hostile-viewer.md` y el caso hostil) y un límite que diga exactamente qué queda abierto: E1 demuestra que el contenido no ejecuta, no carga recursos y no dibuja controles; que no puede alterar destinatarios o memoria con un modelo en el bucle queda para PC3/E2.

### 4. A5 no está medida para el panel nuevo (bloqueante para O4-03)

- **Qué.** O4-03 tiene A1 a A7 en alcance, y A5 pide contraste 4,5:1 en texto y 3:1 en componentes, con foco visible.
- **Dónde.** La medición de 24 pares de `f1/pc2-look.md` es de la superficie F1. El panel nuevo introduce pares que esa medición no cubre, por ejemplo el fondo de `color-mix` al 14 % del color de error con el texto de error encima (`faberloom.module.css:989-991`), el punto de no leído sobre la tarjeta y el contador del rail. No hay medidor ni prueba de contraste para esta pantalla, y el e2e no mira foco.
- **Por qué importa.** La compuerta de apariencia dice que la consola limpia y el foco se comprueban, no se suponen. A5 está en el gate de la ola y hoy se apoya en una medición de otra superficie.
- **Qué lo cierra.** Medir los pares nuevos del panel en los dos temas y los dos looks, y registrar el recorrido de foco, o declarar A5 como pendiente con dueño y fecha.

### 5. El nivel declarado en los expedientes está por debajo del que exige la asignación (bloqueante documental)

- **Qué.** Los encabezados de los expedientes declaran el nivel por debajo del que exige la asignación: `accounts.md:6` y `hostile-viewer.md:6` dicen C1-E más C1-L, y `search-limits.md:6` dice C1-E más C1-L aunque la búsqueda también se mide en el producto. `panel-layout.md:6` y `attachments.md:6` sí añaden una parte C1-I. `evidence-assignments.md` pide C1-I para T1-E1 (`:53`), T7-E1 (`:61`), T17 (`:82`), T22 (`:91`) y T16-E1 (`:80`).
- **Dónde.** El e2e sí es C1-I para el panel, pero reemplaza el receptor por un fixture; el camino de correo solo está probado a nivel de prueba con servidor de sockets, no dentro del producto ensamblado. Para T1-E1, T17 y T22 no existe un recorrido integrado que una receptor real y panel real.
- **Por qué importa.** La definición de terminado pide «Nivel C1-L/C1-E/C1-I requerido alcanzado». Declarar C1-E cuando la asignación pide C1-I deja el caso por debajo del mínimo sin decirlo; y en T7, que sí alcanza C1-I con el e2e, el encabezado se queda corto y confunde.
- **Qué lo cierra.** O bien levantar el recorrido integrado con un servidor IMAP falso local dentro de la app ensamblada (no hace falta buzón real ni autorización), o bien escribir en cada expediente qué parte alcanza C1-I y cuál espera PC3, y ajustar el encabezado de T7.

### 6. Multi-carpeta se delega a O4-02 y O4-02 no lo entrega ni lo declara (bloqueante documental)

- **Qué.** `accounts.md:70` dice «Multi-carpeta es O4-02». `search-limits.md` no menciona carpetas en ningún apartado.
- **Dónde.** El receptor lee un buzón por conexión (`inbound/src/index.ts:263`, `config.mailbox ?? 'INBOX'`), y `connections` no guarda carpeta por cuenta. T16-E1 pide «carpetas/UIDVALIDITY/rutinas sin mezcla/duplicado» (`evidence-assignments.md:80`).
- **Por qué importa.** Un pendiente asignado a una ola que ni lo implementa ni lo declara desaparece del mapa: queda fuera de O4 y fuera de cualquier límite escrito.
- **Qué lo cierra.** Declarar en `search-limits.md` que E1 lee un buzón por conexión y que la identidad por carpeta llega con multi-carpeta, con su ola, o mover la asignación a la ola que lo implemente.

### 7. Las capturas no muestran dos cuentas ni los estados de cuenta (no bloqueante, pero la evidencia visual no coincide con lo que describe el expediente)

- **Qué.** `panel-layout.md` describe rail con cuentas y contadores (`:15`), lector con la cuenta junto a la fecha (`:17`) y banda de cuenta caída (`:30`). Ninguna de las seis capturas muestra esos tres estados.
- **Dónde.** El fixture del e2e devuelve filas sin `account` y sin `failures` (`email-panel.e2e.ts:36-41`), así que el grupo «Cuentas» del rail, la cuenta del lector y la banda de fallos no se pintan. La captura de ancho enseña «Inbox 1» y «Drafts 0» bajo «Views», nada más.
- **Por qué importa.** El gate pide «ambos contenidos». La prueba funcional de dos cuentas existe, pero la evidencia visual de la ola nunca enseña dos cuentas ni un error de cuenta, y esas partes del expediente quedan sin imagen.
- **Qué lo cierra.** Añadir `account` y una `failures` al fixture y una captura con la banda de error, o quitar de §2 las filas que las capturas no sostienen.

## 8. Cierre de la ola: los diez puntos

| Punto de `faberloom-close-wave` | Estado |
|---|---|
| 1. Cada check cerrado con su expediente | No: hallazgos 1, 2 y 6 |
| 2. Cada caso T con sus partes cerradas | No: T6-E1 y T16-E1 |
| 3. Dueño, nivel y gate por requisito | Dueño y gate sí; el nivel declarado no coincide (hallazgo 5) |
| 4. Dependencias cerradas | Sí: O2 y O3 con firma, PC1 y PC2 firmadas |
| 5. Gates humanos con autorización registrada | Sí: PC1 y PC2 en `decision-register.md` §3 |
| 6. Pruebas sobre la revisión actual | Sí: las ejecuté sobre `3c68b6505a` |
| 7. Controles negativos | Sí para escritura, búsqueda parcial y HTML hostil; falta el de `seen` |
| 8. Sin `.only`, `.skip`, supresiones ni umbrales bajados | Comprobado en los archivos del alcance: nada |
| 9. Sin TODO, mocks sin rótulo, botones sin acción ni errores silenciados | Sin TODO ni mocks sin rótulo. Los botones de marcar y papelera fallan con `WRITE_NOT_APPROVED` y muestran el motivo; está declarado en `accounts.md` §3. No lo trato como bloqueo |
| 10. Límites escritos y aceptados | Escritos en su mayoría; faltan los de los hallazgos 3, 5 y 6, y la aceptación es del CEO, que todavía no firmó |

## 9. Qué no cubre esta revisión

- O5, PC3, E2, T12 y T13 globales.
- Los buzones reales: no hay `AUTH-REAL-READ` y no la uso.
- El agregado de 1.612 pruebas de `wave-checkpoint.md` §3 y la suite completa de `packages/faberloom`.
- El envío, la aprobación del mensaje exacto y las superficies de E2.
- El modo oscuro, los tamaños 1024x768 y 390x844, y el zoom 200 % en el panel nuevo.
- La auditoría de todo el repositorio: revisé los archivos del alcance, no el árbol completo.

## 10. Veredicto

**NEEDS_WORK.** La ola no está rota: las 458 pruebas del conjunto de correo, las 281 del cliente y las 2 del navegador pasan sobre `3c68b6505a`, el aislamiento del visor se demuestra en Chromium con la red observada, y el servidor de prueba no recibe un solo comando de escritura. Lo que impide cerrar es distinto: dos afirmaciones del expediente no son ciertas para la superficie que describen (`FLAGS` en el listado y el teclado del panel), T6-E1 se apoya en documentos que no lo tratan, A5 no está medida para el panel nuevo, el nivel declarado queda por debajo del exigido y multi-carpeta quedó delegada a una ola que no la menciona.

No emito la frase de cierre firmable porque el veredicto no es PASS. Cuando los hallazgos 1 a 6 estén cerrados y 7 resuelto o declarado, esta revisión se puede repetir sobre una revisión nueva y, si el resultado es PASS, la frase nombrará esa revisión y el alcance O4-01 a O4-05 con los casos del gate, sin O5, PC3 ni E2.
