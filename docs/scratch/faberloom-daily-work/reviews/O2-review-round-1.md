# Revisión independiente · O2 (F1)

- Fecha: 2026-11-17
- Alcance: O2-01 a O2-06 en su parte F1 y el gate PC2, sobre los expedientes de `docs/scratch/faberloom-daily-work/f1/` y `decisions/PC2-2026-11-17.md`. Fuera de alcance: T13 global, T12 global, seguridad integrada, envío, actualización (T14), integración con el motor y persistencia del borrador.
- Revisión revisada: `git rev-parse --short HEAD` = `ed8d6af933`, rama `fix/guarda-operadores`, más cuatro archivos modificados y diez archivos sin seguimiento (`git status --short`).
- Veredicto: **NEEDS_WORK**.
- Revisor: sesión distinta de la que escribió el material. No se editó código, configuración ni expediente; el único archivo escrito es este informe.

## Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git rev-parse --short HEAD` | `ed8d6af933` |
| `git status --short` | 4 modificados (`appearance-compare.e2e.ts`, `measurements.json`, `window-open.png`, `pc2-look.md`); 10 sin seguimiento (9 capturas y `matrix.json`) |
| `cd apps/web; corepack pnpm exec vite build --config prototype/f1/vite.config.ts` | build correcto, 38 módulos, `built in 853ms` |
| `corepack pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts` | 1 archivo, 8 pruebas, 8 pasan, `EXITCODE=0` |
| `corepack pnpm exec vitest run packages/client/ui-faberloom` | 23 archivos, 281 pruebas, 281 pasan, `EXITCODE=0` |
| `vitest run` de los cuatro specs de F1 con `--reporter=verbose` | 30 pruebas: 12 de `email-layout`, 8 de `appearance`, 7 de `task-chat-window`, 3 de `appearance-tokens`; `EXITCODE=0` |
| `corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json` | `EXITCODE=0` |
| `corepack pnpm exec tsx scripts/run-oxlint.ts` sobre `email-layout.tsx`, `appearance.ts`, `task-chat-window.tsx` y el e2e | `EXITCODE=0` |
| `corepack pnpm run verify-client-ui-i18n` | `EXITCODE=0`, 686 archivos |
| `git cat-file -e 0b01ca39:<ruta F1>` para `email-layout.tsx`, `appearance.ts`, `look-a.module.css`, `email-layout.client.spec.tsx` y `f1/looks.md` | las cinco rutas no existen en esa revisión |
| `Get-FileHash -Algorithm SHA256 DESIGN_MESA.md` | coincide con la huella de `references.md` |
| Lectura de `matrix.json` y `measurements.json` | 12 celdas; 24 pares, mínimo 4,70, máximo 15,46, ninguno por debajo de 4,5 |

Nota honesta: la primera invocación de vitest devolvió `Exit code: 1` en PowerShell por un aviso de `vite-tsconfig-paths` en stderr, no por una prueba fallida. Repetida con redirección de stderr, la corrida terminó en `EXITCODE=0` con 8 de 8.

## Hallazgos

### 1. BLOQUEANTE · La revisión declarada no contiene el trabajo

Qué: los nueve expedientes y `pc2-look.md` declaran `Revisión: 0b01ca39365ba04fe89858bcac56e3523896ee4d` (`references.md:4`, `token-map.md:4`, `design-direction.md:4`, `email-surface.md:4`, `looks.md:4`, `conflict-resolution.md:4`, `adaptation-estimate.md:4`, `iteration-window.md:4`, `antislop.md:4`, `pc2-look.md:3`). En esa revisión no existe ningún archivo de F1: `git cat-file -e` falla para `email-layout.tsx`, `appearance.ts`, `looks/look-a.module.css`, `tests/email-layout.client.spec.tsx` y `f1/looks.md`. El log muestra que todo el material F1 entró en `6b71b071ba` (2026-11-17), 16 commits antes de HEAD.

Además, la evidencia de 16 celdas solo puede producirse con el cambio no confirmado de `apps/web/tests/appearance-compare.e2e.ts` y con capturas que no están bajo seguimiento.

Por qué importa: el punto 6 de `faberloom-close-wave` exige pruebas ejecutadas sobre la revisión actual y `plan.md` §5 exige diff revisado y revisión candidata. Hoy no existe ninguna revisión que contenga a la vez los expedientes y la evidencia; el campo `Revisión` apunta a un árbol anterior al prototipo.

