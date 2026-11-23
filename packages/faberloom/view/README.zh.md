---
description: "面向浏览器的 FaberLoom 工作区视图：通过 Remote 读取登录 owner 的空间、代理、看板、例程、记忆与工作流图，并提供创建、重命名、图编辑、运行、拓扑、导出与 MCP 服务器写入；面向 FaberLoom 面板的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-view

[English](README.md) | 中文

## 概述

工作区视图是 FaberLoom 浏览器面板使用的唯一宿主能力。它暴露 `faberloomView.overview()` 并返回纯 JSON 行，因此面板渲染真实记录而不是占位内容，并暴露这些面板所需的写入，包括工作流的图编辑、运行、拓扑与导出方法。身份来自部署配置而非调用本身：网关把已认证的 owner 注入本行，与 `tool-faberloom` 的做法一致，因此浏览器无法请求其他 owner 的行。记忆行同样在部署身份下取自 agent-memory 内核。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已包含 `ctx.faberloomSpaces`、`ctx.faberloomAgents`、`ctx.faberloomBoard` 与 `ctx.faberloomRoutines` 的组合中挂载本行，并配置 `ownerId`。配置 `memoryCoreUrl`、`memoryServiceId`、`memoryUserId` 与 `memoryGatewayKey` 后，总览会带上该 owner 的记忆行；未配置时记忆列表为空。浏览器侧在客户端 API 组装中挂载生成的 `./remote` 贡献并调用 `ctx.remote.faberloomView.overview()`。Espacios 面板通过 `adoptSpaceWorkspace(id, path)` 把已有文件夹采纳为某个 Space 的区域：它把该文件夹注册为以该 Space 命名的 Workspace（同一路径已注册的则复用）并把该 Space 指向它，于是 Space 与侧边栏 Workspace 指向同一目录，而非确定性的 `spaces/<ref>` 区域。Email 面板通过 `saveSpaceAttachment(id, uid, name?)` 把邮件附件保存到某个 Space 的文件夹：它把真实文件写入 `<space dir>/correo-adjuntos/` 并返回其路径与字节数，于是 agent 的文件工具作用于该文档而非浏览器下载。`attachMailToSpace(uid, spaceId, name, sessionId, subject)` 把正在进行的对话移入该 Space：已经扎根于该工作区的会话就地挂接；工作目录不同的会话变成新的、归该 Space 所有的会话，并携带一段有界转录；草稿会话经 `draftAttachToSpace` 移动，从而保留其绑定。该调用返回此后驻留在那里的会话。它通过 `sendSpaceFileByEmail(id, path, to, subject, text)` 把已存在于某个 Space 文件夹中的文件作为邮件发送：路径必须解析到该文件夹之内（逃逸路径会被拒绝），文件以 `multipart/mixed` 附件经该 owner 的 SMTP 行发送。它通过 `exportSpaceViewToFolder(id, 'context', '', 'markdown')` 把该 Space 的 context 导出写入该文件夹（同一调用也写 Work Flow 的 `json`/`archify` 导出），落在 `<space dir>/exportaciones/`。连通性地图是第二个读取：`ctx.remote.faberloomView.spaceMap()` 返回每个 Space 及其负责代理与镜像工作区、每个代理及其技能与 MCP 访问、该 owner 的邮件连接，以及已注册的工作区，供调色板与画布使用。工作流编辑器读取 `workflowOverview()` 与 `workflowDetail(id)`，并通过 `createWorkflow`、`saveWorkflow`、`addNode`、`updateNode`、`removeNode`、`connect`、`disconnect` 与 `setWorkflowStatus` 修改；它用 `workflowRuns(id)` 列出执行、用 `spaceTopology()` 读取调色板，并用 `exportWorkflow(id, 'json' | 'archify')` 导出。它还读取 `routineWorkflowLinks()` 提供例程 ↔ 工作流视图，并写入 `setWorkflowConcurrency(id, cap | null)`；`trigger.schedule` 节点在其 config 中携带周期、时区、窗口、星期与工作日跳过。Compartir 界面新增 `shareSpace`、`shareWorkflow`、`resourceShares` 与 `revokeShareGrant`，由 Workflows 面板以邮箱 + 权限表驱动。入手与可移植性新增 `workflowTemplates`、`createWorkflowFromTemplate` 与 `importWorkflow`；面板的 Plantillas 图库据此起步并导入可移植 JSON，`exportWorkflow(id, 'json')` 返回同一种可移植格式。调度器的存活是又一次读取：`executionHealth()` 返回每条例程的最近一次运行与状态、失败、复核积压、等待、重试次数与更早的等待期限，以及聚合计数。Skills 面板通过 `installHarness(source, replace?)` 安装整个 harness（一个文件夹或一个 `.zip`），该调用路由到 `ctx.skillInstall.installHarness`：安装器按约定为每个部分识别其目录，并把 skills、preset agents、常驻规则、命令、脚本、hooks 与 MCP 服务器配置写入该用户自己的 Harness home，因此询问技能属于哪个作用域的区块被移除，harness 仅对该用户生效；安装器在写入任何内容之前先校验每个候选；整个技能目录连同其附件一起复制；内容未变的重复安装会被如实报告而不再复制。`skillInstalls()` 列出技能提供方读取回的带标记安装，`uninstallSkill(name, destination)` 通过安装器移除其中一次安装，安装器只移除带有安装标记的目录。设置页通过 `mcpServers()`、`saveMcpServer(input)`、`removeMcpServer(name)` 与 `probeMcpServer(input)` 管理该所有者的 MCP 服务器：读取会给出每个服务器的传输方式、是否启用与挂载，以及每个凭据条目的名称和凭据接缝是否存有值（绝不返回值或引用）；每次写入都以部署注入的所有者身份访问 `ctx.faberloomMcpRegistry`；测试会在保存之前于隔离作用域中挂载该候选，返回它发布的工具，或返回已对每个提供的密钥做遮蔽处理的具名失败。 文件面板通过 `spaceFiles(id, path)` 读取 Space 区域的一层：路径相对工作区，逃逸路径被拒绝，隐藏条目会列出，目录排在前。点击文件会调用 `openSpaceFile(id, path)`，交给操作系统关联的应用打开；没有原生打开器的 Web 会如实报告，而不是假装已打开。

