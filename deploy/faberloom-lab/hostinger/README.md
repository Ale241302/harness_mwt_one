# Hostinger: cuenta de prueba y matriz de capacidades

Sonda P-15 ejecutada el 2026-11-16 contra la API real. Este documento no contiene el token.

## Matriz de capacidades verificadas

| Operación | Estado | Evidencia |
|---|---|---|
| `getCurrentAccount` | 200 · 4 buzones | `evidence/O1/P-15-hostinger-api.md` |
| `listFolders` | 200 · 25 carpetas anidadas | ídem |
| `listMessages` (`/folders/{folder}/messages`) | 200 · paginado | ídem |
| `searchMessages` (`POST .../messages/search`) | 200 | ídem |
| `getQuota` | 200 · 16 GB de 50 GB | ídem |
| `drafts` (recurso) | **404** | ídem |
| `Drafts` como carpeta | 200 | ídem |
| `sendEmail` | **no ejecutado** | Requiere aprobación; su 204 no es entrega |
| Webhooks | **no ejecutado** | Crear un webhook es un efecto; no autorizado para una sonda |

## Lo que falta para cerrar P-15 del todo

- Recepción real: crear un webhook exige autorización de efecto, no de sonda.
- Envío: `sendEmail` es S4; no se llama desde una sonda.
- Aislamiento entre buzones: probar que el token de A no lee B. Requiere un segundo token.
- Revocación: comprobar que un token revocado deja de servir. Requiere tocar la cuenta.

## Reglas de uso de esta cuenta

- El token **no** se guarda en el repositorio, ni en fixtures, ni en evidencia.
- No se leen cuerpos ni adjuntos: el listado devuelve `subject`, `from`, `to`, `cc`, `bcc`; se
  registran los **nombres de campo**, nunca los valores.
- Un envío de prueba solo ocurre con aprobación del mensaje exacto, como cualquier S4.
- El token usado el 2026-11-16 quedó expuesto en la conversación: **debe rotarse**.

## Trampa que costó una llamada

`GET /api/v1/mailboxes/{id}/messages` devuelve 404. La ruta correcta es
`/api/v1/mailboxes/{id}/folders/{folder}/messages`. Concluir "no soporta listado" desde el primer 404
habría sido falso. La lección: la sonda se lee contra el OpenAPI, no contra la memoria.