Qué lo cerraría: confirmar el spec, las capturas y `matrix.json`; escribir en los nueve expedientes y en `pc2-look.md` el commit que sí los contiene; repetir build y compuerta sobre ese commit y conservar la salida.

### 2. BLOQUEANTE · Se declaran 16 celdas con fila propia y comprobaciones que solo reciben 12

Qué: `pc2-look.md:28` afirma que cada una de las 16 celdas tiene su fila en `matrix.json`. `matrix.json` tiene 12 filas, cuatro por cada vista (1440x900, 1024x768, 390x844), y ninguna de zoom. El test escribe esas 12 celdas y afirma `expect(cells).toHaveLength(12)` (`appearance-compare.e2e.ts:190-194`); el bucle de zoom (`appearance-compare.e2e.ts:263-278`) no añade celdas ni reescribe el JSON, solo guarda `*-zoom200.png`.

`pc2-look.md:37` añade que "en las 16 celdas" la corrida comprueba contenido idéntico, botones de al menos 44 px y consola limpia. En el código, el contenido y la consola se comprueban solo en las 12 celdas de la matriz (`appearance-compare.e2e.ts:172-176` y `:195`), los 44 px solo en las cuatro celdas de 390 (`:179-184`), y el zoom solo comprueba desbordamiento (`:271-273`).

Por qué importa: las cuatro capturas de zoom existen y la propiedad de fondo (sin desbordamiento al 200 %) sí se demuestra, pero no con la cobertura ni con el rastro que el expediente afirma, y `matrix.json` no permite auditar las celdas de zoom.

Qué lo cerraría: incluir las cuatro celdas de zoom en `matrix.json` con su `overflow`, o reescribir `pc2-look.md` para declarar "12 celdas en la matriz más 4 capturas de zoom con una sola comprobación" y dejar de atribuir las cuatro comprobaciones a las 16.

### 3. BLOQUEANTE · A5 "foco visible" y el recorrido de teclado registrado no tienen prueba ejecutada

Qué: la prueba de teclado (`appearance-compare.e2e.ts:230-248`) pulsa Tab doce veces y afirma `expect(stops.length).toBe(12)`, que siempre es cierto, y `expect(new Set(stops).size).toBeGreaterThan(3)`, que también pasaría con una trampa de cuatro elementos. No lee `outline`, `box-shadow` ni `:focus-visible`, y no escribe `stops` en ningún archivo. `antislop.md:48` afirma "12 tabulaciones registradas, foco visible" y `pc2-look.md:68` afirma "Foco visible en todos los interactivos".

Lo que sí existe: la regla `:focus-visible` con `outline: 2px solid var(--dsw-alias-brand-primary)` en `email-layout.module.css:347-356`, y el anillo visible sobre el textarea en `window-open.png`.

Por qué importa: el propio gate advierte que una captura no demuestra teclado ni foco y pide navegar y registrar el orden. Si se borra la regla `:focus-visible`, la compuerta sigue en verde: la comprobación A5 no está demostrada, solo implementada.

Qué lo cerraría: una prueba que recorra con Tab y escriba el orden a un archivo del expediente, y que lea el estilo computado del elemento enfocado (por ejemplo `outlineWidth` y `outlineColor`) en los dos looks y los dos temas.

### 4. MAYOR · Los conteos de pruebas de los expedientes no coinciden con los archivos

Qué y dónde: `email-surface.md:19` dice "Siete pruebas" y `:42-45` dice "Tests 7 passed (7)"; el archivo tiene 12 (`email-layout.client.spec.tsx`, línea 59 a 213). `looks.md:56` dice 9 para el mismo archivo. `iteration-window.md:39` dice "258 pruebas, 22 archivos"; la corrida da 281 y 23. `email-surface.md:68` dice 682 archivos; `verify-client-ui-i18n` informa 686.

Por qué importa: es el mismo defecto que ya obligó a varias rondas de F0 (`reviews/F0-review-log.md:21`). Un expediente que cita un resultado que no se reproduce no sirve como evidencia, y aquí choca con el punto 6 de cierre.

Qué lo cerraría: regenerar cada cifra con el comando que el propio expediente publica, o dejar de citar conteos que caducan.

### 5. MAYOR · `email-surface.md` se contradice sobre O2-04 y O2-06

Qué: §5 (`:51-52`) dice "Hecho" para O2-04 y O2-06; §6-bis (`:87-88`) sigue diciendo "**Pendiente**: O2-06" y "**Pendiente**: O2-04" en la tabla de subresultados de T12-F1.

