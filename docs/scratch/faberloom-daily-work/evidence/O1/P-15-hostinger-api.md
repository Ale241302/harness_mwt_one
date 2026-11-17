# P-15 · Capacidades reales de la API de Hostinger

- Contrato: C-FL-03 · Ola O1 · Etapa F0 (sonda de `O1-02`)
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: API REST de correo de Hostinger, solo lectura y una búsqueda
- Nivel: OBSERVADO_REAL
- Estado: **CLOSED** (P-15 ejecutado; las otras catorce sondas también)
- Gate: `AUTH-2026-11-16-PROBE`
- Veredicto: PASS (2026-11-16; revisión independiente, no firma del CEO)
- Autor: faberloom-qa · Revisor: sesión independiente (reality-checker), PASS 2026-11-16; historial en `reviews/F0-review-log.md` Sonda ejecutada el 2026-11-16 con el token de API aportado por el CEO. Nada se envió, nada se creó, nada se modificó.

## 1. Qué se consultó

| Operación | Resultado | Lectura |
|---|---|---|
| `GET /api/v1/me` (`getCurrentAccount`) | **200** | Token válido; devuelve `data` con `mailboxes` |
| `GET /mailboxes/{id}/folders` | **200** | 25 carpetas en el primer buzón, con jerarquía por puntos |
| `GET /mailboxes/{id}/folders/INBOX/messages` | **200** | Paginación real: `page`, `perPage`, `total`, `totalPages` |
| `POST /mailboxes/{id}/folders/INBOX/messages/search` | **200** | Búsqueda existe y responde |
| `GET /mailboxes/{id}/quota` | **200** | 16 GB usados de 50 GB (31 %) |
| `GET /mailboxes/{id}/folders/INBOX.Drafts/messages` | **200** | `Drafts` es una carpeta IMAP, con mensajes si los hay |
| `GET /mailboxes/{id}/drafts` | **404** | **No hay recurso de borradores** |

Seis respuestas 200 y un 404. El 404 es el dato que cambia la decisión, no un error de la sonda.

## 2. Forma de un mensaje

Campos devueltos por el listado: `attachments`, `bcc`, `cc`, `date`, `flags`, `from`, `inReplyTo`, `messageId`, `path`, `plainTextSizeEstimate`, `replyTo`, `size`, `subject`, `to`, `uid`, `unseen`.

Hay `bcc` y `inReplyTo` en el listado. Eso importa para la aprobación exacta: el snapshot puede construirse con datos del propio proveedor, no solo con lo que el usuario escribió.

## 3. Consecuencias para la decisión

1. **Hostinger no tiene borradores con revisión.** Tiene una carpeta `Drafts` y nada más. La aprobación exacta de FaberLoom tendría que inventar el objeto intermedio. Es la diferencia funcional más grande frente a DaMail y la razón por la que DaMail sigue siendo el motor elegido.
2. La lectura y la búsqueda existen y paginan bien. Como motor de lectura, Hostinger alcanza.
3. El `bcc` y el `inReplyTo` del listado sirven para identidad y snapshot; no hace falta leer cuerpos para construir el sobre.
4. `quota` da un número verificable para el dimensionamiento: 16 GB de 50 GB en un buzón.

## 4. Errores propios que esta sonda corrigió

- Primera tentativa: llamé a `/mailboxes/{id}/messages` y obtuve **404**. Concluir "no soporta listado" habría sido falso: la ruta correcta es `/folders/{folder}/messages`. Lo corrigió leer el OpenAPI 1.3.0, no adivinar. Queda registrado porque es exactamente el error que las sondas existen para evitar.
- La salida cruda de `searchMessages` imprimió el campo `subject` de un mensaje al inspeccionar la forma de la respuesta. No se guardó en ningún archivo, no se usó para nada y no se repite. Es una fuga menor de metadatos y se declara.

## 5. Lo que esta sonda NO prueba

- No prueba recepción: no se creó ni se esperó ningún webhook.
- No prueba envío: `sendEmail` no se llamó, y su `204` no sería entrega de todos modos.
- No prueba aislamiento entre buzones ni reautenticación tras revocar un token.
- No prueba el MCP `mcp.mail.hostinger.com`; solo la API REST.
- No hay log HTTP guardado de la corrida: la evidencia es la forma de las respuestas y el OpenAPI 1.3.0. Quien quiera reproducirla necesita el token, que no está en el repositorio y debe rotarse.

## 6. Qué falta para cerrar la comparación con Hostinger

`O1-01` y `O1-03` ya no dependen de esta sonda: la conclusión es que Hostinger sirve como proveedor de buzones y no como motor, y eso es lo que PC1 firmó.
