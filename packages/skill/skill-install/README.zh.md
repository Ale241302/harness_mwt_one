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

### 选择作用域

两个目标分别是当前工作区（`<projectRoot>/.dsh/skills`，来源 `project-dsh`）与用户账号（`<dshHome>/skills`，来源 `user-dsh`）。调用方省略目标时，`install_skill` 会通过 `ctx.userQuestions` 恰好给出这两个选项来询问用户。工作区目标需要会话工作目录；全局目标从不需要。

```json
{ "source": "~/skills/greet", "destination": "workspace", "replace": false }
```

### 安装、重复与移除

首次安装会复制整个技能目录（含其资源），并在 `SKILL.md` 旁记录来源标记。再次安装相同内容会被报告为已安装且不写入任何内容；内容变化时会跳过，除非设置 `replace`。`uninstall_skill` 只移除带标记的目录，因此同名的手写 skill 绝不会被删除。

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

模型会看到 `install_skill` 与 `uninstall_skill` 的参数 schema：必填的 `source` 文件夹、可选的 `destination`（`workspace` 或 `global`），以及可选的 `replace` 标志。生成的工具目录尚未列出它们，因为该默认禁用的插件不在其启动清单中。

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
- **生成的工具目录尚未列出这些工具**——`docs/tool-catalog.md` 由启动清单重新生成，而该清单仍排除这个默认禁用的插件；新增该条目的时机应选在没有其他工具包改动在途的重新生成窗口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

安装器与 `skill-badge` 一样，以禁用行随基础 bundle 发布：默认启用会改变每条已记录请求的工具列表，而无需密钥的会话快照正是以此为基准。需要该功能的 profile 在其 overlay 中启用该行。

</details>
