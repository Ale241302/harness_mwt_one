# Comparación de motores de correo

Contrato: C-FL-03 / O1-01 / FM-O1-01 Nivel: C1-L para DaMail (código leído), C2 para Hostinger (documentación y OpenAPI 1.3.0), C1-E para el estado del producto propio (baseline ejecutado hoy). **No hay C1-E ni C1-I de ninguna de las tres alternativas como motor integrado.**

## 1. Reglas de esta comparación

- Mismo caso para las tres: recepción, identidad, lectura, borradores, adjuntos, carpetas, búsqueda, aprobación, envío, conciliación, IA apagada, operación y recuperación.
- Leer código no demuestra comportamiento. Un ID `DM-*` es lectura; un ID `H-*` es documentación.
- Ninguna fila se cierra por "el README lo dice".
- No se construyen tres integraciones. Las sondas se limitan a las incertidumbres que cambian la elección.

## 2. Tabla común

| Criterio | DaMail | Hostinger Mail API/MCP | Extensión FaberLoom |
|---|---|---|---|
| **Recepción** | Worker por buzón, IMAP IDLE en INBOX y sondeo de otras carpetas (`DM-01`) | Webhooks `message.received` y lectura por API (`H-02`, `H-04`) | Sondeo configurado cada 60 s; dos cuentas sin probar |
| **Identidad** | Índice PostgreSQL, `.eml` por SHA-256, hilos y alcance por buzón (`DM-07`) | `resourceId` por recurso; alcance del token por probar (`H-01`) | Unificar dueño/cuenta/carpeta/UIDVALIDITY/UID. Hoy: 64 fallos de propiedad |
| **Lectura y búsqueda** | REST/MCP con hilos, carpetas y adjuntos; `searchText` truncado a 30.000 caracteres (`DM-07`, `DM-09`, `DM-10`) | **Verificado**: `listMessages` 200 con paginación (`page/perPage/total/totalPages`) y `searchMessages` 200; 25 carpetas anidadas | Parcial |
| **Borradores** | Completos, con revisión y rechazo de aprobación obsoleta (`DM-02`) | **Confirmado con token real el 2026-11-16**: `GET /mailboxes/{id}/drafts` devuelve 404. Solo existe la carpeta `INBOX.Drafts`, sin semántica de revisión | Rutas existen; snapshot común incompleto |
| **Adjuntos al redactar** | REST sí; MCP no sube adjuntos arbitrarios (`DM-02`, `DM-10`) | Por comprobar formato y bytes (`H-02`) | Envío de archivo fuera de la autoridad común |
| **Aprobación** | Web con revisión; aprobar ahí **no** sustituye la aprobación dentro de FaberLoom | Debe construirse en FaberLoom | Debe centralizarse y revalidarse |
| **Envío** | Cola persistente, Graph limitado a 4 MB, copia a Enviados, estado desconocido tras reinicio (`DM-03`) | `204` = aceptado para despacho, **no** entregado (`H-03`) | No idempotente y sin conciliación suficiente |
| **Destinatarios** | Sin Allow List documentada en esa revisión | Allow/Block descritas en documentación, sin operation ID verificado (`H-06`) | Política propia obligatoria |
| **Límites** | API keys con `send` **sin tope horario** (`DM-05`, `DM-06`) | `429` documentado, sin cifra comparable (`H-03`) | Límites propios |
| **IA apagada** | Por defecto en base de datos; **no existe `AI_ENABLED`** (`DM-04`, `DM-06`) | No se necesita IA del proveedor | Toda IA queda en el harness |
| **Operación** | App + PostgreSQL + 2 volúmenes; `MASTER_KEY` obligatorio; versión `latest` a fijar (`DM-11`) | Servicio administrado y webhooks | Depende de conexiones y persistencia propias |
| **Aislamiento** | **Single-tenant**: usuarios web ven todos los buzones (`DM-05`) | Tokens restringibles por pedido y buzones (`H-01`) | Piloto por dueño |
| **Recuperación** | Backup coordinado de PostgreSQL + `app-data` + secreto (`DM-11`) | Fuera del control del cliente | Copias propias; hoy hay 4 copias del volumen |

## 3. Lo que este trabajo añadió a la comparación

Tres hechos medidos hoy que no estaban en la tabla original y que cambian la decisión:

1. **Los buzones del piloto están en Hostinger, no en el mailcow del VPS.** Se verificó el 2026-11-16 midiendo las dos cuentas: responden en `imap.hostinger.com:993` y el mailcow del servidor sirve `faberloom.ai`, `faberloom.com`, `mwt.one`, `mwtone.com`, `rana.work`, `ranafootwear.com`, `ranawalk.com`, `ranawork.com`, `vlinte.com` y `vlinte.work` — no `muitowork.com`. Consecuencia: la decisión 4b ("usa el conector de Hostinger") aplica a estos buzones, y la vía "IMAP directo contra mailcow" **no** aplica al piloto.

2. **El servidor no tiene capacidad libre para un producto más.** 52 contenedores al medir (56 al cerrar, con el laboratorio), carga media 5,6 sobre 8 CPU, 54 % de disco. DaMail necesita su propio PostgreSQL y su aplicación. Eso entra en el costo de operación y en el tope de F0-8.

3. **El servidor MCP `faberloom` no está montado.** `faberloomConfigured=false` porque falta `FABERLOOM_GATEWAY_KEY` (o `FABERLOOM_MCP_URL`), y el gateway no registra ese servidor (`gateway/server.mjs` líneas 94-95, 1022). Cualquier diseño que suponga ese MCP hoy está suponiendo algo que no existe en producción.

## 4. Estado de cada alternativa

| Alternativa | Qué está probado | Qué falta para poder recomendarla sin condiciones |
|---|---|---|
| **DaMail** | Código leído en `497a6f4`: borradores con revisión, cola de envío, scopes, IA apagada por base de datos | Laboratorio instalado (`AUTH-LAB-SERVICE`), dos buzones, identidad, adjuntos, barrera negativa, timeout, conciliación, backup/restore, y probar la sospecha de que `getDraft`/`listDrafts` no filtran por creador (`DM-02`) |
| **Hostinger** | OpenAPI 1.3.0 leído: lectura, búsqueda, carpetas, flags, adjuntos, envío, webhooks | Cuenta de prueba (`AUTH-REAL-PROBE`), verificar si hay borradores o solo envío, separación de permisos, Allow/Block, conciliación del `204` |
| **Extensión propia** | Baseline ejecutado: 1.475-1.476 pruebas pasan, **212-213 fallan**, con el mensaje de propiedad dominando `board` | Corregir identidad y autoridad, snapshot único, intentos persistentes, conciliación; y aun así compite contra un motor ya escrito |

## 5. Límites

- No se ejecutó ninguna sonda real: `AUTH-LAB-SERVICE` no fue otorgada y `AUTH-REAL-PROBE` no tiene cuenta ni topes declarados.
- No se instaló DaMail, no se autenticó el MCP de Hostinger, no se conectó ningún buzón.
- La tabla no dice qué motor es más rápido ni más barato de operar: eso sale de las sondas y de los rangos de `f0/effort-ranges.md`.
- Una fila sin evidencia no se marca como "no soportado": se marca como **no verificado**.
