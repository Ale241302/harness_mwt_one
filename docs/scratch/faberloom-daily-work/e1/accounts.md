# O4-01 · Recepción de dos cuentas

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `32fc221910`
- Alcance: dos cuentas con cursores propios, caída y reconexión, flags sin escritura, errores independientes
- Nivel: C1-E (pruebas ejecutadas) + C1-L (protocolo contra servidor de prueba)
- Estado: **CLOSED** (revision independiente PASS, `reviews/O4-review-round-2.md`)
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: PASS 2026-11-18 - O4-review-round-2

## 1. Qué cambió

Antes, `poll()` leía **una** cuenta: la primaria. El cursor ya era por conexión, pero el bucle no lo aprovechaba, y un fallo devolvía un reporte único que ocultaba las demás cuentas.

Ahora una pasada recorre **todas** las conexiones IMAP del dueño. Cada una:

| Paso | Qué hace |
|---|---|
| Cursor | Lee desde su propio `lastUid`; nunca comparte contador con otra cuenta |
| UIDVALIDITY | Si cambió, reinicia esa cuenta y solo esa |
| Lote | Lee como mucho `maxMessages` por pasada; la siguiente continúa desde el UID más alto leído |
| Fallo | Se registra en su entrada y no corta la pasada |
| Evento | La clave lleva `imap:<conexión>:<Message-ID o UID>`, así que dos cuentas son ocurrencias distintas |

El reporte conserva los campos agregados (`read`, `started`, `error`) y añade `accounts`, con una entrada por cuenta.

## 2. Caída y reconexión

Cuando una cuenta falla, su cursor **no avanza**. La siguiente pasada reintenta exactamente lo que faltó. Releer es seguro: el motor de rutinas deduplica por la clave del evento, que incluye la conexión y el mensaje. La prueba cierra el servidor de la cuenta A, comprueba que B sigue leyendo, lo vuelve a abrir en el mismo puerto y verifica que A recupera su mensaje sin que B arranque dos veces.

## 3. Flags sin escritura

El README del paquete decía «el receptor nunca escribe en el buzón»; el código lo contradecía. `markSeen` y `moveToTrash` ejecutaban `STORE`/`COPY` contra el servidor, y la interfaz los llamaba directo. Ahora ambos **rechazan** con `WRITE_NOT_APPROVED`: E1 lee, no muta. El rechazo es observable, no un no-op silencioso, y la prueba comprueba que después de los intentos el servidor no recibió ningún comando de escritura.

La lectura sigue siendo read-only por protocolo: los sobres usan `BODY.PEEK[HEADER.FIELDS …]` y el cuerpo `BODY.PEEK[]`, así que ni el sondeo ni la lectura marcan el correo como visto. El listado pide además `FLAGS` en el mismo `FETCH` para publicar `seen`; pedir la bandera no la escribe, y la pantalla distingue leído de no leído sin mutar el buzón.

## 4. Navegación: backlog y error por cuenta

`emailInbox(limit?)` devuelve `{ rows, failures }`:

- `limit` es la ventana **por cuenta**, por defecto 50 y acotada a 1–500; el panel no se queda en los últimos 25 y «Mostrar más» la amplía en 50.
- `failures` nombra cada cuenta que no se pudo leer con su motivo. La cuenta que falla aparece en pantalla; las demás siguen listadas.
- La lista se ordena por fecha entre cuentas.

## 5. Evidencia ejecutada

```
vitest inbound + view + tool-faberloom + handlers   458 pruebas, 47 archivos
tsc -b tsconfig.host.json                           exit 0
tsc -b tsconfig.client.json                         exit 0
oxlint (archivos nuevos)                            0
```

| Prueba | Qué demuestra |
|---|---|
| Dos servidores, dos conexiones | Ambas cuentas se leen, cada una con su cursor |
| A cerrada, B viva | Reporte con error de A, B útil, sin cortar la pasada |
| A reabierta en el mismo puerto | A recupera su backlog; B no repite su mensaje |
| Lote de 2 con 5 mensajes | Lecturas 2, 2, 1, 0; cinco arranques, ninguno duplicado |
| `markSeen` / `moveToTrash` | `WRITE_NOT_APPROVED` y cero comandos de escritura en el servidor |
| `emailInbox` con una cuenta caída | Filas de la sana y `failures` con la caída |
| Ventana fuera de rango | 0 → 1 y 10.000 → 500 |
| Panel | Muestra «No se pudo leer …» y «Mostrar más» pide 100 |

## 6. Límites de esta prueba

- El servidor de prueba implementa el subconjunto IMAP que el receptor usa (LOGIN, SELECT, UID SEARCH, UID FETCH, LOGOUT). No modela flags ni carpetas: la ausencia de escritura se prueba por los comandos emitidos, no por un estado de banderas del servidor.
- Las dos cuentas reales del piloto se conectan en PC3; aquí se prueba el protocolo y el aislamiento.
- Marcar y mover **autorizados** (E2) y su restauración pertenecen a T1-E2.
- Multi-carpeta es O7 (T1-E2): aquí se lee la carpeta configurada del buzón. Enlazar el hilo o la propuesta al mensaje entrante es O4-03.
