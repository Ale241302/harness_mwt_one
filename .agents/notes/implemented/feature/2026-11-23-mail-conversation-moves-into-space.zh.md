# Agent Note: una conversación de correo se muda a su Space con el chat que el dueño ya tenía

Status: implemented

[English](2026-11-23-mail-conversation-moves-into-space.md) | 中文

## Problem

La conversación flotante del correo ofrecía agregar su email a un Space, y el botón adjuntaba los archivos y la memoria. La conversación se quedaba fuera: la sesión se había creado en el directorio de trabajo por defecto, y `Workspace.attachSession` rechaza una sesión cuyo `cwd` guardado difiere de la ruta del workspace. Además, la tarjeta buscaba la sesión viva bajo la clave anterior a `v2`, así que normalmente no la encontraba y reemplazaba la conversación por una sesión sembrada de nuevo. El dueño pulsaba Agregar después de un intercambio largo y aterrizaba en otro chat, sin Space, justo donde la conversación no estaba.

## Decision

### La conversación en pantalla es la que se mueve

`attachMailToSpace` recibe la sesión viva, su asunto y el Space de destino, y devuelve la sesión que ahora vive en el workspace del Space. Una sesión cuyo `cwd` ya es la ruta del workspace se adjunta en su lugar, sin cambios. Cualquier otra sesión conserva su directorio inmutable: el Host crea una sesión propiedad del Space con `mailAgents.provision` e inyecta `mailTransferContext`, una transcripción acotada de los últimos doce mensajes de usuario y asistente (4.000 caracteres cada uno, 12.000 en total), delimitada como historial no confiable. La sesión anterior queda legible y sin cambios.

### Una conversación de borrador se mueve mediante su borrador

Una sesión ligada a un borrador no se puede desligar copiándola. `attachMailToSpace` encuentra el borrador dueño de la sesión y delega en `draftAttachToSpace`, que enlaza el borrador al Space, transfiere o adjunta la sesión, y vuelve a ligar el borrador a la continuación. El borrador sigue funcionando después del movimiento.

### El navegador abre la sesión devuelta

El cliente pasa `ctx.sessions.list.getSnapshot().current`, la sesión que el flotante está pintando, en vez de adivinarla por una clave de almacenamiento. Después de la llamada refresca la lista, abre la sesión devuelta, cierra el flotante y limpia el panel. Cuando todavía no hay conversación, sigue creando una sesión nacida en el Space, sembrada con el correo y su pregunta de resumen. La lectura obsoleta de `faberloom.mail.chat.<uid>` desaparece; la clave `v2` queda como respaldo.

## Alternatives considered

**Cambiar el `cwd` de la sesión en su lugar.** Rechazado: la cabecera guardada y el registro de workspaces validan el `cwd` al adjuntar; mutarlo movería turnos históricos a un directorio donde sus archivos y herramientas nunca se ejecutaron.

**Adjuntar la sesión sin transferirla.** Rechazado: `attachSession` lanza cuando los directorios difieren, y silenciar ese error es lo que produjo la discordancia silenciosa que corrige esta nota.

**Copiar la conversación como eventos reales de usuario y asistente.** Rechazado: un segundo registro del mismo intercambio pertenece a la sesión que lo posee; la transferencia de borradores ya estableció el contexto inyectado acotado como la forma de cruzar workspaces.

**Mantener la clave por correo y corregir solo la versión.** Rechazado: el flotante de borrador muestra la misma tarjeta sobre otra sesión, así que la clave seguiría nombrando la conversación equivocada.

## Consequences

El Space muestra la continuación bajo su propio workspace, y la sesión anterior permanece en la lista como referencia. La transcripción es acotada, así que un intercambio muy largo llega resumido por sus últimos mensajes en vez de completo. La transferencia necesita `sessionQuery` montado, un proveedor de modelo y el servicio de agentes; un despliegue sin ellos conserva el comportamiento anterior de adjuntar solo el correo.

## Testing

`vitest run packages/faberloom/view/tests/mail-space-attach.spec.ts`: cuatro casos que cubren un adjuntado en su lugar, una continuación con `cwd` distinto, una tarjeta sin conversación y una sesión de borrador que conserva su ligadura. `vitest run packages/faberloom/view/tests` y la suite de registro del cliente cubren el resto del panel.