草稿代理方法 `draftSessionOpen`、`draftSessionStart`、`draftSessionAsk`、`draftSessionHistory`、`draftRestore`、`draftSignatureFor`、`draftSpaceSuggestion` 与 `draftAttachToSpace` 把邮件草稿关联到一个持久 agent Session。`draftSessionStart` 在 Host 创建、注入并 CAS 关联专用受限 Session；Client 不能提供任意会话或种子。`draftSessionAsk` 向已关联的 Session 投递第一轮提问，使面板打开时就有草稿摘要而不是空的输入框；草稿没有 Session 时会被拒绝。`seedMailSession` 同样可以在注入邮件上下文之后附带第一个问题；两者都会短暂等待 Host 刚刚创建的 Session 出现在 agent registry 中。初始 `emailDraftWithAi` 也通过 agent registry 运行，而非孤立的 LLM 调用。种子包含当前消息、来源、有界线程、已配置时的附件转换文本、草稿可复制的邮箱文档（uid、连接、文件夹与名称）以及草稿 Space 的文件，并且只包含已激活的课程。线程中确有文档时，同一次运行先保存正文，再让该受限 Session 附加邮件需要携带的文件。历史快照在 connections 存储中保留每次写入返回的准确结果与附件字节，Remote 读取仅获得附件元数据。草稿变更拒绝只读身份；这些方法不发送邮件，也不激活课程。

`emailFolders`、`emailInbox` 与 `emailRead` 也通过 MCP 读取邮件。每个已挂载服务器用 `account_current` 回答其邮箱；每个邮箱成为一个账户，合成 id 为 `mcp-mail:<server>:<resourceId>`，文件夹来自 `folders_list`，邮件来自 `messages_list` 且 id 携带文件夹与服务器 uid，正文通过 `ctx.faberloomMcpRegistry.callTool` 从 `messages_text` 取得。这些 id 永远不会与 IMAP 的 `<connection>:<uid>` 冲突。选择 IMAP 账户时 MCP 不进入该页；无法访问的服务器会成为与已应答账户并列的 `failures` 条目；标记、移动、删除、移入废件箱和附件操作会拒绝 MCP id。注册表在调用服务器之前就拒绝所有受策略管辖的名称，因此这些读取永远不会修改邮箱。

`emailImage(source)` 抓取消息正文引用的一个远程 `http(s)` 图片，使沙箱阅读器用 `data:` URL 绘制它，而不是让浏览器去请求发件人。Host 会拒绝非 http 协议、回环／链路本地／私有主机（重定向前后都检查）、非图片内容类型、空正文以及超过 4 MB 的内容；单次调用限制为 8 秒，并返回声明的媒体类型与 base64 字节。

Mesa 的外部效果是由 owner 身份限定的读写，浏览器从不自行决定。`boardEffectStatus(id)` 返回预留、发出的持久意图、可见告警、已派发效果是否仍待对账，以及 board 对该动作类型持有的声明：是否有适配器服务它、该适配器是否声明目的地幂等、以及它能否向目的地查询（W-21、§9.8）。它还说明该读者能否行政关闭条目，而 board 在执行命令时会再次套用该规则。`boardEffectAlerts()` 按最新在前列出该租户的告警，并解析每个条目标题。`boardEffectPolicy()` 给出 board 接受的动作类型以及它为每种类型解析的撤回窗口，因此面板不保留自己的列表。`boardApproveWithExecution(id, input)` 用一条命令接受批准、预留与意图；`boardEffectRevert`、`boardEffectRetry`、`boardEffectReconcile`、`boardEffectProbe` 与 `boardEffectAdminClose` 承担已委托、失败、未知或已关闭条目的决定，并各自返回刷新后的详情。`boardEffectProbe` 询问目的地，并在 board 了结所得回答后返回效果：`executionOutcome` 中为 `CONFIRMADO`、`FALLIDO` 或 `DESCONOCIDO`，其中未获回答的查询让条目留在未知状态。`probe` 为 false 表示该动作类型没有声明 `probe` 的适配器、未发出任何询问，面板于是保留操作者的答案。签名读写——`boardSignatureStatus(actionType)`、`boardSignatures()`、`boardSignatureIssue(input)` 与 `boardSignatureRevoke(id)`——以部署的 owner 与租户身份执行，因此客户端无法替其他身份签署。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`faberloomView` 的方法是浏览器能力：不注册工具、不注入提示文本、不写入会话事件。

