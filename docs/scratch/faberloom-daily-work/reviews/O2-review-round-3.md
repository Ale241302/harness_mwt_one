# Revisión independiente · O2 (F1) · Ronda 3

- Fecha: 2026-11-17
- Alcance: O2-01 a O2-06 en su parte F1, el gate PC2 y el mapa de cierre de `pc2-look.md` §8. Fuera: T13 global, T12 global, seguridad integrada, envío, actualización (T14), integración con el motor y persistencia del borrador.
- Revisión medida: `71191a400a`. HEAD de `fix/guarda-operadores`: `1784767d02`.
- Veredicto: **PASS**.
- Revisor: sesión distinta de la que escribió el material. Pasada de solo lectura; el único archivo escrito es este informe.

## Frase firmable

> PASS de la revisión independiente sobre la revisión `71191a400a`, alcance F1: O2-01 a O2-06 y el gate PC2, con la evidencia de `docs/scratch/faberloom-daily-work/f1/` y la revisión `docs/scratch/faberloom-daily-work/reviews/O2-review-round-3.md`. No cierra T12 ni T13 globales, ni la seguridad integrada, el envío o la actualización (T14).

Con esta frase se puede escribir `CLOSED` en `pc2-look.md` §8 y en los seis contratos, y sustituir `Revisor: pendiente` por `PASS 2026-11-17 · O2-review-round-3`. La evidencia es la de `71191a400a`; las notas de cierre posteriores no cambian lo medido.

## Comandos ejecutados y resultado

| Comando | Resultado |
|---|---|
| `git rev-parse --short HEAD` | `1784767d02` |
| `git log --oneline -4` | `1784767d02`, `71191a400a`, `19736dd501`, `3c3ffef81f` |
| `git cat-file -e 71191a400a:apps/web/tests/appearance-compare.e2e.ts` | la ruta existe |
| `git show 71191a400a --stat` | código, capturas y expedientes: `main.tsx`, el spec, `matrix.json`, `measurements.json`, las dos capturas de fase, `antislop.md`, `looks.md`, `pc2-look.md` y la ronda 2 |
| `git show 1784767d02 --stat` | solo los 10 documentos de `f1/`, 10 inserciones y 10 borrados: el campo `Revisión` |
| `git diff --stat 71191a400a..HEAD -- apps packages` | 0 archivos: ningún cambio de código entre la revisión medida y HEAD |
| `git diff --stat 71191a400a..HEAD` | solo los 10 documentos; nada más |
| `cd apps/web; corepack pnpm exec vite build --config prototype/f1/vite.config.ts` | `BUILD=0`, 38 módulos, `built in 1.03s` |
| `corepack pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts` | 1 archivo, **8 pruebas, 8 pasan**, `EXITCODE=0` |
| `corepack pnpm exec vitest run packages/client/ui-faberloom --project thread-safe` | 23 archivos, **281 pruebas, 281 pasan**, `EXITCODE=0` |
| `corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json` | `TSC=0` |
| `corepack pnpm exec tsx scripts/run-oxlint.ts` sobre el spec, `main.tsx` y `email-layout.tsx` | `OXLINT=0` |
| `corepack pnpm run verify-client-ui-i18n` | `I18N=0`, 686 archivos |
| Lectura de `matrix.json`, `keyboard.json`, `measurements.json` | 16 celdas (4 `zoom200`), 0 desbordamientos, 6 paradas con 0 sin contorno y la lista una sola vez, 24 pares con mínimo 4,70 y máximo 15,46 |
| `git show 71191a400a:.../matrix.json`, `keyboard.json` | 16 celdas (4 de zoom) y 6 paradas: los artefactos de la revisión declarada coinciden con lo medido |
| Prueba directa en Chromium de las cuatro celdas de zoom sobre el build | `scrollWidth = clientWidth = 720`, delta 0 en las cuatro |
| `git status --short` tras la corrida | solo cambian `renderedAt` y `measuredAt`; las 16 capturas, las 2 de fase y `keyboard.json` quedan byte a byte iguales |
| `Get-FileHash` de `tasks/todo.md` | `23BB65...`, 25909 bytes, igual que `plan-manifest.json` |

La corrida reescribe `matrix.json` y `measurements.json` por diseño. El diff contra el commit es únicamente la marca de tiempo; después de documentarlo restauré ambos archivos a `HEAD`. El árbol queda solo con este informe.

## Hallazgos

**Ninguno.** Cero hallazgos abiertos en el alcance de F1. Lo que sigue es lo que comprobé para poder afirmarlo.

### Los cinco puntos de la ronda 2

