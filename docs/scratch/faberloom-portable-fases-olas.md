---
title: Plan de ejecución FaberLoom portable por fases y olas
description: Plan de trabajo, contratos de agentes y verificación de la portabilidad de FaberLoom dentro de deepseek-harness.
owner: Alejandro, con decisiones de producto de Álvaro
created: 2026-11-05
expires: 2026-12-05
status: proposed
---

# FaberLoom portable: plan de ejecución por fases y olas

English | [中文](faberloom-portable-fases-olas.zh.md)

## Summary

Este documento de trabajo, redactado en español por solicitud del usuario, convierte el paquete recibido en 43 olas ejecutables dentro de `deepseek-harness`. Cada ola identifica entradas, responsables, creación, modificación, corrección, comparación, pruebas, aceptación y recuperación. El harness de verificación propuesto vincula requisitos, cambios, pruebas y evidencias; rechaza un cierre cuando falta cualquiera de esos vínculos. El contenido describe trabajo por realizar, no funciones certificadas ni autorización para ejecutar las fases.

Tipo documental: referencia de planificación temporal en `docs/scratch/`. Fecha de revisión: 2026-11-05. Al vencer, Alejandro revisa el alcance y renueva o cierra el documento; los acuerdos duraderos pasan a Agent Notes y la funcionalidad demostrada a las referencias de sus paquetes. Las reglas de documentación bilingüe mantienen el selector convencional del repositorio.

## Table of Contents

