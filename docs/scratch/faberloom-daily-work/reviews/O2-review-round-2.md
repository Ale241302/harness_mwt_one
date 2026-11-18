# Revisión independiente · O2 (F1) · Ronda 2

- Fecha: 2026-11-17
- Alcance: O2-01 a O2-06 en su parte F1 y el gate PC2, más el mapa de cierre de `pc2-look.md` §8. Fuera: T13 global, T12 global, seguridad integrada, envío, T14 e integración con el motor.
- Revisión medida: `0e0bf42a53` (código, capturas y expedientes). HEAD de la rama `fix/guarda-operadores`: `19736dd501`. Los dos commits posteriores (`3c3ffef81f`, `19736dd501`) son solo documentación.
- Veredicto: **NEEDS_WORK**.
- Revisor: sesión distinta de la que escribió el material. Pasada de solo lectura; el único archivo escrito es este informe.

## Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git rev-parse --short HEAD` | `19736dd501` |
| `git log --oneline -3` | `19736dd501`, `3c3ffef81f`, `0e0bf42a53` |
| `git cat-file -e 0e0bf42a53:<ruta>` para `prototype/f1/main.tsx`, `appearance-compare.e2e.ts`, `captures/matrix.json`, `captures/keyboard.json`, `captures/phase-loading.png`, `captures/phase-error.png`, `f1/references.md`, `looks/look-a.module.css` | las ocho rutas existen (`True`) |
| `git diff --stat 0e0bf42a53..HEAD` | solo 10 documentos de `f1/`; `git diff --stat 0e0bf42a53..HEAD -- apps packages` sale vacío |
| `git show --stat 3c3ffef81f` y `19736dd501` | el primero toca 10 expedientes; el segundo solo `pc2-look.md` |
| `cd apps/web; corepack pnpm exec vite build --config prototype/f1/vite.config.ts` | build correcto, 38 módulos, `built in 857ms` |
| `corepack pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts` | 1 archivo, 9 pruebas, 9 pasan, `EXITCODE=0` |
| `corepack pnpm exec vitest run packages/client/ui-faberloom --project thread-safe` | 23 archivos, 281 pruebas, 281 pasan, `EXITCODE=0` |
| `vitest run` de los cuatro specs de F1 con `--reporter=verbose` | 30 pruebas: 13 `email-layout`, 7 `appearance`, 7 `task-chat-window`, 3 `appearance-tokens`; `EXITCODE=0` |
| `corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json` | `EXITCODE=0` |
| `corepack pnpm exec tsx scripts/run-oxlint.ts` sobre los cuatro archivos de F1 y los dos specs tocados | `EXITCODE=0` |
| `corepack pnpm run verify-client-ui-i18n` | `EXITCODE=0`, 686 archivos |
| Lectura de `matrix.json`, `keyboard.json`, `measurements.json` | 16 celdas (4 por vista, 4 `zoom200`), 6 paradas de teclado con 0 sin contorno, 24 pares con mínimo 4,70 y máximo 15,46 |
| `git show 0e0bf42a53:.../matrix.json`, `keyboard.json`, `measurements.json` | 16 celdas, 6 paradas, 24 pares: los artefactos de la revisión declarada coinciden con los medidos |
| Prueba directa en Chromium sobre el build, con Playwright y el servidor local del propio spec | 5 tabulaciones dejan el foco en `#email-row-r1`; Enter lo lleva a `H2#email-open-r1`; Escape lo devuelve a `#email-row-r1`; las tres paradas tienen `outline: 2px solid` |
| `git status --short` tras la corrida | solo cambian `renderedAt` y `measuredAt`; las 16 capturas y `keyboard.json` quedan byte a byte iguales |

Nota: la corrida de la compuerta reescribe `matrix.json` y `measurements.json` por diseño. El diff contra el commit es únicamente la marca de tiempo; ninguna imagen ni `keyboard.json` cambia. Eso confirma que la evidencia es reproducible. Después de documentarlo, restauré esos dos archivos a `HEAD` para no dejar rastro de mi corrida: el árbol de trabajo queda solo con este informe.

## Hallazgos

### 1. MAYOR · El mapa de cierre enlaza mal O2-01 y O2-02

