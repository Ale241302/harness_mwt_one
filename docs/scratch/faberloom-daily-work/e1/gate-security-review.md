# Revisión de seguridad del gate O3

- Alcance: cerrar el gate O3 con T10-E1 en las superficies montadas
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Método: lectura del código de cada camino que llega al cable, pruebas ejecutadas, y censo de vías por composición
- Nivel: C1-E (pruebas) + C1-L (composición) + C1-J (juicio)
- Estado: **READY_FOR_CEO**
- Autor: faberloom-implementer · Revisor independiente: pendiente

## 1. Modelo de confianza

| Actor | Puede | No puede |
|---|---|---|
| Persona con la sesión del navegador | Leer, redactar, guardar borradores y enviar el borrador que ve | Enviar una versión que no vio (`DRAFT_CHANGED`) |
| Modelo (agente, Space, rutina) | Leer, preparar, proponer | Enviar, escribir o aprobar: toda herramienta de escritura rechaza |
| Cliente MCP con el token del dueño | Leer y gestionar el trabajo; aceptar ítems | Producir un envío en E1: no hay adaptador montado |
| Contenido externo (correo, web, MCP) | Entrar como dato | Convertirse en autorización: el clasificador propone, no aprueba |
| Plugin en proceso | Todo, incluido `connections.smtp()` | Nada lo limita: es código de confianza de la composición |

## 2. Hallazgos

### S-1 · La guarda de versión no corría en la vía real · **cerrado**

`sendDraft` comparaba `seenUpdatedAt` solo si venía, y el único llamador de la UI no lo enviaba: el panel enviaba lo guardado sin comprobar que fuera lo revisado. Corregido en toda la cadena (conexiones, view, remoto, panel) y fijado con una prueba que exige rechazo cuando falta la versión. Es el defecto H-6 del censo, que O3-02C había dado por cerrado con una guarda que nadie invocaba.

### S-2 · La política de destinos era un archivo · **cerrado**

`egress-policy.json` no lo leía nadie. Ahora `imap`, `smtp`, `sendMail` y `probe` consultan `FABERLOOM_EGRESS_DENY`/`ALLOW` antes de entregar la credencial. `probe` era la puerta de atrás: abría un socket con la clave guardada a cualquier host.

### S-3 · El paquete `notices` fuera del programa de tipos · **cerrado**

No estaba en `tsconfig.host.json`, así que `pnpm run typecheck` no lo compilaba, y la proyección de documentación no lo veía. Un paquete que publica un servicio y no entra en el agregado es código que ningún gate mira. Corregido: referencia en el tsconfig host, `SERVICE_PAGE` y tipos enlazados.

### S-4 · Aprobación por MCP con el adaptador montado · **abierto, dueño E2**

`faberloom_board_approve_with_execution` y `faberloom_board_dispatch_effect` existen como herramientas MCP. Con `FABERLOOM_EFFECT_ACTION_TYPES=mail.send` y el adaptador montado, un cliente con el token del dueño podría aceptar y despachar un envío sin una persona delante. En E1 no hay adaptador: el despacho responde `EFFECT_NO_ADAPTER` y el ítem queda `PENDIENTE` (probado). **Condición para E2**: el adaptador no se habilita hasta que la aprobación fije el cuerpo exacto y el firmante sea humano; el token del cliente MCP no debe sustituir esa firma.

### S-5 · Código de confianza con acceso a la credencial · **abierto, asumido**

`connections.smtp()` e `imap()` devuelven la clave a cualquier llamador en proceso. La custodia impide que llegue al modelo, a un log o a un mensaje de error; no pretende contener un plugin hostil, que ya ejecuta con los permisos del proceso. El piloto monta solo paquetes del propio producto y no instala plugins de terceros.

### S-6 · Credenciales y copias expuestas · **abierto, dueño CEO**

Las contraseñas de los dos buzones, el token de Hostinger, la clave del proveedor y la contraseña root del VPS siguen sin rotar; las copias 3, 4 y 5 siguen fuera del control del producto. Fuera del alcance de E1, registrado desde F0.

### S-7 · Subagente con modelo real · **abierto, dueño E2**

El hijo delega en el mismo registro de herramientas, así que ejecuta el mismo `faberloom_mail_send` que rechaza. Lo probado es ese ejecutor y el censo que impide un segundo emisor; un hijo que razone de verdad necesita proveedor y clave, y pertenece a E2.

### S-8 · Segundo envío manual sin guarda de versión · **nota**

`sendSpaceFileByEmail` manda un archivo del Space con asunto y cuerpo escritos en la llamada. No tiene guarda de versión porque no hay borrador guardado: el texto que se envía es el que la persona escribió en esa llamada. El archivo se limita a la carpeta del Space. Riesgo residual: un cliente autenticado del BFF puede mandar cualquier texto y cualquier archivo de esa carpeta; es una acción humana con la sesión del dueño, no una ruta del modelo.

## 3. Controles verificados

| Control | Cómo se verificó |
|---|---|
| Un solo punto de salida por archivo | censo `effect-census` con lista cerrada de tres archivos |
| Ninguna herramienta del agente envía | `mail-send-denied` con grant real |
| Ningún paso de flujo o rutina envía | `t10-effect-false` con y sin grant, con y sin `effect` |
| La UI envía solo lo revisado | `drafts.spec` (3 casos) + prueba del panel |
| El MCP no produce envío en E1 | `EFFECT_NO_ADAPTER`, adaptador no registrado sin tipo aceptado, `mcp.call` cerrado sin autoridad |
| El secreto no sale por ninguna superficie cercana | canario en descripción, rechazo, error, aviso y log |
| Ningún host no autorizado recibe credencial | `egress.spec` (9 casos), incluido `probe` |
| Un grant no es una aprobación | `t10-effect-false` y `mail-send-denied` |
| La firma comodín está apagada | `allowWildcardSignatures: false` en la composición |

## 4. Lo que esta revisión no cubre

- Un modelo real intentando convencer al sistema (prompt injection de extremo a extremo): necesita proveedor y E2.
- El cliente MCP autenticado usado por una IA distinta del dueño: el token identifica al dueño; la delegación de ese token es una decisión del CEO.
- La seguridad del VPS, del proxy y del TLS: infraestructura, no producto.
- Copias y restauración: O5-07A.

## 5. Veredicto

El gate O3 queda cerrado para E1: ninguna vía montada produce un envío sin una persona, y las vías ausentes están declaradas. El riesgo que queda abierto es de E2 (habilitar el adaptador con aprobación exacta) y del CEO (rotación y copias).
