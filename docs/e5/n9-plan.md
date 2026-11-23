# N9 · plan de terceros para O11 / E5

Estado: **PLAN_N9_COMPLETO**. Este documento cierra la ola O11 como plan documental y no habilita publicar, desplegar ni permitir uso por terceros.

| Campo | Valor |
|---|---|
| Contratos | C-FL-01, C-FL-02, C-FL-04, C-FL-08, C-FL-09, C-FL-10 |
| Ola / etapa | O11 / E5 |
| Paquete | N9 |
| Fecha | 2026-11-23 |
| Reglas cubiertas | 8b, 11b, 11c, 12c, C-R6 |
| Estado del documento | PLAN_N9_COMPLETO |
| Estado externo | NO LISTO PARA TERCEROS |
| Ejecución de la matriz | otro proyecto, con aprobación propia |

Todo lo que sigue es diseño, salvo donde se cita un archivo o un comando que ya existe en este repositorio. Ninguna prueba `P-N9-*` se ejecutó, ninguna credencial se rotó y ningún dato real se revisó para escribir este plan.

## 1. Modo soportado

Modo declarado: **instalación por dueño**. Cada instalación sirve a un dueño, con su propio almacén, sus propias credenciales y sus propias copias; no hay multiempresa compartida y no hay sincronización entre instalaciones.

La justificación cabe en dos líneas: no se construye lo que no se ofrece, y prometer aislamiento entre empresas o sincronización sin pruebas propias sería una garantía sin evidencia.

Consecuencias del modo declarado:

- La identidad es la del dueño de la instalación. Sus perfiles internos, como dos cuentas de correo o dos usuarios de la misma máquina, son usuarios de esa instalación y no tenants separados.
- Un almacén, una copia o un registro pertenece a una instalación. Restaurarlo en otra exige decisión explícita del dueño y queda fuera del soporte normal.
- El soporte no accede a los datos de una instalación con credenciales de otra.
- Una instalación nueva nace vacía: no hereda memoria, lecciones, conversaciones ni credenciales de la anterior.

## 2. Matriz requisito → entrega → responsable → prueba → nivel → gate

Cada fila tiene entrega, responsable, prueba, nivel y gate. Las pruebas `P-N9-*` son futuras y se ejecutan en el proyecto que abra el uso por terceros; aquí solo se nombran. Los niveles son los de la tarea base: C1-L lectura de código, C1-E ejecución reproducible en ambiente aislado, C1-I punta a punta en composición representativa.

