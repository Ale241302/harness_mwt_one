# KB 文件夹的结构

[English](kb-structure.md) | 中文

KB 文件夹是一个可移植文件夹，汇集团队知识——skills、agents、routines、workflows 和 context——采用产品已经能读取的形式，因此安装它不需要编辑配置文件。

本文档是 [`scripts/validate-kb.mjs`](../../scripts/validate-kb.mjs) 校验的规范，配套的真实示例是 [`examples/kb-contabilidad`](../../examples/kb-contabilidad)。

每一节区分产品今天读取的内容与仍属提议的内容：选择 KB 文件夹会安装其 skills 和 agents（即下文两种形式），而 routines、workflows 和 context 在登记后通过镜像传输，其余由人完成。

## 工作文件夹的 harness

已经有 harness 的文件夹遵循本团队项目使用的约定：根目录文件只做重定向，`.agents/` 是事实来源，每个 CLI 另有自己的安装，图和笔记库位于各自的两个文件夹。

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

| 路径 | 是什么 | 谁读取 |
|---|---|---|
| `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` | 三个 entrypoints，各自遵循其 CLI 的约定 | 对应的 CLI，它会跟随指向 `.agents/` 的指针 |
| `.agents/rules/*.md` | 始终生效、无需调用的规则 | 在该文件夹启动时的 agent |
| `.agents/subagents/*.md` | 可用角色及何时使用 | 委派或采用角色时的 agent |
| `.agents/skills/<n>/SKILL.md` | 带 frontmatter 和流程的 skill | 任务调用它时的 agent |
| `.agents/tools/registry.yaml` | 项目自有工具及其脚本 | 需要非系统工具时的 agent |
| `.agents/workflows/*.md` | 带步骤的流程 | 工作遵循该流程时的 agent |
| `.agents/decisions/ADR-*.md` | 项目决策及其背景 | 审查“为什么是这样”的人和 agent |
| `.claude/`、`.gemini/`、`.kimi-code/` | 每个 CLI 的安装（agents、commands、rules、skills、MCP） | 各自的 CLI，使用自己的格式 |
| `.obsidian/` | 项目的笔记库 | Obsidian |
| `graphify-out/` | 代码图及其报告 | 查询图的人和 agent |

FaberLoom 在准备工作 WorkSpace 或 Space 时写入同样的布局，且只写入该作用域使用过的内容：在那里调用过的 agents 和 skills、其 workflows、记忆、context 和 routines。它自己的内容位于 `.faberloom/` 下，这是记录写入了什么、可以撤回什么的清单。

### 向量化（graphify）与绘制（archify）

图和图表是项目已使用的外部工具，各自有输出文件夹和 skill：

| 工具 | 包与版本 | 命令 | 输出 | Skills |
|---|---|---|---|---|
| graphify | `graphifyy` 0.9.91（Python） | `uv tool install --upgrade graphifyy` 或 `pip install -U graphifyy`；然后 `graphify build`、`graphify query "<pregunta>"` | `graphify-out/`（`graph.json`、`GRAPH_REPORT.md`、`manifest.json`、`.graphify_labels.json`、`cache/` 和按日期命名的文件夹） | `graphify`（其 `SKILL.md` 随包提供：读代码前先查图） |
| archify | `archify` 3.1.0（Node，`bin/archify.mjs`） | `node bin/archify.mjs finalize <tipo> <candidate.json> <salida.html> --repo-root <raíz> --quality showcase` | `.archify/<tipo>-<slug>-<AAAAMMDD-HHMMSS>/`，含 `candidate.json` 和 HTML | `archify`，以及 `archify-review` 和 `archify-tuning` |

两个 skill 都以 kebab-case 声明 `name`，并在 `description` 中写明触发条件，因此像其他 skill 一样安装——把 skill 文件夹放进“选择文件夹”——并且项目的 `graphify-out/` 会在读代码前被查询：“X 怎么工作？”用 `graphify query` 回答。在 Windows 上，graphify 还附带 `skill-windows.md`，其中包含 Python 解释器检测。

