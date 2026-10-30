# Estructura de una carpeta KB

Una carpeta KB es una carpeta portable que reúne el conocimiento de un equipo —skills, agentes, rutinas, flujos y contexto— con la forma que el producto ya sabe leer, de modo que instalarla no exija editar archivos de configuración.

Este documento es la especificación que comprueba [`scripts/validate-kb.mjs`](../../scripts/validate-kb.mjs) y el ejemplo real que la acompaña es [`examples/kb-contabilidad`](../../examples/kb-contabilidad).

Cada sección distingue lo que el producto lee hoy de lo que sigue propuesto: elegir la carpeta KB instala sus skills y sus agentes, en las dos formas que hay más abajo, mientras que las rutinas, los flujos y el contexto viajan por el espejo una vez dados de alta, y el resto lo hace una persona.

## El harness de una carpeta de trabajo

Una carpeta que ya tiene su harness sigue la convención que usan los proyectos de este equipo: los archivos de la raíz solo redirigen, `.agents/` es la fuente de verdad, cada CLI tiene además su propia instalación, y el grafo y la bóveda de notas viven en sus dos carpetas.

```
<proyecto>/
├── AGENTS.md                  entrypoint neutral: Kimi y cualquier CLI que siga la convención; apunta a .agents/
├── CLAUDE.md                  entrypoint de Claude Code; apunta a .agents/
├── GEMINI.md                  entrypoint de Gemini CLI; apunta a .agents/
├── harness.config.yaml        configuración del harness del proyecto
├── .agents/                   fuente de verdad del harness
│   ├── config.yaml
│   ├── rules/                 reglas siempre activas (por ejemplo harness.md y graphify.md)
│   ├── subagents/             un archivo por rol: cuándo se usa y qué sabe hacer
│   ├── skills/<nombre>/SKILL.md
│   ├── tools/                 registry.yaml y los scripts que declara
│   ├── workflows/             un archivo por flujo
│   └── decisions/             ADR-0001-*.md
├── .claude/                   instalación de Claude Code (agents/, skills/, commands/, settings.local.json)
├── .gemini/                   instalación de Gemini (mcp-configs/, scripts/, .pi/extensions/)
├── .kimi-code/                instalación de Kimi (agents/, commands/, rules/, skills/, mcp-configs/, AGENTS.md)
├── .obsidian/                 bóveda de notas (app.json, core-plugins.json, graph.json, workspace.json)
└── graphify-out/              grafo del proyecto (graph.json, GRAPH_REPORT.md, manifest.json, cache/, snapshots con fecha)
```

| Ruta | Qué es | Quién lo lee |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Los tres entrypoints, cada uno con la convención de su CLI | El CLI correspondiente, que sigue el puntero a `.agents/` |
| `.agents/rules/*.md` | Reglas que aplican siempre, sin invocación | El agente al arrancar en esa carpeta |
| `.agents/subagents/*.md` | Los roles disponibles y cuándo se usan | El agente, al delegar o al adoptar un rol |
| `.agents/skills/<n>/SKILL.md` | Una skill con su frontmatter y su procedimiento | El agente, cuando la tarea la invoca |
| `.agents/tools/registry.yaml` | Las herramientas propias del proyecto y sus scripts | El agente, al necesitar una herramienta que no es del sistema |
| `.agents/workflows/*.md` | Un flujo con sus pasos | El agente, cuando el trabajo sigue ese flujo |
| `.agents/decisions/ADR-*.md` | Las decisiones del proyecto, con su contexto | Las personas y los agentes que revisan por qué algo es como es |
| `.claude/`, `.gemini/`, `.kimi-code/` | La instalación de cada CLI (agentes, comandos, reglas, skills, MCP) | Cada CLI, con su propio formato |
| `.obsidian/` | La bóveda de notas del proyecto | Obsidian |
| `graphify-out/` | El grafo del código y su informe | Las personas y los agentes que consultan el grafo |

