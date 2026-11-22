# Agent Note：在 Correo 中读取 MCP 邮件

Status: implemented

[English](2026-11-22-mcp-mail-in-correo.md) | 中文

## 问题

所有者在 Conexiones 中连接了 Hostinger 的邮件 MCP 服务器，行也出现了，但 Correo 仍然只列出 IMAP 账户。该 MCP 服务器能读取的邮箱在专用于读邮件的面板中不可见，连接表单只显示 “Herramientas disponibles: 24”，却没有列出任何工具名，因此所有者既找不到邮件，也不知道智能体能对该服务器做什么。

## 决定

### 注册表调用实时挂载

`@deepseek-ai/dsh-mcp-client` 现在把启动与插件入口分开：`mount(ctx, config)` 执行原有主体并返回活动的 `ConnectionHandle`，`apply` 等待 `mount` 并丢弃句柄。句柄新增 `callTool(rawName, args, { signal?, timeoutMs? })`，它调用当前连接代，未连接时拒绝。

`ctx.faberloomMcpRegistry.callTool(ownerId, serverName, rawName, args)` 使用该句柄。注册表通过一个小插件对象挂载每个已保存服务器，该对象调用 `McpClient.mount`，并以挂载自身的 context 为键把句柄保存在 `WeakMap` 中，因此宿主侧读取复用智能体已经持有的客户端，而不是再开第二个连接。在任何传输工作之前它先询问 `mcpToolDecision(rawName)`；受管辖的名称会以模型会读到的相同西班牙语原因抛出，因此 `send_email` 与十一个变更类邮件工具永远无法从此路径发出。调用受 `toolCallTimeoutMs` 限定（使用专门的超时错误，而不是探测的超时），载荷解包为 `structuredContent`，否则为第一个能解析为 JSON 的文本块，再否则为完整 MCP 结果；工具级 `isError` 会以服务器自己的话抛出。载荷不可信，由调用方收窄。

### 视图把 MCP 邮件并入现有 RPC

`emailFolders`、`emailInbox` 与 `emailRead` 保持签名不变。已挂载服务器通过 `account_current` 发现；每个邮箱成为一个账户，账户 id 为 `mcp-mail:<server>:<resourceId>`。文件夹来自 `folders_list`，邮件来自所选文件夹（或服务器的 `\Inbox`）的 `messages_list`，正文来自 `messages_text`。消息 id 为 `mcp-mail:<server>:<resourceId>:<编码后的文件夹>:<uid>`，因此一次读取无需第二次查找，也永远不会与 IMAP 的 `<connection>:<uid>` 冲突。选择 IMAP 账户时 MCP 不进入该页；无法访问的服务器会成为与已应答账户并列的 `FaberLoomInboxFailure`；空邮箱或失败邮箱永远不会被呈现为健康。变更类 RPC（`emailMarkSeen`、`emailMove`、`emailRestore`、`emailTrash`、`emailAttachment`，以及从 uid 开始的草稿/Space 路径）通过 `requireInbound` 拒绝 MCP id。

映射位于 `packages/faberloom/view/src/mcp-mail.ts`，不做 I/O，因此 id、信封、文件夹、地址与消息规则都有单元测试。

### 面板读取并命名工具

Correo 现有的账户侧栏已经按账户分组，因此 MCP 账户会带着本地化标签（`MCP · <server> · <address>`）、文件夹、邮件和正文出现在那里。MCP 行在标记/移动/回复/删除控件的位置显示只读说明，邮件助手、签名账户列表和撰写发件人列表都排除 MCP 账户。失败的 MCP 账户通过现有的 `email.accountFailed` 状态呈现。

探测结果现在除了名称外还携带 `toolInfo`（每个工具的公开名称与服务器自己的描述）。连接表单在一个本地化标题下列出它们，去掉前缀还原服务器的原始名，并把描述限制为一行。没有新增 RPC。

## 对实时服务器的验证

Hostinger 端点 `https://mcp.mail.hostinger.com/mcp`（服务器信息 `hostinger-email` 0.1.0）列出 24 个工具。通过所有者已保存的 OAuth 凭据、在刷新令牌之后读取：`account_current` 返回一个文本块，内含 `{ status, headers, body: { data: { mailboxes: [{ resourceId, address }] } } }`；`folders_list` 返回 `body.data`，为 `{ path, name, delimiter, specialUse, messageCount, unreadCount }` 数组，`specialUse` 为 `\Inbox`、`\Drafts`、`\Junk`、`\Sent`、`\Trash`；`messages_list` 返回 `body.data`，为 `{ uid, path, date, flags, unseen, subject, from: { name, address }, to, cc, messageId, inReplyTo, attachments }` 数组，另有 `body.pagination { page, perPage, total, totalPages }`；`messages_text` 返回 `body.data`，为 `{ text, html }`。所用令牌只看到一个邮箱（`alejandro@muitowork.com`）；映射处理服务器报告的每个邮箱，而不是固定列表。检查期间只调用了读取工具。

## 考虑过的替代方案

**通过 `ctx.tools.execute` 调用面向模型的工具。** 对该消费者拒绝：它把面板读取路由进模型调度管线（presenter、`tools/result` 观察者，以及 PTC 模式下无 parent 的调用会被拒绝），并且需要构造面板并不拥有的 `ToolRunContext`。

**像 `probe` 那样每次面板读取都开隔离连接。** 拒绝：所有者每次刷新都要多次握手，并绕过智能体已保持活动的连接。探测保持隔离，是因为它测试的是尚未存储值的未保存候选。

**新增并行的 `mcp-mail` RPC 面。** 拒绝：Correo 面板已经有账户、文件夹、邮件和正文的模型，第二个面会重复选择、分页、标签与错误呈现。扩展三个读取保持一份列表与一套状态。

**复用 IMAP uid 或在客户端解析 MCP id。** 拒绝：id 必须跨来源保持唯一，面板也不应解码路由。合成 id 整体传递，其含义由宿主拥有。

## 后果

该 MCP 服务器能读取的邮箱现在在 Correo 中可见，智能体的邮件工具也在所有者配置服务器的地方被命名。本切片中 MCP 邮件在面板内只读：标记、移动、删除、回复、转发和附件仍不可用，正文读取不返回附件列表，因为 `messages_attachment` 不在范围内。MCP 列表也忽略未读/已标记/重要/等待条件和搜索框；`messages_search` 不在本切片内。每次读取都依赖挂载：挂载失败的服务器会贡献一个可见的失败，而不是一个空账户。

## 测试

`corepack pnpm run typecheck` 通过。针对 `packages/faberloom/mcp-registry`、`packages/faberloom/view`、`packages/client/ui-faberloom` 与 `packages/faberloom/connections` 的定向 Vitest 运行通过 61 个文件中的 684 个测试。新增覆盖：`callTool` 在 fixture 服务器看到调用之前就拒绝受管辖名称、返回读取载荷、对非 JSON 文本返回完整结果、报告工具级失败、拒绝未挂载的 owner；探测报告 `toolInfo`；视图映射账户、文件夹、邮件、正文、失败与 id 往返，在选择 IMAP 的页面中排除 MCP，并拒绝 MCP 行上的变更；面板测试渲染 MCP 账户标签与只读阅读器，并渲染探测返回的工具名与描述。