这一推动不再依赖有人手写：harness 投影会在每个作用域的 `AGENTS.md` 写入一节默认规则（`DEFAULT_SCOPE_RULES`，位于 `packages/faberloom/harness-projection/src/render.ts`），要求在读代码前用 `graphify` 查询图、在变更后保持更新，并用 `archify` 绘制而不是只用散文描述。整个 harness——含 `skills/`、`agents/`、`rules/`、`commands/` 的文件夹或其 `.zip`——可通过面板的“安装 harness”按钮或 `scripts/install-harness.mjs` 一次安装，后者还会把 harness 规则写入用户主目录 `AGENTS.md` 的受管块。

## KB 文件夹的树

KB 文件夹汇集团队内容以便安装到任何设备：主要是 skills 和 agents，加上产品已能通过镜像传输的 routines、workflows 和 context。

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

| 路径 | 是什么 | 谁读取 |
|---|---|---|
| `skills/<nombre>/SKILL.md` | 一个 skill：frontmatter `name` 和 `description`，正文是流程 | 安装时由安装器读取；每个会话由 skill 提供方读取 |
| `skills/<nombre>/**` | skill 需要的文件（模板、表格、脚本） | 模型通过 skill 读取；安装时复制整个文件夹 |
| `agents/<nombre>/preset.yml` | 作为 preset 的 agent：`name` 和 `description`，以及其 `agent.cordis.yml` | preset 发现，会把它复制到 `<DSH_HOME>/.agent-presets/<nombre>/` |
| `agents/<nombre>.md` | Markdown 形式的 agent：frontmatter 含 `name` 和 `description`，正文是 prompt | 安装器，它生成 preset 并用正文作为 persona |
| `routines/<nombre>.json` | 带触发器和步骤的 routine | 镜像，把它上传到产品注册表；字段格式属于产品 |
| `workflows/<nombre>.json` | 带节点和边的 workflow | 镜像，与 routines 相同 |
| `context/<nombre>.md` | 团队的文本 context | 人：粘贴到 Space 的 Context，或留在工作区文件夹 |
| `AGENTS.md` | KB 的规则 | 当 KB 文件夹是工作目录时由 agent 读取（项目的指令链） |
| `kb.json` | 文件夹清单 | 校验器和手动安装者 |

## 产品今天读取什么

### Skills：`skills/<nombre>/SKILL.md`

原生安装器（[`packages/skill/skill-install/src/detect.ts`](../../packages/skill/skill-install/src/detect.ts)）以两种方式接受所指的文件夹：若根目录含 `SKILL.md`，它就是一个 skill；否则每个直接子文件夹若含 `SKILL.md` 就是候选 skill，隐藏子文件夹（以点开头）被忽略。

对话框中可以选择 KB 的根目录或其 `skills/`：根目录自身没有 `SKILL.md`，因此安装器把它当作 KB，从 `skills/` 取目录、从 `agents/` 取 agents。

有效的 `SKILL.md` 以一行恰好为 `---` 开始，以另一行恰好为 `---` 结束块，并把 `name` 和 `description` 声明为非空字符串；`name` 必须符合 harness 的 kebab-case 语法 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`（[`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)，`SKILL_NAME`）。

frontmatter 必须是可按赋值读取的 YAML：一个未加引号且含“冒号加空格”的值（`description: leer, conciliar: y archivar`）无法解析，skill 会被静默忽略——正是这类失败让部署的 skill 目录变空。

