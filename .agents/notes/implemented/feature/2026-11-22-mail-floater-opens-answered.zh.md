# Agent Note：浮动邮件对话打开即有回答

Status: implemented

[English](2026-11-22-mail-floater-opens-answered.md) | 中文

## 问题

用橙色按钮打开邮件时，浮动对话停在一个空的输入框：owner 点击了一个摘要入口，却没有得到摘要。邮件从未送达 Session，因为 `openMailChat` 在 `sessions.create()` 之后立刻读取新绑定，此时浏览器列表尚未刷新，于是重命名与注入被静默跳过。草稿编辑器的问题相反：“Pedir un cambio a la IA”文字按钮把同一个 Session 打开在主工作区，却对草稿和它所回复的线程只字不提。

## 决定

### 邮件 Session 收到第一个回合

`openMailChat` 在 `create()` 之后等待 `sessions.refresh()`，之后才读取绑定，因此重命名与注入得以执行。`seedMailSession(sessionId, seed, defer?, question?)` 把邮件上下文作为可持久上下文消息注入，并在给出 `question` 时把它作为第一个用户回合投递；因此浮动面板呈现一个问题及其回答，而不是空白。邮件正文放在 `<untrusted-email>` 块内，限制为 6000 字符，并与 uid、发件人、主题、Space 和附件一起传递，摘要因此不依赖工具调用。

### 草稿编辑器使用同一个按钮

草稿编辑器移除文字按钮，渲染同一个橙色 `emailAssistantFab` 按钮，并上移到自己的工具栏之上。它的动作先保存草稿，再打开浮动对话（`sessions.open` 加 `layout.openFloatConversation`），而不是跳转到主工作区。`draftSessionAsk(draftId, question)` 把该第一回合投递到草稿已拥有的 Session，并在草稿没有 Session 时拒绝，因此客户端无法向任意会话提问。客户端在该浏览器中每个 Session 只提问一次（`faberloom.draft.greeted.<sessionId>`），第二次点击继续同一段对话而不是重复摘要。

### 新建的 Host Session 要等待，不能假定

两条路径都会在投递前最多等待三秒，直到 Host 刚创建的 Session 出现在 agent registry 中：这段等待位于私有的 `sessionAgent` 查询里，若始终未出现则返回 undefined 而不是抛错。此前的代码返回 false，而客户端把它吞掉，这正是失败无声的原因。

## 备选方案

**复用 `emailChat` 生成摘要。** 不采用：该 RPC 拥有自己的 Session（以 uid/路由为键）并把文本返回给面板，浮动面板会显示第二段并行对话，而不是 owner 打开的那一段。

**把整封邮件作为用户回合（此前的 `defer: false` 默认）。** 此路径不采用：owner 读到的问题应当是摘要请求，而不是一整段头部与正文。注入让对话记录可读，并让上下文持久。

**由 Client 轮询直到 Host 列出 Session。** 不采用：它把 Host 的 registry 知识复制到浏览器，并且在 `seedMailSession` 的其他消费者里仍然留着竞态。

**让草稿留在主工作区。** 不采用：owner 要求与邮件相同的浮动界面，同一个按钮落到两个不同目的地正是本记录要消除的不一致。

## 后果

两个入口现在每次打开对话都会消耗一个模型回合，这正是该入口的意义。同一浏览器再次打开邮件会复用其 Session，不重复该回合；草稿在其问候标记存在后同样如此。草稿 Session 保持仅限草稿工具的约束，因此摘要无法读取其他邮件或发送任何内容。问候是浏览器状态而非 Session 状态：清除站点数据会重复一次。

## 测试

`corepack pnpm run typecheck` 通过。聚焦 Vitest 运行覆盖 `packages/faberloom/mcp-registry`、`packages/faberloom/view`、`packages/client/ui-faberloom`、`packages/faberloom/connections` 与 `packages/mcp/mcp-client`，70 个文件共 817 个测试通过。新增覆盖：`seedMailSession` 注入上下文后把问题作为独立回合提问；`draftSessionAsk` 触达已绑定 Session、拒绝没有 Session 的草稿并拒绝只读身份；Client 打开浮动面板、每个 Session 只问一次、保持停靠对话仍停靠、没有提示时不提问。Registry 也证明调用方预算按次生效并提升到下限，因此 Correo 面板不会被缓慢的 MCP 服务器拖住。
