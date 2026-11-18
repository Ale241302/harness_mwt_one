# O3-06 · Custodia, revocación y copias

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `afe9da6cf8`
- Alcance: canarios, destinos no autorizados y primer inventario de copias
- Nivel: C1-E (pruebas ejecutadas) + C1-L (inventario)
- Estado: **CLOSED** (revision independiente PASS, `reviews/O3-review-round-4.md`)
- Gate: PC1, PC2, laboratorio
- Autor: faberloom-implementer · Revisor: PASS 2026-11-17 - O3-review-round-4

## 1. Destinos no autorizados: de documento a control

El laboratorio tenía `egress-policy.json` y **ningún código lo leía**. La barrera era un archivo. Ahora es una comprobación en el punto donde las credenciales salen del servicio:

| Regla | Efecto |
|---|---|
| `FABERLOOM_EGRESS_DENY` con patrones | Esos hosts no reciben credenciales: no hay socket |
| `FABERLOOM_EGRESS_ALLOW` con excepciones | Abre loopback, por ejemplo, para el laboratorio |
| Política configurada | **Denegación por defecto**: lo no listado no se autoriza |
| Sin variables | Sin cambios: un despliegue que no la configura no la sufre |

La comprobación está en cada punto donde una credencial sale del servicio: `connections.imap()`, `connections.smtp()`, `connections.sendMail()` y `connections.probe()`. Si el host no está autorizado, la credencial no se entrega y no se abre conexión. No es un aviso en la UI.

`probe()` merecía la misma regla: probar una conexión abre un socket con la clave guardada, así que sin comprobación la lista de denegados se saltaba con un botón. Ahora devuelve `destino no autorizado` sin conectar. Los destinos de respaldo quedan fuera porque `probeBackup` solo escribe en una ruta local y rechaza los remotos.

## 2. Canarios

Un canario plantado como credencial se buscó en cada salida:

| Superficie | Resultado |
|---|---|
| Descripción y listado del mediador | limpio |
| Rechazo de una credencial ajena | limpio |
| Refusal de un fallo de transporte que cita la clave | limpio, con `[redacted]` |
| Serialización del error | limpio |
| Aviso interno construido desde ese fallo | limpio |
| Log del servicio (info, warn, error, debug) | limpio |

Prueba: `access/tests/canary.spec.ts` (2 casos).

**Lo que esta prueba no cubre**: un prompt de modelo real. Sin una llamada al proveedor no hay prompt que inspeccionar; lo que sí se prueba es que el secreto no sale de la custodia por ninguna de las superficies que lo rodean. La prueba de prompt pertenece a E2, cuando el agente redacte con el motor conectado.

## 3. Inventario de copias y retirada

Del inventario del servidor (2026-11-16). Una copia no se retira «cuando se pueda»: se retira con un procedimiento y un dueño.

| # | Copia | Dónde | Qué contiene | Retirada | Dueño |
|---:|---|---|---|---|---|
| 1 | Volumen vivo | VPS, `/var/lib/docker/volumes/harness-*` | Estado del harness, usuarios, sesiones | Apagar el servicio y borrar el volumen: **destruye el servicio** | CEO |
| 2 | Restauración semanal | VPS, `backups/` (2026-11-15) | Copia completa de ese volumen | Borrar el archivo; el siguiente ciclo lo recrea | CEO |
| 3 | Remoto cifrado | Destino externo | Copia cifrada | Borrar en el destino y rotar la clave | CEO |
| 4 | Passphrase junto al dato | VPS, `.backup-passphrase` | La clave de la copia remota | Mover a un gestor de secretos y rotar | CEO |
| 5 | `INBOX.Mesa-Backups` | Buzón real, 200 mensajes | Correo de la Mesa | Vaciar la carpeta tras confirmar que no es la única copia | CEO |

**Retirada aplicable hoy**: las copias 1 y 2 se pueden retirar con `docker volume rm` y un `rm` en `backups/`, pero ninguna es una copia muerta: quitarlas deja el servicio sin respaldo. La 3 y la 4 solo tienen sentido juntas: retirar la copia remota sin rotar la passphrase deja la clave viva apuntando a nada. La 5 no se toca hasta que exista otra copia del correo.

**Lo que sí se probó**: el laboratorio se retira de verdad con `docker compose down -v`, que borra contenedor, red y volúmenes, y se verificó que después no queda ni el volumen ni el puerto. Es el mismo procedimiento que las copias 1 y 2, aplicado a un entorno que no es producción.

## 4. Evidencia ejecutada

```
vitest connections/tests/egress.spec.ts     9 pruebas
vitest access/tests/canary.spec.ts          2 pruebas
tsc --noEmit (connections, access)          exit 0
```

| Prueba | Qué demuestra |
|---|---|
| Patrón exacto y sufijo | `*.hostinger.com` sí, `evil-hostinger.com` no |
| Sin configurar | Nada cambia |
| Con denegados | El host listado se rechaza y lo no listado también |
| Con allow | Loopback pasa; Hostinger sigue denegado |
| IMAP denegado | `EGRESS_DENIED` antes de conectar |
| SMTP denegado | `EGRESS_DENIED` antes de conectar |
| Accesor `smtp()` denegado | No solo el envío: pedir la credencial también se rechaza |
| Prueba de conexión denegada | `probe()` no abre socket contra un host no autorizado |
| Canario | No aparece en descripción, rechazo, error, aviso ni log |

## 5. Lo que queda abierto, con dueño

| Pendiente | Dueño |
|---|---|
| Rotar las credenciales expuestas (buzones, token de Hostinger, clave DeepSeek, root del VPS) | CEO |
| Retirar las copias 3, 4 y 5 con el procedimiento de arriba | CEO |
| Probar el canario en un prompt de modelo real | E2 (O6), cuando el agente redacte conectado |
| Copia cifrada verificada de extremo a extremo | O5-07A |
| Restauración sin reactivar memoria, reglas ni rutinas | O5-07A (depende de O3-05, ya hecho) |

## 6. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/connections/tests/egress.spec.ts --project thread-safe
corepack pnpm exec vitest run packages/faberloom/access/tests/canary.spec.ts --project thread-safe
```
