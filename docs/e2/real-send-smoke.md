# Smoke real controlado · correo diario

Estado: **NO EJECUTADO**. Requiere `AUTH-REAL-WRITE` firmada por el CEO y los dos buzones conectados. Sin esa firma no se toca un buzón operativo.

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
| Lectura | captura + fila del buzón | pendiente |
| Marca leído | flag `\Seen` observado | pendiente |
| Mover / devolver | carpeta de destino | pendiente |
| Papelera / restaurar | mensaje de vuelta en la bandeja | pendiente |
| Responder a todos | To/CC del borrador | pendiente |
| Reenviar con adjunto | bytes del adjunto recibido | pendiente |
| Envío real | `Message-ID` y copia en enviados | pendiente |
| Corte tras `DATA` | estado `unknown` y decisión | pendiente |

## Condición de parada

Cualquier diferencia entre lo aprobado y lo enviado, cualquier destinatario no previsto o cualquier fallo de copia en enviados detiene el recorrido y devuelve `NEEDS_WORK`.