- [1. Lectura completa y línea base](#1-lectura-completa-y-línea-base)
- [2. Alcance, decisiones y dependencias](#2-alcance-decisiones-y-dependencias)
- [3. Contratos de agentes y skills](#3-contratos-de-agentes-y-skills)
- [4. Archivos y responsabilidades](#4-archivos-y-responsabilidades)
- [5. Harness de verificación y comparación](#5-harness-de-verificación-y-comparación)
- [6. Fases y olas](#6-fases-y-olas)
- [7. Matriz de las 58 pruebas del paquete](#7-matriz-de-las-58-pruebas-del-paquete)
- [8. Recorrido completo de validación](#8-recorrido-completo-de-validación)
- [9. Evaluación y cierre](#9-evaluación-y-cierre)
- [10. Esfuerzo y coordinación](#10-esfuerzo-y-coordinación)
- [11. Entrega entre agentes](#11-entrega-entre-agentes)
- [Dev Note](#dev-note)

## 1. Lectura completa y línea base

La lectura completa corresponde al paquete de entrada: seis archivos y sus tres subcarpetas. La inspección de `deepseek-harness` es dirigida a los consumidores y mecanismos afectados; no constituye una lectura integral de dependencias, compilados, cachés ni de todo el monorepo.

### 1.1 Inventario del paquete

Las rutas siguientes parten de la carpeta hermana `Paquete-Alejandro-FaberLoom-2026-11-05/`. Son referencias al material recibido, que no se distribuye automáticamente con el repositorio.

| Archivo leído completo | Extensión de la lectura | Aporte al plan | Tratamiento |
|---|---|---|---|
| `00-LEEME.md` | Líneas 1 a 53 | Prioridad del plan vigente, decisiones y material ausente | Conservar restricciones de ejecución y decisiones abiertas |
| `01-Plan-FaberLoom-portable-por-fases.md` | Líneas 1 a 663 | Alcance vigente, fases, recorrido y 58 pruebas | Autoridad de requisitos para este desglose |
| `02-referencia/PLAN-ALEJANDRO-original.md` | Líneas 1 a 449 | Alcance original, 30 pruebas y consumidores | Comparar cada sección 1 a 14 contra el plan vigente |
| `03-revision-astra/ronda-1.md` | Líneas 1 a 209 | Git/MinIO, UX, primer ciclo y límites por host | Conservar mejoras incorporadas; revisar propuestas supersedidas |
| `03-revision-astra/ronda-2.md` | Líneas 1 a 91 | Restauraciones, separación lectura/propuesta, aprobación y aplicador | Requisitos negativos obligatorios de las olas 1 y 3A |
| `04-prototipo/armar_plugin.py` | Líneas 1 a 215 | Implementación de referencia del generador | Leer como antecedente; no ejecutarlo ni convertir su salida en oráculo |

La segunda ronda corrige la primera: no se usa el mensaje de conexión lista sin confirmar carga, ni se promete copia local accesible desde cualquier chat. El plan vigente restaura los alcances debilitados y añade 28 casos a los 30 originales. Este documento conserva los 58 identificadores por separado en la sección 7.

### 1.2 Evidencia local observada

Se consultaron `git status --short`, `git branch --show-current` y `git rev-parse HEAD`: rama `main`, árbol limpio antes de esta documentación y HEAD coincidente con la revisión de Astra. El identificador completo quedó en la salida de la sesión; el futuro `run.json` lo captura como evidencia de ejecución, sin incrustarlo en prosa mantenida, conforme al verificador de referencias del repositorio.

| Evidencia inspeccionada | Resultado estático | Consecuencia para las olas |
|---|---|---|
| `package.json` | Versión `0.1.8-alpha.1`, pnpm `11.7.0`, Node `^22.19.0 || >=24.0.0` | Registrar runtime y gestor antes de ejecutar; no equiparar versión local con despliegue |
| [Arquitectura](../architecture.md) y [política de pruebas](../testing.md) | Composición Cordis, launcher, pruebas reales de composición y snapshots | Extender servicios/plugins y las vías existentes de verificación |
| `scripts/run-gates.ts` | Planificador de comprobaciones con dependencias y estados passed/failed/skipped | Reutilizarlo para integrar verificadores, sin un segundo motor general |
| `vitest.config.ts` | Incluye specs de paquetes, apps y scripts; cobertura por archivo | Mantener los umbrales existentes; cobertura de líneas no sustituye aceptación |
| `packages/faberloom/` | Existen servicios de espacios, contexto, Mesa, memoria, ejecución y proyección | Conservar sus responsabilidades y probar regresión |
| `packages/faberloom/view/tests/` | Casos de aprobaciones, efectos, iteraciones, exportación y preparación de harness | Ampliar casos de usuario sobre consumidores reales |
| `packages/client/ui-faberloom/src/client/` | `components.tsx`, `panels.tsx`, `store.ts`, `locales.ts`, `harness-install.tsx` | Integrar la revisión de propuestas y estado dentro de la UI existente |
| [Checklist F01 a F50](../faberloom-e2e-checklist.md) | Catálogo previo de verificaciones automáticas y manuales | Mantenerlo como regresión adicional; no confundir listado con ejecución |
| `node --version` | `v22.22.2` | Versión observada compatible con la declaración de engines |
| `pnpm --version` | Fuera del PATH, pero `corepack pnpm --version` responde `11.7.0` y `node_modules` ya existe | Invocar el gestor como `corepack pnpm`; no hace falta instalación global |

No se ha certificado la Consola, un IdP, MinIO desplegado, cuentas de hosts ni producción. `build_faberloom.py` y la rama `faberloom-espacios` de `mwt-knowledge-hub` son material anunciado por Álvaro, ausente del paquete. Su revisión se programa como entrada pendiente, no como trabajo ya comprobado.

### 1.3 Correcciones concretas del prototipo

| Código leído | Deficiencia que debe resolver el reemplazo | Ola |
|---|---|---|
| `copiar_arbol`, líneas 40 a 48 | Solo comprueba enlaces de archivos; completar directorios, junctions, alias y carreras | 3A.2, 3B.2 |
| `agente_limpio`, líneas 58 a 67 | Reduce metadatos a nombre/descripción y mueve skills al cuerpo; pierde restricciones | 3B.3 |
| `sin_rutas_externas`, líneas 70 a 71 | Elimina líneas con regex sin resolver dependencias ni demostrar aislamiento | 3A.2, 3B.1 |
| Herencia, líneas 110 a 116 | Copia reglas de padres sin modelo completo de permisos por contribución | 3B.1 |
| Huella, líneas 163 a 178 | Calcula versión antes de incorporar todos los archivos y la identidad final | 3A.2, 3B.3 |
| `.mcp.json`, líneas 173 a 174 | Endpoint local y variable global de token no resuelven chat remoto ni coexistencia | 1.4, 4A.1 |
| `main`, líneas 198 a 211 | Comprobación de solapamiento inicial, seguida de borrado previo a reemplazo | 3B.2 |

La comparación con el prototipo preserva contenido y capacidades intencionales, pero exige diferencias explícitas en estos defectos. No se replica una conducta insegura para obtener igualdad byte a byte.

## 2. Alcance, decisiones y dependencias

El resultado es FaberLoom portable desarrollado en este monorepo: hogar local, espacios/subespacios, contexto autorizado, propuestas en Mesa, aprobación humana y publicación verificable, con MWT opcional y adaptadores por host.

### 2.1 Invariantes de producto

1. FaberLoom conserva autorización y reglas de negocio; los adaptadores traducen capacidades.
2. El contenido editorial aprobado tiene una autoridad Git; MinIO conserva publicaciones derivadas inmutables.
3. Contexto operacional, memoria, workflows, sesiones y credenciales conservan sus autoridades respectivas. Sesiones y transcripciones quedan fuera del paquete portable, incluso como recursos o dependencias de un espacio autorizado; las credenciales también quedan fuera.
4. Una identidad local no concede acceso MWT. MWT apagado implica ausencia de herramientas, tráfico, sondeo y reintentos.
5. La IA propone; una persona autenticada aprueba un ítem, base y diff exactos; el aplicador revalida antes de escribir.
6. Lectura, propuesta y aprobación son permisos diferentes. Un permiso amplio, un propietario o un identificador del cliente no demuestran acción humana.
7. Cada lectura editorial queda fijada a una revisión; contexto operacional vivo se identifica por separado.
8. Un error conserva el trabajo y muestra el siguiente paso; recepción, publicación y carga solo se afirman con evidencia correspondiente.
9. Ningún plugin Claude/ChatGPT llama ocultamente a otro modelo. DSH conserva su composición multimodelo autorizada.
10. El aislamiento se comprueba en bytes, permisos, estado y efectos, además del comportamiento conversacional.

### 2.2 Decisiones, bloqueos y resoluciones

| ID | Decisión o entrada | Estado y responsable | Trabajo que bloquea | Resultado |
|---|---|---|---|---|
| D01 | Superficie Claude y cuenta de prueba | resuelta · arquitectura (2.2.1) | Certificación 4A y 4B | Code primero; chat y Cowork abiertos |
| D02 | Servicio remoto y vínculo voluntario del hogar | resuelta · arquitectura (2.2.1) | 1.4 y 4A.3 | Sin servicio remoto en el primer corte; operador designado |
| D03 | Fuente Git canónica y bibliotecario técnico | resuelta · arquitectura (2.2.1) | 3A.1 | Repositorio de conocimiento por organización; actor técnico de `publication` |
| D04 | Exportación y clases CEO-ONLY/N3/N4 | resuelta · arquitectura (2.2.1) | 3A.2 y 7A | Excluidas por lista de permitidos; clasificación desconocida denegada |
| D05 | Herencia y actualización de revisiones | resuelta · arquitectura (2.2.1) | 3A.2 y 3B.1 | Herencia explícita por contribución; gana el hijo; la exclusión prevalece |
| D06 | MinIO de prueba, edición, retención y retiro | abierta · plataforma y Álvaro | Cierre 3A.3 | Evidencia de permisos, recuperación e inmutabilidad real |
| D07 | OAuth de prueba, clientes, redirects y permisos | abierta · identidad y operador autorizado | Uso del entorno 1.4 y 5.1 | Metadata y clientes compatibles sin secretos en el paquete |
| D08 | Proveedor de modelos y hogar local | resuelta · arquitectura (2.2.1) | 2.1 y 2.3 | BYOK certificado; hogar fuera de carpetas sincronizadas |
| D09 | Umbrales UX y personas representativas | abierta · Álvaro y UX | Cierre 4A.3 y 4B.3 | Confirmar o ajustar conexión ≤5 min y ciclo ≤10 min |
| D10 | Ventana de revocación y múltiples instalaciones | abierta · Álvaro e identidad | Cierre 5.3 | Límite medible y política de operaciones en curso |
| D11 | Piloto Marluvas o Eguisa y capacidad del equipo | abierta · Álvaro y coordinación | 7A | Tarea, persona, datos exportables y agenda |
| D12 | Hosts, versiones y sistemas soportados | abierta · producto y QA | Cada 6 y distribución 7B | Matriz explícita; Windows primero como recomendación |
| D13 | Compartir `build_faberloom.py` y rama de KB | abierta · Álvaro | Sustitución en 3B.3 | Copia revisada, consumidores y comparación con requisitos |
| D14 | Acceso de lectura a la Consola MWT y acuerdos | abierta · operador de Consola | Certificación real 5 | Backend, grants, cachés, RBAC y pruebas conjuntas |

Una dependencia pendiente bloquea su trabajo dependiente. Por ejemplo, D14 no impide el generador sintético; D06 sí impide declarar publicación MinIO demostrada. Una decisión resuelta fija el diseño, pero su entrada operativa —cuenta, repositorio de prueba, almacén MinIO— sigue siendo requisito de demostración y puede mantener abierta la ola que la consume. La elección de `harness.mwt.one` en el paquete es una recomendación, no permiso para usar producción.

#### 2.2.1 Decisiones tomadas el 2026-11-05

Las seis decisiones siguientes se tomaron desde arquitectura para desbloquear 0.2. Fijan el diseño; una ratificación de producto posterior puede endurecerlas, nunca ampliarlas sin una decisión registrada.

**D01 — Superficie Claude y cuenta de prueba.** La primera superficie certificada es Claude Code, en su interfaz de línea de comandos y en su extensión de escritorio, sobre la versión que se fije al abrir 4A.1. La cuenta es una cuenta de organización dedicada, distinta de la personal, sin rol de administrador de la organización, con capacidad de instalar plugins y servidores MCP locales, sin datos de cliente, registrada junto con la versión en el `run.json` de la ola. Chat web y Cowork no heredan esa certificación: dependen de un endpoint remoto (D02) y de su propio recorrido en 4B. Si la cuenta no permite instalar el mecanismo, 4A queda abierta y no se sustituye la superficie.

**D02 — Servicio remoto y vínculo del hogar.** El primer corte no expone el hogar fuera de la máquina. El servicio remoto queda designado al equipo de plataforma de FaberLoom, con un responsable que Álvaro nombra, y se construye solo en la ola que lo requiera, en un entorno propio con autoridad de Mesa propia. El vínculo entre hogar y cuenta remota es voluntario por instalación, de un solo uso y revocable; quedan prohibidos el túnel improvisado y el endpoint público por defecto. 1.4 se certifica con endpoint local y 1.5 cierra Fase 1 en Code; el chat remoto de 4A.3 permanece declarado abierto.

**D03 — Git canónico y bibliotecario.** La autoridad editorial es un repositorio Git de conocimiento por organización, distinto de este monorepo; el repositorio del negocio (`mwt-knowledge-hub`) es el candidato designado, con una rama de publicación dedicada por entorno y protegida. El único escritor es un actor técnico propiedad del paquete `publication`; las personas no escriben en Git, aprueban en Mesa. La aplicación se condiciona a la revisión base mediante comparación y actualización condicionada, sin `force-push` ni reescritura de historia publicada, y un conflicto devuelve la propuesta a revisión. El acceso de prueba a ese repositorio sigue siendo una entrada operativa: si falta, 3A.1 usa un repositorio sintético con la misma estructura y la designación canónica no cambia.

**D04 — Clases excluidas de la exportación.** CEO-ONLY, N3 y N4 quedan excluidas del artefacto portable en todos los cortes. La exportación usa lista de permitidos y evalúa la clasificación en servidor; una clasificación ausente o desconocida se deniega. Lo excluido no aparece en inventario, manifiesto, contexto ni títulos, y no se emite un marcador de contenido redactado. Ampliar el alcance exige una política versionada con nueva aprobación; ningún cliente ni propuesta cambia la regla en ejecución.

**D05 — Herencia y versiones.** Reglas de resolución:

1. Un hijo recibe del padre solo contribuciones marcadas como heredables y para las que el actor tiene acceso por contribución; pertenecer a la organización no concede nada.
2. Para el mismo tipo e identificador prevalece el hijo. Un conflicto de nombres no se resuelve por orden de lectura: se rechaza y exige renombrar o declarar un alias que firme el dueño del hijo.
3. Una exclusión declarada en el hijo prevalece sobre la herencia del padre.
4. Cada export fija la revisión del padre utilizada. Un cambio del padre no altera publicaciones existentes: identifica los hijos afectados y abre una propuesta de nueva revisión que requiere aprobación humana.
5. La herencia alcanza solo la profundidad declarada; los ciclos y las autorreferencias se rechazan al cargar, antes de generar.
6. La referencia de trabajo fija espacio, revisión y herencia al abrirse y no se recalcula a mitad de conversación.

**D08 — Proveedor y hogar local.** El primer arranque elige un modo explícito, sin valor por defecto silencioso:

1. Nube con clave del usuario (BYOK) contra un endpoint compatible con OpenAI. Es el modo que certifica 2.3.
2. Endpoint local compatible con OpenAI (Ollama o vLLM) para un hogar sin red; se certifica como modo secundario y no promete paridad de calidad.
3. La credencial vive en el almacén seguro del host (Windows Credential Manager o DPAPI) y nunca en el artefacto, un archivo compartido o un log.
4. El hogar es un directorio por instalación con identidad local estable, fuera de carpetas sincronizadas o de red (OneDrive, Dropbox, rutas UNC). Este checkout vive bajo OneDrive, así que la regla se valida al crear el hogar y la ubicación del repositorio no se hereda.
5. El esquema del hogar es versionado con migración monótona; los datos de otro hogar no se importan automáticamente.
6. SICOP se configura aparte; su fallo no bloquea el arranque ni se presenta como una operación realizada.

El primer corte de código recomendado es 1.1 con H0, porque no depende de Desktop, de red ni de MinIO; 2.1 puede avanzar en paralelo una vez cumplida la regla de ubicación de D08.

### 2.3 Orden de ejecución

```text
0.1 -> 0.2 -> 0.3 -> 0.4
                     |-> 1.1 -> 1.2 -> 1.3 -> 1.4 ---------|
                     |-> 2.1 -> 2.2 -> 2.3                 |
                     |-> diseño 3A                        |
1.1 + 1.2 + 0.4 -------> 3A.1 -> 3A.2 -> 3A.3 -> 3A.4 ---|
1.4 + 3A.3 ------------> 3A.4 -> 1.5 (cierre de Fase 1)
1 completa + 3A completa -> 4A.1 -> 4A.2 -> 4A.3
3A completa -> 3B.1 -> 3B.2 -> 3B.3 -> 3B.4
4A + 3B -> 4B.1 -> 4B.2 -> 4B.3
2 + 4B -> 5.1 -> 5.2 -> 5.3 -> 5.4
3B + 4B -> 6A / 6B / 6C / 6D, cada una autorizada y acotada
4B + exportacion aprobada + integraciones usadas -> 7A.1 -> 7A.2
7A + hosts certificados + autorizacion operativa -> 7B.1 -> 7B.2 -> 7B.3
```

El diseño de 3A puede avanzar desde Fase 0; el aplicador que produce efectos depende de la aprobación humana de 1.1 y de la identidad de propuesta de 1.2. 1.4 entrega autorización y referencias; 3A.4 entrega el lector efectivo; 1.5 cierra Fase 1 demostrando lectura y propuesta en la misma conexión. 4A puede cerrarse con un runtime de prueba disponible antes de 2; la entrega base completa exige 2. El piloto 7A no espera adaptadores que no utiliza. En paralelo solo se ejecutan tareas con archivos y decisiones independientes.

## 3. Contratos de agentes y skills

Los nombres siguientes son IDs disponibles en el catálogo de agentes de esta sesión OpenCode. Son responsables de trabajo y revisión; no son identidades de negocio con derecho a aprobar propuestas en Mesa. La autorización humana de producto permanece separada.

### 3.1 Contrato común de una asignación

Cada asignación recibe `waveId`, objetivo observable, requisitos, archivos permitidos, contratos de entrada versionados, decisiones resueltas, restricciones, comandos autorizados, criterios de aceptación y presupuesto de intentos. Devuelve archivos cambiados, evidencia de comandos, comparación con la base, riesgos, dudas y estado. El coordinador rechaza una entrega que solo diga que el trabajo está terminado.

| Agente del catálogo | Entrada y responsabilidad | Puede cambiar | Entrega obligatoria | Revisor / condición de rechazo |
|---|---|---|---|---|
| `planner` | Alcance y dependencia por ola; mantener los 58 casos | Plan y registros de asignación | Cobertura requisito→ola→prueba, decisiones y siguiente trabajo | `reality-checker`; rechaza requisitos huérfanos |
| `architect` | Topología Cordis, datos y consumidores | Contratos y módulos asignados de composición/portable | API, consumidores, migración, recuperación y decisión de ubicación | `code-reviewer`; rechaza segundo motor de negocio en adapters |
| `backend-architect` | Propuestas, Mesa, aplicador y publicación | `packages/faberloom/` asignados | Implementación y pruebas de estado, concurrencia y fallo | `security-reviewer` + QA; rechaza efecto sin aprobación |
| `identity-access-engineer` | Identidades, OAuth, scopes y referencias de trabajo | Módulos asignados de conexión/MCP y DTO consumidores | Matriz actor/recurso/operación, revocación y pruebas adversas | `security-reviewer`; rechaza autoridad autodeclarada |
| `desktop-app-engineer` | Inicio local, hogares y credenciales del host | `apps/desktop/` y composición asignada | Instalación limpia, actualización y conservación local | QA; rechaza tráfico MWT con integración apagada |
| `frontend-developer` | Mesa legible, conexión y estado | `ui-faberloom`, view y locales asignados | Estados vacíos/carga/error, acción real y evidencia UI | `accessibility-auditor` + QA; rechaza éxito no confirmado |
| `developer-tooling-engineer` | Generador, adaptadores, empaquetado y comandos de desarrollo | Módulos portable y scripts asignados | Artefactos, inventario, conversión de capacidades y determinismo | `code-reviewer`; rechaza eliminación silenciosa de restricciones |
| `test-automation-engineer` | Harness y casos derivados de requisitos | Tests, fixtures sintéticos y verificadores | Caso positivo, negativo, recuperación y resultado independiente | `evidence-collector`; rechaza pruebas que solo repiten el código |
| `security-reviewer` | Revisión independiente del diff y rutas alternativas | Lectura; recomendaciones de corrección | Hallazgos con severidad, ruta, reproducción y efecto | `reality-checker`; no autocertifica una corrección propia |
| `accessibility-auditor` | Uso de teclado, lector, contraste y mensajes | Lectura y evidencia de interacción | Barreras por control, estado y entorno realmente probado | QA; lo no probado queda no comprobado |
| `evidence-collector` | Comparación de recibos, persistencia, Git, archivos, host y red | Evidencias saneadas, no resultados esperados | Observaciones reproducibles y referencias a artefactos | `reality-checker`; rechaza capturas sin correlación |
| `devops-automator` | MinIO de prueba, CI, distribución y recuperación | Infraestructura explícitamente asignada/autorizada | Retención, permisos, restore y evidencia CI | Seguridad + producto; no ejecuta producción por inferencia |
| `technical-writer` | Documentación del comportamiento ya demostrado | README, guías, matriz soporte y notas asignadas | Instrucciones verificadas y pares documentales | `code-reviewer`; rechaza catálogos manuales divergentes |
| `reality-checker` | Dictamen de ola y fase con fuentes independientes | Informe de evaluación | Demostrado/refutado/no comprobado/no aplicable por requisito | Producto; no modifica pruebas para convertir un fallo en éxito |

Un mismo agente puede asumir trabajo serial en varios componentes; no puede ser el único verificador de su propio cambio de autorización, persistencia, aplicador o publicación. Una revisión por otro agente con el mismo modelo aporta contexto independiente, pero no equivale a independencia de proveedor ni a prueba en ejecución.

### 3.2 Skills del catálogo OpenCode por momento

Esta tabla prescribe qué skill cargar al ejecutar cada trabajo, no declara que todas se hayan invocado al preparar el documento. Se cargan por necesidad y se registra el ID exacto; no se añade el catálogo completo a cada prompt.

| Momento | Skills disponibles | Resultado esperado |
|---|---|---|
| Requisitos y olas 0 | `intent-driven-development`, `planning-and-task-breakdown`, `api-and-interface-design` | Criterios observables, dependencias y obligaciones entre componentes |
| OAuth, tokens, entrada y almacenamiento | `security-and-hardening`, `source-driven-development` | Validación en el servidor y fuentes oficiales fechadas |
| Implementación de cada corte | `incremental-implementation`, `test-driven-development` | Cambio pequeño y regresión que falla antes de la corrección |
| Pruebas E2E y comparación | `e2e-testing`, `verification-loop`, `eval-harness` | Recorrido real, resultados reproducibles y evaluación independiente |
| UI existente | `frontend-ui-engineering`, `antislop`, `antislop-human`, `antislop-copywriting` | Funcionalidad, accesibilidad y mensajes basados en estados reales |
| Navegador / Desktop | `browser`, `browser-qa`; `windows-desktop-e2e` cuando corresponda a UI Automation | Evidencia sobre la superficie efectivamente usada |
| Diagnóstico de fallo | `debugging-and-error-recovery` | Reproducción, causa y corrección localizada |
| Revisión | `code-review-and-quality`, `agent-self-evaluation` | Defectos justificados y autovaloración separada del dictamen externo |
| CI y publicación | `ci-cd-and-automation`, `shipping-and-launch`, `observability-and-instrumentation` | Comprobaciones ejecutadas, señales saneadas y recuperación |
| Notas y entrega | `documentation-and-adrs`, `git-workflow-and-versioning` | Rationale, documentación y diff preservando trabajo previo |
| Definiciones OpenCode | `opencode` | Sintaxis V2 comprobada contra documentación oficial |

Las skills locales de DSH se consultan en `.agents/skills/`: `dsh-doc`, `dsh-prose-standard`, `dsh-pre-push-checks`, `dsh-ci-test-reliability`, `dsh-code-review`, `dsh-byok-composition` y `dsh-shared-key-guard`, según el cambio. El umbral genérico de una skill nunca reduce el 100% por archivo que exige DSH. `skills-catalog/`, `skills-shared/` y `agents-shared/` son contenido del producto; no se confunden con la disponibilidad del catálogo OpenCode.

### 3.3 Invocación y control de concurrencia

Las [definiciones de agentes V2](https://opencode.ai/v2/docs/agents) y las [skills V2](https://opencode.ai/v2/docs/skills) se consultaron el 2026-11-05. Reutilizar los IDs disponibles es suficiente para comenzar. Si se necesitan perfiles persistentes por proyecto, Fase 0 define `.opencode/agents/<id>.md`, `mode: subagent` y permisos V2; no se asigna un modelo inventado ni se instala una configuración global.

El contrato operativo tiene un solo escritor por archivo. Antes de dos tareas paralelas, el coordinador fija API y propietario de cada fichero compartido; una tarea que necesita ampliarlos devuelve el cambio de contrato. El trabajo de QA puede avanzar en fixtures independientes. El coordinador integra cambios, vuelve a calcular el alcance y ejecuta las pruebas afectadas por la integración.

Un prompt de revisión no concede acceso de escritura. Las asignaciones read-only deben restringir edición y comandos de mutación mediante permisos efectivos de OpenCode; permitir shell genérico puede eludir un veto al editor. Revisores de evidencia necesitan solo leer las salidas autorizadas. Cada ola permite una corrección y una nueva verificación por defecto; un segundo fallo de la misma propiedad obliga a diagnóstico y división del trabajo, sin bucle ilimitado.

## 4. Archivos y responsabilidades

Todas las rutas siguientes son relativas a `deepseek-harness/`. `E` significa ubicación existente inspeccionada; `N` significa archivo o módulo propuesto que debe crearse en su ola. Un nombre nuevo en esta tabla no acredita que exista.

| Área | Base existente (E) | Creación propuesta (N) | Responsable y alcance |
|---|---|---|---|
| MCP | `packages/faberloom/mcp-server/src/{spec,index,tools,protocol}.ts` | `src/proposal.ts`, `src/work-reference.ts`, pruebas hermanas | Tokens, propagación, operaciones separadas y rechazo directo |
| Mesa | `packages/faberloom/board/src/{index,classify,keys}.ts` | `src/knowledge-approval.ts`, casos de aprobación humana | Acción humana vinculada y propuestas sin efectos automáticos |
| Presentación | `packages/faberloom/view/src/{index,types}.ts`; `packages/client/ui-faberloom/src/client/{components,panels,store,locales}.ts*` | Componentes de propuesta y estado cuando no quepan en los existentes | Vista autorizada, diff no confiable y recuperación |
| Local | `apps/desktop/src/`; `apps/desktop/src/product-mcp.ts` | Módulo de identidad local y pruebas de hogar limpio | Identidad persistente, separación de datos y proveedor explícito |
| Herencia | `packages/faberloom/spaces/src/index.ts`; contexto y memoria existentes | Casos de autorización de cada contribución | Unificar semántica de contexto y memoria antes de exportar |
| Generador | `packages/faberloom/harness-projection/`; `scripts/validate-kb.mjs` | `packages/faberloom/portable/` | Modelo, resolución, inventario, validación y adapters puros |
| Publicación | Mesa, persistencia y ejecución de FaberLoom | `packages/faberloom/publication/` | Aplicador Git, estados durables, MinIO, activación y lectura autorizada |
| Conexiones | `packages/faberloom/connections/`; registro MCP y Desktop | Módulos OAuth dentro del propietario validado en 0.3 | Separar conexión FaberLoom de conexión MWT; no duplicar identidad |
| Verificación | `scripts/run-gates.ts`; configs Vitest; tests y snapshots existentes | `scripts/faberloom-portable/{requirements.json,check-plan.ts,check-plan.spec.ts,compare.ts,compare.spec.ts,run.ts,run.spec.ts}` | Trazabilidad, ejecución acotada y comparadores |
| Composición E2E | `apps/cli/tests/profiles/`; soporte de snapshots | `apps/cli/tests/profiles/faberloom-portable.spec.ts`; escenarios `faberloom-portable-*` | Arranque por launcher y comprobación de servicios reales |
| Fixtures | Directorios `tests/` de cada propietario | `packages/faberloom/portable/tests/fixtures/` y fixtures de publicación | Datos sintéticos, manifiestos esperados revisados y fallos |
| Evidencias | `.artifacts/` | `.artifacts/faberloom-portable/<runId>/` | Resultados de ejecución; logs privados saneados antes de compartir |
| Documentación | Este plan, README de paquetes y guías FaberLoom | Nota propuesta, decisiones por ola y referencia del formato portable | Actualizar por propietario; generar catálogos desde código |

`portable` agrupa inicialmente modelo y adaptadores puros; `publication` agrupa servicio, proveedor y consumidores que evolucionan juntos. Se separa un proveedor MinIO solo cuando un consumidor alternativo justifique esa separación. Cada paquete nuevo incluye manifiesto, tsconfig, README, exports, composición y pruebas según [añadir un paquete](../cookbook/adding-a-package.md). No se crea un servidor independiente para generar archivos.

Cada ola enumera su delta respecto de esta tabla. Si aparecen más de cinco archivos de lógica con responsabilidades distintas, dividir la implementación en tareas subordinadas dentro de la misma ola; las pruebas, README, pairing y manifiestos acompañan al propietario. Esas tareas conservan los mismos requisitos y no adelantan el cierre de la ola.

## 5. Harness de verificación y comparación

El harness propuesto es parte del monorepo y usa sus runners. Su función es impedir que una prueba verde incompleta, un test omitido o una declaración del modelo se conviertan en aceptación. La ola 0.4 solo lo especifica. Su construcción es la tarea habilitadora H0 de la primera ola de código autorizada (1.1 o 2.1), con un único propietario QA; debe terminar antes de evaluar implementación. Así Fase 0 conserva su alcance documental.

### 5.1 Registro de requisitos y resultados

`requirements.json` registra cada uno de los 58 IDs, fuente/sección, obligación, fase, olas, propietario, dependencias, casos positivos/negativos, archivos de prueba, comparador, entorno y prueba manual si aplica. Añade requisitos de conservación `REG-*`, contratos `CTR-*` y pruebas del propio harness `HAR-*`. Los registros tienen versión de esquema; los IDs retirados conservan motivo y autorización, sin desaparecer del denominador.

Por ejecución, `run.json` registra: identificador, fechas UTC, checkout y diff digest, rama/HEAD, plataforma, Node/pnpm, perfil y configuración saneada, fixture digest, versiones de host/generador/formato, ola autorizada y comandos con argv, cwd, exitCode, duración y conteos de tests. `results.json` enlaza cada caso con logs/artefactos y estado. `comparison.json` contiene diferencias antes/después y su clasificación. `review.md` identifica revisores, hallazgos y decisión humana de continuación.

Estados permitidos: `demostrada`, `refutada`, `no-comprobada` y `no-aplicable`. Un skip, timeout, comando ausente, entorno no disponible, cero tests seleccionados o un artefacto incompleto produce `no-comprobada` o `refutada`, nunca `demostrada`. `no-aplicable` necesita regla de aplicabilidad, responsable, justificación y aceptación; no sirve para eliminar un host comprometido.

### 5.2 Entornos y fixtures

| Nivel | Composición | Datos y observación | Qué demuestra |
|---|---|---|---|
| L0 | Validadores y comparadores puros | Casos de entrada válida/inválida; corpus completo | Trazabilidad y capacidad real de detectar incumplimientos |
| L1 | Servicios reales con dobles solo en red/reloj/modelo | Organizaciones ORG-A/ORG-B; espacios A1/A2 de ORG-A; B1 de ORG-B; padre P y su hijo H | Permisos, idempotencia, herencia y persistencia |
| L2 | Loader y perfil DSH de prueba por launcher | Hogar y Git temporales, dos actores/conversaciones, reinicios reales | Integración, composición, estados y conservación del mundo |
| L3 | Artefacto construido e instalado fuera del checkout | Directorio con espacios/Unicode, Windows y plataformas declaradas | Cierre de dependencias y comportamiento instalado |
| L4 | MinIO/OAuth no productivos y hosts reales autorizados | Clientes independientes y cuentas no admin | Integración externa, permisos, revocación y carga efectiva |
| L5 | Persona y piloto aprobados | Tarea acotada, contenido autorizado, observación consentida | Comprensión, utilidad y reutilización reales |

Actores mínimos: propietario, miembro solo del hijo, miembro de A1 pero no A2, usuario multiempresa, tercero sin permiso, usuario inactivo y publicador técnico. Incluir padre restringido, dependencia ausente, clasificación excluida, propuesta con HTML/URL remota, archivo ajeno y operación programada previa. Credenciales sintéticas se generan por prueba y no se copian a los expected outputs.

Cada test posee puertos efímeros, directorios temporales y procesos; registra limpieza incluso al fallar. Las pruebas de interrupción matan y reinician procesos reales en L2; los unit tests con excepciones simuladas son complementarios. Windows prueba bloqueos, mayúsculas, Unicode, rutas UNC, enlaces y junctions; Linux mantiene semántica POSIX. Una plataforma omitida queda fuera de la certificación hasta obtener evidencia.

### 5.3 Comparadores independientes

| Comparación | Antes / después | Oráculo independiente | Diferencia que bloquea |
|---|---|---|---|
| Requisitos | Paquete original + vigente / registro de olas | Extracción de IDs y secciones originales | ID ausente, duplicado, sin dueño o sin prueba |
| Permisos | Matriz autorizada / `tools/list` y llamada directa | Acceso esperado por actor/operación, también en executor | Una llamada ejecutable fuera del permiso aunque se oculte |
| Recepción | Petición y clave / recibo / Mesa persistida | Lectura humana autorizada y consulta del storage de prueba | ID sin ítem, duplicado o sustitución de otro ítem |
| Aplicación | Base y diff aprobados / árbol Git final | Archivo esperado preparado por QA, incluyendo archivos intocables | Escritura adicional, cambio de base o commit con trabajo ajeno |
| Generación | Inventario autorizado / árbol y manifiesto finales | Lista esperada revisada y hashes recalculados desde bytes | Dependencia perdida, contenido B, secreto o hash inconsistente |
| Determinismo | Dos generaciones limpias del mismo input | Árbol ordenado y digest canónico | Diferencias no declaradas de tiempo, orden, rutas o metadata |
| Publicación | Aprobación→commit→objeto→activación | Relectura de Git, recuperación MinIO y registro durable | Activación antes de verificar, duplicación o pérdida de última válida |
| Contexto | Revisión publicada / referencia / contenido cargado | Evidencia de host o request/log; dato testigo sintético | Usar latest a mitad de conversación o carga afirmada sin prueba |
| Local/MWT | Modo apagado / conectado / revocado | Captura de conexiones e inventario herramientas; hogar leído aparte | Tráfico apagado, fallback privilegiado o pérdida de datos locales |
| Actualización | Árbol de usuario previo / instalación o desinstalación | Hashes externos de archivos y bloques no gestionados | Pérdida de datos o sustitución silenciosa de edición manual |
| Catálogo | Definiciones de fuente / docs generadas / runtime por actor | Comparación de nombres, schemas y permisos efectivos | Herramienta documentada como accesible cuando no lo está |

No normalizar rutas privadas, errores de autorización, identidades, revisiones o diferencias de contenido para ocultar fallos. Las normalizaciones admisibles son campos no semánticos declarados, por ejemplo un puerto efímero; cada regla tiene un test que preserva diferencias relevantes. El autor del generador no actualiza el expected del comparador sin revisión de QA.

### 5.4 Pruebas del propio harness

| ID | Control negativo deliberado | Resultado requerido |
|---|---|---|
| HAR-01 | Eliminar un ID requerido del registro | Verificador devuelve código no cero y nombra el ID |
| HAR-02 | Seleccionar cero tests o simular skip por credencial ausente | Cierre no comprobado; no acepta exitCode cero como suficiente |
| HAR-03 | Cambiar un byte de archivo o inventario esperado | Comparador identifica ruta y digest diferente |
| HAR-04 | Introducir contenido de A2 en A1 y ocultar el tool solo en listado | Fallan exportación y llamada directa independientemente |
| HAR-05 | Suprimir validación humana en fixture de mutación aislada | PROP-09 falla; la mutación se revierte y no entra en la entrega |
| HAR-06 | Cortar tras commit/subida/activación y reanudar | Detecta duplicación o estados falsos; recupera una sola transición |
| HAR-07 | Presentar evidencia de otra revisión o un resultado sin log | Rechaza evidencia obsoleta o no correlacionada |
| HAR-08 | Cambiar baseline/expected junto con implementación sin autorización | Revisión detecta el cambio y bloquea aceptación automática |

Estas mutaciones se hacen en fixtures o worktrees de prueba con diff explícito; no alteran el checkout del usuario ni las políticas reales. Un resumen de evaluación por LLM puede ayudar al revisor, pero no decide permisos, hashes ni existencia de efectos.

### 5.5 Comandos y selección de pruebas

Los comandos siguientes se programan para las olas autorizadas; su presencia aquí no afirma ejecución. Ejecutarlos desde la raíz del repo, con el gestor fijado y dependencias existentes verificadas. `pnpm` no está en el PATH de esta sesión, pero `corepack pnpm` resuelve la versión declarada por `packageManager` sin instalar nada global; los comandos de ejemplo conservan la forma corta y el registro de ejecución anota la invocación real.

```powershell
git status --short --branch
git rev-parse HEAD
node --version
pnpm --version
pnpm exec vitest run packages/faberloom/mcp-server/tests/mcp.spec.ts
pnpm exec vitest run packages/faberloom/board/tests/board.spec.ts
pnpm exec vitest run packages/faberloom/spaces/tests/spaces.spec.ts
pnpm exec vitest run packages/faberloom/view/tests/approvals.spec.ts
pnpm run test:gui
pnpm run typecheck
pnpm run lint
pnpm run test:docs
pnpm run doc-sync
git diff --check
```

Seleccionar solo los comandos pertinentes al delta de la ola. Para cobertura, seleccionar tests y fuentes afectadas por separado, manteniendo el umbral del repo. Para un snapshot, usar el archivo driver real y `-t` con el escenario; no introducir `--` que desactive el filtro. Verificar el número de tests seleccionados. `test:expected` cubre procesos sin replay; `test:snapshot` cubre sesiones; `test:web` cubre navegador; las salidas de generación se guardan en `tests/expected/` del dueño, no en el árbol de sesiones.

Las nuevas entradas propuestas de `package.json` son `verify:faberloom-portable` para trazabilidad/comparación y `test:faberloom-portable` para el runner de escenarios. El runner recibe `--wave`, `--run-id` y `--evidence-dir`; valida valores contra el registro y nunca construye un comando shell desde texto de propuestas. Esas entradas se crean y prueban en H0, bajo la primera ola de código autorizada, antes de documentarlas como disponibles. Los checks deterministas se incorporan a `scripts/run-gates.ts`; integraciones con cuentas requieren carril separado y estados honestos si faltan.

CI mantiene cobertura por archivo, lint, tipos, build, higiene, composición, snapshots y matriz de plataforma según el alcance. Una comprobación local verde no suplanta el carril nativo Windows ni la certificación de hosts. No ejecutar `check:windows-wine` como sustituto habitual: el repo lo reserva a diagnóstico y CI.

## 6. Fases y olas

Cada ola termina en una entrega verificable. Los tests nombrados como nuevos se crean junto al comportamiento y conservan los IDs de la sección 7 en sus descripciones o en el registro. La recuperación de una ola afecta solo sus salidas y conserva datos e historial. Las decisiones de producto se resuelven antes de los efectos que dependen de ellas.

### Fase 0. Recorrido, contratos y preparación

Resultado: equipo y usuario conocen el alcance, el corte inicial y cómo se comprobará. Entrada: paquete completo y autorización específica de los trabajos de esta fase. Responsable principal: `planner`; revisión: `architect`, `security-reviewer` y `reality-checker`.

#### Ola 0.1. Congelar la línea base y preservar los requisitos

1. Entradas: seis archivos del paquete, reglas del repo, estado Git y catálogo de pruebas previo. Asignar a `planner` y `evidence-collector`.
2. Crear: inventario de lectura con hashes de archivos, registro inicial de 58 requisitos y mapa de las secciones 1 a 14 del original. Guardar la identidad del checkout en evidencia, no en prosa mantenida.
3. Modificar/corregir: completar este plan con divergencias encontradas; corregir referencias a rutas del PC original sin copiar sus rutas absolutas a contratos de runtime. No presentar datos aportados como inspeccionados.
4. Verificar/comparar: enumeración recursiva del paquete contra el inventario; original→vigente→ola, incluyendo las restauraciones de ronda 2 y F01 a F50 como regresión adicional.
5. Aceptar: seis archivos cubiertos, 58 IDs únicos asignados, ningún alcance original perdido y cambios previos inventariados. El revisor firma la cobertura documental, no una certificación del producto.
6. Entrega/recuperación: `baseline` y `requirements` de la ejecución; si cambia una fuente, invalidar la comparación afectada y recalcularla sin borrar evidencia anterior. Depende de: ninguna ola.

#### Ola 0.2. Resolver recorrido, autoridades y decisiones bloqueantes

1. Entradas: 0.1 y D01 a D05/D08. Asignar a `architect`, `identity-access-engineer` y `frontend-developer` con revisión de producto.
2. Crear: contratos de identidad local/FaberLoom/MWT, clasificación y exportación, herencia, revisión fijada, aprobación exacta, estados de publicación y errores del recorrido de 13 pasos.
3. Modificar/corregir: incorporar selección de espacio validada por servidor y consentimiento de un solo uso; eliminar del diseño la dependencia de localhost para chat y la promesa de carga no comprobada.
4. Verificar/comparar: recorrer en papel éxito, rechazo, cancelación, fuente apagada y MinIO caído; contrastar cada paso con su autoridad y actor real. Resolver cómo una conexión puede leer y proponer con permisos distintos.
5. Aceptar: cada decisión bloqueante tiene dueño y respuesta; no hay fuente editable duplicada, espacio global por cuenta ni aprobación basada en un claim del modelo. Las pendientes bloquean solo olas dependientes.
6. Entrega/recuperación: decisiones versionadas, recorrido y matriz de permisos; un cambio posterior de contrato invalida consumidores y pruebas asociados. Depende de 0.1.

#### Ola 0.3. Fijar propietarios de código y contratos entre agentes

1. Entradas: 0.2, consumidores reales y material D13/D14 disponible. Asignar a `architect` y `developer-tooling-engineer`.
2. Crear: mapa E/N definitivo de la sección 4, DTO propuestos, lista de consumidores de `mintToken`, aprobación y proyección; contratos de asignación por agente y nota de decisión propuesta.
3. Modificar/corregir: reutilizar servicios existentes antes de aceptar un paquete nuevo; distinguir librería, plugin y bundle; definir migración de tokens y almacenamiento de publicación según el dueño real.
4. Verificar/comparar: confrontar APIs con consumidores HTTP, `request()`, view, herramientas internas, mirror y bridge; revisar `build_faberloom.py` cuando se comparta, sin ejecutarlo durante la inspección.
5. Aceptar: cada campo que cruza proceso tiene productor, validador, consumidor y prueba; los IDs opacos son branded; no se propone cambiar agent-loop para implementar negocio FaberLoom.
6. Entrega/recuperación: mapa aprobado, lista de cambios persistentes y reparto exclusivo de archivos. Si el generador externo sigue ausente, mantener D13 abierto y no afirmar sustitución completa. Depende de 0.2.

#### Ola 0.4. Especificar el harness y entregar el primer corte de código

1. Entradas: 0.3 y selección de pruebas existentes. Asignar a `test-automation-engineer`; revisor `evidence-collector`. Esta ola conserva el alcance documental del paquete vigente.
2. Crear: especificación de H0 con esquema de evidencia, datos de HAR-01/02/03/07/08 y archivos futuros `scripts/faberloom-portable/requirements.json`, `check-plan.ts`, `compare.ts`, `run.ts` y sus tres specs. Dividir H0 en tres tareas de dueño único.
3. Modificar/corregir: únicamente documentos de planificación; definir el delta futuro de `package.json` y `scripts/run-gates.ts`, sin aplicarlo. Establecer cómo skip, cero tests, corpus reducido y evidencia obsoleta impiden aceptación.
4. Verificar/comparar: revisión estática de casos válidos/ inválidos, registro contra paquete y contratos de comparadores. Especificar en H0 ejecución real, limpieza tras timeout y conteos, sin afirmar que ya se ejecutaron.
5. Aceptar: expediente H0 listo para autorización, con oráculos que exigen fallo no cero ante requisito eliminado, byte alterado o resultado sin evidencia; caso íntegro definido. La implementación y sus pruebas siguen pendientes hasta la primera ola de código autorizada.
6. Entrega/recuperación: cierre documental de Fase 0 y alcance del primer corte, incluyendo H0. Reversión solo documental; una inconsistencia devuelve el contrato a revisión. Depende de 0.3; habilita solicitar líneas 1, 2 y diseño 3A.

### Fase 1. Propuestas y conexión por espacio

Resultado: una persona conecta el host, recibe una propuesta real y puede revisarla sin manejar tokens. Requiere Fase 0 y aprobación/clasificación resueltas. OAuth remoto requiere D07 antes de utilizar el entorno.

#### Ola 1.1. Cerrar la aprobación de conocimiento en la operación de dominio

1. Entradas: mapa de rutas de 0.3. Implementa `backend-architect`; revisa `security-reviewer` independientemente.
2. Crear: primero completar H0 si todavía no existe, ejecutando sus controles negativos; después `board/src/knowledge-approval.ts` si requiere módulo propio, prueba de acción humana ligada a ítem/revisión/hash y matriz de todas las variantes de aprobación.
3. Modificar/corregir: operaciones de aprobación en `board/src/index.ts`, consumidores view/MCP, herramienta local y rutas internas. Usar evidencia emitida/validada por el servidor a partir de sesión humana; no aceptar `human: true`, dueño, scopes amplios o actor del modelo como acreditación. La ruta de escritura de importación, restore y replicación se localiza en esta ola antes de fijar su alcance: la lectura de `mirror/src/sync.ts` no mostró referencia a `approve` ni al estado, así que se identifica el módulo que escribe filas y se impide que introduzca aprobaciones editoriales autoritativas sin validación, aunque no llame a `approve()`.
4. Verificar/comparar: PROP-09 por HTTP, `request()`, tokens antiguos/nuevos, mirror, bridge, aprobación individual/en lote, importación de fila aprobada y llamada interna; positivo desde sesión humana con protección de solicitud y permisos. HAR-05 demuestra que la prueba detecta el control retirado. Una restauración conserva decisiones verificables y nunca crea prueba humana nueva.
5. Aceptar: ninguna variante aprueba conocimiento sin acción humana exacta; replay de aprobación, base alterada y hash diferente se rechazan; otros tipos de Mesa conservan su política documentada.
6. Entrega/recuperación: control de dominio y reporte de rutas. Mantener aplicador apagado hasta el cierre; si falla una ruta, no habilitar aplicación automática. Depende de 0.4.

#### Ola 1.2. Crear entrada exclusiva de propuestas con idempotencia durable

1. Entradas: 1.1 y contrato de propuesta. Implementa `backend-architect`; QA prepara expected independientes.
2. Crear: `mcp-server/src/proposal.ts`, casos de recepción/concurrencia y regla explícita `propuesta-conocimiento` en clasificación. Campos de negocio: `archivo`, `versionBase`, `cambio`, `motivo`, `evidencia`, `claveCliente`, `title`, con límites aprobados.
3. Modificar/corregir: `tools.ts`, `protocol.ts`, `board/src/{index,keys,classify}.ts` y tipos consumidores. Identidad canónica con namespace de empresa/dueño/espacio/clave, también en `sourceRef`; inserción y deduplicación atómicas en almacenamiento, no solo un Map del proceso.
4. Verificar/comparar: PROP-01 a PROP-06, PROP-08; dos procesos, reinicio tras persistir antes de responder, misma clave con otro contenido y colisión con ítem programado. Rechazar campos de autoridad también al invocar el executor directamente.
5. Aceptar: éxito exacto `{ recibida: true, id }` corresponde a un ítem pendiente; claves distintas preservan dos propuestas; reintento idéntico no duplica; contenido distinto produce conflicto sin revelar ítems ajenos. Ninguna propuesta pendiente entra en índice, contexto, teaching o efectos.
6. Entrega/recuperación: recepción durable y evidencia del ítem anterior intacto. Un fallo mantiene la propuesta sin confirmar o permite reintentar con la misma clave; nunca sustituye la previa. Depende de 1.1.

#### Ola 1.3. Evolucionar tokens y transportar el alcance hasta el executor

1. Entradas: 1.2 y lista completa de consumidores de `mintToken`. Implementa `identity-access-engineer`; revisa seguridad.
2. Crear: casos de migración/lectura de tokens antiguos, permiso exclusivo de propuesta y pérdida de membresía; fixtures sin secretos reales.
3. Modificar/corregir: `mcp-server/src/{spec,index,tools,protocol}.ts`, DTO y consumidores de `view/src/{index,types}.ts` y UI. Añadir `spaceId` opcional con semántica explícita de legacy; revalidar usuario/empresa/espacio al emitir y usar, propagándolo por HTTP y `request()`. Rediseñar el listado que hoy expone el token completo para que la conexión guiada no lo entregue al modelo ni a diagnósticos; migrar consumidores legacy explícitamente.
4. Verificar/comparar: AUTH-04/06, CON-02 y PROP-09; `tools/list` frente a llamada directa y executor. Probar token de propuestas con scopes manipulados, revocado y sin acceso al padre; actualizar reconocimiento de tipos persistentes cuando corresponda.
5. Aceptar: token de propuesta solo ejecuta `faberloom_proposal_submit`; token de lectura no propone; legacy no elude aprobación humana; ningún consumidor pierde el alcance ni obtiene empresa del payload no confiable.
6. Entrega/recuperación: tabla de compatibilidad y migración ensayada. Desactivar emisión nueva y revocar tokens de prueba si falla; conservar registros y versiones persistentes. Depende de 1.2.

#### Ola 1.4. Conectar el host y fijar referencias de trabajo por conversación

1. Entradas: 1.3, D07 y D02 resuelta (2.2.1), que limita esta ola al endpoint local. Implementa `identity-access-engineer` con `frontend-developer`.
2. Crear: transacción de autorización de un solo uso, referencias ligadas a usuario/conexión/espacio/revisión y autorización del permiso de lectura. Integrar OAuth en el propietario acordado en 0.3. El transporte de contenido publicado se entrega en 3A.4; esta ola no lo da por implementado.
3. Modificar/corregir: MCP, conexiones y selección UI. Validar PKCE, redirects exactos, issuer, resource/audience, caducidad y scopes; no convertir un token de propuestas en credencial general. No usar sesión MCP como conversación ni mantener espacio activo global.
4. Verificar/comparar: partes de autorización de CON-01 a CON-04, AUTH-04/08 y UX-01: callback repetido, cancelado o alterado; dos pestañas; dos referencias A1/A2 y denegaciones cruzadas de permisos. La prueba de lectura de bytes y propuesta por la misma conexión queda obligatoriamente en 1.5 después de 3A.4.
5. Aceptar: el usuario autoriza en navegador sin copiar secretos; cada llamada revalida referencia y membresía; la selección de A2 no cambia el destino de A1; la UI muestra el espacio realmente autorizado. La prueba contra un servicio remoto pertenece a la ola que abra D02; en este corte la conexión es local.
6. Entrega/recuperación: conector demostrado y registro saneado de transacciones. Cancelar consume/invalida la transacción según contrato y vuelve al espacio; revocar impide nuevas operaciones aunque el cliente conserve la referencia. Depende de 1.3.

#### Ola 1.5. Mostrar propuesta legible y estado comprobable

1. Entradas: 1.2 a 1.4, lector real de 3A.4 y estados definidos. Implementa `frontend-developer`; revisan accesibilidad y evidencia.
2. Crear: tarjeta de propuesta y panel de conexión/versiones/pendientes, con casos UI y recorrido de error. Reutilizar controles y slots del cliente.
3. Modificar/corregir: `view/src/{index,types}.ts`, `ui-faberloom/src/client/{components,panels,store,locales}.ts*` y dueño del catálogo MCP. Mostrar diff, motivo, evidencia y alcance; representar contenido como no confiable sin HTML activo ni cargas remotas automáticas.
4. Verificar/comparar: PROP-10, UX-03/04/05, estados vacío/carga/error y teclado; recibo UI contra ítem durable. Demostrar en el host inicial lectura de publicación real y propuesta por la misma conexión, conservando CON-02 y CON-04. Comprobar URL visible de enlaces sin solicitudes con credenciales; ejecutar pruebas de view y UI afectadas y snapshot ensamblado.
5. Aceptar: Aprobar/Rechazar actúan realmente; permisos se revalidan en servidor; conexión autorizada no se etiqueta como contenido cargado; todos los textos pertenecen a locales y la tarjeta se comprende sin estructuras técnicas.
6. Entrega/recuperación: demostración de Fase 1, matriz y catálogo desde fuente. Ante error mantener borrador y ofrecer reintento; revisión humana sigue disponible sin activar publicación no certificada. Depende de 1.4 y 3A.4; no cerrar Fase 1 con un doble del lector.

### Fase 2. Hogar local completo sin cuenta MWT

Resultado: trabajo local útil, persistente y aislado. Requiere contratos de identidad, hogar y proveedor de 0; puede avanzar en paralelo con Fase 1 si no comparte archivos.

#### Ola 2.1. Separar inicio local de identidad remota

1. Entradas: D08 resuelta (2.2.1) y mapa de inicio Desktop. Implementa `desktop-app-engineer`; revisa `architect`.
2. Crear: completar H0 con QA si esta es la primera ola de código autorizada; identidad estable del hogar local, selección explícita de modo y pruebas de instalación limpia/reinicio. Validar ubicación concreta del módulo en `apps/desktop/src/` antes de crearlo.
3. Modificar/corregir: `apps/desktop/src/{main,identity}.ts`, con nuevos `local-identity.ts` y `home-selection.ts` si se confirman esos propietarios. Resolver modo/hogar antes de renovar tokens o aprovisionar MCP. No reutilizar `writeIdentity()` remoto para crear identidad local, porque activa mirror. Iniciar backend por la vía admitida y conservar ownership de datos previos.
4. Verificar/comparar: BASE-01 y AUTH-08 con hogar nuevo, hogar remoto existente, carpeta ajena, cancelación y reinicio; comparar ownership y bytes de datos previos.
5. Aceptar: crear Workspace, Space y subspace sin cuenta de consola; identidad y permisos sobreviven a reinicio; datos de otro hogar no aparecen ni se importan automáticamente.
6. Entrega/recuperación: arranque local probado. Restaurar selección de perfil conserva ambos hogares y no exige migración inversa destructiva. Depende de 0.4; la regla de modo y ubicación viene de D08 (2.2.1).

#### Ola 2.2. Desactivar MWT y servicios asociados por composición

1. Entradas: 2.1 y perfiles reales. Implementa `desktop-app-engineer` con `architect`; QA observa red.
2. Crear: fixture con variables/credenciales heredadas sintéticas y observador de conexiones/herramientas durante inicio, uso, espera y reinicio.
3. Modificar/corregir: `product-mcp.ts`, `packages/bundle/faberloom-app/cordis.patch.yml` y consumidor `apps/desktop-host/src/index.ts`. Definir un overlay local efectivo en CLI y Desktop, sin que capas posteriores reactiven MWT, credentials-console, checks-MWT, mirror, bridge, shares o sincronización. El modo local no monta esas conexiones; ocultarlas o capturar errores no cumple.
4. Verificar/comparar: BASE-02 y LIFE-01; comparar registro efectivo y red con allowlist explícita de proveedor/SICOP activados. Probar variables de remoto presentes y servicio MWT caído.
5. Aceptar: cero peticiones, herramientas y reintentos MWT durante el intervalo de prueba declarado; Mesa/contexto/memoria/rutinas/workflows locales siguen utilizables; teardown elimina recursos de la conexión desactivada.
6. Entrega/recuperación: perfil local y prueba de ausencia observada. Si se detecta tráfico, bloquear base local y corregir composición; no desactivar observación para aprobar. Depende de 2.1.

#### Ola 2.3. Configurar proveedor y SICOP y completar tarea local

1. Entradas: 2.2, modo de proveedor de D08 (2.2.1) y acceso de prueba autorizado. Implementa Desktop/UI; verifica `evidence-collector`.
2. Crear: asistente de proveedor con estados sin credencial/sin red, recorrido de SICOP independiente y tarea local sintética con resultado durable.
3. Modificar/corregir: configuración y locales existentes; almacenar credenciales en mecanismo seguro del host, sin clave compartida en artefacto. El fallo SICOP no bloquea arranque ni atribuye éxito a una operación no realizada.
4. Verificar/comparar: BASE-03/04 y regresiones locales: tarea→propuesta→Mesa, contexto y memoria; proveedor ausente, SICOP caído y reinicio. Releer resultado local desde fuera de la sesión del modelo.
5. Aceptar: persona sin MWT completa una tarea; entiende qué requiere red/inferencia y conserva datos tras fallos. El cliente configurado sin auth no se presenta como prueba de disponibilidad de SICOP.
6. Entrega/recuperación: cierre de Fase 2 con evidencia técnica y de usuario. Retirar configuración defectuosa conserva hogar; informar dependencia externa no comprobada si no hubo acceso real. Depende de 2.2.

### Fase 3A. Primera cadena Git y MinIO

Resultado: un documento y una skill sintéticos recorren aplicación, generación, publicación, activación y lectura. El diseño parte de 0; los efectos requieren 1.1/1.2, D03 a D05 resueltas (2.2.1) y D06 abierta.

#### Ola 3A.1. Aplicar exclusivamente el diff aprobado

1. Entradas: aprobación de 1.1, propuesta de 1.2, fuente Git de D03 e inventario autorizado. Implementa `backend-architect`; revisa seguridad.
2. Crear: `publication` con aplicador, registro durable de aplicación y pruebas de Git temporal. Resolver `archivo` contra inventario del servidor y ligar destino/base/diff/hash a la aprobación.
3. Modificar/corregir: enlace Mesa→aplicador sin doble fuente editable. Revalidar permisos, clasificación, ruta real y base inmediatamente antes de escribir; serializar cambios competidores o usar comparación y actualización condicionada.
4. Verificar/comparar: PROP-07, PUB-02/07: parche con varios archivos, ruta B, symlink sustituido, base nueva, dos aprobaciones simultáneas y checkout con cambios ajenos. Comparar árbol final contra fixture preparado por QA.
5. Aceptar: solo el diff aprobado entra en un commit identificable; ningún comando del contenido se ejecuta; un conflicto preserva propuesta y exige nueva revisión si cambia el diff. Caer después del commit no lo duplica al reintentar.
6. Entrega/recuperación: aplicador probado con efectos de prueba. Ante base/destino incorrecto, estado conflicto y cero escrituras; si el commit ya existe, reconciliar por identidad durable. Depende de 0.4, 1.1 y 1.2.

#### Ola 3A.2. Generar artefacto mínimo con inventario autenticable

1. Entradas: commit autorizado de 3A.1 y política de exportación de D04. Implementa `developer-tooling-engineer`; QA conserva expected independiente.
2. Crear: `portable` con formato versionado, identidad de espacio, revisión editorial, herencia mínima, inventario de archivos y validación previa; destino de staging nuevo.
3. Modificar/corregir: integrar exportación con `harness-projection` sin atribuirle atomicidad; reemplazar filtrado regex por resolución de dependencias. Validar rutas antes de escribir y calcular digest final después de materializar todos los contenidos cubiertos.
4. Verificar/comparar: PKG-01/02/03/04, CTX-01/02 y FS-01 para documento/skill; entradas idénticas en dos destinos; contenido B en metadata/recurso/herencia; secreto sintético y dependencia inexistente. Añadir CTR-PORTABLE-01: una sesión o transcripción, incluso del mismo espacio, incluida como recurso/dependencia se rechaza y no aparece en el artefacto.
5. Aceptar: inventario completo, hashes recalculables y resultado reproducible; formato, contenido y software tienen versiones distintas. Definir canonicalización y qué campos/firma se excluyen del digest para evitar autorreferencia; autenticar el manifiesto con ancla de confianza separada del objeto descargado.
6. Entrega/recuperación: artefacto mínimo y reporte de rechazo por archivo. Staging inválido no reemplaza la salida válida ni modifica fuentes. Depende de 3A.1; aplica D04 y D05 (2.2.1).

#### Ola 3A.3. Publicar, recuperar y activar en MinIO de prueba

1. Entradas: 3A.2, D06 y credenciales técnicas disponibles solo al servidor. Implementa `devops-automator` con `backend-architect`.
2. Crear: publicador y estados persistentes aplicada/publicada/disponible, recuperación del objeto completo, registro de activación y reintento idempotente.
3. Modificar/corregir: integración de publicación y vista de estado. Subir a clave de revisión inmutable, verificar recuperación e integridad/autenticidad, activar mediante actualización condicionada; el cliente no lista MinIO ni recibe sus credenciales.
4. Verificar/comparar: PUB-01/03/04/05: corte antes/después de subida/verificación/activación, objeto alterado, firma errónea, fuente apagada y tentativa de borrar/sobrescribir con identidad del publicador. Comparar objetos y activaciones con registros durables.
5. Aceptar: una revisión recuperada íntegra se activa una vez; identidad del publicador no viola la retención acordada; última versión válida permanece disponible si falla MinIO. Versionado solo no cuenta como inmutabilidad.
6. Entrega/recuperación: evidencia del MinIO real de prueba y reanudación; si D06 no puede demostrarse, fase abierta, aunque los tests con doble pasen. Depende de 3A.2.

#### Ola 3A.4. Entregar revisión fijada y demostrar recuperación completa

1. Entradas: 3A.3 y referencia de trabajo de 1.4. Implementa backend/MCP; verifica QA.
2. Crear: lectura de publicación por revisión y permiso, pruebas de revocación con referencia aún válida y estados disponible/carga no confirmada.
3. Modificar/corregir: executor de solo lectura, view y conexión. Separar publicación disponible de carga observada; no consultar latest en lecturas posteriores de una misma referencia.
4. Verificar/comparar: CON-02/04, VER-01/02 y PUB-01/03; comparar referencia, bytes entregados, sesión/log y publicación. Recuperar desde cada estado después de reiniciar el runtime.
5. Aceptar: referencia A1 nunca entrega A2 ni una revisión nueva sin cambio explícito; revocación deniega nuevas lecturas; caída no duplica commit/objeto/activación; carga no observada se muestra como tal.
6. Entrega/recuperación: cadena 3A completa para documento/skill; volver a última publicación compatible y autorizada sin degradar persistencia ni resucitar permisos revocados. Depende de 3A.3 y 1.4.

### Fase 4A. Primer ciclo completo en Claude

Resultado: propuesta recibida, decisión humana, publicación y uso de la mejora en una sesión nueva. Requiere 1 y 3A completas, runtime disponible y MWT apagado; no requiere cerrar 2 primero.

#### Ola 4A.1. Construir y cargar el primer adaptador Claude

1. Entradas: modelo portable mínimo, manifiesto autenticado, superficie D01 (2.2.1) y mecanismo Claude revalidado. Implementa `developer-tooling-engineer`; revisión de arquitectura.
2. Crear: adaptador Claude dentro de `portable/src/adapters/`, manifest y skills de espacio/propuestas, paquete sintético y prueba de instalación fuera del checkout.
3. Modificar/corregir: generación de recursos y asociación de conexión; resolver rutas respecto al paquete. Sustituir variable global compartida por conexión/referencia gestionada por host; no empaquetar tokens ni `bin/` incompatible con chat/Cowork.
4. Verificar/comparar: HOST-01, PKG-01, DIST-01 y CON-01 desde carpeta ajena; inventario→paquete→componentes cargados. Comprobar versión, dato exclusivo y herencia autorizada; validar manifiesto no equivale a instalar.
5. Aceptar: Code carga componentes admitidos y llega al runtime local; capacidades no disponibles se indican antes de la tarea. Ausencia de runtime deja borrador sin enviar y nunca una Mesa simulada.
6. Entrega/recuperación: paquete y registro de carga en host/version exactos. Retirar plugin y revocar conexión de prueba conserva fuente, propuestas y revisiones. Depende de 1 y 3A.

#### Ola 4A.2. Ejecutar el ciclo y contrastar cada efecto

1. Entradas: 4A.1 y fixture con documento/skill, usuario humano y otra conversación. QA dirige; implementación corrige solo defectos reproducidos.
2. Crear: escenario E2E y snapshot de sesión DSH cuando haya cambio model-visible, con registros de host externo como evidencia distinta; comprobador recibo→Mesa→aprobación→commit→MinIO→activación→carga.
3. Modificar/corregir: adaptador y consumidores que fallen en el recorrido; preservar clave ante recepción incierta y versión base entre envío y revisión.
4. Verificar/comparar: `tools/list`, llamada directa prohibida, propuesta, rechazo y aprobación humana; PROP-02/06/07/09, PUB-01/02, VER-01 e IA-01. Releer archivos y estado fuera del modelo; comprobar que no hubo llamada oculta a otra IA.
5. Aceptar: rechazo deja fuente/publicación iguales; aprobación cambia solo lo autorizado; conversación abierta conserva su revisión y sesión nueva demuestra la nueva; recibo corresponde a registro persistido real.
6. Entrega/recuperación: trazado correlacionado y test de caída recuperado. Si un tramo carece de prueba, el ciclo sigue abierto aunque la respuesta del chat parezca correcta. Depende de 4A.1.

#### Ola 4A.3. Probar el chat final y observar a una persona

1. Entradas: 4A.2, D01/D07/D09, D02 abierta y entorno remoto independiente. `evidence-collector` y UX conducen la prueba.
2. Crear: evidencia de instalación/autorización/carga en chat web/escritorio/móvil que realmente se vaya a soportar y sesión de usabilidad con tarea y cronómetro definidos.
3. Modificar/corregir: conexión guiada, mensajes o adaptación que impidan el recorrido. No presentar una prueba Code como certificación del chat ni conectar el hogar por un túnel improvisado.
4. Verificar/comparar: UX-01/02/03/05 y HOST-03; tiempo hasta conectar, ayudas requeridas, comprensión del diff y recuperación ante fallo de envío/publicación. Contrastar observación con umbrales aprobados, no con estimaciones del desarrollador.
5. Aceptar: persona completa el ciclo en la superficie final, sin tokens/comandos en el recorrido normal; registro de carga corresponde a revisión real. Si no puede comprobarse, mantener explícitamente carga no confirmada y requisito abierto.
6. Entrega/recuperación: resultados y correcciones de primera persona, sin generalizar facilidad de uso. Desactivar conexión defectuosa preserva trabajo y revisiones. Depende de 4A.2 y decisiones indicadas.

### Fase 3B. Generador, herencia y publicación completos

Resultado: extender el corte mínimo a todos los componentes exportables sin perder controles. Requiere 3A; D13 se resuelve antes de declarar sustituido el generador anunciado.

#### Ola 3B.1. Resolver herencia y dependencias con autorización por contribución

1. Entradas: 3A y contrato D05. Implementa `architect` con backend; revisa seguridad.
2. Crear: resolver de reglas/documentos/skills, grafo de dependencias, precedencia/exclusión, detección de ciclos y conflictos de nombres; casos padre privado dentro de la misma organización.
3. Modificar/corregir: `spaces/src/index.ts` y consumidores de contexto/memoria; adquirir material mediante operaciones autorizadas, no `harness-projection.readUsage()` sin actor. No permitir que títulos extraídos sin filtrar visibilidad entren en una publicación.
4. Verificar/comparar: CTX-01/02, PKG-01/02 y PUB-06; miembro solo del hijo, grant revocado, dependencia inaccesible, ciclo, duplicado y presupuesto de contexto insuficiente. Comparar contribuciones esperadas y errores sin nombres privados.
5. Aceptar: ninguna contribución del padre se exporta solo por pertenecer a la empresa; dependencia requerida inaccesible bloquea o usa consulta autorizada explícita. Cambio del padre identifica hijos afectados y genera revisiones según permisos.
6. Entrega/recuperación: resolución completa y matriz de impacto. Mantener últimas publicaciones válidas mientras una dependencia impida regenerar; nunca recortar contexto silenciosamente. Depende de 3A.4.

#### Ola 3B.2. Completar seguridad de rutas y actualización recuperable

1. Entradas: 3B.1 y manifiesto de propiedad. Implementa tooling; QA ejerce Windows nativo.
2. Crear: normalización/validación de rutas, staging y recuperación de reemplazo, detección de edición manual y pruebas de junctions, UNC, Unicode, mayúsculas y rutas equivalentes.
3. Modificar/corregir: escritor/proyección para comprobar propiedad y hashes previos antes de podar; preservar bloques y archivos ajenos. Revalidar enlaces y destinos antes del efecto, no solo al iniciar la generación.
4. Verificar/comparar: FS-01/02/03, PKG-01 y PUB-07; archivos bloqueados, disco sin espacio simulado, destino ocupado, interrupción del proceso, symlink/junction sustituidos y salida solapada. Comparar árbol completo y bytes intocables.
5. Aceptar: no se modifica origen ni destino ajeno; un gestionado editado genera conflicto; siempre existe una versión válida recuperable. No afirmar atomicidad universal de rename entre volúmenes ni de carpetas sincronizadas.
6. Entrega/recuperación: prueba de recuperación Windows y POSIX pertinentes. Descartar solo staging propio identificado; conservar salida anterior y cambios del usuario. Depende de 3B.1.

#### Ola 3B.3. Convertir componentes sin ampliar capacidades

1. Entradas: 3B.2, formatos existentes KB/skills/contexto/workflows y revisión D13. Implementa tooling; revisor `code-reviewer`.
2. Crear: tabla por campo y host: conservado/traducido/omitido con motivo/rechazado; pruebas de agentes con herramientas restringidas, recursos de skills y componentes no soportados.
3. Modificar/corregir: adapters y modelo; reutilizar parsers existentes en lugar de redefinir sus formatos. Incluir recursos finales, política de exportación, versiones y origen en inventario; no exportar backup completo como paquete de espacio.
4. Verificar/comparar: PKG-03/04, DIST-01 y CTR-PORTABLE-01; prototipo→modelo→host con diferencias justificadas. Ningún adapter reintroduce sesiones/transcripciones. Eliminar `tools`, reinterpretar `skills` o convertir workflow en Markdown debe producir rechazo o limitación explícita, nunca equivalencia automática.
5. Aceptar: archivos finales cubiertos y bytes reproducibles bajo entorno declarado; identidad del espacio afecta versión/inventario según contrato. Generador antiguo conserva consumidores hasta demostrar migración; D13 pendiente impide declarar reemplazo total.
6. Entrega/recuperación: informe de conversión y compatibilidad. Rechazar componente incompatible conservando fuente; revertir selección de adapter sin volver a publicar contenido no autorizado. Depende de 3B.2 y D13 para sustitución.

#### Ola 3B.4. Completar ciclo de publicación, rotación de confianza y rollback

1. Entradas: 3B.3, retención y política de versiones. Implementa publicación/plataforma; revisa seguridad.
2. Crear: pruebas de reanudación en todos los estados, activaciones concurrentes, retiro de revisión, confianza del editor, rotación de clave de firma y restauración del almacén de prueba.
3. Modificar/corregir: persistencia de publicación, lector y registro de activaciones; distinguir restaurar almacenamiento de reactivar contenido. Una clave de firma retirada o revisión revocada no se acepta solo porque su hash coincide.
4. Verificar/comparar: PUB-01/03/04/05/06 y VER-02; recuperar desde backup autorizado, verificar objetos/firmas y reautorizar antes de servir; probar última revisión incompatible con software antiguo.
5. Aceptar: pérdida/reinicio no duplica aplicación ni activación; rotación mantiene política explícita; rollback solo usa revisión compatible y autorizada. Backup preserva dominios según su propio contrato, no sustituye autorización de exportación.
6. Entrega/recuperación: generador y publicación completos, con operación de restore reproducible. Ante incompatibilidad, distribuir corrección compatible o mantener versión actual; no degradar formatos persistentes. Depende de 3B.3.

### Fase 4B. Claude completo por superficie

Resultado: soporte demostrado por aplicación y versión, incluyendo errores y coexistencia. Requiere 4A y 3B; MWT permanece apagado en este piloto.

#### Ola 4B.1. Cerrar Code, chat y Cowork por separado

1. Entradas: 4A, 3B y matriz oficial fechada. Implementa adapter; QA verifica hosts.
2. Crear: casos por Code, chat y Cowork, mecanismo de instalación/ZIP, inventario de componentes cargados/ignorados y rutas de autenticación propias.
3. Modificar/corregir: empaquetado y reporte de capacidades. Chat necesita endpoint remoto; Cowork local depende de dónde corre la sesión; componentes ignorados no se anuncian operativos.
4. Verificar/comparar: HOST-01/03, CON-01/02 y DIST-01 por superficie; misma tarea y revisión esperada, confirmando permisos de la cuenta/organización y recuperación tras conexión caída.
5. Aceptar: cada superficie comprometida tiene instalación y ciclo propios; versión y limitaciones figuran en matriz. Un host no probado permanece abierto, sin heredar el resultado de otro.
6. Entrega/recuperación: matriz Claude y evidencias por versión. Desactivar únicamente la variante defectuosa y su concesión, preservando datos del núcleo. Depende de 4A.3 y 3B.4.

#### Ola 4B.2. Probar coexistencia, actualización y carga de contexto

1. Entradas: 4B.1. QA y seguridad dirigen pruebas A1/A2, padre/hijo y cambio de cuenta.
2. Crear: escenarios simultáneos de dos conversaciones con una conexión, dos plugins habilitados, propuesta maliciosa y actualización durante conversación abierta.
3. Modificar/corregir: referencias, caché y estrategia de carga del adapter; ofrecer desactivación del espacio sin desinstalar. Medir tokens de nombres/descripciones y contenido real por turno cuando el host lo permita.
4. Verificar/comparar: HOST-02, CON-04, AUTH-08, PROP-06/09, CTX-01/02, VER-01/02 e IA-01; medir contexto/request o evidencia host, no la afirmación de desconocer B.
5. Aceptar: no cruza destino ni contenido autorizado; si el host mezcla contexto ya entregado, limitar formalmente ese modo y mantener la exigencia de aislamiento abierta para él. Abrir conversación nueva no prueba actualización de ZIP: comprobar contenido instalado.
6. Entrega/recuperación: coexistencia y costo de contexto observados. Deshabilitar combinación insegura conserva revisiones y propuestas; no prometer borrar información que el host ya recibió. Depende de 4B.1.

#### Ola 4B.3. Completar estado, accesibilidad y evaluación con usuarios

1. Entradas: 4B.2, D09 y personas representativas. UI, accesibilidad y evidencia comparten guion, no respuestas sugeridas.
2. Crear: matriz control→acción→estado→recuperación para conexión, selección, envío, revisión, actualización y desconexión; evidencia de teclado y lector en entornos probados.
3. Modificar/corregir: panel de estado, mensajes y locales para versiones publicada/cargada, propuestas pendientes y fallos. Mantener el diseño/tokens/slots del repo, sin introducir framework visual nuevo.
4. Verificar/comparar: UX-01 a UX-05; tareas sin ayuda, tiempos, errores, comprensión y recuperación; pruebas web ensambladas y registros de consola/red saneados. Comparar resultados con umbrales acordados.
5. Aceptar: usuarios entienden qué está conectado, qué versión usan y qué falta; acciones funcionan por teclado y estados no contradicen el backend. Defectos de comprensión o barreras bloqueantes se corrigen y vuelven a probar en el alcance afectado.
6. Entrega/recuperación: cierre Claude completo y problemas residuales explícitos. Volver a UI compatible mantiene estado durable; ninguna etiqueta convierte un proceso pendiente en éxito. Depende de 4B.2.

### Fase 5. MWT opcional en el mismo artefacto

Resultado: conectar, cancelar, cambiar organización y desconectar sin perder capacidades locales. Requiere 2 y 4B; D07/D10/D14 y entorno autorizado antes de integración real.

#### Ola 5.1. Verificar contratos de Consola e IdP y conectar sin fallback

1. Entradas: D14, metadata real no secreta y usuarios de prueba no admin. Implementa identidad; participa propietario de Consola.
2. Crear: contrato de intercambio y permisos por recurso, inventario de grants/cachés y pruebas OAuth conjuntas. Revisar en Consola `mcp_device_grant_auth.py`, onboarding/auth, RBAC y emisión antes de atribuirles garantías.
3. Modificar/corregir: conexiones MWT y composición cliente; cliente público con PKCE sin secreto distribuido; confidencial con secreto en servidor. Impedir fallback a ServiceToken, clave gateway o credencial más privilegiada ante fallo del usuario.
4. Verificar/comparar: AUTH-01/02/03/04, CON-01 y OAuth adverso: issuer/audience/resource/redirect incorrectos, PKCE y sesión vencida. Comparar digest del artefacto antes/después de conectar.
5. Aceptar: mismo software; identidad y empresas vienen del backend; tokens FaberLoom/MWT/MinIO no se intercambian. Login del host no concede acceso MWT.
6. Entrega/recuperación: conexión de integración con usuario no admin y evidencias del servidor. Si falta Consola/IdP, solo contrato local demostrado y Fase 5 abierta. Depende de 2.3, 4B.3 y D14.

#### Ola 5.2. Particionar datos y conservar identidad de operaciones en curso

1. Entradas: 5.1 y política de cambio de cuenta. Implementa backend/conexiones; QA compara estados.
2. Crear: pruebas de caché caliente, imports/memoria/proyección por cuenta/empresa/espacio y operación pendiente al cambiar de conexión.
3. Modificar/corregir: claves de caché, referencias y ciclo de operaciones. Elegir cancelar o mantener identidad original; nunca reenviar una operación iniciada en A usando B. Vínculo del hogar con cuenta remota requiere decisión voluntaria.
4. Verificar/comparar: AUTH-02/03/08 y CON-04; manipular headers/claims, consultar empresa ajena, alternar cuentas y reiniciar. Leer archivos y contexto efectivo de B buscando testigos sintéticos de A.
5. Aceptar: ninguna lectura/escritura/metadato de otra partición; operación conserva principal original o queda cancelada antes de efecto; trabajo local permanece disponible en cada caso.
6. Entrega/recuperación: aislamiento multiempresa observado. Invalidar solo estado derivado de conexión afectada; conservar datos descargados bajo política de acceso, sin volverlos públicos. Depende de 5.1.

#### Ola 5.3. Medir revocación y desconexión con operaciones activas

1. Entradas: 5.2 y límite D10. Implementa identidad/plataforma; seguridad mide desde el servidor.
2. Crear: reloj/control de revocación, casos con cliente que no coopera, JWT/perfil/owner cache calientes, usuario/empresa/membresía inactivos y bridge en vuelo.
3. Modificar/corregir: invalidación de grants/tokens derivados, teardown, cancelación y revalidación antes del efecto externo. Detener un temporizador no acredita cancelación de peticiones ya iniciadas.
4. Verificar/comparar: AUTH-05/06/07 y LIFE-01, expiración, cambio de red legítimo y copia de credencial/device_id. Medir desde revocación confirmada hasta última operación que todavía pudo aceptarse; incluir cachés de gateway.
5. Aceptar: ventana efectiva dentro del límite aprobado, sin fallback; desconexión retira tools/credenciales/reintentos; efectos ya confirmados se informan, no se prometen deshechos. Capacidad local se verifica en cada fallo.
6. Entrega/recuperación: medición y límites reales de dispositivo. Revocar concesiones nuevas y apagar MWT conserva hogar; no reactivar credenciales expuestas para recuperar servicio. Depende de 5.2 y D10.

#### Ola 5.4. Cerrar escrituras gobernadas y migración legacy

1. Entradas: 5.3 e inventario de operaciones MWT. Implementa backend/tooling; revisión seguridad y dueño Consola.
2. Crear: matriz de escrituras directas permitidas frente a las que requieren Mesa, pruebas AUTH-09 y lista de consumidores de credenciales en URL.
3. Modificar/corregir: nuevas conexiones sin secretos en URL; adaptar consumidores y medir adopción antes de retirar legacy bajo autorización separada. Impedir que MWT, mirror o importación modifiquen conocimiento editorial gobernado fuera del aplicador.
4. Verificar/comparar: AUTH-09, CON-01, PROP-09, LIFE-01; llamadas directas, rutas alternativas, diagnostics y paquete; comparar catálogo efectivo antes/después por usuario y restaurar tarea local tras cada fallo.
5. Aceptar: cada escritura tiene dueño y política ejecutable; las gobernadas pasan por aprobación; ruta legacy retirada solo cuando existe migración acordada y evidencia de adopción. Documentar datos descargados y eliminación explícita.
6. Entrega/recuperación: cierre MWT opcional. Apagar integración sin reinstalar ni borrar datos; la recuperación no usa una ruta privilegiada retirada. Depende de 5.3.

### Fase 6A. DSH distribuible

Resultado: instalación real fuera del checkout, con runtime único. Requiere modelo y primer host estables; autorizar esta subfase de forma explícita.

#### Ola 6A.1. Preparar el bundle externo y compatibilidad de runtime

1. Entradas: 3B/4B y D12. Implementa tooling con arquitectura.
2. Crear: matriz runtime/peers y manifiesto de distribución externo, con recursos y dependencia de las bibliotecas portables/publicación según composición aprobada.
3. Modificar/corregir: partir de `packages/bundle/faberloom-app/package.json` y `cordis.patch.yml`; separar requisitos del bundle interno frente al instalable. Paquetes ya presentes en Desktop deben compartir identidad vía peers cuando así lo exige su gestor.
4. Verificar/comparar: contenido empaquetado, exports, recursos, peers y filas Cordis; pruebas `profile-packages`, `runtime-tree` y `prepare-package-set`; build/hygiene y prueba de carga del artefacto.
5. Aceptar: sin dependencia del checkout ni doble copia/montaje de paquetes reservados; inicia por launcher/perfil admitido y falla claramente si el runtime es incompatible.
6. Entrega/recuperación: bundle candidato y compatibilidad. Retirar variante defectuosa sin cambiar perfil/datos del usuario; no convertir una corrección de distribución en refactor del runtime. Depende de 3B.4/4B.3.

#### Ola 6A.2. Instalar, actualizar y retirar conservando datos

1. Entradas: 6A.1 y hogar limpio fuera del repo. QA con Desktop dirige pruebas.
2. Crear: smoke del artefacto publicado/empacado, instalación limpia y actualización con plugin/archivos del usuario existentes.
3. Modificar/corregir: manifiesto/recursos o instrucciones que fallen; reutilizar gestor de plugins. Distinguir rollback de contenido del comportamiento real de transacciones de plugins, que puede conservar cambios parciales.
4. Verificar/comparar: HOST-01, FS-02/03, LIFE-02 y DIST-01; instalar→tarea→propuesta→actualizar→desactivar→desinstalar; hashes de Workspace/historial antes/después y prueba con peer incompatible.
5. Aceptar: runtime único, tarea útil y propuesta real; actualización fallida recuperable mediante procedimiento demostrado; desinstalar no borra datos personales ni pretende revocar por sí sola una concesión remota.
6. Entrega/recuperación: certificación DSH por versión/SO. Volver a paquete compatible o reparar transacción según gestor existente, sin prometer rollback automático que no ofrece. Depende de 6A.1.

### Fase 6B. ChatGPT y Codex

Resultado: adapter OpenAI con soporte por superficie elegida. Requiere 3B/4B y documentación oficial vigente, sin transferir la certificación de Claude.

#### Ola 6B.1. Fijar formato, permisos y traducción OpenAI

1. Entradas: D12 y fuentes oficiales de plugins/auth/desktop consultadas al abrir la ola. Implementa tooling e identidad.
2. Crear: `portable/src/adapters/openai.ts`, esquema de compatibilidad y fixtures de empaquetado; decidir raíz `plugin.json`/`mcp.json` y compatibilidad `.codex-plugin` según versión comprobada.
3. Modificar/corregir: mapper de componentes y conexión específica; distinguir chat remoto de ejecución local Codex, sin trasladar agentes/hooks incompatibles ni secreto de otro cliente OAuth.
4. Verificar/comparar: DIST-01, CON-01/02, PKG-03/04 y HOST-01; tabla campo a campo y evidencia de instalación real de cada superficie comprometida.
5. Aceptar: restricciones preservadas o incompatibilidad explícita; permisos de lectura/propuesta separados; ningún manifest válido se considera por sí solo integración demostrada.
6. Entrega/recuperación: adapter candidato por versión. Rechazar instalación incompatible conservando contenido anterior; no cambiar el formato común para disfrazar una limitación del host. Depende de 3B.4/4B.3.

#### Ola 6B.2. Certificar ciclo, aislamiento y mantenimiento OpenAI

1. Entradas: 6B.1, cuenta/entorno autorizados y fixtures compartidos. QA y evidencia dirigen.
2. Crear: casos de tarea/propuesta/aprobación/publicación/nueva sesión, dos espacios y dos conversaciones; actualización, desconexión y desinstalación.
3. Modificar/corregir: solo adapter/conexión afectada; compartir corrección de negocio con núcleo cuando corresponda, actualizando tests de los demás consumidores.
4. Verificar/comparar: HOST-01/02, CON-03/04, AUTH-04/08, PROP-09, VER-01/02, IA-01, LIFE-02 y UX-01/03; mismo oráculo de efectos que Claude, sin exigir bytes iguales entre manifests diferentes.
5. Aceptar: propuesta realmente persistida, aprobación humana y nueva revisión cargada; ninguna llamada oculta a otra IA; límites de cada superficie publicados. ChatGPT pendiente no se cierra por éxito Codex.
6. Entrega/recuperación: matriz OpenAI y pruebas correlacionadas. Revocar conexión y desactivar adapter mantiene fuente/Mesa; volver solo a formato compatible. Depende de 6B.1.

### Fase 6C. Kimi Code

Resultado: instalación y funcionamiento en Kimi con alcance de proyecto comprobado.

#### Ola 6C.1. Crear conversión Kimi y definir alcance de instalación

1. Entradas: 3B/4B, D12 y documentación oficial Kimi vigente. Implementa tooling.
2. Crear: `portable/src/adapters/kimi.ts`, manifest y mapa de agentes/skills/MCP con restricciones; fixtures de instalación global y de proyecto.
3. Modificar/corregir: rutas de recursos y configuración de conexión por instalación; impedir que la comodidad de un plugin global se presente como separación entre proyectos.
4. Verificar/comparar: HOST-01/02, PKG-01/03 y CON-01/02; cargar desde carpeta ajena, alternar proyectos y comprobar qué componentes permanecen en contexto después de recargar.
5. Aceptar: formato oficial válido y componentes realmente cargados; campos no equivalentes reportados; alcance global/proyecto explicado con evidencia y límites.
6. Entrega/recuperación: adapter Kimi candidato. Limitar oficialmente modo global si mezcla contenido; desactivarlo sin modificar el espacio canónico. Depende de 3B.4/4B.3.

#### Ola 6C.2. Certificar tarea y ciclo de actualización Kimi

1. Entradas: 6C.1 y cuenta autorizada. QA usa la tarea común y referencias independientes A1/A2.
2. Crear: casos de recepción, aprobación humana, versión nueva, fallo de actualización, reload y desinstalación; evidencia de permisos efectivos.
3. Modificar/corregir: conversión, recarga o conexión que falle; mantener lógica de Mesa/publicación en FaberLoom.
4. Verificar/comparar: PROP-02/06/09, AUTH-04/08, CON-04, VER-01/02, LIFE-02 y UX-01/03; comparar recibos/bytes/estado y conservación de archivos locales.
5. Aceptar: tarea útil y propuesta recibida, revisión usada visible, aislamiento demostrado en el modo certificado y recuperación reproducible. Una respuesta plausible del modelo no satisface ningún efecto requerido.
6. Entrega/recuperación: soporte Kimi por versión. Retirar la variante o concesión afectada preserva datos y propuestas pendientes. Depende de 6C.1.

### Fase 6D. Gemini o Antigravity

Resultado: adapter para el producto mantenido que se elija; investigación negativa no equivale a entrega completa.

#### Ola 6D.1. Resolver producto y mecanismo oficial

1. Entradas: 3B/4B y decisión D12 específica. Arquitectura/tooling investigan producto, versión, cuenta y mecanismo soportado.
2. Crear: ficha de compatibilidad con fuentes fechadas, capabilities, autorización, instalación y diferencias entre producto elegido y CLI.
3. Modificar/corregir: matriz de soporte; no sustituir Antigravity por Gemini CLI sin decisión de producto ni inventar manifest por analogía.
4. Verificar/comparar: prueba mínima de carga/autorización en entorno autorizado, confrontada con documentación; clasificar cada capacidad como soportada, limitada, no comprobada o incompatible.
5. Aceptar: hay mecanismo demostrado y condiciones para implementar. Si no existe, cerrar investigación con impedimento, alternativa y condición de reanudación; mantener la entrega 6D pendiente.
6. Entrega/recuperación: decisión de apertura del adapter o bloqueo explícito. No producir paquete que aparente compatibilidad no demostrada. Depende de 3B.4/4B.3.

#### Ola 6D.2. Implementar y certificar el adapter elegido

1. Entradas: 6D.1 positiva, producto/versión confirmados. Implementa tooling/identidad; QA verifica.
2. Crear: adapter con nombre del producto real, fixtures y recorrido E2E; compatibilidad de skills/agentes/MCP y transporte remoto/local según host.
3. Modificar/corregir: conversión y conexión para preservar restricciones, contexto fijado y ausencia de secretos; no convertir funcionalidad inexistente en botón vacío.
4. Verificar/comparar: HOST-01/02, CON-01 a CON-04, AUTH-04/08, PROP-09, VER-01/02, LIFE-02 y DIST-01, más tarea útil y recuperación de actualización. Contrastar todos los efectos con núcleo persistido.
5. Aceptar: instalación, tarea, propuesta, actualización y desinstalación demostradas en producto elegido; las limitaciones quedan visibles antes de usarlo.
6. Entrega/recuperación: certificado de ese host. Retirar adapter sin tocar datos canónicos; si falla capacidad indispensable, conservar 6D abierta y su condición de reanudación. Depende de 6D.1 positiva.

### Fase 7A. Piloto real con utilidad observable

Resultado: una mejora útil de Marluvas o Eguisa llega a conocimiento aprobado y se reutiliza. Solo requiere los hosts e integraciones que use el piloto.

#### Ola 7A.1. Preparar tarea y medir resultado de referencia

1. Entradas: 4B, D04/D11 y autorizaciones para datos/persona; Fase 5 o adapter 6 correspondiente si se utilizan. Coordina `planner` con producto.
2. Crear: ficha de piloto con tarea concreta, criterio de utilidad, contenido permitido, resultado previo comparable, errores observables y mecanismo de retirada.
3. Modificar/corregir: configuración del espacio piloto y reglas de exportación; corregir déficits detectados en ensayo sintético antes de copiar datos reales.
4. Verificar/comparar: repetir recorrido con fixture saneado; comprobar audiencia y clasificación de todos los recursos; comparar tarea inicial sin mejora frente al criterio de negocio acordado.
5. Aceptar: persona, dato, host, tarea y métrica están acordados; no se infiere autorización de exportar por pertenecer a la empresa. Resolver explícitamente si consume la misma capacidad que el piloto Eguisa existente.
6. Entrega/recuperación: piloto listo y agenda; si falta persona/exportación, mantener datos sintéticos y no declarar PIL-01 cubierto. Depende de capacidades utilizadas demostradas.

#### Ola 7A.2. Reutilizar una mejora aprobada y recuperar un fallo

1. Entradas: 7A.1. Persona real realiza la tarea; QA observa y registra sin intervenir salvo bloqueo documentado.
2. Crear: evidencia PIL-01 de tarea→solución→Mesa→aprobación→publicación→otra tarea, con evaluación humana de utilidad y resultado correcto.
3. Modificar/corregir: defectos reproducibles del recorrido bajo alcance autorizado; una nueva propuesta conserva revisión y vuelve a aprobación si cambia su contenido.
4. Verificar/comparar: PIL-01, UX-02/03/05, PUB-01 y VER-01; segunda tarea usa revisión nueva; provocar fallo de actualización en entorno de piloto autorizado y recuperar última válida.
5. Aceptar: mejora reutilizada con resultado de negocio aceptado, evidencia de recuperación y ausencia de fuga. Tiempo menor o respuesta elogiosa sin resultado correcto no cuentan como éxito.
6. Entrega/recuperación: informe del piloto, hallazgos y decisión de distribución. Suspender espacio/adapter y conservar evidencia sin borrar conocimiento ni prometer recuperar copias descargadas. Depende de 7A.1.

### Fase 7B. Distribución y mantenimiento

Resultado: producto instalable, soporte explícito y recuperación reproducible. Requiere piloto y capacidades certificadas; producción sigue requiriendo autorización operativa independiente.

#### Ola 7B.1. Preparar release y canales por audiencia

1. Entradas: 7A y matriz de hosts demostrados. Implementan tooling/plataforma; revisa seguridad.
2. Crear: manifiesto de release con versiones, compatibilidad, autenticidad y canal público/privado; inventario de licencias y ejecutables declarados cuando existan.
3. Modificar/corregir: empaquetado y pipeline de release existentes; software genérico sin KB privada y contenido por espacio/audiencia. Firma y verificación usan confianza independiente de los archivos distribuidos.
4. Verificar/comparar: DIST-01, PKG-01/04, PUB-03/04 y comparación paquete construido→paquete distribuido→instalado. Comprobar que logs/reports no contienen payloads de clientes o credenciales.
5. Aceptar: solo hosts y funciones demostrados se anuncian; hashes y firmas corresponden a bytes finales; ningún secreto ni ejecutable no declarado; paquete privado limitado a su audiencia autorizada.
6. Entrega/recuperación: release candidata y aprobación de canal. Retirar versión defectuosa conserva la última válida y registro de activaciones; publicar es una operación separada autorizada. Depende de 7A.2.

#### Ola 7B.2. Generar documentación, diagnóstico y soporte comprobables

1. Entradas: 7B.1 y comportamiento observado. `technical-writer` con QA mantiene propietarios existentes.
2. Crear: guías de instalación/conexión/actualización/recuperación/desinstalación por host y matriz de soporte, pares documentales y runbook de incidencias.
3. Modificar/corregir: catálogo desde fuente y documentación divergente de MCP/KB/proyección/ejecución; diagnósticos separan instalación, autenticación, autorización, transporte y ejecución, sin datos privados.
4. Verificar/comparar: catálogo fuente→docs generadas→`tools/list` bajo propietario, miembro, tercero y credencial restringida; ejecutar instrucciones documentadas en entorno de prueba; tests documentales, doc-sync y enlaces.
5. Aceptar: toda capacidad anunciada tiene evidencia por versión; error indica qué pasó, qué se conservó y acción siguiente; ninguna guía exige token manual en recorrido normal ni oculta requisito de runtime.
6. Entrega/recuperación: documentación de soporte validada. Corregir instrucciones sin reescribir historial de evidencia; una guía obsoleta deja soporte afectado abierto. Depende de 7B.1.

#### Ola 7B.3. Ensayar actualización, retirada y cierre de cobertura

1. Entradas: 7B.2, CI pertinente y autorización operativa si corresponde. QA/evidencia ejecutan; `reality-checker` emite dictamen.
2. Crear: expediente de release y simulacro de recuperación que incluya fuente Git, Mesa, publicaciones, configuración y confianza, con compatibilidad comprobada.
3. Modificar/corregir: solo fallos descubiertos y pruebas correspondientes; actualizar matriz de soporte si una versión/SO no cumple. Mantener snapshots históricos y migraciones append-only exigidas.
4. Verificar/comparar: FS-03, LIFE-02, VER-02, PUB-01/03 y todos los requisitos aplicables; instalar versión previa compatible→actualizar→fallo→recuperar→desinstalar. Ejecutar verificador de huérfanos y comparar diff final con autorización.
5. Aceptar: cero requisitos obligatorios sin evidencia, cero hallazgos críticos/altos abiertos, checks requeridos aprobados y recuperación demostrada. Producción se declara solo si realmente se autorizó y ejecutó; release candidata no equivale a despliegue.
6. Entrega/recuperación: cierre firmado por responsables técnico/producto, evidencias saneadas y backlog explícito de soporte no entregado. Ante fallo, bloquear canal afectado y conservar última versión compatible. Depende de 7B.2.

## 7. Matriz de las 58 pruebas del paquete

Esta matriz fija la obligación de cada caso y su ola principal. Cada fila empieza como `no-comprobada` respecto de la implementación futura. Variantes por transporte, actor, superficie o plataforma son casos hijos; no se suman como requisitos nuevos para inflar cobertura. Olas posteriores reutilizan los casos cuando su cambio los afecta.

| ID | Ola principal | Oráculo y resultado exigido |
|---|---|---|
| BASE-01 | 2.1 | Hogar limpio inicia local sin login MWT, con datos durables |
| BASE-02 | 2.2 | Observación de tools/red/reintentos confirma MWT apagado |
| BASE-03 | 2.3 | SICOP y modelo propios operan independientemente, sin clave compartida |
| BASE-04 | 2.3 | Fallo externo produce error recuperable y conserva servicios locales |
| AUTH-01 | 5.1 | Digest del mismo software antes y después de activar MWT |
| AUTH-02 | 5.2 | ORG-A/ORG-B sin lecturas, escrituras ni metadatos cruzados |
| AUTH-03 | 5.2 | Multiempresa y selección manipulada no mezclan datos |
| AUTH-04 | 1.3 | HTTP, request y executor deniegan llamada directa prohibida antes de efecto |
| AUTH-05 | 5.3 | Revocación con caché caliente dentro de límite acordado |
| AUTH-06 | 1.3, 5.3 | Inactividad o membresía retirada deniega nuevas operaciones y trata las activas |
| AUTH-07 | 5.3 | Credencial copiada/device_id y cambio legítimo de red revelan límites reales |
| AUTH-08 | 5.2 | Cambio de cuenta no lleva archivos/contexto de A a B |
| PROP-01 | 1.2 | Claves distintas con contenido igual producen dos ítems independientes |
| PROP-02 | 1.2 | Misma clave/contenido concurrente y tras reinicio produce un solo ítem |
| PROP-03 | 1.2 | Misma clave con otro contenido genera conflicto sin sobrescritura |
| PROP-04 | 1.2 | Clave ajena y campos de autoridad no exponen ni alteran otro ítem |
| PROP-05 | 1.2 | Coincidencia de negocio no modifica ítem programado ni su ejecución |
| PROP-06 | 1.2, 4B.2 | Código/autoaprobación permanece pendiente y fuera de conocimiento vigente |
| PROP-07 | 3A.1 | Base cambia después de aprobación: cero aplicación automática |
| PKG-01 | 3A.2, 3B.1 | Detectar contaminación en reglas, skill, agente, contexto, metadata, recurso y herencia |
| PKG-02 | 3B.1 | Hijo no exporta datos de padre privado sin acceso por contribución |
| PKG-03 | 3B.3 | Inputs equivalentes generan mismo inventario/digest bajo condiciones fijadas |
| PKG-04 | 3B.3 | Cambio de metadata, identidad o contenido altera versiones/hashes conforme al contrato |
| FS-01 | 3B.2 | Solapamiento, alias, enlace o junction externo se rechazan antes de escribir |
| FS-02 | 3B.2 | Archivos ajenos intactos y gestionados editados generan conflicto explícito |
| FS-03 | 3B.2 | Corte/bloqueo conserva última salida válida recuperable |
| HOST-01 | 4A.1 | Desde carpeta ajena carga recursos, revisión y alcance correctos |
| HOST-02 | 4B.2 | A y B juntos: aislamiento comprobado o modo limitado con requisito abierto |
| LIFE-01 | 5.3 | Desconectar retira MWT y conserva datos/capacidades locales |
| LIFE-02 | 6A.2, 7B.3 | Desinstalar no borra Workspace/historial; revocación es separada |
| UX-01 | 1.4, 4A.3 | Cero tokens, comandos y edición de configuración para conectar normalmente |
| UX-02 | 4A.3, 7A.2 | Tiempo y ayudas observados contra umbrales aprobados de conexión/ciclo |
| UX-03 | 1.5, 4B.3 | Usuario entiende fallo, trabajo preservado y siguiente acción |
| UX-04 | 1.5, 4B.3 | Instalado, desconectado, antiguo y carga no confirmada se distinguen |
| UX-05 | 1.5, 4A.3 | Persona explica el cambio y decide sin leer JSON u otras estructuras |
| CTX-01 | 3B.1 | Padre restringido no filtra contenido, títulos ni referencias al hijo |
| CTX-02 | 3B.1 | Dependencia ausente/contexto grande bloquea o usa consulta autorizada; sin recorte silencioso |
| CON-01 | 1.4, 5.4 | Cancelar/expirar/repetir sin secretos en URL, paquetes, logs ni modelo |
| CON-02 | 1.3, 3A.4 | Lectura y propuesta se deniegan mutuamente sin permiso correspondiente |
| CON-03 | 1.4 | Callback único y selección original validada aun con dos conexiones simultáneas |
| CON-04 | 1.4, 4B.2 | Dos conversaciones mantienen su espacio/revisión sin estado global mutable |
| PUB-01 | 3A.3, 3B.4 | Corte en cada paso se recupera con una aplicación y una activación |
| PUB-02 | 3A.1 | Cambio de fuente entre aprobación/aplicación bloquea el diff |
| PUB-03 | 3A.3 | Alterar archivo/manifiesto/firma/identidad rechaza conjunto y conserva versión anterior |
| PUB-04 | 3A.3 | Credencial publicadora no sobrescribe ni borra lo protegido por retención |
| PUB-05 | 3A.3 | Fuente apagada conserva aprobación, informa espera y reanuda sin duplicación |
| PUB-06 | 3B.1 | Cambio del padre identifica hijos y publica revisiones con permisos reevaluados |
| PUB-07 | 3A.1, 3B.2 | Rutas cruzadas, archivos ocultos, enlaces cambiados y concurrencia no amplían diff |
| VER-01 | 4A.2, 4B.2 | Publicada y usada se distinguen; nueva conversación demuestra revisión nueva |
| VER-02 | 3B.4 | Rollback reevalúa permisos/compatibilidad y no recupera contenido revocado |
| HOST-03 | 4B.1 | Evidencia separada de componentes/conexión en chat, Cowork y Code |
| IA-01 | 4A.2, 6B.2 | Observación de invocaciones confirma ausencia de otra IA oculta |
| PROP-08 | 1.2 | Tamaño/frecuencia excedidos se rechazan sin afectar propuestas ajenas |
| PROP-09 | 1.1 | Toda aprobación, importación y ruta alternativa requiere acción humana exacta |
| PROP-10 | 1.5 | Abrir HTML/imagen remota/enlace malicioso no ejecuta ni transmite datos |
| AUTH-09 | 5.4 | Ninguna escritura MWT gobernada elude Mesa; directas permitidas enumeradas |
| DIST-01 | 7B.1 | Genérico sin contenido privado; privado autorizado; ambos sin secretos/ejecutables ocultos |
| PIL-01 | 7A.2 | Solución real aprobada, publicada y reutilizada con utilidad aceptada |

### 7.1 Regresiones de capacidades conservadas

Los F01 a F50 mantienen su definición en el checklist existente. El registro de ejecución los importa por ID y decide aplicabilidad según el delta, con aprobación del revisor si propone no aplicabilidad. Los manuales del VPS se adaptan primero a entorno no productivo; su texto no autoriza acceso al VPS.

| Grupo de conservación | Pruebas existentes a considerar | Comparación obligatoria |
|---|---|---|
| REG-SPACE | `spaces/tests/{spaces,reference}.spec.ts`, `context/tests/context.spec.ts` | Espacios/subespacios, ownership, herencia, import/export y aislamiento |
| REG-AGENT | `agents/tests/{agents,reconcile}.spec.ts`, `defaults/tests/defaults.spec.ts` | Políticas, presupuesto, selección/fallback explícito, catálogo y ausencia de memoria ajena |
| REG-MEMORY | `learning/tests/{memory,corrections}.spec.ts` | Correcciones, candidatos, promoción, revocación y linaje |
| REG-RUN | `routines/tests/routines.spec.ts`, `workflows/tests/{workflows,compile,e2e}.spec.ts` | Versión fijada, grafo autoritativo, esperas y compilación |
| REG-EXEC | `execution/tests/{dispatcher,liveness}.spec.ts` | Deduplicación, reanudación, permisos de efectos y planificación existente |
| REG-BOARD | `board/tests/{board,board-identity,board-tenant,board-effects,board-checks,board-bulk-shadow,board-e10}.spec.ts` | Mantener submit general y controles de negocio; propuesta nueva no sustituye su semántica |
| REG-PROJECTION | `harness-projection/tests/{harness-projection,loader-composition}.spec.ts`, `skill-install` | Bloques del usuario y recursos instalados; exportar exige autorización adicional |
| REG-BACKUP | `backup/tests/{backup,migrations}.spec.ts`, mirror y bridge tests | Integridad/restore y replicación sin crear decisiones editoriales no acreditadas |
| REG-DESKTOP | `apps/desktop/tests/{identity,product-mcp,main-startup,profile-packages,backend-controller}.spec.ts` | Modo remoto conservado donde corresponda; nuevo modo local sin activación implícita |
| REG-SESSION | Snapshots de sesión/SDK/ACP/Web afectados y proyección Python si cambia Session | Log reconstruible, generaciones previas intactas y consumidores actualizados |

Si un test histórico espera comportamiento que ahora se corrige, documentar el requisito que cambió y añadir su sucesor; no borrar assertions para conseguir verde. Registrar diferencias intencionales por caso, no aceptar en bloque una regeneración de snapshots.

## 8. Recorrido completo de validación

El siguiente recorrido es el ensayo de aceptación integrado. Puede ejecutarse primero con datos sintéticos y luego, donde proceda, con datos del piloto autorizado. Cada paso genera evidencia correlacionada mediante runId, propuesta, espacio y revisión.

| Paso | Acción y observación externa | Criterio de comparación | Fallo que debe ensayarse |
|---|---|---|---|
| 1 | Capturar entorno, HEAD/diff y requisitos; comprobar herramientas disponibles | Identidad de código y fixtures coincide con ejecución | Evidencia vieja o runner ausente |
| 2 | Crear hogar sin MWT, Workspace, padre e hijo | Persistencia, permisos y red frente a configuración esperada | Carpeta inaccesible, datos de otro hogar |
| 3 | Configurar modelo y SICOP independientemente | Credenciales/consumo separados; servicios locales intactos | Proveedor sin key y SICOP caído |
| 4 | Generar/publicar revisión inicial desde Git autorizado | Inventario→bytes→firma→objeto recuperado→activación | Dependencia privada, contaminación, MinIO caído |
| 5 | Instalar adapter desde carpeta ajena | Componentes y recursos cargados según host | Formato incompatible o runtime ausente |
| 6 | Autorizar lectura/propuesta y elegir A1 | Consentimiento y referencia ligados a actor/conexión/A1/revisión | Cancelación, callback repetido o sustituido |
| 7 | Abrir dos conversaciones A1/A2 y trabajar | Cada referencia conserva destino/revisión; no contenido cruzado | Cambio de cuenta o grant revocado |
| 8 | Listar tools y llamar directamente una operación prohibida | Denegación en executor y ausencia de efecto | Token amplio/legacy/mirror intenta aprobación |
| 9 | Enviar propuesta y reintentar tras respuesta incierta | Recibo y único ítem persistido con hash esperado | Clave repetida con otro contenido |
| 10 | Leer en Mesa antes/después/motivo/evidencia | Contenido revisable sin carga remota ni ejecución | HTML, imagen externa y orden de autoaprobar |
| 11 | Rechazar una propuesta y aprobar otra como persona | Rechazada no cambia Git; aprobada liga diff/base/hash | Aprobación repetida o base cambiada |
| 12 | Aplicar y cortar el proceso después del commit | Solo archivos aprobados; reinicio no duplica | Parche multiarchivo, enlace cambiado, checkout sucio |
| 13 | Publicar, recuperar, activar y cortar en cada transición | Una publicación recuperada y una activación durable | Firma inválida, subida incompleta, borrado prohibido |
| 14 | Comparar sesión abierta y nueva; actualizar paquete si incrusta contenido | Antigua sigue fijada; nueva usa bytes de revisión nueva | Host aún usa ZIP anterior |
| 15 | Conectar MWT con usuario no admin y cambiar empresa | Mismo artefacto; datos particionados y principal fijo | Token expirado, claims manipulados, cambio durante efecto |
| 16 | Revocar y desconectar con cachés calientes | Ventana medida, tools retiradas y local utilizable | Cliente no coopera o bridge en vuelo |
| 17 | Actualizar software, recuperar y desinstalar adapter | Archivos personales/historial iguales y formato compatible | Actualización interrumpida o peer incompatible |
| 18 | Ejecutar verificador de cobertura y revisión independiente | Ningún requisito obligatorio sin caso/evidencia/dictamen | Skip oculto, cero tests o expected alterado sin revisión |

### 8.1 Evidencias mínimas del ensayo

Guardar inventarios y hashes recalculados, logs saneados de ejecución, test reports con conteos, estados durables antes/después, diff Git de fuente sintética, manifiesto y firma, comprobante de recuperación MinIO, registros de activación, herramientas efectivas por identidad, confirmación de revisión del host, capturas de UI y observación de usuario. Las capturas no sustituyen relectura de almacenamiento y los logs no sustituyen interacción humana de usabilidad.

No almacenar tokens, cookies, códigos de autorización, headers privados, contraseñas ni payloads reales en evidencias compartidas. Una relación por IDs opacos sintéticos permite correlación; el expediente de un piloto real requiere acceso restringido y una versión saneada para el repositorio. La retención de evidencia se decide con el propietario antes de 7A.

### 8.2 Reconciliación de estados y efectos

Para cada propuesta, comprobar conjuntamente: identidad exclusiva, digest de contenido, estado Mesa, prueba humana válida, base Git, commit aplicado, revisión generada, objeto verificado, activación y carga observada. Una notificación/UI no puede adelantarse al commit durable que anuncia. Git, Mesa y MinIO no comparten transacción: cada paso tiene clave idempotente y estado de reconciliación.

El replay del modelo sirve para repetir entradas; no genera la verdad esperada del sistema. El comparador usa efectos externos preparados por QA. Si crash deja efecto realizado sin estado actualizado, el siguiente intento verifica ese efecto por identidad antes de actuar; si no puede distinguirlo, queda en estado de conciliación explícito y no repite la escritura a ciegas.

## 9. Evaluación y cierre

La evaluación distingue cobertura del plan, ejecución de pruebas y cumplimiento del producto. Las tres métricas se reportan por separado para evitar que un plan completo parezca una implementación terminada.

### 9.1 Criterios comunes de aceptación de una ola

- [ ] Todas las decisiones y precondiciones de la ola están resueltas o el trabajo está declarado bloqueado.
- [ ] Los archivos cambiados pertenecen a la asignación y el trabajo previo permanece.
- [ ] Cada requisito tiene prueba positiva, negativa y de recuperación cuando hay estado/efecto.
- [ ] Se ejecutaron pruebas pertinentes con conteos verificables y entorno/versión registrados.
- [ ] Se compararon bytes, permisos, estado y efectos con oráculos independientes.
- [ ] Cambios de persistencia tienen migración/reconocimiento; logs históricos siguen intactos.
- [ ] Se actualizan consumidores, README, tipos, documentación generada y snapshots exigidos.
- [ ] El revisor independiente resolvió hallazgos bloqueantes y comprobó las correcciones.
- [ ] La recuperación se probó, o la ola no contiene efectos y documenta su reversión documental.
- [ ] El cierre nombra próximos trabajos y conserva todos los requisitos pendientes.

### 9.2 Reglas de decisión

`Cobertura de planificación = requisitos con ola, dueño y verificación / requisitos inventariados`. Para los casos del paquete, el denominador fijo es 58. `Cobertura ejecutada = casos aplicables ejecutados / casos aplicables registrados`. `Cumplimiento = casos aplicables demostrados / casos aplicables registrados`. No excluir skips, fallos de entorno ni casos manuales pendientes del denominador aplicable.

Una ola está aprobada cuando todos sus requisitos obligatorios están demostrados y sus controles documentales/técnicos requeridos pasan. Una fase requiere además integración de sus olas, demostración de usuario pertinente y recuperación. Un defecto crítico/alto de autorización, integridad, pérdida de datos, aprobación humana o aislamiento bloquea el cierre; un promedio alto no lo compensa.

| Dimensión | Evidencia | Condición de aceptación |
|---|---|---|
| Corrección | Tests, estados y efectos comparados | Requisitos funcionales aplicables demostrados |
| Aislamiento y autoridad | Negativas por actor/ruta y exportación | Ninguna ruta gobernada elude permisos o revisión humana |
| Integridad y recuperación | Caídas reales, manifiestos y restores | Última válida recuperable, sin duplicación ni pérdida |
| Compatibilidad | Host/SO/runtime y artefacto instalado | Solo combinaciones probadas reciben soporte |
| Experiencia y accesibilidad | Observación de personas y controles reales | Umbrales acordados y cero barreras bloqueantes |
| Conservación | REG-* y F01 a F50 aplicables | Ninguna capacidad original desaparece por el nuevo adapter |
| Mantenibilidad | Dueños, contratos, docs y código revisado | Sin reglas de negocio duplicadas ni catálogos manuales divergentes |

La autoevaluación de cada agente usa exactitud, completitud, claridad, accionabilidad y concisión de 1 a 5 con evidencia y mejora concreta. Evalúa la calidad de su entrega; nunca sustituye pruebas ni firma aceptación de producto. `reality-checker` emite el dictamen final de evidencia y producto autoriza continuar conforme al alcance acordado.

### 9.3 Condiciones explícitas de parada

Detener trabajo dependiente ante autorización no acreditada, requisito obligatorio no comprobado, exposición entre espacios/empresas, efecto sin aprobación, base alterada, datos personales perdidos, contenido/hash no correlacionado, secret en artefacto, dependencia requerida ausente o manifest incompatible. Crear incidencia reproducible y conservar evidencia; continuar solo trabajos independientes dentro del alcance autorizado. No recortar el test ni cambiar el expected para ocultar el problema.

## 10. Esfuerzo y coordinación

Las cifras son estimaciones iniciales de esfuerzo de ingeniería, no tiempos medidos ni promesa de calendario. Una jornada-persona representa hasta ocho horas de trabajo enfocado; incluye implementación y verificación de esa fase, y excluye espera por cuentas, decisiones, entornos y personas. Reestimar al cerrar 0.3 y después de 4A.

| Fase | Olas | Estimación inicial | Incertidumbre dominante |
|---|---:|---|---|
| 0 | 4 | 5 a 8 jornadas-persona | Contratos, consumidores y herramientas disponibles |
| 1 | 5 | 12 a 20 | Aprobación/importación, persistencia y OAuth del host |
| 2 | 3 | 7 a 12 | Composición Desktop, hogares existentes y proveedor |
| 3A | 4 | 10 a 16 | Aplicador, durabilidad y MinIO real de prueba |
| 4A | 3 | 5 a 9 | Restricciones del chat y acceso a una persona |
| 3B | 4 | 10 a 16 | Herencia, rutas Windows y compatibilidad de componentes |
| 4B | 3 | 7 a 12 | Tres superficies Claude y usuarios representativos |
| 5 | 4 | 10 a 18 | Consola/IdP, cachés y política legacy |
| 6A | 2 | 4 a 7 | Runtime/peers y gestor de plugins |
| 6B | 2 | 5 a 9 | Diferencias ChatGPT/Codex y OAuth |
| 6C | 2 | 4 a 7 | Instalación global/proyecto y recargas |
| 6D | 2 | 2 a 4 de investigación; 4 a 8 de implementación si viable | Producto y mecanismo oficial por confirmar |
| 7A | 2 | 3 a 6 | Datos permitidos, persona y tarea real |
| 7B | 3 | 6 a 10 | Canales, documentación y recuperación final |

No sumar estas cifras como calendario: hay dependencias y trabajo paralelo parcial. UX, seguridad y plataforma comparten la misma demostración de salida. `board/src/index.ts`, `mcp-server/src/index.ts`, composición y `package.json` tienen un integrador único por ola; se secuencian cambios que los compartan.

No se puede afirmar si compite con el piloto Eguisa sin agenda, responsables y entorno compartido. En 0.2, coordinación registra esas capacidades: si ambos requieren el mismo operador de Consola, persona de validación o ventana de pruebas, esa actividad se agenda en serie; los cortes locales con fixtures sintéticos pueden continuar en paralelo. 7A puede usar Eguisa solo con decisión explícita sobre tarea y prioridad.

## 11. Entrega entre agentes

Este formato se incorpora al mensaje de asignación y a la devolución. Es una plantilla de trabajo, no una configuración ejecutable de OpenCode.

```text
Asignacion
  ola: identificador de esta referencia
  agente: ID exacto del catalogo
  revisor: ID distinto para decisiones de riesgo
  objetivo: resultado observable
  requisitos: IDs y variantes aplicables
  entradas: archivos, decisiones, revisiones, resultados previos
  archivos_permitidos: lista cerrada; integrador de cada compartido
  contratos: precondiciones, postcondiciones, errores, persistencia
  autorizacion: tareas/comandos/entornos permitidos
  pruebas: positivas, negativas, recuperacion y comparadores
  salida: cambios, logs, artefactos, diferencias y bloqueos
  parada: dependencias ausentes, conflicto o segundo fallo repetido

Devolucion
  estado: demostrada | refutada | no-comprobada | no-aplicable
  archivos_cambiados: lista y motivo por requisito
  comandos: argv, cwd, entorno, exitCode y conteos reales
  evidencia: rutas y digests calculados
  comparacion: cambios intencionales, regresiones, desconocidos
  recuperacion: escenario ejecutado y estado final
  hallazgos: severidad, reproduccion y propietario
  autoevaluacion: cinco ejes con evidencia
  siguiente_ola: precondiciones pendientes y propuesta concreta
```

Antes de integrar, el coordinador coteja esta devolución con el diff y el registro de pruebas. Antes de cerrar, el revisor relee evidencia original y verifica que pertenece al mismo estado de código. Si otro agente corrige el cambio, la evidencia anterior se conserva pero se marca obsoleta para los casos afectados; solo esos casos y sus consumidores se repiten.

## Dev Note

Este plan es una propuesta temporal, no autoridad sobre funcionalidad ya implementada. La preparación leyó íntegramente el paquete y utilizó dos contratos de inspección read-only: `architect` para local/generador/distribución y `security-architect` para tokens/Mesa/herencia/rutas alternativas. Sus informes son evidencia estática; no son certificaciones de ejecución ni de producción.

Los principales hallazgos que cambian la ejecución son la escritura directa de filas de Mesa por mirror, la exposición de tokens completos en listados, el inicio Desktop condicionado por identidad remota, la activación remota antes de resolver el modo local y la adquisición de títulos sin actor en la proyección. Se asignan a 1.1, 1.3, 2.1, 2.2 y 3B.1 respectivamente. La rama del generador, Consola, MinIO y hosts reales conservan sus decisiones pendientes. El detalle de cada hallazgo se confirma al abrir su ola: la lectura de `mirror/src/sync.ts` no localizó todavía la escritura de filas, así que 1.1 debe fijar el punto exacto antes de declarar cerrado el control de aprobación.

El 2026-11-05 se resolvieron por arquitectura las decisiones D01 a D05 y D08, detalladas en 2.2.1. Fijan superficie y cuenta iniciales, ausencia de servicio remoto en el primer corte, repositorio Git canónico con actor técnico único, exclusión de CEO-ONLY/N3/N4 por lista de permitidos, reglas de herencia por contribución y modo de proveedor con hogar fuera de carpetas sincronizadas. D06, D07 y D09 a D14 siguen abiertas y bloquean solo las olas que las consumen. El primer corte de código es 1.1 con H0.

Promoción prevista: decisiones de diseño a `.agents/notes/proposed/` y después a `implemented/` solo al implementarse; contratos del formato a documentación del propietario `portable`; publicación a su README; comandos verificados a guías del usuario/desarrollador. El registro estructurado de requisitos pasa a ser la autoridad de resultados cuando se construya H0 en la primera ola de código autorizada; este documento conserva la definición de las olas y no inventa estados de ejecución.

La [Agent Note de verificación](../../.agents/notes/proposed/testing/2026-11-05-faberloom-portable-verification.md) registra la propuesta, sus alternativas y relación con decisiones existentes. La revisión independiente de `reality-checker` detectó y se corrigió la dependencia de lectura entre 1.4/3A.4/1.5, el alcance exclusivamente documental de 0.4 y la exclusión explícita de sesiones/transcripciones. También se retiró 3A.1 de las posibles olas iniciales de H0 porque depende de 1.1.

Validación de esta entrega documental: comparación automática con el plan fuente confirmó 58 IDs únicos presentes y 43 olas únicas, cada una con sus seis campos de trabajo. Los verificadores existentes de párrafos Markdown, enlaces/fragmentos, presupuestos y pairing del plan pasaron mediante `node --import tsx`; los verificadores de formato y clasificación de Agent Notes también pasaron. Esto no ejecuta el harness propuesto ni las pruebas del producto. `pnpm` no está en el PATH, pero `corepack pnpm` responde la versión declarada por `packageManager`; los agregados `pnpm run test:docs`, `pnpm run doc-sync` y `pnpm run lint` se ejecutan desde esa invocación y sus resultados se registran como evidencia de la ola que los ejecute.

Autoevaluación de la documentación, separada de aceptación de producto:

| Eje | Nota | Evidencia y mejora concreta |
|---|---:|---|
| Exactitud | 4/5 | Fuentes y rutas contrastadas; nombres de módulos nuevos deben fijarse al cerrar 0.3 |
| Completitud | 4/5 | Seis archivos leídos, 43 olas y 58 casos conservados; las entradas externas siguen pendientes y tienen dueño |
| Claridad | 4/5 | Índice, dependencias y plantilla uniforme; al ejecutar conviene extraer solo la ola activa para reducir lectura |
| Accionabilidad | 4/5 | Cada ola tiene cambios, pruebas, aceptación y recuperación; requiere resolver decisiones y entorno antes de ejecutar |
| Concisión | 4/5 | Detalle solicitado concentrado en una referencia; evitar duplicarlo en tickets, enlazando el ID de ola |

Promedio: 4,0/5. Prioridades siguientes: cerrar D01 a D08 según dependencia, fijar el mapa de consumidores en 0.3 y resolver el entorno antes de H0. La valoración se apoya en los conteos y la revisión; la aceptación del nivel de detalle corresponde al usuario.