普通面板读取不写入任何内容。草稿代理调用会创建或复用真实 agent Session：首次启动与转移使用 `agent.inject`，初始草稿运行使用 `followup`，因此邮件、草稿状态与转移历史都会进入 Session 日志。模型只看到草稿读取、更新、历史与恢复四个工具；executor guard 拒绝其他工具及其他草稿 id。持久关联在 `agent/created` 时重新安装同一策略。通用 `seedMailSession` Remote 拒绝已关联草稿的会话。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：该服务从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **草稿上下文有界，邮箱缺什么就声明什么。** 完整种子最多 48,000 字符，包含最多 8 条消息、每条正文 6,000 字符、每个附件转换文本 6,000 字符、合计 12 个附件，以及 12 条各不超过 2,000 字符的课程；缺失、省略与截断会写入种子。把草稿或邮件对话转移到另一 cwd 会保留旧 Session，并向新 Session 注入有界文本历史，而不是克隆完整日志。
- **草稿历史持久，但不与消息更新处于同一事务。** 每次捕获保存调用方提供的准确写入结果，但两次写入之间失败仍可能让消息缺少最新历史条目。历史按服务实例串行化，不声明跨进程串行化。
- **Space 转移会报告部分完成。** 在目标产生效果前先检查预期草稿修订；Space 关联提交后，如果会话、复制或历史失败，结果携带实际草稿与 `completion: 'partial'`，不会声称什么都没有改变。
- **写入覆盖面板动作，而非全部产品操作。** 该命名空间创建并重命名空间与代理、停用代理、创建与审查看板项、创建并启停例程、并记录记忆语句；看板修订提交、模型策略与例程步骤编辑在其界面落地前不在此列。
- **未知的效果结果只在目的地可去重时才重试。** `boardEffectStatus` 报告适配器的 `idempotent` 声明，因此 Mesa 在 board 会接受时启用重试（W-21），否则保持关闭；不能去重的目的地通过 `boardEffectProbe` 或操作者的回答来了结。
- **未声明 `probe` 的目的地无法被查询。** 当该动作类型的适配器省略 `probe` 时，`boardEffectProbe` 不写入任何内容，并返回 `probe` 为 false 的投影，因此 Mesa 提供操作者的三种结果，并说明无法咨询目的地。哪些目的地能回答是部署的适配器决定，而非产品决定。
- **记忆写入走流水线。** `remember` 把一条语句追加到 agent-memory 的会话入口；服务端异步把 L0 蒸馏为 L1，因此新行可能在下次读取后才出现。读取仍为只读。
- **自身没有变更事件。** 浏览器在 harness 转发会话活动事件时、挂载时以及每次写入后刷新；专用变更事件需要事件转发允许清单条目。
- **连通性地图为只读。** `spaceMap` 只报告关联；它不创建或修改 Space、代理、连接或工作区。
- **工作区安装出现在安装记录中，而非技能表中。** `skills()` 枚举角色目录、共享目录与 `$DSH_HOME/skills`；工作区安装落在 `<workspace>/.dsh/skills` 下，挂载的技能提供者会实时发现它，安装器的标记也会记录它，但 `skills()` 并不枚举它。把工作区根目录读入该表有待注册表读取。
- **MCP 服务器页面位于设置外壳中。** 这四个 MCP 服务器方法投影 `ctx.faberloomMcpRegistry`，按需解析，因此未挂载它的部署仍能保留其他所有面板；调用它们的设置页（位于 `dsh-client-ui-faberloom`）注册到 `settings.section`，因此未挂载设置外壳的部署不会显示该页面。已保存的服务器无法仅凭其引用重新测试：`probeMcpServer` 需要一个完整候选，所以页面在保存前测试候选，所有者需要重新输入值才能再次测试。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

actor 来自配置而非参数，因为 Remote 边界没有环境调用者身份。`./remote` 由 Typert 构建生成；方法名或签名变更后需重新运行 `pnpm run build:lib:host`。

</details>

**Runtime invariant:** 不发布 companion。该服务不持有派生状态：每次读取都在调用时解析已挂载服务并返回新投影，因此不存在可能发散的自有关系。