skill 提供方（[`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)）在这些字段上增加 `whenToUse`、`metadata`、`disable-model-invocation` 和 `user-invocable`；安装器在复制时不要求也不解释它们，因此 KB 可以用它们改善路由，而校验器不检查它们。

提供方也接受单文件形式的 skill `<raíz>/<nombre>.md`，但安装器不接受：`skills/` 内的散 `.md` 不会被安装，因此 KB 的规范形式始终是文件夹。

安装器复制每个候选 skill 的完整文件夹（资产随之复制），按 frontmatter 的 `name` 重命名，并在旁边写入 `.dsh-skill-install.json` 标记，含来源、目标、时刻和 `SKILL.md` 摘要；这使重复安装成为 no-op，并且只能卸载已安装的内容。

安装器静默忽略的内容：没有 `SKILL.md` 的子文件夹、隐藏子文件夹、不以 `.md` 结尾的散文件，以及任何 frontmatter 不可读或名称不符合语法的候选——后者会报告为拒绝。

### Agents：`agents/<nombre>/preset.yml` 或 `agents/<nombre>.md`

安装器读取 KB 的 agents 与 skills 相同：`ctx.skillInstall` 把 `agents/<nombre>/` 识别为 preset 文件夹，把 `agents/<nombre>.md` 识别为 Markdown agent，并把两者写入 `<DSH_HOME>/.agent-presets/<id>/`，即 preset 发现读取的根目录（[`packages/skill/skill-install/src/agents.ts`](../../packages/skill/skill-install/src/agents.ts)）。

文件夹形式是部署的形式：`preset.yml` 含 `name` 和 `description`，加上含插件组合的 `agent.cordis.yml`；gateway 把它复制到同一根目录（[`gateway/server.mjs`](../../gateway/server.mjs)），[`packages/faberloom/defaults/src/index.ts`](../../packages/faberloom/defaults/src/index.ts) 把它转换为种子 agent，`name` 取自 `name`，`responsibility` 取自 `description`。

Markdown 形式不组合任何东西：安装器用 frontmatter 生成 `preset.yml`，并生成一个 persona 为文件正文的 `agent.cordis.yml`，因为产品目录不保存任何 prompt（[`packages/faberloom/agents/src/spec.ts`](../../packages/faberloom/agents/src/spec.ts)）。

持久的 agent 注册表（`faberloom_agents`）保存 `name`、`responsibility`、`spaceId`、`skills`、`tools`、`subagents`、`provider`、`model`、`webAccess`、`mwtMcp`、`sicopMcp`、`mailConnectionIds`、`policy`、`lessons`、`active` 及其 revision 和时间戳，没有任何 prompt 字段（[`packages/faberloom/agents/src/types.ts`](../../packages/faberloom/agents/src/types.ts)）。

本 KB 的约定是每个 agent 一个 Markdown 文件，`agents/<nombre>.md`，文件名即 agent 名，frontmatter 如下。

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

校验器也接受文件夹形式 `agents/<nombre>/AGENT.md`，frontmatter 相同；安装器不读取它，因此想安装该 agent 的 KB 应使用 preset 文件夹或单独的 Markdown。

frontmatter 字段被选为可无翻译地复制到注册表：`name`、`description`、`responsibility`、`skills`、`tools`、`provider` 和 `model` 都是 `AgentInput` 的字段或直接条目。

Markdown agent 的 prompt 是文件正文，安装器把它写为 preset 的 persona；需要自有工具集的 agent 以 preset 文件夹交付，因为安装器不会臆造组合。

### Routines 和 workflows：产品格式，提议的传输

routines 和 workflows 今天存在于其持久域（`faberloom_routines` 和 `faberloom_workflows`），从面板或产品工具创建；产品不从任何指定文件夹导入它们。

KB 的 JSON 使用与这些记录相同的字段，因此导入器或人可以不经重写就登记它们：`intent`、`triggers`（`kind` 为 `manual`、`event`、`email`、`date` 和 `recurrence`，带其 `match`）、`steps`（`id`、`instruction`、`handler`、`dependsOn`、`waitFor`、`effect`）、`expectedResult`、`permissions` 和 `failurePolicy`（[`packages/faberloom/routines/src/spec.ts`](../../packages/faberloom/routines/src/spec.ts)）。

产品注册的步骤 `handler` 是 `wait`、`agent`、`mcp`、`backup`、`email.send`、`email.extract-spreadsheet-link` 和 `email.followup`（[`packages/faberloom/handlers/src/index.ts`](../../packages/faberloom/handlers/src/index.ts)）；任何其他值都会让步骤不执行，校验器会拒绝。

workflow 携带 `intent`、`nodes`（每个含 `id`、`kind`、`title`、`position` 及其 `config`）、`edges`（`id`、`from`、`to`，可选 `condition`）、`permissions` 和 `failurePolicy`；节点 `kind` 是 [`packages/faberloom/workflows/src/spec.ts`](../../packages/faberloom/workflows/src/spec.ts) 的封闭并集（`trigger.manual`、`trigger.schedule`、`trigger.email`、`trigger.event`、`trigger.board`、`agent`、`skill`、`mcp.call`、`imap.action`、`smtp.send`、`memory.remember`、`memory.teach`、`board.create`、`space.reference`、`routine.invoke`、`condition`、`transform`、`wait`、`notify` 和 `deadletter`），而 `agent` 类型节点通过目录标识符引用 agent，KB 无法预先知道：示例使用 `<id-de-contable-jefe>`，登记时必须替换。

### Context

`context/<nombre>.md` 是给人读的文本，没有强制格式。

它在产品中的目标是 Context 模块，该模块保存带标题和正文的条目，并导出一个可移植记录：`{schemaVersion, spaceId, exportedAt, entries[{id, spaceId, title, body, version, authorId, updatedAt, versions}]}`，或 Markdown 版本（[`packages/faberloom/context/src/types.ts`](../../packages/faberloom/context/src/types.ts) 和 [`.../index.ts`](../../packages/faberloom/context/src/index.ts)）；导入从控制台完成，不读取此文件夹。

如果留在工作区的文件夹中，`context/` 文档也可以直接使用，因为 agent 会读取项目的指令链。

该链是 `$DSH_HOME/AGENTS.md`（用户全局）加上从项目根到会话工作目录的每个 `AGENTS.md`（[`packages/context/agent-instructions/README.zh.md`](../../packages/context/agent-instructions/README.zh.md)）；当 KB 是工作目录时，KB 根目录的 `AGENTS.md` 会被读取，安装 skills 时不会复制到别处。

### `kb.json` 清单

清单是 KB 中唯一描述整个文件夹的部件，今天产品不读取它：对话框只指向 skills 文件夹，仅此而已。

`kb.json` 声明 `schemaVersion`（1）、`name`（kebab-case）、`displayName`、`version`、`author`、`description` 和 `content`，后者是一个对象，其列表（`skills`、`agents`、`routines`、`workflows`、`context`）命名文件夹携带的内容；校验器拒绝命名不存在内容的清单。

## 如何安装

安装动作在 Skills 面板：按“选择文件夹”，选择来源文件夹，选择目标（“此工作区”或“全局”），如需覆盖勾选“已存在则替换”，然后按“安装”（[`packages/client/ui-skill/src/client/InstallSkillRow.tsx`](../../packages/client/ui-skill/src/client/InstallSkillRow.tsx)）。

面板在写入前显示解析后的根目录，然后按候选报告：已安装、已替换、因已存在而跳过，或带原因拒绝（[`packages/faberloom/view/src/index.ts`](../../packages/faberloom/view/src/index.ts)，`installSkill`）。

模型有相同动作，工具为 `install_skill`；未告知目标时，它会向用户询问同样两个选项（[`packages/skill/skill-install/src/index.ts`](../../packages/skill/skill-install/src/index.ts)）。

安装会计 KB 时选择其根目录（或其 `skills/`）和目标“全局”：根目录提供 `skills/` 的四个 skills 和 `agents/` 的三个 agents，agents 始终写入用户主目录。

| 目标 | 解析后的根目录 | 谁看到 |
|---|---|---|
| 此工作区 | `<raíz del proyecto>/.dsh/skills`，项目根是最近的含 `.git` 的祖先 | 在该项目工作的会话 |
| 全局 | `$DSH_HOME/skills` | 该用户在任何项目中的所有会话 |

“全局但仅限其用户”指第二行：全局目标写入用户的 `DSH_HOME`，在本部署中每个用户以自己的 `DSH_HOME` 启动自己的 `dsh` 进程（[`gateway/server.mjs`](../../gateway/server.mjs)），因此安装到全局的 skill 不会被同一安装的其他用户看到。

属于整个部署、因而超出 KB 范围的是启动器为所有人挂载的只读目录：按角色的目录（`/opt/skills-catalog/<rol>`）、共享目录（`/opt/skills-shared`）和部署的 agent presets（`/opt/agents-shared`），以 `includeDefaultRoots: false` 挂载为附加 skill 目录，并额外播种到每个用户的主目录（[`apps/desktop/src/identity.ts`](../../apps/desktop/src/identity.ts) 和 [`packages/bundle/web-app/cordis.patch.yml`](../../packages/bundle/web-app/cordis.patch.yml)）。

安装到全局的 skill 位于用户根 `$DSH_HOME/skills`，每个 preset 的 skill 提供方都会扫描它，因此该用户的所有 agent 都能看到，而不只是一个。

## 常见错误

| 症状 | 原因 | 修复 |
|---|---|---|
| 安装返回 `missing-skill-md` 且不复制 | 选择了 KB 根目录，其中没有任何 `SKILL.md` | 选择 `<KB>/skills`，即 skill 文件夹的文件夹 |
| 候选以 `bad-frontmatter` 或 `missing-name` 被拒 | `description` 未加引号且含冒号加空格，或缺少 `name` 或 `description` | 给值加引号（`description: "…: …"`）并确认两个键存在且非空 |
| 候选以 `invalid-name` 被拒 | `name` 含大写、下划线、空格、重音或斜杠 | 写成小写，只用数字和连字符：`conciliacion-bancaria`，不是 `Conciliación_Bancaria` |
| skill 已安装但模型从不使用 | `description` 描述主题而未说明何时使用；路由由该文本决定 | 让描述以明确触发开头：“当用户想要……时使用” |
| 文件在 Windows 上看起来正常但产品忽略 | 文件开头有 BOM：第一行不再是 `---`，没有 frontmatter | 重新保存为无 BOM 的 UTF-8；在 PowerShell 中 `Set-Content -Encoding utf8` 会加 BOM 并可能破坏重音 |
| 在 Windows 上加载而在容器中不加载 | 文件名为 `Skill.md`、`skill.MD` 或 `SKILL.Md`；NTFS 不区分大小写而 Linux 区分 | 精确重命名为 `SKILL.md` |
| 报告为 `skipped` 且文件未变 | 已存在同名 skill 且未勾选“已存在则替换” | 勾选复选框，或从面板卸载之前的 |
| 重音显示为 `Ã³` 或 `?` | 文件被重写并以其他编码保存（Latin-1、ANSI） | 从编辑器以无 BOM 的 UTF-8 重写，避免经过会重编码的 `Set-Content` |
| 面板以 `outside-workspace` 拒绝安装 | 所选来源在会话工作区根之外 | 把文件夹移入或复制到工作区内，或从区内路径安装 |
| 安装后 `agents/` 的 agents 不出现 | agent 没有可读的 `preset.yml`，也没有含 `name` 和 `description` 的 Markdown | 添加描述文件，或用 frontmatter 重写 Markdown；安装器会在结果中报告拒绝原因 |

## 校验器

```
node scripts/validate-kb.mjs examples/kb-contabilidad
```

校验器遍历 KB 文件夹并检查产品会如何处理它：根目录有 `AGENTS.md` 和 `kb.json`；每个 `skills/<nombre>/SKILL.md` 以该精确名称存在，frontmatter 可读且 `name` 为 kebab-case；每个 agent 声明名称和 prompt；每个 routine 和 workflow 使用产品的字段、handlers 和节点类型；清单不命名缺失内容。

它还检查两件会静默破坏文件的事：开头的 BOM（会丢弃 frontmatter）和 CRLF 换行（仓库和 KB 都写 LF）。

它打印摘要——找到的 skills、agents、routines、workflows 和 context，以及错误和警告计数——并逐问题一行；skill 的拒绝原因使用与安装器相同的代码（`missing-skill-md`、`bad-frontmatter`、`missing-name`、`invalid-name`），以便对照两条消息。

无错误时退出 0（可有警告），有错误时 1，调用未指定文件夹时 2。

它不是完整的 YAML 分析器：不验证整个方言，只验证决定 skill 或 agent 是否可读的键和值，也不判断会计流程是否正确。

## 提议

1. **`agents/<nombre>/preset.yml` 和 `agents/<nombre>.md` 作为两种可安装 agent 形式。** preset 文件夹携带自己的组合；Markdown 携带 prompt，安装器将其转换为 persona。原因：目录不保存 prompt，preset 是 preset 发现唯一读取的内容。
2. **`kb.json` 作为清单。** 命名内容，使安装能在复制前报告缺失，并让校验器检测悬空引用。原因：产品今天不读取文件夹的任何清单。
3. **`routines/` 和 `workflows/` 使用注册表字段的 JSON 作为传输格式。** 原因：持久注册表是权威，且没有从文件夹导入的导入器；示例使用 `<>` 中的 agent 标识符，因为 KB 无法预先知道目录将分配的标识符。
4. **`context/` 作为可移植文本，`AGENTS.md` 作为 KB 规则。** 原因：Context 模块导入导出的记录而非文件夹；当 KB 是工作目录时，项目指令通过 `AGENTS.md` 链读取。
5. **KB 安装器不会把 `AGENTS.md`、`context/`、`routines/` 或 `workflows/` 复制到任何地方。** 它安装 skills 和 agents；其余由人登记，或从另一侧通过镜像到达，由后者写入产品注册表。
