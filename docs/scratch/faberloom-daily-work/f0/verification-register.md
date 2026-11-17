# Registro de verificaciones de O1

Contrato: C-FL-03 / O1-03 / FM-O1-03 Regla: una fila sin evidencia no se marca "no soportado". Se marca **no verificado**.

## 1. Estado de las sondas

Quince filas ejecutadas el 2026-11-16: catorce en el laboratorio del VPS y una contra la API real de Hostinger. Informe crudo de las **catorce sondas del laboratorio**: `evidence/O1/probes-lab-report.json`. P-15 se mide contra la API real y su evidencia vive en `evidence/O1/P-15-hostinger-api.md`.

| ID | Ensayo | Qué prueba | Resultado |
|---|---|---|---|
| P-01 | Alcance de credencial | Clave con `accountIds:[1]`: 6 propios, 0 de B, borrador para B 404 | PASS |
| P-02 | Dos buzones | Cuerpo y asunto correctos por cuenta, sin mezcla | PASS |
| P-03 | Identidad | Mismo `Message-ID` en dos cuentas: 2 filas, 2 ids, 1 `Message-ID` | PASS |
| P-04 | Carpetas y restauración | Borrar fuera de Trash rechazado (400); Trash, restaurar y borrado definitivo | PASS |
| P-05 | Búsqueda y límites | Marcador único encontrado; inexistente devuelve 0 | PASS |
| P-06 | Borrador y adjuntos | To/Cc/Bcc y cuerpo idénticos; adjunto con el mismo `sha256` en destino | PASS |
| P-07 | Barrera negativa | Sin aprobación no hay envío y el borrador sigue en `draft` | PASS |
| P-08 | Carrera de aprobación | Cambiar el cuerpo invalida la versión aprobada (`409`) | PASS |
| P-09 | Timeout | 3 intentos con esperas de 60 s y 120 s; estado `failed` | PASS |
| P-10 | Conciliación | Aceptación (`queued`) distinguible de entrega verificada | PASS |
| P-11 | Webhooks | Firma HMAC verificada y 2 entregas | PASS |
| P-12 | IA y destinos | Sin proveedor, búsqueda semántica rechazada, cero TLS saliente | PASS |
| P-13 | Recuperación | Reinicio conserva mensajes y borradores y no reenvía | PASS |
| P-14 | Operación | Digest fijado, respaldo restaurado en base limpia | PASS |
| P-15 | Hostinger real | 6 respuestas 200; `drafts` como recurso 404 | PASS |

## 2. Verificaciones que no necesitaban laboratorio

| # | Verificación | Resultado |
|---|---|---|
| V-01 | Qué dominio y qué buzones sirve mailcow | Diez dominios; **no** sirve `muitowork.com` |
| V-02 | Si los dos buzones del piloto están en mailcow o en Hostinger | Están en `imap.hostinger.com` |
| V-03 | Si el MCP de Hostinger puede restringirse por buzón | No verificado: exige token con alcance acotado y no hay |
| V-04 | Si DaMail admite dos buzones sin mezclar lectura | Sí: P-01, P-02 y P-03 |
| V-05 | Cuánto ocupa DaMail en disco y memoria en este host | Medido en P-14 (`docker stats` y respaldo de 133 kB) |

## 3. Regla de cierre de O1

`O1-02` se cierra con estas quince filas y su revisión independiente. `O1-03` queda en `READY_FOR_CEO` con la recomendación condicional. `O1-04` y PC1 exigen los rangos de `effort-ranges.md` y la firma del CEO, que ya existe.