1. **Mapa de cierre.** `pc2-look.md:98` enlaza `references.md` y `conflict-resolution.md`, y la fila describe los diales normalizados y la decisión sobre versión y huella: `conflict-resolution.md` §1 y §2 contienen exactamente eso. `pc2-look.md:99` enlaza `token-map.md`, `design-direction.md` y `adaptation-estimate.md`, dice "443 tokens con siete usados sin declarar (el plan decía tres; se declaran los siete)", y los tres archivos contienen el inventario, la dirección y la estimación. `pc2-look.md:101` deja O2-04 en `looks.md` y remite a `conflict-resolution.md` §4 para el diff, que es donde está. Ningún entregable queda huérfano.
2. **Seis paradas.** `pc2-look.md:67` dice "recorrido completo del orden real (seis paradas)" y `keyboard.json` tiene 6: Cambiar look, filtro, Nueva, Lista y lectura, la opción de la lista y el botón Iterar. La lista aparece una sola vez y las 6 tienen contorno.
3. **Hojas de estilo.** `looks.md:62` enumera normalización de clases, clases estables, ausencia de estilos en línea e idempotencia; ya no cita hojas externas, y ninguna frase del expediente afirma una prueba que no exista.
4. **Desbordamiento.** `antislop.md:19` dice "`scrollWidth` no supera `clientWidth + 1`". El código marca desbordamiento con `scrollWidth > clientWidth + 1` en las 12 celdas de viewport y con `> clientWidth + 2` en las 4 de zoom; medí las cuatro de zoom directamente y el delta es 0, así que la frase es cierta para las 16.
5. **Matriz en una sola prueba.** `appearance-compare.e2e.ts:163-218` produce las 12 celdas de viewport y las 4 de zoom en el mismo `it`, escribe `matrix.json` y afirma `toHaveLength(16)` y 4 de zoom. El test separado de zoom ya no existe: la lista de `it` tiene 8 entradas y ninguna es de zoom. La compuerta pasa de 9 a 8 pruebas, y `pc2-look.md:24` y `antislop.md:11` dicen 8 de 8.

### Las dos observaciones

- Las capturas de fase ya no muestran la ventana de iteración: `main.tsx:109` monta `TaskChatWindow` solo con `phase === 'ready'`. `phase-loading.png` y `phase-error.png` muestran únicamente la superficie, su título y, en el error, Reintentar.
- La aserción de Enter comprueba `H2:email-open-r1` (`appearance-compare.e2e.ts:312-315`), es decir el elemento con foco, no texto que la fila también contiene. La corrida la ejecutó y pasó.

### Lo que ya estaba verificado y se mantiene

- Revisión: los diez documentos citan `71191a400a`; esa revisión contiene el prototipo, el spec, las 16 capturas, `matrix.json`, `keyboard.json` y las capturas de fase. `1784767d02` es solo documentación.
- 16 celdas: cuatro por vista (1440x900, 1024x768, 390x844 y zoom 200 %), todas las capturas existen y coinciden con su fila, 0 desbordamientos. En 390 los botones miden 44 px o más.
- Contraste: 24 pares, mínimo 4,70 (botón primario) y máximo 15,46, todos por encima de 4,5; la fórmula es WCAG real.
- A3: el panel muestra el mismo `textContent` en los dos looks y el snapshot contiene el adjunto, así que no se comparan cadenas vacías.
- A7: el look sobrevive la recarga y un valor inválido se repara al look por defecto en `appearance.ts`, con 7 pruebas.
- Los dos looks solo declaran `--fl-look-*` sin color literal y son los únicos archivos que los definen; el CSS construido los aplica.
- Estados: carga y error se ven en Chromium, con `aria-busy` y Reintentar según la fase.
- Conteos: 13 pruebas de layout, 7 de apariencia, 7 de ventana, 281 en 23 archivos y 686 archivos de i18n, todos reproducidos.
- No hay `.only`, `.skip`, `.todo`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `oxlint-disable` ni `v8 ignore` en los specs ni en el ámbito de F1.
- `tasks/todo.md` conserva la huella de `plan-manifest.json`; el cierre se registra en el mapa de §8 y en `reviews/`, como en F0.

## Qué NO cubre esta revisión

- T13 global, T12 global, seguridad integrada, envío, actualización (T14), integración con el motor y persistencia del borrador. Quedan fuera por diseño y así están declarados.
- A8 (correo hostil) y A9 (actualización): no aplican a F1 y no se probaron.
- Los conteos de tokens de `token-map.md` §1 y §4 (443, 119, 332, 699, 140): el contador es de un solo uso y no está en el repositorio. Solo comprobé que el spec de tokens fija exactamente los siete sin declarar.
- La estimación de 10 a 18 jornadas de `adaptation-estimate.md`.
- Lectores de pantalla, navegadores distintos de Chromium y zoom de navegador real: el spec usa `zoom: 2` de CSS sobre 720x450, declarado en `pc2-look.md:37`.
- La calidad estética de los looks y la delegación de PC2, que no reabro.
- El resto del árbol y los cambios ajenos a F1.
