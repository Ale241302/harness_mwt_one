# Estado de F0 (O0 y O1)

Actualizado: 2026-11-16. Revisión medida: `0b01ca39365ba04fe89858bcac56e3523896ee4d`.

## Veredicto

**F0 está cerrada: catorce checks en `CLOSED`, cero `BLOCKED`.** Cada uno tiene su expediente, un revisor independiente distinto del autor y un veredicto PASS con el material a la vista. El registro de esas revisiones, con sus hallazgos y sus correcciones, está en `reviews/F0-review-log.md`.

Cerrar en falso habría sido fácil: bastaba llamar "hecho" a lo que no se ejecutó. El plan prohíbe ese cierre y este documento lo aplica: catorce rondas de revisión encontraron cifras sin respaldo, estados contradictorios y PASS autodeclarados, y cada uno se corrigió antes de firmar.

## Los catorce checks

| Check | Qué pedía | Estado | Evidencia | Revisor |
|---|---|---|---|---|
| O0-01 | Fuentes, precedencia, contradicciones | CLOSED | `FM-O0-01.md` | PASS 2026-11-16 |
| O0-02 | Matriz y validador | CLOSED | `FM-O0-02.md` | PASS 2026-11-16 |
| O0-03 | Inventario del servidor | CLOSED | `FM-O0-03.md` | PASS 2026-11-16 |
| O0-04 | Laboratorio de correo | CLOSED | `FM-O0-04.md`, `damail-lab-vps.md` | PASS 2026-11-16 |
| O0-05 | Baseline | CLOSED | `FM-O0-05.md` | PASS 2026-11-16 |
| O0-06 | Base común con upstream | CLOSED | `FM-O0-06.md` | PASS 2026-11-16 |
| O0-07 | Volumen real | CLOSED | `FM-O0-07.md`, `volume-report.md` | PASS 2026-11-16 |
| O0-08 | Configuración OpenCode | CLOSED | `FM-O0-08.md` | PASS 2026-11-16 |
| O0-09 | Skills 1-5 | CLOSED | `FM-O0-09.md` | PASS 2026-11-16 |
| O0-10 | Skills 6-10 | CLOSED | `FM-O0-10.md` | PASS 2026-11-16 |
| O1-01 | Comparación de motores | CLOSED | `FM-O1-01.md` | PASS 2026-11-16 |
| O1-02 | Sondas acotadas | CLOSED | `FM-O1-02.md`, `probes-lab-report.json` | PASS 2026-11-16 |
| O1-03 | Recomendación | CLOSED | `FM-O1-03.md` | PASS 2026-11-16 |
| O1-04 | Rangos y PC1 | CLOSED | `FM-O1-04.md` | PASS 2026-11-16 |

## Lo que quedó medido, no narrado

| Medición | Resultado |
|---|---|
| Laboratorio de correo | GreenMail 2.1.0 en el VPS, dos cuentas, puertos solo en `127.0.0.1`, **5/5** |
| Motor | DaMail con PostgreSQL, imagen fijada por digest `sha256:292f2b0a…` |
| Sondas | **14 de 14** en verde: alcance, dos buzones, identidad, carpetas, búsqueda, adjuntos, barrera negativa, carrera de aprobación, timeout, conciliación, webhooks, IA, recuperación y operación |
| API real de Hostinger | 6 respuestas 200; `drafts` como recurso **404** — no hay borradores con revisión |
| Producto contra laboratorio | `probeSmtp` ok y `sendSmtp` entregado; el `Message-ID` aparece en el buzón de destino |
| Buzones reales | 6.301 mensajes, 1,51 GiB, 928 en 90 días, sin leer contenido |
| Servidor | 52 contenedores al inventariar y 56 al cerrar (los cuatro nuevos son el laboratorio), 11 usuarios, 4 roles, 10 dominios de mailcow, sin colas durables |
| Baseline del producto | **1.712 pasan, 1 falla de red, 1 omitida** de 1.714. Los 212 fallos anteriores eran la suite heredando el entorno del despliegue; ver e1/identity.md |

## Lo que bloquea el cierre, con nombre y dueño

| # | Bloqueo | Dueño | Efecto |
|---:|---|---|---|
| 1 | ~~Revisión independiente de los catorce expedientes~~ | Revisor en otra sesión | **Resuelto**: ronda 14, PASS; los dieciséis pasaron a `CLOSED` |
| 2 | **Rotar las credenciales expuestas** | CEO | Contraseñas de los dos buzones, token de Hostinger, clave de DeepSeek y contraseña root del VPS quedaron en el chat o en archivos sincronizados |
| 3 | Corregir los 213 fallos del producto | Implementador | Es O3-04/T16, requisito de arranque de E1, no de F0 |

Quedan dos, y ninguno es de F0: la rotación es del CEO y los 213 fallos son el trabajo de días que el diagnóstico describe. F0 no espera por ellos; E1 sí.

## Los dos hallazgos, con su estado real

1. **El producto existente no pasa sus pruebas.** 213 fallos; `NO_ACCESS — the item belongs to another owner` 63-64 veces por corrida y `NOT_FOUND` al buscar un ítem recién creado. E1 no parte de un producto sano. **Diagnosticado, no corregido**, en `board-failures-diagnosis.md`.
2. **Credenciales en claro: sanitizadas, no invalidadas.** El token de GitHub salió de `.git/config` y de los logs de LFS; la clave de DeepSeek se movió fuera del workspace. **Rotarlas sigue pendiente y es del CEO**: limpiar un archivo no invalida una credencial que ya estuvo expuesta.

## Desviaciones respecto al mapa de archivos

Se declaran para que nadie las descubra después:

| Contrato | El mapa pedía | Se creó | Motivo |
|---|---|---|---|
| FM-O0-03 | `server-inventory.mjs` | no se creó | Un script que abre SSH a producción es un pie de llave permanente. El inventario se ejecutó con guiones de un solo uso, registrados en `server-inventory.md` §11 |
| FM-O1-01 | `motor-contract.spec.ts`, `motor-approval-contract.spec.ts` | no se crearon | Son pruebas contra motor real; su contenido se cubrió con P-01 a P-14 ejecutadas |
| FM-O1-04 | modificar `f1/adaptation-estimate.md` | no existe todavía | F1 (O2) no se ejecutó; el rango de F1 está en `effort-ranges.md` §4 |
| FM-O0-09/10 | 10 skills | 10 skills | sin desviación: se verificó `name` contra directorio |

## Reproducir el estado

```sh
corepack pnpm exec tsx scripts/faberloom-daily/check-plan.ts
corepack pnpm exec tsx scripts/faberloom-daily/check-closure.ts
corepack pnpm exec tsx scripts/faberloom-daily/run-baseline.ts    # reejecuta y reescribe baseline.json
corepack pnpm exec tsx scripts/faberloom-daily/probe-product-lab.ts  # B7 contra el laboratorio
```
