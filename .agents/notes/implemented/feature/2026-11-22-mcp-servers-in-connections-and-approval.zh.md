# Agent Note: MCP 服务器并入 Conexiones 表，其邮件工具需要审批

Status: implemented

[English](2026-11-22-mcp-servers-in-connections-and-approval.md) | 中文

## Problem

FaberLoom 曾把邮件放在两处：Conexiones 面板持有 IMAP 与 SMTP 行，而 Ajustes → Servidores MCP 持有每个 API/MCP 服务器。一个通过 MCP 端点获得 Hostinger 邮件服务器的所有者看到的是空的 Conexiones 表，于是认为邮件没有连上。另一方面，已挂载的 MCP 服务器把邮件服务器的整个工具列表暴露给模型，包括 `send_email` 以及破坏性的消息、文件夹与 webhook 工具；FaberLoom 的审批只管控自己的工具，不管这些调用。

## Decision

**Conexiones 把 MCP 注册表作为同一张表的第二个来源读取。** 屏幕同时加载 `connections()` 与 `mcpServers()`，并把两者投影成一个小型判别式行联合：产品连接携带其 `FaberLoomConnection`，MCP 服务器携带其 `FaberLoomMcpServerRow`，行 id 为 `mcp:<name>`。没有任何内容被复制进 `faberloom_connections`（其 `kind` 仍是 `imap | smtp | backup`），也没有密钥离开安全存储。类型选择新增 “Conexión MCP (API)”，其表单只问服务器名、URL，以及一个凭据名（默认 `Authorization`）与值；保存时以 `streamable-http` 和单个 `Authorization: Bearer …` 头调用 `saveMcpServer`，该行随后读作 MCP 连接，目标为 URL，安全状态随 URL 协议而定。选中行会重新打开已存的名称、URL 与凭据名，值留空；探测调用 `probeMcpServer` 并报告工具数量；删除调用 `removeMcpServer`。Settings 页面仍是传输、环境变量条目、启用与用重新输入的凭据探测的高级界面。

**审批策略是注册表 fiber 上的 `tools/pre-execute` 监听器。** `packages/faberloom/mcp-registry/src/policy.ts` 把受控原始名映射为决定，`apply` 通过 `ctx.effect` 注册 waterfall 监听器，因此销毁即移除。对每个已挂载服务器，监听器用 `publicToolName(serverName, rawName)` 推导每个受控原始工具的公开名并与调用名比较；它从不解析公开名，因为规范化或截断可能改变了其后缀。`send_email` 返回 `deny`，引导模型改用所有者批准的 FaberLoom 草稿；`messages_delete-bulk`、`messages_move`、`messages_move-bulk`、`messages_update-flags`、`messages_patch`、`folders_create`、`folders_update`、`webhooks_create`、`webhooks_update`、`webhooks_regenerate-secret` 与 `webhooks_test` 返回 `ask`，并给出工具名及其改动。其他每个调用都以 `next()` 委托，因此读取或非邮件服务器的工具不会仅因来自 MCP 而受影响。

`publicToolName` 现在由 `@deepseek-ai/dsh-mcp-client` 导出，因为需要匹配公开名的消费者需要文档化的 `(serverName, rawName)` 推导，而不是后缀。

## Alternatives considered

**把 MCP 服务器作为一个新 kind 移入 `faberloom_connections`。** 否决：注册表已经拥有持久记录、凭据引用、挂载与探测；复制它们要么把密钥复制进第二个域，要么让两条记录彼此漂移，而且注册表的挂载是进程级的，连接则是按所有者分区。

**新增一个返回合并行列表的 remote。** 否决：合并属于展示层，浏览器已经收到两个列表。宿主侧合并会把屏幕状态搬进 view，并隐藏每个字段的来源。

**对模型隐藏 `send_email` 与破坏性工具。** 否决：当替代调用方或 PTC 子派发能命名某个工具时，隐藏并不是执行；而且所有者需要看到该工具，才能理解发送为何被拒。门禁属于调用，因为调用才是做决定的操作。

**拒绝服务器名看起来像邮件服务器的 MCP 工具。** 否决：服务器名是本地配置。原始工具名才是说明该调用做什么的稳定身份，而要求是只有这些确切名称改变行为。

**为已保存的 MCP 行持久化按名探测，使其无需凭据即可重测。** 暂缓：注册表的探测刻意不读取接缝，而按行测试需要新的公开结果或持久发现记录。Conexiones 表单会再次要求输入值，这与 Settings 页面声明的限制相同。

## Consequences

一张表回答了邮件在哪里，所有者也能把 MCP 连接看作连接。代价是 MCP 行若不再输入凭据就无法测试或编辑，且目标单元格显示 URL 而非服务器暴露的邮箱地址：发现它们需要一次探测未发起的 MCP 工具调用。

策略覆盖本注册表挂载的服务器。在其他位置挂载的客户端——ACP 会话服务器或 profile patch 行——不在覆盖范围，上游新增的破坏性邮件工具在原始名加入策略映射之前也不受影响。被拒绝的发送产生通常的工具结果文本，因此调用被拒时工具列表及其模式顺序不变。

## Testing

`pnpm run typecheck` 通过。针对 `packages/faberloom/mcp-registry`、`packages/client/ui-faberloom`、`packages/faberloom/connections` 与 `packages/faberloom/view` 的聚焦 Vitest 运行在 60 个文件中通过 666 个测试。注册表套件覆盖纯映射（放行、拒绝、询问）、经 `ctx.tools.execute` 的读取、无关工具、被拒的发送与全部十一个询问工具的执行，以及注册表 fiber 销毁时监听器的移除。客户端套件覆盖合并后的表、编辑器读取已存值且凭据留空、探测与保存发送单个 bearer 头、删除，以及从类型选择安装新的 MCP 连接。