Qué: `pc2-look.md:98` atribuye a `f1/references.md` "Ficha de referencias, conflicto versión/hash y diales normalizados". `references.md` no contiene diales ni la resolución del conflicto: los diales están en `design-direction.md` §2 y la normalización y el conflicto versión/hash en `conflict-resolution.md` §1 y §2. La búsqueda de `ENERGY|RHYTHM|MOTION|dial` en `references.md` da 0 coincidencias.

`pc2-look.md:99` atribuye a `f1/token-map.md` y `f1/design-direction.md` "Inventario de tokens, tres variables sin declaración y adaptación estimada". La estimación no está en `design-direction.md`: vive en `f1/adaptation-estimate.md`, que no aparece en ninguna fila del mapa (0 coincidencias de `adaptation-estimate` en `pc2-look.md`). Además `token-map.md:22` documenta siete tokens usados y no declarados, no tres.

Por qué importa: `tasks/todo.md` está congelado por `plan-manifest.json`, así que este mapa es el registro de cierre que exige el punto 1 de `faberloom-close-wave` ("cada check CLOSED con su expediente enlazado"). Dos de las seis filas apuntan a un archivo que no contiene lo que la fila dice, y uno de los seis entregables de la ola (`adaptation-estimate.md`) queda fuera del mapa. El problema no es de producto: es el artefacto que se leerá como prueba del cierre.

Qué lo cerraría: corregir las dos filas. Por ejemplo O2-01 con `references.md`, `design-direction.md` y `conflict-resolution.md`; O2-02 con `token-map.md` y `adaptation-estimate.md`, y decir "siete tokens sin declarar" en lugar de tres. No requiere volver a medir nada.

### 2. MENOR · El recorrido de teclado dice 12 paradas y el archivo tiene 6

Qué: `pc2-look.md:67` dice "Recorrido de 12 tabulaciones registrado en `f1/captures/keyboard.json`". El archivo tiene 6 paradas: los cuatro controles de la barra (Cambiar look, filtro, Nueva, Lista y lectura), la opción de la lista y el botón Iterar. Son las 6 paradas reales del orden de tabulación de la pantalla inicial, y el test corta al llegar a `BODY` (`appearance-compare.e2e.ts:279`).

Por qué importa: es un conteo que no coincide con el archivo que se cita, el mismo tipo de defecto que las rondas de F0 registraron. La sustancia es correcta y de hecho el registro es completo; la frase lo describe mal.

Qué lo cerraría: "Recorrido de teclado registrado en `keyboard.json`: seis paradas, la lista una sola vez, todas con contorno".

### 3. MENOR · `looks.md` sigue citando una prueba que ya no existe

Qué: `looks.md:62` cierra la lista de cobertura con "y cero hojas de estilo externas". Esa prueba se retiró en `0e0bf42a53` (era vacía en jsdom) y no hay ningún otro test que la cubra: la búsqueda de `stylesheet` en los specs de F1 solo devuelve un comentario y una prueba de `safe-email` que no mide eso.

Por qué importa: un lector cree que existe una comprobación que no existe. No afecta al gate, pero es una cita falsa dentro de la evidencia.

Qué lo cerraría: quitar esa cláusula de la frase, o añadir una prueba real que mida la ausencia de hojas externas.

### 4. MENOR · La fórmula de AS-R03 está invertida

Qué: `antislop.md:19` dice "Las 16 celdas sin desbordamiento (`scrollWidth === clientWidth + 1`)". El código considera desbordamiento cuando `scrollWidth > clientWidth + 1` (`appearance-compare.e2e.ts:174-175` y `:339-340`); en una celda que pasa, `scrollWidth` es igual a `clientWidth`, no a `clientWidth + 1`.

Por qué importa: es la condición de la evidencia escrita al revés. Un lector que la copie comprobaría otra cosa.

Qué lo cerraría: "`scrollWidth` no supera `clientWidth + 1`".

### 5. MENOR · Las 16 filas de `matrix.json` dependen del orden de las pruebas del archivo

Qué: el test de zoom lee `matrix.json`, descarta las filas `zoom200` y reescribe el archivo con las de viewport más las cuatro de zoom (`appearance-compare.e2e.ts:351-359`). Si alguien ejecuta solo esa prueba (`-t "200 %"`), el archivo queda con 4 filas y la prueba pasa igual, porque solo afirma `expect(zoomCells).toHaveLength(4)`.

Por qué importa: hoy la corrida completa produce 16 filas y lo verifiqué, pero el artefacto puede degradarse en silencio con un comando parcial, que es justo lo que pasó en la ronda 1.