Por qué importa: el lector no puede saber si los dos contratos cerraron, y el punto 9 de cierre prohíbe pendientes contradictorios dentro del alcance.

Qué lo cerraría: actualizar la tabla de §6-bis al estado real, con la prueba que demuestra cada subresultado.

### 6. MAYOR · `antislop.md` presenta como observado en Chromium algo que solo cubre jsdom

Qué: `antislop.md:11` dice "Ejecutado sobre el build real ... en Chromium, no sobre una descripción" y presenta las 38 reglas bajo ese marco. La fila AS-R27 (`:43`) declara PASS de "vacío, carga, error con Reintentar, guardando, guardado y cambios sin guardar". El prototipo monta `EmailLayout` sin `phase` (`main.tsx:94-102`), así que nunca dibuja carga ni error; la única prueba de esos dos estados es `email-layout.client.spec.tsx:203-213`, en jsdom.

Por qué importa: la evidencia existe, pero no del modo que el informe afirma. Un estado que no se vio en el navegador no puede contarse como verificado en el navegador.

Qué lo cerraría: declarar en esa fila que la evidencia es de componente, o añadir al prototipo un selector de fase y capturarlo.

### 7. MAYOR · Escape no cierra la lectura cuando el foco está en la lista

Qué: el manejador de la lista (`email-layout.tsx:88-104`) atiende flechas, Enter y espacio, no Escape. El de la lectura (`:106-111`) está en el `<section>` de lectura (`:302`). Al abrir con Enter no se mueve el foco: queda en la opción de la lista. Un usuario de teclado que abre un correo y pulsa Escape no cierra nada.

La prueba unitaria lo tapa: `email-layout.client.spec.tsx:87` dispara el evento sobre el encabezado de la lectura, no sobre el elemento que tiene el foco.

Por qué importa: `email-surface.md:24` promete que Escape devuelve el foco al cerrar la lectura. Eso solo ocurre después de que el usuario entre con Tab a la lectura, y ninguna prueba falla si se queda roto.

Qué lo cerraría: atender Escape también en la lista (cerrar la lectura y dejar el foco en la fila seleccionada) o mover el foco a la lectura al abrir, más una prueba que dispare sobre el elemento enfocado después de abrir.

### 8. MENOR · Tres pruebas unitarias pasan por la razón equivocada

Qué: `appearance.client.spec.tsx:94-96` afirma que `document.querySelectorAll('link[rel="stylesheet"]')` está vacío; jsdom arranca vacío y nada del componente podría añadir un enlace, así que nunca falla. `:90-92` solo comprueba `not.toThrow`. `:72-76` usa `lookClassName`, que cae al literal `lookA` si el módulo CSS resuelve vacío (`appearance.ts:26-27`), que es el camino probable en jsdom; por eso no demuestra nombres reales de CSS Modules. El CSS construido sí los tiene (`._lookA_...` con las nueve variables), comprobado en `prototype/f1/dist`.

Por qué importa: el punto 7 de cierre pide controles negativos que fallen por el motivo correcto.

Qué lo cerraría: borrar los casos vacíos o mover la afirmación al lugar que sí puede fallar, dejando al navegador como dueño de los nombres de clase.

### 9. MENOR · Captura huérfana en el expediente

Qué: `f1/captures/zoom-200.png` (73.080 bytes) viene de la versión anterior del spec, que escribía ese nombre; la versión actual escribe `<look>-<tema>-zoom200.png` (`appearance-compare.e2e.ts:274`). Nada la referencia.

Por qué importa: mezcla dos corridas en la misma carpeta de evidencia y hace dudar de cuál es la vigente.

Qué lo cerraría: retirarla de `f1/captures/`.

### 10. MENOR · La regla de la versión dice una cosa y el prototipo hace otra

Qué: `conflict-resolution.md:40` resuelve "Versión: Sí, como `v3`, solo cuando hay algo que comparar". `email-layout.tsx:390` pinta siempre `v${draft.revision}` y `email-layout.client.spec.tsx:126` exige `v1` en el diálogo. La decisión de PC2 (`decisions/PC2-2026-11-17.md:40`) respalda mostrarla siempre, así que la contradicción es entre dos documentos de F1, no un defecto del código.

Por qué importa: A3 exige versión en el sobre, y el expediente de conflictos condiciona algo que la compuerta hace obligatorio. Un lector no sabe cuál manda.

Qué lo cerraría: alinear `conflict-resolution.md` con A3 y con PC2, o implementar la condición y cambiar A3.

### 11. MENOR · `todo.md` sigue marcando abiertos los seis contratos y PC2