| ID | Requisito | Entrega | Responsable | Prueba | Nivel | Gate |
|---|---|---|---|---|---|---|
| N9-01 | 8b · gestión formal de credenciales ANTES_DE_TERCEROS | Inventario de credenciales con dueño, soporte de custodia, caducidad, rotación, revocación y procedimiento de incidente | C-FL-04 prepara; CEO aprueba | P-N9-01: sustituir una credencial en una instalación de prueba, comprobar que la anterior queda rechazada y que la nueva funciona en el mismo alcance | C1-I | GATE-N9-CRED |
| N9-02 | 11b · aislamiento entre usuarios y empresas | Suite de aislamiento del modo declarado: entre instalaciones y entre usuarios de una misma instalación | C-FL-04 con C-FL-02 | P-N9-02: los casos de §5, con rechazo observado y control positivo | C1-I | GATE-N9-ISOLATION |
| N9-03 | 11c · sincronización ampliada si se ofreciera | Declaración de no oferta y rechazo explícito de configuración de sincronización entre instalaciones | C-FL-01 | P-N9-03: intentar configurar sincronización y comprobar que la composición la rechaza en carga, sin degradar a silencio | C1-E | GATE-N9-SCOPE |
| N9-04 | 12c · retención y publicación | Inventario por tipo de dato, plazos, eliminación y revisión previa a publicar | C-FL-08 con C-FL-10 | P-N9-04: eliminar un conjunto sintético y verificar que no queda residuo en almacén, copias ni respaldos del alcance declarado | C1-E | GATE-N9-DATA |
| N9-05 | C-R6 · reevaluación antes de terceros o publicar | Procedimiento de reevaluación: qué evidencia nueva se exige, quién la revisa y qué invalida un pase anterior | C-FL-01 con C-FL-09 | P-N9-05: reabrir la matriz sobre una revisión nueva y comprobar que sin evidencia nueva el veredicto vuelve a NO LISTO | C1-I | GATE-N9-REEVAL |
| N9-06 | Alcance de instalaciones soportado | Declaración de instalación por dueño, sin multiempresa compartida y sin sincronización, publicada junto al producto | C-FL-10 | P-N9-06: dos instalaciones en el mismo host no comparten rutas, credenciales, copias ni registros | C1-I | GATE-N9-SCOPE |
| N9-07 | Datos y credenciales | Inventario de §4 aplicado a una instalación real: qué se conserva, dónde y qué se elimina | C-FL-02 con C-FL-04 | P-N9-07: recorrer el inventario contra el sistema de archivos y la base de la instalación, sin leer contenido real | C1-E | GATE-N9-DATA |
| N9-08 | Responsables | Tabla de dueño y suplente por dato, credencial, artefacto y gate, con nombre y canal de escalado | C-FL-01 | P-N9-08: revisar que ninguna fila queda sin dueño ni con dueño genérico | C1-L | GATE-N9-OWNER |
| N9-09 | Artefactos | Lista cerrada de artefactos publicables: paquetes, imágenes, documentos y datos de ejemplo, cada uno con su revisión | C-FL-08 con C-FL-09 | P-N9-09: ejecutar §3 sobre el candidato y conservar la salida de cada paso | C1-E | GATE-N9-RELEASE |
| N9-10 | Casos de aislamiento | Casos de §5 con entrada, acción, resultado y evidencia exigida | C-FL-04 con C-FL-07 | P-N9-10: suite completa de §5 en composición representativa con dos instalaciones de prueba | C1-I | GATE-N9-ISOLATION |
| N9-11 | Rotación y caducidad | Calendario por credencial, con antelación, ventana, verificación posterior y criterio de caducidad forzada | C-FL-04 con C-FL-08 | P-N9-11: rotar sin corte de servicio y comprobar que la credencial caducada falla de forma explícita | C1-I | GATE-N9-CRED |
| N9-12 | Eliminación | Procedimiento por tipo de dato, incluidos copias y respaldos, con verificación de que el dato no reaparece tras restaurar | C-FL-08 | P-N9-12: eliminar, restaurar un respaldo anterior en aislado y documentar qué reaparece y por qué | C1-E | GATE-N9-DATA |
| N9-13 | Revisión de publicación | Checklist de §3 firmado por revisión independiente y por el CEO antes de publicar cualquier artefacto | C-FL-09 con CEO | P-N9-13: revisión independiente del candidato con hallazgos cerrados o veredicto NEEDS_WORK | C1-E | GATE-N9-RELEASE |

Los gates `GATE-N9-*` no existen como autorizaciones emitidas. Son nombres de la condición que debe cumplirse antes de habilitar; ninguna está concedida y el CEO es quien puede concederlas en el proyecto que ejecute la matriz.

## 3. Revisión de artefactos antes de publicar

El orden es fijo y cada paso conserva su salida. Un paso en rojo detiene la revisión; no se compensa con pasos posteriores en verde.

| Paso | Qué se comprueba | Comando o mecanismo | Criterio de pase |
|---|---|---|---|
| 1 | Candidato y árbol limpio | `git status --porcelain` sobre el árbol de trabajo | Sin cambios sin revisar ni archivos fuera de la lista de artefactos |
| 2 | Secretos | No hay escáner de secretos en `package.json`; se revisa a mano con C-FL-04 y se confirma `git check-ignore -v .env` | Cero canarios, cero claves, `.env` fuera del control de versiones |
| 3 | Datos reales | Revisión de fixtures, adjuntos y ejemplos por C-FL-04 | Solo datos sintéticos y declarados como tales |
| 4 | Higiene de paquetes | `pnpm run hygiene` | Verde, sin omisiones |
| 5 | Duplicación | `pnpm run duplication` | Verde o excepción justificada en el mismo cambio |
| 6 | Licencias de paquetes | `pnpm run verify-dsh-package-licenses` | Verde |
| 7 | Avisos de terceros | `pnpm run verify-third-party-notices`, contrastado con `THIRD_PARTY_NOTICES.md` | Sin diferencias generadas |
| 8 | Referencias, enlaces y documentación | `pnpm run verify-repository-references`, `pnpm run verify-md-links`, `pnpm run verify-public-repository-links`, `pnpm run verify-doc-refs`, `pnpm run verify-md-wrap` | Verde |
| 9 | Veredicto | Revisión independiente C-FL-09 sobre las salidas de 1 a 8 | Sin hallazgos abiertos y con nombre del revisor |

