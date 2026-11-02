# ADR-005 · Un proceso y un `DSH_HOME` por tenant (Opción B)

**Estado:** propuesta, apagada por defecto · **Fecha:** 2/11/2026
**Decisión:** Opción B, con flag y solo para un tenant de un solo equipo
**Relacionado:** ADR-001 (atomicidad del agregado), ADR-002 (tenant = empresa), ADR-006 (Mesa central con PostgreSQL y RLS)
**Módulo:** `gateway/tenant-home.mjs` · **Pruebas:** `gateway/tenant-home.test.mjs`

## Contexto

Hoy cada usuario tiene su propio proceso `dsh` y su propio `DSH_HOME`:
`startInstance` compone `path.join(cfg.dataDir, user.id)` (`gateway/server.mjs:1347`) y el
mapa `instances` se indexa por `user.id` (`:1128`). De ahí cuelgan las sesiones, los
`storages` (Mesa, rutinas, tokens MCP), los perfiles y las credenciales de consola de esa
persona. Dos usuarios de la misma empresa no comparten nada: es el problema que ADR-006
describe con los 460 ítems de Alejandro en un almacén y los de Álvaro en otro.

El tenant ya existe en el dominio (ADR-002 fija tenant = empresa y lo hace viajar en el
actor y en el token MCP), pero no existe en el alambre del gateway: `rememberUser` no
guarda `tenantId` (`:531-553`) y ningún proceso sabe a qué empresa sirve. Lo único que
llega es `legalEntityIds` y la entidad activa (`:1704-1726`).

Hay dos formas de que un equipo vea lo mismo:

- **Opción A**: el dato compartido vive en un servicio central con RLS (ADR-006). Es la
  dirección multi-tenant real y la que el proyecto eligió para la Mesa.
- **Opción B**: se comparten el proceso y el `DSH_HOME` por tenant. Un solo `dsh` atiende
  a todo el equipo y todo lo que hoy es por usuario pasa a ser por tenant sin tocar el
  producto.

Este ADR documenta la Opción B, la deja implementada como módulo puro y **apagada**. No
reabre lo que ADR-006 ya descartó para la Mesa: la Mesa sigue yendo a PostgreSQL. La
Opción B queda como paso restringido para el resto de la casa (sesiones, agentes,
credenciales) de un equipo pequeño, y solo después de que la Opción A esté decidida.

## Decisión

1. `gateway/tenant-home.mjs` es el único lugar que nombra un tenant. Exporta:
   - `tenantKey(user)`: `tenantId`, después `legalEntityIds[0]`, después `id`. Un campo
     vacío pasa al siguiente; un campo presente que no sirve como nombre de directorio
     lanza en vez de caer al siguiente, porque caer movería al usuario de casa sin un
     error visible.
   - `tenantHome(dataDir, user)`: `<dataDir>/tenants/<clave>`.
   - `tenantInstanceKey(user)`: la clave del mapa `instances`, que es el tenant y no el
     usuario.
   - `shouldShareTenantHome(env)`: `env.FABERLOOM_TENANT_HOME === '1'`.
   - `homeFor(dataDir, user, env)` e `instanceKeyFor(user, env)`: la rama del flag en un
     solo sitio. El mapa `instances` se lee y se escribe en una decena de puntos de
     `server.mjs`; copiar la condición en cada uno es la forma segura de que dos de ellos
     dejen de coincidir.
2. **El flag es `FABERLOOM_TENANT_HOME=1`**, solo el literal `'1'`. Ausente, `'true'`,
   `'0'` o vacío dejan el comportamiento actual. La variable no está declarada en
   `.env.example`: apagado es el estado del repositorio.
3. La casa compartida se anida en `<DATA_DIR>/tenants/<clave>`, nunca en
   `<DATA_DIR>/<id>`. Activar o revertir no pisa ni mueve un home existente, y una clave
   de tenant que coincida con un id de usuario no colisiona.
4. La clave se rechaza si no es un segmento de ruta usable (vacía, `.`, `..`, separadores,
   caracteres de control, más de 128 caracteres). No se normaliza nada salvo el espacio de
   los extremos: dos claves que normalizaran al mismo nombre compartirían casa.
   `legalEntityIds[0]` manda mientras la consola no emita `tenantId`; si la consola
   reordena esa lista, el usuario cambia de casa. Por eso `tenantId` es el campo preferido
   y su ausencia es deuda, no diseño.
