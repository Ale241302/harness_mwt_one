# Agente de borradores · diseño y olas

Estado: diseño aprobado para ejecución por olas. No habilita envío automático ni activación automática de lecciones.

## Objetivo

Convertir «Pedir un cambio a la IA» en una conversación flotante sobre el borrador, con el hilo y los adjuntos como contexto, iteración persistente, y aprendizaje propuesto (nunca automático) a partir de borradores aceptados, corregidos y descartados.

## No objetivos

- Enviar sin aprobación humana del mensaje exacto.
- Activar lecciones sin decisión humana.
- Reescribir el editor visual completo.
- Cambiar el motor de correo.

## Modelo

`FaberLoomDraftSession` (nuevo, por borrador):

| Campo | Tipo | Nota |
|---|---|---|
| `draftId` | string | identidad del borrador |
| `account` | string | cuenta de salida |
| `originUid` | string \| null | correo que se responde, si existe |
| `spaceId` | string \| null | Space recomendado o elegido |
| `sessionId` | string | sesión de chat del producto |
| `revisions` | array | `{ revision, snapshot, instruction, at }` |
| `status` | `open` \| `applied` \| `discarded` | ciclo de vida |

`snapshot` = el modelo único de mensaje ya existente (emisor, To/Cc/Bcc, asunto, cuerpo, adjuntos con bytes/hash). Iterar produce una revisión nueva; volver atrás restaura un snapshot sin recomponer desde el borrador actual.

## RPC nuevos en la vista

- `draftSessionOpen(draftId)` → abre o reutiliza la sesión del borrador; devuelve `draftId`, `sessionId`, `snapshot`, `origin`.
- `draftRevise(draftId, instruction)` → aplica una instrucción con contexto de hilo y adjuntos; devuelve la revisión nueva.
- `draftSessionHistory(draftId)` → revisiones con instrucción y hora.
- `draftRestore(draftId, revision)` → restaura un snapshot como revisión nueva (no borra historia).
- `draftDiscard(draftId, reason?)` → marca descartado y registra el motivo como candidato de aprendizaje.
- `draftSignatureFor(draftId)` → firma recomendada por cuenta y contexto.
- `draftSpaceSuggestion(draftId)` → Space/Workspace recomendado con evidencia.

## Contexto que recibe el modelo

1. El snapshot aprobado del borrador.
2. El hilo: mensajes previos con remitente, fecha y cuerpo acotado.
3. Los adjuntos del correo origen, leídos por la ruta autorizada del servidor, con nombre, tipo y tamaño; nunca se envían a un proveedor distinto del configurado.
4. El motivo del borrador original (respuesta, reenvío, plantilla, indicación del usuario).
5. La instrucción de la iteración.

Límites: bytes y número de mensajes acotados y visibles en el error; no se finge lectura completa.

## Aprendizaje como candidatos

- Señales: aceptado sin cambios, corregido, descartado, cambio de destinatarios, cambio de firma.
- Cada señal crea un **candidato** de lección con `source`, `draftId`, `account`, `spaceId` y evidencia.
- El candidato se muestra en curación y solo una persona lo activa.
- Un descarte repetido del mismo patrón (remitente + tipo) propone no crear borradores para ese patrón; sigue siendo propuesta.

## Firma y Space

- Firma: recomendación por cuenta, con la firma guardada como valor por defecto; el usuario puede cambiarla antes de enviar.
- Space: si el borrador pertenece a un Space existente, se propone adjuntarlo; si no, tras N iteraciones se propone crear Space/Workspace con el nombre sugerido y mover la sesión, igual que el flujo actual de la bandeja.

## Olas

1. **Flotante único** — reutilizar la conversación flotante de responder para borradores; el borrador se edita desde ahí. Sin cambios de modelo. Prueba: abrir un borrador, iterar una instrucción y ver el cuerpo actualizado.
2. **Contexto real** — hilo y adjuntos en la petición, con límites y evidencia. Prueba: el modelo recibe el hilo y el adjunto; el registro muestra qué se envió.
3. **Iteración persistente** — una sesión por borrador, historial y restaurar. Prueba: cerrar y reabrir, historial completo, restaurar una revisión anterior.
4. **Candidatos de aprendizaje** — señales y curación. Prueba: aceptar, corregir y descartar crean candidatos distintos; nada se activa solo.
5. **Firma y Space** — recomendación y creación asistida. Prueba: firma correcta por cuenta; sugerencia de Space con evidencia y creación solo tras confirmación.

## Archivos previstos

- `packages/faberloom/view/src/index.ts`: RPC y contexto.
- `packages/client/ui-faberloom/src/client/panels.tsx`: flotante y controles del borrador.
- `packages/faberloom/learning/src/index.ts`: candidatos desde señales del borrador.
- `packages/faberloom/spaces/src/index.ts`: recomendación y alta.
- Pruebas en `packages/faberloom/view/tests` y `packages/client/ui-faberloom/tests`.

## Puertas

- Sin envío automático.
- Sin activación automática de lecciones.
- Sin lectura de adjuntos fuera de la ruta autorizada.
- Cada ola exige prueba roja→verde y evidencia del flujo real en laboratorio.
