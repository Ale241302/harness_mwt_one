---
name: faberloom-effect-gate
description: Clasifica efectos S1-S4 en FaberLoom, exige el snapshot exacto antes de aprobar y separa transmisión de conciliación. Usar al implementar o revisar cualquier acción que envíe correo, mueva mensajes o escriba en MWT.ONE.
---

# Compuerta de efectos

## Clasificación

| Clase | Qué es | Quién autoriza |
|---|---|---|
| S1 | Lectura sin mutación | El alcance de lectura vigente |
| S2 | Cambio local recuperable (borrador, vista, orden) | El usuario en la herramienta |
| S3 | Efecto externo recuperable y previsible (mover, marcar, archivar) | Regla autorizada o gesto del usuario |
| S4 | Efecto externo no recuperable (enviar, escribir en un expediente, borrar) | Aprobación individual del snapshot exacto |

Ningún automatismo ejecuta S4. Ni siquiera para el propio dueño. La regla 4 no tiene excepción
de autoenvío.

## Snapshot exacto

Antes de aprobar, el mensaje u operación debe quedar fijado con: cuenta, emisor, To/Cc/Bcc,
asunto, cuerpo y formato, adjuntos con hash, hilo de referencia, espacio y revisión de la
propuesta. Cambiar un byte, un destinatario o un adjunto invalida la aprobación. Se vuelve a
mostrar el snapshot completo, no un resumen del cambio.

## Secuencia obligatoria

1. Preparar la propuesta sin efectos.
2. Mostrar el snapshot completo.
3. Recibir aprobación humana del snapshot.
4. Registrar un intento con identificador único y estado `pendiente`.
5. Transmitir una sola vez.
6. Conciliar: `entregado`, `rechazado`, `desconocido`.
7. Ante `desconocido`, no reintentar sin decisión humana y sin comprobar el buzón de enviados.

## Vías alternativas

Cualquier ruta que pueda provocar el efecto debe pasar por la misma autoridad: UI, API, tool,
MCP, shell, flujo, rutina, handler, subagente. Un botón oculto no protege nada. Si una ruta no
puede ejercer la autoridad, se desmonta.

## Rechazos que no se negocian

- Envío automático por regla, alerta, invitación, recordatorio o reinicio.
- Aprobación emitida desde otra aplicación, cookie o sesión ajena.
- Reintento automático tras timeout.
- Conciliación por optimismo: "si no dio error, se envió".
