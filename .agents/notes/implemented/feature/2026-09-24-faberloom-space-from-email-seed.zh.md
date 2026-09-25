# Agent Note：把邮件变成一个 Space 时，会话从这封邮件开始

Status: implemented

[English](2026-09-24-faberloom-space-from-email-seed.md) | 中文

## 问题

把一封邮件变成 Space 会创建并打开该 Space 的 Workspace，但新会话是空的。智能体必须重新在邮箱里搜索用户刚刚处理的那封邮件，而且面板已经算出的附件文本被丢弃了。

## 决定

`spaceFromEmail` 返回一个 `context` 字符串——发件人、主题、纯文本正文，以及抽取出的附件 Markdown——Email 面板把它作为新会话的第一条消息发送。

- `FaberLoomSpaceFromEmail` 新增 `context: string`，与 `spaceId` / `workspaceId` 并列，属于追加字段。
- 面板的 Create 手势在 `ctx.sessions.create({ workspaceId })` 之后解析 Session（`ctx.sessions.binding(id)?.session`），并在打开会话前调用 `session.prompt([{ type: 'text', text: context }], 'queue')`。
- 随后面板用 `ctx.sessions.open(id)` 暂存所创建的会话，使 `selectPanel(null)` 把用户带到已播种的对话，而不是空白对话。
- 该手势位于 `packages/client/ui-faberloom/src/client/space-from-email.ts`（`runSpaceFromEmail`），从面板的 `inject` face 中抽出，以便不依赖渲染机制进行测试；`index.ts` 只保留一行接线。
- 发件人行来自面板——它已经持有信封的 `from`；IMAP 读取器不暴露头部。
- 种子带有消息 uid 与护栏：它把正文标记为上下文而非指令，告诉模型在动手前先一次一个问题地应用 `interview-me` 技能（“grill me”），在用户要求之前不要读取邮箱或触碰业务 MCP，并记录 uid，以便之后索取附件时无需再搜索。网关工作区规则也重申了这条护栏，并给出 MCP 的业务意图判据。

## 考虑过的替代方案

**在会话内用 uid 重新读取邮件。** 这会重复面板已经付出的 IMAP 往返，并且智能体在动手前还需要一次邮箱工具调用。

**只把邮件放进 Space 记忆。** 记忆是智能体可以查阅的持久上下文，不是第一轮用户消息，因此会话仍会以一条不可见的消息打开。

## 后果

- 新的 Space 会话以这封邮件作为第一条用户消息开始；同一文本也用于附件摄取，因此智能体无需再次调用就能看到文档 Markdown。
- 该种子是一条 queue 模式的消息；当创建或发送失败时，面板仍会以一个空会话打开。
- 护栏只多花一行 token，却避免了把邮件当作任务来读时触发的、对邮箱与业务 MCP 的无谓扫荡。

## 测试

`packages/client/ui-faberloom/tests/space-from-email.client.spec.ts` 在桩上下文上驱动 `runSpaceFromEmail`：断言会话创建、携带 context 的 queue 消息、面板切换、无 workspace 路径（不创建、不发送）以及读取失败路径。`packages/faberloom/view/tests/space-from-email.spec.ts` 断言返回的 `context` 携带发件人、主题与正文。
