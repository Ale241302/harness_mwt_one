# Agent Note：所有者的邮箱手势可经 MCP 执行，但模型路径仍然关闭

Status: implemented

[English](2026-11-23-mcp-owner-mail-actions.md) | 中文

## 问题

Correo 面板里的 MCP 邮箱是只读的：即使服务器公开了标记已读、移动或移入垃圾箱所需的工具，所有 MCP 行仍拒绝这些操作。面向模型的策略有意拒绝这些变更工具名，而面板复用了同一拒绝。只能通过 MCP 访问的邮箱可以读，却不能整理；所有者必须为同一邮箱再加一条 IMAP 连接才能操作。

## 决定

### 两条调用路径，一张策略表

`callTool` 仍是模型路径，继续拒绝所有受保护名称，包括消息操作。`callOwnerAction` 是 Correo 面板在人工手势后使用的所有者路径。它只接受可逆的消息操作：`messages_patch`、`messages_update-flags`、`messages_move` 和 `messages_move-bulk`。发送、永久删除（`messages_delete-bulk`）、文件夹修改和 webhook 在两条路径上都被拒绝。允许清单与拒绝表同在 `policy.ts` 中，未来新增名称只需在一处分类。

### 能力来自已挂载的服务器

`toolsFor` 返回活动客户端注册的原始工具名。视图据此与邮箱报告的文件夹推导四个布尔值：

- **markSeen**：服务器有 `messages_patch` 或 `messages_update-flags`。
- **move**：服务器有 `messages_move` 或 `messages_move-bulk`。
- **trash**：可移动且报告了垃圾箱文件夹。
- **restore**：可移动且报告了收件箱文件夹。

邮箱分组携带这些布尔值。阅读器只显示服务器声明可用的控件；没有这些工具的服务器保留只读提示，而不是点击后失败。任何遵循同一消息工具约定的 MCP 服务器都能获得这些操作，不限于 Hostinger。

### 垃圾箱是移动，绝不是永久删除

垃圾箱手势把邮件移动到服务器的垃圾箱文件夹，与 IMAP 一致，误点可恢复。恢复则移动回收件箱。面板绝不调用永久删除工具 `messages_delete-bulk`。两条路径之后都会捕获丢弃模式的教学，并保持相同的失败隔离。

## 备选方案

**复用 `callTool` 并放宽策略。** 否决：模型会重新获得这些变更名称，而这正是受保护表要阻止的。

**公开永久删除。** 否决：面板的约定是可恢复的垃圾箱；永久删除需要单独的确认，不属于这个手势。

**只硬编码 Hostinger。** 否决：能力发现的工作量相同，并让任何具备消息工具的服务器参与。

## 后果

工具命名不同的服务器在加入映射前保持只读；面板通过只读提示说明这一点。两条写入路径可以指向同一邮箱（IMAP 与 MCP）；两者都作用于同一服务器状态，面板的手势就是批准。面向模型的 MCP 工具仍然可见且被拒绝，代理无法借此绕过所有者。

## 测试

`vitest run packages/faberloom/mcp-registry/tests`：38/38，包括所有者操作成功执行而 `callTool` 仍拒绝，以及拒绝非所有者操作。`vitest run packages/faberloom/view/tests`：318/318 加上两个新的 MCP 操作用例。`vitest run packages/client/ui-faberloom/tests/registration.client.spec.tsx`：149/149，包括按能力显示标记与垃圾箱控件。三个包的 `tsc -b` 与 `oxlint` 均为 0。