5. Con el flag apagado, `homeFor` devuelve `path.join(dataDir, user.id)` sin sanear el id e
   `instanceKeyFor` devuelve `user.id`: la ruta de hoy, byte a byte. Apagar el flag es un
   no-op.
6. El módulo es puro: no crea directorios, no lee `process.env` y no arranca procesos.
   `server.mjs` conserva esa responsabilidad y **no se modifica en este cambio**.

## Puntos de integración en `server.mjs`

Nada de esto está aplicado. Las líneas son las de este árbol y se mueven con el archivo;
lo estable es el conjunto. **No existe hoy una función `homeFor`**: se introduce en
`:1347`, que es donde el servidor compone la casa.

### A. El nombre de la casa

| Línea | Hoy | Al activar |
|---|---|---|
| 1347 | `const home = path.join(cfg.dataDir, user.id)` | `const home = homeFor(cfg.dataDir, user, process.env)` |
| 1390, 1393 | `cwd: home`, `DSH_HOME: home` | sin cambio: ya reciben `home` |
| 1349, 1362, 1363, 1364 | `writeConsolaTokenFile`, `writeUserPatch`, `writeUserInstructions`, `writeUserPresets` escriben dentro de `home` | escriben en la casa del tenant: el último login gana |
| 1953 | socket MCP `path.join(owner.home, 'faberloom-mcp.sock')` | `owner.home` (índice de tokens, `:755`, `:759`) debe ser la casa del tenant |

### B. La clave del mapa `instances`

| Línea | Hoy | Al activar |
|---|---|---|
| 1127-1128 | `const instances = new Map()`, clave `user.id` | clave `instanceKeyFor(user, process.env)` |
| 1466, 1469 | alta y baja del mapa en `startInstance` | `instanceKeyFor(user, …)` |
| 1475, 1485, 1488, 1492 | lecturas y bajas en `ensureInstance` | `instanceKeyFor(user, …)` |
| 1974 | `/logout` busca y borra por `sess.uid` | `instanceKeyFor(stored, …)`: con la clave de usuario no encuentra la instancia y el proceso queda vivo |
| 2025, 2040 | catch-all busca por `sess.uid` | `instanceKeyFor(stored, …)` |
| 2053 | upgrade WebSocket busca por `sess.uid` | idem; si no, el WS muere |
| 2080 | keep-alive de rutinas busca por `user.id` | `instanceKeyFor(user, …)` |
| 2002 | el espejo busca `inst.email === owner.email` | resolver la clave con el usuario guardado (`readUserState(owner.email)`), no con `owner`: este trae `{email, id}`, y sin `legalEntityIds` la clave caería al id y arrancaría una instancia por usuario |
| 2102 | `shutdown` recorre valores | sin cambio |
| 233-235, 1557, 1563 | `gateway_instances` dice "per-user" y cuenta usuarios | pasa a contar tenants; el texto debe decirlo |

### C. Rutas que hoy no pasan por `homeFor` y se rompen en silencio

Estas cuatro no fallan con un error: devuelven nada y el producto pierde una función.

| Línea | Hoy | Consecuencia si no se cambia |
|---|---|---|
| 265-269 | `faberloomMetrics()` lee `dataDir/<id>/faberloom-metrics.json` | con `tenants/` no encuentra el archivo: métricas por workflow a cero |
| 609 | `hasActiveRoutine(userId)` lee `dataDir/<userId>/storages/faberloom_routines.json` | no ve rutinas: el keep-alive (`:2075-2097`) no despierta al tenant |
| 633 | `writeConsolaTokenFile` escribe `dataDir/<user.id>/.consola-token` | el `dsh` lee `home/.consola-token` (`:1441`) y nunca se actualiza: 401 a los 30 min |
| 732-741 | `buildTokenIndex()` escanea `dataDir` y guarda `dir` | `findOwnerByMcpToken` (`:755`) reconstruye un home que ya no existe: el MCP del tenant no responde |

### D. Identidad fijada en el proceso

