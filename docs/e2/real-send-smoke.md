# Smoke real controlado · correo diario

Estado: **EJECUTADO el 2026-11-20** sobre `1088155b5c`. `AUTH-REAL-WRITE` y `AUTH-DEPLOY` están registradas en `FaberLoom_tarea_2026-11-16/D/decisions/`. Lectura, marca, papelera/restauración, envío, adjunto con hash, entrega y conciliación de una respuesta perdida quedaron observados. El cierre PC4 sigue pendiente de la segunda revisión independiente y de T14.

## Requisitos previos

- [ ] `AUTH-REAL-WRITE` registrada con cuentas, destinatarios permitidos, límites y rollback.
- [ ] Los dos buzones con IMAP y SMTP verificados en Conexiones (`probe` en verde).
- [ ] `AUTH-DEPLOY` con SHA, imagen, ventana y rollback.
- [ ] Copia de la base y del almacén de sesiones, con restore probado.

## Recorrido mínimo

1. Abrir Correo y leer un mensaje real sin marcarlo leído.
2. Marcarlo leído y comprobar el flag en el buzón.
3. Mover un mensaje a una carpeta y devolverlo a la bandeja.
4. Mover un mensaje a la papelera y restaurarlo; comprobar que conserva `Message-ID` y adjuntos.
5. Responder a todos: comprobar destinatarios, CC y asunto `Re:`.
6. Reenviar con un adjunto: comprobar que el archivo llega con sus bytes.
7. Enviar un borrador propio a una dirección de prueba interna.
8. Comprobar la copia en la carpeta de enviados del buzón.
9. Repetir el envío simulando un corte tras `DATA`; el panel debe pedir conciliación y no reintentar solo.

## Observaciones que se registran

| Paso | Evidencia | Resultado |
|---|---|---|
| Lectura | captura + fila del buzón | PASS |
| Marca leído | flag `\Seen` observado | PASS |
| Mover / devolver | carpeta de destino | PASS |
| Papelera / restaurar | mensaje de vuelta en la bandeja; mismo `Message-ID`, bytes y SHA-256 | PASS |
| Responder a todos | To/CC del borrador | PASS en laboratorio; el smoke real usó envío directo |
| Reenviar con adjunto | bytes del adjunto recibido | PASS; 186 056 bytes y SHA-256 coincidente |
| Envío real | `Message-ID` y copia en enviados | PASS para envíos confirmados |
| Corte tras `DATA` | estado `unknown` y decisión | PASS; panel mostró decisión, no reintentó y concilió a `sent` tras observar entrega |

Evidencia: `FaberLoom_tarea_2026-11-16/tasks/evidence/PC4-smoke-2026-11-20.md`, `PC4-cut-reconciliation-2026-11-20.json` y `PC4-restore-attachment-2026-11-20.json`.

## Condición de parada

Cualquier diferencia entre lo aprobado y lo enviado, cualquier destinatario no previsto o cualquier fallo de copia en enviados detiene el recorrido y devuelve `NEEDS_WORK`.
