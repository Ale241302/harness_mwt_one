---
description: "Web @file 与 @session 引用 source：工作区文件夹浏览、模糊名称搜索，以及原子行内引用（统一的文件/会话选取）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-reference

[English](README.md) | 中文

## 概述

Web 用户需要从同一个 `@` 补全菜单提及文件、文件夹或会话时，可以使用 `dsh-client-ui-reference`。文件部分会浏览会话的工作区：`@` 列出工作区根目录，输入路径即可进入，点击文件夹行或用 Tab 可以继续下钻，菜单面包屑可逐级返回。输入不含分隔符的名称时，则改为通过模糊索引在工作区中搜索。没有内容可显示的文件夹、或没有匹配的过滤条件，都会明说，而不会让文件区块静默留白。选择会插入原子引用；文件夹行可在不关闭补全的情况下继续下钻。会话 mention 会在捕获模型上下文前接受校验，而浏览不会影响模型。

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

只要组合挂载了本包且宿主提供 `ctx.fileReferences` 与 `ctx.workspaceFiles`，该 source 即处于活动状态。输入 `@` 会列出会话的工作区根目录，文件夹排在前面。继续输入路径（`@src/`、`@src/module1/`）即可逐层进入，也可以点击文件夹行的 chevron 或用 Tab 下钻；菜单头部会显示从工作区根目录开始的面包屑，点一下早先的层级即可返回。输入不含分隔符的名称（`@readme`）时，则改为通过模糊文件索引在整个工作区中按名称搜索。打开 `@"…` 则只搜索文件，并允许路径包含空格。候选列表是补全菜单，不是搜索结果页：选一次、继续输入即可。当文件夹没有内容可显示，或输入的过滤条件没有匹配时，文件区块会明说，而不会留下空荡的菜单。

### 选择后会插入什么

选择文件会关闭补全，并显示为带文件图标与业务色文件名的原子行内引用。目录行携带两个动词：选定 pick（点击行主体或 Enter）把文件夹本身解析为同类原子引用——文件夹图标、带尾斜杠的标签、以规范 `@dir/` mention 为序列化形式；钻取动作（Tab 或行尾 chevron）则保持带文件夹图标的可编辑路径纯文本，并让菜单在尾部斜杠处保持活跃，用户可以继续进入下一层。包含空白的路径使用 `@"path with spaces"`，用户显式打开的引号会继续保留。无论来自文件夹浏览还是模糊索引，每个 mention 都是相对于工作区的路径。

选择会话会插入一个原子的行内引用，其隐藏 `ref` 与剪贴板表示均为宿主返回的规范 `@[label](dsh-session:…)` mention；可见形式为聊天气泡图标加会话标题。发送会经 `session.prompt` 携带该 mention，session-reference 服务会在 `agent/pre-step` 校验它并捕获模型上下文。

每个文件行在 mention 之外还带有一个动词：attach 行通过 Host（`workspaceFiles/readAll`）读取文件字节，并交给 composer 现有的附件入口，因此草稿获得与浏览器选取文件完全相同的后台上传、rail 卡片与暂存回执。附加绝不截断：Host 拒绝的文件——过大、已消失或不是常规文件——只显示一条可读提示，草稿不会加入任何内容。mention 始终指向一个路径；attach 行交付内容。

### 失败行为

某个候选领域不可用或失败时，该领域不产生任何行，另一领域仍正常列出。文件区块不会静默留白：没有内容可显示的目录读作「这里没有文件」，过滤条件没有匹配读作「没有结果」；无法列出的目录——已不存在、在工作区之外、不是目录，或未归类的宿主失败——会显示一条说明原因的提示；被宿主条目上限截断的列表会在末尾显示一条提示，说明未展示全部条目。这些提示都是信息行：菜单把它们显示在候选项本该出现的位置，键盘高亮会跳过它们，任何按压也都无法选中它们。会话引用准备失败发生在提示词接受后，并会终止该 agent 轮次。