| Línea | Qué fija |
|---|---|
| 1418 | `FABERLOOM_MIRROR_OWNER: user.email` |
| 1429 | `PROXY_USER_KEY` (identidad de memoria) |
| 1426, 1439, 1441 | `CONSOLA_TOKEN`, `CONSOLA_TOKEN_FILE` |
| 1447, 1449, 1454 | `inst.uid`, `inst.email` y los eventos `dsh_spawn`/`dsh_exit` |
| 1490-1496 | si la instancia vive, `ensureInstance` vuelve antes de `ensureMemoryIdentity` y `refreshConsolaAccess`: el segundo usuario nunca refresca nada |
| 1745 | `exchangeDshToken(inst.port, inst.token)`: mismo proceso y mismo token de web para todos |

## Riesgos explícitos

1. **Sesiones y credenciales compartidas.** Un solo proceso significa un solo token de `dsh`
   (`:1745`), un solo `CONSOLA_TOKEN` y un solo `.consola-token` (`:1441`). Cualquier miembro
   del tenant que entre ve las sesiones de los demás y hereda la credencial del último login.
   El refresh de consola (`:2063`) rota el token de una persona para todo el equipo.
2. **`ownerId` y rol fijados al primer usuario.** `renderPatch(home, user, memory)` (`:1362`)
   graba rol, `readOnly`, entidad y memoria del usuario que arrancó el proceso;
   `FABERLOOM_MIRROR_OWNER` (`:1418`) y `PROXY_USER_KEY` (`:1429`) son los suyos. Un admin
   que entre segundo no obtiene su rol; un `client_b2b` que entre segundo escribe con los
   permisos del primero. `ensureInstance` no re-renderiza el parche mientras la instancia viva.
3. **Auditoría y MCP sin identidad por request.** El gateway autentica el token MCP y busca
   al dueño (`:1941`), pero el socket es el de la casa (`:1953`) y las herramientas corren con
   la credencial del primer usuario. `logEvent` del MCP registra `owner: owner.email` del
   token (`:1959`), no de quien ejecutó. No hay forma de saber qué persona usó qué herramienta.
4. **Aislamiento solo por proceso.** No hay tenant por request, ni RLS, ni filtro por actor:
   el límite es el proceso y la casa. Un error de configuración (dos tenants en la misma
   clave, o un `FABERLOOM_TENANT_HOME=1` en un despliegue con usuarios de empresas distintas)
   los mezcla sin ninguna segunda barrera. `legalEntityIds[0]` puede cambiar de orden entre
   logins y mover a un usuario de casa.
5. **No apto para multi-tenant real.** No sirve para un segundo tenant externo, ni para
   `client_b2b`, ni para un equipo que necesite auditoría por persona o permisos distintos
   dentro del mismo tenant. Para eso está ADR-002 (barrera de aplicación) más ADR-006 (RLS).
   Este ADR no sustituye a ninguno.
6. **Efectos laterales de compartir el ciclo de vida.** `/logout` de un miembro mata el
   proceso de todo el equipo (`:1971-1983`); una caída del `dsh` tumba a todos; cambiar de
   entidad con `/entity` no cambia de casa una vez arrancado el proceso.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Opción A: Mesa central con PostgreSQL y RLS (ADR-006) | Es la dirección elegida y la única con segunda barrera; este ADR no la reemplaza, la presupone cerrada |
| Un `DSH_HOME` por tenant con un proceso por usuario | Dos escritores sobre el mismo `storages`/SQLite viola ADR-001 (un escritor por owner): locks, corrupción, sesiones partidas |
| Enlazar por `symlink` el `storages` de otro usuario | Misma violación de escritor único, y cada proceso seguiría con su propia sesión y credencial: no resuelve nada y agrega un enlace invisible |
| Compartir solo la Mesa exportando una tabla | Crea dos fuentes de verdad y no resuelve sesiones ni agentes; es una versión parcial de A sin sus garantías |
| Tenant por request dentro de un proceso compartido | Es multi-tenant real y exige RLS y actor en cada capa; es A, no B |

## Consecuencias

- **Bien:** dos personas del mismo equipo ven las mismas sesiones, la misma Mesa y los
  mismos agentes sin servicios nuevos ni migración de esquema.
- **Bien:** un `dsh` por equipo en vez de por persona baja memoria y arranques; revertir es
  cambiar una variable.
- **Coste:** la identidad queda congelada en el primer login; el logout es de equipo; la
  auditoría por persona se pierde.
