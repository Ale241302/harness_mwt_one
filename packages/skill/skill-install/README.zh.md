---
description: "原生 skill 安装器：识别技能文件夹，将其安装到工作区或用户 skill 根目录，并可再次移除；供分发技能的发行者与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-install

[English](README.md) | 中文

## 概述

`dsh-skill-install` 把用户指出的文件夹变成已加载的 skill。它会判断该文件夹是一个技能目录、一个技能目录的目录，还是两者都不是，并在都不是时说明是哪条规则不满足。在写入任何内容之前，它通过现有的 `ctx.userQuestions` seam 询问用户该 skill 属于当前工作区还是其用户账号。安装后的 skill 落在 `@deepseek-ai/dsh-skill-filesystem` 扫描的确切目录中，因此提供方的监视器无需重启即可加载它们；内容未变的重复安装会被如实报告而不再复制，且只有带标记的安装才能被移除。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

凡用户应当能通过指出文件夹来安装 skill 的场景，都可组合此插件。它发布 `ctx.skillInstall`，并注册 `install_skill` 与 `uninstall_skill` 工具。它需要 `ctx.tools`；`ctx.userQuestions` seam 是可选的，没有它时调用方必须显式指定目标作用域。

### 识别文件夹

`detect` 接受单个技能目录、技能目录的目录，或精确报告该文件夹为何不是 skill。包含 `SKILL.md` 的文件夹是一个 skill；否则每个包含 `SKILL.md` 的直接子目录都是一个候选。本包的接受规则与文件系统提供方一致，因此被接受的文件夹就是提供方会加载的文件夹。

```json
{ "kind": "found", "source": "/work/skills", "skills": [{ "name": "greet", "description": "Greets the team", "directory": "/work/skills/greet" }], "refused": [] }
```

### 安装知识库

既没有自带 `SKILL.md` 也没有可安装子目录的文件夹会被再检查一次，看它是否为知识库：`skills/` 贡献其技能目录，`agents/` 贡献其代理，二者之一即可。`agents/` 中的 preset 文件夹（含 `preset.yml` 的目录）会被整体复制；带 front matter 的单个 Markdown 代理会成为 persona 前缀即文件正文的 preset，因为产品的代理注册表只保存 `name` 与 `responsibility`，没有 prompt。代理始终写入用户自己的 Harness home——`<dshHome>/.agent-presets/<id>/`，即部署所播种、preset 发现所读取的布局——因此安装知识库无论选择了哪个技能作用域，都是“对该用户全局”。

```json
{ "status": "installed", "source": "/work/kb-contabilidad", "destination": "global", "root": "/home/u/.dsh/skills", "outcomes": [{ "name": "conciliacion", "status": "installed" }], "agents": [{ "name": "contable-jefe", "status": "installed" }], "agentsRoot": "/home/u/.dsh/.agent-presets" }
```

### 安装整个 harness

团队的 harness 可通过一次调用安装：`installHarness` 按约定为每个部分识别其目录，并写入该用户自己的 Harness home，而每个 Workspace 与 Space 的每个会话都会读取它。`skills/`、`skills-shared/` 与 `skills-catalog/` 的每个角色成为 skill；`agents/` 与 `agents-shared/` 成为 preset agent；harness 自带的 `AGENTS.md` 与其 `rules/*.md` 成为 home 的 `AGENTS.md` 中受管块内的常驻规则，即每个会话首次请求所携带的用户级指令；`commands/`、`scripts/`、`hooks/` 与 `mcp-configs/` 原样复制并报告其目标。规则目录的子目录会被复制并在块中按路径列出，而不是被激活，因此按语言分组规则的 harness 不会同时开启所有语言。`source` 也可以指向一个 `.zip`，它会被解压到临时目录，并在完成后由该调用删除。

```json
{ "status": "installed", "source": "/work/ECC", "root": "/work/ECC", "parts": [{ "kind": "skills", "status": "installed", "count": 292, "target": "/home/u/.dsh/skills" }, { "kind": "rules", "status": "installed", "count": 3, "target": "/home/u/.dsh/AGENTS.md" }], "outcomes": [{ "name": "architect", "status": "installed" }] }
```

### 选择作用域

两个目标分别是当前工作区（`<projectRoot>/.dsh/skills`，来源 `project-dsh`）与用户账号（`<dshHome>/skills`，来源 `user-dsh`）。调用方省略目标时，`install_skill` 会通过 `ctx.userQuestions` 恰好给出这两个选项来询问用户。工作区目标需要会话工作目录；全局目标从不需要。

```json
{ "source": "~/skills/greet", "destination": "workspace", "replace": false }
```

### 安装、重复与移除

首次安装会复制整个技能目录（含其资源），并在 `SKILL.md` 旁写入 `.dsh-skill-install.json` 标记，记录源文件夹与已安装 `SKILL.md` 的摘要。再次安装相同内容会被报告为已安装且不写入任何内容；内容变化时会跳过，除非设置 `replace`。`uninstall_skill` 只移除带标记的目录，因此同名的手写 skill 绝不会被删除。

