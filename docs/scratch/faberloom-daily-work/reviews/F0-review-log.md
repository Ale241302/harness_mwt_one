# Registro de revisiones independientes de F0

Cada entrada es una sesión distinta de la que escribió el material: agente `reality-checker`, sin permiso de edición, con acceso a shell y al servidor. Un veredicto `NEEDS_WORK` no se borra cuando se corrige: queda con los hallazgos y la lista de lo que se cambió.

## Ronda 1 · 2026-11-16 · herramientas y validador

- Alcance: `check-plan.ts`, `check-closure.ts`, `requirements.json`, las 76 pruebas de los guiones.
- Veredicto: **NEEDS_WORK**. Hallazgos: dos bloqueantes (routing de `check-plan` y conteo de pruebas) y seis defectos menores.
- Corrección: se ajustaron los guiones y se añadieron pruebas de rechazo.

## Ronda 2 · 2026-11-16 · evidencia documental

- Alcance: los expedientes de O0 y O1 y su coherencia con `f0-status.md`.
- Veredicto: **NEEDS_WORK**. Hallazgos: cifras que no cuadraban entre documentos y un estado `CLOSED` sin revisor.
- Corrección: se corrigieron las cifras y se retiró el cierre sin revisor.

## Rondas 3 a 6 · 2026-11-16 · correcciones sucesivas

- Alcance: cada tanda de correcciones de la ronda anterior.
- Veredicto: **NEEDS_WORK** en las rondas 3 a 6; **PASS** al cierre de la serie sobre la capa de herramientas, la evidencia documental y las correcciones.
- Aprendizaje registrado: el fallo repetido era de conteo (pasadas, autorizaciones, carpetas), no de sustancia. Se eliminaron los conteos que podían quedar obsoletos.

## Ronda 7 · 2026-11-16 · laboratorio en el VPS y sondas

- Alcance: `FM-O1-02.md`, `damail-lab-vps.md`, `FM-O0-04.md`, `verification-register.md`, `probes-lab-report.json`, `P-15-hostinger-api.md`, el compose y los puertos del servidor.
- Verificado en vivo: `verify.py` 5/5; los cinco puertos solo en `127.0.0.1`; digest del compose igual al de la imagen corriendo; 14/14 sondas en el JSON; cifras de respaldo y de reintentos.
- Veredicto: **NEEDS_WORK**. Hallazgos:
  1. `FM-O1-02.md` citaba un adjunto de 6.348 bytes; el informe dice 3.656.
  2. El JSON consolidado no incluía la evidencia de adjunto de P-06 (la sobrescribía otra corrida).
  3. P-03 comparaba dos `messageId` nulos: el listado no los expone.
  4. `P-15-hostinger-api.md` seguía en `BLOCKED` y decía que faltaban catorce sondas.
  5. `P-15` decía "5 operaciones 200" cuando son 6.
- Corrección: cifra corregida; consolidación reescrita para quedarse con la evidencia más completa; P-03 remedida leyendo el detalle de cada ocurrencia; P-15 actualizado.

## Ronda 8 · 2026-11-16 · baseline, inventario y estados

- Alcance: `FM-O0-05.md`, `FM-O0-03.md`, `FM-O0-07.md`, `FM-O1-01.md`, `FM-O1-03.md`, `f0-status.md`, `baseline.json`.
- Verificado en vivo: dominios de mailcow, aritmética del volumen, 76 pruebas, `check-plan` PASS.
- Veredicto: **NEEDS_WORK**. Hallazgos:
  1. Siete expedientes decían `Veredicto: PASS` y a la vez "falta revisión independiente".
  2. `P-15-hostinger-api.md` contradecía el estado global con un `BLOCKED` vivo.
  3. `baseline.json` B4 era un PASS que ya no se reproduce (el conjunto de evidencia creció).
  4. B1 decía 64, 75 y 76 pruebas según el documento.
  5. El inventario decía 52 contenedores y el servidor tiene 56 desde que existe el laboratorio.
- Corrección: estados unificados con este registro; el baseline queda **pendiente de reejecutar** al cierre (se declara aquí, no se da por hecho); cifras de contenedores reconciliadas.

## Ronda 9 · 2026-11-16 · registro de firma

- Alcance: el registro de revisiones y el estado de los dieciséis expedientes.
- Veredicto: **NEEDS_WORK**. Hallazgo: el registro decía "los siete expedientes de O0" cuando O0 tiene diez, y los expedientes revisados recuperaron su `Revisor: pendiente`.
- Corrección: el PASS por expediente se retiró hasta que existiera de verdad; esta ronda no firmó ningún archivo y así quedó escrito.

## Ronda 10 · 2026-11-16 · cierre del material

- Alcance: los hallazgos de la ronda 9 y la coherencia del conjunto.
- Veredicto: **NEEDS_WORK**. Hallazgos: un PASS por expediente que esta ronda no había firmado, una limitación duplicada en `FM-O1-01.md`, nueve expedientes sin remisión al registro y un conteo mal escrito en este mismo documento.
- Corrección: se retiraron todos los PASS autodeclarados —los expedientes volvieron a `Revisor: pendiente`—, se unificó la remisión y se corrigió el conteo.

## Ronda 11 · 2026-11-16 · evidencia de sondas

- Alcance: qué cifras del informe pueden respaldarse con el JSON crudo.
- Veredicto: **NEEDS_WORK**. Hallazgos: P-13 afirmaba "no reenvía" sin medirlo, el registro citaba cinco operaciones donde hay seis, y P-06 mezclaba dos corridas.
- Corrección: P-13 se remedió con antes/después y conteo de envíos en el log; P-06 se midió entero en una corrida; la consolidación pasó a quedarse con la última corrida de cada sonda, sin mezclar.

## Ronda 12 · 2026-11-16 · claves viejas en la evidencia

- Alcance: claves que sobrevivían de corridas anteriores dentro del JSON consolidado.
- Veredicto: **NEEDS_WORK**. Hallazgo: la regla de "rellenar claves ausentes" conservaba `rows` con `messageId` nulo, `estado: queued` junto a `estado_final: failed` y los conteos viejos de P-13.
- Corrección: se eliminó el relleno. Una sonda, una corrida. P-09 se remedió para registrar que el motor deja `lastError` nulo y el error solo en el log.

## Ronda 13 · 2026-11-16 · firma

- Alcance: el material completo.
- Veredicto: **NEEDS_WORK**. Hallazgo: `FM-O1-02.md` citaba el prefijo de un `sha256` que cambia en cada corrida y no existía en la evidencia vigente.
- Corrección: los documentos ya no citan hashes ni cifras que cambian por corrida; citan la clave del JSON.

## Ronda 14 · 2026-11-16 · firma

- Alcance: el cambio único de la ronda 13 y su arrastre.
- Veredicto: **PASS**. «Firmable». Verificado: sin prefijos de hash en los documentos, 3.656 bytes respaldados por `bytes_enviado` y `bytes_recibido`, y `sha256_enviado == sha256_recibido` con el método declarado (IMAP en el destino, no la respuesta del envío).

Con este PASS se escribió `CLOSED` en los dieciséis expedientes.

## Qué prueba este registro y qué no

Prueba que cada veredicto lo emitió una sesión sin permiso de escritura, con el alcance declarado y los hallazgos convertidos en correcciones. No prueba que el material sea correcto: para eso están los comandos de cada expediente y la ronda siguiente.
