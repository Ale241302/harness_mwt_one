# 安装 harness

[English](harness-install.md) | 中文

harness 是一个**文件夹**——或同样内容的 **`.zip`**——携带一个团队的完整套件：skills、agents、规则、命令和脚本。安装后会放进用户主目录（`<DSH_HOME>`，`~/.dsh`），这是**每个** Workspace 和 Space 的**每个**会话已经读取的位置，无需改动部署，也无需重装应用。

引擎是 [`scripts/install-harness.mjs`](../../scripts/install-harness.mjs)：它遍历来源，按文件夹识别每个部件，并写入产品读取的根目录。

```
node scripts/install-harness.mjs <carpeta-o-zip> [--home <dir>] [--replace] [--dry-run]
```

用这个引擎真实执行过的例子：`mwt-one-harness`（893 个 skills、36 个 agents、299 个脚本、0 个被拒）和 `ECC`（292 个 skills、68 个 agents、94 个命令、296 个脚本、0 个被拒）。

## harness 携带什么、装到哪里

| harness 中的位置 | 安装到 | 谁读取 |
|---|---|---|
| `skills/<nombre>/SKILL.md`、`skills-shared/…`、`skills-catalog/<rol>/…`，或根目录下的一个 `SKILL.md` | `<home>/skills/<nombre>/` | 每个会话的 skill 提供方；agent 通过其 `description` 看到并调用 |
| `agents/<id>/preset.yml`（模板文件夹）、`agents-shared/…` | `<home>/.agent-presets/<id>/` | 下次启动时的 preset 发现；出现在 Agents 面板 |
| `agents/<id>.md`、`agents-shared/<id>.md`（带 `name` 和 `description` 的 Markdown agent） | `<home>/.agent-presets/<id>/`，含 `preset.yml` 和一个**persona 即文件正文**的 composition | 同上：目录不保存 prompt，因此正文成为 persona |
| `rules/*.md`、`.agents/rules/*.md`，以及根目录的 `AGENTS.md` | `<home>/AGENTS.md` 内的一个受管块 | 指令链：它是用户的 `AGENTS.md`，进入**每个会话的第一次请求** |
| `commands/*.md` | `<home>/commands/`（原样复制） | 读取它们的 CLI 本身；产品通过代码注册命令，所以这里只留文件 |
| `scripts/**` | `<home>/scripts/**` | agent 通过文件系统读取；其规则调用的就是这些 |
| `hooks/**`、`mcp-configs/**` | `<home>/hooks/`、`<home>/mcp-configs/` | 目前没有消费者：会被复制，安装器会说明。产品的 hooks 通过各 CLI 的 `settings` 接入，MCP 服务器在连接面板有自己的注册表 |

## 规则：受管块

规则不作为散文件复制：它们写在用户 `AGENTS.md` **内部**，位于两个标记之间：

```
<!-- faberloom-harness:begin -->
…las reglas…
<!-- faberloom-harness:end -->
```

带 `--replace` 的重装只替换**该块**，不改动文件其他内容，因此用户手写的内容会保留。没有 `--replace` 时，已存在的块会被尊重，安装器将其报告为跳过。

## 重复、替换与试运行

安装器是幂等的：已经存在且未变化的内容会被**跳过**并报告；`--replace` 重写整个部件（skill 文件夹、agent 模板、规则块）。`--dry-run` 遍历来源并准确说明会做什么，不写任何内容：这是安装前审查 harness 的方式。

安装或无事可做时退出码为 `0`；某个部件被拒时为 `1`——拒绝行会说明原因：名称不是 kebab-case、agent 缺少 `preset.yml`、Markdown 缺少 `name` 和 `description`；来源无法读取时为 `2`。

## `.zip`

当来源以 `.zip` 结尾时，安装器用系统工具（`tar -xf`，在 Windows 10+ 上是 bsdtar，或 `unzip`）解压到临时文件夹并从其中继续。若压缩包只含**一个**根文件夹，那就是 harness 文件夹；若含散文件，则使用临时根目录。不需要新增任何依赖。

## 面板如何配合

**“安装 harness”**按钮位于 Skills 面板，紧邻标签页和上传 Markdown 的按钮，仅在桌面应用内出现，因为那里选择的文件夹属于操作者本人。它提供**“选择文件夹”**和**“选择 .zip”**：两者都打开 Host 的原生对话框（同一对话框的文件夹模式或文件模式），显示所选路径，配合替换复选框一次安装全部。目标不问：skills、agents 和规则始终进入用户主目录。完成后，面板按部件列出数量、状态和目标，逐个列出被拒候选及原因，并保留从文件夹安装的列表及其移除按钮。

此前“安装 skill / 选择文件夹 / 目标 / 替换 / 安装”的区块已在同一变更中移除：harness 安装器是超集（单个 skill 和一个知识文件夹都是单部件 harness），保留两条路径只会为同一个决定重复拒绝词汇。

除面板外，也可以从命令行用引擎 [`scripts/install-harness.mjs`](../../scripts/install-harness.mjs) 安装 harness，它应用相同的部件到根目录映射。

## 已内置的常驻规则

新投影的作用域不会在没有规则的情况下启动：harness 投影会在其 `AGENTS.md` 写入一节默认规则，要求先查阅项目图（`graphify` skill 及其 `graphify-out/` 文件夹）再读代码，在变更后保持更新，并用 `archify` skill 绘制架构和流程，而不是只用散文描述。它们位于 `DEFAULT_SCOPE_RULES`（`packages/faberloom/harness-projection/src/render.ts`），写入所有作用域，不依赖作用域是否注册了什么。