FaberLoom escribe esta misma disposición cuando prepara un WorkSpace o un Espacio, y solo con lo que ese ámbito ha usado: los agentes y las skills que se invocaron allí, sus flujos, su memoria, su contexto y sus rutinas. Lo suyo vive bajo `.faberloom/`, que es el manifiesto con lo que escribió y lo que puede retirar.

### Vectorizar (graphify) y dibujar (archify)

El grafo y los diagramas son herramientas externas que el proyecto ya usa, y cada una tiene su carpeta de salida y su skill:

| Herramienta | Paquete y versión | Comando | Salida | Skills |
|---|---|---|---|---|
| graphify | `graphifyy` 0.9.91 (Python) | `uv tool install --upgrade graphifyy` o `pip install -U graphifyy`; luego `graphify build`, `graphify query "<pregunta>"` | `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `manifest.json`, `.graphify_labels.json`, `cache/` y una carpeta por fecha) | `graphify` (su `SKILL.md` viaja con el paquete: consulta el grafo antes de leer el código) |
| archify | `archify` 3.1.0 (Node, `bin/archify.mjs`) | `node bin/archify.mjs finalize <tipo> <candidate.json> <salida.html> --repo-root <raíz> --quality showcase` | `.archify/<tipo>-<slug>-<AAAAMMDD-HHMMSS>/` con `candidate.json` y el HTML | `archify`, más `archify-review` y `archify-tuning` |

Las dos skills llevan su `name` en kebab-case y su `description` con el disparador, así que se instalan como cualquier otra —poniendo la carpeta de la skill en «Elegir carpeta»— y el `graphify-out/` del proyecto se consulta antes de leer el código: la pregunta «¿cómo funciona X?» se responde con `graphify query`. En Windows, graphify trae además `skill-windows.md` con la detección del intérprete de Python.

Ese empujón ya no depende de que alguien lo escriba a mano: la proyección del harness escribe en el `AGENTS.md` de cada ámbito una sección de reglas por defecto (`DEFAULT_SCOPE_RULES`, en `packages/faberloom/harness-projection/src/render.ts`) que manda consultar el grafo con `graphify` antes de leer código, mantenerlo al día tras un cambio y dibujar con `archify` en lugar de describir solo en prosa. Y un harness entero —una carpeta con `skills/`, `agents/`, `rules/`, `commands/` o su `.zip`— se instala de una vez con el botón «Instalar harness» del panel o con `scripts/install-harness.mjs`, que además escribe las reglas del harness en un bloque gestionado del `AGENTS.md` de la casa del usuario.

## Árbol de una carpeta KB

Una carpeta KB reúne el contenido de un equipo para instalarlo en cualquier equipo: skills y agentes sobre todo, más las rutinas, los flujos y el contexto que el producto ya sabe transportar por el espejo.

```
kb-contabilidad/
├── AGENTS.md                  reglas de la KB (las lee el agente cuando la carpeta es su directorio de trabajo)
├── kb.json                    manifiesto: nombre, versión, autor, descripción y contenido
├── skills/                    una carpeta por skill; el instalador la lee y también la lee `skills/<n>/SKILL.md`
│   ├── asientos-contables/
│   │   ├── SKILL.md           frontmatter (name, description) y el procedimiento
│   │   └── ...                referencias, plantillas o scripts que la skill necesite
│   ├── cierre-mensual/
│   │   └── SKILL.md
│   ├── conciliacion-bancaria/
│   │   └── SKILL.md
│   └── iva-declaraciones/
│       └── SKILL.md
├── agents/                    un agente por carpeta de preset, o un archivo Markdown por agente
│   ├── contable-jefe/
│   │   ├── preset.yml         name y description; lo lee el descubrimiento de presets
│   │   └── agent.cordis.yml   la composición del agente (persona, herramientas)
│   ├── analista-fiscal.md     alternativa: el cuerpo del archivo se convierte en la persona
│   └── auditor-interno.md
├── routines/                  definiciones de rutina en JSON
│   ├── cierre-mensual.json
│   └── conciliacion-semanal.json
├── workflows/                 definición de flujo en JSON
│   └── factura-a-asiento.json
└── context/                   documentos de contexto para personas
    └── politica-contable.md