```json
{ "status": "installed", "source": "/work/skills/greet", "destination": "workspace", "root": "/work/.dsh/skills", "outcomes": [{ "name": "greet", "status": "installed" }] }
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

可观察行为已在[使用本包](#use-this-package)中说明；本节解释安装器写入的目录，以及使安装可逆的标记。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件：发布 `ctx.skillInstall`、注册两个工具并发出作用域问题 |
| [`src/detect.ts`](src/detect.ts) | 文件夹识别及其拒绝原因，复用提供方的 front matter 解析器 |
| [`src/harness.ts`](src/harness.ts) | 按部分识别 harness、受管规则块与分部分安装 |
| [`src/archive.ts`](src/archive.ts) | `.zip` 解压及其保持在根内所用的条目名校验 |
| [`src/install.ts`](src/install.ts) | 作用域根解析、目录复制、安装标记与移除 |
| [`src/types.ts`](src/types.ts) | 消费方类型：作用域、识别结论、报告与服务 |
| — | 不发布运行时不变式伴生入口；安装器没有独立的生命周期流，其写入的文件系统由 `@deepseek-ai/dsh-skill-filesystem` 拥有。 |

### 扫描的两个根

[`projectSkillRoot`](../skill-filesystem/src/index.ts) 与 [`userSkillRoot`](../skill-filesystem/src/index.ts) 来自提供方而非重新推导，因此安装恰好指向提供方扫描的目录。工作区根是会话工作目录最近的 `.git` 祖先，与提供方解析出的项目根一致。

### 安装标记

每个已安装 skill 都带有 `.dsh-skill-install.json`，记录源文件夹、目标作用域、安装时刻，以及已安装 `SKILL.md` 的 sha256。该摘要使重复安装成为如实报告的空操作；标记的存在正是卸载可以删除该目录的依据。没有可读标记的目录会被报告为并非安装，并保持不动。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从安装器进入其写入目录背后的提供方，以及拥有发现逻辑的子系统。

- [skill 子系统参考](../../../docs/subsystems/skills.zh.md)——注册表、提供方约定、本地发现优先级，以及目录与工具。
- [skill-filesystem 包](../skill-filesystem/README.zh.md)——被扫描的根，以及使安装可加载的监视器。
- [skill 组映射](../README.zh.md)——本安装器所接入的注册表、提供方与加载器。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到的内容

模型会看到 `install_skill` 与 `uninstall_skill` 的参数 schema：必填的 `source` 文件夹、可选的 `destination`（`workspace` 或 `global`），以及可选的 `replace` 标志。生成的工具目录在 `@deepseek-ai/dsh-skill-install` 下列出了这两者。

#### Token 影响

工具可见时，每个请求都会产生固定的 schema token 开销。

#### KV Cache 影响

只要定义和可见性保持不变，前缀即可稳定复用。插件生命周期变化或作用域限制可能会使从这些 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

模型的参数保留在 assistant 工具调用中。每个结果都是一个 JSON 对象，包含 `status`、解析后的 `source`、所选 `destination` 与 `root`，以及每个候选的一项结果；`invalid`、`refused` 与 `cancelled` 会携带 `reason`。用户的作用域回答不属于模型上下文：只有解析出的目标作用域会出现。

#### Token 影响

参数与结果 JSON 是依数据而定的保留 token；等待用户时不会产生 token 开销。

#### KV Cache 影响

仅追加；新出现的可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明该安装器何时不合适。它们是当前包约束，不是 UI 积压事项。

- **作用域问题在主机侧以英文撰写**——`ctx.userQuestions` seam 不携带语言环境，因此本地化的问题需要在 `@deepseek-ai/dsh-user-questions` 中加入呈现意图，并在 `@deepseek-ai/dsh-client-ui-user-questions` 中加入渲染器；安装结果的浏览器行携带本地化的作用域与结果文案。
- **工作区安装会写入用户的仓库**——工作区根是 `<projectRoot>/.dsh/skills`，因此安装的 skill 会随项目纳入版本控制，除非用户忽略它。
- **安装器通过 Node 文件系统调用写入，而非沙箱化的 `ctx.fs`**——工作区之外的全局安装不受沙箱策略限制；由调用方自身权限决定。
- **仅存在两个内置作用域**——共享、按角色或远程的 skill 根尚不是安装目标。
- **代理只安装到用户 home，从不安装到工作区** - 知识库的 `agents/` 抵达 `<dshHome>/.agent-presets`，这是 preset 发现唯一读取的根；调用方选择的技能作用域不会移动它们。
- **Markdown 代理只能成为 persona** - 生成的组合挂载 persona 与指令行，并不指定任何工具集，因此需要特定工具的知识库应提供 preset 文件夹而不是 Markdown 代理。
- **harness 从调用方给出的路径安装，只有调用方自己的选择器构成约束**——`installHarness` 会把交给它的文件夹或归档写入 `<dshHome>`，不施加双作用域 skill 安装的工作区限制，因为 harness 是该用户自己的配置而非项目内容。
- **`hooks/` 与 `mcp-configs/` 只被复制，未被接线**——产品从各 CLI 自身的设置读取 hook、从其自身的注册表读取 MCP 服务器，因此这两部分落在 home 中并报告其目标，而不会被激活。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

安装器在基础 bundle 以及 `standard`、`cordis` 与 `ptc` agent preset 中随产品启用，因此 `install_skill` 与 `uninstall_skill` 会出现在每条已记录的工具列表以及生成的工具目录中。这取代了此前与 `skill-badge` 一样以禁用行发布的选择；[合并说明](../../../.agents/notes/implemented/feature/2026-10-13-one-native-skill-install-path.zh.md)记录了为何改为重新录制已记录的预期。

</details>
