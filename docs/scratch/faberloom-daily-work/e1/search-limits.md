# O4-02 · Paginación, búsqueda con límites visibles e identidad

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `3c68b6505a`
- Alcance: backlog por cuenta, cobertura de búsqueda y propagación de la identidad a UI, tools y adjuntos
- Nivel: C1-E (pruebas ejecutadas) + C1-L (protocolo)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. Backlog, no una ventana fija

`emailInbox(limit?)` pide `limit` envelopes **por cuenta** (50 por defecto, 1–500) y el panel ofrece «Mostrar más» para ampliar la ventana en 50. Una prueba con dos cuentas de 40 mensajes devuelve 80 filas, 40 por cuenta: el backlog ya no queda detrás de los últimos 25.

El sondeo también pagina: `maxMessages` por cuenta y pasada, y el cursor continúa desde el UID más alto leído. La prueba de cinco mensajes con lote de dos da lecturas 2, 2, 1, 0 y cinco arranques únicos.

## 2. La búsqueda dice cuánto cubrió

Antes, `searchMailbox` devolvía una lista sin decir si había mirado todo el buzón. Un servidor que rechaza `CHARSET UTF-8` hace que el cliente escanee solo los últimos 200 sobres y compare `From`/`Subject`; una coincidencia más antigua —o solo en el cuerpo— no aparece, y el llamador no tenía forma de saberlo.

Ahora devuelve:

| Campo | Qué dice |
|---|---|
| `messages` | Coincidencias, nuevas primero |
| `connectionId` | Cuenta donde se buscó |
| `complete` | `true` si el servidor respondió sobre todo el buzón; `false` si se escaneó una ventana |
| `scanned` | Sobres examinados |
| `total` | Mensajes del buzón, cuando el camino los listó |
| `matched` | Coincidencias antes del límite |

La herramienta `faberloom_mail_search` copia la cuenta en cada fila y añade el aviso: «Mostrando X de Y coincidencias» y «Revisé 200 de 1500 mensajes recientes; puede haber coincidencias más antiguas». El paso `imap` de una rutina informa `complete` y `scanned` en su resultado. Ningún camino declara exhaustividad que no tenga.

## 3. Identidad de la ocurrencia

Con dos cuentas, un UID solo no identifica un mensaje. La identidad que fijó O3-04 (cuenta + `UIDVALIDITY` + UID) ahora llega a todas las superficies:

| Superficie | Antes | Ahora |
|---|---|---|
| Búsqueda | `uid`, remitente, asunto, fecha | añade `connectionId` por fila |
| Leer | `uid` | `uid` + `connectionId` |
| Adjuntos (guardar) | `uid` | `uid` + `connectionId` |
| Enlace de descarga | `uid` | `uid` + `connectionId` |
| Marcar leído | `uid` | `uid` + `connectionId` |
| Papelera | `uid` | `uid` + `connectionId` |
| Paso `imap` de rutina | solo UID del evento | admite `connectionId` en la configuración |

El panel ya usa la identidad completa (`<conexión>:<uid>`), y la lectura de un adjunto pasa por la misma cuenta que la fila. Sin esto, en E2 un UID de la cuenta B habría actuado sobre la cuenta A.

## 4. Evidencia ejecutada

```
vitest inbound + tool-faberloom + handlers + view   458 pruebas, 47 archivos
tsc -b host / client                                exit 0
oxlint (código nuevo)                               0
```

| Prueba | Qué demuestra |
|---|---|
| Dos cuentas × 40 | 80 filas, 40 por cuenta; la ventana por defecto no es 25 |
| Lote de 2 con 5 mensajes | 2, 2, 1, 0 lecturas; cinco arranques, ninguno repetido |
| Servidor sin `CHARSET` | `complete: false`, `scanned: 2`, `total: 3`; la coincidencia vieja no se inventa |
| Búsqueda con cuerpo fuera de ventana | El resultado avisa en vez de afirmar «sin coincidencias» |
| Tool de búsqueda | Cada fila lleva `connectionId`; el render repite el aviso |
| Pasos `imap` | El resultado incluye `complete` y `scanned` |

## 5. Límites

- El fallback compara solo `From`/`Subject`: un marcador únicamente en el cuerpo se encuentra cuando el servidor acepta `TEXT`, y cuando no, el resultado lo declara parcial.
- La ventana del fallback son 200 sobres; es una constante del protocolo, no configuración.
- Marcar, mover y restaurar autorizados son E2 (T1-E2).
- La conversión de adjuntos (PDF, planilla, corrupto, sobredimensionado) es O4-05.
