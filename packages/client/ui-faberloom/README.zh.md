---
description: "FaberLoom 的 Web 界面：身份令牌、品牌名、faberloom 配置提供的全局面板（Conversar、Mesa de trabajo、Espacios、Agentes、Rutinas、Flujos、Memoria、Conexiones），以及 Settings 中的 MCP 服务器页面；面向 FaberLoom 工作区的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-faberloom

[English](README.md) | 中文

## 概述

FaberLoom 界面把共享的 Web 外壳变成 FaberLoom 工作区：用 FaberLoom 身份覆盖强调色令牌、标注侧边栏品牌名，并为每个 FaberLoom 分区注册一个全局面板。每个面板从声明的 store 读取同一份总览；Espacios 与 Agentes 通过 `ctx.remote.faberloomView` 创建与重命名，每次写入都会重新发布刷新后的总览，因此所有面板同时更新。Conversar 面板把用户交给由 harness 拥有的对话与输入框。Flujos 面板绘制工作流图。它还向 Settings 模态框贡献 MCP 服务器页面，列出该所有者已安装的服务器，并通过 `ctx.remote.faberloomView` 安装、测试与移除。该包仅由 `faberloom` 配置挂载。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.slots`、`ctx.locale` 与 `ctx.theme` 的组合中挂载本插件。它会贡献：

- 通过 `ctx.theme.overrideTokens` 注册的强调色层，随浅色/深色模式变化；
- `sidebar.brand.name` 的双色字标，以及 `sidebar.brand.mark` 与 `conversation.hero.brand.mark` 的等距图标占用者；
- 十个 `sidebar.panellist` 行覆盖十二个 `main` 面板，以共享的 `MainPanelId` 寻址（对话落地页与技能面板保留路由但不占侧边栏行）；
- 聊天手势：一个 `@` 触发器源，列出所有者的活跃代理（选中会插入 `@name`），以及一个带弹窗的 `/routine` 命令贡献，用于启动选中的例程；两者都由工作区总览经 `ctx.remote.faberloomView` 提供；
- 技能面板的安装控件：它打开已挂载的目录选择器，提供当前工作区或全局技能根目录两个目标并显示各自解析后的根目录，通过 `ctx.remote.faberloomView.installSkill` 安装，并列出该身份已记录的安装及其移除操作；
- Settings 模态框中的 MCP 服务器页面：它声明服务器仅属于该用户，并在其所有工作区和空间中可用；列出该所有者已安装的服务器及其传输方式与验证状态（仅当服务器已启用且已挂载时才读作*已连接*；已启用但未挂载的读作*已保存但未验证*并附上遮蔽后的原因，已停用的读作*已停用*），以及存在哪些凭据（绝不显示值，也不显示凭据引用）。用户可能有很多服务器，各有用途；每个都保留自己的行、状态与操作，因此一个服务器的失败绝不会隐藏其他服务器；安装超过几个后会出现搜索框。它在保存前测试一个候选连接（显示它发现的工具，或具名失败——*服务器无响应*、*凭据被拒绝*、*服务器返回了意外的响应*——及其遮蔽明细和下一步操作）；当具名凭据没有值（*缺少值*）或有值却没有名称时拒绝保存；安装时每个值都写入凭据接缝；并允许所有者就地编辑某一行（重新输入那些从不显示的值）、启用或停用它，或经就地确认后移除。它只通过 `ctx.remote.faberloomView`（`mcpServers`、`saveMcpServer`、`removeMcpServer`、`probeMcpServer`）访问宿主注册表，因此宿主注册表代码不会进入浏览器。

侧边栏脚部只保留 Settings 控件，本包不再向 `sidebar.footer.action` 注册任何内容。产品的调色板、界面语言与 MCP 服务器都在该控件打开的 Settings 模态框中选取：调色板位于 **Apariencia**（外观）分区，界面语言位于 **Idioma**（语言）分区，MCP 服务器位于 **Servidores MCP**（MCP 服务器）分区。

Espacios 详情把业务空间与 harness 工作区连接起来：`spaceWorkspace` 投射该空间的对话区域（其 `fw_` 工作目录注册为工作区，标题取自空间），而「在此空间新建对话」会在其中打开一个会话，因此侧边栏的工作区分组与空间始终是同一个东西。Mesa de trabajo（工作台）可带备注评审、提交新的已准备修订、让条目经过异常状态（请求数据、失败、完成），并列出已记录的效果及其明细与日期。

这些行按设计的三种导航模式分组——「`Operar`」（Mesa、Espacios、Rutinas、Flujos、Correo）、「`Aprender`」（Memoria、Contexto、Aprobaciones）与「`Admin`」（Agentes y Skills、Conexiones）——并且只在总览已经计数其记录时才带徽标；没有真实数字的分区不显示徽标。

所有注册都是调用方 fiber 上的 effect，并随其消失。

-----

<a id="model-experience"></a>
## 模型体验

### 面板注册

#### 模型看到的内容

没有直接影响。该插件不贡献工具、不注入提示文本，也不写入会话事件。`@` 手势只是把纯文本放进草稿，因此模型收到的是用户消息里的代理名称；委派给该代理是宿主机的 `faberloom_agents_delegate` 工具，而从 `/routine` 启动例程是宿主机的执行服务。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：面板注册从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **在界面允许处提供面板动作** — Espacios 通过已挂载的目录选择器把已有文件夹采纳为该 Space 的工作区，并支持创建、重命名、编辑该 Space 的 agent 指令，以及把该 Space 的 context 导出写入该文件夹；Agentes 支持创建、重命名与（代理）停用；Mesa 支持创建与批准/拒绝；Rutinas 支持创建与启停；Memoria 支持记录一条语句；Email 支持下载附件、把它作为真实文件保存到所选 Space 的文件夹，或把所选 Space 文件夹中的文件作为附件发送。看板修订提交、模型策略与例程步骤编辑在其界面落地前仍属于产品服务。
- **记忆遵循流水线** — 记录语句会追加到 agent-memory 入口，蒸馏后的行可能在下次读取后出现。
- **活动事件驱动刷新，而非推送** — 面板在 harness 转发会话活动事件时、挂载时以及每次写入后重新读取。
- **行元数据随侧边栏的投影更新** — 模式、分组与徽标是侧边栏按读取解析的 `sidebar.panellist` 注册选项；徽标显示本界面最后发布的总览，并随侧边栏下一次投影行而出现。
- **内置 locale 下使用西班牙语文案** — FaberLoom 的产品语言是西班牙语，而客户端 locale 运行时要求每个命名空间注册两个内置 locale，因此 `zh` 与 `en` 都承载西班牙语字典，直到出现一等公民的 `es` locale。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

分区身份集中在一个数组（`FABERLOOM_SECTIONS`）中：侧边栏 id、主面板 key、行顺序、标签 key、导航模式与分组 key、可选的按总览计数的徽标，以及两个占用者。新增一个界面只需一条记录加上它的文案 key。在平板断点以下，表格/检查器分栏折叠为一列（检查器成为表格下方的整宽块），且每个表格在各自的卡片内横向平移并带粘性表头。

</details>

**Runtime invariant:** 不发布 companion。每个注册都是插件 fiber 上的 effect，浏览器规格证明侧边栏行、主面板与品牌名都会随该 fiber 的释放而消失。