Qué: `tasks/todo.md:49-56` mantiene `[ ]` en O2-01 a O2-06 y en el checkpoint PC2, mientras los expedientes dicen `READY_FOR_CEO` (nueve) y `pc2-look.md` dice `CLOSED`.

Por qué importa: el punto 1 de cierre exige cada check `CLOSED` con su expediente enlazado. Es contabilidad, no evidencia, pero es lo que la ola declara.

Qué lo cerraría: registrar el estado con el enlace al expediente, o declarar por escrito que las casillas esperan la firma del CEO.

## Comprobaciones que sí se sostienen

1. Las 16 capturas de la matriz existen (8 por look, claro y oscuro, tres vistas y zoom) y las 12 de la matriz coinciden una a una con `matrix.json`. Ninguna declara desbordamiento y las cuatro celdas de 390 dan `minTarget = 44`.
2. `measurements.json` tiene 24 pares, mínimo 4,70 y máximo 15,46, ninguno por debajo de 4,5. La fórmula del spec es WCAG real (luminancia relativa con umbral 0,03928 y `(L1+0,05)/(L2+0,05)`); recalculé el botón primario en claro (`coralSurface` `#A24E2C` sobre `canvas` `#EDE8DF`, tomados de `theme-palettes.ts`) y da 4,74, coherente con el 4,70 medido.
3. `look-a.module.css` y `look-b.module.css` contienen solo declaraciones `--fl-look-*`, todas resueltas a tokens existentes, sin color literal y sin redefinir `--dsw-alias-*`. Son los dos únicos archivos del repositorio que definen `--fl-look-*`, y el CSS construido los contiene aplicados a `._lookA_...` y `._lookB_...`.
4. A3: el spec compara `textContent` de los dos diálogos, exige igualdad y además exige que el snapshot contenga `proforma-2026-014.pdf`, de modo que no se comparan dos cadenas vacías (`appearance-compare.e2e.ts:280-295`). La prueba de componente comprueba Para, Copia, Copia oculta, asunto, adjuntos y `v1` dentro del diálogo.
5. A7: `appearance.ts` resuelve un valor desconocido al look por defecto, lo repara en el almacén y tolera un almacén bloqueado; las 8 pruebas de `appearance.client.spec.tsx` lo cubren, y el e2e demuestra que el look sobrevive la recarga.
6. La compuerta da 8 de 8 y el paquete 281 pruebas en verde; `tsc` y `oxlint` en 0 y `verify-client-ui-i18n` en 0 cadenas fijas.
7. No hay `.only`, `.skip`, `.todo`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `oxlint-disable` ni `v8 ignore` en los cuatro specs de F1 ni en las fuentes de F1 que revisé (`appearance.ts`, `email-layout.tsx`, `email-store.ts`, `task-chat-window.tsx`, `task-chat-store.ts`).
8. Los dos looks se ven distintos en las capturas por densidad, radio, superficie y tratamiento de etiquetas, con contenido idéntico, y el tema oscuro no rompe la lectura. El look B sigue disponible en el selector, como dice `looks.md:37`.
9. La huella de `DESIGN_MESA.md` coincide con la declarada y los diales del documento (3/5/2) son los que normaliza `conflict-resolution.md`.

## Qué NO cubre esta revisión

- T13 global, T12 global, seguridad integrada, envío, T14 y la integración con el motor de correo. El expediente los declara fuera y este informe no los abre.
- A8 (correo hostil) y A9 (actualización): no aplican a F1 y no se probaron.
- La persistencia del borrador: sigue siendo E1 y no la verifiqué.
- Los conteos de tokens (443 declarados, 119 usados, 7 sin declarar, 332 sin uso, 699 valores en píxeles, 140 fuera de escala) porque el contador es de un solo uso y no está en el repositorio (`token-map.md:82`). Solo comprobé que el spec fija exactamente los siete tokens sin declarar.
- La estimación de 10 a 18 jornadas de `adaptation-estimate.md`.
- Lectores de pantalla y zoom real del navegador: el spec usa `zoom: 2` de CSS sobre 720x450, declarado en `pc2-look.md:37`.
- La calidad estética de los looks. PC2 es una decisión del CEO; aquí solo se juzga la evidencia.
- Si la delegación registrada en `decisions/PC2-2026-11-17.md` basta para PC2. El archivo la documenta con la instrucción literal y no encontré una regla que la prohíba, así que no la reabro.
- El resto del árbol de trabajo y los cambios ajenos a F1.
