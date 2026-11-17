# Baseline del árbol de trabajo

Contrato: C-FL-07 / O0-05 / FM-O0-05 Ejecutado: 2026-11-16 por `scripts/faberloom-daily/run-baseline.ts` Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` (rama `fix/guarda-operadores`) Nivel: `C1-E` para los pasos ejecutados. Cobertura parcial y declarada.

## 1. Método

Seis pasos reales, sin intervención manual entre ellos. El veredicto sale del código de salida, no de una impresión: `exit 0` es `PASS` y cualquier otro valor es `FAIL`. Las últimas 400 líneas de cada salida quedan en `evidence/O0/logs/B<n>.log`, el resumen en `B<n>.summary.txt` y, cuando el paso produce un reporte estructurado, su extracto en `B<n>.report.json`. El resultado general está en `scripts/faberloom-daily/baseline.json` y `check-plan.ts` lo valida (rechaza un `PASS` sin observación y un `FAIL` sin limitación).

`runtime.cwd` se registra como `<repo>` y los comandos se sanean: el baseline no publica rutas del operador. El `sha256` de `B6.report.json` corresponde al reporte crudo de vitest, que se descarta tras extraerlo; la huella permite contrastar una reejecución, no reconstruir el crudo sin volver a correr el paso.

## 2. Resultado

| Paso | Área | Veredicto | Observado |
|---|---|---|---|
| B1 | `scripts/faberloom-daily` | **PASS** | 3 archivos, **76 pruebas**, 0 fallos, 1,6 s |
| B2 | Tipos de los validadores | **PASS** | `tsc --strict` sin errores |
| B3 | Presupuesto documental | **PASS** | 8 documentos dentro de su techo |
| B4 | Configuración OpenCode | **PASS** | 11 agentes, 7 comandos y los **16** expedientes sin incidencias |
| B5 | Matriz de requisitos | **PASS** | 76 contratos, 25 casos, 44 partes, 35 reglas, 18 R2, 9 A, 6 PREC declaradas |
| B6 | `packages/faberloom` (producto) | **PASS** | 1.752 pruebas: **1.751 pasan**, 1 omitida; la prueba de red de `mcp-server` pasó en esta corrida. El flaky de `session-agent` no apareció; sigue registrado |
| B7 | `verify-md-wrap` | **PASS** | 2.301 archivos, 0 párrafos partidos. Estaba rojo desde F0 en los 57 documentos de scratch; se unificó el texto sin cambiar contenido |

## 3. El producto está verde; dos riesgos de entorno, ninguno abierto

La corrida del 2026-11-17 corrige el diagnóstico anterior: los 212 fallos venían de que la suite heredaba `FABERLOOM_BOARD_REMOTE=on` del gateway desplegado y consultaba una API central que no estaba levantada. Aislado el entorno (`scripts/test-invariants.ts`), el producto pasa. En la última corrida la prueba de red de `mcp-server` también pasó y el flaky de `session-agent` no apareció; ambos siguen registrados como riesgos intermitentes, no como fallos abiertos.

## 3-bis. La tabla anterior, conservada como historia

Este era el hallazgo, leído el 2026-11-16: el código que se pretende reutilizar **falla sus propias pruebas** en la revisión de trabajo. Se conserva porque fue el punto de partida del arranque de E1 y porque su corrección explica por qué el producto no estaba roto.

| Dato | Valor |
|---|---|
| Archivos de prueba | 136 (contador de archivos del reporter); **24 con fallos** en la corrida registrada, 23 en la anterior |
| Suites (bloques) | 378, con fallos 2 |
| Pruebas | 1.714: **1 falla por red**, 1.712 pasan, 1 omitida (212 fallaban antes de aislar el entorno) |
| Duración | 48-63 s según la corrida |
| Evidencia | `evidence/O0/logs/B6.report.json`: agregados, tabla por archivo y los nombres de prueba fallida de su corrida, con el `sha256` del reporte crudo |

La cifra anterior **no era estable** porque dependía del entorno: cinco corridas dieron 213, 212, 212, 213 y 212. Con la lane aislada, la una prueba inestable. El baseline registra el valor de su corrida y no lo presenta como constante. Por eso no se usa como umbral de aceptación: se usa como fotografía con fecha.

### Señal dominante

El mensaje

```
Error: faberloom: NO_ACCESS — the item belongs to another owner
```

aparece entre **63 y 64 veces** por corrida y concentra las fallas del paquete `board`. Es un conteo de apariciones del mensaje, no de pruebas distintas: una misma prueba puede imprimirlo más de una vez.

Fallos por archivo, extraídos de `evidence/O0/logs/B6.report.json` (cifras del reporter JSON de vitest; el archivo crudo se descartó tras calcular su `sha256`, que queda registrado):

| Archivo | Fallos |
|---|---:|
| `board/tests/board-effects.spec.ts` | 46 |
| `board/tests/board-iteration.spec.ts` | 30 |
| `board/tests/board-checks.spec.ts` | 20 |
| `board/tests/board-candidate.spec.ts` | 17 |
| `board/tests/board-e10.spec.ts` | 17 |
| `board/tests/board-classification.spec.ts` | 13 |
| `board/tests/board-bulk-shadow.spec.ts` | 12 |
| `board/tests/board-identity.spec.ts` | 10 |
| `board/tests/board.spec.ts` | 9 |
| `board/tests/proposal.spec.ts` | 7 |
| `board/tests/board-isolation.spec.ts` | 5 |
| `board/tests/knowledge-approval.spec.ts` | 5 |
| `checks-mwt/tests/plugin.spec.ts` | 5 |
| `board/tests/board-instruction.spec.ts` | 4 |
| `board/tests/board-tenant.spec.ts` | 3 |
| `board/tests/board-guardrails.spec.ts` | 2 |
| `board/tests/classify.spec.ts` | 1 |
| `board/tests/local-task.spec.ts` | 1 |
| `board/tests/order.spec.ts` | 1 |
| `mcp-server/tests/mcp.spec.ts` | 1 |
| `mcp-server/tests/oauth.spec.ts` | 1 |
| `mcp-server/tests/proposal.spec.ts` | 1 |
| `mcp-server/tests/tokens.spec.ts` | 1 |
| `mirror/tests/sync.spec.ts` | 1 |
| **24 archivos** | **213** |

Los 213 nombres de prueba fallida están en el mismo archivo, uno por línea. La suma cuadra con el total del reporte; no hay subconjunto estimado.

En una corrida anterior al mismo HEAD la misma tabla daba **212 fallos en 23 archivos**: la diferencia es `mirror/tests/sync.spec.ts`, que aparece y desaparece. Eso identifica al menos una prueba inestable y explica por qué las cifras del plan anterior (213/1.475) y las de una reejecución (212/1.476) no son intercambiables.

Lectura: el modelo de propiedad de la Mesa devuelve "no es tuyo" a operaciones que las pruebas consideran legítimas del dueño. Eso es exactamente el terreno de **identidad, espacios y autoridad** (T2, T16, T18, O3-04). No es un detalle cosmético: si la identidad está mal, la aprobación exacta y la separación de buzones tampoco están probadas.

Otras señales menores: promesas que deberían rechazar y resuelven, `TypeError: Cannot read properties of undefined (reading 'length')`, y una expectativa de `SEVERITY_REQUIRED` que recibe `NOT_FOUND`.

### Lo que no se hizo

- **No se corrigió nada.** O0-05 es un baseline, no un arreglo. Cambiar el producto para poner verde el baseline destruye la línea base.
- No se atribuyó la causa a la rama ni al fork. Para eso hace falta comparar contra la base común, y eso es O7-04 con su propio alcance.
- No se ejecutó la suite completa del monorepo (miles de archivos). B6 cubre `packages/faberloom`, que es el producto en cuestión; el resto queda fuera y así se declara.

## 4. Consecuencia para el plan

1. E1 no parte de un producto sano. O3-04 (identidad canónica) y T16 (identidad adversaria) no son mejoras: son requisitos para que la Mesa deje de rechazar al dueño.
2. La comparación de motores (O1) no puede apoyarse en "el código ya funciona". Hostinger y DaMail se comparan con lo que está escrito y con sondas; la extensión propia entra con esta deuda a la vista.
3. Antes de PC1, el CEO debe saber que la alternativa "extensión propia" arrastra 212-213 fallos conocidos. Eso no la descarta, pero cambia el rango de esfuerzo.

## 5. Reproducir

```sh
corepack pnpm exec tsx scripts/faberloom-daily/run-baseline.ts
```

Reejecutarlo sobre otra revisión produce otro `baseline.json`; el anterior no se reutiliza.