Qué lo cerraría: que el test de zoom exija 12 filas de viewport antes de reescribir, o que las 16 celdas se acumulen en memoria dentro de la misma corrida.

## Observaciones no bloqueantes

- En `phase-loading.png` y `phase-error.png` sigue visible el botón "Iterar sobre este correo" aunque no haya ningún mensaje cargado. Es un artefacto de montar `TaskChatWindow` fuera de la superficie en `main.tsx`, no una promesa de F1, pero conviene esconderlo cuando la fase no es `ready`: un control que actúa sobre un correo inexistente es una incoherencia de estado.
- La aserción del navegador para Enter comprueba que el elemento enfocado contiene `Proforma 2026-014`, texto que también está en la opción, así que por sí sola no distingue título de fila. La conducta real es correcta: la comprobé directamente en Chromium y el foco cae en `H2#email-open-r1`, y la prueba de jsdom afirma identidad exacta con el encabezado. No pido cambio, solo lo dejo escrito para que la aserción no se lea como más fuerte de lo que es.

## Las correcciones de la ronda 1, verificadas

1. **Revisión.** Los diez expedientes y `pc2-look.md` citan `0e0bf42a53`; esa revisión contiene el prototipo, el spec, las 16 capturas, `matrix.json`, `keyboard.json` y las dos capturas de fase. Los dos commits posteriores no tocan código.
2. **16 celdas.** `matrix.json` tiene 16 filas, cuatro con `view: "zoom200"`; las 16 capturas existen y coinciden con su fila; ninguna declara desbordamiento. El zoom comprueba contenido, desbordamiento y consola. La prosa limita los 44 px a 390, como el código.
3. **Teclado y foco.** `keyboard.json` registra 6 paradas con `inList` y `ring`; la lista aparece una vez y las 6 tienen contorno medido. Enter lleva el foco al título y Escape lo devuelve a la fila, comprobado en Chromium por esta revisión; el componente cierra la lectura desde la lista y la prueba de jsdom lo cubre.
4. **Conteos.** 13 pruebas de layout, 7 de apariencia, 7 de la ventana, 281 en 23 archivos, 686 archivos de i18n: todos reproducidos.
5. **Contradicción de `email-surface.md`.** §5 y §6-bis ya coinciden y remiten a `iteration-window.md` y `looks.md`.
6. **AS-R27.** El prototipo acepta `?phase=loading|error`; las dos capturas son reales y la prueba exige título, `aria-busy` y el botón Reintentar. La tabla distingue navegador de jsdom.
7. **Escape y Enter en la lista.** Implementados y probados; la conducta se verificó en navegador, no solo en jsdom.
8. **Pruebas vacías.** Las tres se sustituyeron por normalización de clases, idempotencia y ausencia de estilos en línea; ya pueden fallar por el motivo correcto.
9. **Captura huérfana.** `zoom-200.png` no existe; quedan las 16 de la matriz y las dos de fase.
10. **Regla de versión.** `conflict-resolution.md:40` dice "siempre", alineado con el panel y con PC2.
11. **`todo.md`.** La huella SHA256 y el tamaño coinciden con `plan-manifest.json` (`23BB65...`, 25909 bytes). Reescribirlo rompería un artefacto congelado. Acepto el criterio, con una condición: el cierre de O2 tiene que quedar escrito donde F0 lo dejó, es decir, en los expedientes o en un estado de ola con revisor, porque el mapa de §8 hoy no marca estado por contrato y tiene los enlaces del hallazgo 1.

## Qué NO cubre esta revisión

- T13 global, T12 global, seguridad integrada, envío, actualización (T14), integración con el motor y persistencia del borrador. Siguen fuera y así están declarados.
- A8 y A9: no aplican a F1 y no se probaron.
- Los conteos de tokens de `token-map.md` §1 y §4 (443, 119, 332, 699, 140): el contador es de un solo uso y no está en el repositorio. Solo comprobé que el spec fija los siete tokens sin declarar.
- La estimación de 10 a 18 jornadas de `adaptation-estimate.md`.
- Lectores de pantalla y zoom de navegador real: el spec usa `zoom: 2` de CSS, declarado en `pc2-look.md:37`.
- La calidad estética de los looks y la delegación de PC2, que no reabro.
- El resto del árbol y los cambios ajenos a F1.