- **Coste:** activar exige las cuatro correcciones de la sección C. Sin ellas el producto
  pierde rutinas, métricas, tokens MCP y refresh de consola sin error visible.
- **Límite:** una sola empresa por despliegue, sin usuarios externos.

## Criterio de activación

Se activa **solo** si se cumplen las cinco condiciones, en este orden:

1. **La Opción A está cerrada.** ADR-006 decidido e implementado para ese tenant, o
   descartado por escrito. No se activan dos cambios de dónde vive el dato a la vez: después
   no se podría atribuir una divergencia a uno de los dos.
2. **Un solo tenant, un solo equipo.** Personas de la misma empresa, sin `client_b2b`, sin
   invitados y sin una segunda empresa en el mismo despliegue. Si hay que preguntar si dos
   usuarios son del mismo tenant, no se activa.
3. **`FABERLOOM_TENANT_HOME=1` en el entorno del despliegue**, no por request ni por usuario.
   El flag se lee en cada llamada, pero el proceso no se reconfigura: activar y desactivar
   exigen reiniciar el gateway.
4. **Antes de encender:** copia de `DATA_DIR` y de `gateway-users.json`, y las correcciones
   de la sección C aplicadas en el mismo cambio que el flag.
5. **Después de encender:** dos cuentas del tenant, una sola instancia
   (`gateway_instances` = 1), un solo `dsh_spawn`, las dos sesiones visibles para ambas, y
   un segundo tenant de prueba que no vea nada.

Si falla cualquiera de las cinco, el flag queda apagado. Apagado es el estado por defecto y
el que se despliega hoy.

## Plan de reversión

1. Quitar `FABERLOOM_TENANT_HOME` (o ponerlo en `0`) y reiniciar el gateway. `homeFor` e
   `instanceKeyFor` vuelven a `<DATA_DIR>/<user.id>` y a `user.id`; los homes por usuario
   siguen intactos porque nunca se movieron.
2. Decidir qué pasa con lo escrito mientras el flag estuvo activo. Vive solo en
   `<DATA_DIR>/tenants/<clave>`: sesiones, `storages` (Mesa, rutinas, tokens MCP) y perfiles.
   Con el gateway detenido, elegir una:
   - archivar `tenants/<clave>` como evidencia y no tocarlo;
   - copiar solo los dominios que se quieran conservar al home del usuario que los seguirá
     usando (`storages/` y `sessions/` por separado, nunca el home entero encima);
   - aceptar que esos datos dejan de verse en el producto y quedan en disco.
3. Los tokens MCP emitidos dentro de la casa del tenant dejan de resolver si esa casa no se
   copió: `buildTokenIndex` reconstruye el índice al arrancar escaneando `DATA_DIR`, y hay
   que re-emitir los tokens desde el panel. Las rutinas vuelven a leerse del home por usuario
   en cuanto exista allí su `storages/faberloom_routines.json`.
4. Verificar: dos usuarios, dos procesos (`gateway_instances` = 2), homes
   `<DATA_DIR>/<id>`, y una sesión nueva en cada uno.

La reversión del código es de minutos y no borra nada. La de los datos no es simétrica: lo
que se escribió en la casa compartida no vuelve solo a los homes por usuario.

## Verificación

- `node --test gateway/tenant-home.test.mjs`: 13 pruebas, 13 en verde. Cubren mismo tenant
  con misma casa y misma clave, tenants distintos con casas distintas, flag apagado con la
  ruta por usuario, precedencia de campos, rechazo de claves vacías o inseguras y el literal
  `'1'` como única activación.
- Manual, solo en el piloto y después de aplicar la sección C: las cinco condiciones del
  criterio de activación.

## Deuda y seguimiento

- Este archivo de pruebas usa `node:test` para poder correr solo; `pnpm test` incluye
  `gateway/tests/**/*.spec.mjs` bajo vitest, así que hoy no lo ejecuta. Moverlo a
  `gateway/tests/tenant-home.spec.mjs` cuando el módulo deje de ser una propuesta.
- `rememberUser` (`:531-553`) debe guardar `tenantId` cuando la consola lo emita, para que
  `legalEntityIds[0]` deje de ser la fuente de la clave.
- Renombrar la métrica `gateway_instances` y su ayuda cuando la clave sea el tenant.