El paso 2 tiene una limitación declarada: este repositorio no incluye un escáner automático de secretos, así que la ausencia de secretos depende de revisión humana y de canarios conocidos. El proyecto que publique debe sustituir esa dependencia por un escáner y registrar su salida.

## 4. Inventario de datos por tipo

Inventario en estado DISEÑO. No hay política de retención ejecutada para terceros; lo único medido en este repositorio es el respaldo de la base `faberloom_mesa`, descrito en `docs/faberloom/mesa-backup.md` con volcado cada 15 minutos, copia fuera del host y objetivo de recuperación de 15 minutos o menos.

| Tipo | Qué se conserva | Dónde | Qué se elimina | Estado |
|---|---|---|---|---|
| Correo | Cuerpo y metadatos de los mensajes que el usuario decide conservar en su espacio; sin copia en el historial de conversación por defecto | Almacén de la instalación bajo su raíz configurada | Mensajes descartados por el usuario y contenido bruto fuera del alcance declarado, según procedimiento por confirmar | DISEÑO |
| Adjuntos | Archivo original íntegro y su conversión declarada, con el límite de formato comprobado | Raíz de adjuntos de la instalación, fuera de la carpeta de sesiones | Adjuntos de mensajes eliminados y conversiones huérfanas | DISEÑO |
| Conversaciones | Registro de sesión por sesión, reconstruible para auditoría del modelo | Un directorio por sesión bajo la raíz de sesiones configurada, con `session.vN.jsonl` o su comprimido `session.vN.jsonl.zstd`, más su proyección en la base cuando la composición la usa | Sesiones eliminadas por el dueño y proyecciones derivadas | DISEÑO |
| Memoria y lecciones | Lecciones aprobadas con su linaje, alcance y fecha de revocación | Almacén de dominio de la instalación, con registro JSON o SQLite según la composición | Lecciones revocadas y propuestas descartadas; la revocación conserva el hecho, no el contenido usado | DISEÑO |
| Credenciales | Referencias y valores cifrados o en archivo privado, nunca en la conversación ni en la configuración versionada | Archivo privado de credenciales de la instalación, por defecto `.credentials.yaml` bajo el home del arnés, o el proveedor que la composición declare | Credencial revocada, con rechazo inmediato de la anterior | DISEÑO |
| Registros | Eventos de operación, consumo y errores, con identificador de instalación | Telemetría de la instalación y sus exportaciones | Eventos fuera de la ventana de diagnóstico acordada | DISEÑO |
| Copias | Copias de trabajo y material temporal generado por herramientas | Raíz temporal de la instalación, separada del almacén | Copias al cerrar la operación y al eliminar el dato de origen | DISEÑO |
| Respaldos | Volcado de la base y del almacén con verificación de su propio artefacto | Destino de respaldo de la instalación y copia fuera del host | Respaldos fuera del plazo acordado, con prueba de que el dato eliminado no reaparece | DISEÑO |

## 5. Casos futuros de aislamiento

Casos de diseño. Cada uno exige dos instalaciones o dos usuarios de prueba y evidencia conservada; ninguno se ejecutó.

