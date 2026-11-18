# Correo: del cuadro a un buzón (2026-11-17)

## Qué estaba mal

1. El panel abría con dos columnas de tabla (`DE`, `ASUNTO`) y una fila de acciones: se leía como un listado de archivos, no como un buzón. El mensaje de error decía `el servidor respondió NO:` sin motivo.
2. El motivo existía: el cliente IMAP descartaba la línea etiquetada del servidor (`NO [AUTHENTICATIONFAILED] ...`) y solo conservaba las líneas sin etiqueta, que en un rechazo de login están vacías. El `ImapError` salía sin causa.
3. El listado no pedía `FLAGS`, así que la pantalla no podía distinguir leído de no leído: todas las filas pesaban igual.

## Qué cambió

- `packages/faberloom/inbound/src/imap.ts`: `consume()` guarda el texto que acompaña al estado en la línea etiquetada (`Exchange.detail`) y lo usa en el mensaje de `ImapError`. La prueba `carries the server reason when it refuses a login` fija que `AUTHENTICATIONFAILED` e `Invalid credentials` llegan al panel.
- El mismo `FETCH` del listado pide `FLAGS`; `messagesOf()` marca `seen` con `\Seen`. `FaberLoomInboxRow` publica `seen` y la vista lo rellena.
- El panel (`panels.tsx`, `faberloom.module.css`) pasa a tres zonas: rail de vistas y cuentas con contadores (no leídos, o total si todo está leído), lista de correo y lector. Cada fila: avatar con iniciales, remitente, asunto, dirección y fecha; el no leído lleva punto y peso; al pasar el ratón la fecha cede su sitio a las acciones de la fila. El lector abre con quién escribió y cuándo, y el cuerpo se lee como texto, sin etiqueta de formulario ni caja de edición.
- Copia nueva en es/en/zh: `panel.email.intro`, `email.views`, `email.accounts`.

## Evidencia

- `docs/scratch/faberloom-daily-work/e1/visual/email-wide-look-a.png`, `email-wide-look-b.png`, `email-narrow-list.png`, `email-narrow-reader.png` (regeneradas por el e2e contra el host real).
- `apps/web/tests/email-panel.e2e.ts` (1 prueba): abre el grupo Emails, la fila `Email`, verifica lista y lector lado a lado en ancho, un solo panel en estrecho, los dos looks y las dos entradas de tarea. La lista se busca por `getByRole('list', { name: 'Inbox' })`.
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx` (140): las filas del buzón se abren por el botón de su `listitem` (`openMailRow`).
- `packages/faberloom/inbound` (41), `packages/faberloom/view` (239), `packages/client/ui-faberloom` (281) en verde.
- Desplegado: `healthz` ok, contenedor healthy, `MANIFEST.md` con `954e093fea6f0d9d2b6eda6e7475e409f97aca2c`; el bundle servido contiene `emailRail` y el de la vista publica `seen`; el IMAP pide `UID FLAGS BODY`.

## Lo que aún separa este panel de DaMail

DaMail es un hub de correo completo; esto es la lectura del buzón del dueño.

- **Sin hilos**: cada mensaje es una fila; DaMail agrupa por conversación.
- **Sin fragmento**: el listado solo pide cabeceras (`MESSAGE-ID FROM SUBJECT DATE`), así que no hay vista previa del texto. DaMail muestra el snippet.
- **Sin carpetas reales**: se lee `INBOX` de cada conexión. DaMail lista las carpetas del servidor, mueve y archiva.
- **Sin búsqueda en el panel**: existe `searchMailbox` en el host, pero la pantalla no la ofrece.
- **Sin compositor propio**: el modal de borrador es un formulario; DaMail tiene editor enriquecido, firmas, envío programado y deshacer.
- **Sin reglas ni etiquetas**: DaMail clasifica y automatiza; aquí no hay nada de eso.
- **Sin adjuntos en el lector más allá de la descarga**: la galería existe, pero no la vista previa de PDF/hoja.

## Después: gestor de correo, no una bandeja (2026-11-18)

El panel dejó de ser una lista con dos vistas:

- **Carpetas del servidor.** El receptor lista los buzones de cada cuenta (`LIST`) y el rail los ofrece bajo la cuenta: Inbox, Sent, Trash, Junk y las demás. Elegir una carpeta pide esa carpeta, no una copia local.
- **Vistas de correo.** Bandeja, No leídos (`UNSEEN`), Marcados (`FLAGGED`), Enviados y Borradores. El criterio viaja al servidor.
- **Paginador.** Una página de 50 servida por posición (`Anterior`, `Página X de Y`, total, `Siguiente`). El botón «Mostrar más» desapareció.
- **Búsqueda.** Campo en la barra; Enter busca en el buzón con el criterio de cobertura que ya devuelve `searchMailbox`.
- **Cuenta caída visible.** La cuenta que falla aparece en el rail y en la banda con su motivo y `Reintentar`; antes solo se veía la que respondía.

La causa del fallo de `alejandro@muitowork.com` es del buzón, no del código: el servidor responde `AUTHENTICATIONFAILED`. Se corrige restableciendo la contraseña de ese buzón en Hostinger y volviendo a guardar la conexión; el mensaje del panel ya muestra el motivo real.

Lo que todavía separa el panel de DaMail: hilos, fragmento del cuerpo en la lista, categorías/etiquetas, asistente, contactos, suscripciones y estadísticas. Enviar, mover y marcar como leído siguen en E2 (PC4 y `AUTH-REAL-WRITE`): la ola actual lee.