点击输入框中的文件引用，可在右侧栏预览文件当前的内容。带引号路径中的空格会保留，路径按输入框所属 Session 解析。文件夹和 Session 引用保留原有的编辑行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该 source 把候选编码保留在注册 effect 内部：`/client` 导出接口只包含插件主体（`apply`/`inject`）。

### 候选流程

文件区块只有一种浏览器，而不是两种：空查询或输入的路径会通过受限于工作区的 `workspaceFiles/list` 列出真实目录，文件夹在前，每一行都携带其 pick 所用的图标与 `@path` mention。模糊的 `fileReferences/list` 只保留在它更适合的一种场景——输入不含分隔符的名称，此时可以在整个工作区中匹配。把两者都留在同一个 source 内（而不是再注册一个 `@` source），菜单就只剩一种明显的文件夹浏览方式。候选编码与「名称/路径」拆分位于 `browse.ts`，文件区块可能携带的每一条信息行也在这里产生——文件夹没有文件、没有结果、列表被截断、列表失败——都是 reducer 永不置于高亮之下的提示行。

对于这类查询，浏览器会同时启动 `fileReferences/list` 模糊搜索与 `sessionReferenceResolver/candidates` 调用，再以确定性顺序把文件排在会话之前，并使用注册在 locale 字典中的文件夹、文件与会话标签。各行分别渲染在不可选择的文件与会话分组标题下，不显示重复的原始 `reference` source 标题。会话行用宿主会话列表的 `updatedAt` 经该列表相同的相对时间分档标注时间，因此同一个会话在两处读到的时长一致；列表中没有的会话回落到候选自带的创建时间。下钻后的查询会发布一条从工作区根目录到当前所列目录的面包屑；每一节携带的下钻载荷与文件夹行相同，因此「回到某一步」与「进入某一层」是同一个结果。

### 序列化

文件选择把共享 `@path` 语法所定义的自然文本保留为隐藏的序列化与剪贴板形式。会话选择使用规范的 `@[label](dsh-session:…)` mention；序列化永远不会根据可见标题重建身份。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖建议机制、引用 seam 与输入流水线。

- [ui-input-trigger](../ui-input-trigger/README.zh.md)——该 source 注册进的行内建议机制。
- [file-reference](../../context/file-reference/README.zh.md)——`@file` seam 及其提供方约定。
- [session-reference](../../context/session-reference/README.zh.md)——`@session` seam 与准备后快照的语义。
- [Web 输入机器与 slash 流水线](../../../.agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)——引用与命令如何共享输入机器。

-----

<a id="model-experience"></a>
## 模型体验

间接影响模型体验：通过宿主拥有的提供方实现，本包的引用选择把文件指引与会话快照准备委托给它们，其文件夹浏览则读取工作区目录列表。

#### KV Cache 影响

浏览候选项不会影响模型。选择文件或会话只会改变新用户消息的后缀，以及紧随该消息、由宿主准备的会话引用上下文；目标会话更早的历史保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明引用 source 何时帮不上忙；它们是当前包约束。

- **发现失败保持静默，空结果不再静默**：Remote 发现调用不可用或失败时，该领域不产生候选行；只有无法列出的目录会得到一条说明原因的提示。空结果绝不再静默：没有内容可显示的目录读作「这里没有文件」，过滤条件没有匹配读作「没有结果」。这些提示与「列表被截断」「列表失败」一样，都是高亮永远到不了的信息行。会话引用准备失败发生在提示词接受后，并会终止该 agent 轮次。
- **文件夹浏览局限于工作区**：浏览器只通过 `workspaceFiles/list` 读取会话工作区根目录之内的内容；工作区之外的路径只会显示为一行提示，而不是内容，浏览器也无法回退到自身文件系统。
- **名称搜索仍由索引支撑**：不含分隔符的名称查询走 `fileReferences/list`，并继承该提供方的结果上限；要到达任意文件应使用文件夹浏览。
- **会话搜索仍仅使用元数据**：发现流程通过 `ctx.sessionReferenceResolver` 筛选 session id、cwd 与以日志为依据的最新标题；不搜索消息主体或完整 transcript。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只注册一个 slash source，HMR 测试覆盖释放；它不发出 Cordis 事件，也不持有跨插件可变状态。