```

| Ruta | Qué es | Quién lo lee |
|---|---|---|
| `skills/<nombre>/SKILL.md` | Una skill: frontmatter `name` y `description`, y el procedimiento en el cuerpo | El instalador al instalar; el proveedor de skills en cada sesión |
| `skills/<nombre>/**` | Los archivos que la skill necesita (plantillas, tablas, scripts) | El modelo, por la skill; la instalación copia la carpeta entera |
| `agents/<nombre>/preset.yml` | Un agente como preset: `name` y `description`, más su `agent.cordis.yml` | El descubrimiento de presets, que lo copia a `<DSH_HOME>/.agent-presets/<nombre>/` |
| `agents/<nombre>.md` | Un agente en Markdown: frontmatter con `name` y `description`, y el cuerpo como prompt | El instalador, que genera el preset y usa el cuerpo como persona |
| `routines/<nombre>.json` | Una rutina con disparadores y pasos | El espejo, que la sube al registro del producto; el formato de los campos es el suyo |
| `workflows/<nombre>.json` | Un flujo con nodos y aristas | El espejo, igual que las rutinas |
| `context/<nombre>.md` | Contexto del equipo en texto | Una persona: se pega en el Contexto del espacio o se deja en la carpeta del espacio de trabajo |
| `AGENTS.md` | Las reglas de la KB | El agente, cuando la carpeta KB es su directorio de trabajo (cadena de instrucciones del proyecto) |
| `kb.json` | El manifiesto de la carpeta | El validador y quien instala a mano |

## Qué lee el producto hoy

### Las skills: `skills/<nombre>/SKILL.md`

El instalador nativo ([`packages/skill/skill-install/src/detect.ts`](../../packages/skill/skill-install/src/detect.ts)) acepta la carpeta que se le señale de dos maneras: si contiene un `SKILL.md` en su raíz, es una skill; si no, cada subcarpeta directa que contenga un `SKILL.md` es una skill candidata, y las subcarpetas ocultas (las que empiezan por punto) se ignoran.

En el diálogo se puede elegir la raíz de la KB o su `skills/`: la raíz no trae ningún `SKILL.md` propio, así que el instalador la mira como KB y toma el catálogo de `skills/` y los agentes de `agents/`.

Un `SKILL.md` válido empieza por una línea que es exactamente `---`, cierra el bloque con otra línea exactamente `---`, y declara `name` y `description` como cadenas no vacías; el `name` tiene que cumplir la gramática kebab-case del harness, `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` ([`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts), `SKILL_NAME`).

El frontmatter tiene que ser YAML legible como asignación: un valor sin comillas que lleva dos puntos y espacio (`description: leer, conciliar: y archivar`) no parsea y la skill se ignora en silencio, que es la clase de fallo que dejó vacío el catálogo de skills del despliegue.

El proveedor de skills ([`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)) añade a esos campos `whenToUse`, `metadata`, `disable-model-invocation` y `user-invocable`; el instalador no los exige ni los interpreta al copiar, así que la KB puede usarlos para enrutar mejor y el validador no los comprueba.

El proveedor también acepta una skill en un único archivo `<raíz>/<nombre>.md`, pero el instalador no: un `.md` suelto dentro de `skills/` no se instala, y por eso la forma canónica de la KB es siempre la carpeta.

El instalador copia la carpeta completa de cada skill candidata (los assets van con ella), la renombra al `name` del frontmatter y escribe a su lado un marcador `.dsh-skill-install.json` con el origen, el destino, el instante y el resumen del `SKILL.md`, que es lo que hace que una instalación repetida sea un no-op y que solo se pueda desinstalar lo que se instaló.

Lo que el instalador ignora sin decirlo: subcarpetas sin `SKILL.md`, subcarpetas ocultas, archivos sueltos que no acaban en `.md`, y cualquier candidata con frontmatter ilegible o nombre fuera de la gramática, que se reporta como rechazada.

### Los agentes: `agents/<nombre>/preset.yml` o `agents/<nombre>.md`

El instalador lee los agentes de una KB igual que las skills: `ctx.skillInstall` reconoce `agents/<nombre>/` como carpeta de preset y `agents/<nombre>.md` como agente Markdown, y escribe los dos en `<DSH_HOME>/.agent-presets/<id>/`, la raíz que lee el descubrimiento de presets ([`packages/skill/skill-install/src/agents.ts`](../../packages/skill/skill-install/src/agents.ts)).

La forma de carpeta es la del despliegue: `preset.yml` con `name` y `description` más `agent.cordis.yml` con la composición de plugins, que es lo que el gateway copia a esa misma raíz ([`gateway/server.mjs`](../../gateway/server.mjs)) y lo que [`packages/faberloom/defaults/src/index.ts`](../../packages/faberloom/defaults/src/index.ts) convierte en un agente sembrado, con `name` tomado de `name` y `responsibility` tomado de `description`.

La forma Markdown no compone nada: el instalador genera el `preset.yml` con el frontmatter y un `agent.cordis.yml` cuya persona es el cuerpo del archivo, porque el catálogo del producto no guarda ningún prompt ([`packages/faberloom/agents/src/spec.ts`](../../packages/faberloom/agents/src/spec.ts)).

El registro durable de agentes (`faberloom_agents`) guarda `name`, `responsibility`, `spaceId`, `skills`, `tools`, `subagents`, `provider`, `model`, `webAccess`, `mwtMcp`, `sicopMcp`, `mailConnectionIds`, `policy`, `lessons`, `active` y su revisión y marcas de tiempo, y no tiene ningún campo de prompt ([`packages/faberloom/agents/src/types.ts`](../../packages/faberloom/agents/src/types.ts)).

La convención de esta KB es un archivo Markdown por agente, `agents/<nombre>.md`, con el nombre del archivo como nombre del agente y este frontmatter.

```yaml
---
name: contable-jefe                 # obligatorio, kebab-case, igual al nombre del archivo
description: "..."                  # obligatorio, el texto con el que se decide usar a este agente
responsibility: "..."               # opcional; sin él, la responsabilidad es la description
skills:                             # opcional; nombres de skill que el agente usa
  - cierre-mensual
tools:                              # opcional; nombres de herramienta que el agente puede ejecutar
  - faberloom_board_create
provider: deepseek-official         # opcional; proveedor del modelo
model: deepseek-flash               # opcional; modelo dentro del proveedor
---
El cuerpo del archivo es el prompt del agente.
```

El validador acepta también la forma de carpeta `agents/<nombre>/AGENT.md` con el mismo frontmatter; el instalador no la lee, así que una KB que quiera instalar ese agente usa la carpeta de preset o el Markdown suelto.

Los campos del frontmatter están elegidos para que se puedan copiar al registro sin traducción: `name`, `description`, `responsibility`, `skills`, `tools`, `provider` y `model` son campos o entradas directas de `AgentInput`.

El prompt de un agente Markdown es el cuerpo del archivo, y el instalador lo escribe como persona del preset; un agente que necesite un juego de herramientas propio se entrega como carpeta de preset, porque el instalador no inventa una composición.

### Las rutinas y los flujos: formato del producto, transporte propuesto

Las rutinas y los flujos viven hoy en sus dominios durables (`faberloom_routines` y `faberloom_workflows`) y se crean desde el panel o desde las herramientas del producto; el producto no los importa desde ninguna carpeta que se le señale.

El JSON de la KB usa los mismos campos que esos registros, de modo que un importador o una persona puedan darlos de alta sin reescribirlos: `intent`, `triggers` (`kind` entre `manual`, `event`, `email`, `date` y `recurrence`, con su `match`), `steps` (`id`, `instruction`, `handler`, `dependsOn`, `waitFor`, `effect`), `expectedResult`, `permissions` y `failurePolicy` ([`packages/faberloom/routines/src/spec.ts`](../../packages/faberloom/routines/src/spec.ts)).

Los `handler` de paso que el producto registra son `wait`, `agent`, `mcp`, `backup`, `email.send`, `email.extract-spreadsheet-link` y `email.followup` ([`packages/faberloom/handlers/src/index.ts`](../../packages/faberloom/handlers/src/index.ts)); cualquier otro valor deja el paso sin ejecutar, y el validador lo rechaza.

Un flujo lleva `intent`, `nodes` (cada uno con `id`, `kind`, `title`, `position` y su `config`), `edges` (`id`, `from`, `to`, y `condition` opcional), `permissions` y `failurePolicy`; los `kind` de nodo son la unión cerrada de [`packages/faberloom/workflows/src/spec.ts`](../../packages/faberloom/workflows/src/spec.ts) (`trigger.manual`, `trigger.schedule`, `trigger.email`, `trigger.event`, `trigger.board`, `agent`, `skill`, `mcp.call`, `imap.action`, `smtp.send`, `memory.remember`, `memory.teach`, `board.create`, `space.reference`, `routine.invoke`, `condition`, `transform`, `wait`, `notify` y `deadletter`), y un nodo de tipo `agent` se refiere a un agente por su identificador del catálogo, que la KB no puede conocer de antemano: el ejemplo usa `<id-de-contable-jefe>` y hay que sustituirlo al darla de alta.

### El contexto

`context/<nombre>.md` es texto para personas, sin formato obligatorio.

Su destino en el producto es el módulo de Contexto, que guarda entradas con título y cuerpo y exporta un registro portable: `{schemaVersion, spaceId, exportedAt, entries[{id, spaceId, title, body, version, authorId, updatedAt, versions}]}`, o su versión en Markdown ([`packages/faberloom/context/src/types.ts`](../../packages/faberloom/context/src/types.ts) y [`.../index.ts`](../../packages/faberloom/context/src/index.ts)); la importación se hace desde la consola, no leyendo esta carpeta.

Un documento de `context/` también sirve tal cual si se deja en la carpeta del espacio de trabajo, porque el agente lee la cadena de instrucciones del proyecto.

Esa cadena es `$DSH_HOME/AGENTS.md` (global del usuario) seguida de cada `AGENTS.md` desde la raíz del proyecto hasta el directorio de trabajo de la sesión ([`packages/context/agent-instructions/README.md`](../../packages/context/agent-instructions/README.md)); un `AGENTS.md` en la raíz de la KB se lee cuando la KB es el directorio de trabajo, y no se copia a ningún otro sitio al instalar skills.

### El manifiesto `kb.json`

El manifiesto es la única pieza de la KB que describe la carpeta entera, y hoy no lo lee el producto: el diálogo señala una carpeta de skills y nada más.

`kb.json` declara `schemaVersion` (1), `name` (kebab-case), `displayName`, `version`, `author`, `description` y `content`, un objeto cuyas listas (`skills`, `agents`, `routines`, `workflows`, `context`) nombran lo que la carpeta trae; el validador rechaza un manifiesto que nombre contenido que no existe.

## Cómo se instala

El gesto de instalación está en el panel Skills: se pulsa «Elegir carpeta», se elige la carpeta de origen, se elige el destino («Este espacio de trabajo» o «Global»), se marca «Reemplazar si ya existe» si se quiere sobrescribir, y se pulsa «Instalar» ([`packages/client/ui-faberloom/src/client/skill-install.tsx`](../../packages/client/ui-faberloom/src/client/skill-install.tsx)).

El panel muestra la raíz resuelta antes de escribir nada y luego informa por candidata: instalada, reemplazada, omitida porque ya existe o rechazada con su motivo ([`packages/faberloom/view/src/index.ts`](../../packages/faberloom/view/src/index.ts), `installSkill`).

El modelo tiene el mismo gesto con la herramienta `install_skill`, que cuando no se le dice el destino pregunta al usuario exactamente esas dos opciones ([`packages/skill/skill-install/src/index.ts`](../../packages/skill/skill-install/src/index.ts)).

Para instalar la KB de contabilidad se elige su raíz (o su `skills/`) y el destino Global: la raíz aporta las cuatro skills de `skills/` y los tres agentes de `agents/`, y los agentes se escriben siempre en el home del usuario.

| Destino | Raíz resuelta | Quién lo ve |
|---|---|---|
| Este espacio de trabajo | `<raíz del proyecto>/.dsh/skills`, donde la raíz del proyecto es el ancestro más cercano con `.git` | Las sesiones que trabajan en ese proyecto |
| Global | `$DSH_HOME/skills` | Todas las sesiones de ese usuario, en cualquier proyecto |

«Global pero solo para su usuario» se refiere a la segunda fila: el destino global escribe en el `DSH_HOME` del usuario, y en este despliegue cada usuario arranca su propio proceso `dsh` con su propio `DSH_HOME` ([`gateway/server.mjs`](../../gateway/server.mjs)), de modo que una skill instalada en Global no la ve otro usuario de la misma instalación.

Lo que sí es del despliegue entero, y por tanto fuera del alcance de la KB, es el catálogo de solo lectura que el lanzador monta para todos: el catálogo por rol (`/opt/skills-catalog/<rol>`), el catálogo compartido (`/opt/skills-shared`) y los presets de agente del despliegue (`/opt/agents-shared`), montados como directorios de skills adicionales con `includeDefaultRoots: false`, y sembrados además en el home de cada usuario ([`apps/desktop/src/identity.ts`](../../apps/desktop/src/identity.ts) y [`packages/bundle/web-app/cordis.patch.yml`](../../packages/bundle/web-app/cordis.patch.yml)).

Una skill instalada en Global queda en la raíz de usuario `$DSH_HOME/skills`, que el proveedor de skills de cada preset escanea, así que la ven todos los agentes de ese usuario y no solo uno.

## Errores frecuentes

| Síntoma | Causa | Arreglo |
|---|---|---|
| La instalación responde `missing-skill-md` y no copia nada | Se eligió la raíz de la KB, que no contiene ningún `SKILL.md` | Elegir `<KB>/skills`, que es la carpeta de carpetas de skill |
| Una candidata sale rechazada con `bad-frontmatter` o `missing-name` | El `description` va sin comillas y lleva dos puntos y espacio, o falta `name` o `description` | Entrecomillar el valor (`description: "…: …"`) y comprobar que las dos claves están y no están vacías |
| Una candidata sale rechazada con `invalid-name` | El `name` lleva mayúsculas, guiones bajos, espacios, acentos o barras | Escribirlo en minúsculas, con dígitos y guiones: `conciliacion-bancaria`, no `Conciliación_Bancaria` |
| La skill se instala, pero el modelo no la usa nunca | El `description` describe el tema y no dice cuándo usarla; el enrutado se decide con ese texto | Empezar la descripción por un disparador explícito: «Úsala cuando el usuario quiera…» |
| El archivo se ve bien en Windows y el producto lo ignora | BOM al principio del archivo: la primera línea ya no es `---` y no hay frontmatter | Volver a guardarlo en UTF-8 sin BOM; en PowerShell, `Set-Content -Encoding utf8` añade BOM y además puede estropear los acentos |
| En Windows la skill carga y en el contenedor no | El archivo se llama `Skill.md`, `skill.MD` o `SKILL.Md`; NTFS no distingue mayúsculas y Linux sí | Renombrarlo exactamente `SKILL.md` |
| El informe dice `skipped` y el archivo no cambió | Ya existe una skill con ese nombre y no se marcó «Reemplazar si ya existe» | Marcar la casilla, o desinstalar la anterior desde el panel |
| Los acentos salen como `Ã³` o `?` | El archivo se reescribió y se guardó con otra codificación (Latin-1, ANSI) | Reescribirlo en UTF-8 sin BOM desde el editor, sin pasar por un `Set-Content` que recodifique |
| El panel rechaza la instalación con `outside-workspace` | El origen elegido está fuera de la raíz del espacio de trabajo de la sesión | Mover o copiar la carpeta dentro del espacio de trabajo, o instalar desde una ruta que esté dentro |
| Los agentes de `agents/` no aparecen tras instalar | El agente no tiene `preset.yml` legible ni un Markdown con `name` y `description` | Añadir el descriptor, o reescribir el archivo Markdown con frontmatter; el instalador reporta el motivo del rechazo en el resultado |

## Validador

```
node scripts/validate-kb.mjs examples/kb-contabilidad
```

El validador recorre una carpeta KB y comprueba lo que el producto haría con ella: que la raíz tenga `AGENTS.md` y `kb.json`, que cada `skills/<nombre>/SKILL.md` exista con ese nombre exacto y con frontmatter legible cuyo `name` sea kebab-case, que cada agente declare nombre y prompt, que cada rutina y cada flujo usen los campos, los handlers y los tipos de nodo del producto, y que el manifiesto no nombre nada que falte.

Además comprueba dos cosas que rompen archivos en silencio: un BOM al principio (que descarta el frontmatter) y los saltos de línea CRLF (que el repositorio y la KB escriben en LF).

Imprime un resumen —skills, agentes, rutinas, flujos y contexto encontrados, y el recuento de errores y avisos— y una línea por problema; los motivos de rechazo de una skill salen con el mismo código que usa el instalador (`missing-skill-md`, `bad-frontmatter`, `missing-name`, `invalid-name`), para poder cotejar los dos mensajes.

Salida 0 cuando no hay errores (puede haber avisos), 1 cuando hay algún error y 2 cuando la invocación no nombra una carpeta.

No es un analizador YAML completo: no valida el dialecto entero, solo las claves y los valores que deciden si la skill o el agente se leen, y no juzga si el procedimiento contable es correcto.

## Propuestas

1. **`agents/<nombre>/preset.yml` y `agents/<nombre>.md` como las dos formas de agente instalables.** La carpeta de preset trae su propia composición; el Markdown trae el prompt y el instalador lo convierte en persona. Motivo: el catálogo no guarda prompt, y el preset es lo único que el descubrimiento de presets lee.
2. **`kb.json` como manifiesto.** Nombra el contenido para que la instalación pueda informar de lo que falta antes de copiar nada y para que el validador detecte referencias colgadas. Motivo: el producto hoy no lee ningún manifiesto de la carpeta.
3. **`routines/` y `workflows/` en JSON con los campos del registro, como formato de transporte.** Motivo: los registros durables son la autoridad y no hay importador desde carpeta; el ejemplo usa un identificador de agente entre `<>` porque la KB no puede conocer el identificador que el catálogo asignará.
4. **`context/` como texto portable y `AGENTS.md` como reglas de la KB.** Motivo: el módulo de Contexto importa un registro exportado, no una carpeta, y las instrucciones del proyecto se leen por la cadena de `AGENTS.md` cuando la KB es el directorio de trabajo.
5. **El instalador de la KB no copia `AGENTS.md`, `context/`, `routines/` ni `workflows/` a ningún sitio.** Instala skills y agentes; el resto lo da de alta una persona o llega por el espejo desde el otro lado, que es quien lo escribe en los registros del producto.