| Caso | Entrada | Acción | Resultado esperado | Evidencia exigida |
|---|---|---|---|---|
| A1 · Instalaciones vecinas | Dos instalaciones en el mismo host, cada una con su raíz | Abrir una sesión en A y listar sesiones, almacén y credenciales | Solo aparecen los datos de A; B no es visible ni enlazable | Listado de rutas resueltas por A y por B, más el rechazo al pedir una ruta de B |
| A2 · Respaldo ajeno | Respaldo de B presentado a A | Intentar restaurar el respaldo de B en A | Rechazo explícito por identidad de instalación, sin restauración parcial | Mensaje de rechazo con la identidad esperada y la recibida, y almacén de A intacto |
| A3 · Usuarios de una instalación | Dos usuarios de la misma instalación con perfiles distintos | Abrir la conversación de un usuario desde el otro | Rechazo por autorización; el contenido no llega al segundo usuario | Registro de la denegación y comprobación de que el cuerpo no aparece en la respuesta |
| A4 · Credencial de otro perfil | Credencial guardada por el usuario 1 | Invocar una herramienta que la necesita desde el usuario 2 | La herramienta no resuelve la credencial y falla de forma explícita, sin usar la del arnés | Salida de la herramienta con el motivo y confirmación de que la credencial sigue en poder del usuario 1 |
| A5 · Archivo fuera del alcance | Ruta absoluta fuera del espacio autorizado | Leerla y escribirla desde una herramienta de archivos | Ambas operaciones se rechazan; el intento queda registrado | Rechazo con la ruta solicitada y el alcance permitido, más ausencia de cambio en el archivo |
| A6 · Memoria de otro espacio | Lección aprobada en el espacio de A | Consultar desde el espacio de B y desde una instalación nueva | No se recupera la lección; sin base, la respuesta se abstiene en lugar de proponer | Resultado de la consulta con el espacio usado y la abstención declarada |
| A7 · Herramienta que cruza espacios | Herramienta configurada para un destino de A | Ejecutarla desde B | Rechazo en carga o en ejecución según dónde se declare el destino; nunca ejecución silenciosa en A | Configuración rechazada o error de ejecución, con el destino nombrado |
| A8 · Sincronización no ofrecida | Configuración que intenta emparejar dos instalaciones | Cargar la composición | La configuración se rechaza de forma explícita; no se degrada a modo local silencioso | Error de carga con la clave rechazada y arranque limpio sin sincronización |
| A9 · Artefacto con datos reales | Paquete o imagen candidata con un fixture tomado de un buzón real | Ejecutar §3 antes de publicar | La revisión se detiene en el paso 3 y no hay publicación | Salida del paso 3 con el archivo señalado y el candidato descartado |
| A10 · Registro con identificador cruzado | Exportación de registros de A y de B | Unir ambas exportaciones y filtrar por instalación | Cada evento queda atribuido a su instalación; una exportación sin identificador se rechaza | Exportaciones separadas y el rechazo del registro sin identificador |

## 6. Gate

Estado externo: `NO LISTO PARA TERCEROS`.

Nada de este documento autoriza publicar, distribuir ni permitir uso por terceros. El plan no sustituye la ejecución de la matriz ni la aprobación del CEO, y no cuenta como certificación parcial de ninguna regla.

La ejecución de la matriz ocurre en otro proyecto, con su propia aprobación, su propio presupuesto y su propia evidencia. El primer evento entre publicar y permitir uso por terceros activa el gate; hasta entonces el piloto sigue siendo de uso propio del dueño.

El gate se abre solo cuando las trece filas de §2 tienen evidencia del nivel exigido, la revisión de §3 está cerrada sin hallazgos y el CEO registra la autorización correspondiente. Un pase anterior no se hereda: C-R6 exige reevaluar sobre la revisión nueva.

## 7. Qué no se construye en el piloto

- Multiempresa compartida: el modo declarado es instalación por dueño. Construir tenants compartidos sin casos de aislamiento probados convertiría una limitación declarada en una fuga silenciosa.
- Sincronización entre instalaciones: no se ofrece, así que no se implementa ni se deja a medio camino. Una función a medio construir invita a usarla.
- Editor de temas: no es requisito de N9 ni del piloto; añadirlo amplía superficie de publicación sin evidencia asociada.
- Retención formal de terceros: el piloto conserva y elimina según lo que el dueño decida sobre su propia instalación. Una política de retención para terceros exige contratos, plazos y verificación de eliminación en copias y respaldos, y eso pertenece al proyecto que abra el uso por terceros.

Cada exclusión tiene el mismo motivo: no se construye lo que no se ofrece, y no se ofrece lo que no se puede probar con evidencia propia.
