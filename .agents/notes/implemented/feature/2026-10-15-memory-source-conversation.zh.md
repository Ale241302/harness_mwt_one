# Agent Note: 记忆会指出捕获它的那段对话

Status: implemented

[English](2026-10-15-memory-source-conversation.md) | 中文

## Problem

Memoria 面板列出 Space 记忆，而 agent 在每个回合结束时捕获的每一行都是该回合的蒸馏：`captureTurnToMemory` 通过 `faberloomSpaces.remember(actor, text, [space.id], session.id)` 保存该 Space 的问题与结果，因此存储记录一直携带着产生它的 Session。该字段不是装饰：`forgetMemoryBySession` 用它在一个 Session 被删除时移除它的记忆，使事实不会比它背后的对话活得更久。

对话框只显示蒸馏文本、Space 与日期，别无其他。因此像 `Resultado: The user just said "hola"...` 这样的一行读起来像一条孤立陈述：操作者无法看出它来自哪段对话，也无法从这一行所在的位置读到那段对话。线格式的行（`FaberLoomSpaceMemoryRow`）丢弃了存储层保留的字段，所以即便对话框想显示也无从显示。对话框模式本身正是[面板对话框决定](2026-10-14-panel-record-dialogs.zh.md)所确定的，并以 Memoria 作为参照；缺的是记录自身的来源。

## Decision

**行携带 Session，对话框命名它并打开它。** `FaberLoomSpaceMemoryRow.sessionId` 是一个必填的可空字段，`spaceMemory` 映射把存储的值透传出去，而不是丢掉。

**对话框从客户端自己的列表解析 Session 的标签。** 面板读取标准的 `useSessions` 馈源，并在 `Origen` 下显示 `displayTitle`，因此这一行直接说明它来自哪段对话，无需往返，也不为该标签引入第二个来源。

**`Abrir conversación` 打开真正的对话。** 该动作是注入的 `openSession`，即 `ctx.sessions.open(id)` 后接 `ctx.layout.selectPanel(null)`：Espacios 面板的共享会话行此前已经在做同一件事，因此注入成员从 `openSharedSession` 更名为 `openSession`。一个手势一个名字，两个调用方。

**本机不再列出的 Session 会读作已不在。** 对话框如此说明，而不会给出无法执行的控件；完全没有 Session 的行（手工记录的，或从邮件、文档捕获的）则说明该来源，与表格类型标签使用同一种推导。

**来源那一行是块级元素，不是 `Field`。** `Field` 的 `<label>` 里的按钮会把整个字段文本当作自己的可访问名称，因为 button 是可标注（labelable）元素；第一次测试运行失败正因如此，否则会发布一个被读作 "Origin Saludo inicial Open conversation" 的控件。

## Alternatives considered

**在对话框内渲染对话。** 对话渲染归对话域所有。在这个面板里再写一个渲染器会是降级副本：缺少工具结果与流式状态，而且 `ctx.sessions` 根本没有读取 transcript 的能力：create、open、binding、fork、search 就是它的全部面。打开对话能显示操作者要的消息，保持只有一个渲染器，并允许他们从那里继续。

**新增一个返回 transcript 的 Remote 方法。** 它会重复对话渲染，并为客户端已经能通过标准馈源拿到的事实拓宽宿主 API。

**新增一个解析 Session 标题的 Remote 方法。** 客户端列表已经为每个列出的 Session 携带 `displayTitle`。一次往返会为同一个标签引入第二个来源，并制造两者不一致的可能。

**只显示「从某段对话捕获」，不给名字。** 它陈述了事实，却仍让操作者无法分辨是哪一段，而这正是本次改动要回答的抱怨。

**从行的文本推导来源。** `Resultado: ...` 前缀是内容，不是链接；记录自身的 `sessionId` 才是事实，而一行文本恰好与另一行相似并不构成证据。

## Consequences

对话框回答了某一行从何而来，读那段对话只差一次点击。线格式的行新增一个必填字段，因此该行的每个生产者都要给出它；存储记录与 spaces 服务本就携带它，所以没有任何新持久化的东西。

代价是刻意的：想在对话框内看到消息渲染的操作者仍需打开 Session。要买到那一点，需要一套宿主 transcript API 再加第二个对话渲染器，而真实对话的保真度值这一下点击。注入成员的更名只触及本包内的两个调用方。

## Testing

`packages/faberloom/view/tests/workspace-board.spec.ts` 固定该行对存储值的透传。`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 固定对话框命名那段对话、打开动作抵达 sessions 服务并离开面板，以及已不在状态不提供任何动作。`test:gui`、`verify-client-ui-i18n`、oxlint 与两个 TypeScript 面均通过。
